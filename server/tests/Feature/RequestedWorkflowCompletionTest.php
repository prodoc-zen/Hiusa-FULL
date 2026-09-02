<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RequestedWorkflowCompletionTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role, ?int $organizationId = null): User
    {
        return User::factory()->create([
            'role' => $role,
            'organization_id' => $organizationId ?? Organization::factory(),
            'account_status' => 'active',
        ]);
    }

    public function test_transaction_search_runs_server_side_across_the_organization_ledger(): void
    {
        $admin = $this->user('ADMIN');
        $otherOrganization = Organization::factory()->create();
        foreach ([
            [$admin->organization_id, 'General supplies', 'Operations'],
            [$admin->organization_id, 'Leadership summit venue', 'Events'],
            [$otherOrganization->id, 'Leadership summit leak', 'Events'],
        ] as [$organizationId, $description, $category]) {
            Transaction::create([
                'organization_id' => $organizationId,
                'recorded_by' => $admin->school_id,
                'type' => 'expense',
                'amount' => 100,
                'category' => $category,
                'description' => $description,
                'transaction_date' => now(),
            ]);
        }

        Sanctum::actingAs($admin);
        $this->getJson('/api/transactions?search=leadership&per_page=1')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.description', 'Leadership summit venue');
    }

    public function test_forecast_fills_inactive_months_and_uses_approved_available_budget(): void
    {
        $admin = $this->user('ADMIN');
        $budget = Budget::create([
            'organization_id' => $admin->organization_id,
            'title' => 'Approved operating funds',
            'allocated_amount' => 1000,
            'remaining_amount' => 750,
            'warning_threshold' => 100,
        ]);
        ApprovalRequest::create([
            'organization_id' => $admin->organization_id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'requested_by' => $admin->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'approved',
        ]);

        foreach ([now()->subMonths(2)->startOfMonth(), now()->startOfMonth()] as $date) {
            Transaction::create([
                'organization_id' => $admin->organization_id,
                'recorded_by' => $admin->school_id,
                'type' => 'income',
                'amount' => 500,
                'category' => 'General',
                'description' => 'Forecast source',
                'transaction_date' => $date,
            ]);
        }

        Sanctum::actingAs($admin);
        $this->postJson('/api/forecasts/generate', ['months' => 6])
            ->assertCreated()
            ->assertJsonPath('model_details.sample_months', 3)
            ->assertJsonPath('model_details.populated_months', 2)
            ->assertJsonPath('model_details.current_available_budget', 750);
    }

    public function test_buyer_can_submit_gcash_proof_and_payment_and_claim_checks_are_enforced(): void
    {
        $organization = Organization::factory()->withGcashQr()->create();
        $buyer = $this->user('STUDENT', $organization->id);
        $officer = $this->user('SBO_OFFICER', $buyer->organization_id);
        $admin = $this->user('ADMIN', $buyer->organization_id);
        $item = Merchandise::create([
            'organization_id' => $buyer->organization_id,
            'name' => 'HIUSA Shirt',
            'price' => 250,
            'stock_quantity' => 2,
            'is_active' => true,
        ]);

        Sanctum::actingAs($buyer);
        $orderId = $this->postJson('/api/orders', [
            'merchandise_id' => $item->id,
            'quantity' => 1,
            'payment_method' => 'cash',
        ])->assertCreated()->json('id');

        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
        $proof = UploadedFile::fake()->createWithContent('proof.png', $png);
        $payment = $this->post("/api/orders/{$orderId}/payment", [
            'payment_reference' => '1234567890123',
            'payment_proof' => $proof,
        ], ['Accept' => 'application/json'])->assertOk();
        $paymentPath = public_path(ltrim($payment->json('payment_proof_url'), '/'));

        try {
            Sanctum::actingAs($officer);
            $this->patchJson("/api/orders/{$orderId}/status", [
                'status' => 'paid',
                'verified_amount' => 249,
            ])->assertUnprocessable();
            $this->patchJson("/api/orders/{$orderId}/status", [
                'status' => 'paid',
                'verified_amount' => 250,
            ])->assertOk();

            $approval = ApprovalRequest::where('entity_type', 'payment')->where('entity_id', $orderId)->firstOrFail();
            Sanctum::actingAs($admin);
            $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])->assertOk();

            $token = $approval->fresh()->status === 'approved'
                ? Order::findOrFail($orderId)->claim_token
                : null;
            Sanctum::actingAs($officer);
            $this->getJson('/api/orders')->assertOk()->assertJsonPath('data.0.claim_token', null);
            $this->postJson('/api/orders/claim', ['claim_token' => $token])->assertOk();
            $this->postJson('/api/orders/claim', ['claim_token' => $token])->assertConflict();
        } finally {
            if (is_file($paymentPath)) {
                unlink($paymentPath);
            }
        }
    }

    public function test_assigned_task_updates_have_legal_transitions_history_and_tenant_safe_visibility(): void
    {
        $admin = $this->user('ADMIN');
        $officer = $this->user('SBO_OFFICER', $admin->organization_id);
        $otherOfficer = $this->user('SBO_OFFICER', $admin->organization_id);

        Sanctum::actingAs($admin);
        $taskId = $this->postJson('/api/tasks', [
            'title' => 'Prepare event materials',
            'description' => 'Prepare and verify all materials.',
            'assigned_to' => $officer->school_id,
            'deadline' => now()->addWeek()->toDateTimeString(),
            'status' => 'pending',
        ])->assertCreated()->assertJsonCount(1, 'progress_updates')->json('id');

        Sanctum::actingAs($otherOfficer);
        $this->getJson('/api/tasks')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson("/api/tasks/{$taskId}/status", ['status' => 'in_progress'])->assertForbidden();

        Sanctum::actingAs($officer);
        $this->patchJson("/api/tasks/{$taskId}/status", ['status' => 'completed'])
            ->assertUnprocessable();
        $this->patchJson("/api/tasks/{$taskId}/status", [
            'status' => 'in_progress',
            'progress_percent' => 35,
            'progress_note' => 'Materials have been sourced.',
        ])->assertOk()
            ->assertJsonPath('progress_percent', 35)
            ->assertJsonCount(2, 'progress_updates');
        $this->patchJson("/api/tasks/{$taskId}/status", [
            'status' => 'completed',
            'progress_note' => 'Materials verified and handed over.',
        ])->assertOk()
            ->assertJsonPath('progress_percent', 100)
            ->assertJsonCount(3, 'progress_updates');

        $this->assertDatabaseHas('notifications', [
            'user_id' => $admin->school_id,
            'notification_type' => 'task',
            'reference_id' => $taskId,
        ]);
    }

    public function test_stock_adjustments_are_audited(): void
    {
        $admin = $this->user('ADMIN');
        $item = Merchandise::create([
            'organization_id' => $admin->organization_id,
            'name' => 'Audit Item',
            'price' => 10,
            'stock_quantity' => 1,
            'is_active' => true,
        ]);

        Sanctum::actingAs($admin);
        $this->patchJson("/api/merchandise/{$item->id}/stock", ['stock_delta' => 2])->assertOk();
        $this->patchJson("/api/merchandise/{$item->id}/stock", ['stock_delta' => 3])
            ->assertOk()
            ->assertJsonPath('stock_quantity', 6);
        $this->assertDatabaseHas('audit_logs', [
            'organization_id' => $admin->organization_id,
            'module' => 'merchandise',
            'action' => 'stock_adjusted',
            'record_id' => $item->id,
        ]);
    }
}
