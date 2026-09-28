<?php

namespace Tests\Feature;

use App\Models\Budget;
use App\Models\CashAdvance;
use App\Models\Collection;
use App\Models\FinancialForecast;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FinanceReadAccessTest extends TestCase
{
    use RefreshDatabase;

    private function organization(): Organization
    {
        return Organization::factory()->create();
    }

    private function actor(int $organizationId, string $role): User
    {
        return User::factory()->create(['organization_id' => $organizationId, 'role' => $role, 'account_status' => 'active']);
    }

    /**
     * One record per finance module for a single organization, so ownership
     * and cross-org leakage can both be asserted from the same fixture.
     */
    private function seedFinanceRecords(int $organizationId, string $label): array
    {
        $admin = $this->actor($organizationId, 'ADMIN');

        $budget = Budget::create([
            'organization_id' => $organizationId,
            'title' => "{$label} Budget",
            'allocated_amount' => 1000,
            'remaining_amount' => 1000,
            'warning_threshold' => 100,
        ]);

        $transaction = Transaction::create([
            'organization_id' => $organizationId,
            'recorded_by' => $admin->school_id,
            'type' => 'income',
            'category' => 'General',
            'description' => "{$label} transaction",
            'amount' => 500,
            'transaction_date' => now(),
        ]);

        $forecast = FinancialForecast::create([
            'organization_id' => $organizationId,
            'forecast_period' => now()->format('Y-m'),
            'predicted_income' => 1000,
            'predicted_expense' => 500,
        ]);

        $report = FinancialReport::create([
            'organization_id' => $organizationId,
            'report_type' => 'monthly',
            'title' => "{$label} Report",
            'submitted_at' => now(),
        ]);

        $collection = Collection::create([
            'organization_id' => $organizationId,
            'reference' => 'COL-'.strtoupper($label).'-'.$organizationId,
            'amount_collected' => 300,
            'source' => 'Event fee',
            'collected_by' => $admin->school_id,
            'collected_at' => now(),
        ]);

        $advance = CashAdvance::create([
            'organization_id' => $organizationId,
            'reference' => 'ADV-'.strtoupper($label).'-'.$organizationId,
            'borrower_id' => $admin->school_id,
            'amount' => 200,
            'purpose' => 'Venue deposit',
        ]);

        return compact('budget', 'transaction', 'forecast', 'report', 'collection', 'advance');
    }

    public function test_officer_and_department_head_read_finance_endpoints_scoped_to_own_organization(): void
    {
        $orgA = $this->organization();
        $orgB = $this->organization();

        $ownRecords = $this->seedFinanceRecords($orgA->id, 'Own');
        $otherRecords = $this->seedFinanceRecords($orgB->id, 'Other');

        foreach (['SBO_OFFICER', 'DEPARTMENT_HEAD'] as $role) {
            $actor = $this->actor($orgA->id, $role);
            Sanctum::actingAs($actor);

            $budgets = $this->getJson('/api/budgets')->assertOk()->json('data');
            $this->assertCount(1, $budgets, "{$role} should only see budgets from their own organization.");
            $this->assertSame($ownRecords['budget']->id, $budgets[0]['id']);

            $transactions = $this->getJson('/api/transactions')->assertOk()->json('data');
            $this->assertCount(1, $transactions, "{$role} should only see transactions from their own organization.");
            $this->assertSame($ownRecords['transaction']->id, $transactions[0]['id']);

            $this->getJson('/api/transactions/summary')->assertOk()
                ->assertJsonPath('total_income', 500);

            $this->getJson('/api/financial-dashboard')->assertOk();

            $collections = $this->getJson('/api/collections')->assertOk()->json();
            $this->assertCount(1, $collections, "{$role} should only see collections from their own organization.");
            $this->assertSame($ownRecords['collection']->id, $collections[0]['id']);

            $advances = $this->getJson('/api/cash-advances')->assertOk()->json();
            $this->assertCount(1, $advances, "{$role} should only see cash advances from their own organization.");
            $this->assertSame($ownRecords['advance']->id, $advances[0]['id']);

            $forecasts = $this->getJson('/api/forecasts')->assertOk()->json('data');
            $this->assertCount(1, $forecasts, "{$role} should only see forecasts from their own organization.");
            $this->assertSame($ownRecords['forecast']->id, $forecasts[0]['id']);

            $reports = $this->getJson('/api/financial-reports')->assertOk()->json('data');
            $this->assertCount(1, $reports, "{$role} should only see financial reports from their own organization.");
            $this->assertSame($ownRecords['report']->id, $reports[0]['id']);

            $this->getJson('/api/financial-reports/deadline')->assertOk();

            $this->getJson('/api/financial-reports/'.$ownRecords['report']->id)->assertOk();
            $this->getJson('/api/financial-reports/'.$otherRecords['report']->id)->assertNotFound();
        }
    }

    public function test_officer_and_department_head_are_forbidden_from_every_finance_write_endpoint(): void
    {
        $org = $this->organization();
        $records = $this->seedFinanceRecords($org->id, 'Write');

        foreach (['SBO_OFFICER', 'DEPARTMENT_HEAD'] as $role) {
            $actor = $this->actor($org->id, $role);
            Sanctum::actingAs($actor);

            $this->postJson('/api/budgets', ['title' => 'x', 'allocated_amount' => 1, 'warning_threshold' => 0])->assertForbidden();
            $this->putJson('/api/budgets/'.$records['budget']->id, ['title' => 'y'])->assertForbidden();
            $this->deleteJson('/api/budgets/'.$records['budget']->id)->assertForbidden();
            $this->postJson('/api/budgets/'.$records['budget']->id.'/advice')->assertForbidden();

            $this->postJson('/api/transactions', ['type' => 'income', 'amount' => 1, 'category' => 'x', 'description' => 'x', 'transaction_date' => now()->toDateString()])->assertForbidden();
            $this->putJson('/api/transactions/'.$records['transaction']->id, ['amount' => 2])->assertForbidden();
            $this->deleteJson('/api/transactions/'.$records['transaction']->id)->assertForbidden();

            $this->postJson('/api/forecasts/generate', ['months' => 6])->assertForbidden();
            $this->postJson('/api/forecasts', ['forecast_period' => '2026-01', 'predicted_income' => 1, 'predicted_expense' => 1])->assertForbidden();
            $this->putJson('/api/forecasts/'.$records['forecast']->id, ['predicted_income' => 1])->assertForbidden();
            $this->deleteJson('/api/forecasts/'.$records['forecast']->id)->assertForbidden();

            $this->postJson('/api/financial-reports/generate', [
                'report_type' => 'monthly',
                'signatories' => ['treasurer' => 't', 'president' => 'p', 'adviser' => 'a', 'sbo_adviser' => 's'],
            ])->assertForbidden();
            $this->postJson('/api/financial-reports/'.$records['report']->id.'/submit')->assertForbidden();
            $this->postJson('/api/financial-reports/deadline', ['deadline_at' => now()->addWeek()->toDateTimeString()])->assertForbidden();

            $this->postJson('/api/collections', ['amount_collected' => 1, 'source' => 'x'])->assertForbidden();
            $this->patchJson('/api/collections/'.$records['collection']->id.'/verify')->assertForbidden();
            $this->postJson('/api/collections/'.$records['collection']->id.'/remittances', ['amount' => 1])->assertForbidden();

            $this->postJson('/api/cash-advances', ['amount' => 1, 'purpose' => 'x'])->assertForbidden();
            $this->patchJson('/api/cash-advances/'.$records['advance']->id.'/approve')->assertForbidden();
            $this->patchJson('/api/cash-advances/'.$records['advance']->id.'/release')->assertForbidden();
            $this->postJson('/api/cash-advances/'.$records['advance']->id.'/repayments', ['amount' => 1])->assertForbidden();
        }
    }
}
