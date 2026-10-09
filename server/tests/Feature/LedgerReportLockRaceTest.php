<?php

namespace Tests\Feature;

use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class LedgerReportLockRaceTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private Transaction $entry;

    private int $outerLevel;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->entry = Transaction::create([
            'organization_id' => $this->organization->id,
            'recorded_by' => $this->admin->school_id,
            'type' => 'expense',
            'category' => 'Supplies',
            'amount' => 80,
            'description' => 'Markers',
            'transaction_date' => now(),
        ]);
        FinancialReport::create([
            'organization_id' => $this->organization->id,
            'report_type' => 'monthly',
            'title' => 'August report',
            'source_transaction_ids' => [$this->entry->id],
            'signatories' => ['treasurer' => 'Taylor Treasurer'],
            'submission_status' => 'pending_sao',
            'generated_by' => $this->admin->school_id,
            'generated_at' => now(),
        ]);
        Sanctum::actingAs($this->admin);
        $this->outerLevel = DB::transactionLevel();
    }

    /**
     * @return array<int, int> the transaction level each financial_reports query ran at
     */
    private function reportQueryLevels(callable $request): array
    {
        $levels = [];
        DB::listen(function ($query) use (&$levels) {
            if (str_contains($query->sql, 'financial_reports')) {
                $levels[] = DB::transactionLevel();
            }
        });

        $request();

        return $levels;
    }

    public function test_update_reads_the_report_lock_inside_the_database_transaction(): void
    {
        $levels = $this->reportQueryLevels(
            fn () => $this->putJson('/api/transactions/'.$this->entry->id, ['amount' => 99])->assertStatus(409)
        );

        $this->assertNotEmpty($levels);
        $this->assertNotContains($this->outerLevel, $levels);
    }

    public function test_destroy_reads_the_report_lock_inside_the_database_transaction(): void
    {
        $levels = $this->reportQueryLevels(
            fn () => $this->deleteJson('/api/transactions/'.$this->entry->id)->assertStatus(409)
        );

        $this->assertNotEmpty($levels);
        $this->assertNotContains($this->outerLevel, $levels);
        $this->assertDatabaseHas('transactions', ['id' => $this->entry->id]);
    }

    public function test_the_lock_matches_when_the_driver_returns_ids_as_strings(): void
    {
        $stringly = (new Transaction)->forceFill([
            'id' => (string) $this->entry->id,
            'organization_id' => (string) $this->organization->id,
        ]);

        $titles = FinancialReport::lockingTitles([$stringly]);

        $this->assertSame([$this->entry->id => 'August report'], $titles);
    }
}
