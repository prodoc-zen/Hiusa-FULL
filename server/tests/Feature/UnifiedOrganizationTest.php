<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\College;
use App\Models\EventRequirement;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UnifiedOrganizationTest extends TestCase
{
    use RefreshDatabase;

    private function unified(): Organization
    {
        return Organization::factory()->create(['is_university_wide' => true, 'college_id' => null, 'college' => null, 'parent_organization_id' => null]);
    }

    private function sao(): User
    {
        return User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]);
    }

    public function test_forward_migration_and_rollback_preserve_existing_organization_data(): void
    {
        $organization = Organization::factory()->create();
        $migration = require database_path('migrations/2026_10_20_000001_add_university_wide_organizations.php');
        $migration->down();
        $this->assertFalse(Schema::hasColumn('organizations', 'is_university_wide'));
        $this->assertDatabaseHas('organizations', ['id' => $organization->id, 'name' => $organization->name]);
        $migration->up();
        $this->assertFalse($organization->fresh()->is_university_wide);
    }

    public function test_sao_creates_a_unified_organization_without_creating_an_account_or_changing_existing_organizations(): void
    {
        Sanctum::actingAs($this->sao());
        $existing = Organization::factory()->create();
        $users = User::count();
        $id = $this->postJson('/api/system/unified-organizations', ['name' => 'University Student Council', 'acronym' => 'USC'])->assertCreated()
            ->assertJsonPath('is_university_wide', true)->assertJsonPath('college_id', null)
            ->assertJsonPath('lifecycle_status', 'active')->json('id');
        $this->assertFalse($existing->fresh()->is_university_wide);
        $this->assertSame($users, User::count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'unified_organization_created', 'record_id' => $id]);
        $this->getJson('/api/organizations')->assertOk()->assertJsonFragment(['id' => $id, 'name' => 'University Student Council']);
        $this->postJson('/api/system/unified-organizations', ['name' => 'University Student Council', 'acronym' => 'USC'])->assertUnprocessable()->assertJsonValidationErrors(['name', 'acronym']);
    }

    public function test_creation_is_sao_only_and_cannot_attach_a_college_or_change_the_system_role(): void
    {
        $payload = ['name' => 'University Volunteers', 'acronym' => 'UV'];
        foreach (['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] as $role) {
            Sanctum::actingAs(User::factory()->create(['role' => $role]));
            $this->postJson('/api/system/unified-organizations', $payload)->assertForbidden();
        }
        Sanctum::actingAs($this->sao());
        $this->postJson('/api/system/unified-organizations', [...$payload, 'college' => 'Any college', 'organization_type' => 'SYSTEM_ADMINISTRATION'])
            ->assertUnprocessable()->assertJsonValidationErrors(['college', 'organization_type']);
        $this->postJson('/api/system/unified-organizations', [...$payload, 'name' => ['invalid']])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->assertDatabaseMissing('organizations', ['name' => 'University Volunteers']);
    }

    public function test_unified_admin_can_invite_students_from_different_colleges_without_replacing_their_identity(): void
    {
        $organization = $this->unified();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $collegeOrganizations = [];
        foreach (['College of Computing', 'College of Nursing'] as $name) {
            $college = College::create(['name' => $name, 'is_active' => true]);
            $source = Organization::factory()->create(['college' => $name, 'college_id' => $college->id]);
            $collegeOrganizations[] = $source;
            $user = User::factory()->student()->create(['organization_id' => $source->id, 'department' => $name]);
            $password = $user->password_hash;
            Sanctum::actingAs($admin);
            $this->getJson('/api/account-profiles/candidates?organization_id='.$organization->id)->assertOk()->assertJsonFragment(['school_id' => $user->school_id]);
            $payload = ['organization_id' => $organization->id, 'school_id' => $user->school_id, 'role' => 'STUDENT'];
            $this->postJson('/api/account-profiles/invite', $payload)->assertCreated();
            $this->postJson('/api/account-profiles/invite', $payload)->assertConflict();
            $this->assertSame($source->id, $user->fresh()->organization_id);
            $this->assertSame($name, $user->fresh()->department);
            $this->assertSame($password, $user->fresh()->password_hash);
        }
        $collegeAdmin = User::factory()->admin()->create(['organization_id' => $collegeOrganizations[0]->id]);
        Sanctum::actingAs($collegeAdmin);
        $this->getJson('/api/account-profiles/candidates?organization_id='.$organization->id)->assertNotFound();
        $this->getJson('/api/account-profiles/candidates?organization_id='.$collegeOrganizations[1]->id)->assertNotFound();
        $this->assertSame(3, $organization->accountProfiles()->count());
    }

    public function test_archived_college_members_are_not_eligible_and_heads_do_not_gain_unified_oversight(): void
    {
        $organization = $this->unified();
        $college = College::create(['name' => 'Archived College', 'is_active' => false]);
        $source = Organization::factory()->create(['college_id' => $college->id, 'college' => $college->name]);
        $student = User::factory()->student()->create(['organization_id' => $source->id]);
        Sanctum::actingAs($this->sao());
        $this->postJson('/api/account-profiles/invite', ['organization_id' => $organization->id, 'school_id' => $student->school_id, 'role' => 'STUDENT'])
            ->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $legacy = User::factory()->student()->create(['organization_id' => Organization::factory()->create(['college_id' => null, 'college' => $college->name])->id]);
        $this->postJson('/api/account-profiles/invite', ['organization_id' => $organization->id, 'school_id' => $legacy->school_id, 'role' => 'STUDENT'])
            ->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $college->update(['is_active' => true]);
        $home = Organization::factory()->create(['college_id' => $college->id, 'college' => $college->name, 'organization_type' => 'COLLEGE']);
        $head = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $this->assertNotContains($organization->id, $head->scopedOrganizationIds());
        Sanctum::actingAs($head);
        $this->getJson('/api/compliance/documents?organization_id='.$organization->id)->assertForbidden();
    }

    public function test_sao_can_add_the_first_admin_after_creating_the_unified_organization(): void
    {
        $organization = $this->unified();
        Sanctum::actingAs($this->sao());
        $this->postJson('/api/system/admins', ['organization_id' => $organization->id, 'school_id' => 78112233, 'first_name' => 'Council', 'last_name' => 'Admin', 'email' => 'council@example.test', 'password' => 'Initial-Password-123!', 'password_confirmation' => 'Initial-Password-123!'])
            ->assertCreated()->assertJsonPath('must_change_password', true)->assertJsonPath('role', 'ADMIN')->assertJsonPath('department', null);
    }

    public function test_unified_budget_and_event_requests_go_to_sao_and_are_not_exposed_to_college_heads(): void
    {
        $organization = $this->unified();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($admin);
        $budget = $this->postJson('/api/budgets', ['title' => 'University assembly', 'allocated_amount' => 500, 'warning_threshold' => 50])->assertCreated()->assertJsonPath('submission_status', 'pending_sao')->json('id');
        $event = $this->postJson('/api/events', ['title' => 'University assembly', 'start_time' => now()->addWeek()->toDateTimeString(), 'end_time' => now()->addWeek()->addHour()->toDateTimeString()])->assertCreated()->json('id');
        $budgetRequest = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budget)->sole();
        $eventRequest = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event)->sole();
        $this->assertSame('SUPER_ADMIN', $budgetRequest->required_role);
        $this->assertSame('SUPER_ADMIN', $eventRequest->required_role);
        Sanctum::actingAs($this->sao());
        $this->getJson('/api/approval-requests')->assertOk()->assertJsonFragment(['id' => $budgetRequest->id]);
        $this->patchJson('/api/approval-requests/'.$budgetRequest->id, ['status' => 'approved'])->assertOk();
        $this->assertSame('approved', Budget::findOrFail($budget)->submission_status);
        $this->patchJson('/api/approval-requests/'.$eventRequest->id, ['status' => 'approved'])->assertOk();
        $this->assertDatabaseHas('events', ['id' => $event, 'status' => 'approved']);
    }

    public function test_unified_event_with_requirements_waits_for_complete_files_before_sao_review(): void
    {
        Storage::fake('local');
        $organization = $this->unified();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $requirement = EventRequirement::create(['name' => 'Event proposal', 'allowed_extensions' => ['pdf'], 'is_active' => true, 'is_optional' => false, 'venue_type' => 'all']);
        Sanctum::actingAs($admin);
        $id = $this->postJson('/api/events', ['title' => 'All colleges orientation', 'start_time' => now()->addWeek()->toDateTimeString(), 'end_time' => now()->addWeek()->addHour()->toDateTimeString()])
            ->assertCreated()->json('id');
        $this->getJson('/api/events')->assertOk()->assertJsonPath('data.0.approval_stage', 'awaiting_requirements');
        $this->assertDatabaseMissing('approval_requests', ['entity_type' => 'event', 'entity_id' => $id]);
        $this->post('/api/events/'.$id.'/submission', ['documents' => [$requirement->id => UploadedFile::fake()->create('proposal.pdf', 12, 'application/pdf')]], ['Accept' => 'application/json'])->assertOk();
        $this->assertDatabaseHas('approval_requests', ['entity_type' => 'event', 'entity_id' => $id, 'required_role' => 'SUPER_ADMIN', 'status' => 'pending']);
    }

    public function test_unified_elections_and_financial_reports_reach_sao_without_a_college_head_stage(): void
    {
        $organization = $this->unified();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($admin);
        $electionId = $this->postJson('/api/elections', ['title' => 'University council election', 'start_time' => now()->addWeek()->toDateTimeString(), 'end_time' => now()->addWeeks(2)->toDateTimeString()])->assertCreated()->json('id');
        $report = FinancialReport::create(['organization_id' => $organization->id, 'report_type' => 'monthly', 'title' => 'University council report', 'source_transaction_ids' => [], 'submission_status' => 'draft', 'generated_by' => $admin->school_id, 'generated_at' => now(), 'signatories' => ['treasurer' => 'Treasurer', 'president' => 'President', 'adviser' => 'Adviser', 'sbo_adviser' => 'SBO Adviser']]);
        $this->postJson('/api/financial-reports/'.$report->id.'/submit')->assertOk()->assertJsonPath('submission_status', 'pending_sao');
        $requests = ApprovalRequest::where('organization_id', $organization->id)->get();
        $this->assertCount(2, $requests);
        $this->assertTrue($requests->every(fn ($row) => $row->required_role === 'SUPER_ADMIN'));
        Sanctum::actingAs($this->sao());
        $this->getJson('/api/approval-requests?entity_type=election')->assertOk()->assertJsonPath('data.0.entity_id', $electionId);
        foreach ($requests as $approval) {
            $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])->assertOk();
        }
        $this->assertSame('approved', $report->fresh()->submission_status);
        $this->assertDatabaseHas('elections', ['id' => $electionId, 'status' => 'upcoming']);
    }
}
