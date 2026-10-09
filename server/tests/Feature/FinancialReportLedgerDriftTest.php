<?php

namespace Tests\Feature;

use App\Models\Budget;
use App\Models\Event;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FinancialReportLedgerDriftTest extends TestCase
{
    use RefreshDatabase;

    private const STALE_MESSAGE = 'The ledger changed after this report was generated. Regenerate the report before submitting.';

    private Organization $organization;

    private User $admin;

    private Transaction $entry;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        User::factory()->departmentHead()->create(['organization_id' => $this->organization->id]);
        $this->entry = Transaction::create([
            'organization_id' => $this->organization->id,
            'recorded_by' => $this->admin->school_id,
            'type' => 'income',
            'category' => 'membership',
            'amount' => 1000,
            'description' => 'Dues',
            'transaction_date' => now(),
        ]);
        Sanctum::actingAs($this->admin);
    }

    private function generate(): FinancialReport
    {
        $response = $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'monthly',
            'signatories' => ['treasurer' => 'T', 'president' => 'P', 'adviser' => 'A', 'sbo_adviser' => 'S'],
        ])->assertCreated();

        return FinancialReport::findOrFail($response->json('report.id'));
    }

    private function assertStale(FinancialReport $report): void
    {
        $this->postJson('/api/financial-reports/'.$report->id.'/submit')
            ->assertStatus(409)
            ->assertJsonPath('message', self::STALE_MESSAGE);

        $this->assertSame('draft', $report->fresh()->submission_status);
        $this->assertDatabaseMissing('approval_requests', ['entity_type' => 'financial_report', 'entity_id' => $report->id]);
    }

    public function test_an_unchanged_ledger_submits(): void
    {
        $report = $this->generate();

        $this->postJson('/api/financial-reports/'.$report->id.'/submit')
            ->assertOk()
            ->assertJsonPath('submission_status', 'pending_department_head');
    }

    public function test_entries_added_after_generation_do_not_block_submission(): void
    {
        $report = $this->generate();
        Transaction::create([
            'organization_id' => $this->organization->id,
            'recorded_by' => $this->admin->school_id,
            'type' => 'expense',
            'category' => 'supplies',
            'amount' => 5,
            'description' => 'Late entry',
            'transaction_date' => now(),
        ]);

        $this->postJson('/api/financial-reports/'.$report->id.'/submit')->assertOk();
    }

    public function test_an_edited_amount_blocks_submission(): void
    {
        $report = $this->generate();
        $this->putJson('/api/transactions/'.$this->entry->id, ['amount' => 1500])->assertOk();

        $this->assertStale($report);
    }

    public function test_a_deleted_entry_blocks_submission(): void
    {
        $report = $this->generate();
        $this->deleteJson('/api/transactions/'.$this->entry->id)->assertOk();

        $this->assertStale($report);
    }

    public function test_a_changed_category_blocks_submission(): void
    {
        $report = $this->generate();
        $this->putJson('/api/transactions/'.$this->entry->id, ['category' => 'donations'])->assertOk();

        $this->assertStale($report);
    }

    public function test_a_changed_type_date_budget_or_event_blocks_submission(): void
    {
        $budget = Budget::create(['organization_id' => $this->organization->id, 'title' => 'Allocation', 'allocated_amount' => 5000, 'remaining_amount' => 5000, 'warning_threshold' => 100, 'advice_generated_at' => now()]);

        foreach ([
            ['type' => 'expense'],
            ['transaction_date' => now()->subDay()->toDateString()],
            ['budget_id' => $budget->id],
        ] as $change) {
            $this->entry->update(['type' => 'income', 'transaction_date' => now(), 'budget_id' => null]);
            $report = $this->generate();
            $this->entry->update($change);

            $this->assertStale($report);
        }

        $event = Event::factory()->create(['organization_id' => $this->organization->id]);
        $this->entry->update(['type' => 'income', 'transaction_date' => now(), 'budget_id' => null, 'event_id' => null]);
        $report = $this->generate();
        $this->entry->update(['event_id' => $event->id]);

        $this->assertStale($report);
    }

    public function test_a_rejected_submission_leaves_no_uploaded_document_behind(): void
    {
        Storage::fake('local');
        $report = $this->generate();
        $this->putJson('/api/transactions/'.$this->entry->id, ['amount' => 1500])->assertOk();

        $this->post('/api/financial-reports/'.$report->id.'/submit', [
            'supporting_documents' => [UploadedFile::fake()->create('receipts.pdf', 100, 'application/pdf')],
        ])->assertStatus(409);

        $this->assertSame([], Storage::disk('local')->allFiles('financial-reports'));
    }

    public function test_regenerating_after_a_change_submits(): void
    {
        $stale = $this->generate();
        $this->putJson('/api/transactions/'.$this->entry->id, ['amount' => 1500])->assertOk();
        $this->postJson('/api/financial-reports/'.$stale->id.'/submit')->assertStatus(409);

        $fresh = $this->generate();

        $this->postJson('/api/financial-reports/'.$fresh->id.'/submit')
            ->assertOk()
            ->assertJsonPath('submission_status', 'pending_department_head');
    }
}
