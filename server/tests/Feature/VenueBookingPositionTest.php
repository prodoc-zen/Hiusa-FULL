<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class VenueBookingPositionTest extends TestCase
{
    use RefreshDatabase;

    private function officer(Organization $organization, ?string $position): User
    {
        return User::factory()->create(['role' => 'SBO_OFFICER', 'organization_id' => $organization->id, 'account_status' => 'active', 'position_title' => $position]);
    }

    private function payload(Venue $venue): array
    {
        return [
            'venue_id' => $venue->id,
            'start_time' => now()->addDay()->setTime(9, 0)->toISOString(),
            'end_time' => now()->addDay()->setTime(10, 0)->toISOString(),
        ];
    }

    private function position(Organization $organization, string $title, string $role = 'SBO_OFFICER'): SboPosition
    {
        return SboPosition::create(['organization_id' => $organization->id, 'role' => $role, 'title' => $title, 'is_active' => true]);
    }

    public function test_new_positions_default_the_booking_switch_by_title(): void
    {
        $organization = Organization::factory()->create();

        $on = ['President', "Vice President \u{2013} Internal", 'Vice President - External', 'Secretary', 'Business Manager'];
        $off = ['Assistant Secretary', 'Treasurer', 'Auditor', 'Public Information Officer', 'Representative'];
        foreach ([...$on, ...$off] as $title) {
            $this->position($organization, $title);
        }

        foreach ($on as $title) {
            $this->assertTrue((bool) SboPosition::where('title', $title)->value('can_book_venues'), "{$title} should default ON");
        }
        foreach ($off as $title) {
            $this->assertFalse((bool) SboPosition::where('title', $title)->value('can_book_venues'), "{$title} should default OFF");
        }
    }

    public function test_the_positions_endpoint_creates_with_the_title_default_and_an_admin_can_switch_it(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['role' => 'ADMIN', 'organization_id' => $organization->id, 'account_status' => 'active']);
        Sanctum::actingAs($admin);

        $secretary = $this->postJson('/api/sbo-positions', ['role' => 'SBO_OFFICER', 'title' => 'Secretary'])->assertCreated()->assertJsonPath('can_book_venues', true)->json('id');
        $treasurer = $this->postJson('/api/sbo-positions', ['role' => 'SBO_OFFICER', 'title' => 'Treasurer'])->assertCreated()->assertJsonPath('can_book_venues', false)->json('id');

        $this->putJson("/api/sbo-positions/{$treasurer}", ['can_book_venues' => true])->assertOk()->assertJsonPath('can_book_venues', true);
        $this->putJson("/api/sbo-positions/{$secretary}", ['can_book_venues' => false])->assertOk()->assertJsonPath('can_book_venues', false);
        $this->putJson("/api/sbo-positions/{$secretary}", ['description' => 'Keeps the minutes'])->assertOk()->assertJsonPath('can_book_venues', false);
        $this->putJson("/api/sbo-positions/{$secretary}", ['can_book_venues' => 'maybe'])->assertUnprocessable();
    }

    public function test_an_officer_whose_position_cannot_book_is_refused_on_create_and_withdraw(): void
    {
        $organization = Organization::factory()->create();
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        $this->position($organization, 'Treasurer');
        $treasurer = $this->officer($organization, 'Treasurer');
        $admin = User::factory()->create(['role' => 'ADMIN', 'organization_id' => $organization->id, 'account_status' => 'active']);

        Sanctum::actingAs($treasurer);
        $this->postJson('/api/venue-bookings', $this->payload($venue))
            ->assertForbidden()
            ->assertJsonPath('message', 'Your position cannot book venues. Ask your Admin.');
        $this->assertSame(0, VenueBooking::count());

        Sanctum::actingAs($admin);
        $bookingId = $this->postJson('/api/venue-bookings', $this->payload($venue))->assertCreated()->json('id');

        Sanctum::actingAs($treasurer);
        $this->patchJson("/api/venue-bookings/{$bookingId}/withdraw")
            ->assertForbidden()
            ->assertJsonPath('message', 'Your position cannot book venues. Ask your Admin.');
        $this->assertSame('pending', VenueBooking::find($bookingId)->status);
    }

    public function test_an_officer_whose_position_can_book_is_allowed_and_an_admin_switch_takes_effect_at_once(): void
    {
        $organization = Organization::factory()->create();
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        $position = $this->position($organization, 'Secretary');
        $secretary = $this->officer($organization, 'Secretary');

        Sanctum::actingAs($secretary);
        $bookingId = $this->postJson('/api/venue-bookings', $this->payload($venue))->assertCreated()->json('id');

        $position->update(['can_book_venues' => false]);
        $this->patchJson("/api/venue-bookings/{$bookingId}/withdraw")->assertForbidden();

        $position->update(['can_book_venues' => true]);
        $this->patchJson("/api/venue-bookings/{$bookingId}/withdraw")->assertOk();
    }

    public function test_an_unlisted_title_follows_the_position_default_and_an_officer_with_no_title_cannot_book(): void
    {
        $organization = Organization::factory()->create();
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);

        Sanctum::actingAs($this->officer($organization, 'Demo Representative'));
        $this->postJson('/api/venue-bookings', $this->payload($venue))
            ->assertForbidden()
            ->assertJsonPath('message', 'Your position cannot book venues. Ask your Admin.');

        Sanctum::actingAs($this->officer($organization, null));
        $this->postJson('/api/venue-bookings', $this->payload($venue))->assertForbidden();

        Sanctum::actingAs($this->officer($organization, 'Business Manager'));
        $this->postJson('/api/venue-bookings', $this->payload($venue))->assertCreated();
    }

    public function test_the_switch_is_read_from_the_officers_own_organization_only(): void
    {
        $organization = Organization::factory()->create();
        $other = Organization::factory()->create();
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        $this->position($organization, 'Treasurer');
        $this->position($other, 'Treasurer')->update(['can_book_venues' => true]);

        Sanctum::actingAs($this->officer($organization, 'Treasurer'));
        $this->postJson('/api/venue-bookings', $this->payload($venue))->assertForbidden();
    }

    public function test_the_migration_backfills_the_switch_for_existing_positions_by_title(): void
    {
        $organization = Organization::factory()->create();
        $migration = require database_path('migrations/2026_11_13_100002_add_can_book_venues_to_sbo_positions.php');
        $migration->down();

        $titles = ['President', "Vice President \u{2013} Internal", 'Secretary', 'Business Manager', 'Assistant Secretary', 'Treasurer', 'Auditor'];
        foreach (['ADMIN', 'SBO_OFFICER'] as $role) {
            foreach ($titles as $title) {
                DB::table('sbo_positions')->insert(['organization_id' => $organization->id, 'role' => $role, 'title' => $title, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
            }
        }
        $migration->up();

        $on = DB::table('sbo_positions')->where('can_book_venues', true)->pluck('title')->unique()->sort()->values()->all();
        $this->assertSame(['Business Manager', 'President', 'Secretary', "Vice President \u{2013} Internal"], $on);
        $this->assertSame(0, DB::table('sbo_positions')->where('title', 'Assistant Secretary')->where('can_book_venues', true)->count());
    }

    public function test_the_signed_in_user_payload_says_whether_the_account_can_book_venues(): void
    {
        $organization = Organization::factory()->create();
        $this->position($organization, 'Treasurer');
        $this->position($organization, 'Secretary');
        $admin = User::factory()->create(['role' => 'ADMIN', 'organization_id' => $organization->id, 'account_status' => 'active']);

        Sanctum::actingAs($this->officer($organization, 'Treasurer'));
        $this->getJson('/api/user')->assertOk()->assertJsonPath('can_book_venues', false);

        Sanctum::actingAs($this->officer($organization, 'Secretary'));
        $this->getJson('/api/user')->assertOk()->assertJsonPath('can_book_venues', true);

        Sanctum::actingAs($admin);
        $this->getJson('/api/user')->assertOk()->assertJsonPath('can_book_venues', true);
    }
}
