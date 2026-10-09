<?php

namespace Tests\Feature;

use App\Models\CashAdvance;
use App\Models\Collection;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The ledger tells the client which rows it may not touch: entries made by
 * another record, and entries listed in a financial report that has been
 * submitted for review.
 */
class LedgerEntryFlagsTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
    }

    private function entry(string $description = 'Markers', ?Organization $organization = null): Transaction
    {
        return Transaction::create([
            'organization_id' => ($organization ?? $this->organization)->id,
            'recorded_by' => $this->admin->school_id,
            'type' => 'expense',
            'category' => 'Supplies',
            'amount' => 80,
            'description' => $description,
            'transaction_date' => now(),
        ]);
    }

    private function report(array $ids, string $status, string $title = 'August report', ?Organization $organization = null): FinancialReport
    {
        return FinancialReport::create([
            'organization_id' => ($organization ?? $this->organization)->id,
            'report_type' => 'monthly',
            'title' => $title,
            'source_transaction_ids' => $ids,
            'signatories' => ['treasurer' => 'Taylor Treasurer'],
            'submission_status' => $status,
            'generated_by' => $this->admin->school_id,
            'generated_at' => now(),
        ]);
    }

    private function row(array $rows, int $id): array
    {
        return collect($rows)->firstWhere('id', $id);
    }

    public function test_a_manual_entry_is_flagged_as_not_system_generated(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->admin);

        $row = $this->row($this->getJson('/api/transactions')->assertOk()->json('data'), $entry->id);

        $this->assertFalse($row['is_system_generated']);
        $this->assertNull($row['system_source']);
        $this->assertNull($row['system_source_label']);
        $this->assertFalse($row['is_locked_by_report']);
        $this->assertNull($row['locking_report_title']);
    }

    public function test_each_system_source_is_flagged_with_its_key_and_label(): void
    {
        $collectionEntry = $this->entry('Collection');
        Collection::create([
            'organization_id' => $this->organization->id, 'reference' => 'COL-1', 'amount_collected' => 80, 'source' => 'Membership',
            'collected_by' => $this->admin->school_id, 'collected_at' => now(), 'status' => 'verified', 'ledger_transaction_id' => $collectionEntry->id,
        ]);
        $advanceEntry = $this->entry('Advance');
        CashAdvance::create([
            'organization_id' => $this->organization->id, 'reference' => 'CA-1', 'amount' => 80, 'purpose' => 'Venue',
            'borrower_id' => $this->admin->school_id, 'status' => 'released', 'release_transaction_id' => $advanceEntry->id,
        ]);
        Sanctum::actingAs($this->admin);

        $rows = $this->getJson('/api/transactions')->assertOk()->json('data');

        $collection = $this->row($rows, $collectionEntry->id);
        $this->assertTrue($collection['is_system_generated']);
        $this->assertSame('collection', $collection['system_source']);
        $this->assertSame('Collection verification', $collection['system_source_label']);
        $advance = $this->row($rows, $advanceEntry->id);
        $this->assertTrue($advance['is_system_generated']);
        $this->assertSame('cash_advance', $advance['system_source']);
        $this->assertSame('Cash advance release', $advance['system_source_label']);
    }

    public function test_the_store_and_update_responses_carry_the_flags(): void
    {
        Sanctum::actingAs($this->admin);
        $created = $this->postJson('/api/transactions', [
            'type' => 'expense', 'amount' => 80, 'category' => 'Supplies', 'description' => 'Markers', 'transaction_date' => now()->toDateString(),
        ])->assertCreated();
        $created->assertJsonPath('is_system_generated', false)->assertJsonPath('is_locked_by_report', false)->assertJsonPath('system_source', null);

        $this->putJson('/api/transactions/'.$created->json('id'), ['description' => 'Markers and tape'])
            ->assertOk()->assertJsonPath('is_system_generated', false)->assertJsonPath('is_locked_by_report', false);
    }

    public function test_a_draft_report_does_not_lock_its_entries(): void
    {
        $entry = $this->entry();
        $this->report([$entry->id], 'draft');
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/transactions/{$entry->id}", ['description' => 'Changed'])->assertOk();
        $this->deleteJson("/api/transactions/{$entry->id}")->assertOk();
    }

    public function test_a_rejected_report_unlocks_its_entries(): void
    {
        $entry = $this->entry();
        $this->report([$entry->id], 'rejected');
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/transactions/{$entry->id}", ['description' => 'Changed'])->assertOk();
        $this->deleteJson("/api/transactions/{$entry->id}")->assertOk();
    }

    public function test_a_submitted_or_approved_report_locks_edit_and_delete(): void
    {
        Sanctum::actingAs($this->admin);

        foreach (['pending_department_head', 'pending_sao', 'approved'] as $status) {
            $entry = $this->entry();
            $this->report([$entry->id], $status, 'August report');
            $message = "This entry is part of the financial report 'August report' that has been submitted. Ask the Department Head to return the report before changing it.";

            $this->putJson("/api/transactions/{$entry->id}", ['description' => 'Quietly rewritten'])
                ->assertStatus(409)->assertJsonPath('message', $message);
            $this->deleteJson("/api/transactions/{$entry->id}")
                ->assertStatus(409)->assertJsonPath('message', $message);

            $this->assertSame('Markers', Transaction::findOrFail($entry->id)->description, $status);
        }
    }

    public function test_another_organizations_report_does_not_lock_the_entry(): void
    {
        $entry = $this->entry();
        $other = Organization::factory()->create();
        $this->report([$entry->id], 'approved', 'Other report', $other);
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/transactions/{$entry->id}", ['description' => 'Changed'])->assertOk();
        $row = $this->row($this->getJson('/api/transactions')->assertOk()->json('data'), $entry->id);
        $this->assertFalse($row['is_locked_by_report']);
        $this->deleteJson("/api/transactions/{$entry->id}")->assertOk();
    }

    public function test_an_id_that_only_shares_digits_with_a_listed_id_is_not_locked(): void
    {
        $entry = $this->entry();
        $this->report([$entry->id * 10 + 1, 9000 + $entry->id], 'approved');
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/transactions/{$entry->id}", ['description' => 'Changed'])->assertOk();
    }

    public function test_the_index_flags_a_mixed_page_correctly(): void
    {
        $free = $this->entry('Free');
        $inSubmitted = $this->entry('In submitted');
        $inApproved = $this->entry('In approved');
        $inDraft = $this->entry('In draft');
        $inRejected = $this->entry('In rejected');
        $this->report([$inSubmitted->id], 'pending_sao', 'Submitted report');
        $this->report([$inApproved->id], 'approved', 'Approved report');
        $this->report([$inDraft->id], 'draft', 'Draft report');
        $this->report([$inRejected->id], 'rejected', 'Rejected report');
        Sanctum::actingAs($this->admin);

        $rows = $this->getJson('/api/transactions')->assertOk()->json('data');

        $this->assertFalse($this->row($rows, $free->id)['is_locked_by_report']);
        $this->assertTrue($this->row($rows, $inSubmitted->id)['is_locked_by_report']);
        $this->assertSame('Submitted report', $this->row($rows, $inSubmitted->id)['locking_report_title']);
        $this->assertTrue($this->row($rows, $inApproved->id)['is_locked_by_report']);
        $this->assertSame('Approved report', $this->row($rows, $inApproved->id)['locking_report_title']);
        $this->assertFalse($this->row($rows, $inDraft->id)['is_locked_by_report']);
        $this->assertFalse($this->row($rows, $inRejected->id)['is_locked_by_report']);
        $this->assertNull($this->row($rows, $inRejected->id)['locking_report_title']);
    }

    public function test_the_index_query_count_does_not_grow_with_the_page(): void
    {
        $small = $this->entry('Only one');
        $this->report([$small->id], 'approved');
        Sanctum::actingAs($this->admin);

        DB::enableQueryLog();
        $this->getJson('/api/transactions')->assertOk();
        $oneRow = count(DB::getQueryLog());

        $ids = [];
        foreach (range(1, 9) as $number) {
            $row = $this->entry("Entry {$number}");
            $ids[] = $row->id;
        }
        $this->report($ids, 'pending_department_head', 'Second report');
        Collection::create([
            'organization_id' => $this->organization->id, 'reference' => 'COL-9', 'amount_collected' => 80, 'source' => 'Membership',
            'collected_by' => $this->admin->school_id, 'collected_at' => now(), 'status' => 'verified', 'ledger_transaction_id' => $ids[0],
        ]);

        DB::flushQueryLog();
        $rows = $this->getJson('/api/transactions?per_page=10')->assertOk()->json('data');
        $tenRows = count(DB::getQueryLog());

        $this->assertCount(10, $rows);
        $this->assertSame($oneRow, $tenRows);
    }
}
