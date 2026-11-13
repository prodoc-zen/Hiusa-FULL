<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * The election endpoints never disclose or accept what the phase engine alone may do: round 2 totals are read only through
 * the results endpoint, a filing election is published, closed and completed by the engine and not by the Admin's form,
 * and an election that predates semesters stays on the list once a semester is active.
 */
class ElectionHardeningTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $student;

    private AcademicSemester $semester;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);
        Carbon::setTestNow('2026-12-05 09:00:00');

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $this->semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function filingElection(array $overrides = []): Election
    {
        return Election::factory()->create([
            'organization_id' => $this->organization->id,
            'academic_semester_id' => $this->semester->id,
            'status' => 'closed',
            'phase' => 'runoff',
            'approved_at' => '2026-11-01 09:00:00',
            'finalized_at' => '2026-12-01 09:00:00',
            'filing_starts_at' => '2026-11-02 08:00:00',
            'start_time' => '2026-12-02 08:00:00',
            'end_time' => '2026-12-03 17:00:00',
            'results_publish_at' => '2026-12-04 08:00:00',
            'runoff_starts_at' => '2026-12-05 08:00:00',
            'runoff_ends_at' => '2026-12-06 17:00:00',
            'runoff_publish_at' => '2026-12-07 08:00:00',
            'results_visible' => true,
            'tally_version' => 2,
            ...$overrides,
        ]);
    }

    private function candidate(Election $election, int $roundOne, int $roundTwo): Candidate
    {
        $position = ElectionPosition::firstOrCreate(['election_id' => $election->id, 'title' => 'Representative'], ['max_winners' => 1]);
        $candidate = Candidate::factory()->create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'user_id' => User::factory()->student()->create(['organization_id' => $this->organization->id])->school_id,
        ]);
        foreach ([[1, $roundOne], [2, $roundTwo]] as [$round, $count]) {
            for ($i = 0; $i < $count; $i++) {
                Vote::create([
                    'election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id,
                    'voter_id' => null, 'round' => $round, 'vote_hash' => bin2hex(random_bytes(16)), 'cast_at' => '2026-12-02 00:00:00',
                ]);
            }
        }

        return $candidate;
    }

    public function test_the_election_never_returns_runoff_votes_mixed_into_the_published_totals(): void
    {
        $election = $this->filingElection();
        $candidate = $this->candidate($election, 2, 3);

        foreach ([$this->student, $this->admin] as $reader) {
            Sanctum::actingAs($reader);
            $counts = $this->getJson('/api/elections/'.$election->id)->assertOk()->json('vote_counts');

            $this->assertSame(2, (int) $counts[$candidate->id]);
        }
    }

    public function test_the_admin_cannot_publish_close_or_reopen_a_filing_election_by_hand(): void
    {
        $active = $this->filingElection(['status' => 'active', 'phase' => 'voting', 'results_visible' => false, 'end_time' => '2026-12-06 17:00:00']);
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/elections/'.$active->id, ['results_visible' => true])->assertStatus(409);
        $this->putJson('/api/elections/'.$active->id, ['status' => 'closed'])->assertStatus(409);
        $this->assertSame('active', $active->fresh()->status);
        $this->assertFalse((bool) $active->fresh()->results_visible);

        $closed = $this->filingElection(['phase' => 'canvassing', 'results_visible' => false]);
        $this->putJson('/api/elections/'.$closed->id, ['status' => 'active'])->assertStatus(409);
        $this->putJson('/api/elections/'.$closed->id, ['results_visible' => true])->assertStatus(409);
        $this->assertSame('closed', $closed->fresh()->status);
        $this->assertFalse((bool) $closed->fresh()->results_visible);
    }

    public function test_a_save_that_keeps_the_published_state_is_not_refused(): void
    {
        $published = $this->filingElection();
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/elections/'.$published->id, ['results_visible' => true])->assertOk();
        $this->assertTrue((bool) $published->fresh()->results_visible);
    }

    public function test_a_legacy_election_is_still_closed_by_the_admin(): void
    {
        $legacy = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'academic_semester_id' => $this->semester->id,
            'status' => 'active',
            'approved_at' => '2026-11-01 09:00:00',
            'finalized_at' => '2026-12-01 09:00:00',
            'start_time' => '2026-12-04 08:00:00',
            'end_time' => '2026-12-06 17:00:00',
            'results_visible' => false,
        ]);
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/elections/'.$legacy->id, ['status' => 'closed'])->assertOk();

        $this->assertSame('closed', $legacy->fresh()->status);
    }

    public function test_an_election_without_a_semester_stays_on_the_list_once_a_semester_is_active(): void
    {
        $old = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'academic_semester_id' => null,
            'status' => 'active',
            'approved_at' => '2026-11-01 09:00:00',
            'finalized_at' => '2026-12-01 09:00:00',
            'start_time' => '2026-12-04 08:00:00',
            'end_time' => '2026-12-06 17:00:00',
        ]);

        foreach ([$this->admin, $this->student] as $reader) {
            Sanctum::actingAs($reader);
            $ids = collect($this->getJson('/api/elections')->assertOk()->json())->pluck('id');

            $this->assertTrue($ids->contains($old->id), $reader->role.' does not see the election that has no semester');
        }
    }
}
