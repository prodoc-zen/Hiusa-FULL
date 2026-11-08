<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Registrations a Department Head filed before applications moved to the grant flow stay pending until
 * the SAO decides them. Approving one never creates an account: a named founding administrator only
 * gets a profile when they already have one.
 */
class TwoStepOrganizationRegistrationTest extends TestCase
{
    use RefreshDatabase;

    private User $sao;

    private College $college;

    private Organization $collegeOrg;

    private ComplianceRequirementType $requirement;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');

        $this->college = College::create(['name' => 'College of Computing', 'code' => 'CCS', 'is_active' => true]);
        $this->collegeOrg = Organization::create([
            'name' => 'CCS Dean Office',
            'slug' => 'ccs-dean-office',
            'organization_type' => 'COLLEGE',
            'college_id' => $this->college->id,
            'is_active' => true,
        ]);
        $saoOrg = Organization::where('slug', 'student-affairs-office')->first() ?? Organization::create([
            'name' => 'Student Affairs Office',
            'slug' => 'student-affairs-office',
            'organization_type' => 'SYSTEM_ADMINISTRATION',
            'is_active' => true,
        ]);

        $this->sao = User::create([
            'school_id' => 10002,
            'first_name' => 'Director',
            'last_name' => 'SAO',
            'email' => 'sao@holycross.edu.ph',
            'role' => 'SUPER_ADMIN',
            'organization_id' => $saoOrg->id,
            'password_hash' => bcrypt('password'),
            'account_status' => 'active',
        ]);

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31']);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $this->requirement = ComplianceRequirementType::create([
            'academic_semester_id' => $semester->id,
            'academic_year' => '2026-2027',
            'name' => 'Constitution and By-Laws',
            'category' => 'organization',
            'is_active' => true,
            'allowed_extensions' => ['pdf'],
            'deadline_at' => now()->addDays(30),
            'created_by' => $this->sao->school_id,
        ]);
    }

    private function pending(string $name, string $acronym, ?array $adminPayload = null): Organization
    {
        $organization = Organization::create([
            'name' => $name,
            'slug' => str($name)->slug()->toString(),
            'acronym' => $acronym,
            'college' => $this->college->name,
            'college_id' => $this->college->id,
            'organization_type' => 'STUDENT_ORGANIZATION',
            'lifecycle_status' => 'pending',
            'is_active' => false,
            'admin_payload' => $adminPayload,
            'submitted_at' => now(),
        ]);
        $path = "compliance-submissions/{$organization->id}/constitution.pdf";
        Storage::disk('local')->put($path, '%PDF-1.4');
        OrganizationComplianceSubmission::create([
            'organization_id' => $organization->id, 'requirement_type_id' => $this->requirement->id, 'status' => 'submitted', 'file_path' => $path,
            'file_original_name' => 'constitution.pdf', 'mime_type' => 'application/pdf', 'file_size' => 8, 'submitted_by' => $this->sao->school_id, 'submitted_at' => now(),
        ]);

        return $organization;
    }

    private function approve(Organization $organization)
    {
        return $this->actingAs($this->sao)->patchJson("/api/system/organizations/{$organization->id}/review", [
            'decision' => 'approve',
            'submitted_at' => $organization->submitted_at->toISOString(),
        ]);
    }

    public function test_sao_approval_gives_an_existing_student_the_admin_profile_without_touching_their_login(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->collegeOrg->id, 'school_id' => 20240099]);
        $org = $this->pending('Alliance of Code Masters', 'ACM', ['school_id' => 20240099, 'first_name' => 'Mark', 'last_name' => 'Zuckerberg', 'email' => 'mark@acm.org', 'position_title' => 'President']);

        $this->approve($org)->assertOk();

        $org->refresh();
        $this->assertSame('active', $org->lifecycle_status);
        $this->assertTrue($org->is_active);
        $profile = $student->accountProfiles()->where('organization_id', $org->id)->first();
        $this->assertNotNull($profile);
        $this->assertSame('ADMIN', $profile->role);
        $this->assertSame('President', $profile->position_title);
        $this->assertDatabaseHas('sbo_positions', ['organization_id' => $org->id, 'role' => 'ADMIN', 'title' => 'President']);
        $login = DB::table('users')->where('school_id', 20240099)->first();
        $this->assertSame($this->collegeOrg->id, $login->organization_id);
        $this->assertSame('STUDENT', $login->role);
    }

    public function test_sao_approval_never_creates_an_account_for_a_founder_who_has_none(): void
    {
        $org = $this->pending('Alliance of Code Masters', 'ACM', ['school_id' => 20240098, 'first_name' => 'Mark', 'last_name' => 'Zuckerberg', 'email' => 'mark@acm.org', 'position_title' => 'President']);

        $this->approve($org)->assertOk();

        $this->assertDatabaseMissing('users', ['school_id' => 20240098]);
        $this->assertDatabaseMissing('users', ['email' => 'mark@acm.org']);
        $this->assertSame(0, DB::table('account_profiles')->where('organization_id', $org->id)->count());
    }

    public function test_sao_review_with_per_file_remarks_when_returning(): void
    {
        $org = $this->pending('Robotics Guild', 'ROBO');
        $submission = OrganizationComplianceSubmission::where('organization_id', $org->id)->first();

        $returnRes = $this->actingAs($this->sao)->patchJson("/api/system/organizations/{$org->id}/review", [
            'decision' => 'return',
            'remarks' => 'Please rectify the noted document.',
            'file_remarks' => [
                $submission->id => 'Article V Section 2 needs student council endorsement signature.',
            ],
            'submitted_at' => $org->submitted_at->toISOString(),
        ]);

        $returnRes->assertOk();
        $submission->refresh();

        $this->assertSame('returned', $submission->status);
        $this->assertSame('Article V Section 2 needs student council endorsement signature.', $submission->remarks);
    }
}
