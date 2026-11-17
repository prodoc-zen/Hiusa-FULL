<?php

namespace Tests\Feature;

use App\Http\Middleware\EnsureProfileCanWrite;
use App\Models\AccountProfile;
use App\Models\College;
use App\Models\Event;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class ViewOnlySeatTest extends TestCase
{
    use CreatesCollegeFixtures, RefreshDatabase;

    private College $college;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();

        $this->college = $this->makeCollege('COC');
        $this->makeCollegeHome($this->college);
        $this->organization = $this->makeCollegeStudentOrganization($this->college, ['name' => 'Computing Society']);
    }

    /** An organization head seat, with or without the view only switch. */
    private function seat(bool $viewOnly, string $title = 'Adviser'): User
    {
        $user = User::factory()->admin()->create(['organization_id' => $this->organization->id, 'position_title' => $title]);
        $user->accountProfiles()->where('organization_id', $this->organization->id)->update(['view_only' => $viewOnly]);

        return $user->fresh();
    }

    private function event(User $by): Event
    {
        return Event::create([
            'organization_id' => $this->organization->id, 'created_by' => $by->school_id, 'title' => 'Foundation Day',
            'start_time' => now()->addDays(10), 'end_time' => now()->addDays(10)->addHours(2), 'status' => 'planning',
        ]);
    }

    public function test_a_view_only_seat_reads_everything_but_changes_nothing(): void
    {
        $head = $this->seat(false, 'President');
        $event = $this->event($head);
        $adviser = $this->seat(true);
        Sanctum::actingAs($adviser);

        $this->getJson('/api/events')->assertOk();
        $this->getJson('/api/announcements')->assertOk();

        $dates = ['title' => 'New event', 'start_time' => now()->addDays(5)->toDateTimeString(), 'end_time' => now()->addDays(5)->addHours(2)->toDateTimeString()];
        $this->postJson('/api/events', $dates)->assertForbidden()->assertJsonPath('message', EnsureProfileCanWrite::MESSAGE);
        $this->putJson("/api/events/{$event->id}", ['title' => 'Renamed'])->assertForbidden();
        $this->deleteJson("/api/events/{$event->id}")->assertForbidden();
        $this->postJson('/api/announcements', ['title' => 'Notice', 'body' => 'Text.', 'target_role' => 'all', 'is_published' => true])->assertForbidden();
        $this->postJson('/api/transactions', ['type' => 'income', 'amount' => 100, 'description' => 'Dues'])->assertForbidden();

        $this->assertSame('Foundation Day', $event->fresh()->title);
        $this->assertSame(0, Transaction::count());
        $this->assertDatabaseMissing('announcements', ['title' => 'Notice']);
    }

    public function test_a_view_only_seat_keeps_its_own_routes_open(): void
    {
        Sanctum::actingAs($this->seat(true));

        $this->patchJson('/api/notifications/read-all')->assertOk();
        $this->putJson('/api/user/notification-preferences', ['notification_preferences' => []])->assertStatus(422);
        $this->postJson('/api/logout')->assertOk();
    }

    public function test_an_adviser_title_alone_does_not_make_a_seat_view_only(): void
    {
        $adviser = $this->seat(false);
        Sanctum::actingAs($adviser);

        $this->postJson('/api/events', ['title' => 'Edited by adviser admin', 'start_time' => now()->addDays(5)->toDateTimeString(), 'end_time' => now()->addDays(5)->addHours(2)->toDateTimeString()])
            ->assertCreated();
    }

    public function test_the_signed_in_payload_says_whether_the_seat_is_view_only(): void
    {
        Sanctum::actingAs($this->seat(true));
        $this->getJson('/api/user')->assertOk()->assertJsonPath('view_only', true);

        Sanctum::actingAs($this->seat(false, 'President'));
        $this->getJson('/api/user')->assertOk()->assertJsonPath('view_only', false);
    }

    public function test_the_dean_makes_a_head_seat_view_only_and_the_head_cannot_change_it(): void
    {
        $dean = $this->makeCollegeHead($this->college);
        $head = $this->seat(false, 'President');
        $coHead = $this->seat(false);
        $profile = $coHead->accountProfiles()->where('organization_id', $this->organization->id)->first();

        Sanctum::actingAs($dean);
        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'ADMIN', 'position_title' => 'Adviser', 'view_only' => true])
            ->assertOk()->assertJsonPath('view_only', true);
        $this->assertTrue((bool) $profile->fresh()->view_only);
        $this->getJson('/api/account-profiles?organization_id='.$this->organization->id)->assertOk()
            ->assertJsonFragment(['id' => $profile->id, 'view_only' => true]);

        Sanctum::actingAs($head);
        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'ADMIN', 'view_only' => false])->assertUnprocessable();
        $this->assertTrue((bool) $profile->fresh()->view_only);
    }

    public function test_the_dean_ticks_view_only_on_an_adviser_seat_and_the_title_is_kept(): void
    {
        $dean = $this->makeCollegeHead($this->college);
        $this->seat(false, 'President');
        $adviser = $this->seat(false);
        $profile = $adviser->accountProfiles()->where('organization_id', $this->organization->id)->first();

        Sanctum::actingAs($dean);
        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'ADMIN', 'position_title' => 'Adviser', 'view_only' => true])
            ->assertOk()->assertJsonPath('position_title', 'Adviser')->assertJsonPath('view_only', true);

        $this->assertSame('Adviser', $profile->fresh()->position_title);
        $this->assertTrue((bool) $profile->fresh()->view_only);
    }

    public function test_an_organization_head_cannot_name_an_adviser_seat_through_an_update(): void
    {
        $head = $this->seat(false, 'President');
        $coHead = $this->seat(false, 'Treasurer');
        $profile = $coHead->accountProfiles()->where('organization_id', $this->organization->id)->first();

        Sanctum::actingAs($head);
        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'ADMIN', 'position_title' => 'Adviser'])->assertUnprocessable();
        $this->assertSame('Treasurer', $profile->fresh()->position_title);
    }

    public function test_only_a_head_seat_can_be_view_only(): void
    {
        $dean = $this->makeCollegeHead($this->college);
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $profile = AccountProfile::where('user_school_id', $student->school_id)->where('organization_id', $this->organization->id)->firstOrFail();

        Sanctum::actingAs($dean);
        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'SBO_OFFICER', 'view_only' => true])
            ->assertUnprocessable()->assertJsonValidationErrors('view_only');
    }
}
