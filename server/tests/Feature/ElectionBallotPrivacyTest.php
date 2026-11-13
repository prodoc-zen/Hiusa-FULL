<?php

namespace Tests\Feature;

use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionBallot;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ElectionBallotPrivacyTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $student;

    private User $voter;

    private User $candidateUser;

    private Election $election;

    private Candidate $candidate;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);

        $organization = Organization::factory()->create();
        $this->admin = $this->member('ADMIN', $organization->id);
        $this->student = $this->member('STUDENT', $organization->id);
        $this->voter = $this->member('STUDENT', $organization->id);
        $this->candidateUser = $this->member('STUDENT', $organization->id);
        $this->election = $this->election($organization->id, 'active', true);
        $this->candidate = $this->candidateFor($this->election);
    }

    private function member(string $role, int $organizationId): User
    {
        return User::factory()->create([
            'role' => $role,
            'position_title' => null,
            'organization_id' => $organizationId,
            'account_status' => 'active',
        ]);
    }

    private function election(int $organizationId, string $status, bool $resultsVisible): Election
    {
        return Election::factory()->create([
            'organization_id' => $organizationId,
            'status' => $status,
            'approved_at' => now(),
            'finalized_at' => now(),
            'results_visible' => $resultsVisible,
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
        ]);
    }

    private function candidateFor(Election $election): Candidate
    {
        $position = ElectionPosition::factory()->create(['election_id' => $election->id, 'max_winners' => 1]);
        $candidate = Candidate::factory()->create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'user_id' => $this->candidateUser->school_id,
        ]);
        // A secret ballot: who took part is one row, the choice is another that carries no voter.
        ElectionBallot::factory()->create(['election_id' => $election->id, 'voter_id' => $this->voter->school_id]);
        Vote::factory()->create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'candidate_id' => $candidate->id,
            'voter_id' => null,
        ]);

        return $candidate;
    }

    public function test_no_vote_row_has_a_voter_id_and_no_endpoint_returns_one(): void
    {
        $this->assertSame(0, Vote::whereNotNull('voter_id')->count());

        $this->election->update(['status' => 'closed']);
        foreach ([$this->student, $this->admin, $this->voter] as $caller) {
            Sanctum::actingAs($caller);

            foreach (['', '/results', '/candidates'] as $path) {
                $body = $this->getJson("/api/elections/{$this->election->id}{$path}")->assertOk()->getContent();
                $this->assertStringNotContainsString('voter_id', $body);
                $this->assertStringNotContainsString('vote_hash', $body);
            }
            $this->assertSame([], $this->getJson("/api/elections/{$this->election->id}")->json('my_votes'));
        }
    }

    public function test_show_hides_per_candidate_counts_from_a_student_while_results_are_hidden(): void
    {
        $this->election->update(['results_visible' => false]);
        Sanctum::actingAs($this->student);

        $this->getJson("/api/elections/{$this->election->id}")
            ->assertOk()
            ->assertJsonMissingPath('vote_counts')
            ->assertJsonPath('voters_count', 1);
    }

    public function test_show_hides_per_candidate_counts_while_voting_is_open_even_when_results_are_released(): void
    {
        foreach ([$this->student, $this->admin] as $caller) {
            Sanctum::actingAs($caller);

            $this->getJson("/api/elections/{$this->election->id}")
                ->assertOk()
                ->assertJsonMissingPath('vote_counts')
                ->assertJsonPath('voters_count', 1);
        }
    }

    public function test_show_gives_per_candidate_counts_once_voting_is_closed_and_released(): void
    {
        $this->election->update(['status' => 'closed']);
        Sanctum::actingAs($this->student);

        $this->getJson("/api/elections/{$this->election->id}")
            ->assertOk()
            ->assertJsonPath("vote_counts.{$this->candidate->id}", 1);
    }

    public function test_show_keeps_closed_counts_from_a_student_until_results_are_released_but_not_from_an_admin(): void
    {
        $this->election->update(['status' => 'closed', 'results_visible' => false]);
        Sanctum::actingAs($this->admin);

        $this->getJson("/api/elections/{$this->election->id}")
            ->assertOk()
            ->assertJsonPath("vote_counts.{$this->candidate->id}", 1);
    }

    public function test_results_do_not_serve_live_per_candidate_totals_while_voting_is_open(): void
    {
        foreach ([$this->student, $this->admin] as $caller) {
            Sanctum::actingAs($caller);

            $row = $this->getJson("/api/elections/{$this->election->id}/results")->assertOk()->json('0');

            $this->assertNull($row['candidates'][0]['votes']);
            $this->assertNull($row['totalVotes']);
            $this->assertSame([], $row['winner_ids']);
            $this->assertFalse($row['tie']);
        }
    }

    public function test_the_officer_voter_list_and_live_totals_cannot_be_read_together(): void
    {
        Sanctum::actingAs($this->admin);

        $voters = $this->getJson("/api/elections/{$this->election->id}/voters")->assertOk();
        $this->assertContains(true, array_column($voters->json('data'), 'has_voted'));

        $this->getJson("/api/elections/{$this->election->id}/results")
            ->assertOk()
            ->assertJsonPath('0.candidates.0.votes', null);
        $this->getJson("/api/elections/{$this->election->id}")
            ->assertOk()
            ->assertJsonMissingPath('vote_counts');
    }

    public function test_results_give_per_candidate_totals_once_voting_is_closed(): void
    {
        $this->election->update(['status' => 'closed']);
        Sanctum::actingAs($this->student);

        $this->getJson("/api/elections/{$this->election->id}/results")
            ->assertOk()
            ->assertJsonPath('0.candidates.0.votes', 1)
            ->assertJsonPath('0.totalVotes', 1);
    }

    public function test_ballot_endpoints_show_candidates_only_the_columns_the_ballot_needs(): void
    {
        Sanctum::actingAs($this->student);

        $fromShow = $this->getJson("/api/elections/{$this->election->id}")->assertOk()->json();
        $fromIndex = $this->getJson("/api/elections/{$this->election->id}/candidates")->assertOk()->json();

        $users = [
            $fromShow['candidates'][0]['user'],
            $fromShow['positions'][0]['candidates'][0]['user'],
            $fromIndex[0]['user'],
        ];

        foreach ($users as $user) {
            $this->assertSame($this->candidateUser->first_name, $user['first_name']);
            $this->assertSame($this->candidateUser->last_name, $user['last_name']);
            foreach (['email', 'contact_number', 'notification_preferences', 'account_status', 'must_change_password'] as $private) {
                $this->assertArrayNotHasKey($private, $user);
            }
        }
    }
}
