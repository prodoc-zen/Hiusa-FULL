<?php

namespace Tests\Feature;

use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The voter list searches and filters across every voter of the election on the server, so a voter on page two
 * is found, the pagination follows the filtered set, and the turnout summary stays the whole election's.
 */
class ElectionVotersSearchTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private Election $election;

    private array $voted = [];

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id, 'first_name' => 'Zed', 'last_name' => 'Zimmer']);
        $this->election = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'active',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
            'approved_at' => now()->subDay(),
        ]);
        $position = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'President', 'max_winners' => 1]);
        $nominee = User::factory()->student()->create(['organization_id' => $this->organization->id, 'first_name' => 'Nina', 'last_name' => 'Nominee']);
        $candidate = Candidate::create(['election_id' => $this->election->id, 'position_id' => $position->id, 'user_id' => $nominee->school_id]);

        // Twenty-four students sorted by last name: Aaron .. Xavier, so the last ones sit on page three.
        foreach (range(1, 24) as $i) {
            $student = User::factory()->student()->create([
                'organization_id' => $this->organization->id,
                'first_name' => 'Pat'.$i,
                'last_name' => sprintf('Voter%02d', $i),
            ]);
            if ($i % 4 === 0) {
                Vote::factory()->create(['election_id' => $this->election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id, 'voter_id' => $student->school_id]);
                $this->voted[] = $student->school_id;
            }
        }

        $this->election->update(['finalized_at' => now()]);

        Sanctum::actingAs($this->admin);
    }

    private function voters(string $query = ''): TestResponse
    {
        return $this->getJson("/api/elections/{$this->election->id}/voters{$query}")->assertOk();
    }

    public function test_a_voter_on_a_later_page_is_found_by_name(): void
    {
        $response = $this->voters('?search=Voter23');

        $this->assertSame(['Voter23'], collect($response->json('data'))->pluck('last_name')->all());
        $this->assertSame(1, $response->json('total'));
    }

    public function test_a_voter_is_found_by_school_id_and_by_full_name(): void
    {
        $target = User::where('last_name', 'Voter19')->first();

        $byId = $this->voters('?search='.urlencode($target->school_id));
        $this->assertSame(['Voter19'], collect($byId->json('data'))->pluck('last_name')->all());

        $byFullName = $this->voters('?search='.urlencode('Pat19 Voter19'));
        $this->assertSame(['Voter19'], collect($byFullName->json('data'))->pluck('last_name')->all());

        $byReverse = $this->voters('?search='.urlencode('Voter19, Pat19'));
        $this->assertSame(['Voter19'], collect($byReverse->json('data'))->pluck('last_name')->all());
    }

    public function test_the_vote_filter_runs_across_every_voter(): void
    {
        $voted = $this->voters('?vote=voted');
        $this->assertSame(6, $voted->json('total'));
        $this->assertEqualsCanonicalizing($this->voted, collect($voted->json('data'))->pluck('school_id')->all());
        $this->assertSame([true], collect($voted->json('data'))->pluck('has_voted')->unique()->values()->all());

        $notYet = $this->voters('?vote=not_voted');
        $this->assertSame(20, $notYet->json('total'));
        $this->assertSame(10, count($notYet->json('data')));
        $this->assertSame([false], collect($notYet->json('data'))->pluck('has_voted')->unique()->values()->all());

        $pageThree = $this->getJson("/api/elections/{$this->election->id}/voters?vote=not_voted&page=3")->assertOk();
        $this->assertSame(0, count($pageThree->json('data')));
        $this->assertSame(20, $pageThree->json('total'));
        $this->assertSame(2, $pageThree->json('last_page'));
    }

    public function test_pagination_and_the_total_follow_the_filtered_set(): void
    {
        $response = $this->voters('?search=Voter1');

        $this->assertSame(10, $response->json('total'));
        $this->assertSame(1, $response->json('last_page'));
    }

    public function test_the_turnout_summary_stays_the_whole_elections_whatever_the_search(): void
    {
        $everyone = $this->voters()->json('summary');
        $searched = $this->voters('?search=Voter23&vote=not_voted')->json('summary');

        $this->assertSame(26, $everyone['eligible_total']);
        $this->assertSame(6, $everyone['voted_count']);
        $this->assertSame($everyone, $searched);
    }

    public function test_the_search_is_bound_so_a_wildcard_or_quote_cannot_widen_it(): void
    {
        $this->assertSame(0, $this->voters('?search='.urlencode("x' OR '1'='1"))->json('total'));
    }

    public function test_the_search_does_not_widen_who_may_read_the_list(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($student);
        $this->getJson("/api/elections/{$this->election->id}/voters?search=Voter")->assertForbidden();

        $otherOrganization = Organization::factory()->create();
        $otherAdmin = User::factory()->admin()->create(['organization_id' => $otherOrganization->id]);
        Sanctum::actingAs($otherAdmin);
        $this->getJson("/api/elections/{$this->election->id}/voters?search=Voter")->assertNotFound();
    }
}
