<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Budget;
use App\Models\Collection;
use App\Models\Event;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Remittance;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/** Finance has no period picker of its own, so the top bar header alone must pick the semester every Finance read covers. */
class FinancePeriodFollowsTopBarTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private AcademicSemester $active;

    private AcademicSemester $upcoming;

    private Organization $org;

    private User $admin;

    private User $dean;

    private User $sao;

    protected function setUp(): void
    {
        parent::setUp();
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $next = AcademicYear::create(['label' => '2027-2028', 'starts_on' => '2027-08-01', 'ends_on' => '2028-05-31', 'is_current' => false]);
        $this->active = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
        $this->upcoming = AcademicSemester::create(['academic_year_id' => $next->id, 'number' => 1, 'starts_on' => '2027-08-01', 'ends_on' => '2027-12-31', 'status' => 'upcoming']);

        $college = $this->makeCollege('CIT');
        $this->dean = $this->makeCollegeHead($college);
        $this->sao = User::factory()->superAdmin()->create();
        $this->org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active']);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->org->id]);

        $activeEvent = $this->makeEvent('Active Fair', '2027-02-20', $this->active);
        $plannedEvent = $this->makeEvent('Planned Fair', '2027-09-20', $this->upcoming);

        $activeBudget = $this->makeBudget('Active Budget', $activeEvent->id, '2027-02-01');
        $plannedBudget = $this->makeBudget('Planned Budget', $plannedEvent->id, '2027-02-01');
        $this->makeBudget('Active General Budget', null, '2027-03-10');
        $this->makeBudget('Planned General Budget', null, '2027-09-10');

        $this->makeTransaction('Active Dues', $activeBudget, 'income', 500, '2027-02-20');
        $this->makeTransaction('Active Supplies', $activeBudget, 'expense', 120, '2027-03-05');
        $this->makeTransaction('Planned Dues', $plannedBudget, 'income', 900, '2027-09-20');

        $activeCollection = $this->makeCollection('COL-ACTIVE', '2027-02-21');
        $this->makeCollection('COL-PLANNED', '2027-09-21');
        $this->makeRemittance($activeCollection, 100, '2027-02-25');
        $this->makeRemittance($activeCollection, 40, '2027-09-25');

        $this->makeReport('Active Report', '2027-02-01', '2027-02-28');
        $this->makeReport('Planned Report', '2027-09-01', '2027-09-30');
    }

    private function makeEvent(string $title, string $date, AcademicSemester $semester): Event
    {
        return Event::create([
            'organization_id' => $this->org->id,
            'academic_semester_id' => $semester->id,
            'title' => $title,
            'start_time' => "{$date} 09:00:00",
            'end_time' => "{$date} 12:00:00",
            'status' => 'approved',
            'created_by' => $this->admin->id,
        ]);
    }

    private function makeBudget(string $title, ?int $eventId, string $createdOn): Budget
    {
        $budget = Budget::factory()->create([
            'organization_id' => $this->org->id,
            'event_id' => $eventId,
            'title' => $title,
            'allocated_amount' => 1000,
            'remaining_amount' => 1000,
            'warning_threshold' => 100,
            'submission_status' => 'approved',
        ]);
        $budget->forceFill(['created_at' => "{$createdOn} 08:00:00"])->save();

        return $budget;
    }

    private function makeTransaction(string $description, Budget $budget, string $type, float $amount, string $date): Transaction
    {
        return Transaction::factory()->create([
            'organization_id' => $this->org->id,
            'budget_id' => $budget->id,
            'recorded_by' => $this->admin->school_id,
            'type' => $type,
            'amount' => $amount,
            'description' => $description,
            'transaction_date' => "{$date} 10:00:00",
        ]);
    }

    private function makeCollection(string $reference, string $date): Collection
    {
        return Collection::create([
            'organization_id' => $this->org->id,
            'reference' => $reference,
            'amount_collected' => 300,
            'source' => 'Event fee',
            'status' => 'verified',
            'collected_by' => $this->admin->school_id,
            'collected_at' => "{$date} 09:00:00",
        ]);
    }

    private function makeRemittance(Collection $collection, float $amount, string $date): Remittance
    {
        return Remittance::create([
            'collection_id' => $collection->id,
            'reference' => 'REM-'.$collection->reference.'-'.$amount,
            'amount' => $amount,
            'remitted_by' => $this->admin->school_id,
            'remitted_at' => "{$date} 09:00:00",
            'status' => 'recorded',
        ]);
    }

    private function makeReport(string $title, string $start, string $end): FinancialReport
    {
        return FinancialReport::create([
            'organization_id' => $this->org->id,
            'report_type' => 'custom',
            'title' => $title,
            'period_start' => $start,
            'period_end' => $end,
            'generated_at' => '2027-06-01 08:00:00',
            'submitted_at' => '2027-06-02 08:00:00',
            'department_head_approved_at' => '2027-06-03 08:00:00',
        ]);
    }

    private function inPeriod(AcademicSemester $semester): array
    {
        return [AcademicSemester::PERIOD_HEADER => (string) $semester->id, 'Accept' => 'application/json'];
    }

    private function read(User $user, string $url, array $headers = [])
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user);

        return $this->getJson($url, $headers)->assertOk();
    }

    private function column(array $rows, string $key): array
    {
        return collect($rows)->pluck($key)->sort()->values()->all();
    }

    public function test_the_ledger_and_its_totals_follow_the_top_bar_semester(): void
    {
        foreach ([$this->admin, $this->dean] as $user) {
            $label = $user->role;
            $this->assertSame(['Active Dues', 'Active Supplies'], $this->column($this->read($user, '/api/transactions')->json('data'), 'description'), "{$label} default");
            $this->assertSame(['Planned Dues'], $this->column($this->read($user, '/api/transactions', $this->inPeriod($this->upcoming))->json('data'), 'description'), "{$label} planning");

            $this->assertEquals(500, $this->read($user, '/api/transactions/summary')->json('total_income'), "{$label} default totals");
            $planned = $this->read($user, '/api/transactions/summary', $this->inPeriod($this->upcoming));
            $this->assertEquals(900, $planned->json('total_income'), "{$label} planning totals");
            $this->assertEquals(0, $planned->json('total_expense'), "{$label} planning totals");
        }
    }

    public function test_an_explicit_semester_filter_still_wins_over_the_header(): void
    {
        $rows = $this->read($this->admin, '/api/transactions?academic_semester_id='.$this->upcoming->id, $this->inPeriod($this->active))->json('data');

        $this->assertSame(['Planned Dues'], $this->column($rows, 'description'));
    }

    public function test_budgets_follow_the_top_bar_semester_by_their_event_or_creation_date(): void
    {
        foreach ([$this->admin, $this->dean] as $user) {
            $this->assertSame(['Active Budget', 'Active General Budget'], $this->column($this->read($user, '/api/budgets')->json('data'), 'title'), "{$user->role} default");
            $this->assertSame(['Planned Budget', 'Planned General Budget'], $this->column($this->read($user, '/api/budgets', $this->inPeriod($this->upcoming))->json('data'), 'title'), "{$user->role} planning");
        }
    }

    public function test_financial_reports_follow_the_top_bar_semester(): void
    {
        foreach ([$this->admin, $this->dean, $this->sao] as $user) {
            $this->assertSame(['Active Report'], $this->column($this->read($user, '/api/financial-reports')->json('data'), 'title'), "{$user->role} default");
            $this->assertSame(['Planned Report'], $this->column($this->read($user, '/api/financial-reports', $this->inPeriod($this->upcoming))->json('data'), 'title'), "{$user->role} planning");
        }
    }

    public function test_collections_follow_the_top_bar_semester(): void
    {
        $this->assertSame(['COL-ACTIVE'], $this->column($this->read($this->admin, '/api/collections')->json(), 'reference'));
        $this->assertSame(['COL-PLANNED'], $this->column($this->read($this->admin, '/api/collections', $this->inPeriod($this->upcoming))->json(), 'reference'));
    }

    public function test_the_collections_remitted_card_follows_the_semester_while_the_running_balances_cover_all_of_them(): void
    {
        $default = $this->read($this->admin, '/api/financial-dashboard')->json();
        $planning = $this->read($this->admin, '/api/financial-dashboard', $this->inPeriod($this->upcoming))->json();

        $this->assertEquals(100, $default['total_remitted']);
        $this->assertEquals(40, $planning['total_remitted']);
        $this->assertEquals(140, $default['total_remitted'] + $planning['total_remitted']);
        $this->assertEquals($default['unremitted_collections'], $planning['unremitted_collections']);
        $this->assertEquals($default['available_funds'], $planning['available_funds']);
    }

    public function test_the_organization_space_events_and_finance_follow_the_top_bar_semester(): void
    {
        foreach ([$this->sao, $this->dean] as $user) {
            $label = $user->role;
            $url = "/api/college/organizations/{$this->org->id}/space";

            $default = $this->read($user, $url)->json();
            $this->assertSame(['Active Fair'], $this->column($default['events']['upcoming'], 'title'), "{$label} default events");
            $this->assertSame(1, $default['counts']['upcoming_events'], "{$label} default upcoming count");
            $this->assertSame(['Active Budget', 'Active General Budget'], $this->column($default['finance']['budgets'], 'title'), "{$label} default budgets");
            $this->assertSame(2, $default['finance']['approved_budget_count'], "{$label} default budget count");

            $planning = $this->read($user, $url, $this->inPeriod($this->upcoming))->json();
            $this->assertSame(['Planned Fair'], $this->column($planning['events']['upcoming'], 'title'), "{$label} planning events");
            $this->assertSame(1, $planning['counts']['upcoming_events'], "{$label} planning upcoming count");
            $this->assertSame(['Planned Budget', 'Planned General Budget'], $this->column($planning['finance']['budgets'], 'title'), "{$label} planning budgets");
        }
    }

    public function test_the_organization_space_ledger_follows_the_top_bar_semester(): void
    {
        foreach ([$this->sao, $this->dean] as $user) {
            $url = "/api/college/organizations/{$this->org->id}/space/transactions";

            $default = $this->read($user, $url)->json();
            $this->assertSame(['Active Dues', 'Active Supplies'], $this->column($default['data'], 'description'), "{$user->role} default");
            $this->assertEquals(500, $default['summary']['income']);
            $this->assertEquals(120, $default['summary']['expense']);

            $planning = $this->read($user, $url, $this->inPeriod($this->upcoming))->json();
            $this->assertSame(['Planned Dues'], $this->column($planning['data'], 'description'), "{$user->role} planning");
            $this->assertEquals(900, $planning['summary']['income']);
            $this->assertEquals(0, $planning['summary']['expense']);
        }
    }
}
