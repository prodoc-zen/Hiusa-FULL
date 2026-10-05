<?php

namespace Tests\Feature;

use App\Models\Collection;
use App\Models\Event;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A collection taken for an event is that event's income. Verifying it must
 * carry the event to the ledger entry, because the event's ledger filter,
 * its summary and its event financial report all read the entry's event.
 */
class CollectionEventAttributionTest extends TestCase
{
    use RefreshDatabase;

    private User $collector;

    private User $verifier;

    private Event $event;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $this->collector = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->verifier = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->event = Event::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $this->collector->school_id, 'status' => 'approved',
            'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(3),
        ]);
    }

    private function verifiedCollection(?int $eventId): Collection
    {
        Sanctum::actingAs($this->collector);
        $id = $this->postJson('/api/collections', array_filter([
            'amount_collected' => '500.00', 'source' => 'Ticket sales', 'event_id' => $eventId,
        ]))->assertCreated()->json('id');
        Sanctum::actingAs($this->verifier);
        $this->patchJson("/api/collections/{$id}/verify")->assertOk();

        return Collection::findOrFail($id);
    }

    public function test_a_verified_collection_carries_its_event_to_the_ledger_entry(): void
    {
        $collection = $this->verifiedCollection($this->event->id);

        $this->assertSame($this->event->id, Transaction::findOrFail($collection->ledger_transaction_id)->event_id);

        $this->getJson("/api/transactions?event_id={$this->event->id}")->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $collection->ledger_transaction_id)
            ->assertJsonPath('data.0.event.id', $this->event->id);
        $this->getJson("/api/transactions/summary?event_id={$this->event->id}")->assertOk()
            ->assertJsonPath('total_income', 500)
            ->assertJsonPath('net_balance', 500);
        $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'event', 'event_id' => $this->event->id,
            'signatories' => ['treasurer' => 'Taylor Treasurer', 'president' => 'Pat President', 'adviser' => 'Alex Adviser', 'sbo_adviser' => 'Sam SBO Adviser'],
        ])->assertCreated()->assertJsonPath('totals.income', 500);
    }

    public function test_a_collection_without_an_event_leaves_its_ledger_entry_unattributed(): void
    {
        $collection = $this->verifiedCollection(null);

        $this->assertNull(Transaction::findOrFail($collection->ledger_transaction_id)->event_id);
        $this->getJson("/api/transactions?event_id={$this->event->id}")->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/transactions')->assertOk()->assertJsonPath('total', 1);
    }
}
