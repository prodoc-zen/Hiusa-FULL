<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Event;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * An edit needs a reason, must change something, and leaves who, when, how often and exactly what changed.
 */
class TransactionEditTrailTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private Budget $budget;

    private Event $event;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->organization = Organization::factory()->create();
        SboPosition::create(['organization_id' => $this->organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer', 'is_active' => true]);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->budget = Budget::create([
            'organization_id' => $this->organization->id, 'title' => 'Approved budget', 'allocated_amount' => 1000, 'remaining_amount' => 1000,
            'warning_threshold' => 100, 'submission_status' => 'approved',
        ]);
        $this->event = Event::factory()->create(['organization_id' => $this->organization->id, 'title' => 'Leadership Seminar 2024']);
    }

    private function entry(array $overrides = []): Transaction
    {
        return Transaction::create([
            'organization_id' => $this->organization->id,
            'recorded_by' => $this->admin->school_id,
            'type' => 'expense',
            'category' => 'Supplies',
            'amount' => 200,
            'description' => 'Markers',
            'transaction_date' => '2026-11-10 10:30:00',
            ...$overrides,
        ]);
    }

    private function edit(Transaction $entry, array $changes, ?string $reason = 'Corrected after checking the receipt')
    {
        return $this->putJson("/api/transactions/{$entry->id}", [...$changes, ...($reason === null ? [] : ['edit_reason' => $reason])]);
    }

    public function test_an_edit_needs_a_reason_of_five_or_more_characters(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->admin);

        $this->edit($entry, ['description' => 'Changed'], null)->assertStatus(422)->assertJsonPath('errors.edit_reason.0', 'Give the reason for this edit.');
        $this->edit($entry, ['description' => 'Changed'], 'oops')->assertStatus(422)->assertJsonPath('errors.edit_reason.0', 'Give the reason for this edit.');
        $this->edit($entry, ['description' => 'Changed'], str_repeat('a', 501))->assertStatus(422)->assertJsonValidationErrors('edit_reason');
        $this->assertSame('Markers', $entry->fresh()->description);
        $this->assertSame(0, $entry->fresh()->edit_count);
    }

    public function test_an_edit_that_changes_nothing_is_refused(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->admin);

        $this->edit($entry, ['description' => 'Markers', 'amount' => '200.00', 'type' => 'expense', 'category' => 'Supplies'])
            ->assertStatus(422)->assertJsonPath('message', 'Nothing changed.');

        $this->assertSame(0, $entry->fresh()->edit_count);
        $this->assertNull($entry->fresh()->last_edited_at);
        $this->assertFalse(AuditLog::where('action', 'updated')->where('record_id', $entry->id)->exists());
    }

    public function test_picking_the_same_day_is_not_a_change_and_keeps_the_recorded_time(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->admin);

        $this->edit($entry, ['transaction_date' => '2026-11-10'])->assertStatus(422)->assertJsonPath('message', 'Nothing changed.');
        $this->edit($entry, ['transaction_date' => '2026-11-10', 'description' => 'Markers and tape'])->assertOk();

        $this->assertSame('2026-11-10 10:30:00', $entry->fresh()->transaction_date->format('Y-m-d H:i:s'));
    }

    public function test_a_saved_edit_records_who_when_and_how_many_times(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->admin);

        $first = $this->edit($entry, ['description' => 'Markers and tape'])->assertOk();
        $this->edit($entry, ['category' => 'Events'], 'Wrong category used at first')->assertOk();

        $fresh = $entry->fresh();
        $this->assertSame(2, $fresh->edit_count);
        $this->assertSame($this->admin->school_id, $fresh->last_edited_by);
        $this->assertNotNull($fresh->last_edited_at);
        $first->assertJsonPath('edit_count', 1)
            ->assertJsonPath('last_edited_by_name', trim($this->admin->first_name.' '.$this->admin->last_name));
        $this->assertNotNull($first->json('last_edited_at'));
    }

    public function test_the_audit_row_stores_the_old_and_new_values_the_changed_fields_and_the_reason(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->admin);

        $this->edit($entry, ['amount' => '250.50', 'description' => 'Markers and tape'], 'The receipt shows 250.50')->assertOk();

        $audit = AuditLog::where('module', 'financial_ledger')->where('action', 'updated')->where('record_id', $entry->id)->firstOrFail();
        $this->assertEquals(200, $audit->old_values['amount']);
        $this->assertEquals(250.50, $audit->new_values['amount']);
        $this->assertSame('Markers', $audit->old_values['description']);
        $this->assertSame('Markers and tape', $audit->new_values['description']);
        $this->assertSame(['amount', 'description'], $audit->new_values['changed_fields']);
        $this->assertSame('The receipt shows 250.50', $audit->new_values['edit_reason']);
        $this->assertSame($this->admin->school_id, $audit->user_id);
    }

    public function test_changing_the_amount_moves_the_budget_and_changing_only_the_words_does_not(): void
    {
        $entry = $this->entry(['budget_id' => $this->budget->id, 'event_id' => null]);
        $this->budget->update(['remaining_amount' => 800]);
        Sanctum::actingAs($this->admin);

        $this->edit($entry, ['description' => 'Markers and tape'])->assertOk();
        $this->assertEquals(800, $this->budget->fresh()->remaining_amount);

        $this->edit($entry, ['amount' => '300'])->assertOk();
        $this->assertEquals(700, $this->budget->fresh()->remaining_amount);
    }

    public function test_an_officer_edits_only_what_they_recorded(): void
    {
        $officer = User::factory()->officer()->create(['organization_id' => $this->organization->id, 'position_title' => 'Treasurer']);
        $adminsEntry = $this->entry();
        Sanctum::actingAs($officer);

        $this->edit($adminsEntry, ['description' => 'Changed'])->assertForbidden();
    }

    public function test_the_history_lists_the_entry_the_edit_and_the_archive_newest_first_in_words(): void
    {
        Sanctum::actingAs($this->admin);
        $created = $this->postJson('/api/transactions', [
            'type' => 'income', 'amount' => '500', 'category' => 'Dues', 'description' => 'Dues', 'transaction_date' => '2026-11-10',
        ])->assertCreated();
        $entry = Transaction::findOrFail($created->json('id'));
        $this->travel(1)->hours();
        $this->edit($entry, [
            'amount' => '650', 'category' => 'Fundraising', 'budget_id' => $this->budget->id, 'event_id' => $this->event->id, 'transaction_date' => '2026-11-12',
        ], 'Moved to the seminar fund')->assertOk();
        $this->travel(1)->hours();
        $this->patchJson("/api/transactions/{$entry->id}/archive", ['reason' => 'Posted to the wrong organization'])->assertOk();

        $history = $this->getJson("/api/transactions/{$entry->id}/history")->assertOk()->json('data');

        $this->assertSame(['archived', 'updated', 'created'], array_column($history, 'action'));
        $name = trim($this->admin->first_name.' '.$this->admin->last_name);
        foreach ($history as $row) {
            $this->assertSame(['user_id' => $this->admin->school_id, 'name' => $name], $row['by']);
            $this->assertNotNull($row['at']);
        }
        $this->assertSame('Posted to the wrong organization', $history[0]['reason']);
        $this->assertSame([], $history[0]['changes']);
        $this->assertSame('Moved to the seminar fund', $history[1]['reason']);
        $this->assertNull($history[2]['reason']);
        $changes = collect($history[1]['changes'])->keyBy('label');
        $this->assertSame(['field' => 'amount', 'label' => 'Amount', 'from' => '500.00', 'to' => '650.00'], $changes['Amount']);
        $this->assertSame(['field' => 'category', 'label' => 'Category', 'from' => 'Dues', 'to' => 'Fundraising'], $changes['Category']);
        $this->assertSame(['field' => 'budget_id', 'label' => 'Linked budget (title)', 'from' => null, 'to' => 'Approved budget'], $changes['Linked budget (title)']);
        $this->assertSame(['field' => 'event_id', 'label' => 'Linked event (title)', 'from' => null, 'to' => 'Leadership Seminar 2024'], $changes['Linked event (title)']);
        $this->assertSame(['field' => 'transaction_date', 'label' => 'Date', 'from' => '2026-11-10', 'to' => '2026-11-12'], $changes['Date']);
        $this->assertArrayNotHasKey('Description', $changes->all());
    }

    public function test_the_history_is_read_only_for_the_head_and_closed_to_students_and_other_organizations(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => $this->organization->id]));
        $this->getJson("/api/transactions/{$entry->id}/history")->assertOk()->assertJsonCount(0, 'data');

        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $this->organization->id]));
        $this->getJson("/api/transactions/{$entry->id}/history")->assertForbidden();

        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]));
        $this->getJson("/api/transactions/{$entry->id}/history")->assertNotFound();
        $this->getJson('/api/transactions/999999/history')->assertNotFound();
    }

    public function test_an_entry_a_system_step_unlinked_from_its_budget_reads_as_an_edit_by_the_system(): void
    {
        $entry = $this->entry(['budget_id' => null]);
        AuditLog::create([
            'organization_id' => $this->organization->id, 'user_id' => null, 'module' => 'financial_ledger', 'action' => 'budget_unlinked',
            'record_type' => Transaction::class, 'record_id' => $entry->id,
            'old_values' => ['budget_id' => $this->budget->id], 'new_values' => ['budget_id' => null, 'reason' => 'Budget not approved'], 'created_at' => now(),
        ]);
        Sanctum::actingAs($this->admin);

        $row = $this->getJson("/api/transactions/{$entry->id}/history")->assertOk()->json('data.0');

        $this->assertSame('updated', $row['action']);
        $this->assertSame('System', $row['by']['name']);
        $this->assertSame('Budget not approved', $row['reason']);
        $this->assertSame([['field' => 'budget_id', 'label' => 'Linked budget (title)', 'from' => 'Approved budget', 'to' => null]], $row['changes']);
    }
}
