<?php

namespace Tests\Feature;

use App\Models\CashAdvance;
use App\Models\CashAdvanceRepayment;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use App\Services\FinancialReportPdfService;
use App\Services\HiusaAiService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A cash advance moves cash out and back in, but the money is lent, not spent
 * and not earned. It stays in the ledger, yet it must not count as income or
 * expense in a report or in the history the forecast learns from. A report
 * totals it in its own section instead.
 */
class CashAdvanceNotIncomeOrExpenseTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $approver;

    private User $departmentHead;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-10-06 10:00:00', 'Asia/Manila'));
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->approver = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->departmentHead = User::factory()->departmentHead()->create(['organization_id' => $this->organization->id]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function entry(string $type, string $amount, string $category, string $date = '2026-10-05'): Transaction
    {
        return Transaction::create([
            'organization_id' => $this->organization->id, 'recorded_by' => $this->admin->school_id, 'budget_id' => null,
            'event_id' => null, 'payer_id' => null, 'type' => $type, 'amount' => $amount, 'category' => $category,
            'description' => $category.' entry', 'transaction_date' => $date,
        ]);
    }

    /** A cash advance taken through the real flow, so its ledger entries are linked to it. Returns [release entry, repayment entry or null]. */
    private function advance(string $amount, ?string $repaid = null): array
    {
        Sanctum::actingAs($this->admin);
        $id = $this->postJson('/api/cash-advances', ['amount' => $amount, 'purpose' => 'Venue deposit'])->assertCreated()->json('id');
        Sanctum::actingAs($this->approver);
        $this->patchJson("/api/cash-advances/{$id}/approve")->assertOk();
        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/cash-advances/{$id}/release")->assertOk();
        $repayment = null;
        if ($repaid !== null) {
            $this->postJson("/api/cash-advances/{$id}/repayments", ['amount' => $repaid])->assertOk();
            $repayment = Transaction::findOrFail(CashAdvanceRepayment::where('cash_advance_id', $id)->value('ledger_transaction_id'));
        }

        return [Transaction::findOrFail(CashAdvance::findOrFail($id)->release_transaction_id), $repayment];
    }

    /** Income 1000, expense 250, a hand-typed "Cash Advance" expense of 75, and a real cash advance of 500 repaid by 200. */
    private function seedOctober(): void
    {
        $this->entry('income', '1000.00', 'Membership');
        $this->entry('expense', '250.00', 'Supplies');
        $this->entry('expense', '75.00', 'Cash Advance');
        $this->advance('500.00', '200.00');
    }

    private function generate(string $documentType = 'financial_report'): TestResponse
    {
        Sanctum::actingAs($this->admin);

        return $this->postJson('/api/financial-reports/generate', [
            'document_type' => $documentType, 'report_type' => 'custom', 'period_start' => '2026-10-01', 'period_end' => '2026-10-31',
            'signatories' => ['treasurer' => 'Taylor Treasurer', 'president' => 'Pat President', 'adviser' => 'Alex Adviser', 'sbo_adviser' => 'Sam SBO Adviser'],
        ])->assertCreated();
    }

    private function pdfHtml(int $reportId): string
    {
        $report = FinancialReport::with('organization')->findOrFail($reportId);

        return app(FinancialReportPdfService::class)->html(
            $report,
            $report->savedTransactions()->map(fn (array $row) => new Transaction($row)),
            (float) $report->opening_balance_snapshot,
        );
    }

    public function test_a_report_keeps_cash_advances_out_of_income_and_expense_and_totals_them_on_their_own(): void
    {
        $this->seedOctober();

        $generated = $this->generate()
            ->assertJsonPath('totals.income', 1000)
            ->assertJsonPath('totals.expense', 325)
            ->assertJsonPath('totals.balance', 675)
            ->assertJsonPath('totals.opening_balance', 0)
            ->assertJsonPath('totals.closing_balance', 375)
            ->assertJsonPath('cash_advances.released', 500)
            ->assertJsonPath('cash_advances.repayments', 200);

        $byCategory = collect($generated->json('by_category'))->mapWithKeys(fn (array $row) => [$row['category'].'|'.$row['type'] => $row['total']]);
        $this->assertSame(['Membership|income' => 1000, 'Supplies|expense' => 250, 'Cash Advance|expense' => 75], $byCategory->all());

        $this->assertSame(
            ['release', 'repayment'],
            collect($generated->json('transactions'))->whereNotNull('cash_advance')->pluck('cash_advance')->sort()->values()->all(),
        );
    }

    public function test_the_cash_advance_is_found_by_its_link_so_a_hand_typed_category_is_still_an_expense(): void
    {
        $this->seedOctober();

        $rows = collect($this->generate()->json('transactions'));
        $typed = $rows->first(fn (array $row) => $row['category'] === 'Cash Advance' && (float) $row['amount'] === 75.0);
        $released = $rows->first(fn (array $row) => $row['category'] === 'Cash Advance' && (float) $row['amount'] === 500.0);

        $this->assertNull($typed['cash_advance']);
        $this->assertSame('release', $released['cash_advance']);
    }

    public function test_the_saved_report_returns_the_same_totals_as_the_generated_one(): void
    {
        $this->seedOctober();
        $reportId = $this->generate()->json('report.id');

        $this->getJson("/api/financial-reports/{$reportId}")->assertOk()
            ->assertJsonPath('totals.income', 1000)
            ->assertJsonPath('totals.expense', 325)
            ->assertJsonPath('totals.balance', 675)
            ->assertJsonPath('totals.closing_balance', 375)
            ->assertJsonPath('cash_advances.released', 500)
            ->assertJsonPath('cash_advances.repayments', 200);
    }

    public function test_the_financial_report_pdf_lists_cash_advances_in_their_own_section_and_reconciles_the_balance(): void
    {
        $this->seedOctober();
        $html = $this->pdfHtml($this->generate()->json('report.id'));

        $this->assertMatchesRegularExpression('/TOTAL INFLOW<\/td><td class="amount">₱1,000\.00</', $html);
        $this->assertMatchesRegularExpression('/TOTAL OUTFLOW<\/td><td class="amount">₱325\.00</', $html);
        $this->assertMatchesRegularExpression('/BALANCE BEFORE CASH ADVANCES<\/td><td class="amount">₱675\.00</', $html);
        $this->assertStringContainsString('CASH ADVANCES', $html);
        $this->assertMatchesRegularExpression('/Cash advances released<\/td><td class="amount">₱500\.00</', $html);
        $this->assertMatchesRegularExpression('/Cash advance repayments<\/td><td class="amount">₱200\.00</', $html);
        $this->assertMatchesRegularExpression('/>BALANCE<\/td><td class="amount">₱375\.00</', $html);
    }

    public function test_the_income_statement_pdf_excludes_cash_advances_and_totals_them_below(): void
    {
        $this->seedOctober();
        $html = $this->pdfHtml($this->generate('income_statement')->json('report.id'));

        $this->assertMatchesRegularExpression('/TOTAL INCOME<\/td><td class="amount">₱1,000\.00</', $html);
        $this->assertMatchesRegularExpression('/TOTAL LESS<\/td><td class="amount">₱325\.00</', $html);
        $this->assertMatchesRegularExpression('/NET INCOME<\/td><td class="amount[^"]*">₱675\.00</', $html);
        $this->assertStringNotContainsString('Cash Advance Repayment', explode('CASH ADVANCES', $html)[0]);
        $this->assertMatchesRegularExpression('/Cash advances released<\/td><td class="amount">₱500\.00</', $html);
        $this->assertMatchesRegularExpression('/Cash advance repayments<\/td><td class="amount">₱200\.00</', $html);
    }

    public function test_a_report_without_cash_advances_has_no_cash_advance_section(): void
    {
        $this->entry('income', '1000.00', 'Membership');
        $this->entry('expense', '250.00', 'Supplies');
        $reportId = $this->generate()
            ->assertJsonPath('cash_advances.released', 0)
            ->assertJsonPath('cash_advances.repayments', 0)
            ->assertJsonPath('totals.closing_balance', 750)
            ->json('report.id');

        $this->assertStringNotContainsString('CASH ADVANCES', $this->pdfHtml($reportId));
    }

    public function test_a_report_saved_before_cash_advances_were_separated_keeps_its_saved_totals(): void
    {
        $report = FinancialReport::create([
            'organization_id' => $this->organization->id, 'report_type' => 'monthly', 'document_type' => 'financial_report', 'title' => 'Saved before the change',
            'source_transaction_ids' => [], 'opening_balance_snapshot' => 0, 'signatories' => [], 'submission_status' => 'draft',
            'generated_by' => $this->admin->school_id, 'generated_at' => now(),
            'transactions_snapshot' => [
                ['id' => 1, 'type' => 'income', 'category' => 'Membership', 'amount' => '1000.00', 'description' => 'Fees', 'transaction_date' => '2026-10-05'],
                ['id' => 2, 'type' => 'expense', 'category' => 'Cash Advance', 'amount' => '500.00', 'description' => 'Cash advance ADV-OLD', 'transaction_date' => '2026-10-06'],
            ],
        ]);

        Sanctum::actingAs($this->admin);
        $this->getJson("/api/financial-reports/{$report->id}")->assertOk()
            ->assertJsonPath('totals.income', 1000)
            ->assertJsonPath('totals.expense', 500)
            ->assertJsonPath('totals.closing_balance', 500)
            ->assertJsonPath('cash_advances.released', 0)
            ->assertJsonPath('cash_advances.repayments', 0);
    }

    public function test_the_approval_card_matches_the_report_and_names_the_cash_advances_beside_it(): void
    {
        $this->seedOctober();
        $reportId = $this->generate()->json('report.id');
        $this->postJson("/api/financial-reports/{$reportId}/submit")->assertOk();

        Sanctum::actingAs($this->departmentHead);
        $card = collect($this->getJson('/api/approval-requests?entity_type=financial_report')->assertOk()->json('data'))
            ->firstWhere('entity_id', $reportId)['summary'];

        $this->assertSame(1000.0, (float) $card['total_income']);
        $this->assertSame(325.0, (float) $card['total_expense']);
        $this->assertSame(675.0, (float) $card['net_balance']);
        $this->assertSame(500.0, (float) $card['cash_advances_released']);
        $this->assertSame(200.0, (float) $card['cash_advance_repayments']);
    }

    private function seedForecastHistory(): void
    {
        foreach (['2026-06', '2026-07', '2026-08', '2026-09'] as $index => $period) {
            $this->entry('income', (string) (100 * ($index + 1)), 'General', $period.'-10');
            $this->entry('expense', '50', 'General', $period.'-10');
        }
        // The advance goes out in a month with no other entry and comes back in September.
        [$release, $repayment] = $this->advance('5000.00', '5000.00');
        $release->update(['transaction_date' => '2026-05-10 12:00:00']);
        $repayment->update(['transaction_date' => '2026-09-10 12:00:00']);
    }

    public function test_the_php_forecast_fallback_learns_only_from_income_and_expense(): void
    {
        config(['services.hiusa_ai.enabled' => true, 'services.hiusa_ai.url' => 'http://127.0.0.1:8001', 'services.hiusa_ai.key' => 'integration-key']);
        Http::fake(['*' => fn () => throw new ConnectionException('Connection refused')]);
        $this->seedForecastHistory();

        Sanctum::actingAs($this->admin);
        $this->postJson('/api/forecasts/generate', ['months' => 12])->assertCreated()
            ->assertJsonPath('forecast_period', '2026-11')
            ->assertJsonPath('model_details.engine', 'php-fallback')
            ->assertJsonPath('model_details.populated_months', 4)
            ->assertJsonPath('model_details.sample_months', 4)
            ->assertJsonPath('predicted_income', '600.00')
            ->assertJsonPath('predicted_expense', '50.00');
    }

    public function test_the_php_fallback_matches_the_live_python_engine_on_a_ledger_that_holds_cash_advances(): void
    {
        config(['services.hiusa_ai.enabled' => true, 'services.hiusa_ai.url' => 'http://127.0.0.1:8001', 'services.hiusa_ai.key' => env('HIUSA_AI_SERVICE_KEY')]);
        $live = app(HiusaAiService::class)->financialForecast([
            ['period' => '2026-06', 'income' => 100, 'expense' => 50],
            ['period' => '2026-07', 'income' => 200, 'expense' => 50],
            ['period' => '2026-08', 'income' => 300, 'expense' => 50],
            ['period' => '2026-09', 'income' => 400, 'expense' => 50],
        ], '2026-11');
        if ($live === null || ($live['forecast_period'] ?? null) !== '2026-11') {
            $this->markTestSkipped('Live HIUSA AI service at '.config('services.hiusa_ai.url').' is not reachable or predates target_period.');
        }
        Http::fake(['*' => fn () => throw new ConnectionException('Connection refused')]);
        $this->seedForecastHistory();

        Sanctum::actingAs($this->admin);
        $response = $this->postJson('/api/forecasts/generate', ['months' => 12])->assertCreated()->assertJsonPath('model_details.engine', 'php-fallback');

        $this->assertSame(number_format($live['predicted_income'], 2, '.', ''), $response->json('predicted_income'));
        $this->assertSame(number_format($live['predicted_expense'], 2, '.', ''), $response->json('predicted_expense'));
        $this->assertSame($live['sample_months'], $response->json('model_details.sample_months'));
        $this->assertEqualsWithDelta($live['income_model']['r_squared'], $response->json('model_details.income.r_squared'), 0.0001);
    }

    public function test_the_ai_service_is_sent_the_same_history_without_cash_advances(): void
    {
        config(['services.hiusa_ai.enabled' => true, 'services.hiusa_ai.url' => 'http://127.0.0.1:8001', 'services.hiusa_ai.key' => 'integration-key']);
        $engineUrl = 'http://127.0.0.1:8001/api/v1/financial-forecast';
        Http::fake([
            $engineUrl => Http::response([
                'algorithm' => 'ordinary_least_squares', 'forecast_period' => '2026-11', 'sample_months' => 4,
                'predicted_income' => 600, 'predicted_expense' => 50, 'predicted_balance' => 550,
                'income_model' => ['slope' => 100, 'intercept' => 100, 'r_squared' => 1],
                'expense_model' => ['slope' => 0, 'intercept' => 50, 'r_squared' => 1],
            ]),
            '*' => Http::response([], 500),
        ]);
        $this->seedForecastHistory();

        Sanctum::actingAs($this->admin);
        $this->postJson('/api/forecasts/generate', ['months' => 12])->assertCreated()->assertJsonPath('model_details.engine', 'python-fastapi');

        Http::assertSent(fn (Request $request) => $request->url() === $engineUrl && $request['monthly_records'] == [
            ['period' => '2026-06', 'income' => 100, 'expense' => 50],
            ['period' => '2026-07', 'income' => 200, 'expense' => 50],
            ['period' => '2026-08', 'income' => 300, 'expense' => 50],
            ['period' => '2026-09', 'income' => 400, 'expense' => 50],
        ]);
    }
}
