<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CancelledEventEditTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_cancelled_event_cannot_be_edited_back_into_planning(): void
    {
        $admin = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN']);
        $event = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'status' => 'cancelled',
            'approved_at' => now()->subWeek(),
            'title' => 'Cancelled Fair',
        ]);
        Sanctum::actingAs($admin);

        $this->putJson("/api/events/{$event->id}", ['title' => 'Cancelled Fair, new date'])->assertStatus(409);

        $event->refresh();
        $this->assertSame('cancelled', $event->status);
        $this->assertSame('Cancelled Fair', $event->title);
    }

    public function test_a_completed_event_still_cannot_be_edited(): void
    {
        $admin = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN']);
        $event = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'status' => 'completed',
            'approved_at' => now()->subWeek(),
        ]);
        Sanctum::actingAs($admin);

        $this->putJson("/api/events/{$event->id}", ['title' => 'Late rename'])->assertStatus(409);
    }
}
