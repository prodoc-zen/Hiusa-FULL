<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Models\Venue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EventVenueChoiceTest extends TestCase
{
    use RefreshDatabase;

    public function test_on_campus_venue_is_selected_from_the_sao_catalog_and_off_campus_requires_a_location(): void
    {
        $org = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $org->id]));
        $venue = Venue::create(['name' => 'Main Auditorium', 'location' => 'North Campus', 'capacity' => 300, 'is_active' => true]);
        $dates = ['start_time' => now()->addWeek()->toISOString(), 'end_time' => now()->addWeek()->addHour()->toISOString()];

        $this->postJson('/api/events', ['title' => 'Missing venue', 'planning_details' => ['venue_type' => 'on_campus'], ...$dates])->assertUnprocessable();
        $event = $this->postJson('/api/events', ['title' => 'Campus event', 'location' => 'Spoofed', 'planning_details' => ['venue_type' => 'on_campus', 'venue_id' => $venue->id], ...$dates])
            ->assertCreated()->assertJsonPath('location', 'Main Auditorium')->json('id');
        $this->putJson("/api/events/{$event}", ['planning_details' => ['venue_type' => 'off_campus'], 'location' => ''])->assertUnprocessable();
        $this->putJson("/api/events/{$event}", ['planning_details' => ['venue_type' => 'off_campus'], 'location' => 'City Convention Center'])
            ->assertOk()->assertJsonPath('location', 'City Convention Center');
    }
}
