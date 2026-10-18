<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\ComplianceRequirementType;
use App\Models\Event;
use App\Models\Grievance;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PartSixWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role, ?Organization $organization = null): User
    {
        return User::factory()->create(['role' => $role, 'organization_id' => $organization?->id ?? Organization::factory(), 'account_status' => 'active']);
    }

    public function test_category_migration_backfills_legacy_reports_and_rolls_back_without_removing_requirements(): void
    {
        $admin = $this->user('ADMIN');
        $type = ComplianceRequirementType::create(['academic_year' => '2026-2027', 'name' => ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT, 'deadline_at' => '2026-12-31', 'created_by' => $admin->school_id, 'template_url' => 'https://example.edu/format']);
        $migration = require database_path('migrations/2026_10_14_000002_categorize_compliance_requirements.php');
        $migration->down();
        $this->assertFalse(Schema::hasColumn('compliance_requirement_types', 'category'));
        $this->assertSame('https://example.edu/format', DB::table('compliance_requirement_types')->where('id', $type->id)->value('template_url'));
        $migration->up();
        $this->assertDatabaseHas('compliance_requirement_types', ['id' => $type->id, 'category' => 'semestral_report', 'template_url' => 'https://example.edu/format']);
    }

    public function test_semestral_catalog_samples_and_returned_resubmissions_are_separate_from_registration(): void
    {
        Storage::fake('local');
        $sao = $this->user('SUPER_ADMIN');
        $admin = $this->user('ADMIN');
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        Sanctum::actingAs($sao);
        $registration = $this->postJson('/api/compliance/requirement-types', ['academic_year' => $year->label, 'name' => 'Constitution', 'deadline_at' => '2026-12-31', 'template_url' => 'https://example.edu/constitution-format'])->assertCreated()->json('id');
        $report = $this->postJson('/api/compliance/requirement-types', ['academic_year' => $year->label, 'category' => 'semestral_report', 'name' => 'Semester activity narrative', 'allowed_extensions' => ['pdf'], 'deadline_at' => '2026-12-31', 'template_url' => 'https://example.edu/report-format'])->assertCreated()->json('id');
        $this->getJson('/api/compliance/requirement-types?category=semestral_report')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $report);
        $this->putJson('/api/compliance/requirement-types/'.$report.'/template-link', ['template_url' => 'https://example.edu/format'])->assertOk()->assertJsonPath('template_url', 'https://example.edu/format');
        $this->post('/api/compliance/requirement-types/'.$report.'/template', ['template' => UploadedFile::fake()->create('format.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('template_url', null);
        $this->putJson('/api/compliance/requirement-types/'.$report, ['name' => 'Semester evidence'])->assertOk()->assertJsonPath('category', 'semestral_report');
        $this->getJson('/api/organization-applications/requirements')->assertOk()->assertJsonCount(1, 'requirements')->assertJsonPath('requirements.0.id', $registration);
        $this->getJson('/api/organization-applications/requirements/'.$report.'/template')->assertNotFound();

        Sanctum::actingAs($admin);
        $this->getJson('/api/compliance/status?category=semestral_report')->assertOk()->assertJsonCount(1, 'organizations.requirements')->assertJsonPath('organizations.requirements.0.requirement_type_id', $report);
        $this->getJson('/api/compliance/requirement-types/'.$report.'/template')->assertOk();
        $this->post('/api/compliance/submissions', ['requirement_type_id' => $report, 'document' => UploadedFile::fake()->image('wrong.png')], ['Accept' => 'application/json'])->assertUnprocessable();
        $submission = $this->post('/api/compliance/submissions', ['requirement_type_id' => $report, 'document' => UploadedFile::fake()->create('first.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->assertCreated()->json('id');
        Sanctum::actingAs($this->user('ADMIN'));
        $this->getJson('/api/compliance/submissions/'.$submission.'/document')->assertNotFound();
        Sanctum::actingAs($sao);
        $this->patchJson('/api/compliance/submissions/'.$submission.'/review', ['status' => 'returned', 'remarks' => 'Use the prescribed headings.', 'submitted_at' => OrganizationComplianceSubmission::findOrFail($submission)->submitted_at->toIso8601String()])->assertOk();
        Sanctum::actingAs($admin);
        $this->getJson('/api/compliance/submissions/'.$submission.'/document')->assertOk();
        $this->post('/api/compliance/submissions', ['requirement_type_id' => $report, 'document' => UploadedFile::fake()->create('corrected.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('id', $submission)->assertJsonPath('status', 'submitted');
        $this->getJson('/api/compliance/submissions?category=organization')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/compliance/submissions?category=semestral_report')->assertOk()->assertJsonPath('total', 1);
    }

    public function test_requirement_categories_are_validated_and_only_sao_can_configure_them(): void
    {
        Sanctum::actingAs($this->user('SUPER_ADMIN'));
        $this->postJson('/api/compliance/requirement-types', ['academic_year' => '2026-2027', 'name' => 'Evidence', 'deadline_at' => '2026-12-31', 'category' => 'arbitrary'])->assertUnprocessable()->assertJsonValidationErrors('category');
        foreach (['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] as $role) {
            Sanctum::actingAs($this->user($role));
            $this->postJson('/api/compliance/requirement-types', ['category' => 'semestral_report'])->assertForbidden();
        }
    }

    public function test_ledger_semester_filter_selects_disjoint_periods_without_including_the_gap(): void
    {
        $admin = $this->user('ADMIN');
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $nextYear = AcademicYear::create(['label' => '2027-2028', 'starts_on' => '2027-08-01', 'ends_on' => '2028-05-31', 'is_current' => false]);
        $first = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        $third = AcademicSemester::create(['academic_year_id' => $nextYear->id, 'number' => 1, 'starts_on' => '2027-08-01', 'ends_on' => '2027-12-31', 'status' => 'upcoming']);
        foreach (['2026-09-01', '2027-02-01', '2027-09-01'] as $date) {
            Transaction::factory()->create(['organization_id' => $admin->organization_id, 'recorded_by' => $admin->school_id, 'budget_id' => null, 'transaction_date' => $date]);
        }
        Sanctum::actingAs($admin);
        $this->getJson('/api/transactions?'.http_build_query(['academic_semester_id' => json_encode([$first->id, $third->id])]))->assertOk()->assertJsonPath('total', 2);
        foreach (AcademicSemester::all() as $semester) {
            Event::factory()->create(['organization_id' => $admin->organization_id, 'created_by' => $admin->school_id, 'academic_semester_id' => $semester->id]);
        }
        $this->getJson('/api/events?'.http_build_query(['academic_semester_id' => json_encode([$first->id, $third->id])]))->assertOk()->assertJsonPath('total', 2);
    }

    public function test_multi_status_and_urgency_filters_are_combined_before_pagination_without_widening_organization_scope(): void
    {
        $admin = $this->user('ADMIN');
        $student = $this->user('STUDENT', $admin->organization);
        foreach (['submitted', 'under_review', 'resolved'] as $status) {
            Grievance::create(['organization_id' => $admin->organization_id, 'submitted_by' => $student->school_id, 'title' => $status, 'description' => 'Concern', 'category' => 'General', 'urgency' => 'High', 'status' => $status]);
        }
        Grievance::create(['organization_id' => $this->user('ADMIN')->organization_id, 'submitted_by' => $student->school_id, 'title' => 'Other organization', 'description' => 'Concern', 'category' => 'General', 'urgency' => 'High', 'status' => 'submitted']);
        Sanctum::actingAs($admin);
        $query = http_build_query(['status' => json_encode(['submitted', 'under_review']), 'urgency' => json_encode(['High', 'Critical']), 'per_page' => 1]);
        $first = $this->getJson('/api/grievances?'.$query)->assertOk()->assertJsonPath('total', 2)->assertJsonCount(1, 'data')->json('data.0.id');
        $second = $this->getJson('/api/grievances?'.$query.'&page=2')->assertOk()->assertJsonPath('total', 2)->json('data.0.id');
        $this->assertNotSame($first, $second);
        $this->getJson('/api/grievances?'.http_build_query(['status' => json_encode(['submitted', 'invalid'])]))->assertUnprocessable()->assertJsonValidationErrors('status');
        $this->getJson('/api/grievances?'.http_build_query(['addressed_to' => json_encode(['sao', 'sao'])]))->assertUnprocessable()->assertJsonValidationErrors('addressed_to');
        Sanctum::actingAs($student);
        $this->getJson('/api/grievances?'.$query)->assertOk()->assertJsonPath('total', 3);
    }

    public function test_multi_event_and_user_filters_preserve_scoping_and_single_value_contracts(): void
    {
        $admin = $this->user('ADMIN');
        foreach (['planning', 'approved', 'completed'] as $status) {
            Event::factory()->create(['organization_id' => $admin->organization_id, 'created_by' => $admin->school_id, 'status' => $status]);
        }
        $other = $this->user('ADMIN');
        Event::factory()->create(['organization_id' => $other->organization_id, 'created_by' => $other->school_id, 'status' => 'approved']);
        $this->user('STUDENT', $admin->organization);
        $this->user('SBO_OFFICER', $admin->organization);
        Sanctum::actingAs($admin);
        $this->getJson('/api/events?'.http_build_query(['status' => json_encode(['approved', 'completed']), 'per_page' => 1]))->assertOk()->assertJsonPath('total', 2)->assertJsonCount(1, 'data');
        $this->getJson('/api/events?status=approved')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/users?'.http_build_query(['role' => json_encode(['STUDENT', 'SBO_OFFICER']), 'account_status' => json_encode(['active', 'inactive'])]))->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/users?'.http_build_query(['role' => json_encode(['STUDENT', 'invalid'])]))->assertUnprocessable();
    }
}
