<?php

namespace Tests\Concerns;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Budget;
use App\Models\CashAdvance;
use App\Models\CashAdvanceRepayment;
use App\Models\Event;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

/** Small builders for the budget and event ledger tests: one organization, an admin, two semesters, events, budgets and ledger rows. */
trait BuildsLedgerFixtures
{
    private Organization $organization;

    private User $admin;

    private AcademicSemester $current;

    private AcademicSemester $earlier;

    private function setUpLedgerFixtures(): void
    {
        config(['performance.api_cache.enabled' => false]);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $this->earlier = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'completed']);
        $this->current = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($this->admin);
    }

    private function makeEvent(string $title, string $date, ?AcademicSemester $semester = null, ?Organization $organization = null): Event
    {
        return Event::create([
            'organization_id' => ($organization ?? $this->organization)->id,
            'academic_semester_id' => ($semester ?? $this->current)->id,
            'title' => $title,
            'start_time' => "{$date} 09:00:00",
            'end_time' => "{$date} 12:00:00",
            'status' => 'approved',
            'created_by' => $this->admin->id,
        ]);
    }

    private function makeBudget(string $title, string $status = 'approved', ?Event $event = null, string $allocated = '50000.00'): Budget
    {
        return Budget::create([
            'organization_id' => $this->organization->id, 'event_id' => $event?->id, 'title' => $title,
            'allocated_amount' => $allocated, 'remaining_amount' => $allocated, 'warning_threshold' => '1000.00',
            'submission_status' => $status, 'created_at' => '2027-02-01 08:00:00',
        ]);
    }

    private function makeEntry(string $type, string $amount, ?Budget $budget = null, ?Event $event = null, string $date = '2027-02-10', array $extra = []): Transaction
    {
        return Transaction::create([
            'organization_id' => $this->organization->id, 'recorded_by' => $this->admin->school_id,
            'budget_id' => $budget?->id, 'event_id' => $event?->id ?? $budget?->event_id, 'payer_id' => null,
            'type' => $type, 'amount' => $amount, 'category' => 'Supplies', 'description' => 'Ledger entry',
            'transaction_date' => "{$date} 10:00:00", ...$extra,
        ]);
    }

    private function archivedEntry(string $type, string $amount, ?Budget $budget = null, ?Event $event = null, string $date = '2027-02-11'): Transaction
    {
        return $this->makeEntry($type, $amount, $budget, $event, $date, [
            'archived_at' => now(), 'archived_by' => $this->admin->school_id, 'archive_reason' => 'Entered twice by mistake',
        ]);
    }

    /** A cash advance taken through the real flow, so its release and repayment rows are ledger movements that are not income or expense. */
    private function cashAdvanceMovements(string $amount, string $repaid, string $date = '2027-02-12'): void
    {
        $approver = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $id = $this->postJson('/api/cash-advances', ['amount' => $amount, 'purpose' => 'Venue deposit'])->assertCreated()->json('id');
        Sanctum::actingAs($approver);
        $this->patchJson("/api/cash-advances/{$id}/approve")->assertOk();
        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/cash-advances/{$id}/release")->assertOk();
        $this->postJson("/api/cash-advances/{$id}/repayments", ['amount' => $repaid])->assertOk();
        Transaction::whereKey(CashAdvance::findOrFail($id)->release_transaction_id)->update(['transaction_date' => "{$date} 10:00:00"]);
        Transaction::whereKey(CashAdvanceRepayment::where('cash_advance_id', $id)->value('ledger_transaction_id'))->update(['transaction_date' => "{$date} 10:00:00"]);
    }

    private function inSemester(AcademicSemester $semester): array
    {
        return ['X-Academic-Semester' => (string) $semester->id];
    }
}
