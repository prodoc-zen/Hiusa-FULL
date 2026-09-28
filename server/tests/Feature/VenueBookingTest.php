<?php

namespace Tests\Feature;

use App\Http\Controllers\VenueBookingController;
use App\Models\Organization;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
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

    public function test_approving_two_overlapping_pending_bookings_for_the_same_venue_rejects_the_second(): void
    {
        // Two pending bookings for the same overlapping slot can coexist
        // (store() only checks against already-approved bookings), so the
        // race is between two approvals: whichever commits first wins, and
        // the venue row lock in review() means the second approval always
        // sees the first's committed result instead of racing past it.
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

        Sanctum::actingAs($adminB);
        $secondBookingId = $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => $day->copy()->setTime(10, 0)->toISOString(),
            'end_time' => $day->copy()->setTime(12, 0)->toISOString(),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/venue-bookings/{$firstBookingId}/review", ['status' => 'approved'])->assertOk();
        $this->patchJson("/api/venue-bookings/{$secondBookingId}/review", ['status' => 'approved'])->assertStatus(409);

        $this->assertSame('approved', VenueBooking::find($firstBookingId)->status);
        $this->assertSame('pending', VenueBooking::find($secondBookingId)->status);
    }

    public function test_venue_availability_returns_approved_slots_within_range_without_organization_names(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $officer = $this->user('SBO_OFFICER', $organization->id);
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        $day = now()->addWeek()->startOfDay();

        Sanctum::actingAs($admin);
        $bookingId = $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => $day->copy()->setTime(9, 0)->toISOString(),
            'end_time' => $day->copy()->setTime(11, 0)->toISOString(),
        ])->assertCreated()->json('id');
        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/venue-bookings/{$bookingId}/review", ['status' => 'approved'])->assertOk();

        Sanctum::actingAs($officer);
        $slots = $this->getJson("/api/venues/{$venue->id}/availability?from={$day->copy()->startOfDay()->toISOString()}&to={$day->copy()->endOfDay()->toISOString()}")
            ->assertOk()->json();
        $this->assertCount(1, $slots);
        $this->assertArrayNotHasKey('organization', $slots[0]);
        $this->assertArrayNotHasKey('organization_id', $slots[0]);

        $outOfRange = $this->getJson("/api/venues/{$venue->id}/availability?from={$day->copy()->addDays(2)->toISOString()}&to={$day->copy()->addDays(3)->toISOString()}")
            ->assertOk()->json();
        $this->assertCount(0, $outOfRange);
    }

    public function test_venue_bookings_index_filters_by_from_and_to(): void
    {
        $admin = $this->user('ADMIN');
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        $day = now()->addWeek()->startOfDay();

        Sanctum::actingAs($admin);
        $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => $day->copy()->setTime(9, 0)->toISOString(),
            'end_time' => $day->copy()->setTime(11, 0)->toISOString(),
        ])->assertCreated();
        $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => $day->copy()->addDays(10)->setTime(9, 0)->toISOString(),
            'end_time' => $day->copy()->addDays(10)->setTime(11, 0)->toISOString(),
        ])->assertCreated();

        $this->getJson('/api/venue-bookings?from='.$day->copy()->startOfDay()->toISOString().'&to='.$day->copy()->endOfDay()->toISOString())
            ->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/venue-bookings')->assertOk()->assertJsonCount(2, 'data');
    }

    public function test_org_admin_can_withdraw_a_pending_booking_but_not_after_it_is_rejected(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $adminA = $this->user('ADMIN', $orgA->id);
        $adminB = $this->user('ADMIN', $orgB->id);
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);

        Sanctum::actingAs($adminA);
        $bookingId = $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => now()->addDay()->toISOString(),
            'end_time' => now()->addDay()->addHour()->toISOString(),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($adminB);
        $this->patchJson("/api/venue-bookings/{$bookingId}/withdraw")->assertStatus(404);

        Sanctum::actingAs($adminA);
        $this->patchJson("/api/venue-bookings/{$bookingId}/withdraw")->assertOk()->assertJsonPath('status', 'withdrawn');
        $this->assertDatabaseHas('audit_logs', ['module' => 'venue_bookings', 'action' => 'booking_withdrawn']);
        $this->assertDatabaseHas('notifications', ['user_id' => $superAdmin->school_id, 'reference_type' => 'venue_booking', 'reference_id' => $bookingId]);

        $this->patchJson("/api/venue-bookings/{$bookingId}/withdraw")->assertStatus(409);
    }

    public function test_a_future_approved_booking_can_be_withdrawn_but_a_past_one_cannot(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $officer = $this->user('SBO_OFFICER', $organization->id);
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);

        Sanctum::actingAs($officer);
        $futureBookingId = $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => now()->addWeek()->toISOString(),
            'end_time' => now()->addWeek()->addHour()->toISOString(),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/venue-bookings/{$futureBookingId}/review", ['status' => 'approved'])->assertOk();

        Sanctum::actingAs($officer);
        $this->patchJson("/api/venue-bookings/{$futureBookingId}/withdraw")->assertOk()->assertJsonPath('status', 'withdrawn');

        $pastBooking = VenueBooking::create([
            'venue_id' => $venue->id, 'organization_id' => $organization->id,
            'start_time' => now()->subDay(), 'end_time' => now()->subDay()->addHour(),
            'status' => 'approved', 'requested_by' => $officer->school_id,
        ]);
        $this->patchJson("/api/venue-bookings/{$pastBooking->id}/withdraw")->assertStatus(409);
    }

    public function test_withdraw_rechecks_status_under_lock_instead_of_trusting_a_stale_pre_lock_read(): void
    {
        // True cross-request concurrency cannot be reproduced against a
        // single synchronous test connection, so this simulates the
        // interleaving sequentially: $staleBooking stands in for the
        // $venueBooking argument route-model-binding would have resolved for
        // an incoming withdraw request the instant before a concurrent
        // reject committed. The controller must not trust that argument's
        // cached status - it must re-derive "pending or future-approved"
        // from the row it locks inside its own transaction.
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

        $staleBooking = VenueBooking::findOrFail($bookingId);

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/venue-bookings/{$bookingId}/review", ['status' => 'rejected', 'remarks' => 'Conflict found.'])->assertOk();

        Sanctum::actingAs($admin);
        $request = Request::create("/api/venue-bookings/{$bookingId}/withdraw", 'PATCH');
        $request->setUserResolver(fn () => $admin);

        $response = (new VenueBookingController)->withdraw($request, $staleBooking);

        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame('rejected', VenueBooking::find($bookingId)->status);
    }

    public function test_review_notifies_a_profile_based_officer_of_the_booking_organization(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $main = Organization::factory()->create();
        $child = Organization::factory()->create(['parent_organization_id' => $main->id]);
        $childAdmin = $this->user('ADMIN', $child->id);
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);

        // Home organization is $main, but invited into $child as an officer
        // via an account profile - not a home membership.
        $invitedOfficer = User::factory()->create(['role' => 'STUDENT', 'organization_id' => $main->id, 'account_status' => 'active']);
        $invitedOfficer->accountProfiles()->create(['organization_id' => $child->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active']);

        Sanctum::actingAs($childAdmin);
        $bookingId = $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'start_time' => now()->addDay()->toISOString(),
            'end_time' => now()->addDay()->addHour()->toISOString(),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/venue-bookings/{$bookingId}/review", ['status' => 'approved'])->assertOk();

        $this->assertDatabaseHas('notifications', [
            'organization_id' => $child->id,
            'user_id' => $invitedOfficer->school_id,
            'reference_type' => 'venue_booking',
            'reference_id' => $bookingId,
        ]);
    }
}
