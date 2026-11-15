<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AiOutput;
use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\User;
use App\Services\Ai\Evaluation\ReportCheckFixture;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\Support\ReportCheckFakeGenerator;
use Tests\TestCase;

/** The three report check routes: who may read the findings, the explanation and its record, and ignoring with a reason. */
class FinancialReportChecksEndpointTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    /** A draft report with a missing receipt (entry t1) and an overspent budget (b1). */
    private function seeded(): ReportCheckFixture
    {
        return ReportCheckFixture::seed([
            'id' => 'ep', 'period' => ['from' => '2026-08-01', 'to' => '2026-12-31'], 'opening_balance' => 0,
            'events' => [['key' => 'e1', 'title' => 'Foundation Day']],
            'budgets' => [['key' => 'b1', 'name' => 'Foundation Day budget', 'allocated_amount' => 1000, 'warning_threshold_percent' => 90, 'submission_status' => 'approved', 'event_key' => 'e1']],
            'transactions' => [['key' => 't1', 'type' => 'expense', 'amount' => 1200.50, 'category' => 'Supplies', 'transaction_date' => '2026-09-02', 'receipt_reference' => null, 'budget_key' => 'b1', 'event_key' => 'e1']],
            'report' => ['generated_at' => '2026-12-20T10:00:00', 'ledger_edited_after' => false],
        ]);
    }

    private function adminOf(ReportCheckFixture $fixture): User
    {
        return User::factory()->admin()->create(['organization_id' => $fixture->report->organization_id]);
    }

    private function answerWith(?callable $answer): ReportCheckFakeGenerator
    {
        $generator = new ReportCheckFakeGenerator($answer);
        $this->app->instance(TextGenerator::class, $generator);

        return $generator;
    }

    public function test_the_admin_reads_the_findings_with_their_plain_sentences(): void
    {
        $fixture = $this->seeded();
        Sanctum::actingAs($this->adminOf($fixture));

        $response = $this->getJson("/api/financial-reports/{$fixture->report->id}/checks")->assertOk();

        $this->assertSame(['budget_overspent', 'missing_receipt'], $response->json('findings.*.code'));
        $this->assertSame('high', $response->json('findings.0.severity'));
        $this->assertStringContainsString('Foundation Day budget', $response->json('findings.0.message'));
        $this->assertNull($response->json('findings.0.ignored'));
        $this->assertSame('missing_receipt:'.$fixture->report->source_transaction_ids[0], $response->json('findings.1.key'));
    }

    public function test_an_officer_of_the_organization_may_read_but_another_organization_and_a_student_may_not(): void
    {
        $fixture = $this->seeded();
        $url = "/api/financial-reports/{$fixture->report->id}/checks";

        Sanctum::actingAs(User::factory()->create(['organization_id' => $fixture->report->organization_id, 'role' => 'SBO_OFFICER']));
        $this->getJson($url)->assertOk();

        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => Organization::factory()]));
        $this->getJson($url)->assertNotFound();
        $this->postJson("{$url}/explain")->assertNotFound();

        Sanctum::actingAs(User::factory()->create(['organization_id' => $fixture->report->organization_id, 'role' => 'STUDENT']));
        $this->getJson($url)->assertForbidden();
        $this->postJson("{$url}/explain")->assertForbidden();
    }

    public function test_the_super_admin_sees_only_reports_that_were_submitted(): void
    {
        $fixture = $this->seeded();
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::factory()]));
        $url = "/api/financial-reports/{$fixture->report->id}/checks";

        $this->getJson($url)->assertNotFound();

        $fixture->report->forceFill(['submitted_at' => now()])->save();
        $this->getJson($url)->assertOk()->assertJsonCount(2, 'findings');
    }

    public function test_a_department_head_of_another_college_gets_not_found(): void
    {
        $fixture = $this->seeded();
        $fixture->report->forceFill(['submitted_at' => now()])->save();
        Sanctum::actingAs($this->makeCollegeHead($this->makeCollege('CCS')));

        $this->getJson("/api/financial-reports/{$fixture->report->id}/checks")->assertNotFound();
    }

    public function test_explain_returns_the_model_order_and_records_the_draft_for_the_outcome(): void
    {
        $fixture = $this->seeded();
        $this->answerWith(fn () => [
            'summary' => 'There are 2 things to check. Fix the budget first.',
            'items' => [
                ['key' => 'f1', 'sentence' => 'Foundation Day budget is over by PHP 200.50.'],
                ['key' => 'f2', 'sentence' => 'Add the receipt reference for the PHP 1,200.50 Supplies expense.'],
            ],
        ]);
        $admin = $this->adminOf($fixture);
        Sanctum::actingAs($admin);

        $response = $this->postJson("/api/financial-reports/{$fixture->report->id}/checks/explain")->assertOk();

        $this->assertSame('claude', $response->json('engine'));
        $this->assertCount(2, $response->json('items'));
        $output = AiOutput::findOrFail($response->json('ai_output_id'));
        $this->assertSame('report_check', $output->feature_type);
        $this->assertSame('pending', $output->decision_status);
        $this->assertSame($admin->school_id, (int) $output->requested_by);
        $this->assertSame($fixture->report->id, (int) $output->reference_id);

        $this->postJson("/api/ai/outputs/{$output->id}/outcome", ['final_text' => $response->json('text')])
            ->assertOk()->assertJsonPath('data.decision_status', 'accepted');
    }

    public function test_explain_without_a_model_answer_gives_the_rules_list(): void
    {
        $fixture = $this->seeded();
        $this->answerWith(null);
        Sanctum::actingAs($this->adminOf($fixture));

        $response = $this->postJson("/api/financial-reports/{$fixture->report->id}/checks/explain")->assertOk();

        $this->assertSame('template', $response->json('engine'));
        $this->assertCount(2, $response->json('items'));
        $this->assertStringContainsString('The checks found 2 things', $response->json('summary'));
        $this->assertSame('template', AiOutput::findOrFail($response->json('ai_output_id'))->structured_output['engine']);
    }

    public function test_the_model_never_sees_receipt_references_descriptions_or_ids(): void
    {
        $fixture = $this->seeded();
        $generator = $this->answerWith(null);
        Sanctum::actingAs($this->adminOf($fixture));

        $this->postJson("/api/financial-reports/{$fixture->report->id}/checks/explain")->assertOk();

        $sent = json_encode($generator->calls[0]['input']);
        $this->assertStringContainsString('Supplies', $sent);
        $this->assertStringNotContainsString('Entry t1', $sent);
        $this->assertStringNotContainsString('ep/', $sent);
        $this->assertStringNotContainsString('school_id', $sent);
    }

    public function test_ignoring_a_finding_needs_a_reason_and_writes_an_audit_row(): void
    {
        $fixture = $this->seeded();
        $admin = $this->adminOf($fixture);
        Sanctum::actingAs($admin);
        $url = "/api/financial-reports/{$fixture->report->id}/checks/ignore";
        $key = 'missing_receipt:'.$fixture->report->source_transaction_ids[0];

        $this->postJson($url, ['key' => $key])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->postJson($url, ['key' => 'missing_receipt:9999', 'reason' => 'It was paid in cash.'])->assertUnprocessable();

        $response = $this->postJson($url, ['key' => $key, 'reason' => 'Paid in cash, no receipt was issued.'])->assertOk();

        $ignored = collect($response->json('findings'))->firstWhere('key', $key);
        $this->assertSame('Paid in cash, no receipt was issued.', $ignored['ignored']['reason']);
        $audit = AuditLog::where('action', 'check_ignored')->firstOrFail();
        $this->assertSame('financial_reports', $audit->module);
        $this->assertSame($fixture->report->id, (int) $audit->record_id);
        $this->assertSame($admin->school_id, (int) $audit->user_id);
        $this->assertSame('Paid in cash, no receipt was issued.', $audit->new_values['reason']);

        $this->getJson("/api/financial-reports/{$fixture->report->id}/checks")->assertOk();
        $this->assertSame('Paid in cash, no receipt was issued.', collect($this->getJson("/api/financial-reports/{$fixture->report->id}/checks")->json('findings'))->firstWhere('key', $key)['ignored']['reason']);
    }

    public function test_an_ignored_finding_is_left_out_of_the_explanation(): void
    {
        $fixture = $this->seeded();
        $generator = $this->answerWith(null);
        Sanctum::actingAs($this->adminOf($fixture));
        $key = 'missing_receipt:'.$fixture->report->source_transaction_ids[0];
        $this->postJson("/api/financial-reports/{$fixture->report->id}/checks/ignore", ['key' => $key, 'reason' => 'Paid in cash.'])->assertOk();

        $response = $this->postJson("/api/financial-reports/{$fixture->report->id}/checks/explain")->assertOk();

        $this->assertCount(1, $response->json('items'));
        $this->assertCount(1, $generator->calls[0]['input']['findings']);
    }

    public function test_only_an_admin_of_the_organization_can_ignore(): void
    {
        $fixture = $this->seeded();
        $url = "/api/financial-reports/{$fixture->report->id}/checks/ignore";
        $body = ['key' => 'missing_receipt:'.$fixture->report->source_transaction_ids[0], 'reason' => 'Paid in cash.'];

        Sanctum::actingAs(User::factory()->create(['organization_id' => $fixture->report->organization_id, 'role' => 'SBO_OFFICER']));
        $this->postJson($url, $body)->assertForbidden();

        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => Organization::factory()]));
        $this->postJson($url, $body)->assertNotFound();
        $this->assertSame(0, AuditLog::where('action', 'check_ignored')->count());
    }
}
