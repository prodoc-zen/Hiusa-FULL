<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EventImageCleanupTest extends TestCase
{
    use RefreshDatabase;

    private function adminWithPosterEvent(): array
    {
        Storage::fake('public');
        Storage::disk('public')->put('events/poster.jpg', 'image-bytes');

        $admin = User::factory()->create([
            'organization_id' => Organization::factory(),
            'role' => 'ADMIN',
            'account_status' => 'active',
        ]);
        $event = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'status' => 'planning',
            'image_url' => Storage::disk('public')->url('events/poster.jpg'),
        ]);
        Sanctum::actingAs($admin);

        return [$admin, $event];
    }

    public function test_removing_an_event_image_deletes_the_stored_file(): void
    {
        [, $event] = $this->adminWithPosterEvent();

        $this->putJson("/api/events/{$event->id}", ['remove_image' => true])->assertOk();

        $this->assertNull($event->fresh()->image_url);
        Storage::disk('public')->assertMissing('events/poster.jpg');
    }

    public function test_deleting_an_event_with_an_image_deletes_the_stored_file(): void
    {
        [, $event] = $this->adminWithPosterEvent();

        $this->deleteJson("/api/events/{$event->id}")->assertOk();

        $this->assertModelMissing($event);
        Storage::disk('public')->assertMissing('events/poster.jpg');
    }
}
