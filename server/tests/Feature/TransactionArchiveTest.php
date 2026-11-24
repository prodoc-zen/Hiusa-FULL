<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\CashAdvance;
use App\Models\Collection;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\AskAiService;
use App\Services\Dashboard\DashboardBriefingService;
use App\Services\Records\TermDigest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use ReflectionMethod;
use Tests\TestCase;

/**
 * A ledger entry is never deleted. The Admin or the officer who recorded it archives it with a reason; the entry
 * then drops out of every money figure, gives its budget back, and stays readable in the archived list.
 */
class TransactionArchiveTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private Budget $budget;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Storage::fake('public');
        $this->organization = Organization::factory()->create();
        SboPosition::create(['organization_id' => $this->organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer', 'is_active' => true]);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->budget = Budget::create([
            'organization_id' => $this->organization->id, 'title' => 'Approved budget', 'allocated_amount' => 1000, 'remaining_amount' => 1000,
            'warning_threshold' => 100, 'submission_status' => 'approved',
        ]);
    }

    private function entry(array $overrides = [], ?User $recorder = null): Transaction
    {
        return Transaction::create([
            'organization_id' => $this->organization->id,
            'recorded_by' => ($recorder ?? $this->admin)->school_id,
            'type' => 'expense',
            'category' => 'Supplies',
            'amount' => 200,
            'description' => 'Markers',
            'transaction_date' => now(),
            ...$overrides,
        ]);
    }

    private function archive(Transaction $entry, ?string $reason = 'Entered twice by mistake')
    {
        return $this->patchJson("/api/transactions/{$entry->id}/archive", $reason === null ? [] : ['reason' => $reason]);
    }

    public function test_the_delete_route_is_gone(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->admin);

        $this->deleteJson("/api/transactions/{$entry->id}")->assertStatus(405);
        $this->assertSame(1, Transaction::count());
    }

    public function test_archiving_needs_a_reason_of_five_or_more_characters(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->admin);

        $this->archive($entry, null)->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->archive($entry, 'oops')->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->archive($entry, str_repeat('a', 501))->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->assertNull($entry->fresh()->archived_at);
    }

    public function test_archiving_keeps_the_row_and_records_who_when_and_why(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->admin);

        $this->archive($entry)->assertOk();

        $kept = Transaction::withoutGlobalScopes()->findOrFail($entry->id);
        $this->assertNotNull($kept->archived_at);
        $this->assertSame($this->admin->school_id, $kept->archived_by);
        $this->assertSame('Entered twice by mistake', $kept->archive_reason);
        $audit = AuditLog::where('module', 'financial_ledger')->where('action', 'archived')->where('record_id', $entry->id)->firstOrFail();
        $this->assertSame('Entered twice by mistake', $audit->new_values['archive_reason']);
        $this->assertSame($this->admin->school_id, $audit->user_id);
        $this->assertFalse(AuditLog::where('action', 'deleted')->where('record_id', $entry->id)->exists());
    }

    public function test_an_archived_entry_leaves_the_ledger_and_the_totals_and_shows_in_the_archived_list(): void
    {
        $kept = $this->entry(['description' => 'Kept entry', 'amount' => 300]);
        $gone = $this->entry(['description' => 'Archived entry', 'amount' => 125.50]);
        $this->entry(['type' => 'income', 'category' => 'Dues', 'description' => 'Dues', 'amount' => 1000]);
        Sanctum::actingAs($this->admin);
        $before = $this->getJson('/api/transactions/summary')->assertOk()->json();
        $this->assertEquals(425.50, $before['total_expense']);

        $this->archive($gone)->assertOk();

        $ids = collect($this->getJson('/api/transactions')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertContains($kept->id, $ids);
        $this->assertNotContains($gone->id, $ids);
        $summary = $this->getJson('/api/transactions/summary')->assertOk()->json();
        $this->assertEquals(300, $summary['total_expense']);
        $this->assertEquals(700, $summary['net_balance']);
        $this->assertEquals(300, collect($summary['by_category'])->firstWhere('category', 'Supplies')['total']);

        $archived = $this->getJson('/api/transactions?archived=1')->assertOk()->json('data');
        $this->assertSame([$gone->id], collect($archived)->pluck('id')->all());
        $this->assertNotNull($archived[0]['archived_at']);
        $this->assertSame('Entered twice by mistake', $archived[0]['archive_reason']);
        $this->assertSame(trim($this->admin->first_name.' '.$this->admin->last_name), $archived[0]['archived_by_name']);
    }

    public function test_every_row_carries_the_archive_and_edit_fields(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->admin);

        $row = collect($this->getJson('/api/transactions')->assertOk()->json('data'))->firstWhere('id', $entry->id);

        $this->assertNull($row['archived_at']);
        $this->assertNull($row['archive_reason']);
        $this->assertNull($row['archived_by_name']);
        $this->assertNull($row['last_edited_at']);
        $this->assertNull($row['last_edited_by_name']);
        $this->assertSame(0, $row['edit_count']);
        $this->assertFalse($row['has_receipt_file']);
        $this->assertNull($row['receipt_file_open_url']);
    }

    public function test_archiving_gives_the_budget_back_exactly_as_the_delete_did(): void
    {
        Sanctum::actingAs($this->admin);
        $created = $this->postJson('/api/transactions', [
            'type' => 'expense', 'amount' => '250.75', 'category' => 'Supplies', 'description' => 'Paint', 'transaction_date' => now()->toDateString(),
            'budget_id' => $this->budget->id, 'receipt_file' => UploadedFile::fake()->create('receipt.pdf', 40, 'application/pdf'),
        ])->assertCreated();
        $this->assertEquals(749.25, $this->budget->fresh()->remaining_amount);

        $this->archive(Transaction::findOrFail($created->json('id')))->assertOk();

        $this->assertEquals(1000, $this->budget->fresh()->remaining_amount);
    }

    public function test_an_archived_entry_is_out_of_the_budget_figures_and_the_other_money_readers(): void
    {
        $entry = $this->entry(['budget_id' => $this->budget->id, 'amount' => 400]);
        $this->entry(['budget_id' => $this->budget->id, 'amount' => 100]);
        $this->entry(['type' => 'income', 'category' => 'Dues', 'description' => 'Dues', 'amount' => 50]);
        Sanctum::actingAs($this->admin);
        $this->archive($entry)->assertOk();

        $this->assertSame(1, Budget::withCount('transactions')->findOrFail($this->budget->id)->transactions_count);
        $this->assertEquals(100, Budget::withSum('transactions', 'amount')->findOrFail($this->budget->id)->transactions_sum_amount);
        $this->assertEquals(100, (float) TermDigest::expenseByBudget([$this->budget->id])->get($this->budget->id));
        $dashboard = $this->getJson('/api/financial-dashboard')->assertOk();
        $this->assertEquals(-50, $dashboard->json('available_funds'));
        $this->assertEquals(100, $dashboard->json('total_expenses'));
        $this->assertNotContains($entry->id, collect($dashboard->json('recent_transactions'))->pluck('id')->all());
    }

    public function test_the_readers_that_query_the_table_directly_skip_archived_entries(): void
    {
        $gone = $this->entry(['budget_id' => $this->budget->id, 'amount' => 400]);
        $live = $this->entry(['budget_id' => $this->budget->id, 'amount' => 100]);
        $this->entry(['type' => 'income', 'category' => 'Dues', 'description' => 'Dues', 'amount' => 50]);
        Sanctum::actingAs($this->admin);
        $this->archive($gone)->assertOk();

        $briefing = app(DashboardBriefingService::class);
        $call = fn (string $method, ...$arguments) => (new ReflectionMethod($briefing, $method))->invoke($briefing, ...$arguments);
        $this->assertEquals(100, $call('approvedBudgetTotals', [$this->organization->id])['spent']);
        $this->assertEquals(-50, $call('netTransactions', $this->organization->id, now()->subDay(), now()->addDay()));
        $this->assertEquals(10.0, $call('organizationsOverview', collect([$this->organization->id]))[0]['budget_utilization_percent']);

        $askAi = app(AskAiService::class);
        $corpus = (new ReflectionMethod($askAi, 'buildKnowledgeCorpus'))->invoke($askAi, $this->admin, collect([$this->organization->id]), 'ledger');
        $ids = collect($corpus)->pluck('id')->all();
        $this->assertContains("rag-tx-{$live->id}", $ids);
        $this->assertNotContains("rag-tx-{$gone->id}", $ids);
    }

    public function test_the_receipt_file_stays_and_still_opens_after_archiving(): void
    {
        Sanctum::actingAs($this->admin);
        $created = $this->postJson('/api/transactions', [
            'type' => 'expense', 'amount' => '90', 'category' => 'Supplies', 'description' => 'Tape', 'transaction_date' => now()->toDateString(),
            'receipt_file' => UploadedFile::fake()->create('receipt.pdf', 40, 'application/pdf'),
        ])->assertCreated();
        $entry = Transaction::findOrFail($created->json('id'));
        $path = $entry->receipt_file_url;

        $this->archive($entry)->assertOk();

        Storage::disk('local')->assertExists($path);
        $this->getJson("/api/transactions/{$entry->id}/receipt-file")->assertOk();
        $row = collect($this->getJson('/api/transactions?archived=1')->json('data'))->firstWhere('id', $entry->id);
        $this->assertTrue($row['has_receipt_file']);
        $this->assertSame("/transactions/{$entry->id}/receipt-file", $row['receipt_file_open_url']);
    }

    public function test_an_archived_entry_cannot_be_archived_again_or_edited(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->admin);
        $this->archive($entry)->assertOk();

        $this->archive($entry, 'Second attempt here')->assertStatus(409)->assertJsonPath('message', 'This transaction is archived.');
        $this->putJson("/api/transactions/{$entry->id}", ['description' => 'Changed', 'edit_reason' => 'Trying to fix it'])
            ->assertStatus(409)->assertJsonPath('message', 'This transaction is archived.');
    }

    public function test_a_system_posted_entry_is_refused_with_the_message_the_delete_gave(): void
    {
        $posted = $this->entry(['type' => 'income', 'category' => 'Collection', 'description' => 'Collection']);
        Collection::create([
            'organization_id' => $this->organization->id, 'reference' => 'COL-77', 'amount_collected' => 200, 'source' => 'Membership',
            'collected_by' => $this->admin->school_id, 'collected_at' => now(), 'status' => 'verified', 'ledger_transaction_id' => $posted->id,
        ]);
        $advance = $this->entry(['description' => 'Advance']);
        CashAdvance::create([
            'organization_id' => $this->organization->id, 'reference' => 'CA-77', 'amount' => 200, 'purpose' => 'Venue',
            'borrower_id' => $this->admin->school_id, 'status' => 'released', 'release_transaction_id' => $advance->id,
        ]);
        Sanctum::actingAs($this->admin);

        $this->archive($posted)->assertStatus(409)->assertJsonPath('message', 'This entry was recorded when collection COL-77 was verified. Change it from Collections.');
        $this->archive($advance)->assertStatus(409)->assertJsonPath('message', 'This entry was recorded when cash advance CA-77 was released. Change it from Cash Advances.');
        $this->assertNull($posted->fresh()->archived_at);
    }

    public function test_an_entry_in_a_submitted_or_approved_report_is_refused(): void
    {
        $entry = $this->entry();
        FinancialReport::create([
            'organization_id' => $this->organization->id, 'report_type' => 'monthly', 'title' => 'August report', 'source_transaction_ids' => [$entry->id],
            'signatories' => ['treasurer' => 'Taylor Treasurer'], 'submission_status' => 'pending_department_head', 'generated_by' => $this->admin->school_id, 'generated_at' => now(),
        ]);
        Sanctum::actingAs($this->admin);

        $this->archive($entry)->assertStatus(409)->assertJsonPath('message', "This entry is part of the financial report 'August report' that has been submitted. Ask the Department Head to return the report before changing it.");
        $this->assertNull($entry->fresh()->archived_at);
    }

    public function test_an_officer_archives_only_what_they_recorded_and_a_head_or_student_cannot_archive(): void
    {
        $officer = User::factory()->officer()->create(['organization_id' => $this->organization->id, 'position_title' => 'Treasurer']);
        $theirs = $this->entry(['description' => 'Theirs'], $officer);
        $adminsEntry = $this->entry(['description' => 'Admins']);

        Sanctum::actingAs($officer);
        $this->archive($adminsEntry)->assertForbidden()->assertJsonPath('message', 'You can only archive transactions you recorded.');
        $this->archive($theirs)->assertOk();

        foreach ([User::factory()->departmentHead()->create(['organization_id' => $this->organization->id]), User::factory()->student()->create(['organization_id' => $this->organization->id])] as $other) {
            Sanctum::actingAs($other);
            $this->archive($adminsEntry)->assertForbidden();
        }
        $this->assertNull($adminsEntry->fresh()->archived_at);
    }

    public function test_another_organizations_entry_is_not_found(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]));

        $this->archive($entry)->assertNotFound();
        $this->assertNull($entry->fresh()->archived_at);
    }

    public function test_the_payer_still_sees_the_receipt_for_an_archived_payment(): void
    {
        $payer = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $entry = $this->entry(['type' => 'income', 'category' => 'Dues', 'description' => 'Dues', 'payer_id' => $payer->school_id, 'receipt_reference' => 'HIUSA-1-00000001', 'receipt_number' => 1]);
        Sanctum::actingAs($this->admin);
        $this->archive($entry)->assertOk();

        Sanctum::actingAs($payer);
        $this->assertContains($entry->id, collect($this->getJson('/api/transactions/personal-receipts')->assertOk()->json())->pluck('id')->all());
    }

    public function test_an_archived_entry_keeps_its_receipt_number_so_the_next_one_does_not_collide(): void
    {
        $entry = $this->entry(['receipt_number' => 4]);
        Sanctum::actingAs($this->admin);
        $this->archive($entry)->assertOk();

        $created = $this->postJson('/api/transactions', [
            'type' => 'income', 'amount' => '50', 'category' => 'Dues', 'description' => 'Dues', 'transaction_date' => now()->toDateString(),
        ])->assertCreated();

        $this->assertSame(5, $created->json('receipt_number'));
    }
}
