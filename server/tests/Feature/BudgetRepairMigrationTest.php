<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Event;
use App\Models\Transaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\Concerns\BuildsLedgerFixtures;
use Tests\TestCase;

/**
 * The repair that runs on deploy: no ledger entry stays linked to a budget that was never approved, the entry keeps
 * (or gains) its event, every unlink is written to the audit log, and every budget's remaining amount and risk are
 * recomputed from its entries that are not archived. Running it again changes nothing.
 */
class BudgetRepairMigrationTest extends TestCase
{
    use BuildsLedgerFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpLedgerFixtures();
    }

    private function runRepair(): void
    {
        (require base_path('database/migrations/2026_11_25_000002_repair_unapproved_budget_links_and_remaining.php'))->up();
    }

    public function test_entries_on_an_unapproved_budget_are_unlinked_keep_their_event_and_are_audited(): void
    {
        $sports = $this->makeEvent('Sports Fest 2024', '2027-03-05');
        $pending = $this->makeBudget('Sports Fest 2024 Budget', 'pending_department_head', $sports, '25000.00');
        $returned = $this->makeBudget('Returned Budget', 'rejected', null, '9000.00');
        $other = $this->makeEvent('Leadership Seminar 2024', '2027-02-05');
        $withoutEvent = $this->makeEntry('expense', '3800.00', $pending, null, '2027-03-01', ['event_id' => null]);
        $withOtherEvent = $this->makeEntry('income', '500.00', $returned, $other);
        $approved = $this->makeBudget('General Operations Fund');
        $kept = $this->makeEntry('expense', '100.00', $approved);

        $this->runRepair();

        $this->assertNull($withoutEvent->fresh()->budget_id);
        $this->assertSame($sports->id, $withoutEvent->fresh()->event_id);
        $this->assertNull($withOtherEvent->fresh()->budget_id);
        $this->assertSame($other->id, $withOtherEvent->fresh()->event_id);
        $this->assertSame($approved->id, $kept->fresh()->budget_id);

        $audits = AuditLog::where('action', 'budget_unlinked')->orderBy('record_id')->get();
        $this->assertSame([$withoutEvent->id, $withOtherEvent->id], $audits->pluck('record_id')->all());
        $first = $audits->first();
        $this->assertSame('financial_ledger', $first->module);
        $this->assertSame(Transaction::class, $first->record_type);
        $this->assertSame($pending->id, $first->old_values['budget_id']);
        $this->assertNull($first->new_values['budget_id']);
        $this->assertSame($sports->id, $first->new_values['event_id']);
        $this->assertSame('Budget not approved', $first->new_values['reason']);

        $this->assertSame('25000.00', $pending->fresh()->remaining_amount);
        $this->assertSame('9000.00', $returned->fresh()->remaining_amount);
    }

    public function test_a_budget_sent_back_for_re_approval_keeps_its_entries(): void
    {
        $sentBack = $this->makeBudget('General Operations Fund', 'pending_department_head', null, '50000.00');
        $spent = $this->makeEntry('expense', '13500.00', $sentBack);
        $never = $this->makeBudget('Sports Fest 2024 Budget', 'pending_department_head', null, '25000.00');
        $legacy = $this->makeEntry('expense', '3800.00', $never);
        $this->resubmittedAfterApproval($sentBack);
        $this->resubmittedAfterApproval($never, 'rejected');

        $this->runRepair();

        $this->assertSame($sentBack->id, $spent->fresh()->budget_id);
        $this->assertSame(0, AuditLog::where('action', 'budget_unlinked')->where('record_id', $spent->id)->count());
        $this->assertSame('36500.00', $sentBack->fresh()->remaining_amount);
        $this->assertNull($legacy->fresh()->budget_id);
        $this->assertSame(1, AuditLog::where('action', 'budget_unlinked')->where('record_id', $legacy->id)->count());
    }

    public function test_a_re_approval_budget_returned_once_still_keeps_its_entries(): void
    {
        $budget = $this->makeBudget('General Operations Fund', 'rejected', null, '50000.00');
        $spent = $this->makeEntry('expense', '13500.00', $budget);
        $approval = $this->resubmittedAfterApproval($budget);
        $this->resubmittedAfterApproval($budget, 'rejected', $approval);

        $this->runRepair();

        $this->assertSame($budget->id, $spent->fresh()->budget_id);
        $this->assertSame(0, AuditLog::where('action', 'budget_unlinked')->where('record_id', $spent->id)->count());
        $this->assertSame('36500.00', $budget->fresh()->remaining_amount);
    }

    private function resubmittedAfterApproval($budget, string $previousStatus = 'approved', ?ApprovalRequest $approval = null): ApprovalRequest
    {
        $approval ??= ApprovalRequest::create([
            'organization_id' => $budget->organization_id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'requested_by' => $this->admin->id,
            'required_role' => 'DEPARTMENT_HEAD',
        ]);
        AuditLog::create([
            'organization_id' => $budget->organization_id,
            'user_id' => $this->admin->id,
            'module' => 'approvals',
            'action' => 'resubmitted',
            'record_type' => ApprovalRequest::class,
            'record_id' => $approval->id,
            'old_values' => ['status' => $previousStatus],
            'new_values' => ['entity_type' => 'budget', 'entity_id' => $budget->id, 'status' => 'pending'],
            'created_at' => now(),
        ]);

        return $approval;
    }

    public function test_remaining_is_recomputed_for_every_budget_from_entries_that_are_not_archived(): void
    {
        $approved = $this->makeBudget('General Operations Fund');
        $approved->update(['remaining_amount' => '1.00', 'overspending_risk' => 'low', 'warning_threshold' => '70000.00']);
        $this->makeEntry('income', '43500.00', $approved);
        $this->makeEntry('expense', '13500.00', $approved);
        $this->archivedEntry('expense', '9999.00', $approved);
        $this->archivedEntry('income', '8888.00', $approved);

        $this->runRepair();

        $fresh = $approved->fresh();
        $this->assertSame('80000.00', $fresh->remaining_amount);
        $this->assertSame(Budget::overspendingRiskFor(80000.0, 70000.0), $fresh->overspending_risk);
    }

    public function test_running_it_twice_changes_nothing_more(): void
    {
        $pending = $this->makeBudget('Sports Fest 2024 Budget', 'pending_department_head', null, '25000.00');
        $this->makeEntry('expense', '3800.00', $pending);

        $this->runRepair();
        $audits = AuditLog::where('action', 'budget_unlinked')->count();
        $snapshot = Budget::orderBy('id')->get(['id', 'remaining_amount', 'overspending_risk'])->toArray();
        $this->runRepair();

        $this->assertSame(1, $audits);
        $this->assertSame($audits, AuditLog::where('action', 'budget_unlinked')->count());
        $this->assertSame($snapshot, Budget::orderBy('id')->get(['id', 'remaining_amount', 'overspending_risk'])->toArray());
    }

    public function test_the_seeded_demo_links_no_entry_to_a_budget_that_is_not_approved(): void
    {
        Storage::fake('local');
        $this->seed();

        $this->assertSame(0, Transaction::whereIn('budget_id', Budget::where('submission_status', '!=', 'approved')->select('id'))->count());
        $equipment = Transaction::where('description', 'like', 'Sports equipment and medals%')->firstOrFail();
        $this->assertNull($equipment->budget_id);
        $this->assertSame(Event::where('title', 'Sports Fest 2024')->value('id'), $equipment->event_id);
        $sportsBudget = Budget::where('title', 'Sports Fest 2024 Budget')->firstOrFail();
        $this->assertSame('25000.00', $sportsBudget->remaining_amount);
    }

    public function test_the_seeded_entries_named_for_an_event_carry_that_events_id(): void
    {
        Storage::fake('local');
        $this->seed();

        $expected = [
            'AVR rental for General Assembly%' => 'HIUSA General Assembly',
            'Snacks and drinks for General Assembly%' => 'HIUSA General Assembly',
            'Van rental for Leadership Seminar%' => 'Leadership Seminar 2024',
            'Sports equipment and medals%' => 'Sports Fest 2024',
            'Corporate sponsorship from TechPH - Sports Fest%' => 'Sports Fest 2024',
        ];
        foreach ($expected as $description => $title) {
            $entry = Transaction::where('description', 'like', $description)->firstOrFail();
            $this->assertSame(Event::where('title', $title)->value('id'), $entry->event_id, $description);
        }
        $this->assertSame(Budget::where('title', 'General Operations Fund')->value('id'), Transaction::where('description', 'like', 'AVR rental%')->value('budget_id'));
    }
}
