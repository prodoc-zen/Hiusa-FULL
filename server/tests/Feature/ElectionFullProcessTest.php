<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AccountProfile;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionBallot;
use App\Models\Notification;
use App\Models\OfficerAppointment;
use App\Models\OfficerHandover;
use App\Models\Organization;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * The whole process in one walk: create, approve, file, screen, vote with an abstention, tie, the one runoff, still
 * tied, the dean's decision, Upcoming appointments, access on the start date and the outgoing officers stepping down to
 * plain students at the end of the school year. Time moves with Carbon::setTestNow and the sync the scheduler runs.
 */
class ElectionFullProcessTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $dean;

    private User $outgoingSecretary;

    private AcademicSemester $semester;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);
        Storage::fake('local');
        Storage::fake('public');
        Carbon::setTestNow('2026-11-14 08:00:00');

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $this->semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-11', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);

        $college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->dean = $this->makeCollegeHead($college);
        $this->admin = $this->member('ADMIN', 'President');
        $this->outgoingSecretary = $this->member('SBO_OFFICER', 'Secretary');

        ComplianceRequirementType::create([
            'category' => 'renewal', 'academic_year' => '2026-2027', 'name' => 'Annual renewal',
            'deadline_at' => '2027-01-20 23:59:59', 'is_active' => true, 'created_by' => $this->admin->school_id,
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function member(string $role = 'STUDENT', ?string $title = null): User
    {
        $user = User::factory()->create(['organization_id' => $this->organization->id, 'role' => $role, 'position_title' => $title, 'year_level' => '2nd Year']);
        AccountProfile::updateOrCreate(
            ['user_school_id' => $user->school_id, 'organization_id' => $this->organization->id],
            ['role' => $role, 'account_status' => 'active', 'position_title' => $title],
        );

        return $user;
    }

    private function profile(User $user): AccountProfile
    {
        return AccountProfile::where('user_school_id', $user->school_id)->where('organization_id', $this->organization->id)->firstOrFail();
    }

    /** What the every-minute scheduler does. */
    private function at(string $when): void
    {
        Carbon::setTestNow($when);
        Election::synchronizeScheduledStatuses();
    }

    private function audit(string $action, ?int $electionId = null): int
    {
        return AuditLog::where('action', $action)->when($electionId, fn ($query) => $query->where('record_id', $electionId))->count();
    }

    private function noticesTo(User $user, string $title): int
    {
        return Notification::where('user_id', $user->school_id)->where('title', $title)->count();
    }

    private function file(Election $election, User $student, string $title, string $platform): ElectionApplication
    {
        Sanctum::actingAs($student);
        $position = $election->positions()->where('title', $title)->firstOrFail();

        $this->post("/api/elections/{$election->id}/applications", [
            'position_id' => $position->id,
            'platform' => $platform,
            'rules_accepted' => true,
            'submit' => true,
            'photo' => UploadedFile::fake()->image('photo.jpg'),
            'coc' => UploadedFile::fake()->create('coc.pdf', 50, 'application/pdf'),
            'credentials' => UploadedFile::fake()->create('credentials.pdf', 50, 'application/pdf'),
        ], ['Accept' => 'application/json'])->assertCreated()->assertJsonPath('status', 'pending_review');

        return ElectionApplication::where('election_id', $election->id)->where('user_school_id', $student->school_id)->firstOrFail();
    }

    private function review(Election $election, ElectionApplication $application, string $decision, ?string $notes = null): void
    {
        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/elections/{$election->id}/applications/{$application->id}/review", array_filter(['decision' => $decision, 'notes' => $notes]))->assertOk();
    }

    /** @param  array<int, array<int, Candidate>>  $choices  position title => candidates picked (empty = skip) */
    private function cast(Election $election, User $voter, array $choices): void
    {
        Sanctum::actingAs($voter);
        $selections = [];
        foreach ($choices as $title => $candidates) {
            $selections[] = [
                'position_id' => $election->positions()->where('title', $title)->value('id'),
                'candidate_ids' => array_map(fn (Candidate $candidate) => $candidate->id, $candidates),
            ];
        }

        $this->postJson("/api/elections/{$election->id}/vote", ['selections' => $selections])->assertOk()->assertJsonPath('success', true);
    }

    public function test_the_whole_election_from_filing_to_the_officers_stepping_down(): void
    {
        // 1. The Admin creates a filing election and sends it to the Department Head.
        Sanctum::actingAs($this->admin);
        $created = $this->post('/api/elections', [
            'title' => 'General election',
            'description' => 'Choose the new officers.',
            'filing_starts_at' => '2026-11-16T00:00:00Z',
            'filing_ends_at' => '2026-11-18T00:00:00Z',
            'screening_starts_at' => '2026-11-19T00:00:00Z',
            'screening_ends_at' => '2026-11-20T00:00:00Z',
            'campaign_starts_at' => '2026-11-21T00:00:00Z',
            'campaign_ends_at' => '2026-11-22T00:00:00Z',
            'start_time' => '2026-11-23T00:30:00Z',
            'end_time' => '2026-11-24T09:00:00Z',
            'results_publish_at' => '2026-11-25T00:00:00Z',
            'rules' => 'Candidates must be enrolled members in good standing.',
            'tie_break_rule' => 'The Department Head picks the candidate with the longer membership.',
            'min_units' => 12,
            'positions' => [
                ['title' => 'President', 'max_winners' => 1, 'is_executive' => true, 'eligible_year_levels' => [1, 2, 3]],
                ['title' => 'Secretary', 'max_winners' => 1],
            ],
            'informative_letter' => UploadedFile::fake()->create('letter.pdf', 20, 'application/pdf'),
        ], ['Accept' => 'application/json'])->assertCreated();
        $election = Election::findOrFail($created->json('id'));
        $this->assertTrue($election->usesFiling());
        $this->assertSame(1, $this->audit('created', $election->id));

        // 2. The Department Head approves; the rules are versioned.
        $approval = ApprovalRequest::where('entity_type', 'election')->where('entity_id', $election->id)->firstOrFail();
        Sanctum::actingAs($this->dean);
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])->assertOk();
        $election->refresh();
        $this->assertNotNull($election->approved_at);
        $this->assertSame(1, $election->ruleVersions()->count());

        $president = [$this->member(), $this->member()];
        $secretary = [$this->member(), $this->member()];
        $voters = collect(range(1, 6))->map(fn () => $this->member())->all();

        // 3. Filing opens by itself and every voting member is told.
        $this->at('2026-11-16 09:00:00');
        $election->refresh();
        $this->assertSame('filing', $election->phase);
        $this->assertSame(1, $this->noticesTo($voters[0], 'Candidacy filing is open'));

        $applications = [
            $this->file($election, $president[0], 'President', 'Open books.'),
            $this->file($election, $president[1], 'President', 'More events.'),
            $this->file($election, $secretary[0], 'Secretary', 'Clear minutes.'),
            $this->file($election, $secretary[1], 'Secretary', 'Fast minutes.'),
        ];
        $this->assertSame(4, $this->audit('application_submitted', $election->id));

        // 4. Screening: the Admin approves one at a time; each approved application becomes a candidate.
        $this->at('2026-11-19 09:00:00');
        $this->assertSame('screening', $election->fresh()->phase);
        foreach ($applications as $application) {
            $this->review($election, $application, 'approve');
        }
        $this->assertSame(4, Candidate::where('election_id', $election->id)->count());
        $this->assertSame(4, $this->audit('application_reviewed', $election->id));

        // 5. Campaign.
        $this->at('2026-11-21 09:00:00');
        $this->assertSame('campaign', $election->fresh()->phase);

        // 6. Voting opens at the start time: the ballot locks and the roll freezes.
        $this->at('2026-11-23 08:30:00');
        $election->refresh();
        $this->assertSame('voting', $election->phase);
        $this->assertSame('active', $election->status);
        $this->assertNotNull($election->finalized_at);
        $this->assertSame(1, $this->audit('ballot_locked', $election->id));
        $this->assertSame(1, $this->noticesTo($voters[0], 'Voting is open'));

        $candidate = fn (User $user) => Candidate::where('election_id', $election->id)->where('user_id', $user->school_id)->firstOrFail();
        [$a, $b] = [$candidate($president[0]), $candidate($president[1])];
        [$c, $d] = [$candidate($secretary[0]), $candidate($secretary[1])];
        $this->cast($election, $voters[0], ['President' => [$a], 'Secretary' => [$c]]);
        $this->cast($election, $voters[1], ['President' => [$a], 'Secretary' => [$c]]);
        $this->cast($election, $voters[2], ['President' => [$a], 'Secretary' => [$d]]);
        $this->cast($election, $voters[3], ['President' => [$b], 'Secretary' => [$d]]);
        $this->cast($election, $voters[4], ['President' => [$b]]);
        $this->cast($election, $voters[5], []);
        $this->assertSame(6, ElectionBallot::where('election_id', $election->id)->where('round', 1)->count());
        $this->assertSame(0, Vote::whereNotNull('voter_id')->count());
        $this->assertSame(9, Vote::where('election_id', $election->id)->count());

        // 7. Voting ends, then the results publish at the scheduled time: the President is decided, the Secretary is tied.
        $this->at('2026-11-24 17:30:00');
        $this->assertSame('closed', $election->fresh()->status);
        $this->assertSame('canvassing', $election->fresh()->phase);
        $this->assertSame(0, OfficerAppointment::count());

        $this->at('2026-11-25 08:30:00');
        $election->refresh();
        $this->assertTrue((bool) $election->results_visible);
        $this->assertSame(1, $this->audit('results_published', $election->id));
        $this->assertSame(1, $this->noticesTo($this->admin, 'Runoff needed'));
        $this->assertSame('STUDENT', $this->profile($president[0])->role);

        $appointment = OfficerAppointment::where('user_school_id', $president[0]->school_id)->firstOrFail();
        $this->assertSame('upcoming', $appointment->status);
        $this->assertSame('ADMIN', $appointment->role);
        $this->assertSame('2026-12-20', $appointment->term_starts_on->format('Y-m-d'));
        $this->assertSame(1, $this->noticesTo($president[0], 'You won President'));
        $this->assertNull(OfficerAppointment::where('user_school_id', $secretary[0]->school_id)->first());
        $this->assertNull(OfficerAppointment::where('user_school_id', $secretary[1]->school_id)->first());
        $this->assertSame('outgoing', OfficerAppointment::where('user_school_id', $this->admin->school_id)->value('kind'));
        $this->assertNull(OfficerAppointment::where('user_school_id', $this->outgoingSecretary->school_id)->first());

        Sanctum::actingAs($this->admin);
        $rows = collect($this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json())->keyBy('position.title');
        $this->assertSame('decided', $rows['President']['status']);
        $this->assertSame('upcoming', $rows['President']['officer_access']);
        $this->assertSame('runoff_required', $rows['Secretary']['status']);

        // 8. The Admin schedules the one runoff.
        $this->postJson('/api/elections/'.$election->id.'/runoff', [
            'runoff_starts_at' => '2026-11-26T00:00:00Z',
            'runoff_ends_at' => '2026-11-26T09:00:00Z',
            'runoff_publish_at' => '2026-11-27T00:00:00Z',
        ])->assertOk();
        $this->assertSame(1, $this->audit('runoff_scheduled', $election->id));
        $this->assertSame(1, $this->noticesTo($voters[0], 'Runoff scheduled'));

        // 9. The runoff opens: only the tied candidates are on it, and every voter may vote once more. It is tied again.
        $this->at('2026-11-26 08:30:00');
        $this->assertSame('runoff', $election->fresh()->phase);
        $this->cast($election, $voters[0], ['Secretary' => [$c]]);
        $this->cast($election, $voters[1], ['Secretary' => [$d]]);
        $this->cast($election, $voters[2], ['Secretary' => [$c]]);
        $this->cast($election, $voters[3], ['Secretary' => [$d]]);
        $this->cast($election, $voters[4], []);
        $this->assertSame(5, ElectionBallot::where('election_id', $election->id)->where('round', 2)->count());
        $this->assertSame(0, Vote::whereNotNull('voter_id')->count());

        $this->at('2026-11-26 17:30:00');
        $this->assertSame('tie_resolution', $election->fresh()->phase);
        $this->assertSame(1, $this->noticesTo($this->dean, 'Tie needs a decision'));

        // 10. The Department Head decides under the approved rule and writes an explanation.
        $secretaryPosition = $election->positions()->where('title', 'Secretary')->firstOrFail();
        Sanctum::actingAs($this->dean);
        $this->postJson('/api/elections/'.$election->id.'/positions/'.$secretaryPosition->id.'/tie-resolution', [
            'winner_candidate_ids' => [$c->id],
            'explanation' => 'Both candidates tied twice; the first has been a member for longer.',
        ])->assertOk();
        $this->assertSame(1, $this->audit('tie_resolved', $election->id));
        $this->assertSame(1, $this->noticesTo($this->admin, 'Tie resolved'));
        $this->assertNull(OfficerAppointment::where('user_school_id', $secretary[0]->school_id)->first(), 'the runoff outcome is not public yet');

        // 11. The runoff outcome publishes, the election completes and the Secretary becomes an Upcoming officer.
        $this->at('2026-11-27 08:30:00');
        $election->refresh();
        $this->assertSame('completed', $election->phase);
        $this->assertNotNull($election->completed_at);
        $this->assertNotNull($election->access_handed_over_at);
        $this->assertSame(1, $this->audit('election_completed', $election->id));
        $this->assertSame('upcoming', OfficerAppointment::where('user_school_id', $secretary[0]->school_id)->value('status'));
        $this->assertSame('SBO_OFFICER', OfficerAppointment::where('user_school_id', $secretary[0]->school_id)->value('role'));
        $this->assertNull(OfficerAppointment::where('user_school_id', $secretary[1]->school_id)->first());
        $this->assertSame('outgoing', OfficerAppointment::where('user_school_id', $this->outgoingSecretary->school_id)->value('kind'));
        $this->assertSame(6, OfficerHandover::where('election_id', $election->id)->count());
        $this->assertSame(2, OfficerAppointment::where('kind', 'incoming')->count());
        $this->assertSame(2, OfficerAppointment::where('kind', 'outgoing')->count());
        $this->assertSame(4, $this->audit('appointment_created', $election->id));

        // 12. Nobody has the new access before the start date.
        $this->at('2026-12-19 23:00:00');
        $this->assertSame('STUDENT', $this->profile($president[0])->role);
        $this->assertSame('STUDENT', $this->profile($secretary[0])->role);

        // 13. On the start date (deadline 20 January minus one month) the winners are activated; the old officers keep access.
        $this->at('2026-12-20 00:30:00');
        $this->assertSame(['ADMIN', 'President'], [$this->profile($president[0])->role, $this->profile($president[0])->position_title]);
        $this->assertSame(['SBO_OFFICER', 'Secretary'], [$this->profile($secretary[0])->role, $this->profile($secretary[0])->position_title]);
        $this->assertSame('ADMIN', $this->profile($this->admin)->role);
        $this->assertSame('SBO_OFFICER', $this->profile($this->outgoingSecretary)->role);
        $this->assertSame(1, $this->noticesTo($president[0], 'You now have access to '.$this->organization->name));
        $this->assertSame(2, $this->audit('appointment_activated', $election->id));

        // 14. At the end of the school year the outgoing officers become plain students of the organization.
        $this->at('2027-05-31 20:00:00');
        $this->assertSame('ADMIN', $this->profile($this->admin)->role);

        $this->at('2027-06-01 09:00:00');
        foreach ([$this->admin, $this->outgoingSecretary] as $former) {
            $profile = $this->profile($former);
            $this->assertSame('STUDENT', $profile->role);
            $this->assertNull($profile->position_title);
            $this->assertSame('active', $profile->account_status);
            $this->assertTrue(AccountProfile::votingMembers()->where('organization_id', $this->organization->id)->where('user_school_id', $former->school_id)->exists());
        }
        $this->assertSame(2, OfficerAppointment::where('status', 'ended')->count());
        $this->assertSame(2, $this->audit('appointment_expired', $election->id));
        $this->assertSame('ADMIN', $this->profile($president[0])->role);
        $this->assertSame('SBO_OFFICER', $this->profile($secretary[0])->role);
        $this->assertSame(0, Vote::whereNotNull('voter_id')->count());
    }
}
