<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\College;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * A tie that survives the one runoff is settled by the reviewer: only among the candidates still tied, for exactly the
 * seats that remain, under the approved tie-break rule, with a written explanation. Vote totals are never touched.
 */
class ElectionTieResolutionTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private College $college;

    private Organization $organization;

    private User $admin;

    private User $head;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        Carbon::setTestNow('2026-12-17 18:00:00');
        $this->college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($this->college);
        $this->head = $this->makeCollegeHead($this->college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function election(?Organization $organization = null, array $overrides = []): Election
    {
        return Election::factory()->create([
            'organization_id' => ($organization ?? $this->organization)->id,
            'status' => 'closed',
            'phase' => 'tie_resolution',
            'approved_at' => '2026-12-01 09:00:00',
            'finalized_at' => '2026-12-05 09:00:00',
            'start_time' => '2026-12-10 08:00:00',
            'end_time' => '2026-12-11 17:00:00',
            'filing_starts_at' => '2026-12-01 08:00:00',
            'results_publish_at' => '2026-12-12 08:00:00',
            'results_visible' => true,
            'runoff_starts_at' => '2026-12-17 09:00:00',
            'runoff_ends_at' => '2026-12-17 17:00:00',
            'runoff_publish_at' => '2026-12-18 09:00:00',
            'tie_break_rule' => 'The candidate with the longer membership wins.',
            'tally_version' => 2,
            ...$overrides,
        ]);
    }

    /**
     * Candidates with a (round 1, round 2) pair of totals each.
     *
     * @return array{0: ElectionPosition, 1: array<int, Candidate>}
     */
    private function position(Election $election, string $title, array $totals, int $seats = 1): array
    {
        $position = ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => $title, 'max_winners' => $seats]);
        $candidates = [];
        foreach ($totals as $pair) {
            $candidate = Candidate::factory()->create([
                'election_id' => $election->id,
                'position_id' => $position->id,
                'user_id' => User::factory()->student()->create(['organization_id' => $election->organization_id])->school_id,
            ]);
            foreach ([[1, $pair[0]], [2, $pair[1]]] as [$round, $count]) {
                for ($i = 0; $i < $count; $i++) {
                    Vote::create([
                        'election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id,
                        'voter_id' => null, 'round' => $round, 'vote_hash' => bin2hex(random_bytes(16)), 'cast_at' => '2026-12-10 00:00:00',
                    ]);
                }
            }
            $candidates[] = $candidate;
        }

        return [$position, $candidates];
    }

    private function url(Election $election, ElectionPosition $position): string
    {
        return '/api/elections/'.$election->id.'/positions/'.$position->id.'/tie-resolution';
    }

    public function test_the_dean_settles_a_tie_that_survived_the_runoff(): void
    {
        $election = $this->election();
        [$position, [$one, $two, $third]] = $this->position($election, 'President', [[4, 3], [4, 3], [1, 0]]);
        Sanctum::actingAs($this->head);

        $this->postJson($this->url($election, $position), [
            'winner_candidate_ids' => [$two->id],
            'explanation' => 'Both were present at every meeting; the longer membership decides.',
        ])->assertOk();

        $position = $position->fresh();
        $this->assertSame([$two->id], $position->resolved_winner_ids);
        $this->assertSame('The candidate with the longer membership wins.', $position->tie_rule_used);
        $this->assertSame('Both were present at every meeting; the longer membership decides.', $position->tie_explanation);
        $this->assertSame($this->head->school_id, (int) $position->tie_resolved_by);
        $this->assertNotNull($position->tie_resolved_at);
        $this->assertSame('resolved', $position->result_status);
        $this->assertSame(7, Vote::where('candidate_id', $one->id)->count());
        $this->assertSame(7, Vote::where('candidate_id', $two->id)->count());
        $this->assertSame(1, Vote::where('candidate_id', $third->id)->count());
    }

    public function test_the_audit_row_and_the_admins_notice_carry_the_decision_and_no_voter(): void
    {
        $election = $this->election();
        [$position, [$one, $two]] = $this->position($election, 'President', [[4, 3], [4, 3]]);
        Sanctum::actingAs($this->head);

        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [$one->id], 'explanation' => 'Longer membership.'])->assertOk();

        $audit = AuditLog::where('action', 'tie_resolved')->where('record_id', $election->id)->sole();
        $this->assertSame($this->head->school_id, $audit->user_id);
        $this->assertSame($position->id, $audit->new_values['position_id']);
        $this->assertEqualsCanonicalizing([$one->id, $two->id], $audit->new_values['tied_candidate_ids']);
        $this->assertSame([$one->id], $audit->new_values['winner_candidate_ids']);
        $this->assertSame('Longer membership.', $audit->new_values['explanation']);
        $this->assertSame('The candidate with the longer membership wins.', $audit->new_values['rule_used']);
        $this->assertStringNotContainsString('voter', json_encode($audit->new_values));
        $this->assertSame(1, Notification::where('user_id', $this->admin->school_id)->where('title', 'Tie resolved')->count());
        $this->assertSame(0, Notification::where('user_id', $this->head->school_id)->where('title', 'Tie resolved')->count());
    }

    public function test_resolving_the_last_tie_completes_the_election_once_it_is_published(): void
    {
        $election = $this->election(null, ['runoff_publish_at' => '2026-12-17 17:30:00']);
        [$position, [$one]] = $this->position($election, 'President', [[4, 3], [4, 3]]);
        Sanctum::actingAs($this->head);

        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [$one->id], 'explanation' => 'Longer membership.'])->assertOk();

        $election = $election->fresh();
        $this->assertSame('completed', $election->phase);
        $this->assertNotNull($election->completed_at);
    }

    public function test_a_two_seat_position_needs_exactly_the_remaining_seats(): void
    {
        $election = $this->election();
        [$position, [$ahead, $tiedOne, $tiedTwo, $tiedThree]] = $this->position($election, 'Auditor', [[8, 0], [4, 5], [4, 5], [4, 5]], 2);
        Sanctum::actingAs($this->head);

        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [$tiedOne->id, $tiedTwo->id], 'explanation' => 'Two is one too many.'])
            ->assertUnprocessable()->assertJsonValidationErrors('winner_candidate_ids');
        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [], 'explanation' => 'None.'])
            ->assertUnprocessable()->assertJsonValidationErrors('winner_candidate_ids');
        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [$tiedTwo->id], 'explanation' => 'Longer membership.'])->assertOk();

        $this->assertSame('resolved', $position->fresh()->result_status);
        $this->assertSame([$tiedTwo->id], $position->fresh()->resolved_winner_ids);
        $this->assertNotContains($ahead->id, $position->fresh()->resolved_winner_ids);
    }

    public function test_a_candidate_who_is_not_still_tied_is_refused(): void
    {
        $election = $this->election();
        [$position, [$one, $two, $outsider]] = $this->position($election, 'President', [[4, 3], [4, 3], [1, 0]]);
        [, [$elsewhere]] = $this->position($election, 'Treasurer', [[3, 0]]);
        Sanctum::actingAs($this->head);

        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [$outsider->id], 'explanation' => 'No.'])
            ->assertUnprocessable()->assertJsonValidationErrors('winner_candidate_ids');
        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [$elsewhere->id], 'explanation' => 'No.'])
            ->assertUnprocessable()->assertJsonValidationErrors('winner_candidate_ids');
        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [$one->id, $one->id], 'explanation' => 'No.'])
            ->assertUnprocessable();

        $this->assertNull($position->fresh()->resolved_winner_ids);
    }

    public function test_an_explanation_is_required(): void
    {
        $election = $this->election();
        [$position, [$one]] = $this->position($election, 'President', [[4, 3], [4, 3]]);
        Sanctum::actingAs($this->head);

        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [$one->id]])
            ->assertUnprocessable()->assertJsonValidationErrors('explanation');
    }

    public function test_the_rule_must_be_typed_when_the_election_has_none(): void
    {
        $election = $this->election(null, ['tie_break_rule' => null]);
        [$position, [$one]] = $this->position($election, 'President', [[4, 3], [4, 3]]);
        Sanctum::actingAs($this->head);
        $payload = ['winner_candidate_ids' => [$one->id], 'explanation' => 'Longer membership.'];

        $this->postJson($this->url($election, $position), $payload)->assertUnprocessable()->assertJsonValidationErrors('rule_used');
        $this->postJson($this->url($election, $position), [...$payload, 'rule_used' => 'Drawing of lots witnessed by the dean.'])->assertOk();

        $this->assertSame('Drawing of lots witnessed by the dean.', $position->fresh()->tie_rule_used);
    }

    public function test_a_position_that_is_not_waiting_on_a_tie_is_refused(): void
    {
        $election = $this->election();
        [$decided, [$winner]] = $this->position($election, 'Treasurer', [[6, 0], [1, 0]]);
        Sanctum::actingAs($this->head);

        $this->postJson($this->url($election, $decided), ['winner_candidate_ids' => [$winner->id], 'explanation' => 'No tie.'])->assertStatus(409);

        [$settled, [$one]] = $this->position($election, 'President', [[4, 3], [4, 3]]);
        $this->postJson($this->url($election, $settled), ['winner_candidate_ids' => [$one->id], 'explanation' => 'First.'])->assertOk();
        $this->postJson($this->url($election, $settled), ['winner_candidate_ids' => [$one->id], 'explanation' => 'Again.'])->assertStatus(409);
    }

    public function test_a_tie_cannot_be_settled_before_the_runoff_is_over(): void
    {
        $election = $this->election(null, ['runoff_starts_at' => '2026-12-19 09:00:00', 'runoff_ends_at' => '2026-12-19 17:00:00', 'runoff_publish_at' => '2026-12-20 09:00:00', 'phase' => 'canvassing']);
        [$position, [$one]] = $this->position($election, 'President', [[4, 0], [4, 0]]);
        Sanctum::actingAs($this->head);

        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [$one->id], 'explanation' => 'Too early.'])->assertStatus(409);
    }

    public function test_an_admin_an_officer_and_a_student_are_refused(): void
    {
        $election = $this->election();
        [$position, [$one]] = $this->position($election, 'President', [[4, 3], [4, 3]]);
        $payload = ['winner_candidate_ids' => [$one->id], 'explanation' => 'Longer membership.'];

        foreach ([$this->admin, User::factory()->officer()->create(['organization_id' => $this->organization->id]), User::factory()->student()->create(['organization_id' => $this->organization->id])] as $user) {
            Sanctum::actingAs($user);
            $this->postJson($this->url($election, $position), $payload)->assertForbidden();
        }

        $this->assertNull($position->fresh()->resolved_winner_ids);
    }

    public function test_a_dean_of_another_college_is_refused(): void
    {
        $election = $this->election();
        [$position, [$one]] = $this->position($election, 'President', [[4, 3], [4, 3]]);
        $otherHead = $this->makeCollegeHead($this->makeCollege('CBA'));
        Sanctum::actingAs($otherHead);

        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [$one->id], 'explanation' => 'Not mine.'])->assertNotFound();

        $this->assertNull($position->fresh()->resolved_winner_ids);
    }

    public function test_the_sao_settles_only_for_a_university_wide_organization(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $council = Organization::factory()->create(['is_university_wide' => true, 'college_id' => null, 'college' => null, 'parent_organization_id' => null]);
        $councilElection = $this->election($council);
        [$councilPosition, [$councilOne]] = $this->position($councilElection, 'President', [[4, 3], [4, 3]]);
        $collegeElection = $this->election();
        [$collegePosition, [$collegeOne]] = $this->position($collegeElection, 'President', [[4, 3], [4, 3]]);
        Sanctum::actingAs($director);

        $this->postJson($this->url($collegeElection, $collegePosition), ['winner_candidate_ids' => [$collegeOne->id], 'explanation' => 'Not mine.'])->assertNotFound();
        $this->postJson($this->url($councilElection, $councilPosition), ['winner_candidate_ids' => [$councilOne->id], 'explanation' => 'Longer membership.'])->assertOk();

        $this->assertNull($collegePosition->fresh()->resolved_winner_ids);
        $this->assertSame([$councilOne->id], $councilPosition->fresh()->resolved_winner_ids);
    }

    public function test_the_dean_of_a_college_does_not_settle_a_university_wide_election(): void
    {
        $council = Organization::factory()->create(['is_university_wide' => true, 'college_id' => null, 'college' => null, 'parent_organization_id' => null]);
        $election = $this->election($council);
        [$position, [$one]] = $this->position($election, 'President', [[4, 3], [4, 3]]);
        Sanctum::actingAs($this->head);

        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [$one->id], 'explanation' => 'Not mine.'])->assertNotFound();
    }

    public function test_the_runoff_outcome_is_hidden_from_students_until_it_is_published_but_not_from_the_admin(): void
    {
        $election = $this->election(null, ['runoff_publish_at' => '2026-12-18 09:00:00']);
        [$position, [$one, $two]] = $this->position($election, 'President', [[4, 9], [4, 2]]);
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);

        Sanctum::actingAs($student);
        $row = $this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json()[0];
        $this->assertSame([], $row['winner_ids']);
        $this->assertNull($row['candidates'][0]['runoff_votes']);
        $this->assertNull($row['candidates'][1]['runoff_votes']);
        $this->assertSame('runoff_voting', $row['status']);
        $this->assertNull($row['resolution']);

        Sanctum::actingAs($this->admin);
        $row = $this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json()[0];
        $this->assertSame([$one->id], $row['winner_ids']);
        $this->assertSame('decided', $row['status']);
        $this->assertEqualsCanonicalizing([9, 2], collect($row['candidates'])->pluck('runoff_votes')->all());

        Carbon::setTestNow('2026-12-18 09:00:00');
        Sanctum::actingAs($student);
        $row = $this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json()[0];
        $this->assertSame([$one->id], $row['winner_ids']);
        $this->assertSame('decided', $row['status']);
    }

    public function test_the_resolution_is_part_of_the_published_row(): void
    {
        $election = $this->election(null, ['runoff_publish_at' => '2026-12-17 17:30:00']);
        [$position, [$one, $two]] = $this->position($election, 'President', [[4, 3], [4, 3]]);
        Sanctum::actingAs($this->head);
        $this->postJson($this->url($election, $position), ['winner_candidate_ids' => [$two->id], 'explanation' => 'Longer membership.'])->assertOk();

        $row = $this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json()[0];

        $this->assertSame('resolved', $row['status']);
        $this->assertSame([$two->id], $row['winner_ids']);
        $this->assertSame('The candidate with the longer membership wins.', $row['resolution']['rule_used']);
        $this->assertSame('Longer membership.', $row['resolution']['explanation']);
        $this->assertSame(trim($this->head->first_name.' '.$this->head->last_name), $row['resolution']['resolved_by']);
        $this->assertNotNull($row['resolution']['resolved_at']);
        $this->assertArrayNotHasKey('tie_explanation', $row['position']);
    }

    public function test_the_dean_reads_a_pending_tie_before_the_results_are_published(): void
    {
        $election = $this->election(null, ['results_visible' => false, 'results_publish_at' => '2026-12-30 08:00:00']);
        [$position] = $this->position($election, 'President', [[4, 3], [4, 3]]);
        Sanctum::actingAs($this->head);

        $row = $this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json()[0];

        $this->assertSame('tie_pending', $row['status']);
        $this->assertCount(2, $row['runoff']['candidate_ids']);
    }
}
