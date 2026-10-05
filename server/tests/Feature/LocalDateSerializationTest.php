<?php

namespace Tests\Feature;

use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The client reads the first ten characters of a date as the calendar day.
 * Serialized as UTC, anything dated before 8 AM Manila time read a day early,
 * and re-saving a transaction moved it back a day each time.
 */
class LocalDateSerializationTest extends TestCase
{
    use RefreshDatabase;

    public function test_finance_dates_leave_the_api_as_the_manila_calendar_day(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $transaction = Transaction::factory()->create([
            'organization_id' => $organization->id,
            'recorded_by' => $admin->school_id,
            'payer_id' => $student->school_id,
            'type' => 'income',
            'amount' => 250,
            'budget_id' => null,
            'event_id' => null,
            'transaction_date' => '2026-10-05 00:00:00',
        ]);
        $report = FinancialReport::create([
            'organization_id' => $organization->id,
            'report_type' => 'monthly',
            'title' => 'October report',
            'period_start' => '2026-10-01',
            'period_end' => '2026-10-31',
            'generated_by' => $admin->school_id,
        ]);
        Sanctum::actingAs($admin);

        $date = $this->getJson('/api/transactions')->assertOk()->json('data.0.transaction_date');
        $this->assertSame('2026-10-05T00:00:00+08:00', $date);

        $period = $this->getJson("/api/financial-reports/{$report->id}")->assertOk()->json();
        $this->assertStringStartsWith('2026-10-01', data_get($period, 'period_start') ?? data_get($period, 'report.period_start'));

        $this->putJson("/api/transactions/{$transaction->id}", ['transaction_date' => substr($date, 0, 10)])->assertOk();
        $this->assertSame('2026-10-05', $transaction->fresh()->transaction_date->toDateString(), 'Saving the date the form shows keeps the same day.');

        Sanctum::actingAs($student);
        $receipt = $this->getJson('/api/transactions/personal-receipts')->assertOk()->json();
        $this->assertStringStartsWith('2026-10-05', data_get($receipt, 'data.0.transaction_date') ?? data_get($receipt, '0.transaction_date'));
    }
}
