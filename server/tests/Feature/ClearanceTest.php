<?php

namespace Tests\Feature;

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

    public function test_holding_a_signature_requires_a_reason_and_a_held_line_can_still_be_cleared_but_cleared_is_terminal(): void
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

        // A held line is not stuck: the dues get paid, so it can still be cleared.
        $this->patchJson("/api/clearance-signatures/{$signature->id}", ['status' => 'cleared'])
            ->assertOk()->assertJsonPath('status', 'cleared');

        // Cleared is terminal - it cannot be reopened.
        $this->patchJson("/api/clearance-signatures/{$signature->id}", ['status' => 'held', 'remarks' => 'Reopen attempt.'])->assertStatus(409);
    }

    public function test_admin_and_sbo_officer_can_list_clearance_periods_but_only_super_admin_can_open_one(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $officer = $this->user('SBO_OFFICER', $organization->id);
        Sanctum::actingAs($superAdmin);
        $this->postJson('/api/clearance-periods', [
            'academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['organization_treasurer'],
        ])->assertCreated();

        Sanctum::actingAs($admin);
        $this->getJson('/api/clearance-periods')->assertOk()->assertJsonCount(1, 'data');
        $this->postJson('/api/clearance-periods', [
            'academic_year' => '2027-2028', 'title' => 'Blocked', 'required_roles' => ['sao'],
        ])->assertForbidden();

        Sanctum::actingAs($officer);
        $this->getJson('/api/clearance-periods')->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_clearance_period_students_endpoint_paginates_and_supports_name_and_id_search(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $studentA = User::factory()->create(['role' => 'STUDENT', 'organization_id' => $organization->id, 'account_status' => 'active', 'first_name' => 'Alice', 'last_name' => 'Santos']);
        $studentB = User::factory()->create(['role' => 'STUDENT', 'organization_id' => $organization->id, 'account_status' => 'active', 'first_name' => 'Bianca', 'last_name' => 'Cruz']);
        Sanctum::actingAs($superAdmin);
        $periodId = $this->postJson('/api/clearance-periods', [
            'academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['organization_treasurer'],
        ])->assertCreated()->json('id');

        Sanctum::actingAs($admin);
        $this->getJson("/api/clearance-periods/{$periodId}/students?per_page=1")
            ->assertOk()->assertJsonPath('per_page', 1)->assertJsonCount(1, 'data');

        $searchResult = $this->getJson("/api/clearance-periods/{$periodId}/students?q=Alice")
            ->assertOk()->assertJsonCount(1, 'data')->json();
        $this->assertSame($studentA->school_id, $searchResult['data'][0]['student_id']);

        $idSearch = $this->getJson("/api/clearance-periods/{$periodId}/students?q={$studentB->school_id}")
            ->assertOk()->assertJsonCount(1, 'data')->json();
        $this->assertSame($studentB->school_id, $idSearch['data'][0]['student_id']);
    }

    public function test_student_pages_count_students_not_signature_lines(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        User::factory()->count(3)->create(['role' => 'STUDENT', 'organization_id' => $organization->id, 'account_status' => 'active']);
        Sanctum::actingAs($superAdmin);
        $periodId = $this->postJson('/api/clearance-periods', [
            'academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['organization_treasurer', 'organization_adviser'],
        ])->assertCreated()->json('id');

        Sanctum::actingAs($admin);
        $this->getJson("/api/clearance-periods/{$periodId}/students?per_page=2")
            ->assertOk()
            ->assertJsonPath('total', 3)
            ->assertJsonPath('last_page', 2)
            ->assertJsonCount(2, 'data');
        $this->getJson("/api/clearance-periods/{$periodId}/students?per_page=2&page=2")->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_opening_a_period_includes_a_profile_based_student_who_is_not_a_home_student(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $main = Organization::factory()->create();
        $child = Organization::factory()->create(['parent_organization_id' => $main->id]);
        // Home role is SBO_OFFICER in $main, not STUDENT anywhere at home,
        // but holds an active STUDENT account profile in $child.
        $officerWhoIsAlsoAStudentElsewhere = $this->user('SBO_OFFICER', $main->id);
        $officerWhoIsAlsoAStudentElsewhere->accountProfiles()->create([
            'organization_id' => $child->id, 'role' => 'STUDENT', 'account_status' => 'active',
        ]);

        Sanctum::actingAs($superAdmin);
        $periodId = $this->postJson('/api/clearance-periods', [
            'academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['organization_treasurer'],
        ])->assertCreated()->json('id');

        $this->assertDatabaseHas('clearance_signatures', [
            'clearance_period_id' => $periodId,
            'student_id' => $officerWhoIsAlsoAStudentElsewhere->school_id,
            'organization_id' => $child->id,
            'required_role' => 'organization_treasurer',
        ]);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $officerWhoIsAlsoAStudentElsewhere->school_id, 'organization_id' => $child->id,
            'reference_type' => 'clearance_period', 'reference_id' => $periodId,
        ]);
    }

    public function test_opening_a_period_gives_a_multi_org_student_only_their_home_organizations_row(): void
    {
        // clearance_signatures allows only one row per (period, student,
        // role), so a student who is an active STUDENT of two organizations
        // resolves to their home organization, not both.
        $superAdmin = $this->user('SUPER_ADMIN');
        $main = Organization::factory()->create();
        $child = Organization::factory()->create(['parent_organization_id' => $main->id]);
        $student = $this->user('STUDENT', $main->id);
        $student->accountProfiles()->create(['organization_id' => $child->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        Sanctum::actingAs($superAdmin);
        $periodId = $this->postJson('/api/clearance-periods', [
            'academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['organization_treasurer'],
        ])->assertCreated()->json('id');

        $this->assertDatabaseHas('clearance_signatures', [
            'clearance_period_id' => $periodId, 'student_id' => $student->school_id,
            'organization_id' => $main->id, 'required_role' => 'organization_treasurer',
        ]);
        $this->assertDatabaseCount('clearance_signatures', 1);
    }

    public function test_a_profile_based_officer_can_sign_clearance_lines_once_switched_to_that_organization(): void
    {
        // canSign() reads $user->role/organization_id off the authenticated
        // model, which UseAccountProfile keeps in sync with whichever
        // account profile the current token is switched to - so a
        // profile-based officer is already correctly recognized once they
        // are operating under that profile. This is a verification, not a
        // fix: it documents that signatory eligibility needed no change.
        $superAdmin = $this->user('SUPER_ADMIN');
        $main = Organization::factory()->create();
        $child = Organization::factory()->create(['parent_organization_id' => $main->id]);
        $childStudent = $this->user('STUDENT', $child->id);
        $officer = User::factory()->create(['role' => 'STUDENT', 'organization_id' => $main->id, 'account_status' => 'active', 'password_hash' => 'password123']);
        $childProfile = $officer->accountProfiles()->create(['organization_id' => $child->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active']);

        Sanctum::actingAs($superAdmin);
        $this->postJson('/api/clearance-periods', [
            'academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['organization_treasurer'],
        ])->assertCreated();
        $signature = ClearanceSignature::where('student_id', $childStudent->school_id)->firstOrFail();

        $token = $this->postJson('/api/login', ['school_id' => $officer->school_id, 'password' => 'password123'])->json('access_token');
        $this->app['auth']->forgetGuards();

        // Before switching profiles, the officer's active context is still
        // their home STUDENT identity in $main - forbidden.
        $this->withToken($token)->patchJson("/api/clearance-signatures/{$signature->id}", ['status' => 'cleared'])->assertForbidden();

        $this->withToken($token)->postJson('/api/user/profiles/'.$childProfile->id.'/switch')->assertOk();
        $this->withToken($token)->patchJson("/api/clearance-signatures/{$signature->id}", ['status' => 'cleared'])
            ->assertOk()->assertJsonPath('status', 'cleared');
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
