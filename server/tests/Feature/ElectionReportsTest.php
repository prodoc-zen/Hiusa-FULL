<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\College;
use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionBallot;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\Partylist;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * The seven election reports: one endpoint, JSON for the Excel export and PDF for printing. They name people and
 * positions and carry totals, but never a document path and never anything that links a voter to a choice.
 */
class ElectionReportsTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private College $college;

    private Organization $organization;

    private User $admin;

    private User $officer;

    private User $head;

    private Election $election;

    private ElectionPosition $president;

    private array $candidates = [];

    private User $voter;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        Carbon::setTestNow('2026-12-12 10:00:00');
        $this->college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($this->college, ['name' => 'Computer Society']);
        $this->head = $this->makeCollegeHead($this->college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id, 'first_name' => 'Ada', 'last_name' => 'Admin']);
        $this->officer = User::factory()->officer()->create(['organization_id' => $this->organization->id]);

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);

        $this->election = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'academic_semester_id' => $semester->id,
            'title' => 'SBO Election 2026',
            'status' => 'closed',
            'phase' => 'completed',
            'approved_at' => '2026-12-01 09:00:00',
            'finalized_at' => '2026-12-05 09:00:00',
            'start_time' => '2026-12-10 08:00:00',
            'end_time' => '2026-12-11 17:00:00',
            'filing_starts_at' => '2026-12-01 08:00:00',
            'results_publish_at' => '2026-12-12 08:00:00',
            'results_visible' => true,
            'tally_version' => 2,
        ]);
        $this->president = ElectionPosition::factory()->create(['election_id' => $this->election->id, 'title' => 'President', 'max_winners' => 1]);
        ElectionPosition::factory()->create(['election_id' => $this->election->id, 'title' => 'Treasurer', 'max_winners' => 1]);

        $slate = Partylist::create(['name' => 'Unity', 'motto' => 'Together', 'color' => '#1F4E79', 'election_id' => $this->election->id, 'representative_school_id' => $this->admin->school_id]);
        foreach ([['Alice', 'Alpha', 3, $slate->id], ['Bob', 'Beta', 1, null]] as [$first, $last, $votes, $partylist]) {
            $student = User::factory()->student()->create(['organization_id' => $this->organization->id, 'first_name' => $first, 'last_name' => $last]);
            $candidate = Candidate::factory()->create([
                'election_id' => $this->election->id,
                'position_id' => $this->president->id,
                'user_id' => $student->school_id,
                'partylist_id' => $partylist,
            ]);
            for ($i = 0; $i < $votes; $i++) {
                Vote::create([
                    'election_id' => $this->election->id, 'position_id' => $this->president->id, 'candidate_id' => $candidate->id,
                    'voter_id' => null, 'round' => 1, 'vote_hash' => bin2hex(random_bytes(16)), 'cast_at' => '2026-12-10 00:00:00',
                ]);
            }
            $this->candidates[$first] = [$student, $candidate];
            ElectionApplication::factory()->create([
                'election_id' => $this->election->id,
                'position_id' => $this->president->id,
                'user_school_id' => $student->school_id,
                'partylist_id' => $partylist,
                'status' => 'approved',
                'review_notes' => $first === 'Alice' ? 'All documents are complete.' : null,
                'reviewed_by' => $this->admin->school_id,
                'reviewed_at' => '2026-12-03 10:00:00',
                'submitted_at' => '2026-12-02 10:00:00',
                'coc_path' => 'private/coc/secret-coc.pdf',
                'credentials_path' => 'private/credentials/secret-grades.pdf',
                'candidate_id' => $candidate->id,
            ]);
        }

        $this->voter = User::factory()->student()->create(['organization_id' => $this->organization->id, 'first_name' => 'Vera', 'last_name' => 'Voter']);
        ElectionBallot::factory()->create(['election_id' => $this->election->id, 'round' => 1, 'voter_id' => $this->voter->school_id]);
        Vote::create([
            'election_id' => $this->election->id, 'position_id' => $this->president->id, 'candidate_id' => $this->candidates['Alice'][1]->id,
            'voter_id' => $this->voter->school_id, 'round' => 1, 'vote_hash' => bin2hex(random_bytes(16)), 'cast_at' => '2026-12-10 09:00:00',
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function url(string $type, string $format = 'json', ?Election $election = null): string
    {
        return '/api/elections/'.($election ?? $this->election)->id.'/reports/'.$type.'?format='.$format;
    }

    public static function reportTypes(): array
    {
        return [
            'candidates' => ['candidates', ['Position', 'Candidate', 'Party list']],
            'screening' => ['screening', ['Candidate', 'Position', 'Party list', 'Status', 'Decision notes', 'Reviewed by', 'Submitted', 'Reviewed']],
            'partylists' => ['partylists', ['Party list', 'Motto', 'Representative', 'Position', 'Member', 'Status']],
            'participation' => ['participation', ['Round', 'Eligible voters', 'Ballots submitted', 'Turnout (%)']],
            'canvassing' => ['canvassing', ['Position', 'Candidate', 'Party list', 'Round 1 votes', 'Runoff votes']],
            'results' => ['results', ['Position', 'Seats', 'Outcome', 'Winners', 'Vacant seats', 'Resolution']],
            'audit' => ['audit', ['Action', 'Actor', 'Time', 'Detail']],
        ];
    }

    /** @dataProvider reportTypes */
    public function test_each_report_has_the_header_and_its_columns(string $type, array $columns): void
    {
        Sanctum::actingAs($this->admin);

        $response = $this->getJson($this->url($type))->assertOk();

        $response->assertJsonPath('election.title', 'SBO Election 2026');
        $response->assertJsonPath('election.organization', 'Computer Society');
        $response->assertJsonPath('election.academic_year', '2026-2027');
        $this->assertNotEmpty($response->json('title'));
        $this->assertNotEmpty($response->json('generated_at'));
        $this->assertSame($columns, $response->json('columns'));
        foreach ($response->json('rows') as $row) {
            $this->assertCount(count($columns), $row);
        }
        $response->assertHeader('Cache-Control');
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
    }

    public function test_the_candidates_report_lists_approved_candidates_with_party_list_or_independent(): void
    {
        Sanctum::actingAs($this->admin);

        $rows = $this->getJson($this->url('candidates'))->assertOk()->json('rows');

        $this->assertContains(['President', 'Alice Alpha', 'Unity'], $rows);
        $this->assertContains(['President', 'Bob Beta', 'Independent'], $rows);
    }

    public function test_the_screening_report_has_decisions_and_reviewers_but_no_document_paths(): void
    {
        Sanctum::actingAs($this->admin);

        $response = $this->getJson($this->url('screening'))->assertOk();
        $rows = $response->json('rows');

        $this->assertCount(2, $rows);
        $alice = collect($rows)->first(fn ($row) => $row[0] === 'Alice Alpha');
        $this->assertSame('President', $alice[1]);
        $this->assertSame('Approved', $alice[3]);
        $this->assertSame('All documents are complete.', $alice[4]);
        $this->assertSame('Ada Admin', $alice[5]);
        $this->assertStringNotContainsString('secret', $response->getContent());
        $this->assertStringNotContainsString('private/', $response->getContent());
    }

    public function test_the_partylists_report_shows_each_slate_with_motto_representative_and_members(): void
    {
        ElectionApplication::where('user_school_id', $this->candidates['Alice'][0]->school_id)->update(['partylist_id' => Partylist::first()->id]);
        Sanctum::actingAs($this->admin);

        $rows = $this->getJson($this->url('partylists'))->assertOk()->json('rows');

        $this->assertContains(['Unity', 'Together', 'Ada Admin', 'President', 'Alice Alpha', 'Approved'], $rows);
        $this->assertCount(1, $rows);
    }

    public function test_the_participation_report_counts_ballots_per_round_without_naming_voters(): void
    {
        Sanctum::actingAs($this->admin);

        $response = $this->getJson($this->url('participation'))->assertOk();

        $row = $response->json('rows.0');
        $this->assertSame('First round', $row[0]);
        $this->assertSame(1, $row[2]);
        $this->assertGreaterThan(0, $row[1]);
        $this->assertEquals(round(1 / $row[1] * 100, 1), $row[3]);
        $content = $response->getContent();
        $this->assertStringNotContainsString('Vera', $content);
        $this->assertStringNotContainsString((string) $this->voter->school_id, $content);
    }

    public function test_the_participation_report_adds_a_runoff_round_when_ballots_exist_for_it(): void
    {
        ElectionBallot::factory()->create(['election_id' => $this->election->id, 'round' => 2, 'voter_id' => $this->voter->school_id]);
        Sanctum::actingAs($this->admin);

        $rows = $this->getJson($this->url('participation'))->assertOk()->json('rows');

        $this->assertSame(['First round', 'Runoff'], array_column($rows, 0));
        $this->assertSame(1, $rows[1][2]);
    }

    public function test_the_canvassing_report_has_totals_per_candidate(): void
    {
        Sanctum::actingAs($this->admin);

        $rows = $this->getJson($this->url('canvassing'))->assertOk()->json('rows');

        $this->assertContains(['President', 'Alice Alpha', 'Unity', 4, null], $rows);
        $this->assertContains(['President', 'Bob Beta', 'Independent', 1, null], $rows);
    }

    public function test_the_results_report_names_winners_vacancies_and_outcomes(): void
    {
        Sanctum::actingAs($this->admin);

        $rows = collect($this->getJson($this->url('results'))->assertOk()->json('rows'));

        $president = $rows->first(fn ($row) => $row[0] === 'President');
        $this->assertSame([1, 'Elected', 'Alice Alpha', 0], [$president[1], $president[2], $president[3], $president[4]]);
        $treasurer = $rows->first(fn ($row) => $row[0] === 'Treasurer');
        $this->assertSame('Vacant: no candidates', $treasurer[2]);
        $this->assertSame(1, $treasurer[4]);
    }

    public function test_the_results_report_carries_the_tie_rule_and_explanation(): void
    {
        $this->president->update(['resolved_winner_ids' => [$this->candidates['Bob'][1]->id], 'tie_rule_used' => 'Longer membership wins.', 'tie_explanation' => 'Bob has served longer.', 'result_status' => 'resolved']);
        Vote::where('candidate_id', $this->candidates['Alice'][1]->id)->orderBy('id')->take(3)->get()->each->delete();
        Sanctum::actingAs($this->admin);

        $rows = collect($this->getJson($this->url('results'))->assertOk()->json('rows'));

        $president = $rows->first(fn ($row) => $row[0] === 'President');
        $this->assertSame('Tie resolved', $president[2]);
        $this->assertStringContainsString('Longer membership wins.', $president[5]);
        $this->assertStringContainsString('Bob has served longer.', $president[5]);
    }

    public function test_the_audit_report_lists_the_election_rows_without_a_voter_to_choice_link(): void
    {
        AuditLog::create([
            'organization_id' => $this->organization->id, 'user_id' => $this->admin->school_id, 'module' => 'elections',
            'action' => 'application_reviewed', 'record_type' => Election::class, 'record_id' => $this->election->id,
            'old_values' => null, 'new_values' => ['decision' => 'approve', 'notes' => 'Looks good.', 'voter_id' => $this->voter->school_id, 'candidate_id' => 7],
            'ip_address' => '127.0.0.1', 'created_at' => '2026-12-03 10:00:00',
        ]);
        AuditLog::create([
            'organization_id' => $this->organization->id, 'user_id' => $this->admin->school_id, 'module' => 'elections',
            'action' => 'status_changed', 'record_type' => Election::class, 'record_id' => 999999,
            'old_values' => null, 'new_values' => ['status' => 'other election'], 'ip_address' => '127.0.0.1', 'created_at' => '2026-12-03 11:00:00',
        ]);
        Sanctum::actingAs($this->admin);

        $response = $this->getJson($this->url('audit'))->assertOk();
        $rows = $response->json('rows');

        $reviewed = array_values(array_filter($rows, fn ($row) => $row[0] === 'application_reviewed'));
        $this->assertCount(1, $reviewed);
        $this->assertSame('Ada Admin', $reviewed[0][1]);
        $this->assertStringContainsString('Looks good.', $reviewed[0][3]);
        $this->assertSame(0, count(array_filter($rows, fn ($row) => $row[0] === 'status_changed' && str_contains($row[3], 'other election'))));
        $content = $response->getContent();
        $this->assertStringNotContainsString('voter_id', $content);
        $this->assertStringNotContainsString('candidate_id', $content);
        $this->assertStringNotContainsString((string) $this->voter->school_id, $content);
        $this->assertStringNotContainsString('other election', $content);
    }

    public function test_a_pdf_streams_inline_with_the_right_type_and_no_store(): void
    {
        Sanctum::actingAs($this->admin);

        $response = $this->get($this->url('candidates', 'pdf'))->assertOk();

        $this->assertStringStartsWith('application/pdf', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('inline', $response->headers->get('Content-Disposition'));
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->assertStringStartsWith('%PDF', $response->getContent());
    }

    public function test_every_export_writes_a_report_exported_audit_row(): void
    {
        Sanctum::actingAs($this->admin);

        $this->getJson($this->url('candidates'))->assertOk();
        $this->get($this->url('results', 'pdf'))->assertOk();

        $rows = AuditLog::where('action', 'report_exported')->where('record_id', $this->election->id)->orderBy('id')->get();
        $this->assertCount(2, $rows);
        $this->assertSame($this->admin->school_id, $rows[0]->user_id);
        $this->assertSame('elections', $rows[0]->module);
        $this->assertSame(Election::class, $rows[0]->record_type);
        $this->assertSame(['type' => 'candidates', 'format' => 'json'], $rows[0]->new_values);
        $this->assertSame(['type' => 'results', 'format' => 'pdf'], $rows[1]->new_values);
    }

    public function test_an_officer_and_the_dean_read_reports_in_their_scope(): void
    {
        Sanctum::actingAs($this->officer);
        $this->getJson($this->url('candidates'))->assertOk();

        Sanctum::actingAs($this->head);
        $this->getJson($this->url('canvassing'))->assertOk();
    }

    public function test_an_election_outside_the_callers_scope_is_not_found(): void
    {
        $otherCollege = $this->makeCollege('CBA');
        $otherOrganization = $this->makeCollegeStudentOrganization($otherCollege);
        $otherAdmin = User::factory()->admin()->create(['organization_id' => $otherOrganization->id]);
        $otherHead = $this->makeCollegeHead($otherCollege);

        foreach ([$otherAdmin, $otherHead] as $caller) {
            Sanctum::actingAs($caller);
            $this->getJson($this->url('candidates'))->assertNotFound();
            $this->get($this->url('candidates', 'pdf'))->assertNotFound();
        }
        $this->assertSame(0, AuditLog::where('action', 'report_exported')->count());
    }

    public function test_a_student_cannot_read_reports(): void
    {
        Sanctum::actingAs($this->voter);

        $this->getJson($this->url('candidates'))->assertForbidden();
    }

    public function test_an_unknown_type_or_format_is_refused(): void
    {
        Sanctum::actingAs($this->admin);

        $this->getJson($this->url('ballots'))->assertNotFound();
        $this->getJson($this->url('candidates', 'xml'))->assertStatus(422);
    }

    public function test_the_format_defaults_to_json(): void
    {
        Sanctum::actingAs($this->admin);

        $this->getJson('/api/elections/'.$this->election->id.'/reports/candidates')->assertOk()->assertJsonStructure(['title', 'columns', 'rows']);
    }

    public function test_canvassing_and_results_follow_the_results_visibility_gate(): void
    {
        $this->election->update(['results_visible' => false, 'results_publish_at' => '2026-12-20 08:00:00']);

        Sanctum::actingAs($this->officer);
        $this->getJson($this->url('canvassing'))->assertForbidden();
        $this->getJson($this->url('results'))->assertForbidden();
        $this->getJson($this->url('candidates'))->assertOk();

        Sanctum::actingAs($this->head);
        $this->getJson($this->url('results'))->assertForbidden();

        Sanctum::actingAs($this->admin);
        $this->getJson($this->url('canvassing'))->assertOk();
        $this->getJson($this->url('results'))->assertOk();
    }

    public function test_no_totals_before_voting_has_closed_even_for_the_admin(): void
    {
        $this->election->update(['status' => 'active', 'phase' => 'voting', 'results_visible' => false, 'start_time' => '2026-12-12 08:00:00', 'end_time' => '2026-12-12 17:00:00', 'results_publish_at' => '2026-12-20 08:00:00']);
        Sanctum::actingAs($this->admin);

        $this->getJson($this->url('canvassing'))->assertForbidden();
        $this->getJson($this->url('results'))->assertForbidden();
        $this->getJson($this->url('participation'))->assertOk();
    }
}
