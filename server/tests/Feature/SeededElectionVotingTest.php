<?php

namespace Tests\Feature;

use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A freshly seeded database ships one open election. Its students must be able to vote in it, and its voter page
 * must agree with the ballots already cast.
 */
class SeededElectionVotingTest extends TestCase
{
    use RefreshDatabase;

    private Election $election;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);
        Storage::fake('local');
        $this->seed();
        $this->election = Election::whereNotNull('finalized_at')->orderBy('id')->firstOrFail();
    }

    private function unvotedStudent(): User
    {
        $voted = Vote::where('election_id', $this->election->id)->pluck('voter_id');

        return User::where('role', 'STUDENT')
            ->where('organization_id', $this->election->organization_id)
            ->whereNotIn('school_id', $voted)
            ->orderBy('school_id')
            ->firstOrFail();
    }

    public function test_a_seeded_student_who_has_not_voted_can_cast_a_ballot(): void
    {
        $student = $this->unvotedStudent();
        Sanctum::actingAs($student);

        $this->getJson("/api/elections/{$this->election->id}")->assertOk()->assertJsonPath('ballot_refusal', null);

        $votes = ElectionPosition::where('election_id', $this->election->id)->with('candidates')->get()
            ->map(fn ($position) => ['position_id' => $position->id, 'candidate_id' => $position->candidates->first()->id])
            ->all();

        $this->postJson("/api/elections/{$this->election->id}/vote", ['votes' => $votes])->assertOk();
    }

    public function test_the_seeded_voter_page_counts_the_people_who_already_voted(): void
    {
        $officer = User::where('school_id', 900001)->firstOrFail();
        Sanctum::actingAs($officer);

        $response = $this->getJson("/api/elections/{$this->election->id}/voters")->assertOk();

        $ballots = Vote::where('election_id', $this->election->id)->distinct()->count('voter_id');
        $this->assertGreaterThan(0, $ballots);
        $response->assertJsonPath('summary.voted_count', $ballots);
        $this->assertGreaterThan($ballots, $response->json('summary.eligible_total'));
    }
}
