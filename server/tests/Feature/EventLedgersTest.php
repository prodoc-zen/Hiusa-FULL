<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsLedgerFixtures;
use Tests\TestCase;

/**
 * Every event has a ledger of its own, and the totals row adds the events and the entries with no event up to the
 * overall ledger: the same figures GET /transactions/summary gives for the same semester.
 */
class EventLedgersTest extends TestCase
{
    use BuildsLedgerFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpLedgerFixtures();
    }

    private function ledgers(array $headers = []): array
    {
        return $this->getJson('/api/transactions/event-ledgers', $headers)->assertOk()->json();
    }

    private function eventRow(array $ledgers, int $eventId): array
    {
        return collect($ledgers['data'])->firstWhere('event_id', $eventId);
    }

    public function test_every_event_of_the_semester_is_listed_with_its_own_figures_even_without_entries_or_a_budget(): void
    {
        $seminar = $this->makeEvent('Leadership Seminar 2024', '2027-02-05');
        $sports = $this->makeEvent('Sports Fest 2024', '2027-03-05');
        $quiet = $this->makeEvent('Induction and Recognition Ceremony', '2027-04-05');
        $sportsBudget = $this->makeBudget('Sports Fest 2024 Budget', 'approved', $sports, '25000.00');
        $this->makeEntry('income', '2000.00', null, $seminar);
        $this->makeEntry('expense', '750.50', null, $seminar);
        $this->makeEntry('expense', '3800.00', $sportsBudget);
        $this->makeEntry('income', '500.00', $sportsBudget);

        $ledgers = $this->ledgers();

        $this->assertCount(3, $ledgers['data']);
        $seminarRow = $this->eventRow($ledgers, $seminar->id);
        $this->assertSame('Leadership Seminar 2024', $seminarRow['title']);
        $this->assertSame('approved', $seminarRow['status']);
        $this->assertSame('2000.00', $seminarRow['income']);
        $this->assertSame('750.50', $seminarRow['expense']);
        $this->assertSame('1249.50', $seminarRow['net']);
        $this->assertSame(2, $seminarRow['transaction_count']);
        $this->assertNull($seminarRow['budget']);

        $sportsRow = $this->eventRow($ledgers, $sports->id);
        $this->assertSame('500.00', $sportsRow['income']);
        $this->assertSame('3800.00', $sportsRow['expense']);
        $this->assertSame('-3300.00', $sportsRow['net']);
        $this->assertSame([
            'id' => $sportsBudget->id, 'title' => 'Sports Fest 2024 Budget', 'submission_status' => 'approved', 'is_released' => true,
            'allocated_amount' => '25000.00', 'spent_amount' => '3800.00', 'remaining_amount' => '21700.00',
        ], $sportsRow['budget']);

        $quietRow = $this->eventRow($ledgers, $quiet->id);
        $this->assertSame(['0.00', '0.00', '0.00', 0], [$quietRow['income'], $quietRow['expense'], $quietRow['net'], $quietRow['transaction_count']]);
        $this->assertNull($quietRow['budget']);
    }

    public function test_an_unapproved_budget_is_shown_as_not_released_with_its_whole_allocation(): void
    {
        $event = $this->makeEvent('Sports Fest 2024', '2027-03-05');
        $pending = $this->makeBudget('Sports Fest 2024 Budget', 'pending_department_head', $event, '25000.00');

        $budget = $this->eventRow($this->ledgers(), $event->id)['budget'];

        $this->assertSame($pending->id, $budget['id']);
        $this->assertSame('pending_department_head', $budget['submission_status']);
        $this->assertFalse($budget['is_released']);
        $this->assertSame(['25000.00', '0.00', '25000.00'], [$budget['allocated_amount'], $budget['spent_amount'], $budget['remaining_amount']]);
    }

    public function test_entries_with_no_event_are_counted_apart_and_the_totals_add_everything_up(): void
    {
        $event = $this->makeEvent('Sports Fest 2024', '2027-03-05');
        $this->makeEntry('income', '1000.00', null, $event);
        $this->makeEntry('expense', '250.25', null, $event);
        $this->makeEntry('income', '300.00');
        $this->makeEntry('expense', '40.10');

        $ledgers = $this->ledgers();

        $this->assertSame(['300.00', '40.10', '259.90', 2], array_values($ledgers['unassigned']));
        $this->assertSame(['1300.00', '290.35', '1009.65', 4], array_values($ledgers['totals']));
        $sum = fn (string $key) => round(collect($ledgers['data'])->sum($key) + (float) $ledgers['unassigned'][$key], 2);
        $this->assertSame((float) $ledgers['totals']['income'], $sum('income'));
        $this->assertSame((float) $ledgers['totals']['expense'], $sum('expense'));
        $this->assertSame((float) $ledgers['totals']['net'], $sum('net'));
        $this->assertSame($ledgers['totals']['transaction_count'], collect($ledgers['data'])->sum('transaction_count') + $ledgers['unassigned']['transaction_count']);

        $summary = $this->getJson('/api/transactions/summary')->assertOk()->json();
        $this->assertSame((float) $ledgers['totals']['income'], (float) $summary['total_income']);
        $this->assertSame((float) $ledgers['totals']['expense'], (float) $summary['total_expense']);
        $this->assertSame((float) $ledgers['totals']['net'], (float) $summary['net_balance']);
    }

    public function test_archived_rows_and_other_semesters_stay_out_of_every_figure(): void
    {
        $event = $this->makeEvent('Sports Fest 2024', '2027-03-05');
        $older = $this->makeEvent('Orientation Week', '2026-09-05', $this->earlier);
        $this->makeEntry('expense', '100.00', null, $event);
        $this->archivedEntry('expense', '900.00', null, $event);
        $this->makeEntry('expense', '55.00', null, $older, '2026-09-06');

        $current = $this->ledgers();
        $this->assertSame([$event->id], collect($current['data'])->pluck('event_id')->all());
        $this->assertSame('100.00', $this->eventRow($current, $event->id)['expense']);
        $this->assertSame(1, $this->eventRow($current, $event->id)['transaction_count']);
        $this->assertSame('100.00', $current['totals']['expense']);

        $earlier = $this->ledgers($this->inSemester($this->earlier));
        $this->assertSame([$older->id], collect($earlier['data'])->pluck('event_id')->all());
        $this->assertSame('55.00', $earlier['totals']['expense']);
    }

    public function test_an_event_from_another_semester_that_has_entries_dated_in_this_one_is_listed_so_the_totals_still_add_up(): void
    {
        $older = $this->makeEvent('Orientation Week', '2026-09-05', $this->earlier);
        $this->makeEntry('income', '80.00', null, $older, '2027-02-10');

        $ledgers = $this->ledgers();

        $this->assertSame('80.00', $this->eventRow($ledgers, $older->id)['income']);
        $this->assertSame('80.00', $ledgers['totals']['income']);
    }

    public function test_the_summary_honours_the_event_filter(): void
    {
        $sports = $this->makeEvent('Sports Fest 2024', '2027-03-05');
        $other = $this->makeEvent('Leadership Seminar 2024', '2027-02-05');
        $this->makeEntry('income', '1000.00', null, $sports);
        $this->makeEntry('expense', '200.00', null, $sports);
        $this->makeEntry('income', '77.00', null, $other);

        $summary = $this->getJson("/api/transactions/summary?event_id={$sports->id}")->assertOk()->json();

        $this->assertSame(1000.0, (float) $summary['total_income']);
        $this->assertSame(200.0, (float) $summary['total_expense']);
        $this->assertSame(800.0, (float) $summary['net_balance']);
    }

    public function test_another_organizations_events_and_entries_are_never_listed(): void
    {
        $mine = $this->makeEvent('Sports Fest 2024', '2027-03-05');
        $otherOrganization = Organization::factory()->create();
        $theirs = $this->makeEvent('Their Fair', '2027-03-06', null, $otherOrganization);
        $this->makeEntry('income', '10.00', null, $mine);
        Transaction::create([
            'organization_id' => $otherOrganization->id, 'recorded_by' => $this->admin->school_id, 'event_id' => $theirs->id,
            'type' => 'income', 'amount' => '999.00', 'category' => 'Dues', 'description' => 'Not ours', 'transaction_date' => '2027-03-06 10:00:00',
        ]);

        $ledgers = $this->ledgers();

        $this->assertSame([$mine->id], collect($ledgers['data'])->pluck('event_id')->all());
        $this->assertSame('10.00', $ledgers['totals']['income']);
    }

    public function test_a_student_cannot_read_event_ledgers_and_a_department_head_can(): void
    {
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $this->organization->id]));
        $this->getJson('/api/transactions/event-ledgers')->assertForbidden();

        $this->makeEvent('Sports Fest 2024', '2027-03-05');
        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => $this->organization->id]));
        $this->getJson('/api/transactions/event-ledgers')->assertOk()->assertJsonCount(1, 'data');
    }
}
