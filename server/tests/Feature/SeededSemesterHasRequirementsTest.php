<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\EventRequirement;
use App\Models\Organization;
use App\Models\OrganizationApplicantGrant;
use App\Models\User;
use App\Services\Compliance\RegistrationRequirementCatalog;
use App\Services\SemesterDefaults;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A semester opened by the seeder, or activated without going through the SAO's semester creation, used to have no
 * requirement rows, so the student's "Apply for an organization" page said "Applications are closed".
 */
class SeededSemesterHasRequirementsTest extends TestCase
{
    use RefreshDatabase;

    private function sao(): User
    {
        return User::where('role', 'SUPER_ADMIN')->orderBy('school_id')->firstOrFail();
    }

    private function bareActiveSemester(): AcademicSemester
    {
        $sao = User::factory()->create(['role' => 'SUPER_ADMIN', 'account_status' => 'active']);
        $year = AcademicYear::create([
            'label' => '2026-2027', 'starts_on' => '2026-06-01', 'ends_on' => '2027-05-31', 'is_current' => true, 'created_by' => $sao->school_id,
        ]);

        return $year->semesters()->create([
            'number' => 1, 'starts_on' => '2026-06-01', 'ends_on' => '2026-12-31', 'status' => 'active', 'created_by' => $sao->school_id,
        ]);
    }

    private function registrationCount(AcademicSemester $semester): int
    {
        return ComplianceRequirementType::where('academic_semester_id', $semester->id)->where('category', 'organization')->count();
    }

    public function test_the_seeded_active_semester_has_registration_requirements_the_student_can_see(): void
    {
        Storage::fake('local');
        $this->seed(DatabaseSeeder::class);

        $semester = AcademicSemester::active();
        $this->assertNotNull($semester);
        $this->assertSame(count(RegistrationRequirementCatalog::NAMES), $this->registrationCount($semester));
        $this->assertSame($this->sao()->school_id, (int) ComplianceRequirementType::where('academic_semester_id', $semester->id)->value('created_by'));
        $this->assertGreaterThan(0, EventRequirement::where('academic_semester_id', $semester->id)->count());

        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $home = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE']);
        $student = User::factory()->student()->create(['organization_id' => $home->id]);
        OrganizationApplicantGrant::create(['college_id' => $college->id, 'user_school_id' => $student->school_id, 'granted_by' => $this->sao()->school_id]);
        Sanctum::actingAs($student);

        $response = $this->getJson('/api/my/organization-applications')->assertOk()
            ->assertJsonPath('can_apply', true)->assertJsonPath('academic_semester.id', $semester->id);
        $this->assertCount(count(RegistrationRequirementCatalog::NAMES), $response->json('requirements'));
    }

    public function test_filing_the_defaults_twice_does_not_duplicate_them(): void
    {
        $semester = $this->bareActiveSemester();
        $sao = $this->sao();

        app(SemesterDefaults::class)->create($semester, $sao->school_id);
        $before = [ComplianceRequirementType::count(), EventRequirement::count()];
        app(SemesterDefaults::class)->create($semester, $sao->school_id);

        $this->assertSame($before, [ComplianceRequirementType::count(), EventRequirement::count()]);
        $this->assertSame(['compliance' => 0, 'events' => 0], app(SemesterDefaults::class)->missing($semester));
    }

    public function test_the_command_files_the_requirements_of_a_bare_active_semester_once(): void
    {
        $semester = $this->bareActiveSemester();
        $this->assertSame(0, ComplianceRequirementType::where('academic_semester_id', $semester->id)->count());

        $this->artisan('hiusa:ensure-semester-requirements')->assertSuccessful();

        $names = RegistrationRequirementCatalog::NAMES;
        $this->assertSame(count($names), $this->registrationCount($semester));
        $this->assertSame(count($names), ComplianceRequirementType::where('academic_semester_id', $semester->id)->where('category', 'renewal')->count());
        $this->assertSame(count(ComplianceRequirementType::SEMESTRAL_REPORT_NAMES), ComplianceRequirementType::where('academic_semester_id', $semester->id)->where('category', 'semestral_report')->count());
        $this->assertSame(18, EventRequirement::where('academic_semester_id', $semester->id)->count());
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'semester_requirements_backfilled')->where('record_id', $semester->id)->count());
        $created = ComplianceRequirementType::where('academic_semester_id', $semester->id)->first();
        $this->assertSame('2026-2027', $created->academic_year);
        $this->assertSame('2026-12-31', $created->deadline_at->toDateString());

        $total = [ComplianceRequirementType::count(), EventRequirement::count()];
        $this->artisan('hiusa:ensure-semester-requirements')->assertSuccessful();
        $this->assertSame($total, [ComplianceRequirementType::count(), EventRequirement::count()]);
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'semester_requirements_backfilled')->count());
    }

    public function test_the_dry_run_creates_nothing(): void
    {
        $semester = $this->bareActiveSemester();

        $this->artisan('hiusa:ensure-semester-requirements', ['--dry-run' => true])
            ->expectsOutputToContain('Would create')->assertSuccessful();

        $this->assertSame(0, ComplianceRequirementType::where('academic_semester_id', $semester->id)->count());
        $this->assertSame(0, EventRequirement::where('academic_semester_id', $semester->id)->count());
        $this->assertSame(0, DB::table('audit_logs')->where('action', 'semester_requirements_backfilled')->count());
    }

    public function test_the_command_leaves_a_semester_that_already_has_requirements_alone(): void
    {
        $semester = $this->bareActiveSemester();
        $this->artisan('hiusa:ensure-semester-requirements')->assertSuccessful();
        ComplianceRequirementType::where('academic_semester_id', $semester->id)->where('name', 'VMGO')->delete();
        $total = ComplianceRequirementType::count();

        $this->artisan('hiusa:ensure-semester-requirements')->expectsOutputToContain('Nothing to do')->assertSuccessful();

        $this->assertSame($total, ComplianceRequirementType::count());
    }

    public function test_the_command_fails_clearly_when_no_active_sao_can_own_the_rows(): void
    {
        $semester = $this->bareActiveSemester();
        User::where('role', 'SUPER_ADMIN')->update(['account_status' => 'inactive']);

        $this->artisan('hiusa:ensure-semester-requirements')->assertFailed();

        $this->assertSame(0, ComplianceRequirementType::where('academic_semester_id', $semester->id)->count());
    }
}
