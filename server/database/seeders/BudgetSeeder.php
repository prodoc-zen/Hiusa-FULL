<?php

namespace Database\Seeders;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Database\Seeder;

class BudgetSeeder extends Seeder
{
    public function run(): void
    {
        $officer1 = User::where('school_id', 900001)->first();
        $assembly = Event::where('title', 'HIUSA General Assembly')->first();
        $sportsFest = Event::where('title', 'Sports Fest 2024')->first();

        $generalFund = Budget::create([
            'title' => 'General Operations Fund',
            'allocated_amount' => 50000.00,
            'warning_threshold' => 10000.00,
            'event_id' => null,
        ]);

        $sportsBudget = Budget::create([
            'title' => 'Sports Fest 2024 Budget',
            'allocated_amount' => 25000.00,
            'warning_threshold' => 5000.00,
            'event_id' => $sportsFest?->id,
        ]);

        $merchandiseFund = Budget::create([
            'title' => 'Merchandise Fund',
            'allocated_amount' => 30000.00,
            'warning_threshold' => 8000.00,
            'event_id' => null,
        ]);

        // Budgets have no approved_at column of their own - TransactionController
        // gates new postings solely on the latest ApprovalRequest for the budget
        // being 'approved'. The Sports Fest budget is left deliberately pending
        // (unapproved) so the Department Head Approvals screen has a real budget
        // to sign off on live, distinct from the event approval demo.
        $deptHead = User::where('organization_id', $officer1->organization_id)
            ->where('role', 'DEPARTMENT_HEAD')
            ->first();

        foreach ([
            ['budget' => $generalFund, 'approved' => true],
            ['budget' => $merchandiseFund, 'approved' => true],
            ['budget' => $sportsBudget, 'approved' => false],
        ] as $entry) {
            $approved = $entry['approved'];
            $budget = $entry['budget'];

            // withoutEvents() suppresses ApprovalRequest::booted()'s
            // notifyApprovers() and recordSubmissionAudit(), which would
            // otherwise fan out bogus notifications/audit rows during seeding.
            ApprovalRequest::withoutEvents(function () use ($budget, $officer1, $deptHead, $approved) {
                ApprovalRequest::create([
                    'organization_id' => $officer1->organization_id,
                    'entity_type' => 'budget',
                    'entity_id' => $budget->id,
                    'requested_by' => $officer1->school_id,
                    'required_role' => 'DEPARTMENT_HEAD',
                    'status' => $approved ? 'approved' : 'pending',
                    'reviewed_by' => $approved ? $deptHead?->school_id : null,
                    'requested_at' => $approved ? now()->subWeeks(3) : now()->subDays(2),
                    'reviewed_at' => $approved ? now()->subWeeks(3)->addHours(6) : null,
                ]);
            });
        }

        $transactions = [
            // Income entries
            [
                'budget_id' => $generalFund->id,
                'recorded_by' => $officer1->id,
                'type' => 'income',
                'category' => 'Org Fee',
                'amount' => 18500.00,
                'description' => 'First semester organizational fee collection - 37 members',
                'transaction_date' => now()->subMonths(3)->startOfMonth(),
            ],
            [
                'budget_id' => $generalFund->id,
                'recorded_by' => $officer1->id,
                'type' => 'income',
                'category' => 'Org Fee',
                'amount' => 15000.00,
                'description' => 'Second semester organizational fee collection - 30 members',
                'transaction_date' => now()->subMonths(1)->startOfMonth(),
            ],
            [
                'budget_id' => $generalFund->id,
                'recorded_by' => $officer1->id,
                'type' => 'income',
                'category' => 'Sponsorship',
                'amount' => 10000.00,
                'description' => 'Corporate sponsorship from TechPH - Sports Fest',
                'transaction_date' => now()->subMonths(2),
            ],
            [
                'budget_id' => $merchandiseFund->id,
                'recorded_by' => $officer1->id,
                'type' => 'income',
                'category' => 'Merchandise Sales',
                'amount' => 8750.00,
                'description' => 'First batch merchandise revenue - shirts and lanyards',
                'transaction_date' => now()->subWeeks(3),
            ],
            // Expense entries
            [
                'budget_id' => $generalFund->id,
                'recorded_by' => $officer1->id,
                'type' => 'expense',
                'category' => 'Venue',
                'amount' => 5000.00,
                'description' => 'AVR rental for General Assembly - 3 hours',
                'transaction_date' => now()->subWeeks(3),
            ],
            [
                'budget_id' => $generalFund->id,
                'recorded_by' => $officer1->id,
                'type' => 'expense',
                'category' => 'Food & Catering',
                'amount' => 4500.00,
                'description' => 'Snacks and drinks for General Assembly - 80 pax',
                'transaction_date' => now()->subWeeks(2),
            ],
            [
                'budget_id' => $generalFund->id,
                'recorded_by' => $officer1->id,
                'type' => 'expense',
                'category' => 'Printing',
                'amount' => 2200.00,
                'description' => 'Tarpaulins, programs, and attendance sheets',
                'transaction_date' => now()->subWeeks(2)->subDays(2),
            ],
            [
                'budget_id' => $sportsBudget->id,
                'recorded_by' => $officer1->id,
                'type' => 'expense',
                'category' => 'Supplies',
                'amount' => 3800.00,
                'description' => 'Sports equipment and medals - basketball, volleyball',
                'transaction_date' => now()->subWeek(),
            ],
            [
                'budget_id' => $merchandiseFund->id,
                'recorded_by' => $officer1->id,
                'type' => 'expense',
                'category' => 'Merchandise',
                'amount' => 12500.00,
                'description' => 'Merchandise procurement - 50 shirts, 30 tote bags, 100 lanyards',
                'transaction_date' => now()->subMonths(2),
            ],
            [
                'budget_id' => $generalFund->id,
                'recorded_by' => $officer1->id,
                'type' => 'expense',
                'category' => 'Transport',
                'amount' => 1800.00,
                'description' => 'Van rental for Leadership Seminar - round trip',
                'transaction_date' => now()->subDays(2),
            ],
        ];

        foreach ($transactions as $t) {
            Transaction::create($t);
        }

        // Budget::create() bypasses BudgetController, which is the only place that
        // maintains remaining_amount. Left null, every running-balance reader falls
        // back to allocated_amount and reports the wrong spend (the officer
        // dashboard derives spend from allocated/remaining/transacted, so a null
        // remaining made it show half the transacted total). Recompute with the
        // server's own definition from BudgetController: allocated + income - expense.
        foreach ([$generalFund, $sportsBudget, $merchandiseFund] as $budget) {
            $totals = Transaction::where('budget_id', $budget->id)
                ->selectRaw("COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income")
                ->selectRaw("COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense")
                ->first();

            $budget->update([
                'remaining_amount' => (float) $budget->allocated_amount
                    + (float) $totals->income
                    - (float) $totals->expense,
            ]);
        }

        $forecasts = [
            [
                'forecast_period' => 'Q3 2024 (Jul-Sep)',
                'predicted_income' => 20000.00,
                'predicted_expense' => 15000.00,
                'confidence_note' => 'Based on previous semester patterns. Includes Sports Fest and Induction expenses.',
            ],
            [
                'forecast_period' => 'Q4 2024 (Oct-Dec)',
                'predicted_income' => 22000.00,
                'predicted_expense' => 18500.00,
                'confidence_note' => 'Semester-end period. Higher expected expenses for Recognition ceremony and year-end activities.',
            ],
            [
                'forecast_period' => 'Q1 2025 (Jan-Mar)',
                'predicted_income' => 15000.00,
                'predicted_expense' => 12000.00,
                'confidence_note' => 'New semester org fee collection expected. Lower expenses in early semester.',
            ],
        ];

        foreach ($forecasts as $f) {
            FinancialForecast::create($f);
        }
    }
}
