<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionPosition;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\Partylist;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * Screening: the Admin reads the applications and decides one at a time. An approval makes the official candidate row,
 * a correction lets the candidate replace documents only, a rejection ends the application.
 */
class ElectionScreeningTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $officer;

    private User $student;

    private Election $election;

    private ElectionPosition $position;

    private ElectionApplication $application;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);
        Storage::fake('public');
        Storage::fake('local');

        $college = $this->makeCollege('CBE');
        $this->makeCollegeHome($college);
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->officer = User::factory()->officer()->create(['organization_id' => $this->organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $this->organization->id, 'first_name' => 'Ana', 'last_name' => 'Cruz', 'year_level' => '2nd Year']);
        $this->election = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'title' => 'Student council election',
            'status' => 'upcoming',
            'phase' => 'screening',
            'approved_at' => now()->subDay(),
            'filing_starts_at' => now()->subDays(3),
            'filing_ends_at' => now()->subDay(),
            'screening_starts_at' => now()->subDay(),
            'screening_ends_at' => now()->addDay(),
            'campaign_starts_at' => now()->addDay(),
            'campaign_ends_at' => now()->addDays(2),
            'start_time' => now()->addDays(2),
            'end_time' => now()->addDays(3),
            'results_publish_at' => now()->addDays(4),
            'rules_version' => 1,
        ]);
        $this->position = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'Senator', 'max_winners' => 2]);
        $this->application = $this->pending($this->student);
    }

    private function pending(User $student, array $attributes = []): ElectionApplication
    {
        Storage::disk('local')->put("election-applications/{$this->organization->id}/{$this->election->id}/{$student->school_id}-coc.pdf", 'coc');
        Storage::disk('local')->put("election-applications/{$this->organization->id}/{$this->election->id}/{$student->school_id}-cred.pdf", 'cred');

        return ElectionApplication::create([
            'election_id' => $this->election->id,
            'position_id' => $this->position->id,
            'user_school_id' => $student->school_id,
            'submitted_by' => $student->school_id,
            'status' => 'pending_review',
            'platform' => 'Open budgets.',
            'photo_url' => '/storage/candidates/'.$student->school_id.'.jpg',
            'coc_path' => "election-applications/{$this->organization->id}/{$this->election->id}/{$student->school_id}-coc.pdf",
            'credentials_path' => "election-applications/{$this->organization->id}/{$this->election->id}/{$student->school_id}-cred.pdf",
            'rules_version' => 1,
            'rules_accepted_at' => now()->subDays(2),
            'submitted_at' => now()->subDay(),
            ...$attributes,
        ]);
    }

    private function review(ElectionApplication $application, array $payload, ?User $as = null)
    {
        Sanctum::actingAs($as ?? $this->admin);

        return $this->patchJson("/api/elections/{$this->election->id}/applications/{$application->id}/review", $payload);
    }

    public function test_the_admin_reads_every_application_with_counts_and_open_urls(): void
    {
        $withdrawn = $this->pending(User::factory()->student()->create(['organization_id' => $this->organization->id]), ['status' => 'withdrawn']);
        Sanctum::actingAs($this->admin);

        $response = $this->getJson("/api/elections/{$this->election->id}/applications")->assertOk();

        $this->assertCount(2, $response->json('applications'));
        $this->assertSame(1, $response->json('counts.pending_review'));
        $this->assertSame(1, $response->json('counts.withdrawn'));
        $this->assertSame(0, $response->json('counts.approved'));
        $row = collect($response->json('applications'))->firstWhere('id', $this->application->id);
        $this->assertSame('Ana Cruz', $row['user_name']);
        $this->assertSame($this->student->school_id, $row['school_id']);
        $this->assertSame('Senator', $row['position_title']);
        $this->assertSame("/elections/{$this->election->id}/applications/{$this->application->id}/files/coc", $row['open_urls']['coc']);
        $this->assertSame("/elections/{$this->election->id}/applications/{$this->application->id}/files/credentials", $row['open_urls']['credentials']);
        $this->assertArrayNotHasKey('coc_path', $row);
        $this->assertNotNull($withdrawn->id);
    }

    public function test_an_officer_reads_the_list_without_open_urls_and_cannot_review(): void
    {
        Sanctum::actingAs($this->officer);

        $response = $this->getJson("/api/elections/{$this->election->id}/applications")->assertOk();
        $this->assertNull($response->json('applications.0.open_urls'));

        $this->review($this->application, ['decision' => 'approve'], $this->officer)->assertForbidden();
        $this->assertSame('pending_review', $this->application->fresh()->status);
    }

    public function test_the_list_belongs_to_the_organization(): void
    {
        $other = User::factory()->admin()->create(['organization_id' => $this->makeCollegeStudentOrganization($this->makeCollege('CAS'))->id]);

        Sanctum::actingAs($other);
        $this->getJson("/api/elections/{$this->election->id}/applications")->assertNotFound();
        $this->review($this->application, ['decision' => 'approve'], $other)->assertNotFound();
    }

    public function test_approval_creates_exactly_one_candidate_row_and_is_idempotent(): void
    {
        $slate = Partylist::create(['name' => 'Tuloy', 'organization_id' => $this->organization->id, 'election_id' => $this->election->id, 'motto' => 'Forward', 'color' => '#1D4ED8']);
        $this->application->update(['partylist_id' => $slate->id]);

        $this->review($this->application, ['decision' => 'approve', 'notes' => 'All documents in order.'])
            ->assertOk()->assertJsonPath('status', 'approved');
        $this->review($this->application, ['decision' => 'approve'])->assertOk()->assertJsonPath('status', 'approved');

        $this->assertSame(1, Candidate::where('election_id', $this->election->id)->count());
        $candidate = Candidate::first();
        $this->assertSame($this->student->school_id, $candidate->user_id);
        $this->assertSame($this->position->id, $candidate->position_id);
        $this->assertSame($slate->id, $candidate->partylist_id);
        $this->assertSame('Open budgets.', $candidate->platform);
        $this->assertSame($this->application->photo_url, $candidate->image_url);

        $fresh = $this->application->fresh();
        $this->assertSame($candidate->id, $fresh->candidate_id);
        $this->assertSame($this->admin->school_id, $fresh->reviewed_by);
        $this->assertNotNull($fresh->reviewed_at);
        $this->assertSame('All documents in order.', $fresh->review_notes);
        // The second approval changed nothing, so it told nobody and wrote nothing.
        $this->assertSame(1, Notification::where('user_id', $this->student->school_id)->count());
        $this->assertSame(1, AuditLog::where('action', 'application_reviewed')->count());
    }

    public function test_a_correction_needs_notes_and_returns_the_application_to_the_candidate(): void
    {
        $this->review($this->application, ['decision' => 'correction'])->assertUnprocessable();
        $this->review($this->application, ['decision' => 'correction', 'notes' => '   '])->assertUnprocessable();
        $this->assertSame('pending_review', $this->application->fresh()->status);

        $this->review($this->application, ['decision' => 'correction', 'notes' => 'The scan is blurry.'])
            ->assertOk()->assertJsonPath('status', 'for_revision')->assertJsonPath('review_notes', 'The scan is blurry.');

        $this->assertSame(0, Candidate::count());
    }

    public function test_a_correction_lets_the_candidate_replace_documents_only_and_returns_to_review(): void
    {
        $this->review($this->application, ['decision' => 'correction', 'notes' => 'The scan is blurry.'])->assertOk();
        $oldCoc = $this->application->coc_path;
        $url = "/api/elections/{$this->election->id}/applications/{$this->application->id}";
        Sanctum::actingAs($this->student);

        $this->postJson($url, ['coc' => UploadedFile::fake()->create('new.pdf', 60, 'application/pdf'), 'platform' => 'Sneaky change.'])->assertUnprocessable();
        $this->postJson($url, ['position_id' => ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'Mayor', 'max_winners' => 1])->id])->assertUnprocessable();
        $this->postJson($url, [])->assertUnprocessable();
        $this->assertSame('for_revision', $this->application->fresh()->status);

        $this->postJson($url, ['coc' => UploadedFile::fake()->create('new.pdf', 60, 'application/pdf')])
            ->assertOk()->assertJsonPath('status', 'pending_review');

        $fresh = $this->application->fresh();
        $this->assertNotSame($oldCoc, $fresh->coc_path);
        Storage::disk('local')->assertExists($fresh->coc_path);
        Storage::disk('local')->assertMissing($oldCoc);
        $this->assertSame('Open budgets.', $fresh->platform);
        $this->assertSame($this->position->id, $fresh->position_id);
        $this->assertSame(1, Notification::where('user_id', $this->admin->school_id)->where('title', 'Candidacy application received')->count());
    }

    public function test_a_correction_cannot_be_answered_once_screening_is_over(): void
    {
        $this->review($this->application, ['decision' => 'correction', 'notes' => 'Blurry.'])->assertOk();
        $this->election->update(['phase' => 'campaign']);
        Sanctum::actingAs($this->student);

        $this->postJson("/api/elections/{$this->election->id}/applications/{$this->application->id}", ['coc' => UploadedFile::fake()->create('new.pdf', 60, 'application/pdf')])
            ->assertStatus(409);
    }

    public function test_a_rejection_needs_a_reason_and_removes_nothing(): void
    {
        $this->review($this->application, ['decision' => 'reject'])->assertUnprocessable();

        $this->review($this->application, ['decision' => 'reject', 'notes' => 'Does not meet the unit requirement.'])
            ->assertOk()->assertJsonPath('status', 'rejected');

        $fresh = $this->application->fresh();
        $this->assertSame('rejected', $fresh->status);
        $this->assertNotNull($fresh->coc_path);
        Storage::disk('local')->assertExists($fresh->coc_path);
        $this->assertSame(0, Candidate::count());
        $this->assertSame(1, ElectionApplication::count());
    }

    public function test_a_decision_is_refused_outside_the_screening_phase(): void
    {
        foreach (['scheduled', 'filing', 'campaign', 'voting'] as $phase) {
            $this->election->update(['phase' => $phase]);

            $this->review($this->application, ['decision' => 'approve'])->assertStatus(409);
        }

        $this->assertSame('pending_review', $this->application->fresh()->status);
        $this->assertSame(0, Candidate::count());
    }

    public function test_only_an_application_waiting_for_a_decision_can_be_decided(): void
    {
        foreach (['draft', 'for_revision', 'rejected', 'withdrawn'] as $status) {
            $this->application->update(['status' => $status]);

            $this->review($this->application, ['decision' => 'approve'])->assertStatus(409);
            $this->review($this->application, ['decision' => 'reject', 'notes' => 'No.'])->assertStatus(409);
        }

        $this->assertSame(0, Candidate::count());
    }

    public function test_a_halted_election_decides_nothing(): void
    {
        $this->election->update(['suspended_at' => now()]);

        $this->review($this->application, ['decision' => 'approve'])->assertStatus(409);
    }

    public function test_the_decision_must_be_one_of_the_three(): void
    {
        $this->review($this->application, ['decision' => 'maybe'])->assertUnprocessable();
        $this->review($this->application, [])->assertUnprocessable();
    }

    public function test_a_decision_goes_to_the_candidate_and_to_the_representative_who_filed_for_them(): void
    {
        $representative = User::factory()->student()->create(['organization_id' => $this->organization->id, 'first_name' => 'Ben', 'last_name' => 'Reyes']);
        $this->application->update(['submitted_by' => $representative->school_id]);

        $this->review($this->application, ['decision' => 'reject', 'notes' => 'Missing certificate.'])->assertOk();

        $own = Notification::where('user_id', $this->student->school_id)->first();
        $this->assertSame('Candidacy rejected', $own->title);
        $this->assertSame('election', $own->notification_type);
        $this->assertSame($this->election->id, (int) $own->reference_id);
        $this->assertStringContainsString('Missing certificate.', $own->message);
        $this->assertStringContainsString('Senator', $own->message);

        $theirs = Notification::where('user_id', $representative->school_id)->first();
        $this->assertStringContainsString('Ana Cruz', $theirs->message);
        $this->assertStringContainsString('Missing certificate.', $theirs->message);
    }

    public function test_an_applicant_who_filed_alone_is_told_once(): void
    {
        $this->review($this->application, ['decision' => 'approve'])->assertOk();

        $this->assertSame(1, Notification::where('user_id', $this->student->school_id)->count());
        $this->assertSame(0, Notification::where('user_id', $this->admin->school_id)->count());
    }

    public function test_a_decision_is_written_to_the_audit_log_with_the_notes_and_the_actor(): void
    {
        $this->review($this->application, ['decision' => 'correction', 'notes' => 'Blurry.'])->assertOk();

        $audit = AuditLog::where('action', 'application_reviewed')->first();
        $this->assertSame('elections', $audit->module);
        $this->assertSame($this->organization->id, $audit->organization_id);
        $this->assertSame($this->election->id, (int) $audit->record_id);
        $this->assertSame($this->admin->school_id, (int) $audit->user_id);
        $this->assertSame('correction', $audit->new_values['decision']);
        $this->assertSame('Blurry.', $audit->new_values['notes']);
        $this->assertSame($this->application->id, $audit->new_values['application_id']);
    }

    public function test_withdrawing_an_approved_candidate_leaves_the_official_list(): void
    {
        $this->review($this->application, ['decision' => 'approve'])->assertOk();
        $this->assertSame(1, Candidate::count());

        Sanctum::actingAs($this->student);
        $this->postJson("/api/elections/{$this->election->id}/applications/{$this->application->id}/withdraw")->assertOk();

        $this->assertSame(0, Candidate::count());
        $this->assertSame('withdrawn', $this->application->fresh()->status);
        $this->assertNull($this->application->fresh()->candidate_id);
    }

    public function test_approving_party_list_members_keeps_the_party_list_on_each_candidate(): void
    {
        $slate = Partylist::create(['name' => 'Tuloy', 'organization_id' => $this->organization->id, 'election_id' => $this->election->id, 'motto' => 'Forward', 'color' => '#1D4ED8', 'representative_school_id' => $this->student->school_id]);
        $member = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $second = $this->pending($member, ['partylist_id' => $slate->id, 'submitted_by' => $this->student->school_id]);

        $this->review($second, ['decision' => 'approve'])->assertOk();

        $this->assertSame($slate->id, Candidate::where('user_id', $member->school_id)->value('partylist_id'));
    }
}
