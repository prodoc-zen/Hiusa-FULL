<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Candidate;
use App\Models\College;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * A member joins an organization through a student profile there while their own account stays in the college, so they
 * land on the "My account" workspace (their college home profile), not in the organization. The organization's open
 * election must still be listed for them, readable, and votable from there, and the voter list the officers see must
 * count exactly the people the ballot lets in.
 */
class ElectionMemberVotingTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private Organization $home;

    private User $admin;

    private Election $election;

    private ElectionPosition $position;

    private Candidate $candidate;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);

        $college = $this->makeCollege('CBE');
        $this->home = $this->makeCollegeHome($college);
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->election = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'title' => 'Election of officers',
            'status' => 'active',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
            'approved_at' => now()->subDay(),
            'finalized_at' => now()->subDay(),
        ]);
        $this->position = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'President', 'max_winners' => 1]);
        $nominee = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->candidate = Candidate::create(['election_id' => $this->election->id, 'position_id' => $this->position->id, 'user_id' => $nominee->school_id]);
    }

    /** A user whose account lives in the college home and who holds `$profileRole` in the organization, or no profile there. */
    private function collegeMember(?string $profileRole = 'STUDENT', string $profileStatus = 'active', string $accountStatus = 'active'): User
    {
        $member = User::factory()->student()->create(['organization_id' => $this->home->id, 'account_status' => $accountStatus]);
        if ($profileRole) {
            AccountProfile::create([
                'user_school_id' => $member->school_id,
                'organization_id' => $this->organization->id,
                'role' => $profileRole,
                'account_status' => $profileStatus,
            ]);
        }

        return $member;
    }

    /** The roll is whoever had a profile when the ballot was finalized, so a test that adds members finalizes afterwards. */
    private function finalizeAfterMembersJoined(): void
    {
        $this->election->update(['finalized_at' => now()]);
    }

    private function ballot(): array
    {
        return ['votes' => [['position_id' => $this->position->id, 'candidate_id' => $this->candidate->id]]];
    }

    public function test_a_member_sees_the_organizations_open_election_from_their_own_workspace(): void
    {
        $member = $this->collegeMember();
        Sanctum::actingAs($member);

        $response = $this->getJson('/api/elections')->assertOk();

        $this->assertSame([$this->election->id], collect($response->json())->pluck('id')->all());
    }

    public function test_a_member_reads_the_ballot_and_its_candidates(): void
    {
        $member = $this->collegeMember();
        Sanctum::actingAs($member);

        $this->getJson("/api/elections/{$this->election->id}")
            ->assertOk()
            ->assertJsonPath('id', $this->election->id)
            ->assertJsonPath('my_votes', [])
            ->assertJsonCount(1, 'positions.0.candidates');

        $this->getJson("/api/elections/{$this->election->id}/candidates")->assertOk()->assertJsonCount(1);
    }

    public function test_a_member_casts_one_ballot_and_a_second_is_refused(): void
    {
        $member = $this->collegeMember();
        $this->finalizeAfterMembersJoined();
        Sanctum::actingAs($member);

        $this->postJson("/api/elections/{$this->election->id}/vote", $this->ballot())->assertOk()->assertJsonPath('success', true);
        $this->assertDatabaseHas('votes', ['election_id' => $this->election->id, 'voter_id' => $member->school_id]);

        $this->postJson("/api/elections/{$this->election->id}/vote", $this->ballot())
            ->assertUnprocessable()
            ->assertJsonPath('message', 'You have already voted in this election.');
        $this->assertSame(1, Vote::where('election_id', $this->election->id)->where('voter_id', $member->school_id)->count());
    }

    public function test_after_voting_the_member_sees_their_receipt_on_the_election(): void
    {
        $member = $this->collegeMember();
        $this->finalizeAfterMembersJoined();
        Sanctum::actingAs($member);
        $this->postJson("/api/elections/{$this->election->id}/vote", $this->ballot())->assertOk();

        $this->getJson("/api/elections/{$this->election->id}")->assertOk()->assertJsonCount(1, 'my_votes');
    }

    public function test_a_student_of_the_college_with_no_profile_in_the_organization_cannot_see_or_vote(): void
    {
        $outsider = $this->collegeMember(null);
        Sanctum::actingAs($outsider);

        $this->assertSame([], $this->getJson('/api/elections')->assertOk()->json());
        $this->getJson("/api/elections/{$this->election->id}")->assertNotFound();
        $this->getJson("/api/elections/{$this->election->id}/candidates")->assertNotFound();
        $this->postJson("/api/elections/{$this->election->id}/vote", $this->ballot())->assertNotFound();
        $this->assertDatabaseCount('votes', 0);
    }

    public function test_a_profile_that_is_no_longer_active_cannot_vote(): void
    {
        $former = $this->collegeMember('STUDENT', 'inactive');
        Sanctum::actingAs($former);

        $this->assertSame([], $this->getJson('/api/elections')->assertOk()->json());
        $this->postJson("/api/elections/{$this->election->id}/vote", $this->ballot())->assertNotFound();
        $this->assertDatabaseCount('votes', 0);
    }

    public function test_a_member_of_an_archived_organization_cannot_vote_in_it(): void
    {
        $member = $this->collegeMember();
        $this->organization->update(['lifecycle_status' => 'archived', 'is_active' => false]);
        Sanctum::actingAs($member);

        $this->assertSame([], $this->getJson('/api/elections')->assertOk()->json());
        $this->postJson("/api/elections/{$this->election->id}/vote", $this->ballot())->assertNotFound();
        $this->assertDatabaseCount('votes', 0);
    }

    public function test_a_member_of_two_organizations_sees_both_elections_and_none_of_a_third(): void
    {
        $member = $this->collegeMember();
        $second = $this->makeCollegeStudentOrganization(College::first());
        $third = $this->makeCollegeStudentOrganization(College::first());
        AccountProfile::create(['user_school_id' => $member->school_id, 'organization_id' => $second->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $secondElection = Election::factory()->create([
            'organization_id' => $second->id, 'status' => 'active', 'start_time' => now()->subHour(), 'end_time' => now()->addHour(),
            'approved_at' => now()->subDay(), 'finalized_at' => now()->subDay(),
        ]);
        $thirdElection = Election::factory()->create([
            'organization_id' => $third->id, 'status' => 'active', 'start_time' => now()->subHour(), 'end_time' => now()->addHour(),
            'approved_at' => now()->subDay(), 'finalized_at' => now()->subDay(),
        ]);
        Sanctum::actingAs($member);

        $ids = collect($this->getJson('/api/elections')->assertOk()->json())->pluck('id')->sort()->values()->all();

        $this->assertSame([$this->election->id, $secondElection->id], $ids);
        $this->getJson("/api/elections/{$thirdElection->id}")->assertNotFound();
    }

    public function test_a_member_still_cannot_see_an_election_that_is_not_open_or_released(): void
    {
        $member = $this->collegeMember();
        $this->election->update(['status' => 'upcoming', 'finalized_at' => null]);
        Sanctum::actingAs($member);

        $this->assertSame([], $this->getJson('/api/elections')->assertOk()->json());
        $this->getJson("/api/elections/{$this->election->id}")->assertForbidden();
    }

    public function test_a_member_sees_a_finalized_election_that_has_not_opened_yet_but_cannot_open_its_ballot(): void
    {
        $member = $this->collegeMember();
        $this->election->update(['status' => 'upcoming', 'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addDay()]);
        Sanctum::actingAs($member);

        $this->assertSame([$this->election->id], collect($this->getJson('/api/elections')->assertOk()->json())->pluck('id')->all());
        $this->getJson("/api/elections/{$this->election->id}")->assertForbidden();
        $this->postJson("/api/elections/{$this->election->id}/vote", $this->ballot())->assertStatus(400);
    }

    public function test_the_members_home_feed_offers_the_organizations_open_election(): void
    {
        $member = $this->collegeMember();
        $this->finalizeAfterMembersJoined();
        Sanctum::actingAs($member);

        $feed = $this->getJson('/api/student/feed')->assertOk();

        $this->assertSame($this->election->id, $feed->json('sidebar.active_election.id'));
        $item = collect($feed->json('items'))->firstWhere('type', 'election');
        $this->assertSame($this->election->id, $item['data']['id']);
        $this->assertFalse($item['data']['has_voted']);
    }

    public function test_the_members_briefing_says_to_vote_and_stops_once_they_have(): void
    {
        $member = $this->collegeMember();
        $this->finalizeAfterMembersJoined();
        Sanctum::actingAs($member);

        $briefing = $this->getJson('/api/dashboard/briefing')->assertOk();
        $this->assertContains('election-'.$this->election->id, collect($briefing->json('attention'))->pluck('id')->all());
        $this->assertStringContainsString('Election of officers', $briefing->json('pillars.elections.label'));

        $this->postJson("/api/elections/{$this->election->id}/vote", $this->ballot())->assertOk();

        $this->assertNotContains('election-'.$this->election->id, collect($this->getJson('/api/dashboard/briefing')->assertOk()->json('attention'))->pluck('id')->all());
    }

    public function test_voting_in_the_election_that_ends_first_keeps_the_second_open_election_on_the_members_home(): void
    {
        $member = $this->collegeMember();
        $second = $this->makeCollegeStudentOrganization(College::first());
        AccountProfile::create(['user_school_id' => $member->school_id, 'organization_id' => $second->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $secondElection = Election::factory()->create([
            'organization_id' => $second->id, 'status' => 'active', 'start_time' => now()->subHour(), 'end_time' => now()->addHours(5),
            'approved_at' => now()->subDay(), 'finalized_at' => now(),
        ]);
        $this->finalizeAfterMembersJoined();
        Sanctum::actingAs($member);

        $this->postJson("/api/elections/{$this->election->id}/vote", $this->ballot())->assertOk();

        $attention = collect($this->getJson('/api/dashboard/briefing')->assertOk()->json('attention'))->pluck('id')->all();
        $this->assertContains('election-'.$secondElection->id, $attention);
        $this->assertNotContains('election-'.$this->election->id, $attention);

        $feed = $this->getJson('/api/student/feed')->assertOk();
        $this->assertSame($secondElection->id, $feed->json('sidebar.active_election.id'));
        $this->assertFalse($feed->json('sidebar.active_election.has_voted'));
    }

    public function test_the_administrators_turnout_denominator_is_the_voter_list_total(): void
    {
        $this->collegeMember('STUDENT');
        $this->collegeMember('SBO_OFFICER');
        $this->collegeMember(null);
        Sanctum::actingAs($this->admin);

        $eligible = $this->getJson("/api/elections/{$this->election->id}/voters")->assertOk()->json('summary.eligible_total');
        $meter = $this->getJson('/api/dashboard/briefing')->assertOk()->json('pillars.elections.meter');

        $this->assertSame($eligible, $meter['limit']);
    }

    public function test_the_voter_list_counts_exactly_the_people_the_ballot_lets_in(): void
    {
        $people = [
            'administrator' => $this->admin,
            'nominee' => User::find($this->candidate->user_id),
            'student member' => $this->collegeMember('STUDENT'),
            'officer profile' => $this->collegeMember('SBO_OFFICER'),
            'adviser profile' => $this->collegeMember('ADMIN'),
            'outsider' => $this->collegeMember(null),
            'inactive profile' => $this->collegeMember('STUDENT', 'inactive'),
            'disabled account' => $this->collegeMember('STUDENT', 'active', 'disabled'),
            'native student' => User::factory()->student()->create(['organization_id' => $this->organization->id]),
            'native officer' => User::factory()->officer()->create(['organization_id' => $this->organization->id]),
        ];

        $this->finalizeAfterMembersJoined();
        Sanctum::actingAs($this->admin);
        $listed = $this->getJson("/api/elections/{$this->election->id}/voters")->assertOk();
        $eligible = collect($listed->json('data'))->pluck('school_id')->sort()->values()->all();

        $admitted = [];
        foreach ($people as $user) {
            Sanctum::actingAs($user);
            if ($this->postJson("/api/elections/{$this->election->id}/vote", $this->ballot())->status() === 200) {
                $admitted[] = $user->school_id;
            }
        }
        sort($admitted);

        $this->assertSame($eligible, $admitted);
        $this->assertSame(count($eligible), $listed->json('summary.eligible_total'));
        foreach (['outsider', 'inactive profile', 'disabled account'] as $excluded) {
            $this->assertNotContains($people[$excluded]->school_id, $eligible, $excluded);
        }
        foreach (['student member', 'officer profile', 'adviser profile', 'native student'] as $included) {
            $this->assertContains($people[$included]->school_id, $eligible, $included);
        }
    }
}
