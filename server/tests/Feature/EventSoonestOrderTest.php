<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EventSoonestOrderTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function eventsAt(Organization $organization, User $admin): array
    {
        Carbon::setTestNow(Carbon::parse('2026-06-15 12:00:00'));
        $make = fn (string $title, string $start, string $end) => Event::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $admin->school_id, 'title' => $title, 'status' => 'approved',
            'start_time' => $start, 'end_time' => $end,
        ]);

        $upcomingLater = $make('Upcoming later', '2026-06-20 09:00:00', '2026-06-20 11:00:00');
        $pastOlder = $make('Past older', '2026-06-01 09:00:00', '2026-06-01 11:00:00');
        $upcomingSoon = $make('Upcoming soon', '2026-06-16 09:00:00', '2026-06-16 11:00:00');
        $pastRecent = $make('Past recent', '2026-06-10 09:00:00', '2026-06-10 11:00:00');
        $ongoing = $make('Ongoing', '2026-06-15 10:00:00', '2026-06-15 14:00:00');

        return [$ongoing, $upcomingSoon, $upcomingLater, $pastRecent, $pastOlder];
    }

    public function test_soonest_lists_events_that_have_not_ended_first_then_ended_ones_most_recent_first(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT']);
        $expected = collect($this->eventsAt($organization, $admin))->pluck('id')->all();
        Sanctum::actingAs($student);

        $this->assertSame($expected, collect($this->getJson('/api/events?sort=start_asc')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertSame($expected, collect($this->getJson('/api/events')->assertOk()->json('data'))->pluck('id')->all());
    }

    public function test_soonest_order_holds_across_pages(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT']);
        $expected = collect($this->eventsAt($organization, $admin))->pluck('id')->all();
        Sanctum::actingAs($student);

        $first = $this->getJson('/api/events?sort=start_asc&per_page=2&page=1')->assertOk()->assertJsonPath('total', 5)->assertJsonPath('last_page', 3);
        $second = $this->getJson('/api/events?sort=start_asc&per_page=2&page=2')->assertOk();
        $third = $this->getJson('/api/events?sort=start_asc&per_page=2&page=3')->assertOk();

        $this->assertSame($expected, [
            ...collect($first->json('data'))->pluck('id')->all(),
            ...collect($second->json('data'))->pluck('id')->all(),
            ...collect($third->json('data'))->pluck('id')->all(),
        ]);
    }
}
