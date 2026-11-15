<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\AnnouncementView;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** A sender can see how many members have read a notice, and a second open by the same member does not count twice. */
class AnnouncementReadershipTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $officer;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->officer = User::factory()->officer()->create(['organization_id' => $this->organization->id]);
    }

    private function published(User $poster, string $title): Announcement
    {
        return Announcement::factory()->create([
            'organization_id' => $this->organization->id, 'created_by' => $poster->school_id, 'title' => $title,
            'target_role' => 'all', 'is_published' => true, 'approval_status' => 'approved',
            'scheduled_at' => null, 'expires_at' => null,
        ]);
    }

    private function student(): User
    {
        return User::factory()->student()->create(['organization_id' => $this->organization->id]);
    }

    public function test_opening_a_notice_twice_counts_the_member_once(): void
    {
        $post = $this->published($this->officer, 'Assembly');
        $member = $this->student();
        Sanctum::actingAs($member);

        $this->postJson("/api/announcements/{$post->id}/view")->assertOk()->assertJsonPath('already_viewed', false);
        $this->postJson("/api/announcements/{$post->id}/view")->assertOk()->assertJsonPath('already_viewed', true);

        $this->assertSame(1, AnnouncementView::where('announcement_id', $post->id)->count());
        $this->assertSame(1, $post->fresh()->views_count);
    }

    public function test_the_poster_and_the_admin_see_how_many_members_read_each_notice(): void
    {
        $read = $this->published($this->officer, 'Read by two');
        $unread = $this->published($this->officer, 'Read by nobody');
        foreach ([$this->student(), $this->student()] as $member) {
            Sanctum::actingAs($member);
            $this->postJson("/api/announcements/{$read->id}/view")->assertOk();
        }

        foreach ([$this->officer, $this->admin] as $sender) {
            Sanctum::actingAs($sender);
            $rows = collect($this->getJson('/api/announcements')->assertOk()->json('data'))->keyBy('title');
            $this->assertSame(2, $rows['Read by two']['seen_by_count']);
            $this->assertSame(0, $rows['Read by nobody']['seen_by_count']);
        }
    }

    public function test_an_officer_who_did_not_post_the_notice_and_a_student_do_not_see_the_count(): void
    {
        $this->published($this->admin, 'Admin notice');
        $otherOfficer = User::factory()->officer()->create(['organization_id' => $this->organization->id]);

        Sanctum::actingAs($otherOfficer);
        $this->assertArrayNotHasKey('seen_by_count', $this->getJson('/api/announcements')->assertOk()->json('data.0'));

        Sanctum::actingAs($this->student());
        $this->assertArrayNotHasKey('seen_by_count', $this->getJson('/api/announcements?published_only=1')->assertOk()->json('data.0'));
    }

    public function test_the_count_costs_no_extra_query_per_announcement(): void
    {
        $this->published($this->officer, 'First');
        Sanctum::actingAs($this->admin);

        DB::enableQueryLog();
        $this->getJson('/api/announcements')->assertOk();
        $few = count(DB::getQueryLog());
        DB::flushQueryLog();

        foreach (range(1, 6) as $i) {
            $this->published($this->officer, "More {$i}");
        }
        DB::flushQueryLog();
        $this->getJson('/api/announcements')->assertOk();

        $this->assertSame($few, count(DB::getQueryLog()));
    }
}
