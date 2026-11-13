<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
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

    public function test_the_booking_default_matches_vice_president_seats_exactly(): void
    {
        $this->assertTrue(SboPosition::bookingDefaultFor('Vice-President'));
        $this->assertTrue(SboPosition::bookingDefaultFor('Vice President for Academic Affairs'));
        $this->assertTrue(SboPosition::bookingDefaultFor('Secretary'));
        $this->assertFalse(SboPosition::bookingDefaultFor('Vice Presidential Aide'));
        $this->assertFalse(SboPosition::bookingDefaultFor("Vice President's Assistant"));
        $this->assertFalse(SboPosition::bookingDefaultFor('Assistant Secretary'));
    }

    public function test_a_switched_off_position_stays_off_for_every_spelling_of_its_title_and_an_inactive_row_cannot_book(): void
    {
        $organization = Organization::factory()->create();
        $this->position($organization, 'Business Manager')->update(['can_book_venues' => false]);

        foreach (['Business Manager', 'Business-Manager', 'business manager', "Business\u{00A0}Manager", '  Business   Manager '] as $title) {
            $this->assertFalse($this->officer($organization, $title)->canBookVenues(), "'{$title}' should not book");
        }

        $this->position($organization, 'Auditor')->update(['can_book_venues' => true, 'is_active' => false]);
        $this->assertFalse($this->officer($organization, 'Auditor')->canBookVenues());

        $this->assertFalse($this->officer($organization, null)->canBookVenues());
        $this->assertFalse($this->officer($organization, '   ')->canBookVenues());
        $this->assertTrue($this->officer($organization, 'Secretary')->canBookVenues());
    }

    public function test_renaming_deactivating_or_deleting_a_position_moves_the_officers_profile_title_and_booking_follows(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['role' => 'ADMIN', 'organization_id' => $organization->id, 'account_status' => 'active']);
        $position = $this->position($organization, 'Business Manager');
        $held = function (string $title) use ($organization) {
            $officer = $this->officer($organization, $title);
            AccountProfile::updateOrCreate(
                ['user_school_id' => $officer->school_id, 'organization_id' => $organization->id],
                ['role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => $title],
            );

            return $officer;
        };
        $title = fn (User $officer) => AccountProfile::where('user_school_id', $officer->school_id)->where('organization_id', $organization->id)->value('position_title');
        $canBook = function (User $officer) {
            Sanctum::actingAs(User::find($officer->school_id));

            return $this->getJson('/api/user')->assertOk()->json('can_book_venues');
        };

        $exact = $held('Business Manager');
        $spelled = $held('Business-Manager');
        Sanctum::actingAs($admin);
        $this->putJson("/api/sbo-positions/{$position->id}", ['title' => 'Finance Head'])->assertOk();
        $this->assertSame('Finance Head', $title($exact));
        $this->assertSame('Finance Head', $title($spelled));
        $this->assertSame('Finance Head', User::find($spelled->school_id)->getAttributes()['position_title']);
        $this->assertTrue($canBook($exact));

        $this->position($organization, 'Business Manager');
        $deactivated = $held('Business Manager');
        Sanctum::actingAs($admin);
        $this->putJson('/api/sbo-positions/'.SboPosition::where('title', 'Business Manager')->value('id'), ['is_active' => false])->assertOk();
        $this->assertNull($title($deactivated));
        $this->assertFalse($canBook($deactivated));

        $deletedPosition = $this->position($organization, 'Secretary');
        $deleted = $held('Secretary');
        $this->assertTrue($canBook($deleted));
        Sanctum::actingAs($admin);
        $this->deleteJson("/api/sbo-positions/{$deletedPosition->id}")->assertOk();
        $this->assertNull($title($deleted));
        $this->assertFalse($canBook($deleted));
    }

    public function test_titles_that_differ_only_by_spelling_cannot_be_added_and_stored_twins_each_keep_their_own_switch(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['role' => 'ADMIN', 'organization_id' => $organization->id, 'account_status' => 'active']);
        $this->position($organization, 'Business Manager')->update(['can_book_venues' => false]);
        Sanctum::actingAs($admin);

        $this->postJson('/api/sbo-positions', ['role' => 'SBO_OFFICER', 'title' => 'Business-Manager'])
            ->assertStatus(422)->assertJsonPath('errors.title.0', 'A position with this title already exists.');
        $this->postJson('/api/sbo-positions', ['role' => 'ADMIN', 'title' => 'business  manager'])->assertCreated();
        $other = $this->position($organization, 'Treasurer');
        $this->putJson("/api/sbo-positions/{$other->id}", ['title' => 'Business-Manager'])
            ->assertStatus(422)->assertJsonPath('errors.title.0', 'A position with this title already exists.');
        $this->putJson("/api/sbo-positions/{$other->id}", ['title' => 'Treasurer', 'description' => 'Keeps its own title'])->assertOk();

        // Twins stored before the rule existed: the exact title decides, whichever row was stored first.
        $this->position($organization, 'Business-Manager')->update(['can_book_venues' => true]);
        $this->assertFalse($this->officer($organization, 'Business Manager')->canBookVenues());
        $this->assertTrue($this->officer($organization, 'Business-Manager')->canBookVenues());
    }

    public function test_deleting_one_stored_twin_moves_only_its_exact_holders(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['role' => 'ADMIN', 'organization_id' => $organization->id, 'account_status' => 'active']);
        $plain = $this->position($organization, 'Business Manager');
        $this->position($organization, 'Business-Manager');
        $plainHolder = $this->officer($organization, 'Business Manager');
        $dashHolder = $this->officer($organization, 'Business-Manager');
        Sanctum::actingAs($admin);

        $this->deleteJson("/api/sbo-positions/{$plain->id}")->assertOk();

        $this->assertNull(User::find($plainHolder->school_id)->getRawOriginal('position_title'));
        $this->assertSame('Business-Manager', User::find($dashHolder->school_id)->getRawOriginal('position_title'));
    }

    public function test_a_profile_without_a_title_does_not_borrow_the_title_on_the_home_organization(): void
    {
        $home = Organization::factory()->create();
        $other = Organization::factory()->create();
        $this->position($other, 'Secretary')->update(['can_book_venues' => true]);
        $officer = $this->officer($home, 'Secretary');
        $profile = AccountProfile::updateOrCreate(
            ['user_school_id' => $officer->school_id, 'organization_id' => $other->id],
            ['role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => null],
        );

        $this->app['auth']->forgetGuards();
        $token = $officer->createToken('other-profile');
        $token->accessToken->forceFill(['account_profile_id' => $profile->id])->save();

        $this->withToken($token->plainTextToken)->getJson('/api/user')->assertOk()
            ->assertJsonPath('can_book_venues', false)->assertJsonPath('position_title', null);
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

        $titles = ['President', "Vice President \u{2013} Internal", 'Secretary', 'Business Manager', 'Assistant Secretary', 'Treasurer', 'Auditor', 'Vice Presidential Aide', "Vice President's Assistant", 'Vice-President'];
        foreach (['ADMIN', 'SBO_OFFICER'] as $role) {
            foreach ($titles as $title) {
                DB::table('sbo_positions')->insert(['organization_id' => $organization->id, 'role' => $role, 'title' => $title, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
            }
        }
        $migration->up();

        $on = DB::table('sbo_positions')->where('can_book_venues', true)->pluck('title')->unique()->sort()->values()->all();
        $this->assertSame(['Business Manager', 'President', 'Secretary', "Vice President \u{2013} Internal", 'Vice-President'], $on);
        $this->assertSame(0, DB::table('sbo_positions')->whereIn('title', ['Vice Presidential Aide', "Vice President's Assistant"])->where('can_book_venues', true)->count());
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
