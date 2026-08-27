<?php

namespace Tests\Feature;

use App\Models\CashAdvance;
use App\Models\Merchandise;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FinancialAccountabilityTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role, ?int $organizationId = null): User
    {
        return User::factory()->create(['role' => $role, 'organization_id' => $organizationId ?? Organization::factory(), 'account_status' => 'active']);
    }

    public function test_verified_collection_can_be_partially_remitted_without_double_counting_ledger_income(): void
    {
        $officer = $this->user('SBO_OFFICER');
        $adviser = $this->user('DEPARTMENT_HEAD', $officer->organization_id);
        Sanctum::actingAs($officer);
        $collection = $this->postJson('/api/collections', ['expected_amount' => '1000.00', 'amount_collected' => '850.00', 'source' => 'Event fee'])->assertCreated()->json();
        Sanctum::actingAs($adviser);
        $this->patchJson('/api/collections/'.$collection['id'].'/verify')->assertOk();
        Sanctum::actingAs($officer);
        $this->postJson('/api/collections/'.$collection['id'].'/remittances', ['amount' => '700.00'])->assertCreated();
        $this->postJson('/api/collections/'.$collection['id'].'/remittances', ['amount' => '151.00'])->assertUnprocessable();
        $this->getJson('/api/collections')->assertOk()->assertJsonPath('0.total_remitted', 700)->assertJsonPath('0.unremitted_balance', 150);
        $this->assertDatabaseCount('transactions', 1);
        $this->assertDatabaseHas('audit_logs', ['module' => 'collections', 'action' => 'verified']);
    }

    public function test_cash_advance_requires_other_approver_and_repayment_cannot_exceed_balance(): void
    {
        $officer = $this->user('SBO_OFFICER');
        $admin = $this->user('ADMIN', $officer->organization_id);
        Sanctum::actingAs($officer);
        $advanceId = $this->postJson('/api/cash-advances', ['amount' => '500.00', 'purpose' => 'Venue deposit'])->assertCreated()->json('id');
        Sanctum::actingAs($officer);
        $this->patchJson("/api/cash-advances/{$advanceId}/approve")->assertForbidden();
        Sanctum::actingAs($admin);
        $this->patchJson("/api/cash-advances/{$advanceId}/approve")->assertOk();
        $this->patchJson("/api/cash-advances/{$advanceId}/release")->assertOk();
        $this->postJson("/api/cash-advances/{$advanceId}/repayments", ['amount' => '200.00'])->assertOk()->assertJsonPath('remaining_balance', 300);
        $this->postJson("/api/cash-advances/{$advanceId}/repayments", ['amount' => '301.00'])->assertUnprocessable();
        $this->assertDatabaseCount('transactions', 2);
    }

    public function test_student_only_sees_own_invoices_and_financial_writes_are_forbidden(): void
    {
        $admin = $this->user('ADMIN');
        $student = $this->user('STUDENT', $admin->organization_id);
        $other = $this->user('STUDENT', $admin->organization_id);
        Sanctum::actingAs($admin);
        $this->postJson('/api/invoices', ['student_id' => $student->school_id, 'description' => 'Organization fee', 'amount_due' => '100.00'])->assertCreated();
        $this->postJson('/api/invoices', ['student_id' => $other->school_id, 'description' => 'Other fee', 'amount_due' => '200.00'])->assertCreated();
        Sanctum::actingAs($student);
        $this->getJson('/api/invoices')->assertOk()->assertJsonCount(1);
        $this->postJson('/api/invoices', ['student_id' => $student->school_id, 'description' => 'No', 'amount_due' => '1.00'])->assertForbidden();
        $this->getJson('/api/audit-logs')->assertForbidden();
    }

    public function test_admin_audit_log_has_readable_actor_subject_and_affected_student_profile(): void
    {
        $admin = $this->user('ADMIN');
        $student = $this->user('STUDENT', $admin->organization_id);
        $student->update(['department' => 'Computing', 'program' => 'BSIT', 'year_level' => '3rd Year']);
        Sanctum::actingAs($admin);
        $this->postJson('/api/invoices', ['student_id' => $student->school_id, 'description' => 'Organization fee', 'amount_due' => '100.00'])->assertCreated();
        $this->getJson('/api/audit-logs')->assertOk()
            ->assertJsonPath('data.0.actor.name', $admin->first_name.' '.$admin->last_name.' ('.$admin->school_id.')')
            ->assertJsonPath('data.0.affected_user.department', 'Computing')
            ->assertJsonPath('data.0.affected_user.program', 'BSIT')
            ->assertJsonPath('data.0.affected_user.year_level', '3rd Year')
            ->assertJsonPath('data.0.action_label', 'Created');
    }

    public function test_admin_can_view_one_students_debt_summary_for_the_profile_modal(): void
    {
        $admin = $this->user('ADMIN');
        $student = $this->user('STUDENT', $admin->organization_id);
        Sanctum::actingAs($admin);
        $this->postJson('/api/invoices', ['student_id' => $student->school_id, 'description' => 'Organization fee', 'amount_due' => '250.00'])->assertCreated();

        $this->getJson('/api/student-debts?student_id='.$student->school_id)->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.student.school_id', $student->school_id)
            ->assertJsonPath('0.invoice_debt', 250)
            ->assertJsonPath('0.total_debt', 250)
            ->assertJsonPath('0.clearance_status', 'pending_clearance');

        Sanctum::actingAs($this->user('DEPARTMENT_HEAD', $admin->organization_id));
        $this->getJson('/api/student-debts?student_id='.$student->school_id)->assertForbidden();
    }

    public function test_admin_student_financial_accounts_are_filterable_and_paginated(): void
    {
        $admin = $this->user('ADMIN');
        $students = User::factory()->count(17)->create(['role' => 'STUDENT', 'organization_id' => $admin->organization_id, 'account_status' => 'active']);
        Sanctum::actingAs($admin);
        $this->postJson('/api/invoices', ['student_id' => $students->first()->school_id, 'description' => 'Overdue fee', 'amount_due' => '375.00', 'due_date' => now()->subDay()->toDateString()])->assertCreated();

        $this->getJson('/api/student-debts?per_page=10')->assertOk()
            ->assertJsonCount(10, 'data')->assertJsonPath('total', 17)->assertJsonPath('per_page', 10)
            ->assertJsonPath('summary.students_owing', 1)->assertJsonPath('summary.students_overdue', 1)
            ->assertJsonPath('summary.total_outstanding', 375);
        $this->getJson('/api/student-debts?status=owing&per_page=10')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('total', 1)->assertJsonPath('data.0.student.school_id', $students->first()->school_id);
    }

    public function test_only_admin_can_update_the_organization_gcash_qr_code(): void
    {
        $admin = $this->user('ADMIN');
        $student = $this->user('STUDENT', $admin->organization_id);
        Sanctum::actingAs($student);
        $this->postJson('/api/merchandise/gcash-settings', ['qr_code' => UploadedFile::fake()->image('qr.png')])->assertForbidden();

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/merchandise/gcash-settings', ['qr_code' => UploadedFile::fake()->image('qr.png')])
            ->assertOk()->assertJsonPath('gcash_qr_url', fn ($url) => str_contains($url, '/uploads/gcash/'));
        $storedPath = Organization::findOrFail($admin->organization_id)->gcash_qr_url;
        @unlink(public_path(ltrim($storedPath, '/')));
        $this->assertDatabaseHas('organizations', ['id' => $admin->organization_id, 'gcash_qr_url' => $storedPath]);
    }

    public function test_gcash_order_is_rejected_until_an_official_qr_is_configured(): void
    {
        $student = $this->user('STUDENT');
        $item = Merchandise::factory()->create(['organization_id' => $student->organization_id, 'is_active' => true, 'stock_quantity' => 5]);
        Sanctum::actingAs($student);

        $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'gcash'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'GCash payment is unavailable until an administrator uploads the official QR code.');
        $this->assertDatabaseCount('orders', 0);
    }
}
