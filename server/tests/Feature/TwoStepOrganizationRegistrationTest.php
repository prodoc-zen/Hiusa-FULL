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
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class TwoStepOrganizationRegistrationTest extends TestCase
{
    use RefreshDatabase;

    private User $deptHead;
    private User $sao;
    private College $college;
    private AcademicSemester $semester;
    private ComplianceRequirementType $requirement;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');

        $this->college = College::create(['name' => 'College of Computing', 'code' => 'CCS', 'is_active' => true]);
        $collegeOrg = Organization::create([
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

        $this->deptHead = User::create([
            'school_id' => 10001,
            'first_name' => 'Dean',
            'last_name' => 'Computer',
            'email' => 'dean@ccs.edu',
            'role' => 'DEPARTMENT_HEAD',
            'organization_id' => $collegeOrg->id,
            'password_hash' => bcrypt('password'),
            'account_status' => 'active',
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

        $ay = AcademicYear::create([
            'label' => '2026-2027',
            'starts_on' => '2026-08-01',
            'ends_on' => '2027-05-31',
        ]);
        $this->semester = AcademicSemester::create([
            'academic_year_id' => $ay->id,
            'number' => 1,
            'starts_on' => '2026-08-01',
            'ends_on' => '2026-12-31',
            'status' => 'active',
        ]);

        $this->requirement = ComplianceRequirementType::create([
            'academic_semester_id' => $this->semester->id,
            'academic_year' => '2026-2027',
            'name' => 'Constitution and By-Laws',
            'category' => 'organization',
            'is_active' => true,
            'allowed_extensions' => ['pdf'],
            'deadline_at' => now()->addDays(30),
            'created_by' => $this->sao->school_id,
        ]);
    }

    public function test_2_step_registration_auto_provisions_admin_upon_sao_approval(): void
    {
        // STEP 1: Department Head registers an organization with founding admin details
        $response = $this->actingAs($this->deptHead)->post('/api/college/organizations', [
            'name' => 'Alliance of Code Masters',
            'acronym' => 'ACM',
            'description' => 'Coding guild',
            'admin_school_id' => 20240099,
            'admin_first_name' => 'Mark',
            'admin_last_name' => 'Zuckerberg',
            'admin_email' => 'mark@acm.org',
            'admin_position_title' => 'President',
            'files' => [
                $this->requirement->id => UploadedFile::fake()->create('constitution.pdf', 100, 'application/pdf'),
            ],
        ]);

        $response->assertCreated();
        $orgId = $response->json('id');
        $org = Organization::findOrFail($orgId);

        $this->assertSame('pending', $org->lifecycle_status);
        $this->assertNotNull($org->admin_payload);
        $this->assertSame(20240099, $org->admin_payload['school_id']);
        $this->assertSame('Mark', $org->admin_payload['first_name']);

        // STEP 2: SAO reviews and approves in 1 click
        $reviewRes = $this->actingAs($this->sao)->patchJson("/api/system/organizations/{$orgId}/review", [
            'decision' => 'approve',
            'submitted_at' => $org->submitted_at->toISOString(),
        ]);

        $reviewRes->assertOk();
        $org->refresh();

        $this->assertSame('active', $org->lifecycle_status);
        $this->assertTrue($org->is_active);

        // Prove Admin user is immediately auto-provisioned!
        $adminUser = User::where('school_id', 20240099)->first();
        $this->assertNotNull($adminUser, 'Admin user should be automatically provisioned upon SAO approval.');
        $this->assertSame('ADMIN', $adminUser->role);
        $this->assertSame($orgId, $adminUser->organization_id);
        $this->assertSame('active', $adminUser->account_status);
        $this->assertSame('mark@acm.org', $adminUser->email);

        // Verify account profile and position
        $profile = $adminUser->accountProfiles()->where('organization_id', $orgId)->first();
        $this->assertNotNull($profile);
        $this->assertSame('ADMIN', $profile->role);
        $this->assertSame('President', $profile->position_title);
    }

    public function test_sao_review_with_per_file_remarks_when_returning(): void
    {
        $regRes = $this->actingAs($this->deptHead)->post('/api/college/organizations', [
            'name' => 'Robotics Guild',
            'acronym' => 'ROBO',
            'files' => [
                $this->requirement->id => UploadedFile::fake()->create('cbl.pdf', 100, 'application/pdf'),
            ],
        ]);
        $orgId = $regRes->json('id');
        $org = Organization::findOrFail($orgId);
        $submission = OrganizationComplianceSubmission::where('organization_id', $orgId)->first();

        // SAO returns with per-file correction comment
        $returnRes = $this->actingAs($this->sao)->patchJson("/api/system/organizations/{$orgId}/review", [
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
