<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Finance\ApprovedFeeUsage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StudentFeeUsageTest extends TestCase
{
    use RefreshDatabase;

    private function row(int $id, string $type, float $amount, string $category, ?string $cashAdvance = null): array
    {
        return [
            'id' => $id, 'type' => $type, 'amount' => $amount, 'category' => $category,
            'description' => 'Secret '.$category.' note', 'receipt_reference' => 'OR-SECRET-'.$id,
            'transaction_date' => '2026-09-10', 'cash_advance' => $cashAdvance,
            'event' => null, 'budget' => null,
        ];
    }

    private function report(Organization $organization, string $status, array $rows, array $extra = []): FinancialReport
    {
        return FinancialReport::create([
            'organization_id' => $organization->id,
            'report_type' => 'custom',
            'document_type' => 'financial_report',
            'title' => $extra['title'] ?? 'Financial Report '.$status,
            'period_start' => '2026-08-01',
            'period_end' => '2026-10-31',
            'source_transaction_ids' => collect($rows)->pluck('id')->all(),
            'opening_balance_snapshot' => 100,
            'transactions_snapshot' => $rows,
            'custody_snapshot' => ['verified_collections' => 5000, 'recorded_remittances' => 4000],
            'signatories' => [['name' => 'Signatory Person', 'position' => 'Treasurer']],
            'submission_status' => $status,
            'sao_approved_at' => $status === 'approved' ? now() : null,
            'generated_by' => User::factory()->admin()->create(['organization_id' => $organization->id])->school_id,
            'generated_at' => now(),
            ...$extra,
        ]);
    }

    private function student(Organization $organization): User
    {
        return User::factory()->student()->create(['organization_id' => $organization->id]);
    }

    public function test_only_sao_approved_reports_of_the_students_own_organization_are_read(): void
    {
        $organization = Organization::factory()->create();
        $other = Organization::factory()->create();
        $rows = [$this->row(1, 'income', 1000, 'Membership fee'), $this->row(2, 'expense', 400, 'Events')];

        foreach (['draft', 'pending_department_head', 'pending_sao', 'rejected'] as $status) {
            $this->report($organization, $status, $rows);
        }
        $this->report($other, 'approved', [$this->row(3, 'income', 9999, 'Other org fee')], ['title' => 'Other org report']);
        $approved = $this->report($organization, 'approved', $rows, ['title' => 'Mine approved']);

        Sanctum::actingAs($this->student($organization));
        $response = $this->getJson('/api/student/fee-usage')->assertOk();

        $response->assertJsonPath('organization.id', $organization->id)
            ->assertJsonPath('organization.name', $organization->name)
            ->assertJsonCount(1, 'reports')
            ->assertJsonPath('reports.0.id', $approved->id)
            ->assertJsonPath('reports.0.title', 'Mine approved');
        $this->assertStringNotContainsString('Other org', $response->getContent());
    }

    public function test_approved_status_without_the_sao_approval_time_is_not_read(): void
    {
        $organization = Organization::factory()->create();
        $this->report($organization, 'approved', [$this->row(1, 'income', 10, 'Fee')], ['sao_approved_at' => null]);

        Sanctum::actingAs($this->student($organization));
        $this->getJson('/api/student/fee-usage')->assertOk()->assertJsonPath('reports', []);
    }

    public function test_totals_and_categories_come_from_the_saved_snapshot_not_the_live_ledger(): void
    {
        $organization = Organization::factory()->create();
        $this->report($organization, 'approved', [
            $this->row(1, 'income', 3000, 'Membership fee'),
            $this->row(2, 'income', 1000, 'Merchandise'),
            $this->row(3, 'expense', 1500, 'Events'),
            $this->row(4, 'expense', 500, 'Supplies'),
            $this->row(5, 'expense', 500, 'Events'),
        ]);
        Transaction::factory()->create(['organization_id' => $organization->id, 'type' => 'income', 'amount' => 777777, 'transaction_date' => '2026-09-01']);

        Sanctum::actingAs($this->student($organization));
        $report = $this->getJson('/api/student/fee-usage')->assertOk()->json('reports.0');

        $this->assertSame(['collected' => 4000, 'spent' => 2500, 'opening' => 100, 'advances' => 0, 'balance' => 1600], $report['totals']);
        $this->assertSame([
            ['category' => 'Events', 'amount' => 2000, 'share_percent' => 80],
            ['category' => 'Supplies', 'amount' => 500, 'share_percent' => 20],
        ], $report['spending']);
        $this->assertSame([
            ['category' => 'Membership fee', 'amount' => 3000],
            ['category' => 'Merchandise', 'amount' => 1000],
        ], $report['income']);
        $this->assertSame('Aug 1 to Oct 31, 2026', $report['period_label']);
        $this->assertSame('2026-08-01', $report['period_start']);
        $this->assertSame('2026-10-31', $report['period_end']);
        $this->assertNotNull($report['approved_at']);
    }

    public function test_an_approved_report_saved_before_snapshots_existed_is_not_shown_to_students(): void
    {
        $organization = Organization::factory()->create();
        $ledger = Transaction::factory()->create(['organization_id' => $organization->id, 'type' => 'income', 'amount' => 2500, 'transaction_date' => '2026-09-10']);
        $legacy = $this->report($organization, 'approved', [], ['title' => 'Legacy report']);
        $legacy->forceFill([
            'source_transaction_ids' => [$ledger->id], 'transactions_snapshot' => null, 'opening_balance_snapshot' => null,
        ])->save();
        $current = $this->report($organization, 'approved', [$this->row(9, 'income', 10, 'Fee')], ['title' => 'Current report', 'sao_approved_at' => now()->subDay()]);

        Sanctum::actingAs($this->student($organization));
        $this->getJson('/api/student/fee-usage')->assertOk()
            ->assertJsonCount(1, 'reports')->assertJsonPath('reports.0.id', $current->id);
        $this->getJson('/api/student/fee-usage?report_id='.$legacy->id)->assertOk()->assertJsonPath('reports', []);
        $this->assertSame('approved', $legacy->fresh()->submission_status);
    }

    public function test_remittances_and_cash_advances_are_never_income_or_spending(): void
    {
        $organization = Organization::factory()->create();
        $this->report($organization, 'approved', [
            $this->row(1, 'income', 2000, 'Membership fee'),
            $this->row(2, 'expense', 500, 'Events'),
            $this->row(3, 'expense', 900, 'Cash advance', 'release'),
            $this->row(4, 'income', 300, 'Cash advance repayment', 'repayment'),
        ]);

        Sanctum::actingAs($this->student($organization));
        $report = $this->getJson('/api/student/fee-usage')->assertOk()->json('reports.0');

        $this->assertSame(2000, $report['totals']['collected']);
        $this->assertSame(500, $report['totals']['spent']);
        $this->assertSame(100 + 2000 - 500 + 300 - 900, $report['totals']['balance']);
        $this->assertSame(-600, $report['totals']['advances']);
        $this->assertSame($report['totals']['balance'], $report['totals']['opening'] + $report['totals']['collected'] - $report['totals']['spent'] + $report['totals']['advances']);
        $this->assertSame([['category' => 'Events', 'amount' => 500, 'share_percent' => 100]], $report['spending']);
        $this->assertSame([['category' => 'Membership fee', 'amount' => 2000]], $report['income']);
        $this->assertStringNotContainsString('Cash advance', json_encode($report));
        $this->assertStringNotContainsString('4000', json_encode($report));
    }

    public function test_the_response_carries_no_rows_people_or_documents(): void
    {
        $organization = Organization::factory()->create();
        $report = $this->report($organization, 'approved', [$this->row(1, 'income', 1000, 'Membership fee'), $this->row(2, 'expense', 200, 'Events')], [
            'supporting_documents' => [['name' => 'receipts-secret.pdf', 'path' => 'x/y.pdf', 'mime_type' => 'application/pdf', 'size' => 1]],
            'letterhead_path' => 'letterheads/secret.png',
            'letter_details' => ['subject' => 'Secret subject'],
        ]);
        $student = $this->student($organization);

        Sanctum::actingAs($student);
        $response = $this->getJson('/api/student/fee-usage')->assertOk();
        $body = $response->getContent();

        foreach (['Secret', 'OR-SECRET', 'Signatory Person', 'receipts-secret', 'letterhead', 'supporting_documents', 'signatories', 'transactions', 'description', (string) $report->generated_by, (string) $student->school_id, $student->first_name.' '.$student->last_name] as $leak) {
            $this->assertStringNotContainsString($leak, $body);
        }
        $this->assertEqualsCanonicalizing(
            ['id', 'title', 'period_label', 'period_start', 'period_end', 'approved_at', 'totals', 'spending', 'income'],
            array_keys($response->json('reports.0'))
        );
    }

    public function test_reports_are_listed_newest_approved_first_and_one_can_be_requested(): void
    {
        $organization = Organization::factory()->create();
        $older = $this->report($organization, 'approved', [$this->row(1, 'income', 10, 'Fee')], ['title' => 'Older', 'sao_approved_at' => now()->subMonth()]);
        $newer = $this->report($organization, 'approved', [$this->row(2, 'income', 20, 'Fee')], ['title' => 'Newer', 'sao_approved_at' => now()]);
        $draft = $this->report($organization, 'draft', [$this->row(3, 'income', 30, 'Fee')]);

        Sanctum::actingAs($this->student($organization));
        $this->getJson('/api/student/fee-usage')->assertOk()
            ->assertJsonPath('reports.0.id', $newer->id)
            ->assertJsonPath('reports.1.id', $older->id);
        $this->getJson('/api/student/fee-usage?report_id='.$older->id)->assertOk()
            ->assertJsonCount(1, 'reports')->assertJsonPath('reports.0.id', $older->id);
        $this->getJson('/api/student/fee-usage?report_id='.$draft->id)->assertOk()->assertJsonPath('reports', []);
    }

    public function test_a_semester_report_period_is_labelled_by_semester(): void
    {
        $organization = Organization::factory()->create();
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'completed']);
        $this->report($organization, 'approved', [$this->row(1, 'income', 10, 'Fee')], ['report_type' => 'semester', 'period_end' => '2026-12-31']);

        Sanctum::actingAs($this->student($organization));
        $this->getJson('/api/student/fee-usage')->assertOk()->assertJsonPath('reports.0.period_label', '1st Semester, AY 2026-2027');
    }

    public function test_a_period_across_two_years_names_both_dates(): void
    {
        $organization = Organization::factory()->create();
        $this->report($organization, 'approved', [$this->row(1, 'income', 10, 'Fee')], ['period_start' => '2026-11-01', 'period_end' => '2027-01-31']);

        Sanctum::actingAs($this->student($organization));
        $this->getJson('/api/student/fee-usage')->assertOk()->assertJsonPath('reports.0.period_label', 'Nov 1, 2026 to Jan 31, 2027');
    }

    public function test_an_approved_report_with_no_spending_has_zero_shares_and_empty_lists(): void
    {
        $organization = Organization::factory()->create();
        $this->report($organization, 'approved', []);

        Sanctum::actingAs($this->student($organization));
        $report = $this->getJson('/api/student/fee-usage')->assertOk()->json('reports.0');

        $this->assertSame(['collected' => 0, 'spent' => 0, 'opening' => 100, 'advances' => 0, 'balance' => 100], $report['totals']);
        $this->assertSame([], $report['spending']);
        $this->assertSame([], $report['income']);
    }

    public function test_an_organization_without_an_approved_report_gets_an_empty_list(): void
    {
        $organization = Organization::factory()->create();
        $this->report($organization, 'pending_sao', [$this->row(1, 'income', 10, 'Fee')]);

        Sanctum::actingAs($this->student($organization));
        $this->getJson('/api/student/fee-usage')->assertOk()
            ->assertJsonPath('organization.id', $organization->id)
            ->assertJsonPath('reports', []);
    }

    public function test_a_student_without_an_organization_gets_an_empty_list(): void
    {
        $this->assertSame(['organization' => null, 'reports' => []], app(ApprovedFeeUsage::class)->summaryFor(new User(['role' => 'STUDENT'])));
    }

    public function test_an_archived_organization_is_locked_out_exactly_like_the_student_statement_endpoint(): void
    {
        $organization = Organization::factory()->create();
        $this->report($organization, 'approved', [$this->row(1, 'income', 10, 'Fee')]);
        $student = $this->student($organization);
        Sanctum::actingAs($student);
        $this->getJson('/api/student/fee-usage')->assertOk()->assertJsonCount(1, 'reports');

        $organization->update(['is_active' => false, 'lifecycle_status' => 'archived']);

        $statement = $this->getJson('/api/invoices')->assertForbidden()->assertJsonPath('error_code', 'PROFILE_UNAVAILABLE');
        $this->getJson('/api/student/fee-usage')->assertForbidden()
            ->assertJsonPath('error_code', 'PROFILE_UNAVAILABLE')
            ->assertJsonPath('message', $statement->json('message'));
    }

    public function test_only_students_may_read_it_and_guests_are_refused(): void
    {
        $organization = Organization::factory()->create();
        $this->getJson('/api/student/fee-usage')->assertUnauthorized();

        foreach (['admin', 'officer'] as $state) {
            Sanctum::actingAs(User::factory()->{$state}()->create(['organization_id' => $organization->id]));
            $this->getJson('/api/student/fee-usage')->assertForbidden();
        }
    }

    public function test_the_report_id_filter_is_validated(): void
    {
        Sanctum::actingAs($this->student(Organization::factory()->create()));
        $this->getJson('/api/student/fee-usage?report_id=abc')->assertUnprocessable();
    }
}
