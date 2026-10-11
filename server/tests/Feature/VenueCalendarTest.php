<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class VenueCalendarTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role, ?int $organizationId = null): User
    {
        return User::factory()->create(['role' => $role, 'organization_id' => $organizationId ?? Organization::factory(), 'account_status' => 'active']);
    }

    private function booking(Venue $venue, Organization $organization, string $status, Carbon $start, Carbon $end, ?Event $event = null): VenueBooking
    {
        return VenueBooking::create([
            'venue_id' => $venue->id,
            'organization_id' => $organization->id,
            'event_id' => $event?->id,
            'status' => $status,
            'requested_by' => User::factory()->create()->school_id,
            'start_time' => $start,
            'end_time' => $end,
        ]);
    }

    public function test_sao_availability_names_the_occupant_organization_and_event_for_every_organization(): void
    {
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        $day = Carbon::parse('2026-11-03 00:00:00', 'Asia/Manila');
        $alpha = Organization::factory()->create(['name' => 'Alpha Society', 'acronym' => 'ALPHA']);
        $beta = Organization::factory()->create(['name' => 'Beta Guild', 'acronym' => 'BETA']);
        $alphaEvent = Event::factory()->create(['organization_id' => $alpha->id, 'title' => 'Alpha Summit', 'status' => 'approved']);
        $this->booking($venue, $alpha, 'approved', $day->copy()->setTime(9, 0), $day->copy()->setTime(11, 0), $alphaEvent);
        $this->booking($venue, $beta, 'pending', $day->copy()->setTime(13, 0), $day->copy()->setTime(14, 0));

        Sanctum::actingAs($this->user('SUPER_ADMIN'));
        $slots = $this->getJson("/api/venues/{$venue->id}/availability?from={$day->toISOString()}&to={$day->copy()->endOfDay()->toISOString()}")
            ->assertOk()->json();

        $this->assertCount(2, $slots);
        $this->assertSame('Alpha Society', $slots[0]['reserved_by']);
        $this->assertSame('Alpha Society', $slots[0]['organization']['name']);
        $this->assertSame('ALPHA', $slots[0]['organization']['acronym']);
        $this->assertSame('Alpha Summit', $slots[0]['event_title']);
        $this->assertSame('approved', $slots[0]['status']);
        $this->assertSame('Beta Guild', $slots[1]['organization']['name']);
        $this->assertNull($slots[1]['event_title']);
        $this->assertArrayHasKey('start_time', $slots[1]);
        $this->assertArrayHasKey('end_time', $slots[1]);
    }

    public function test_other_roles_still_never_see_the_occupant_organization_or_event(): void
    {
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        $day = Carbon::parse('2026-11-03 00:00:00', 'Asia/Manila');
        $alpha = Organization::factory()->create(['name' => 'Alpha Society', 'acronym' => 'ALPHA']);
        $event = Event::factory()->create(['organization_id' => $alpha->id, 'title' => 'Alpha Summit', 'status' => 'approved']);
        $this->booking($venue, $alpha, 'approved', $day->copy()->setTime(9, 0), $day->copy()->setTime(11, 0), $event);
        $range = "from={$day->toISOString()}&to={$day->copy()->endOfDay()->toISOString()}";

        foreach (['ADMIN', 'SBO_OFFICER'] as $role) {
            Sanctum::actingAs($this->user($role));
            $response = $this->getJson("/api/venues/{$venue->id}/availability?{$range}")->assertOk();
            $slot = $response->json('0');

            $this->assertSame('Another organization', $slot['reserved_by']);
            $this->assertArrayNotHasKey('organization', $slot);
            $this->assertArrayNotHasKey('organization_id', $slot);
            $this->assertArrayNotHasKey('event_title', $slot);
            $this->assertArrayNotHasKey('event_id', $slot);
            $this->assertStringNotContainsString('Alpha', $response->getContent());
        }

        Sanctum::actingAs($this->user('ADMIN', $alpha->id));
        $this->assertSame('Your organization', $this->getJson("/api/venues/{$venue->id}/availability?{$range}")->json('0.reserved_by'));
    }

    public function test_availability_uses_strict_overlap_so_back_to_back_bookings_do_not_conflict(): void
    {
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        $day = Carbon::parse('2026-11-03 00:00:00', 'Asia/Manila');
        $organization = Organization::factory()->create();
        $this->booking($venue, $organization, 'approved', $day->copy()->setTime(9, 0), $day->copy()->setTime(10, 0));

        foreach (['SUPER_ADMIN', 'ADMIN'] as $role) {
            Sanctum::actingAs($this->user($role));
            $after = $this->getJson("/api/venues/{$venue->id}/availability?from={$day->copy()->setTime(10, 0)->toISOString()}&to={$day->copy()->setTime(11, 0)->toISOString()}");
            $this->assertCount(0, $after->assertOk()->json(), "{$role}: a booking ending at 10:00 must not clash with 10:00-11:00");

            $before = $this->getJson("/api/venues/{$venue->id}/availability?from={$day->copy()->setTime(8, 0)->toISOString()}&to={$day->copy()->setTime(9, 0)->toISOString()}");
            $this->assertCount(0, $before->assertOk()->json(), "{$role}: a booking starting at 9:00 must not clash with 8:00-9:00");

            $inside = $this->getJson("/api/venues/{$venue->id}/availability?from={$day->copy()->setTime(9, 59)->toISOString()}&to={$day->copy()->setTime(11, 0)->toISOString()}");
            $this->assertCount(1, $inside->assertOk()->json());
        }
    }

    public function test_a_venue_with_any_booking_cannot_be_deleted_and_the_message_points_to_the_inactive_toggle(): void
    {
        $organization = Organization::factory()->create();
        $start = Carbon::parse('2026-11-03 09:00:00', 'Asia/Manila');
        Sanctum::actingAs($this->user('SUPER_ADMIN'));

        foreach (['pending', 'approved', 'rejected', 'withdrawn'] as $status) {
            $venue = Venue::create(['name' => "Hall {$status}", 'location' => 'Main Campus', 'capacity' => 100]);
            $this->booking($venue, $organization, $status, $start, $start->copy()->addHour());

            $response = $this->deleteJson("/api/venues/{$venue->id}")->assertStatus(409);
            $this->assertStringContainsString('inactive', $response->json('message'));
            $this->assertDatabaseHas('venues', ['id' => $venue->id]);
        }

        $unused = Venue::create(['name' => 'Annex', 'location' => 'Main Campus', 'capacity' => 20]);
        $this->deleteJson("/api/venues/{$unused->id}")->assertOk();
        $this->assertDatabaseMissing('venues', ['id' => $unused->id]);
    }

    public function test_pages_of_bookings_sharing_one_start_time_return_every_booking_exactly_once(): void
    {
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        $organization = Organization::factory()->create();
        $requester = User::factory()->create();
        $start = Carbon::parse('2026-11-03 08:00:00', 'Asia/Manila')->utc();
        $ids = [];
        for ($i = 0; $i < 130; $i++) {
            $ids[] = VenueBooking::create([
                'venue_id' => $venue->id,
                'organization_id' => $organization->id,
                'status' => 'approved',
                'requested_by' => $requester->school_id,
                'start_time' => $start,
                'end_time' => $start->copy()->addHour(),
            ])->id;
        }

        Sanctum::actingAs($this->user('SUPER_ADMIN'));
        $query = 'status=approved&per_page=100&from='.urlencode($start->copy()->subDay()->toISOString()).'&to='.urlencode($start->copy()->addDay()->toISOString());
        $queries = [];
        DB::listen(function ($executed) use (&$queries) {
            $queries[] = $executed->sql;
        });
        $first = $this->getJson("/api/venue-bookings?{$query}&page=1")->assertOk()->json('data');
        $second = $this->getJson("/api/venue-bookings?{$query}&page=2")->assertOk()->json('data');

        $returned = array_merge(array_column($first, 'id'), array_column($second, 'id'));
        $this->assertCount(100, $first);
        $this->assertCount(30, $second);
        $this->assertCount(130, array_unique($returned));
        $this->assertEqualsCanonicalizing($ids, $returned);
        $listing = array_values(array_filter($queries, fn ($sql) => str_contains($sql, 'from "venue_bookings"') && str_contains($sql, 'limit')));
        $this->assertNotEmpty($listing);
        foreach ($listing as $sql) {
            $this->assertMatchesRegularExpression('/order by "start_time" desc, "id" desc/', $sql);
        }
    }
}
