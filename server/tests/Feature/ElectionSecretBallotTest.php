<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionBallot;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Ballots are secret and may skip positions, pick several candidates and run in two rounds. */
class ElectionSecretBallotTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private Election $election;

    private ElectionPosition $president;

    private ElectionPosition $senators;

    /** @var array<int, Candidate> */
    private array $presidentCandidates = [];

    /** @var array<int, Candidate> */
    private array $senatorCandidates = [];

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);

        $this->organization = Organization::factory()->create();
        $this->admin = $this->member('ADMIN');
        $this->election = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'title' => 'General election',
            'status' => 'active',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
            'approved_at' => now()->subDay(),
            'finalized_at' => now()->subDay(),
        ]);
        $this->president = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'President', 'max_winners' => 1]);
        $this->senators = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'Senator', 'max_winners' => 2]);
        foreach (range(1, 2) as $index) {
            $this->presidentCandidates[$index] = $this->candidateFor($this->president);
        }
        foreach (range(1, 3) as $index) {
            $this->senatorCandidates[$index] = $this->candidateFor($this->senators);
        }
    }

    private function member(string $role = 'STUDENT', ?string $title = null): User
    {
        $member = User::factory()->create([
            'role' => $role,
            'position_title' => $title,
            'organization_id' => $this->organization->id,
            'account_status' => 'active',
        ]);
        // On the roll: the profile existed before the ballot was finalized.
        AccountProfile::where('user_school_id', $member->school_id)->update(['created_at' => now()->subDays(3)]);

        return $member;
    }

    private function candidateFor(ElectionPosition $position): Candidate
    {
        return Candidate::create([
            'election_id' => $this->election->id,
            'position_id' => $position->id,
            'user_id' => $this->member()->school_id,
        ]);
    }

    private function url(): string
    {
        return "/api/elections/{$this->election->id}/vote";
    }

    private function selection(ElectionPosition $position, array $candidates): array
    {
        return ['position_id' => $position->id, 'candidate_ids' => array_map(fn (Candidate $candidate) => $candidate->id, $candidates)];
    }

    private function voter(): User
    {
        $voter = $this->member();
        Sanctum::actingAs($voter);

        return $voter;
    }

    public function test_a_ballot_may_skip_a_position(): void
    {
        $voter = $this->voter();

        $this->postJson($this->url(), ['selections' => [$this->selection($this->president, [$this->presidentCandidates[1]])]])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('round', 1)
            ->assertJsonPath('election_title', 'General election');

        $this->assertSame(1, Vote::where('election_id', $this->election->id)->count());
        $this->assertSame(0, Vote::where('position_id', $this->senators->id)->count());
        $this->assertTrue(ElectionBallot::hasVoted($this->election->id, $voter->school_id, 1));
    }

    public function test_an_all_blank_ballot_is_accepted_and_still_counts_as_taking_part(): void
    {
        $voter = $this->voter();

        $this->postJson($this->url(), ['selections' => []])->assertOk()->assertJsonPath('success', true);
        $this->assertSame(0, Vote::count());
        $this->assertTrue(ElectionBallot::hasVoted($this->election->id, $voter->school_id));

        $other = $this->voter();
        $this->postJson($this->url(), ['selections' => [['position_id' => $this->president->id, 'candidate_ids' => []]]])->assertOk();
        $this->assertSame(0, Vote::count());
        $this->assertTrue(ElectionBallot::hasVoted($this->election->id, $other->school_id));
    }

    public function test_a_two_seat_position_takes_two_choices_and_refuses_a_third(): void
    {
        $this->voter();

        $this->postJson($this->url(), ['selections' => [$this->selection($this->senators, $this->senatorCandidates)]])
            ->assertUnprocessable();
        $this->assertSame(0, ElectionBallot::count());
        $this->assertSame(0, Vote::count());

        $this->postJson($this->url(), ['selections' => [$this->selection($this->senators, [$this->senatorCandidates[1], $this->senatorCandidates[2]])]])
            ->assertOk();
        $this->assertSame(2, Vote::where('position_id', $this->senators->id)->count());
    }

    public function test_the_vote_limit_of_a_position_caps_the_choices_below_its_seats(): void
    {
        $this->senators->update(['vote_limit' => 1]);
        $this->voter();

        $this->postJson($this->url(), ['selections' => [$this->selection($this->senators, [$this->senatorCandidates[1], $this->senatorCandidates[2]])]])
            ->assertUnprocessable();
        $this->postJson($this->url(), ['selections' => [$this->selection($this->senators, [$this->senatorCandidates[1]])]])->assertOk();
    }

    public function test_a_candidate_of_another_position_or_a_repeated_one_is_refused(): void
    {
        $this->voter();

        $this->postJson($this->url(), ['selections' => [$this->selection($this->president, [$this->senatorCandidates[1]])]])->assertUnprocessable();
        $this->postJson($this->url(), ['selections' => [$this->selection($this->senators, [$this->senatorCandidates[1], $this->senatorCandidates[1]])]])->assertUnprocessable();
        $this->postJson($this->url(), ['selections' => [
            $this->selection($this->president, [$this->presidentCandidates[1]]),
            $this->selection($this->president, [$this->presidentCandidates[2]]),
        ]])->assertUnprocessable();
        $this->assertSame(0, ElectionBallot::count());
        $this->assertSame(0, Vote::count());
    }

    public function test_an_unknown_inactive_or_candidateless_position_is_refused(): void
    {
        $this->voter();
        $empty = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'Auditor', 'max_winners' => 1]);
        $inactive = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'Treasurer', 'max_winners' => 1, 'is_active' => false]);
        $inactiveCandidate = $this->candidateFor($inactive);
        $foreign = ElectionPosition::create(['election_id' => Election::factory()->create(['organization_id' => $this->organization->id])->id, 'title' => 'Elsewhere', 'max_winners' => 1]);

        foreach ([$empty->id, $inactive->id, $foreign->id, 999999] as $positionId) {
            $this->postJson($this->url(), ['selections' => [['position_id' => $positionId, 'candidate_ids' => [$inactiveCandidate->id]]]])->assertUnprocessable();
        }
        $this->assertSame(0, ElectionBallot::count());
    }

    public function test_a_second_ballot_is_refused(): void
    {
        $voter = $this->voter();
        $selections = [$this->selection($this->president, [$this->presidentCandidates[1]])];

        $this->postJson($this->url(), ['selections' => $selections])->assertOk();
        $this->postJson($this->url(), ['selections' => $selections])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'You have already voted in this election.');

        $this->assertSame(1, ElectionBallot::where('voter_id', $voter->school_id)->count());
        $this->assertSame(1, Vote::count());
    }

    public function test_votes_carry_no_voter_id_and_only_the_day_of_casting(): void
    {
        $this->voter();
        $this->travelTo(now()->setTime(15, 42, 17));
        $this->election->update(['start_time' => now()->subHour(), 'end_time' => now()->addHour()]);

        $this->postJson($this->url(), ['selections' => [
            $this->selection($this->president, [$this->presidentCandidates[1]]),
            $this->selection($this->senators, [$this->senatorCandidates[1], $this->senatorCandidates[2]]),
        ]])->assertOk();

        $votes = Vote::all();
        $this->assertCount(3, $votes);
        foreach ($votes as $vote) {
            $this->assertNull($vote->voter_id);
            $this->assertSame(1, $vote->round);
            $this->assertTrue($vote->cast_at->equalTo(now()->startOfDay()), 'cast_at must be the start of the day, was '.$vote->cast_at);
        }
        $this->assertCount(3, $votes->pluck('vote_hash')->unique());
        $this->assertSame(0, DB::table('votes')->whereNotNull('voter_id')->count());
    }

    public function test_every_receipt_is_unique_and_matches_the_stored_ballot(): void
    {
        $references = [];
        foreach (range(1, 3) as $ignored) {
            $voter = $this->voter();
            $response = $this->postJson($this->url(), ['selections' => []])->assertOk();
            $receipt = $response->json('receipt');
            $this->assertMatchesRegularExpression('/^[A-Z0-9]{12}$/', $receipt);
            $references[] = $receipt;

            $ballot = ElectionBallot::where('voter_id', $voter->school_id)->first();
            $this->assertSame($receipt, $ballot->receipt_ref);
            $this->assertNotEmpty($response->json('submitted_at'));
        }

        $this->assertCount(3, array_unique($references));
    }

    public function test_nothing_the_server_returns_links_the_voter_to_a_choice(): void
    {
        $voter = $this->voter();
        $response = $this->postJson($this->url(), ['selections' => [$this->selection($this->president, [$this->presidentCandidates[1]])]])->assertOk();

        $this->assertSame(['election_title', 'message', 'receipt', 'round', 'submitted_at', 'success'], collect($response->json())->keys()->sort()->values()->all());
        $this->assertStringNotContainsString((string) $voter->school_id, json_encode($response->json()));
    }

    public function test_an_adviser_cannot_vote_and_is_not_counted(): void
    {
        $adviser = $this->member('STUDENT', 'Adviser');

        Sanctum::actingAs($adviser);
        $this->postJson($this->url(), ['selections' => []])->assertNotFound();
        $this->assertSame(0, ElectionBallot::count());

        $eligibleWithAdviser = AccountProfile::votingMembers()->where('account_profiles.organization_id', $this->organization->id)->count();
        $this->assertFalse(AccountProfile::votingMembers()->where('user_school_id', $adviser->school_id)->exists());

        Sanctum::actingAs($this->admin);
        $this->assertSame($eligibleWithAdviser, $this->getJson("/api/elections/{$this->election->id}/voters")->assertOk()->json('summary.eligible_total'));
        $this->assertNotContains($adviser->school_id, array_column($this->getJson("/api/elections/{$this->election->id}/voters")->json('data'), 'school_id'));
    }

    public function test_turnout_counts_ballots_not_votes_and_keeps_someone_who_voted_and_left(): void
    {
        $firstVoter = $this->voter();
        $this->postJson($this->url(), ['selections' => [
            $this->selection($this->president, [$this->presidentCandidates[1]]),
            $this->selection($this->senators, [$this->senatorCandidates[1], $this->senatorCandidates[2]]),
        ]])->assertOk();
        $blank = $this->voter();
        $this->postJson($this->url(), ['selections' => []])->assertOk();
        $this->assertSame(3, Vote::count());

        AccountProfile::where('user_school_id', $firstVoter->school_id)->update(['account_status' => 'inactive']);

        Sanctum::actingAs($this->admin);
        $response = $this->getJson("/api/elections/{$this->election->id}/voters")->assertOk();
        $this->assertSame(2, $response->json('summary.voted_count'));

        $flags = collect($response->json('data'))->pluck('has_voted', 'school_id');
        $this->assertTrue($flags[$firstVoter->school_id]);
        $this->assertTrue($flags[$blank->school_id]);

        $this->getJson("/api/elections/{$this->election->id}/voters?vote=voted")->assertOk()->assertJsonPath('total', 2);
        $this->getJson("/api/elections/{$this->election->id}/voters?vote=not_voted")->assertOk()->assertJsonMissing(['school_id' => $blank->school_id]);
    }

    public function test_no_endpoint_returns_a_voter_id_next_to_a_choice(): void
    {
        $this->voter();
        $this->postJson($this->url(), ['selections' => [$this->selection($this->president, [$this->presidentCandidates[1]])]])->assertOk();

        Sanctum::actingAs($this->admin);
        $show = $this->getJson("/api/elections/{$this->election->id}")->assertOk();
        $this->assertSame([], $show->json('my_votes'));
        $this->assertSame(0, DB::table('votes')->whereNotNull('voter_id')->count());
    }

    public function test_a_halted_election_refuses_ballots(): void
    {
        $this->voter();

        $this->election->update(['suspended_at' => now()]);
        $this->postJson($this->url(), ['selections' => []])->assertStatus(400)->assertJsonPath('message', 'This election is not currently accepting votes');

        $this->election->update(['suspended_at' => null, 'cancelled_at' => now()]);
        $this->postJson($this->url(), ['selections' => []])->assertStatus(400);
        $this->assertSame(0, ElectionBallot::count());
    }

    public function test_an_election_outside_its_voting_window_refuses_ballots(): void
    {
        $this->voter();
        $this->election->update(['start_time' => now()->addHour(), 'end_time' => now()->addHours(2), 'status' => 'upcoming']);

        $this->postJson($this->url(), ['selections' => []])->assertStatus(400);
        $this->assertSame(0, ElectionBallot::count());
    }

    /** A closed election with a runoff for the president and one senator seat, between two tied candidates each. */
    private function openRunoff(): void
    {
        $this->election->update([
            'status' => 'closed',
            'start_time' => now()->subDays(3),
            'end_time' => now()->subDays(2),
            'phase' => 'runoff',
            'runoff_starts_at' => now()->subHour(),
            'runoff_ends_at' => now()->addHour(),
        ]);
        $this->president->update(['runoff_candidate_ids' => [$this->presidentCandidates[1]->id, $this->presidentCandidates[2]->id], 'runoff_seats' => 1]);
    }

    public function test_a_runoff_ballot_covers_only_runoff_positions_and_candidates_and_is_cast_once(): void
    {
        $voter = $this->voter();
        $roundOne = ElectionBallot::create(['election_id' => $this->election->id, 'round' => 1, 'voter_id' => $voter->school_id, 'receipt_ref' => 'ROUNDONE0001', 'submitted_at' => now()->subDays(2)]);
        $this->openRunoff();

        // A position without a runoff, and a candidate outside it, are refused.
        $this->postJson($this->url(), ['selections' => [$this->selection($this->senators, [$this->senatorCandidates[1]])]])->assertUnprocessable();
        $third = $this->candidateFor($this->president);
        $this->postJson($this->url(), ['selections' => [$this->selection($this->president, [$third])]])->assertUnprocessable();
        // More choices than runoff seats.
        $this->postJson($this->url(), ['selections' => [$this->selection($this->president, [$this->presidentCandidates[1], $this->presidentCandidates[2]])]])->assertUnprocessable();
        $this->assertSame(1, ElectionBallot::count());

        $this->postJson($this->url(), ['selections' => [$this->selection($this->president, [$this->presidentCandidates[2]])]])
            ->assertOk()
            ->assertJsonPath('round', 2);

        $vote = Vote::first();
        $this->assertSame(2, $vote->round);
        $this->assertNull($vote->voter_id);
        $this->assertSame(2, ElectionBallot::where('voter_id', $voter->school_id)->count());
        $this->assertSame(1, ElectionBallot::where('voter_id', $voter->school_id)->where('round', 1)->count());
        $this->assertSame($roundOne->receipt_ref, ElectionBallot::where('round', 1)->value('receipt_ref'));

        $this->postJson($this->url(), ['selections' => [$this->selection($this->president, [$this->presidentCandidates[1]])]])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'You have already voted in this runoff.');
        $this->assertSame(1, Vote::count());
    }

    public function test_a_runoff_ballot_may_be_blank(): void
    {
        $this->voter();
        $this->openRunoff();

        $this->postJson($this->url(), ['selections' => []])->assertOk()->assertJsonPath('round', 2);
        $this->assertSame(0, Vote::count());
    }

    public function test_the_voter_list_reads_a_runoff_round_on_request(): void
    {
        $voter = $this->voter();
        ElectionBallot::create(['election_id' => $this->election->id, 'round' => 1, 'voter_id' => $voter->school_id, 'receipt_ref' => 'ROUNDONE0002', 'submitted_at' => now()]);
        $this->openRunoff();

        Sanctum::actingAs($this->admin);
        $this->assertSame(1, $this->getJson("/api/elections/{$this->election->id}/voters")->assertOk()->json('summary.voted_count'));
        $this->assertSame(0, $this->getJson("/api/elections/{$this->election->id}/voters?round=2")->assertOk()->json('summary.voted_count'));
    }

    public function test_deleting_the_last_profile_is_blocked_while_the_person_has_a_ballot(): void
    {
        $voter = $this->voter();
        $this->postJson($this->url(), ['selections' => []])->assertOk();

        Sanctum::actingAs(User::factory()->create(['role' => 'SUPER_ADMIN', 'organization_id' => $this->organization->id]));
        $this->deleteJson('/api/system/users/'.$voter->school_id, ['school_id' => $voter->school_id])->assertStatus(409);
        $this->assertDatabaseHas('users', ['school_id' => $voter->school_id]);
    }
}
