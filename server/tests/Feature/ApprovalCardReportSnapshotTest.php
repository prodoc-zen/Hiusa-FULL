<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use App\Services\FinancialReportPdfService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The Department Head approves what the report says. The approval card must
 * show the totals saved with the report, the same rows its PDF and Excel file
 * are built from, not whatever the ledger adds up to by the time it is opened.
 */
class ApprovalCardReportSnapshotTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $departmentHead;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->departmentHead = User::factory()->departmentHead()->create(['organization_id' => $this->organization->id]);
    }

    private function entry(string $type, string $amount, string $description): Transaction
    {
        return Transaction::create([
            'organization_id' => $this->organization->id, 'recorded_by' => $this->admin->school_id, 'budget_id' => null,
            'event_id' => null, 'payer_id' => null, 'type' => $type, 'amount' => $amount, 'category' => 'General',
            'description' => $description, 'transaction_date' => '2026-08-15',
        ]);
    }

    private function signatories(): array
    {
        return ['treasurer' => 'Taylor Treasurer', 'president' => 'Pat President', 'adviser' => 'Alex Adviser', 'sbo_adviser' => 'Sam SBO Adviser'];
    }

    private function cardFor(int $reportId): array
    {
        Sanctum::actingAs($this->departmentHead);
        $card = collect($this->getJson('/api/approval-requests?entity_type=financial_report')->assertOk()->json('data'))
            ->firstWhere('entity_id', $reportId);
        $this->assertNotNull($card, 'The Department Head has no approval card for the report.');

        return $card['summary'];
    }

    public function test_the_card_shows_the_totals_saved_with_the_report_after_the_ledger_changes(): void
    {
        $income = $this->entry('income', '1000.00', 'Membership fees');
        $expense = $this->entry('expense', '250.00', 'Printing');
        Sanctum::actingAs($this->admin);
        $reportId = $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'custom', 'period_start' => '2026-08-01', 'period_end' => '2026-08-31', 'signatories' => $this->signatories(),
        ])->assertCreated()->assertJsonPath('totals.income', 1000)->assertJsonPath('totals.expense', 250)->json('report.id');
        $this->postJson("/api/financial-reports/{$reportId}/submit")->assertOk();

        $income->update(['amount' => '9999.00']);
        $expense->delete();

        $card = $this->cardFor($reportId);
        $this->assertSame(1000.0, (float) $card['total_income']);
        $this->assertSame(250.0, (float) $card['total_expense']);
        $this->assertSame(750.0, (float) $card['net_balance']);

        $rows = collect($this->getJson("/api/financial-reports/{$reportId}")->assertOk()->json('transactions'));
        $this->assertSame((float) $card['total_income'], (float) $rows->where('type', 'income')->sum('amount'));
        $this->assertSame((float) $card['total_expense'], (float) $rows->where('type', 'expense')->sum('amount'));

        $pdf = \Mockery::mock(FinancialReportPdfService::class);
        $pdf->shouldReceive('render')->once()->withArgs(function ($report, $pdfRows) use ($card) {
            $this->assertSame((float) $card['total_income'], (float) $pdfRows->where('type', 'income')->sum('amount'));
            $this->assertSame((float) $card['total_expense'], (float) $pdfRows->where('type', 'expense')->sum('amount'));

            return true;
        })->andReturn(['content' => '%PDF-test', 'filename' => 'report.pdf']);
        $this->app->instance(FinancialReportPdfService::class, $pdf);
        $this->get("/api/financial-reports/{$reportId}/pdf")->assertOk();
    }

    public function test_a_report_saved_before_ledger_snapshots_existed_still_shows_its_ledger_entries(): void
    {
        $income = $this->entry('income', '400.00', 'Old income');
        $expense = $this->entry('expense', '150.00', 'Old expense');
        $report = FinancialReport::create([
            'organization_id' => $this->organization->id, 'report_type' => 'monthly', 'title' => 'Report from before snapshots',
            'source_transaction_ids' => [$income->id, $expense->id], 'signatories' => $this->signatories(), 'submission_status' => 'pending_department_head',
            'generated_by' => $this->admin->school_id, 'generated_at' => now(), 'submitted_at' => now(),
        ]);
        ApprovalRequest::create([
            'organization_id' => $this->organization->id, 'entity_type' => 'financial_report', 'entity_id' => $report->id,
            'requested_by' => $this->admin->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending', 'requested_at' => now(),
        ]);

        $card = $this->cardFor($report->id);

        $this->assertSame(400.0, (float) $card['total_income']);
        $this->assertSame(150.0, (float) $card['total_expense']);
        $this->assertSame(250.0, (float) $card['net_balance']);
    }

    public function test_cards_for_reports_saved_before_snapshots_cost_the_same_queries_however_many_there_are(): void
    {
        config(['performance.api_cache.enabled' => false]);
        $foreign = Transaction::create([
            'organization_id' => Organization::factory()->create()->id, 'recorded_by' => $this->admin->school_id, 'budget_id' => null,
            'event_id' => null, 'payer_id' => null, 'type' => 'income', 'amount' => '777.00', 'category' => 'General',
            'description' => 'Another organization entry', 'transaction_date' => '2026-08-15',
        ]);
        $seed = function (int $number) use ($foreign): FinancialReport {
            $income = $this->entry('income', (string) (100 * $number).'.00', "Income {$number}");
            $expense = $this->entry('expense', (string) (10 * $number).'.00', "Expense {$number}");
            $report = FinancialReport::create([
                'organization_id' => $this->organization->id, 'report_type' => 'monthly', 'title' => "Legacy report {$number}",
                'source_transaction_ids' => [$income->id, $expense->id, $foreign->id], 'signatories' => $this->signatories(), 'submission_status' => 'pending_department_head',
                'generated_by' => $this->admin->school_id, 'generated_at' => now(), 'submitted_at' => now(),
            ]);
            ApprovalRequest::create([
                'organization_id' => $this->organization->id, 'entity_type' => 'financial_report', 'entity_id' => $report->id,
                'requested_by' => $this->admin->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending', 'requested_at' => now(),
            ]);

            return $report;
        };
        $queryCount = function (): int {
            $count = 0;
            DB::listen(function () use (&$count) {
                $count++;
            });
            Sanctum::actingAs($this->departmentHead);
            $this->getJson('/api/approval-requests?entity_type=financial_report')->assertOk();

            return $count;
        };

        $first = $seed(1);
        $before = $queryCount();
        $others = collect(range(2, 6))->map($seed);
        $after = $queryCount();

        $this->assertSame($before, $after);
        foreach ($others->prepend($first) as $index => $report) {
            $card = $this->cardFor($report->id);
            $this->assertSame((float) (100 * ($index + 1)), (float) $card['total_income']);
            $this->assertSame((float) (10 * ($index + 1)), (float) $card['total_expense']);
        }
    }
}
