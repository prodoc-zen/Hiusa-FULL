<?php

namespace Tests\Feature;

use App\Models\ClearancePeriod;
use App\Models\ClearanceSignature;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ClearanceTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role, ?int $organizationId = null): User
    {
        return User::factory()->create(['role' => $role, 'organization_id' => $organizationId ?? Organization::factory(), 'account_status' => 'active']);
    }

    public function test_opening_a_period_generates_one_signature_row_per_student_per_required_role(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($superAdmin);

        $periodId = $this->postJson('/api/clearance-periods', [
            'academic_year' => '2026-2027',
            'title' => 'Second Semester Clearance',
            'required_roles' => ['organization_treasurer', 'adviser', 'sao'],
        ])->assertCreated()->json('id');

        $this->assertDatabaseCount('clearance_signatures', 3);
        $this->assertDatabaseHas('clearance_signatures', ['clearance_period_id' => $periodId, 'student_id' => $student->school_id, 'required_role' => 'sao', 'status' => 'pending']);
        $this->assertDatabaseHas('notifications', ['user_id' => $student->school_id, 'reference_type' => 'clearance_period', 'reference_id' => $periodId]);
        $this->assertDatabaseHas('audit_logs', ['module' => 'clearances', 'action' => 'clearance_period_created']);
    }

    public function test_org_scoped_signatory_can_only_sign_its_own_organization_students(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $adminA = $this->user('ADMIN', $orgA->id);
        $adminB = $this->user('ADMIN', $orgB->id);
        $studentA = $this->user('STUDENT', $orgA->id);
        Sanctum::actingAs($superAdmin);
        $this->postJson('/api/clearance-periods', [
            'academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['organization_treasurer'],
        ])->assertCreated();

        $signature = ClearanceSignature::where('student_id', $studentA->school_id)->firstOrFail();

        Sanctum::actingAs($adminB);
        $this->patchJson("/api/clearance-signatures/{$signature->id}", ['status' => 'cleared'])->assertForbidden();
        $this->getJson('/api/clearance-signatures')->assertOk()->assertJsonCount(0, 'data');

        Sanctum::actingAs($adminA);
        $this->patchJson("/api/clearance-signatures/{$signature->id}", ['status' => 'cleared'])
            ->assertOk()->assertJsonPath('status', 'cleared');
        $this->assertDatabaseHas('audit_logs', ['module' => 'clearances', 'action' => 'signature_cleared']);
    }

    public function test_only_super_admin_signs_the_sao_role_regardless_of_organization(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($superAdmin);
        $this->postJson('/api/clearance-periods', [
            'academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['sao'],
        ])->assertCreated();
        $signature = ClearanceSignature::where('student_id', $student->school_id)->firstOrFail();

        Sanctum::actingAs($admin);
        $this->patchJson("/api/clearance-signatures/{$signature->id}", ['status' => 'cleared'])->assertForbidden();

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/clearance-signatures/{$signature->id}", ['status' => 'cleared'])->assertOk();
    }

    public function test_clearance_completes_only_when_every_required_role_is_cleared_and_student_is_notified(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($superAdmin);
        $periodId = $this->postJson('/api/clearance-periods', [
            'academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['organization_treasurer', 'sao'],
        ])->assertCreated()->json('id');

        $orgSignature = ClearanceSignature::where('student_id', $student->school_id)->where('required_role', 'organization_treasurer')->firstOrFail();
        $saoSignature = ClearanceSignature::where('student_id', $student->school_id)->where('required_role', 'sao')->firstOrFail();

        Sanctum::actingAs($admin);
        $this->patchJson("/api/clearance-signatures/{$orgSignature->id}", ['status' => 'cleared'])->assertOk();

        Sanctum::actingAs($student);
        $mine = $this->getJson('/api/clearances/mine')->assertOk()->json();
        $thisPeriod = collect($mine)->firstWhere('clearance_period_id', $periodId);
        $this->assertFalse($thisPeriod['is_complete']);

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/clearance-signatures/{$saoSignature->id}", ['status' => 'cleared'])->assertOk();

        $this->assertDatabaseHas('notifications', ['user_id' => $student->school_id, 'title' => 'Your clearance is complete']);
        // The SAO signatory belongs to a different organization than the
        // student, so the shared api-response cache only guarantees
        // consistency once its TTL elapses - see OrganizationComplianceTest.
        $this->travel(21)->seconds();
        Sanctum::actingAs($student);
        $mine = $this->getJson('/api/clearances/mine')->assertOk()->json();
        $thisPeriod = collect($mine)->firstWhere('clearance_period_id', $periodId);
        $this->assertTrue($thisPeriod['is_complete']);
    }

    public function test_holding_a_signature_requires_a_reason_and_a_signed_row_cannot_be_signed_again(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($superAdmin);
        $this->postJson('/api/clearance-periods', [
            'academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['organization_treasurer'],
        ])->assertCreated();
        $signature = ClearanceSignature::where('student_id', $student->school_id)->firstOrFail();

        Sanctum::actingAs($admin);
        $this->patchJson("/api/clearance-signatures/{$signature->id}", ['status' => 'held'])->assertStatus(422);
        $this->patchJson("/api/clearance-signatures/{$signature->id}", ['status' => 'held', 'remarks' => 'Unpaid organization dues.'])
            ->assertOk()->assertJsonPath('status', 'held');

        $this->patchJson("/api/clearance-signatures/{$signature->id}", ['status' => 'cleared'])->assertStatus(409);
    }

    public function test_students_view_is_scoped_to_their_own_signatures(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $studentA = $this->user('STUDENT', $organization->id);
        $studentB = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($superAdmin);
        $this->postJson('/api/clearance-periods', [
            'academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['organization_treasurer'],
        ])->assertCreated();

        Sanctum::actingAs($studentA);
        $mine = $this->getJson('/api/clearances/mine')->assertOk()->json();
        $this->assertCount(1, $mine[0]['signatures']);

        Sanctum::actingAs($studentB);
        $mineB = $this->getJson('/api/clearances/mine')->assertOk()->json();
        $this->assertNotSame($mine, $mineB);
    }
}
