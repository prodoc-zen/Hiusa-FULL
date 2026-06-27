<?php

namespace Database\Seeders;

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
        $officer1 = User::where('school_id', 'OFF-2024-001')->first();
        $assembly = Event::where('title', 'HIUSA General Assembly')->first();
        $sportsFest = Event::where('title', 'Sports Fest 2024')->first();

        $generalFund = Budget::create([
            'title'            => 'General Operations Fund',
            'allocated_amount' => 50000.00,
            'warning_threshold'=> 10000.00,
            'event_id'         => null,
        ]);

        $sportsBudget = Budget::create([
            'title'            => 'Sports Fest 2024 Budget',
            'allocated_amount' => 25000.00,
            'warning_threshold'=> 5000.00,
            'event_id'         => $sportsFest?->id,
        ]);

        $merchandiseFund = Budget::create([
            'title'            => 'Merchandise Fund',
            'allocated_amount' => 30000.00,
            'warning_threshold'=> 8000.00,
            'event_id'         => null,
        ]);

        $transactions = [
            // Income entries
            [
                'budget_id'        => $generalFund->id,
                'recorded_by'      => $officer1->id,
                'type'             => 'income',
                'category'         => 'Org Fee',
                'amount'           => 18500.00,
                'description'      => 'First semester organizational fee collection — 37 members',
                'transaction_date' => now()->subMonths(3)->startOfMonth(),
            ],
            [
                'budget_id'        => $generalFund->id,
                'recorded_by'      => $officer1->id,
                'type'             => 'income',
                'category'         => 'Org Fee',
                'amount'           => 15000.00,
                'description'      => 'Second semester organizational fee collection — 30 members',
                'transaction_date' => now()->subMonths(1)->startOfMonth(),
            ],
            [
                'budget_id'        => $generalFund->id,
                'recorded_by'      => $officer1->id,
                'type'             => 'income',
                'category'         => 'Sponsorship',
                'amount'           => 10000.00,
                'description'      => 'Corporate sponsorship from TechPH — Sports Fest',
                'transaction_date' => now()->subMonths(2),
            ],
            [
                'budget_id'        => $merchandiseFund->id,
                'recorded_by'      => $officer1->id,
                'type'             => 'income',
                'category'         => 'Merchandise Sales',
                'amount'           => 8750.00,
                'description'      => 'First batch merchandise revenue — shirts and lanyards',
                'transaction_date' => now()->subWeeks(3),
            ],
            // Expense entries
            [
                'budget_id'        => $generalFund->id,
                'recorded_by'      => $officer1->id,
                'type'             => 'expense',
                'category'         => 'Venue',
                'amount'           => 5000.00,
                'description'      => 'AVR rental for General Assembly — 3 hours',
                'transaction_date' => now()->subWeeks(3),
            ],
            [
                'budget_id'        => $generalFund->id,
                'recorded_by'      => $officer1->id,
                'type'             => 'expense',
                'category'         => 'Food & Catering',
                'amount'           => 4500.00,
                'description'      => 'Snacks and drinks for General Assembly — 80 pax',
                'transaction_date' => now()->subWeeks(2),
            ],
            [
                'budget_id'        => $generalFund->id,
                'recorded_by'      => $officer1->id,
                'type'             => 'expense',
                'category'         => 'Printing',
                'amount'           => 2200.00,
                'description'      => 'Tarpaulins, programs, and attendance sheets',
                'transaction_date' => now()->subWeeks(2)->subDays(2),
            ],
            [
                'budget_id'        => $sportsBudget->id,
                'recorded_by'      => $officer1->id,
                'type'             => 'expense',
                'category'         => 'Supplies',
                'amount'           => 3800.00,
                'description'      => 'Sports equipment and medals — basketball, volleyball',
                'transaction_date' => now()->subWeek(),
            ],
            [
                'budget_id'        => $merchandiseFund->id,
                'recorded_by'      => $officer1->id,
                'type'             => 'expense',
                'category'         => 'Merchandise',
                'amount'           => 12500.00,
                'description'      => 'Merchandise procurement — 50 shirts, 30 tote bags, 100 lanyards',
                'transaction_date' => now()->subMonths(2),
            ],
            [
                'budget_id'        => $generalFund->id,
                'recorded_by'      => $officer1->id,
                'type'             => 'expense',
                'category'         => 'Transport',
                'amount'           => 1800.00,
                'description'      => 'Van rental for Leadership Seminar — round trip',
                'transaction_date' => now()->subDays(2),
            ],
        ];

        foreach ($transactions as $t) {
            Transaction::create($t);
        }

        $forecasts = [
            [
                'forecast_period'   => 'Q3 2024 (Jul–Sep)',
                'predicted_income'  => 20000.00,
                'predicted_expense' => 15000.00,
                'confidence_note'   => 'Based on previous semester patterns. Includes Sports Fest and Induction expenses.',
            ],
            [
                'forecast_period'   => 'Q4 2024 (Oct–Dec)',
                'predicted_income'  => 22000.00,
                'predicted_expense' => 18500.00,
                'confidence_note'   => 'Semester-end period. Higher expected expenses for Recognition ceremony and year-end activities.',
            ],
            [
                'forecast_period'   => 'Q1 2025 (Jan–Mar)',
                'predicted_income'  => 15000.00,
                'predicted_expense' => 12000.00,
                'confidence_note'   => 'New semester org fee collection expected. Lower expenses in early semester.',
            ],
        ];

        foreach ($forecasts as $f) {
            FinancialForecast::create($f);
        }
    }
}
