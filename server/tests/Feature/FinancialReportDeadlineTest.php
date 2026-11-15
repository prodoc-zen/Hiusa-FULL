<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\FinancialReport;
use App\Models\FinancialReportDeadline;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/** The SAO sets the financial report due date, and the briefing and the Admin's submission then use it. */
class FinancialReportDeadlineTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private function superAdmin(): User
    {
        return User::factory()->superAdmin()->create(['organization_id' => Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'acronym' => 'SAO'])]);
    }

    private function briefingHasReportDue(User $user): bool
    {
        Sanctum::actingAs($user);

        return collect($this->getJson('/api/dashboard/briefing')->assertOk()->json('attention'))->contains('type', 'financial_report_due');
    }

    public function test_the_sao_sets_the_date_and_the_briefing_then_shows_report_due(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->assertFalse($this->briefingHasReportDue($admin));

        Sanctum::actingAs($this->superAdmin());
        $this->putJson('/api/financial-report-deadline', ['deadline_at' => now()->addDays(3)->toDateString()])
            ->assertOk()->assertJsonPath('data.deadline_at', now()->addDays(3)->toDateString());

        $this->assertTrue($this->briefingHasReportDue($admin));
        $this->assertSame(1, FinancialReportDeadline::count());
    }

    public function test_the_current_date_is_read_back_and_changed_in_place(): void
    {
        $sao = $this->superAdmin();
        Sanctum::actingAs($sao);
        $this->getJson('/api/financial-report-deadline')->assertOk()->assertJsonPath('data', null);

        $this->putJson('/api/financial-report-deadline', ['deadline_at' => now()->addDays(10)->toDateString()])->assertOk();
        $this->putJson('/api/financial-report-deadline', ['deadline_at' => now()->addDays(12)->toDateString()])->assertOk();

        $this->assertSame(1, FinancialReportDeadline::count());
        $this->getJson('/api/financial-report-deadline')->assertJsonPath('data.deadline_at', now()->addDays(12)->toDateString());
        $this->assertSame(['deadline_set', 'deadline_changed'], AuditLog::where('module', 'financial_reports')->orderBy('id')->pluck('action')->all());
        $this->assertSame($sao->school_id, (int) FinancialReportDeadline::firstOrFail()->set_by);
    }

    public function test_a_new_round_adds_a_row_so_earlier_submissions_no_longer_cover_it(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $this->putJson('/api/financial-report-deadline', ['deadline_at' => now()->addDays(10)->toDateString()])->assertOk();

        $this->putJson('/api/financial-report-deadline', ['deadline_at' => now()->addDays(40)->toDateString(), 'new_round' => true])->assertOk();

        $this->assertSame(2, FinancialReportDeadline::count());
        $this->getJson('/api/financial-report-deadline')->assertJsonPath('data.deadline_at', now()->addDays(40)->toDateString());
    }

    public function test_a_past_date_or_a_missing_date_is_refused(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->putJson('/api/financial-report-deadline', ['deadline_at' => now()->subDay()->toDateString()])->assertUnprocessable()->assertJsonValidationErrors('deadline_at');
        $this->putJson('/api/financial-report-deadline', [])->assertUnprocessable()->assertJsonValidationErrors('deadline_at');
        $this->assertSame(0, FinancialReportDeadline::count());
    }

    public function test_only_the_super_admin_may_read_or_set_it(): void
    {
        foreach (['ADMIN', 'SBO_OFFICER', 'STUDENT'] as $role) {
            Sanctum::actingAs(User::factory()->create(['organization_id' => Organization::factory(), 'role' => $role]));
            $this->getJson('/api/financial-report-deadline')->assertForbidden();
            $this->putJson('/api/financial-report-deadline', ['deadline_at' => now()->addDay()->toDateString()])->assertForbidden();
        }
        $this->assertSame(0, FinancialReportDeadline::count());
    }

    public function test_submitting_a_report_covers_the_open_round_so_the_briefing_stops_asking(): void
    {
        Storage::fake('local');
        $college = $this->makeCollege('CCS');
        $organization = $this->makeCollegeStudentOrganization($college);
        $this->makeCollegeHead($college);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $deadline = FinancialReportDeadline::create(['deadline_at' => now()->addDays(2)]);
        $report = FinancialReport::create([
            'organization_id' => $organization->id, 'report_type' => 'monthly', 'title' => 'Monthly Financial Report', 'summary_text' => 'Summary',
            'source_transaction_ids' => [], 'signatories' => ['treasurer' => 'A', 'president' => 'B', 'adviser' => 'C', 'sbo_adviser' => 'D'],
            'submission_status' => 'draft', 'generated_by' => $admin->school_id, 'generated_at' => now(),
        ]);
        $this->assertTrue($this->briefingHasReportDue($admin));

        $this->post("/api/financial-reports/{$report->id}/submit", ['supporting_documents' => [UploadedFile::fake()->create('receipts.pdf', 100, 'application/pdf')]], ['Accept' => 'application/json'])->assertOk();

        $this->assertSame($deadline->id, $report->fresh()->deadline_id);
        $this->assertFalse($this->briefingHasReportDue($admin));
    }
}
