<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Budget;
use App\Models\FinancialReport;
use App\Models\FinancialSemester;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** A financial report covers one of the SAO's academic semesters; an Admin never makes a semester of their own. */
class FinancialSemesterTest extends TestCase
{
    use RefreshDatabase;

    private AcademicSemester $completed;

    private AcademicSemester $active;

    private AcademicSemester $upcoming;

    protected function setUp(): void
    {
        parent::setUp();
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $this->completed = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'completed']);
        $this->active = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
        $this->upcoming = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 3, 'starts_on' => '2027-06-01', 'ends_on' => '2027-07-31', 'status' => 'upcoming']);
    }

    private function signatories(): array
    {
        return ['treasurer' => 'T', 'president' => 'P', 'adviser' => 'A', 'sbo_adviser' => 'S'];
    }

    public function test_semester_report_takes_its_period_from_the_academic_semester(): void
    {
        $admin = User::factory()->admin()->create();
        Transaction::create(['organization_id' => $admin->organization_id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'category' => 'Dues', 'description' => 'Inside', 'amount' => 300, 'transaction_date' => '2027-02-10']);
        Transaction::create(['organization_id' => $admin->organization_id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'category' => 'Dues', 'description' => 'Outside', 'amount' => 700, 'transaction_date' => '2026-09-10']);
        Sanctum::actingAs($admin);

        $report = $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'semester',
            'academic_semester_id' => $this->active->id,
            'signatories' => $this->signatories(),
        ])->assertCreated()
            ->assertJsonPath('report.title', 'Financial Report - AY 2026-2027, 2nd Semester')
            ->assertJsonPath('report.financial_semester_id', null)
            ->assertJsonCount(1, 'transactions');
        $this->assertStringStartsWith('2027-01-01', $report->json('report.period_start'));
        $this->assertStringStartsWith('2027-05-31', $report->json('report.period_end'));
    }

    public function test_a_completed_semester_can_be_reported_and_an_upcoming_one_cannot(): void
    {
        Sanctum::actingAs(User::factory()->admin()->create());

        $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'semester', 'document_type' => 'income_statement', 'academic_semester_id' => $this->completed->id,
            'signatories' => $this->signatories(),
        ])->assertCreated()->assertJsonPath('report.title', 'Income Statement - AY 2026-2027, 1st Semester');

        $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'semester', 'academic_semester_id' => $this->upcoming->id,
            'signatories' => $this->signatories(),
        ])->assertUnprocessable()->assertJsonValidationErrors('academic_semester_id');
        $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'semester', 'academic_semester_id' => 999999,
            'signatories' => $this->signatories(),
        ])->assertUnprocessable()->assertJsonValidationErrors('academic_semester_id');
    }

    public function test_the_old_financial_semester_field_no_longer_picks_a_period(): void
    {
        $admin = User::factory()->admin()->create();
        $legacy = FinancialSemester::create(['organization_id' => $admin->organization_id, 'name' => 'Old term', 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31']);
        Sanctum::actingAs($admin);

        $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'semester', 'financial_semester_id' => $legacy->id,
            'signatories' => $this->signatories(),
        ])->assertUnprocessable()->assertJsonValidationErrors('academic_semester_id');
    }

    public function test_semester_report_lists_the_budgets_that_belong_to_the_semester(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        foreach (['2026-09-01' => 'First term budget', '2027-02-01' => 'Second term budget'] as $createdOn => $title) {
            $budget = Budget::create(['organization_id' => $organization->id, 'title' => $title, 'allocated_amount' => 1000, 'remaining_amount' => 1000, 'warning_threshold' => 100, 'advice_generated_at' => now()]);
            $budget->forceFill(['created_at' => "{$createdOn} 08:00:00"])->save();
        }
        Sanctum::actingAs($admin);

        $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'semester', 'academic_semester_id' => $this->completed->id,
            'signatories' => $this->signatories(),
        ])->assertCreated()
            ->assertJsonCount(1, 'budget_advisories')
            ->assertJsonPath('budget_advisories.0.title', 'First term budget');
    }

    public function test_admin_can_no_longer_create_a_financial_semester(): void
    {
        Sanctum::actingAs(User::factory()->admin()->create());

        $this->postJson('/api/financial-semesters', ['name' => 'Mine', 'starts_on' => today()->subDay()->toDateString()])->assertNotFound();
        $this->getJson('/api/financial-semesters')->assertNotFound();
        $this->assertDatabaseCount('financial_semesters', 0);
    }

    public function test_a_report_made_from_an_old_financial_semester_is_still_readable(): void
    {
        $admin = User::factory()->admin()->create();
        $legacy = FinancialSemester::create(['organization_id' => $admin->organization_id, 'name' => 'Old term', 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31']);
        $report = FinancialReport::create([
            'organization_id' => $admin->organization_id, 'financial_semester_id' => $legacy->id, 'report_type' => 'semester',
            'title' => 'Financial Report - Old term', 'period_start' => '2026-08-01', 'period_end' => '2026-12-31',
            'summary_text' => 'Saved earlier.', 'source_transaction_ids' => [], 'signatories' => $this->signatories(),
            'submission_status' => 'draft', 'generated_by' => $admin->school_id, 'generated_at' => '2026-12-31 10:00:00',
        ]);
        Sanctum::actingAs($admin);

        $this->getJson('/api/financial-reports/'.$report->id)->assertOk()
            ->assertJsonPath('report.financial_semester_id', $legacy->id)
            ->assertJsonPath('report.title', 'Financial Report - Old term');
    }

    public function test_only_the_admin_generates_a_semester_report(): void
    {
        $admin = User::factory()->admin()->create();
        Sanctum::actingAs(User::factory()->officer()->create(['organization_id' => $admin->organization_id]));

        $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'semester', 'academic_semester_id' => $this->active->id,
            'signatories' => $this->signatories(),
        ])->assertForbidden();
    }
}
