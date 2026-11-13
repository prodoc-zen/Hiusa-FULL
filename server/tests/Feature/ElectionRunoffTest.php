<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\College;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use App\Models\Vote;
use App\Services\ElectionResolutionService;
use App\Services\ElectionTallyService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * After voting closes: canvassing, publication at the scheduled moment, the one runoff the Admin schedules, and completion.
 */
class ElectionRunoffTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $otherAdmin;

    private User $officer;

    private User $student;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        Carbon::setTestNow('2026-12-15 09:00:00');
        $college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->otherAdmin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->officer = User::factory()->officer()->create(['organization_id' => $this->organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
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
            'phase' => 'canvassing',
            'approved_at' => '2026-12-01 09:00:00',
            'finalized_at' => '2026-12-05 09:00:00',
            'start_time' => '2026-12-10 08:00:00',
            'end_time' => '2026-12-11 17:00:00',
            'filing_starts_at' => '2026-12-01 08:00:00',
            'results_publish_at' => '2026-12-12 08:00:00',
            'results_visible' => false,
            'tally_version' => 2,
            ...$overrides,
        ]);
    }

    /** @return array{0: ElectionPosition, 1: array<int, Candidate>} */
    private function position(Election $election, string $title, array $totals, int $seats = 1): array
    {
        $position = ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => $title, 'max_winners' => $seats]);
        $candidates = [];
        foreach ($totals as $total) {
            [$first, $second] = is_array($total) ? $total : [$total, 0];
            $candidate = Candidate::factory()->create([
                'election_id' => $election->id,
                'position_id' => $position->id,
                'user_id' => User::factory()->student()->create(['organization_id' => $this->organization->id])->school_id,
            ]);
            foreach ([[1, $first], [2, $second]] as [$round, $count]) {
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

    private function advance(Election $election): void
    {
        app(ElectionResolutionService::class)->advance($election->fresh());
    }

    private function noticesTo(User $user, string $title): int
    {
        return Notification::where('user_id', $user->school_id)->where('title', $title)->count();
    }

    private function schedule(array $overrides = []): array
    {
        return [
            'runoff_starts_at' => '2026-12-17T01:00:00Z',
            'runoff_ends_at' => '2026-12-17T09:00:00Z',
            'runoff_publish_at' => '2026-12-18T01:00:00Z',
            ...$overrides,
        ];
    }

    public function test_the_first_run_records_the_tied_candidates_and_alerts_the_admins_once(): void
    {
        $election = $this->election();
        [$position, [$one, $two]] = $this->position($election, 'President', [4, 4]);
        $this->position($election, 'Treasurer', [9, 1]);

        $this->advance($election);
        $this->advance($election);

        $position = $position->fresh();
        $this->assertEqualsCanonicalizing([$one->id, $two->id], $position->runoff_candidate_ids);
        $this->assertSame(1, $position->runoff_seats);
        $this->assertSame('runoff_required', $position->result_status);
        $this->assertSame('canvassing', $election->fresh()->phase);
        $this->assertSame(1, $this->noticesTo($this->admin, 'Runoff needed'));
        $this->assertSame(1, $this->noticesTo($this->otherAdmin, 'Runoff needed'));
        $this->assertSame(0, $this->noticesTo($this->student, 'Runoff needed'));
        $this->assertSame(
            'A runoff is needed for President. Set the runoff schedule.',
            Notification::where('user_id', $this->admin->school_id)->where('title', 'Runoff needed')->value('message'),
        );
        $this->assertArrayHasKey('runoff_needed', $election->fresh()->notices_sent);
    }

    public function test_a_closed_election_is_not_advanced_when_it_is_cancelled_or_counted_the_earlier_way(): void
    {
        $cancelled = $this->election(['cancelled_at' => '2026-12-12 09:00:00', 'phase' => 'cancelled']);
        $this->position($cancelled, 'President', [4, 4]);
        $old = $this->election(['tally_version' => 1, 'phase' => null]);
        [$oldPosition] = $this->position($old, 'President', [4, 4]);

        $this->advance($cancelled);
        $this->advance($old);

        $this->assertNull($old->fresh()->phase);
        $this->assertNull($oldPosition->fresh()->result_status);
        $this->assertSame('cancelled', $cancelled->fresh()->phase);
        $this->assertSame(0, Notification::where('title', 'Runoff needed')->count());
    }

    public function test_results_publish_at_the_scheduled_moment_with_one_notice_to_voters_and_admins(): void
    {
        $election = $this->election(['results_publish_at' => '2026-12-15 12:00:00']);
        $this->position($election, 'President', [6, 2]);

        $this->advance($election);
        $this->assertFalse($election->fresh()->results_visible);

        Carbon::setTestNow('2026-12-15 12:00:00');
        $this->advance($election);
        $this->advance($election);

        $this->assertTrue($election->fresh()->results_visible);
        $this->assertSame(1, $this->noticesTo($this->student, 'Results published'));
        $this->assertSame(1, $this->noticesTo($this->admin, 'Results published'));
        $this->assertSame(1, AuditLog::where('action', 'results_published')->where('record_id', $election->id)->count());
    }

    public function test_an_election_without_an_unresolved_position_completes_once_published(): void
    {
        $election = $this->election(['results_publish_at' => '2026-12-12 08:00:00']);
        $this->position($election, 'President', [6, 2]);

        $this->advance($election);

        $election = $election->fresh();
        $this->assertTrue($election->results_visible);
        $this->assertSame('completed', $election->phase);
        $this->assertNotNull($election->completed_at);
        $this->assertSame(1, AuditLog::where('action', 'election_completed')->where('record_id', $election->id)->count());

        $this->advance($election);
        $this->assertSame(1, AuditLog::where('action', 'election_completed')->where('record_id', $election->id)->count());
    }

    public function test_an_unresolved_position_is_published_with_its_status_while_the_others_are_final(): void
    {
        $election = $this->election();
        [$tied] = $this->position($election, 'President', [3, 3]);
        [$decided, [$winner]] = $this->position($election, 'Treasurer', [8, 1]);
        Sanctum::actingAs($this->student);

        $rows = collect($this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json())->keyBy(fn ($row) => $row['position']['id']);

        $this->assertTrue($election->fresh()->results_visible);
        $this->assertSame('runoff_required', $rows[$tied->id]['status']);
        $this->assertSame('decided', $rows[$decided->id]['status']);
        $this->assertSame([$winner->id], $rows[$decided->id]['winner_ids']);
        $this->assertNull($election->fresh()->completed_at);
        $this->assertNotSame('completed', $election->fresh()->phase);
    }

    public function test_the_admin_schedules_the_one_runoff(): void
    {
        $election = $this->election();
        [$position] = $this->position($election, 'President', [4, 4]);
        $this->advance($election);
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/elections/'.$election->id.'/runoff', $this->schedule())->assertOk();

        $election = $election->fresh();
        $this->assertSame('2026-12-17 09:00:00', $election->runoff_starts_at->format('Y-m-d H:i:s'));
        $this->assertSame('2026-12-17 17:00:00', $election->runoff_ends_at->format('Y-m-d H:i:s'));
        $this->assertSame('2026-12-18 09:00:00', $election->runoff_publish_at->format('Y-m-d H:i:s'));
        $this->assertSame('runoff_scheduled', $position->fresh()->result_status);
        $audit = AuditLog::where('action', 'runoff_scheduled')->where('record_id', $election->id)->sole();
        $this->assertSame($this->admin->school_id, $audit->user_id);
        $this->assertSame(1, $this->noticesTo($this->student, 'Runoff scheduled'));
        $this->assertSame(1, $this->noticesTo($this->otherAdmin, 'Runoff scheduled'));
    }

    public function test_the_runoff_can_be_edited_until_it_starts_and_not_after(): void
    {
        $election = $this->election();
        $this->position($election, 'President', [4, 4]);
        $this->advance($election);
        Sanctum::actingAs($this->admin);
        $this->postJson('/api/elections/'.$election->id.'/runoff', $this->schedule())->assertOk();

        $this->postJson('/api/elections/'.$election->id.'/runoff', $this->schedule(['runoff_starts_at' => '2026-12-17T02:00:00Z']))->assertOk();
        $this->assertSame('2026-12-17 10:00:00', $election->fresh()->runoff_starts_at->format('Y-m-d H:i:s'));

        Carbon::setTestNow('2026-12-17 10:30:00');
        $this->postJson('/api/elections/'.$election->id.'/runoff', $this->schedule(['runoff_starts_at' => '2026-12-18T01:00:00Z', 'runoff_ends_at' => '2026-12-18T05:00:00Z', 'runoff_publish_at' => '2026-12-19T01:00:00Z']))
            ->assertStatus(409);
    }

    public function test_a_runoff_needs_a_position_that_requires_one(): void
    {
        $election = $this->election();
        $this->position($election, 'President', [8, 1]);
        $this->advance($election);
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/elections/'.$election->id.'/runoff', $this->schedule())->assertStatus(409);

        $this->assertNull($election->fresh()->runoff_starts_at);
    }

    public function test_the_runoff_dates_are_validated(): void
    {
        $election = $this->election();
        $this->position($election, 'President', [4, 4]);
        $this->advance($election);
        Sanctum::actingAs($this->admin);
        $url = '/api/elections/'.$election->id.'/runoff';

        $this->postJson($url, [])->assertUnprocessable()->assertJsonValidationErrors(['runoff_starts_at', 'runoff_ends_at', 'runoff_publish_at']);
        $this->postJson($url, $this->schedule(['runoff_starts_at' => '2026-12-15T00:00:00Z']))->assertUnprocessable()->assertJsonValidationErrors('runoff_starts_at');
        $this->postJson($url, $this->schedule(['runoff_ends_at' => '2026-12-17T01:00:00Z']))->assertUnprocessable()->assertJsonValidationErrors('runoff_ends_at');
        $this->postJson($url, $this->schedule(['runoff_publish_at' => '2026-12-17T08:00:00Z']))->assertUnprocessable()->assertJsonValidationErrors('runoff_publish_at');
        $this->assertNull($election->fresh()->runoff_starts_at);
    }

    public function test_the_runoff_stays_inside_the_semester_of_the_election(): void
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-20', 'status' => 'active']);
        $election = $this->election(['academic_semester_id' => $semester->id]);
        $this->position($election, 'President', [4, 4]);
        $this->advance($election);
        Sanctum::actingAs($this->admin);
        $url = '/api/elections/'.$election->id.'/runoff';

        $this->postJson($url, $this->schedule(['runoff_publish_at' => '2026-12-22T01:00:00Z']))->assertUnprocessable()->assertJsonValidationErrors('runoff_publish_at');
        $this->postJson($url, $this->schedule(['runoff_publish_at' => '2026-12-20T09:00:00Z']))->assertOk();
    }

    public function test_only_the_admin_of_the_organization_schedules_the_runoff(): void
    {
        $election = $this->election();
        $this->position($election, 'President', [4, 4]);
        $this->advance($election);
        $stranger = User::factory()->admin()->create(['organization_id' => $this->makeCollegeStudentOrganization($this->makeCollege('CBA'))->id]);

        Sanctum::actingAs($this->officer);
        $this->postJson('/api/elections/'.$election->id.'/runoff', $this->schedule())->assertForbidden();
        Sanctum::actingAs($this->student);
        $this->postJson('/api/elections/'.$election->id.'/runoff', $this->schedule())->assertForbidden();
        Sanctum::actingAs($stranger);
        $this->postJson('/api/elections/'.$election->id.'/runoff', $this->schedule())->assertNotFound();

        $this->assertNull($election->fresh()->runoff_starts_at);
    }

    public function test_the_phase_is_runoff_while_the_runoff_window_is_open_and_round_two_opens(): void
    {
        $election = $this->election(['runoff_starts_at' => '2026-12-17 09:00:00', 'runoff_ends_at' => '2026-12-17 17:00:00', 'runoff_publish_at' => '2026-12-18 09:00:00', 'results_visible' => true]);
        [$position] = $this->position($election, 'President', [4, 4]);
        $this->advance($election);
        $this->assertSame('runoff_scheduled', $position->fresh()->result_status);

        Carbon::setTestNow('2026-12-17 10:00:00');
        $this->advance($election);

        $this->assertSame('runoff', $election->fresh()->phase);
        $this->assertSame(2, $election->fresh()->openRound());
        $this->assertSame('runoff_voting', $position->fresh()->result_status);
    }

    public function test_a_runoff_that_breaks_the_tie_decides_the_position_and_completes_after_publication(): void
    {
        $election = $this->election(['runoff_starts_at' => '2026-12-17 09:00:00', 'runoff_ends_at' => '2026-12-17 17:00:00', 'runoff_publish_at' => '2026-12-18 09:00:00', 'results_visible' => true]);
        [$position, [$loser, $winner]] = $this->position($election, 'President', [[4, 2], [4, 7]]);

        Carbon::setTestNow('2026-12-17 18:00:00');
        $this->advance($election);

        $this->assertSame('decided', $position->fresh()->result_status);
        $this->assertSame('canvassing', $election->fresh()->phase);

        Carbon::setTestNow('2026-12-18 09:00:00');
        $this->advance($election);

        $election = $election->fresh();
        $this->assertSame('completed', $election->phase);
        $this->assertNotNull($election->completed_at);
        $this->assertNotContains($loser->id, app(ElectionTallyService::class)->standings($election)->first()['winners']->pluck('id')->all());
        $this->assertSame([$winner->id], app(ElectionTallyService::class)->standings($election)->first()['winners']->pluck('id')->all());
    }

    public function test_a_runoff_that_is_still_tied_holds_the_election_for_the_reviewer(): void
    {
        $head = $this->makeCollegeHead(College::first());
        $election = $this->election(['runoff_starts_at' => '2026-12-17 09:00:00', 'runoff_ends_at' => '2026-12-17 17:00:00', 'runoff_publish_at' => '2026-12-18 09:00:00', 'results_visible' => true]);
        [$position] = $this->position($election, 'President', [[4, 3], [4, 3]]);

        Carbon::setTestNow('2026-12-17 18:00:00');
        $this->advance($election);
        $this->advance($election);

        $this->assertSame('tie_pending', $position->fresh()->result_status);
        $this->assertSame('tie_resolution', $election->fresh()->phase);
        $this->assertSame(1, $this->noticesTo($head, 'Tie needs a decision'));
        $this->assertNull($election->fresh()->completed_at);

        Carbon::setTestNow('2026-12-19 09:00:00');
        $this->advance($election);
        $this->assertSame('tie_resolution', $election->fresh()->phase);
    }
}
