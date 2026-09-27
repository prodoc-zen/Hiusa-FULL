<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class VenueBookingTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role, ?int $organizationId = null): User
    {
        return User::factory()->create(['role' => $role, 'organization_id' => $organizationId ?? Organization::factory(), 'account_status' => 'active']);
    }

    public function test_only_super_admin_manages_the_venue_catalog(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $admin = $this->user('ADMIN');

        Sanctum::actingAs($admin);
        $this->postJson('/api/venues', ['name' => 'Gymnasium', 'location' => 'Main Campus', 'capacity' => 200])->assertForbidden();

        Sanctum::actingAs($superAdmin);
        $venueId = $this->postJson('/api/venues', ['name' => 'Gymnasium', 'location' => 'Main Campus', 'capacity' => 200])
            ->assertCreated()->json('id');
        $this->assertDatabaseHas('audit_logs', ['module' => 'venues', 'action' => 'venue_created']);

        $this->putJson("/api/venues/{$venueId}", ['capacity' => 250])->assertOk()->assertJsonPath('capacity', 250);
    }

    public function test_admin_and_officer_can_request_a_booking_for_their_own_organization_only(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $officer = $this->user('SBO_OFFICER', $organization->id);
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);

        Sanctum::actingAs($admin);
        $bookingId = $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => now()->addDay()->setTime(9, 0)->toISOString(),
            'end_time' => now()->addDay()->setTime(11, 0)->toISOString(),
        ])->assertCreated()->json('id');

        $this->assertSame($organization->id, VenueBooking::find($bookingId)->organization_id);
        $this->assertDatabaseHas('notifications', ['user_id' => $superAdmin->school_id, 'reference_type' => 'venue_booking', 'reference_id' => $bookingId]);

        Sanctum::actingAs($officer);
        $this->getJson('/api/venue-bookings')->assertOk()->assertJsonCount(1, 'data');

        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);
        $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => now()->addDay()->toISOString(),
            'end_time' => now()->addDay()->addHour()->toISOString(),
        ])->assertForbidden();
    }

    public function test_overlap_is_rejected_but_touching_boundary_is_allowed(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $adminA = $this->user('ADMIN', $orgA->id);
        $adminB = $this->user('ADMIN', $orgB->id);
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        $day = now()->addWeek()->startOfDay();

        Sanctum::actingAs($adminA);
        $firstBookingId = $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => $day->copy()->setTime(9, 0)->toISOString(),
            'end_time' => $day->copy()->setTime(11, 0)->toISOString(),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/venue-bookings/{$firstBookingId}/review", ['status' => 'approved'])->assertOk();

        Sanctum::actingAs($adminB);
        // Overlapping the now-approved 9-11 booking must be rejected at request time.
        $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => $day->copy()->setTime(10, 0)->toISOString(),
            'end_time' => $day->copy()->setTime(12, 0)->toISOString(),
        ])->assertStatus(422);

        // Starting exactly when the approved booking ends must be allowed.
        $secondBookingId = $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => $day->copy()->setTime(11, 0)->toISOString(),
            'end_time' => $day->copy()->setTime(13, 0)->toISOString(),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/venue-bookings/{$secondBookingId}/review", ['status' => 'approved'])->assertOk();
        $this->assertSame('approved', VenueBooking::find($secondBookingId)->status);
    }

    public function test_rejecting_a_booking_requires_remarks_and_notifies_the_organization(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);

        Sanctum::actingAs($admin);
        $bookingId = $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => now()->addDay()->toISOString(),
            'end_time' => now()->addDay()->addHour()->toISOString(),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/venue-bookings/{$bookingId}/review", ['status' => 'rejected'])->assertStatus(422);
        $this->patchJson("/api/venue-bookings/{$bookingId}/review", ['status' => 'rejected', 'remarks' => 'Venue is under maintenance.'])
            ->assertOk()->assertJsonPath('status', 'rejected');

        $this->assertDatabaseHas('notifications', ['user_id' => $admin->school_id, 'reference_type' => 'venue_booking', 'reference_id' => $bookingId]);
        $this->patchJson("/api/venue-bookings/{$bookingId}/review", ['status' => 'approved'])->assertStatus(409);
    }

    public function test_organization_b_admin_cannot_see_or_review_organization_a_bookings(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $adminA = $this->user('ADMIN', $orgA->id);
        $adminB = $this->user('ADMIN', $orgB->id);
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);

        Sanctum::actingAs($adminA);
        $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => now()->addDay()->toISOString(),
            'end_time' => now()->addDay()->addHour()->toISOString(),
        ])->assertCreated();

        Sanctum::actingAs($adminB);
        $this->getJson('/api/venue-bookings')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_venue_with_active_booking_cannot_be_deleted(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);

        Sanctum::actingAs($admin);
        $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => now()->addDay()->toISOString(),
            'end_time' => now()->addDay()->addHour()->toISOString(),
        ])->assertCreated();

        Sanctum::actingAs($superAdmin);
        $this->deleteJson("/api/venues/{$venue->id}")->assertStatus(409);
    }
}
