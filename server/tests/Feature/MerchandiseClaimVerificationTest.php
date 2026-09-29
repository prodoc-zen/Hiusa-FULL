<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MerchandiseClaimVerificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_staff_can_preview_paid_claim_without_mutation_then_release_only_once(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id, 'program' => 'BSIT', 'section' => '4-A']);
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $item = Merchandise::factory()->create(['organization_id' => $organization->id]);
        $order = Order::create([
            'organization_id' => $organization->id, 'student_id' => $buyer->school_id,
            'merchandise_id' => $item->id, 'quantity' => 2, 'unit_price' => 75,
            'total_price' => 150, 'status' => 'paid', 'payment_method' => 'cash',
            'claim_token' => 'CLAIMTOKEN000001', 'approved_by' => $officer->school_id,
        ]);

        Sanctum::actingAs($officer);
        $this->postJson('/api/orders/claim/verify', ['claim_token' => strtolower($order->claim_token)])
            ->assertOk()
            ->assertJsonPath('id', $order->id)
            ->assertJsonPath('student.school_id', $buyer->school_id)
            ->assertJsonPath('student.program', 'BSIT')
            ->assertJsonPath('unit_price', '75.00')
            ->assertJsonPath('organization.name', $organization->name);

        $this->assertSame('paid', $order->fresh()->status);
        $this->assertNull($order->fresh()->claim_verified_at);
        $this->assertSame(0, AuditLog::where('record_type', Order::class)->where('record_id', $order->id)->count());

        $this->postJson('/api/orders/claim', ['claim_token' => $order->claim_token])
            ->assertOk()->assertJsonPath('status', 'claimed');
        $this->assertDatabaseHas('orders', [
            'id' => $order->id, 'status' => 'claimed', 'claim_verified_by' => $officer->school_id,
        ]);
        $this->assertNotNull($order->fresh()->claimed_at);
        $this->assertDatabaseHas('audit_logs', [
            'record_type' => Order::class, 'record_id' => $order->id, 'action' => 'claimed',
        ]);
        $this->postJson('/api/orders/claim', ['claim_token' => $order->claim_token])->assertStatus(409);
        $this->postJson('/api/orders/claim/verify', ['claim_token' => $order->claim_token])->assertStatus(409);
    }

    public function test_preview_rejects_invalid_unpaid_foreign_and_student_requests(): void
    {
        $organization = Organization::factory()->create();
        $other = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $staff = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $outside = User::factory()->officer()->create(['organization_id' => $other->id]);
        $item = Merchandise::factory()->create(['organization_id' => $organization->id]);
        $order = Order::create([
            'organization_id' => $organization->id, 'student_id' => $buyer->school_id,
            'merchandise_id' => $item->id, 'quantity' => 1, 'total_price' => 100,
            'status' => 'pending', 'payment_method' => 'cash', 'claim_token' => 'CLAIMTOKEN000002',
        ]);

        Sanctum::actingAs($staff);
        $this->postJson('/api/orders/claim/verify', ['claim_token' => 'short'])->assertUnprocessable();
        $this->postJson('/api/orders/claim/verify', ['claim_token' => $order->claim_token])->assertUnprocessable();
        $order->update(['status' => 'paid']);

        Sanctum::actingAs($outside);
        $this->postJson('/api/orders/claim/verify', ['claim_token' => $order->claim_token])->assertNotFound();

        Sanctum::actingAs($buyer);
        $this->postJson('/api/orders/claim/verify', ['claim_token' => $order->claim_token])->assertForbidden();
    }

    public function test_personal_receipt_includes_order_payment_context_only_for_same_organization(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $item = Merchandise::factory()->create(['organization_id' => $organization->id]);
        $transaction = Transaction::create([
            'organization_id' => $organization->id, 'recorded_by' => $admin->school_id,
            'payer_id' => $buyer->school_id, 'type' => 'income', 'category' => 'Merchandise',
            'description' => 'Merchandise order payment', 'amount' => 100,
            'receipt_reference' => 'MERCH-CLAIM-TEST', 'transaction_date' => now(),
        ]);
        Order::create([
            'organization_id' => $organization->id, 'student_id' => $buyer->school_id,
            'merchandise_id' => $item->id, 'quantity' => 1, 'total_price' => 100,
            'status' => 'paid', 'payment_method' => 'gcash',
            'approved_by' => $admin->school_id, 'transaction_id' => $transaction->id,
            'claim_token' => 'CLAIMTOKEN000003',
        ]);

        Sanctum::actingAs($buyer);
        $this->getJson('/api/transactions/personal-receipts')
            ->assertOk()
            ->assertJsonPath('0.organization.name', $organization->name)
            ->assertJsonPath('0.merchandise_order.payment_method', 'gcash')
            ->assertJsonPath('0.merchandise_order.approver.school_id', $admin->school_id);
    }

    public function test_personal_receipt_does_not_load_a_foreign_organizations_order(): void
    {
        $organization = Organization::factory()->create();
        $other = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $outsideBuyer = User::factory()->student()->create(['organization_id' => $other->id]);
        $outsideItem = Merchandise::factory()->create(['organization_id' => $other->id]);
        $transaction = Transaction::create([
            'organization_id' => $organization->id, 'recorded_by' => $admin->school_id,
            'payer_id' => $buyer->school_id, 'type' => 'income', 'category' => 'Membership',
            'description' => 'Membership payment', 'amount' => 100,
            'receipt_reference' => 'ORG-SCOPE-RECEIPT', 'transaction_date' => now(),
        ]);
        Order::create([
            'organization_id' => $other->id, 'student_id' => $outsideBuyer->school_id,
            'merchandise_id' => $outsideItem->id, 'quantity' => 1, 'total_price' => 100,
            'status' => 'paid', 'payment_method' => 'gcash',
            'transaction_id' => $transaction->id, 'claim_token' => 'CLAIMTOKEN000004',
        ]);

        Sanctum::actingAs($buyer);
        $this->getJson('/api/transactions/personal-receipts')
            ->assertOk()
            ->assertJsonPath('0.id', $transaction->id)
            ->assertJsonPath('0.merchandise_order', null);
    }
}
