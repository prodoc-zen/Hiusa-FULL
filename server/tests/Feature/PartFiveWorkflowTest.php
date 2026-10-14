<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\ClearanceSignature;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PartFiveWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role, Organization $organization): User
    {
        return User::factory()->create(['role' => $role, 'organization_id' => $organization->id, 'account_status' => 'active']);
    }

    private function college(): array
    {
        $college = College::create(['name' => fake()->unique()->company(), 'code' => fake()->unique()->lexify('????')]);
        $home = Organization::factory()->create(['organization_type' => 'COLLEGE', 'college_id' => $college->id]);
        $organization = Organization::factory()->create(['college_id' => $college->id]);

        return [$home, $organization];
    }

    public function test_department_head_signs_only_college_department_head_lines_and_can_reopen_them(): void
    {
        [$home, $org] = $this->college();
        [$otherHome, $otherOrg] = $this->college();
        $head = $this->user('DEPARTMENT_HEAD', $home);
        $otherHead = $this->user('DEPARTMENT_HEAD', $otherHome);
        $admin = $this->user('ADMIN', $org);
        $student = $this->user('STUDENT', $org);
        $this->user('STUDENT', $otherOrg);
        $sao = $this->user('SUPER_ADMIN', Organization::factory()->create());
        Sanctum::actingAs($sao);
        $period = $this->postJson('/api/clearance-periods', ['academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['organization', 'department_head', 'sao']])->assertCreated()->json('id');
        $line = ClearanceSignature::where('student_id', $student->school_id)->where('required_role', 'department_head')->firstOrFail();

        foreach ([$otherHead, $admin, $student, $sao] as $forbidden) {
            Sanctum::actingAs($forbidden);
            $this->patchJson("/api/clearance-signatures/{$line->id}", ['status' => 'cleared'])->assertForbidden();
        }
        Sanctum::actingAs($head);
        $this->getJson('/api/clearance-signatures')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.student_id', $student->school_id);
        $this->getJson("/api/clearance-periods/{$period}/students")->assertOk()->assertJsonCount(1, 'data');
        $this->patchJson("/api/clearance-signatures/{$line->id}", ['status' => 'cleared'])->assertOk();
        $this->patchJson("/api/clearance-signatures/{$line->id}", ['status' => 'pending'])->assertUnprocessable()->assertJsonValidationErrors('remarks');
        $this->patchJson("/api/clearance-signatures/{$line->id}", ['status' => 'pending', 'remarks' => 'Signed the wrong student.'])->assertOk()->assertJsonPath('status', 'pending')->assertJsonPath('signed_at', null);
        $this->assertDatabaseHas('audit_logs', ['action' => 'signature_reopened', 'record_id' => $line->id]);
        $this->assertDatabaseHas('notifications', ['user_id' => $student->school_id, 'reference_type' => 'clearance_signature', 'reference_id' => $line->id]);
        Sanctum::actingAs($sao);
        $this->deleteJson("/api/clearance-periods/{$period}")->assertConflict();
    }

    public function test_sao_reopens_its_cleared_line_and_unsupported_signatory_roles_are_rejected(): void
    {
        $org = Organization::factory()->create();
        $student = $this->user('STUDENT', $org);
        Sanctum::actingAs($this->user('SUPER_ADMIN', Organization::factory()->create()));
        $payload = ['academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['sao']];
        $this->postJson('/api/clearance-periods', [...$payload, 'required_roles' => ['organization_treasurer']])->assertUnprocessable();
        $this->postJson('/api/clearance-periods', $payload)->assertCreated();
        $line = ClearanceSignature::where('student_id', $student->school_id)->firstOrFail();
        $this->patchJson("/api/clearance-signatures/{$line->id}", ['status' => 'cleared'])->assertOk();
        $this->patchJson("/api/clearance-signatures/{$line->id}", ['status' => 'pending', 'remarks' => 'Incorrect record.'])->assertOk();
        Sanctum::actingAs($student);
        $this->getJson('/api/clearances/mine')->assertOk()->assertJsonPath('0.is_complete', false);
    }

    public function test_reminder_is_an_announcement_for_members_and_department_head_with_college_and_role_boundaries(): void
    {
        [$home, $org] = $this->college();
        [$otherHome, $otherOrg] = $this->college();
        $head = $this->user('DEPARTMENT_HEAD', $home);
        $otherHead = $this->user('DEPARTMENT_HEAD', $otherHome);
        $student = $this->user('STUDENT', $org);
        $admin = $this->user('ADMIN', $org);
        $officer = $this->user('SBO_OFFICER', $org);
        $outsider = $this->user('STUDENT', $otherOrg);
        $requirement = ComplianceRequirementType::create(['name' => 'Officer Roster', 'academic_year' => '2026-2027', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $head->school_id]);
        $url = "/api/compliance/organizations/{$org->id}/reminders";
        $payload = ['requirement_type_id' => $requirement->id, 'message' => 'Please upload the signed officer roster.'];
        foreach ([$otherHead, $student, $admin, $officer] as $forbidden) {
            Sanctum::actingAs($forbidden);
            $this->postJson($url, $payload)->assertForbidden();
        }
        Sanctum::actingAs($head);
        $this->postJson($url, [...$payload, 'message' => ''])->assertUnprocessable();
        $id = $this->postJson($url, $payload)->assertCreated()->assertJsonPath('recipient_count', 4)->json('id');
        foreach ([$head, $student, $admin, $officer] as $recipient) {
            $this->assertDatabaseHas('announcement_recipients', ['announcement_id' => $id, 'user_id' => $recipient->school_id]);
            $this->assertDatabaseHas('notifications', ['user_id' => $recipient->school_id, 'reference_type' => Announcement::class, 'reference_id' => $id]);
            Sanctum::actingAs($recipient);
            $this->getJson('/api/announcements?published_only=1')->assertOk()->assertJsonFragment(['id' => $id, 'announcement_source' => 'COMPLIANCE']);
        }
        Sanctum::actingAs($outsider);
        $this->getJson('/api/announcements?published_only=1')->assertOk()->assertJsonMissing(['id' => $id, 'announcement_source' => 'COMPLIANCE']);
        $this->assertDatabaseMissing('notifications', ['user_id' => $outsider->school_id, 'reference_id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'requirement_reminder_sent']);
        Sanctum::actingAs($this->user('SUPER_ADMIN', Organization::factory()->create()));
        $this->getJson('/api/system/announcements')->assertOk()->assertJsonFragment(['id' => $id, 'announcement_source' => 'COMPLIANCE']);
    }

    public function test_reminders_reach_an_active_alternate_organization_profile_and_skip_inactive_users(): void
    {
        [$home, $org] = $this->college();
        $head = $this->user('DEPARTMENT_HEAD', $home);
        $member = $this->user('STUDENT', Organization::factory()->create());
        $member->accountProfiles()->create(['organization_id' => $org->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active']);
        $inactive = $this->user('STUDENT', $org);
        $inactive->update(['account_status' => 'inactive']);
        $type = ComplianceRequirementType::create(['name' => 'Roster', 'academic_year' => '2026-2027', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $head->school_id]);
        Sanctum::actingAs($head);
        $id = $this->postJson("/api/compliance/organizations/{$org->id}/reminders", ['requirement_type_id' => $type->id, 'message' => 'Please submit the signed roster.'])->assertCreated()->assertJsonPath('recipient_count', 2)->json('id');
        $this->assertDatabaseHas('notifications', ['user_id' => $member->school_id, 'organization_id' => $org->id, 'reference_id' => $id]);
        $this->assertDatabaseMissing('announcement_recipients', ['user_id' => $inactive->school_id, 'announcement_id' => $id]);
    }

    public function test_file_search_filters_names_and_requirements_before_pagination_and_respects_college_scope(): void
    {
        Storage::fake('local');
        [$home, $org] = $this->college();
        [, $otherOrg] = $this->college();
        $head = $this->user('DEPARTMENT_HEAD', $home);
        $admin = $this->user('ADMIN', $org);
        $sao = $this->user('SUPER_ADMIN', Organization::factory()->create());
        $type = ComplianceRequirementType::create(['name' => 'Constitution', 'academic_year' => '2026-2027', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $sao->school_id]);
        Sanctum::actingAs($admin);
        $this->post('/api/compliance/submissions', ['requirement_type_id' => $type->id, 'document' => UploadedFile::fake()->create('signed-bylaws.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->assertCreated();
        Sanctum::actingAs($head);
        $this->getJson("/api/compliance/documents?organization_id={$org->id}&search=bylaws&per_page=1")->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.file_name', 'signed-bylaws.pdf');
        $this->getJson("/api/compliance/documents?organization_id={$org->id}&search=Constitution")->assertOk()->assertJsonPath('total', 1);
        $this->getJson("/api/compliance/documents?organization_id={$org->id}&search=missing")->assertOk()->assertJsonPath('total', 0);
        $this->getJson("/api/compliance/documents?organization_id={$otherOrg->id}&search=bylaws")->assertForbidden();
        $this->getJson("/api/compliance/submissions?organization_id={$org->id}&search=bylaws")->assertOk()->assertJsonPath('total', 1);
    }

    public function test_legacy_clearance_migration_preserves_original_signatures_and_rolls_back(): void
    {
        $migration = require database_path('migrations/2026_10_14_000001_normalize_clearance_signatories.php');
        $migration->down();
        $org = Organization::factory()->create();
        $student = $this->user('STUDENT', $org);
        $admin = $this->user('ADMIN', $org);
        $period = DB::table('clearance_periods')->insertGetId(['academic_year' => '2026-2027', 'title' => 'Legacy', 'required_roles' => json_encode(['organization_treasurer', 'adviser', 'sao']), 'created_by' => $admin->school_id]);
        foreach (['organization_treasurer', 'adviser', 'sao'] as $role) {
            DB::table('clearance_signatures')->insert(['clearance_period_id' => $period, 'student_id' => $student->school_id, 'organization_id' => $org->id, 'required_role' => $role, 'status' => 'cleared', 'signed_by' => $admin->school_id, 'signed_at' => now()]);
        }
        $migration->up();
        $this->assertSame(['organization', 'department_head', 'sao'], json_decode(DB::table('clearance_periods')->where('id', $period)->value('required_roles'), true));
        $this->assertSame(3, ClearanceSignature::count());
        $this->assertDatabaseHas('clearance_signatures', ['required_role' => 'department_head', 'status' => 'pending', 'signed_by' => null]);
        $this->assertSame(2, DB::table('clearance_signatures')->whereNotNull('retired_at')->count());
        $migration->down();
        $this->assertSame(3, DB::table('clearance_signatures')->count());
        $this->assertSame(['organization_treasurer', 'adviser', 'sao'], json_decode(DB::table('clearance_periods')->where('id', $period)->value('required_roles'), true));
        $migration->up();
    }
}
