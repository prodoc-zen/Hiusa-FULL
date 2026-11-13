<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\User;
use App\Models\Vote;
use App\Services\ElectionTallyService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * The counting rules: vacant, unopposed, decided, and a tie at the last seat. Counting reads votes by candidate and round
 * only, and an election already closed under the earlier reading (tally version 1) keeps that reading.
 */
class ElectionTallyTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        Carbon::setTestNow('2026-12-15 09:00:00');
        $this->organization = $this->makeCollegeStudentOrganization($this->makeCollege('CCS'));
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function election(array $overrides = []): Election
    {
        return Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'closed',
            'approved_at' => '2026-12-01 09:00:00',
            'finalized_at' => '2026-12-05 09:00:00',
            'start_time' => '2026-12-10 08:00:00',
            'end_time' => '2026-12-11 17:00:00',
            'results_visible' => true,
            'tally_version' => 2,
            ...$overrides,
        ]);
    }

    private function position(Election $election, int $seats = 1, array $overrides = []): ElectionPosition
    {
        return ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => 'Secretary', 'max_winners' => $seats, ...$overrides]);
    }

    /**
     * One candidate per entry with that many round 1 votes (and optionally round 2 votes).
     *
     * @param  array<int, int|array{0: int, 1: int}>  $totals
     * @return array<int, Candidate>
     */
    private function candidates(Election $election, ElectionPosition $position, array $totals): array
    {
        $candidates = [];
        foreach ($totals as $total) {
            [$first, $second] = is_array($total) ? $total : [$total, 0];
            $candidate = Candidate::factory()->create([
                'election_id' => $election->id,
                'position_id' => $position->id,
                'user_id' => User::factory()->student()->create(['organization_id' => $this->organization->id])->school_id,
            ]);
            $this->cast($election, $position, $candidate, $first, 1);
            $this->cast($election, $position, $candidate, $second, 2);
            $candidates[] = $candidate;
        }

        return $candidates;
    }

    private function cast(Election $election, ElectionPosition $position, Candidate $candidate, int $count, int $round): void
    {
        for ($i = 0; $i < $count; $i++) {
            Vote::create([
                'election_id' => $election->id,
                'position_id' => $position->id,
                'candidate_id' => $candidate->id,
                'voter_id' => null,
                'round' => $round,
                'vote_hash' => bin2hex(random_bytes(16)),
                'cast_at' => '2026-12-10 00:00:00',
            ]);
        }
    }

    private function row(Election $election, ElectionPosition $position): array
    {
        return app(ElectionTallyService::class)->standings($election->fresh())->first(fn (array $row) => $row['position']->id === $position->id);
    }

    private function ids($collection): array
    {
        return $collection->pluck('id')->sort()->values()->all();
    }

    public function test_a_position_with_no_candidate_is_vacant(): void
    {
        $election = $this->election();
        $position = $this->position($election);

        $row = $this->row($election, $position);

        $this->assertSame('vacant', $row['status']);
        $this->assertTrue($row['winners']->isEmpty());
        $this->assertTrue($row['tied']->isEmpty());
        $this->assertFalse($row['unopposed']);
    }

    public function test_a_sole_candidate_is_elected_unopposed_with_zero_votes(): void
    {
        $election = $this->election();
        $position = $this->position($election);
        [$only] = $this->candidates($election, $position, [0]);

        $row = $this->row($election, $position);

        $this->assertSame('unopposed', $row['status']);
        $this->assertTrue($row['unopposed']);
        $this->assertSame([$only->id], $this->ids($row['winners']));
    }

    public function test_candidates_not_more_than_the_seats_are_all_elected_unopposed(): void
    {
        $election = $this->election();
        $position = $this->position($election, 3);
        $candidates = $this->candidates($election, $position, [4, 0]);

        $row = $this->row($election, $position);

        $this->assertSame('unopposed', $row['status']);
        $this->assertSame($this->ids(collect($candidates)), $this->ids($row['winners']));
        $this->assertSame(3, $row['seats']);
    }

    public function test_the_highest_total_wins_a_contested_position(): void
    {
        $election = $this->election();
        $position = $this->position($election);
        [$low, $high, $middle] = $this->candidates($election, $position, [2, 9, 4]);

        $row = $this->row($election, $position);

        $this->assertSame('decided', $row['status']);
        $this->assertFalse($row['unopposed']);
        $this->assertSame([$high->id], $this->ids($row['winners']));
        $this->assertTrue($row['tied']->isEmpty());
        $this->assertSame([$high->id, $middle->id, $low->id], $row['candidates']->pluck('id')->all());
        $this->assertSame(9, $row['candidates']->first()->votes);
    }

    public function test_a_multi_seat_position_takes_the_top_totals(): void
    {
        $election = $this->election();
        $position = $this->position($election, 2);
        [$first, $second, $third] = $this->candidates($election, $position, [5, 5, 3]);

        $row = $this->row($election, $position);

        $this->assertSame('decided', $row['status']);
        $this->assertSame([$first->id, $second->id], $this->ids($row['winners']));
        $this->assertNotContains($third->id, $this->ids($row['winners']));
    }

    public function test_a_tie_at_the_last_of_two_seats_elects_the_one_ahead_and_sends_the_rest_to_a_runoff(): void
    {
        $election = $this->election();
        $position = $this->position($election, 2);
        [$ahead, $tiedOne, $tiedTwo, $behind] = $this->candidates($election, $position, [7, 4, 4, 1]);

        $row = $this->row($election, $position);

        $this->assertSame('runoff_required', $row['status']);
        $this->assertSame([$ahead->id], $this->ids($row['winners']));
        $this->assertSame([$tiedOne->id, $tiedTwo->id], $this->ids($row['tied']));
        $this->assertSame(1, $row['open_seats']);
        $this->assertNotContains($behind->id, $this->ids($row['tied']));
    }

    public function test_a_tie_for_a_single_seat_needs_a_runoff_with_no_winner_yet(): void
    {
        $election = $this->election();
        $position = $this->position($election);
        [$one, $two] = $this->candidates($election, $position, [3, 3]);

        $row = $this->row($election, $position);

        $this->assertSame('runoff_required', $row['status']);
        $this->assertTrue($row['winners']->isEmpty());
        $this->assertSame([$one->id, $two->id], $this->ids($row['tied']));
    }

    public function test_an_inactive_position_is_left_out(): void
    {
        $election = $this->election();
        $this->position($election, 1, ['is_active' => false, 'title' => 'Auditor']);
        $active = $this->position($election);

        $rows = app(ElectionTallyService::class)->standings($election->fresh());

        $this->assertSame([$active->id], $rows->map(fn (array $row) => $row['position']->id)->all());
    }

    public function test_counting_reads_the_votes_of_each_round_apart(): void
    {
        $election = $this->election();
        $position = $this->position($election);
        [$first, $second] = $this->candidates($election, $position, [[3, 9], [2, 0]]);

        $row = $this->row($election, $position);
        $byId = $row['candidates']->keyBy('id');

        $this->assertSame(3, $byId[$first->id]->votes);
        $this->assertSame(9, $byId[$first->id]->runoff_votes);
        $this->assertSame(2, $byId[$second->id]->votes);
        $this->assertSame('decided', $row['status']);
        $this->assertSame([$first->id], $this->ids($row['winners']));
    }

    public function test_the_rows_carry_no_voter_identity(): void
    {
        $election = $this->election();
        $position = $this->position($election);
        $this->candidates($election, $position, [2, 1]);

        $row = $this->row($election, $position);

        $this->assertStringNotContainsString('voter', strtolower(json_encode($row['candidates']->toArray())));
    }

    public function test_a_version_one_election_still_ignores_a_zero_vote_candidate(): void
    {
        $election = $this->election(['tally_version' => 1]);
        $position = $this->position($election);
        [$none] = $this->candidates($election, $position, [0]);

        $row = $this->row($election, $position);

        $this->assertSame('decided', $row['status']);
        $this->assertTrue($row['winners']->isEmpty());
        $this->assertNotContains($none->id, $this->ids($row['winners']));
    }

    public function test_a_version_one_tie_leaves_the_tied_candidates_out_as_before(): void
    {
        $election = $this->election(['tally_version' => 1]);
        $position = $this->position($election, 2);
        [$ahead, $tiedOne, $tiedTwo] = $this->candidates($election, $position, [6, 3, 3]);

        $row = $this->row($election, $position);

        $this->assertSame('tie', $row['status']);
        $this->assertSame([$ahead->id], $this->ids($row['winners']));
        $this->assertSame([$tiedOne->id, $tiedTwo->id], $this->ids($row['tied']));
    }

    public function test_a_version_one_election_reads_through_the_api_as_it_did(): void
    {
        $election = $this->election(['tally_version' => 1, 'access_handed_over_at' => '2026-12-12 09:00:00']);
        $position = $this->position($election, 1, ['title' => 'Treasurer']);
        [$winner, $loser] = $this->candidates($election, $position, [5, 2]);
        $winnerUser = User::where('school_id', $winner->user_id)->first();
        AccountProfile::updateOrCreate(
            ['user_school_id' => $winnerUser->school_id, 'organization_id' => $this->organization->id],
            ['role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => 'Treasurer'],
        );
        Sanctum::actingAs($this->admin);

        $rows = $this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json();

        $this->assertCount(1, $rows);
        $this->assertSame([$winner->id], $rows[0]['winner_ids']);
        $this->assertFalse($rows[0]['tie']);
        $this->assertTrue($rows[0]['access_handed_over']);
        $this->assertSame(7, $rows[0]['totalVotes']);
        $this->assertSame(5, $rows[0]['candidates'][0]['votes']);
        $this->assertNull($rows[0]['officer_access']);
    }

    public function test_a_version_two_result_row_reports_status_and_the_unresolved_tie(): void
    {
        $election = $this->election();
        $position = $this->position($election);
        [$one, $two] = $this->candidates($election, $position, [4, 4]);
        Sanctum::actingAs($this->admin);

        $rows = $this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json();

        $this->assertSame('runoff_required', $rows[0]['status']);
        $this->assertTrue($rows[0]['tie']);
        $this->assertSame([], $rows[0]['winner_ids']);
        $this->assertEqualsCanonicalizing([$one->id, $two->id], $rows[0]['runoff']['candidate_ids']);
        $this->assertSame(1, $rows[0]['runoff']['seats']);
        $this->assertNull($rows[0]['runoff']['starts_at']);
        $this->assertNull($rows[0]['resolution']);
        $this->assertFalse($rows[0]['access_handed_over']);
    }

    public function test_a_position_with_a_decided_winner_stays_final_while_another_is_unresolved(): void
    {
        $election = $this->election();
        $decided = $this->position($election, 1, ['title' => 'Treasurer']);
        $tied = $this->position($election, 1, ['title' => 'Auditor']);
        [$winner] = $this->candidates($election, $decided, [6, 1]);
        $this->candidates($election, $tied, [2, 2]);
        Sanctum::actingAs($this->admin);

        $rows = collect($this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json())->keyBy(fn ($row) => $row['position']['id']);

        $this->assertSame('decided', $rows[$decided->id]['status']);
        $this->assertSame([$winner->id], $rows[$decided->id]['winner_ids']);
        $this->assertSame('runoff_required', $rows[$tied->id]['status']);
    }
}
