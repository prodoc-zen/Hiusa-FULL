<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AccountProfile;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionBallot;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class ElectionSetupTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $head;

    private AcademicSemester $semester;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);
        $this->travelTo('2026-11-14 08:00:00');
        Storage::fake('local');

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $this->semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->head = $this->makeCollegeHead($college);
    }

    /** Dates are sent as UTC instants, so 00:00Z is 08:00 in Manila. */
    private function schedule(array $overrides = []): array
    {
        return [
            'filing_starts_at' => '2026-11-20T00:00:00Z',
            'filing_ends_at' => '2026-11-25T00:00:00Z',
            'screening_starts_at' => '2026-11-26T00:00:00Z',
            'screening_ends_at' => '2026-11-28T00:00:00Z',
            'campaign_starts_at' => '2026-11-29T00:00:00Z',
            'campaign_ends_at' => '2026-12-03T00:00:00Z',
            'start_time' => '2026-12-04T00:00:00Z',
            'end_time' => '2026-12-05T00:00:00Z',
            'results_publish_at' => '2026-12-06T00:00:00Z',
            ...$overrides,
        ];
    }

    private function filingPayload(array $overrides = []): array
    {
        return [
            'title' => 'General election',
            'description' => 'Choose the new officers.',
            ...$this->schedule(),
            'rules' => 'Candidates must be enrolled members.',
            'tie_break_rule' => 'The Department Head picks by lottery.',
            'min_units' => 12,
            'min_gpa' => 2.5,
            'positions' => [
                ['title' => 'President', 'max_winners' => 1, 'is_executive' => true, 'description' => 'Leads the council', 'eligible_year_levels' => [1, 2, 3], 'other_qualifications' => 'Good standing', 'is_active' => true],
                ['title' => 'Representative', 'max_winners' => 3, 'vote_limit' => 2],
            ],
            ...$overrides,
        ];
    }

    private function letter(): UploadedFile
    {
        return UploadedFile::fake()->create('letter.pdf', 20, 'application/pdf');
    }

    private function postElection(array $payload, bool $withLetter = true)
    {
        return $this->post('/api/elections', $payload + ($withLetter ? ['informative_letter' => $this->letter()] : []), ['Accept' => 'application/json']);
    }

    private function legacyPayload(array $overrides = []): array
    {
        return [
            'title' => 'Demo Representative',
            'start_time' => '2026-12-04T00:00:00Z',
            'end_time' => '2026-12-04T09:00:00Z',
            'positions' => [['title' => 'Representative', 'max_winners' => 1]],
            ...$overrides,
        ];
    }

    private function approvedFilingElection(array $overrides = []): Election
    {
        $election = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'academic_semester_id' => $this->semester->id,
            'title' => 'General election',
            'status' => 'upcoming',
            'phase' => 'scheduled',
            'approved_at' => now()->subDay(),
            'submitted_at' => now()->subDays(2),
            'rules' => 'Candidates must be enrolled members.',
            'tie_break_rule' => 'The Department Head picks by lottery.',
            'min_units' => 12,
            'min_gpa' => 2.5,
            'filing_starts_at' => '2026-11-20 08:00:00',
            'filing_ends_at' => '2026-11-25 08:00:00',
            'screening_starts_at' => '2026-11-26 08:00:00',
            'screening_ends_at' => '2026-11-28 08:00:00',
            'campaign_starts_at' => '2026-11-29 08:00:00',
            'campaign_ends_at' => '2026-12-03 08:00:00',
            'start_time' => '2026-12-04 08:00:00',
            'end_time' => '2026-12-05 08:00:00',
            'results_publish_at' => '2026-12-06 08:00:00',
            ...$overrides,
        ]);
        ElectionPosition::create(['election_id' => $election->id, 'title' => 'President', 'max_winners' => 1]);
        ApprovalRequest::create([
            'organization_id' => $this->organization->id,
            'entity_type' => 'election',
            'entity_id' => $election->id,
            'requested_by' => $this->admin->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'approved',
        ]);

        return $election;
    }

    private function legacyElection(array $overrides = []): Election
    {
        return Election::factory()->create([
            'organization_id' => $this->organization->id,
            'academic_semester_id' => $this->semester->id,
            'status' => 'upcoming',
            'approved_at' => now()->subDay(),
            'start_time' => '2026-12-04 08:00:00',
            'end_time' => '2026-12-04 17:00:00',
            ...$overrides,
        ]);
    }

    private function approvalCount(Election $election): int
    {
        return ApprovalRequest::where('entity_type', 'election')->where('entity_id', $election->id)->count();
    }

    public function test_a_legacy_create_is_unchanged(): void
    {
        Sanctum::actingAs($this->admin);

        $response = $this->postElection($this->legacyPayload())->assertCreated();

        $election = Election::findOrFail($response->json('id'));
        $this->assertFalse($election->usesFiling());
        $this->assertSame('pending_approval', $election->status);
        $this->assertTrue($election->results_visible);
        $this->assertNotNull($election->submitted_at);
        $this->assertSame(1, $this->approvalCount($election));
        $this->assertSame('2026-12-04 08:00:00', $election->start_time->format('Y-m-d H:i:s'));
        $this->assertNull($election->filing_starts_at);
    }

    public function test_a_filing_create_stores_every_field_and_asks_for_approval(): void
    {
        Sanctum::actingAs($this->admin);

        $response = $this->postElection($this->filingPayload())->assertCreated();

        $election = Election::with('positions')->findOrFail($response->json('id'));
        $this->assertTrue($election->usesFiling());
        $this->assertFalse($election->results_visible);
        $this->assertSame('pending_approval', $election->status);
        $this->assertNotNull($election->submitted_at);
        $this->assertSame(1, $this->approvalCount($election));
        $this->assertSame('2026-11-20 08:00:00', $election->filing_starts_at->format('Y-m-d H:i:s'));
        $this->assertSame('2026-12-06 08:00:00', $election->results_publish_at->format('Y-m-d H:i:s'));
        $this->assertSame('Choose the new officers.', $election->description);
        $this->assertSame('Candidates must be enrolled members.', $election->rules);
        $this->assertSame('The Department Head picks by lottery.', $election->tie_break_rule);
        $this->assertSame(12, $election->min_units);
        $this->assertSame('2.50', $election->min_gpa);

        $president = $election->positions->firstWhere('title', 'President');
        $this->assertTrue($president->is_executive);
        $this->assertSame([1, 2, 3], $president->eligible_year_levels);
        $this->assertSame('Leads the council', $president->description);
        $this->assertSame('Good standing', $president->other_qualifications);
        $representative = $election->positions->firstWhere('title', 'Representative');
        $this->assertSame(2, $representative->vote_limit);
        $this->assertTrue($representative->is_active);
        $this->assertFalse($representative->is_executive);
    }

    public function test_a_filing_create_defaults_the_minimum_units_to_ten(): void
    {
        Sanctum::actingAs($this->admin);
        $payload = $this->filingPayload();
        unset($payload['min_units'], $payload['min_gpa']);

        $id = $this->postElection($payload)->assertCreated()->json('id');

        $this->assertSame(10, Election::findOrFail($id)->min_units);
        $this->assertNull(Election::findOrFail($id)->min_gpa);
    }

    public function test_a_schedule_out_of_order_is_refused_with_the_field_message(): void
    {
        Sanctum::actingAs($this->admin);

        $this->postElection($this->filingPayload(['filing_ends_at' => '2026-11-19T00:00:00Z']))
            ->assertUnprocessable()->assertJsonValidationErrors('filing_ends_at');
        $this->postElection($this->filingPayload(['screening_starts_at' => '2026-11-24T00:00:00Z']))
            ->assertUnprocessable()->assertJsonValidationErrors('screening_starts_at');
        $this->postElection($this->filingPayload(['start_time' => '2026-12-01T00:00:00Z']))
            ->assertUnprocessable()->assertJsonValidationErrors('start_time');
        $this->postElection($this->filingPayload(['results_publish_at' => '2026-12-04T12:00:00Z']))
            ->assertUnprocessable()->assertJsonValidationErrors('results_publish_at');
        $this->assertSame(0, Election::count());
    }

    public function test_the_schedule_must_fall_inside_the_semester(): void
    {
        Sanctum::actingAs($this->admin);

        $this->postElection($this->filingPayload(['results_publish_at' => '2027-01-10T00:00:00Z']))
            ->assertUnprocessable()->assertJsonValidationErrors('results_publish_at');
        $this->postElection($this->filingPayload(['filing_starts_at' => '2026-07-20T00:00:00Z']))
            ->assertUnprocessable()->assertJsonValidationErrors('filing_starts_at');
    }

    public function test_a_filing_create_needs_every_schedule_field_the_rules_and_the_tie_break_rule(): void
    {
        Sanctum::actingAs($this->admin);

        foreach (['filing_ends_at', 'campaign_ends_at', 'results_publish_at', 'rules', 'tie_break_rule'] as $field) {
            $payload = $this->filingPayload();
            unset($payload[$field]);
            $this->postElection($payload)->assertUnprocessable()->assertJsonValidationErrors($field);
        }
        $this->postElection($this->filingPayload(), false)->assertUnprocessable()->assertJsonValidationErrors('informative_letter');
    }

    public function test_the_vote_limit_cannot_exceed_the_seats(): void
    {
        Sanctum::actingAs($this->admin);

        $payload = $this->filingPayload(['positions' => [['title' => 'Representative', 'max_winners' => 2, 'vote_limit' => 3]]]);
        $this->postElection($payload)->assertUnprocessable()->assertJsonValidationErrors('positions.0.vote_limit');
        $this->postElection($this->filingPayload(['positions' => [['title' => 'Representative', 'max_winners' => 2, 'eligible_year_levels' => [7]]]]))
            ->assertUnprocessable()->assertJsonValidationErrors('positions.0.eligible_year_levels.0');
        $this->postElection($this->filingPayload(['min_gpa' => 6]))->assertUnprocessable()->assertJsonValidationErrors('min_gpa');
        $this->postElection($this->filingPayload(['min_units' => 61]))->assertUnprocessable()->assertJsonValidationErrors('min_units');
    }

    public function test_a_draft_with_only_a_title_creates_no_approval_and_is_invisible_to_the_dean(): void
    {
        Sanctum::actingAs($this->admin);

        $response = $this->postJson('/api/elections', ['title' => 'Draft election', 'draft' => true])->assertCreated();

        $election = Election::findOrFail($response->json('id'));
        $this->assertSame('pending_approval', $election->status);
        $this->assertNull($election->submitted_at);
        $this->assertSame(0, $this->approvalCount($election));
        $this->assertNull($response->json('start_time'));
        $this->assertNull($response->json('end_time'));

        $this->getJson('/api/elections')->assertOk()->assertJsonCount(1);
        $this->getJson('/api/elections/'.$election->id)->assertOk()->assertJsonPath('start_time', null);

        Sanctum::actingAs($this->head);
        $this->getJson('/api/elections')->assertOk()->assertExactJson([]);
        $this->getJson('/api/elections/'.$election->id)->assertNotFound();
    }

    public function test_a_draft_keeps_what_was_sent_without_asking_for_approval(): void
    {
        Sanctum::actingAs($this->admin);

        $id = $this->postJson('/api/elections', ['title' => 'Draft election', 'draft' => true, 'rules' => 'Be kind.', 'filing_starts_at' => '2026-11-20T00:00:00Z'])
            ->assertCreated()->json('id');

        $election = Election::findOrFail($id);
        $this->assertSame('Be kind.', $election->rules);
        $this->assertTrue($election->usesFiling());
        $this->assertFalse($election->results_visible);
        $this->assertSame(0, $this->approvalCount($election));
    }

    public function test_submitting_an_incomplete_draft_is_refused_and_a_complete_one_creates_the_approval(): void
    {
        Sanctum::actingAs($this->admin);
        $id = $this->postJson('/api/elections', ['title' => 'Draft election', 'draft' => true, 'filing_starts_at' => '2026-11-20T00:00:00Z'])
            ->assertCreated()->json('id');

        $this->postJson("/api/elections/{$id}/submit")->assertUnprocessable();
        $this->assertSame(0, ApprovalRequest::where('entity_id', $id)->count());

        $this->put("/api/elections/{$id}", $this->filingPayload(['informative_letter' => $this->letter()]), ['Accept' => 'application/json'])->assertOk();
        $this->postJson("/api/elections/{$id}/positions", ['title' => 'President', 'max_winners' => 1])->assertCreated();
        $this->postJson("/api/elections/{$id}/submit")->assertOk();

        $election = Election::findOrFail($id);
        $this->assertNotNull($election->submitted_at);
        $this->assertSame(1, ApprovalRequest::where('entity_id', $id)->where('status', 'pending')->count());
        $this->assertTrue(AuditLog::where('module', 'elections')->where('action', 'submitted')->where('record_id', $id)->exists());

        $this->postJson("/api/elections/{$id}/submit")->assertStatus(409);

        Sanctum::actingAs($this->head);
        $this->getJson('/api/elections')->assertOk()->assertJsonCount(1);
    }

    public function test_submit_needs_an_active_position_and_the_letter(): void
    {
        Sanctum::actingAs($this->admin);
        $id = $this->postJson('/api/elections', ['title' => 'Draft election', 'draft' => true, ...$this->filingPayload(['title' => 'Draft election'])])
            ->assertCreated()->json('id');

        $response = $this->postJson("/api/elections/{$id}/submit")->assertUnprocessable();
        $this->assertArrayHasKey('informative_letter', $response->json('errors'));

        $this->put("/api/elections/{$id}", ['informative_letter' => $this->letter()], ['Accept' => 'application/json'])->assertOk();
        ElectionPosition::where('election_id', $id)->update(['is_active' => false]);
        $response = $this->postJson("/api/elections/{$id}/submit")->assertUnprocessable();
        $this->assertArrayHasKey('positions', $response->json('errors'));
    }

    public function test_a_returned_election_is_resubmitted_through_submit(): void
    {
        Sanctum::actingAs($this->admin);
        $id = $this->postElection($this->filingPayload())->assertCreated()->json('id');
        $approval = ApprovalRequest::where('entity_id', $id)->firstOrFail();
        $approval->update(['status' => 'rejected', 'remarks' => 'Move the dates.']);

        $this->postJson("/api/elections/{$id}/submit")->assertOk();

        $this->assertSame('pending', $approval->fresh()->status);
        $this->assertSame(1, ApprovalRequest::where('entity_id', $id)->count());
        $this->assertTrue(AuditLog::where('action', 'resubmitted')->where('record_id', $id)->exists());
    }

    public function test_a_declined_election_cannot_be_resubmitted_or_changed(): void
    {
        Sanctum::actingAs($this->admin);
        $id = $this->postElection($this->filingPayload())->assertCreated()->json('id');
        ApprovalRequest::where('entity_id', $id)->update(['status' => 'rejected', 'remarks' => 'No.']);
        Election::whereKey($id)->update(['declined_at' => now()]);

        $this->postJson("/api/elections/{$id}/submit")
            ->assertStatus(409)
            ->assertJsonPath('message', 'The Department Head rejected this election. Create a new one.');
        $this->putJson("/api/elections/{$id}", ['rules' => 'New rules.'])->assertStatus(409);
        $this->assertSame('rejected', ApprovalRequest::where('entity_id', $id)->value('status'));
    }

    public function test_submit_belongs_to_the_admin_of_the_organization(): void
    {
        Sanctum::actingAs($this->admin);
        $id = $this->postJson('/api/elections', ['title' => 'Draft election', 'draft' => true])->json('id');

        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]));
        $this->postJson("/api/elections/{$id}/submit")->assertNotFound();
        Sanctum::actingAs(User::factory()->officer()->create(['organization_id' => $this->organization->id]));
        $this->postJson("/api/elections/{$id}/submit")->assertForbidden();
    }

    public function test_a_save_that_changes_nothing_material_keeps_the_approval(): void
    {
        Sanctum::actingAs($this->admin);
        $election = $this->approvedFilingElection();

        $this->putJson("/api/elections/{$election->id}", $this->filingPayload(['title' => 'General election']))->assertOk();
        $this->putJson("/api/elections/{$election->id}", ['title' => 'Renamed election', 'description' => 'New words'])->assertOk();

        $fresh = $election->fresh();
        $this->assertNotNull($fresh->approved_at);
        $this->assertSame('upcoming', $fresh->status);
        $this->assertSame('Renamed election', $fresh->title);
        $this->assertSame(1, $this->approvalCount($election));
    }

    public function test_changing_the_rules_a_date_or_the_qualifications_reopens_approval(): void
    {
        Sanctum::actingAs($this->admin);

        foreach ([
            ['rules' => 'Different rules.'],
            ['tie_break_rule' => 'Coin toss.'],
            ['min_units' => 15],
            ['min_gpa' => 2.0],
            ['campaign_ends_at' => '2026-12-02T00:00:00Z'],
            ['end_time' => '2026-12-05T04:00:00Z'],
        ] as $change) {
            $election = $this->approvedFilingElection();
            $this->putJson("/api/elections/{$election->id}", $change)->assertOk();

            $fresh = $election->fresh();
            $this->assertNull($fresh->approved_at, json_encode($change));
            $this->assertSame('pending_approval', $fresh->status);
            $this->assertNull($fresh->finalized_at);
            $this->assertSame(1, ApprovalRequest::where('entity_id', $election->id)->where('status', 'pending')->count());
            $this->assertTrue(AuditLog::where('action', 'approval_reopened')->where('record_id', $election->id)->exists());
        }
    }

    public function test_nothing_material_changes_once_voting_has_opened_or_on_a_cancelled_election(): void
    {
        Sanctum::actingAs($this->admin);
        $open = $this->approvedFilingElection(['status' => 'active', 'phase' => 'voting', 'finalized_at' => now()->subHour(), 'start_time' => now()->subHour(), 'end_time' => now()->addHour(), 'campaign_ends_at' => now()->subHour(), 'results_publish_at' => now()->addDay()]);
        $this->putJson("/api/elections/{$open->id}", ['rules' => 'Late change.'])->assertStatus(409);
        $this->putJson("/api/elections/{$open->id}", ['title' => 'Still renamable'])->assertOk();

        $cancelled = $this->approvedFilingElection(['cancelled_at' => now(), 'status' => 'closed']);
        $this->putJson("/api/elections/{$cancelled->id}", ['rules' => 'Cancelled change.'])->assertStatus(409);
        $this->putJson("/api/elections/{$cancelled->id}", ['results_visible' => true])->assertStatus(409);
    }

    public function test_a_draft_can_change_anything_and_a_submitted_election_keeps_its_kind(): void
    {
        Sanctum::actingAs($this->admin);
        $draft = $this->postJson('/api/elections', ['title' => 'Draft election', 'draft' => true])->json('id');
        $this->putJson("/api/elections/{$draft}", ['filing_starts_at' => '2026-11-20T00:00:00Z', 'rules' => 'A', 'min_units' => 11])->assertOk();
        $this->assertTrue(Election::findOrFail($draft)->usesFiling());
        $this->putJson("/api/elections/{$draft}", ['filing_starts_at' => null])->assertOk();
        $this->assertFalse(Election::findOrFail($draft)->usesFiling());

        $legacy = $this->legacyElection(['status' => 'pending_approval', 'approved_at' => null, 'submitted_at' => now()]);
        $this->putJson("/api/elections/{$legacy->id}", ['filing_starts_at' => '2026-11-20T00:00:00Z'])->assertUnprocessable();
        $submitted = $this->approvedFilingElection();
        $this->putJson("/api/elections/{$submitted->id}", ['filing_starts_at' => null])->assertUnprocessable();
    }

    public function test_an_update_out_of_order_is_refused_with_the_field_message(): void
    {
        Sanctum::actingAs($this->admin);
        $election = $this->approvedFilingElection(['status' => 'pending_approval', 'approved_at' => null]);

        $this->putJson("/api/elections/{$election->id}", ['screening_ends_at' => '2026-11-25T00:00:00Z'])
            ->assertUnprocessable()->assertJsonValidationErrors('screening_ends_at');
    }

    public function test_a_position_change_on_an_approved_filing_election_reopens_approval(): void
    {
        Sanctum::actingAs($this->admin);
        $election = $this->approvedFilingElection();
        $position = $election->positions()->first();

        $this->postJson("/api/elections/{$election->id}/positions", ['title' => 'Secretary', 'max_winners' => 1, 'is_executive' => true, 'vote_limit' => 1, 'eligible_year_levels' => [1, 2], 'other_qualifications' => 'Neat handwriting', 'description' => 'Keeps the minutes'])
            ->assertCreated()->assertJsonPath('is_executive', true);
        $this->assertNull($election->fresh()->approved_at);
        $this->assertSame('pending_approval', $election->fresh()->status);
        $this->assertSame(1, ApprovalRequest::where('entity_id', $election->id)->where('status', 'pending')->count());
        $this->assertSame([1, 2], ElectionPosition::where('title', 'Secretary')->firstOrFail()->eligible_year_levels);

        $again = $this->approvedFilingElection();
        $row = $again->positions()->first();
        $this->putJson("/api/elections/{$again->id}/positions/{$row->id}", ['max_winners' => 1, 'title' => 'President'])->assertOk();
        $this->assertNotNull($again->fresh()->approved_at);
        $this->putJson("/api/elections/{$again->id}/positions/{$row->id}", ['is_active' => false])->assertOk();
        $this->assertNull($again->fresh()->approved_at);

        $third = $this->approvedFilingElection();
        $this->deleteJson("/api/elections/{$third->id}/positions/{$third->positions()->first()->id}")->assertOk();
        $this->assertNull($third->fresh()->approved_at);
        $this->assertNotNull($position);
    }

    public function test_a_position_change_on_a_legacy_election_does_not_reopen_approval(): void
    {
        Sanctum::actingAs($this->admin);
        $election = $this->legacyElection();

        $this->postJson("/api/elections/{$election->id}/positions", ['title' => 'Secretary', 'max_winners' => 1])->assertCreated();
        $position = $election->positions()->first();
        $this->putJson("/api/elections/{$election->id}/positions/{$position->id}", ['max_winners' => 2])->assertOk();

        $this->assertNotNull($election->fresh()->approved_at);
        $this->assertSame('upcoming', $election->fresh()->status);
        $this->assertSame(0, $this->approvalCount($election));
    }

    public function test_position_vote_limit_cannot_exceed_the_seats(): void
    {
        Sanctum::actingAs($this->admin);
        $election = $this->legacyElection(['status' => 'pending_approval', 'approved_at' => null]);
        $position = ElectionPosition::create(['election_id' => $election->id, 'title' => 'Representative', 'max_winners' => 2]);

        $this->postJson("/api/elections/{$election->id}/positions", ['title' => 'Auditor', 'max_winners' => 1, 'vote_limit' => 2])
            ->assertUnprocessable()->assertJsonValidationErrors('vote_limit');
        $this->putJson("/api/elections/{$election->id}/positions/{$position->id}", ['vote_limit' => 3])
            ->assertUnprocessable()->assertJsonValidationErrors('vote_limit');
        $this->putJson("/api/elections/{$election->id}/positions/{$position->id}", ['vote_limit' => 2])->assertOk();
    }

    public function test_direct_candidates_are_refused_for_a_filing_election_and_still_work_for_a_legacy_one(): void
    {
        Sanctum::actingAs($this->admin);
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        AccountProfile::where('user_school_id', $student->school_id)->where('organization_id', $this->organization->id)->exists()
            || AccountProfile::create(['user_school_id' => $student->school_id, 'organization_id' => $this->organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        $filing = $this->approvedFilingElection();
        $position = $filing->positions()->first();
        $this->postJson("/api/elections/{$filing->id}/candidates", ['user_id' => $student->school_id, 'position_id' => $position->id])
            ->assertStatus(409)->assertJsonPath('message', 'Candidates of this election come from approved applications.');
        $existing = Candidate::create(['election_id' => $filing->id, 'position_id' => $position->id, 'user_id' => $student->school_id]);
        $this->putJson("/api/elections/{$filing->id}/candidates/{$existing->id}", ['platform' => 'x'])->assertStatus(409);
        $this->deleteJson("/api/elections/{$filing->id}/candidates/{$existing->id}")->assertStatus(409);

        $legacy = $this->legacyElection();
        $legacyPosition = ElectionPosition::create(['election_id' => $legacy->id, 'title' => 'President', 'max_winners' => 1]);
        $this->postJson("/api/elections/{$legacy->id}/candidates", ['user_id' => $student->school_id, 'position_id' => $legacyPosition->id])->assertCreated();
    }

    public function test_finalizing_works_without_a_party_list_and_is_automatic_for_a_filing_election(): void
    {
        Sanctum::actingAs($this->admin);
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);

        $legacy = $this->legacyElection();
        $position = ElectionPosition::create(['election_id' => $legacy->id, 'title' => 'President', 'max_winners' => 1]);
        Candidate::create(['election_id' => $legacy->id, 'position_id' => $position->id, 'user_id' => $student->school_id]);
        $this->patchJson("/api/elections/{$legacy->id}/finalize")->assertOk();
        $this->assertNotNull($legacy->fresh()->finalized_at);

        $filing = $this->approvedFilingElection();
        $this->patchJson("/api/elections/{$filing->id}/finalize")
            ->assertStatus(409)->assertJsonPath('message', 'The ballot locks by itself when voting opens.');
        $this->assertNull($filing->fresh()->finalized_at);
    }

    public function test_a_member_sees_an_approved_filing_election_in_the_scheduled_phase(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $election = $this->approvedFilingElection();

        Sanctum::actingAs($student);
        $this->getJson('/api/elections')->assertOk()->assertJsonCount(1)
            ->assertJsonPath('0.id', $election->id)
            ->assertJsonPath('0.phase', 'scheduled')
            ->assertJsonPath('0.has_voted', false)
            ->assertJsonPath('0.my_ballot', null)
            ->assertJsonPath('0.open_round', null);
        $this->getJson('/api/elections/'.$election->id)->assertOk()
            ->assertJsonPath('phase', 'scheduled')
            ->assertJsonPath('has_voted', false)
            ->assertJsonPath('my_ballot', null)
            ->assertJsonMissingPath('application_counts');
    }

    public function test_members_do_not_see_drafts_unapproved_unphased_or_cancelled_filing_elections(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        // An approved election with no phase is not left that way: the request-time sync sets it to scheduled (ElectionPhaseService).
        $this->approvedFilingElection(['cancelled_at' => now(), 'status' => 'closed', 'title' => 'Cancelled']);
        $this->approvedFilingElection(['approved_at' => null, 'status' => 'pending_approval', 'title' => 'Waiting']);
        $draft = Election::factory()->create(['organization_id' => $this->organization->id, 'status' => 'pending_approval', 'phase' => 'scheduled', 'approved_at' => now(), 'title' => 'Draft']);

        Sanctum::actingAs($student);
        $this->getJson('/api/elections')->assertOk()->assertExactJson([]);
        $this->getJson('/api/elections/'.$draft->id)->assertForbidden();
    }

    public function test_the_dean_sees_submitted_elections_but_not_a_draft(): void
    {
        $submitted = $this->legacyElection(['status' => 'pending_approval', 'approved_at' => null, 'submitted_at' => now(), 'title' => 'Submitted']);
        ApprovalRequest::create(['organization_id' => $this->organization->id, 'entity_type' => 'election', 'entity_id' => $submitted->id, 'requested_by' => $this->admin->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending']);
        $this->legacyElection(['status' => 'pending_approval', 'approved_at' => null, 'submitted_at' => null, 'title' => 'Never submitted']);

        Sanctum::actingAs($this->head);
        $this->getJson('/api/elections')->assertOk()->assertJsonCount(1)->assertJsonPath('0.title', 'Submitted');
    }

    public function test_a_voter_reads_the_ballot_receipt_and_the_round_in_every_payload(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $election = $this->approvedFilingElection(['status' => 'active', 'phase' => 'voting', 'finalized_at' => now()->subHour(), 'start_time' => now()->subHour(), 'end_time' => now()->addHour()]);
        ElectionBallot::create(['election_id' => $election->id, 'round' => 1, 'voter_id' => $student->school_id, 'receipt_ref' => 'RC1234', 'submitted_at' => '2026-11-14 07:30:00']);
        ElectionBallot::create(['election_id' => $election->id, 'round' => 1, 'voter_id' => User::factory()->student()->create()->school_id, 'receipt_ref' => 'RC9999', 'submitted_at' => '2026-11-14 07:31:00']);

        Sanctum::actingAs($student);
        $this->getJson('/api/elections/'.$election->id)->assertOk()
            ->assertJsonPath('open_round', 1)
            ->assertJsonPath('has_voted', true)
            ->assertJsonPath('my_ballot.receipt_ref', 'RC1234')
            ->assertJsonPath('my_ballot.round', 1)
            ->assertJsonPath('voters_count', 2);
        $this->getJson('/api/elections')->assertOk()
            ->assertJsonPath('0.has_voted', true)
            ->assertJsonPath('0.my_ballot.receipt_ref', 'RC1234')
            ->assertJsonPath('0.voters_count', 2);
    }

    public function test_in_a_runoff_the_payload_reads_the_second_round_ballot(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $election = $this->approvedFilingElection(['status' => 'closed', 'phase' => 'runoff', 'finalized_at' => now()->subDay(), 'runoff_starts_at' => now()->subHour(), 'runoff_ends_at' => now()->addHour()]);
        ElectionBallot::create(['election_id' => $election->id, 'round' => 1, 'voter_id' => $student->school_id, 'receipt_ref' => 'RC0001', 'submitted_at' => '2026-11-13 09:00:00']);

        Sanctum::actingAs($student);
        $this->getJson('/api/elections/'.$election->id)->assertOk()
            ->assertJsonPath('open_round', 2)
            ->assertJsonPath('has_voted', false)
            ->assertJsonPath('my_ballot', null);
        ElectionBallot::create(['election_id' => $election->id, 'round' => 2, 'voter_id' => $student->school_id, 'receipt_ref' => 'RC0002', 'submitted_at' => now()]);
        $this->getJson('/api/elections/'.$election->id)->assertOk()
            ->assertJsonPath('has_voted', true)
            ->assertJsonPath('my_ballot.round', 2)
            ->assertJsonPath('my_ballot.receipt_ref', 'RC0002');
    }

    public function test_the_admin_and_officers_read_application_counts(): void
    {
        $election = $this->approvedFilingElection();
        $position = $election->positions()->first();
        foreach (['pending_review', 'pending_review', 'for_revision', 'approved', 'withdrawn'] as $status) {
            ElectionApplication::factory()->create(['election_id' => $election->id, 'position_id' => $position->id, 'status' => $status]);
        }

        foreach ([$this->admin, User::factory()->officer()->create(['organization_id' => $this->organization->id])] as $viewer) {
            Sanctum::actingAs($viewer);
            $expected = ['pending_review' => 2, 'for_revision' => 1, 'approved' => 1, 'rejected' => 0, 'withdrawn' => 1];
            $this->getJson('/api/elections/'.$election->id)->assertOk()->assertJsonPath('application_counts', $expected);
            $this->getJson('/api/elections')->assertOk()->assertJsonPath('0.application_counts', $expected);
        }
    }

    public function test_the_audit_values_carry_the_new_fields_and_never_a_ballot(): void
    {
        Sanctum::actingAs($this->admin);
        $id = $this->postElection($this->filingPayload())->assertCreated()->json('id');

        $log = AuditLog::where('action', 'created')->where('record_id', $id)->firstOrFail();
        $this->assertSame('The Department Head picks by lottery.', $log->new_values['tie_break_rule']);
        $this->assertSame(12, $log->new_values['min_units']);
        $this->assertArrayHasKey('filing_starts_at', $log->new_values);
        $this->assertArrayHasKey('rules_version', $log->new_values);

        $this->postJson("/api/elections/{$id}/positions", ['title' => 'Secretary', 'max_winners' => 1, 'is_executive' => true])->assertCreated();
        $added = AuditLog::where('action', 'position_added')->firstOrFail();
        $this->assertTrue($added->new_values['is_executive']);
        $this->assertArrayHasKey('vote_limit', $added->new_values);
    }
}
