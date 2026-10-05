<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class OldEventCollectionBackfillTest extends TestCase
{
    use RefreshDatabase;

    public function test_collections_verified_before_the_fix_gain_their_event_on_the_ledger(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $event = Event::factory()->create(['organization_id' => $organization->id]);
        $untouched = Transaction::factory()->create(['organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'budget_id' => null, 'event_id' => null, 'payer_id' => null]);
        $old = Transaction::factory()->create(['organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'budget_id' => null, 'event_id' => null, 'payer_id' => null]);
        $collection = [
            'organization_id' => $organization->id, 'source' => 'Sports Fest registration', 'amount_collected' => 500,
            'collected_by' => $admin->school_id, 'collected_at' => now(), 'status' => 'verified', 'created_at' => now(), 'updated_at' => now(),
        ];
        DB::table('collections')->insert([...$collection, 'reference' => 'COL-OLD', 'event_id' => $event->id, 'ledger_transaction_id' => $old->id]);
        DB::table('collections')->insert([...$collection, 'reference' => 'COL-NOEVENT', 'event_id' => null, 'ledger_transaction_id' => $untouched->id]);

        (require database_path('migrations/2026_10_06_000001_attribute_old_event_collections_to_their_event.php'))->up();

        $this->assertSame($event->id, $old->fresh()->event_id);
        $this->assertNull($untouched->fresh()->event_id);
    }
}
