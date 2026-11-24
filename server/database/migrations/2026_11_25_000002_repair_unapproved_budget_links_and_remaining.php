<?php

use App\Models\Transaction;
use App\Services\BudgetAdviceRules;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A budget that is not approved is not released, so nothing may be linked to it. Entries that were linked while it was
 * pending are unlinked (they keep their event, or take the budget's), each unlink is written to the audit log, and every
 * budget's remaining amount and risk are recomputed from its entries that are not archived. Safe to run again: a second
 * run finds nothing linked and recomputes the same figures.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->unlinkEntriesFromUnapprovedBudgets();
        $this->recomputeEveryBudget();
    }

    public function down(): void
    {
        // The unlink is not undone: the audit log keeps each entry's old budget, and an unapproved budget must stay empty.
    }

    private function unlinkEntriesFromUnapprovedBudgets(): void
    {
        $budgets = DB::table('budgets')
            ->where(fn ($query) => $query->whereNull('submission_status')->orWhere('submission_status', '!=', 'approved'))
            ->pluck('event_id', 'id');

        if ($budgets->isEmpty()) {
            return;
        }

        foreach ($budgets->keys()->chunk(500) as $ids) {
            DB::table('transactions')
                ->whereIn('budget_id', $ids->all())
                ->chunkById(200, function ($entries) use ($budgets) {
                    DB::transaction(function () use ($entries, $budgets) {
                        foreach ($entries as $entry) {
                            $this->unlink($entry, $budgets[$entry->budget_id]);
                        }
                    });
                });
        }
    }

    private function unlink(object $entry, mixed $budgetEventId): void
    {
        $eventId = $entry->event_id ?? $budgetEventId;
        $receiptNumber = $entry->receipt_number;

        // A receipt number is unique within an event, so an entry that joins an event keeps its number only when that number is free there.
        if ($eventId !== null && $entry->event_id === null && $receiptNumber !== null
            && DB::table('transactions')->where('event_id', $eventId)->where('receipt_number', $receiptNumber)->exists()) {
            $receiptNumber = (int) DB::table('transactions')->where('event_id', $eventId)->max('receipt_number') + 1;
        }

        DB::table('transactions')->where('id', $entry->id)->update([
            'budget_id' => null,
            'event_id' => $eventId,
            'receipt_number' => $receiptNumber,
        ]);

        DB::table('audit_logs')->insert([
            'organization_id' => $entry->organization_id,
            'user_id' => null,
            'module' => 'financial_ledger',
            'action' => 'budget_unlinked',
            'record_type' => Transaction::class,
            'record_id' => $entry->id,
            'old_values' => json_encode(['budget_id' => $entry->budget_id, 'event_id' => $entry->event_id, 'receipt_number' => $entry->receipt_number]),
            'new_values' => json_encode(['budget_id' => null, 'event_id' => $eventId, 'receipt_number' => $receiptNumber, 'reason' => 'Budget not approved']),
            'ip_address' => null,
            'created_at' => now(),
        ]);
    }

    private function recomputeEveryBudget(): void
    {
        DB::table('budgets')->orderBy('id')->chunkById(200, function ($budgets) {
            $totals = DB::table('transactions')
                ->whereIn('budget_id', $budgets->pluck('id')->all())
                ->whereNull('archived_at')
                ->selectRaw('budget_id')
                ->selectRaw("COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income")
                ->selectRaw("COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense")
                ->groupBy('budget_id')
                ->get()
                ->keyBy('budget_id');

            foreach ($budgets as $budget) {
                $row = $totals->get($budget->id);
                $remaining = round((float) $budget->allocated_amount + (float) ($row->income ?? 0) - (float) ($row->expense ?? 0), 2);

                DB::table('budgets')->where('id', $budget->id)->update([
                    'remaining_amount' => $remaining,
                    'overspending_risk' => BudgetAdviceRules::riskFor($remaining, (float) $budget->warning_threshold),
                ]);
            }
        });
    }
};
