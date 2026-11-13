<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionBallot;
use App\Models\ElectionPosition;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * The phases of a filing election move by themselves from the schedule, stop and tell the Admins when they cannot start
 * safely, and a legacy election without a filing window opens and closes exactly as it always did.
 */
class ElectionPhaseEngineTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private Election $election;

    private ElectionPosition $position;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow('2026-12-01 09:00:00');

        $college = $this->makeCollege('CBE');
        $this->makeCollegeHome($college);
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->election = $this->filingElection();
        $this->position = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'President', 'max_winners' => 1, 'is_active' => true]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    /** Filing 2 to 4 Dec, screening 5 to 7 Dec, campaign 8 to 9 Dec, voting 10 to 11 Dec, results 12 Dec. */
    private function filingElection(array $overrides = []): Election
    {
        return Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'upcoming',
            'phase' => null,
            'approved_at' => '2026-11-20 09:00:00',
            'filing_starts_at' => '2026-12-02 08:00:00',
            'filing_ends_at' => '2026-12-04 17:00:00',
            'screening_starts_at' => '2026-12-05 08:00:00',
            'screening_ends_at' => '2026-12-07 17:00:00',
            'campaign_starts_at' => '2026-12-08 08:00:00',
            'campaign_ends_at' => '2026-12-09 17:00:00',
            'start_time' => '2026-12-10 08:00:00',
            'end_time' => '2026-12-11 17:00:00',
            'results_publish_at' => '2026-12-12 08:00:00',
            ...$overrides,
        ]);
    }

    private function syncAt(string $when): array
    {
        Carbon::setTestNow($when);

        return Election::synchronizeScheduledStatuses();
    }

    private function phase(?Election $election = null): ?string
    {
        return ($election ?? $this->election)->fresh()->phase;
    }

    private function student(): User
    {
        return User::factory()->student()->create(['organization_id' => $this->organization->id]);
    }

    private function application(string $status, ?User $student = null, array $overrides = []): ElectionApplication
    {
        return ElectionApplication::factory()->create([
            'election_id' => $this->election->id,
            'position_id' => $this->position->id,
            'user_school_id' => ($student ?? $this->student())->school_id,
            'status' => $status,
            ...$overrides,
        ]);
    }

    private function approvedCandidate(): Candidate
    {
        return Candidate::create([
            'election_id' => $this->election->id,
            'position_id' => $this->position->id,
            'user_id' => $this->student()->school_id,
        ]);
    }

    private function noticesFor(User $user, string $title): int
    {
        return Notification::where('user_id', $user->school_id)->where('reference_type', 'election')
            ->where('reference_id', $this->election->id)->where('title', 'like', $title.'%')->count();
    }

    public function test_an_election_moves_through_the_phases_from_the_schedule(): void
    {
        $this->syncAt('2026-12-01 09:00:00');
        $this->assertSame('scheduled', $this->phase());

        $this->syncAt('2026-12-02 08:00:00');
        $this->assertSame('filing', $this->phase());

        $this->syncAt('2026-12-04 17:00:00');
        $this->assertSame('screening', $this->phase());

        $this->syncAt('2026-12-08 08:00:00');
        $this->assertSame('campaign', $this->phase());
        $this->assertNull($this->election->fresh()->finalized_at);

        $this->approvedCandidate();
        $this->syncAt('2026-12-10 08:00:00');

        $election = $this->election->fresh();
        $this->assertSame('voting', $election->phase);
        $this->assertNotNull($election->finalized_at);
        $this->assertSame('active', $election->status);
    }

    public function test_every_phase_change_is_audited_without_an_actor(): void
    {
        $this->syncAt('2026-12-01 09:00:00');
        $this->syncAt('2026-12-02 08:00:00');

        $rows = AuditLog::where('module', 'elections')->where('action', 'phase_changed')->where('record_id', $this->election->id)->orderBy('id')->get();

        $this->assertCount(2, $rows);
        $this->assertSame(['from' => null, 'to' => 'scheduled'], $rows[0]->new_values);
        $this->assertSame(['from' => 'scheduled', 'to' => 'filing'], $rows[1]->new_values);
        $this->assertNull($rows[1]->user_id);
        $this->assertSame($this->organization->id, $rows[1]->organization_id);
    }

    public function test_filing_opening_notifies_every_voting_member_once(): void
    {
        $student = $this->student();
        $this->syncAt('2026-12-01 09:00:00');
        $this->assertSame(0, $this->noticesFor($student, 'Candidacy filing is open'));

        $this->syncAt('2026-12-02 08:00:00');
        $this->syncAt('2026-12-02 08:05:00');
        $this->syncAt('2026-12-02 08:10:00');

        $this->assertSame(1, $this->noticesFor($student, 'Candidacy filing is open'));
        $this->assertSame(1, $this->noticesFor($this->admin, 'Candidacy filing is open'));
        $row = Notification::where('user_id', $student->school_id)->where('title', 'like', 'Candidacy filing is open%')->first();
        $this->assertSame('election', $row->notification_type);
        $this->assertSame($this->organization->id, $row->organization_id);
    }

    public function test_a_suspended_election_does_not_move_and_catches_up_after_resume(): void
    {
        $this->syncAt('2026-12-02 08:00:00');
        $this->election->forceFill(['suspended_at' => '2026-12-03 10:00:00'])->save();

        $this->syncAt('2026-12-05 09:00:00');
        $this->assertSame('filing', $this->phase());

        $this->election->forceFill(['suspended_at' => null])->save();
        $this->syncAt('2026-12-05 09:01:00');
        $this->assertSame('screening', $this->phase());
    }

    public function test_a_cancelled_election_does_not_move(): void
    {
        $this->election->forceFill(['cancelled_at' => '2026-11-25 10:00:00'])->save();

        $this->syncAt('2026-12-03 09:00:00');

        $this->assertNull($this->phase());
    }

    public function test_an_unapproved_election_does_not_move(): void
    {
        $this->election->forceFill(['approved_at' => null])->save();

        $this->syncAt('2026-12-03 09:00:00');

        $this->assertNull($this->phase());
    }

    public function test_drafts_are_withdrawn_when_filing_closes(): void
    {
        $this->syncAt('2026-12-03 09:00:00');
        $draft = $this->application('draft');
        $pending = $this->application('pending_review');

        $this->syncAt('2026-12-04 17:00:00');

        $draft->refresh();
        $this->assertSame('withdrawn', $draft->status);
        $this->assertSame('Not submitted before filing closed', $draft->review_notes);
        $this->assertSame('pending_review', $pending->fresh()->status);
    }

    public function test_corrections_not_answered_are_rejected_when_screening_ends_and_the_people_are_told(): void
    {
        $this->syncAt('2026-12-04 17:00:00');
        $candidate = $this->student();
        $representative = $this->student();
        $own = $this->application('for_revision', $candidate, ['submitted_by' => $candidate->school_id]);
        $member = $this->application('for_revision', null, ['submitted_by' => $representative->school_id]);
        $approved = $this->application('approved');

        $this->syncAt('2026-12-07 16:59:00');
        $this->assertSame('for_revision', $own->fresh()->status);

        $this->syncAt('2026-12-07 17:00:00');
        $this->syncAt('2026-12-07 17:05:00');

        $this->assertSame('rejected', $own->fresh()->status);
        $this->assertSame('Corrections were not completed before screening closed', $own->fresh()->review_notes);
        $this->assertSame('rejected', $member->fresh()->status);
        $this->assertSame('approved', $approved->fresh()->status);
        $this->assertSame(2, AuditLog::where('action', 'application_auto_rejected')->count());
        $this->assertSame(1, $this->noticesFor($candidate, 'Your candidacy was not accepted'));
        $this->assertSame(1, $this->noticesFor($representative, 'Your candidacy was not accepted'));
        $this->assertSame(1, $this->noticesFor(User::where('school_id', $member->user_school_id)->first(), 'Your candidacy was not accepted'));
    }

    public function test_pending_reviews_hold_the_election_in_screening_and_alert_the_admin_once(): void
    {
        $this->syncAt('2026-12-07 10:00:00');
        $this->application('pending_review');
        $this->application('pending_review');

        $this->syncAt('2026-12-08 08:00:00');
        $this->syncAt('2026-12-08 08:01:00');
        $this->syncAt('2026-12-08 08:02:00');

        $election = $this->election->fresh();
        $this->assertSame('screening', $election->phase);
        $this->assertSame('Screening is not finished: 2 applications still need a decision.', $election->phase_alert);
        $this->assertSame(1, $this->noticesFor($this->admin, 'Election needs attention'));
        $this->assertSame(1, AuditLog::where('action', 'phase_alert')->where('record_id', $this->election->id)->count());
    }

    public function test_the_alert_clears_and_the_phase_moves_once_the_cause_is_gone(): void
    {
        $this->syncAt('2026-12-07 10:00:00');
        $application = $this->application('pending_review');
        $this->syncAt('2026-12-08 08:00:00');
        $this->assertSame('screening', $this->phase());

        $application->forceFill(['status' => 'rejected'])->save();
        $this->syncAt('2026-12-08 08:01:00');

        $election = $this->election->fresh();
        $this->assertSame('campaign', $election->phase);
        $this->assertNull($election->phase_alert);
    }

    public function test_voting_does_not_open_without_a_candidate_and_alerts_the_admin_once(): void
    {
        $this->syncAt('2026-12-09 10:00:00');
        $this->assertSame('campaign', $this->phase());

        $this->syncAt('2026-12-10 08:00:00');
        $this->syncAt('2026-12-10 08:01:00');

        $election = $this->election->fresh();
        $this->assertSame('campaign', $election->phase);
        $this->assertNull($election->finalized_at);
        $this->assertSame('upcoming', $election->status);
        $this->assertStringStartsWith('Voting cannot open: ', $election->phase_alert);
        $this->assertSame(1, $this->noticesFor($this->admin, 'Election needs attention'));

        $this->approvedCandidate();
        $this->syncAt('2026-12-10 08:02:00');

        $election->refresh();
        $this->assertSame('voting', $election->phase);
        $this->assertNull($election->phase_alert);
    }

    public function test_a_candidate_on_an_inactive_position_does_not_let_voting_open(): void
    {
        $this->syncAt('2026-12-09 10:00:00');
        $this->position->forceFill(['is_active' => false])->save();
        $this->approvedCandidate();

        $this->syncAt('2026-12-10 08:00:00');

        $this->assertSame('campaign', $this->phase());
        $this->assertNull($this->election->fresh()->finalized_at);
    }

    public function test_voting_does_not_open_while_applications_wait_for_a_decision_and_the_phase_stays(): void
    {
        $this->approvedCandidate();
        $this->syncAt('2026-12-09 10:00:00');
        $this->application('pending_review');

        $this->syncAt('2026-12-10 08:00:00');

        $election = $this->election->fresh();
        $this->assertSame('campaign', $election->phase);
        $this->assertSame('Voting cannot open: 1 application still needs a decision.', $election->phase_alert);
        $this->assertNull($election->finalized_at);
    }

    public function test_the_ballot_is_locked_and_audited_when_voting_opens(): void
    {
        $this->approvedCandidate();
        $this->syncAt('2026-12-10 08:00:00');

        $this->assertNotNull($this->election->fresh()->finalized_at);
        $this->assertSame(1, AuditLog::where('action', 'ballot_locked')->where('record_id', $this->election->id)->count());
        $this->assertSame('voting', $this->phase());
    }

    public function test_voting_opening_notifies_voting_members_once(): void
    {
        $student = $this->student();
        $this->approvedCandidate();

        $this->syncAt('2026-12-10 08:00:00');
        $this->syncAt('2026-12-10 08:01:00');

        $this->assertSame(1, $this->noticesFor($student, 'Voting is open'));
        $this->assertSame(1, $this->noticesFor($this->admin, 'Voting is open'));
    }

    public function test_deadline_notices_go_out_once_and_only_to_those_who_still_need_them(): void
    {
        $voted = $this->student();
        $waiting = $this->student();
        $this->approvedCandidate();

        $this->syncAt('2026-12-03 16:59:00');
        $this->assertSame(0, $this->noticesFor($waiting, 'Candidacy filing closes soon'));
        $this->syncAt('2026-12-03 17:00:00');
        $this->syncAt('2026-12-03 17:05:00');
        $this->assertSame(1, $this->noticesFor($waiting, 'Candidacy filing closes soon'));
        $this->assertSame(1, $this->noticesFor($voted, 'Candidacy filing closes soon'));

        $this->syncAt('2026-12-10 08:00:00');
        ElectionBallot::create(['election_id' => $this->election->id, 'round' => 1, 'voter_id' => $voted->school_id, 'receipt_ref' => 'RCPT0001', 'submitted_at' => now()]);

        $this->syncAt('2026-12-10 17:00:00');
        $this->syncAt('2026-12-10 17:05:00');
        $this->syncAt('2026-12-10 17:10:00');

        $this->assertSame(1, $this->noticesFor($waiting, 'Voting closes soon'));
        $this->assertSame(0, $this->noticesFor($voted, 'Voting closes soon'));
        $sent = $this->election->fresh()->notices_sent;
        $this->assertArrayHasKey('filing_closing', $sent);
        $this->assertArrayHasKey('voting_closing', $sent);
    }

    public function test_canvassing_is_set_when_a_filing_election_closes(): void
    {
        $this->approvedCandidate();
        $this->syncAt('2026-12-10 08:00:00');

        $result = $this->syncAt('2026-12-11 17:01:00');

        $election = $this->election->fresh();
        $this->assertSame(1, $result['closed']);
        $this->assertSame('closed', $election->status);
        $this->assertSame('canvassing', $election->phase);
        $this->assertSame(1, AuditLog::where('action', 'phase_changed')->where('record_id', $this->election->id)
            ->get()->filter(fn ($row) => ($row->new_values['to'] ?? null) === 'canvassing')->count());
    }

    public function test_a_legacy_election_opens_and_closes_as_before_and_completes_when_nothing_is_contested(): void
    {
        $legacy = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'upcoming',
            'approved_at' => '2026-11-20 09:00:00',
            'finalized_at' => '2026-11-25 09:00:00',
            'start_time' => '2026-12-02 08:00:00',
            'end_time' => '2026-12-03 17:00:00',
        ]);

        $before = $this->syncAt('2026-12-01 12:00:00');
        $this->assertSame(0, $before['opened']);
        $this->assertNull($this->phase($legacy));

        $result = $this->syncAt('2026-12-02 09:00:00');
        $this->assertSame('active', $legacy->fresh()->status);
        $this->assertSame(1, $result['opened']);
        $this->assertNull($this->phase($legacy));

        $result = $this->syncAt('2026-12-03 17:01:00');
        $this->assertSame('closed', $legacy->fresh()->status);
        $this->assertSame(1, $result['closed']);
        // Nothing is contested and the results are already visible, so canvassing finishes in the same sync.
        $this->assertSame('completed', $this->phase($legacy));
    }

    public function test_a_legacy_election_is_not_locked_by_the_engine(): void
    {
        $legacy = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'upcoming',
            'approved_at' => '2026-11-20 09:00:00',
            'finalized_at' => null,
            'start_time' => '2026-12-02 08:00:00',
            'end_time' => '2026-12-03 17:00:00',
        ]);

        $this->syncAt('2026-12-02 09:00:00');

        $legacy->refresh();
        $this->assertNull($legacy->finalized_at);
        $this->assertSame('upcoming', $legacy->status);
        $this->assertNull($legacy->phase);
    }

    public function test_a_closed_election_of_the_old_tally_keeps_its_phase(): void
    {
        $old = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'upcoming',
            'approved_at' => '2026-11-20 09:00:00',
            'tally_version' => 1,
            'start_time' => '2026-11-26 08:00:00',
            'end_time' => '2026-11-27 17:00:00',
        ]);

        $this->syncAt('2026-12-01 09:00:00');

        $this->assertSame('closed', $old->fresh()->status);
        $this->assertNull($this->phase($old));
    }

    public function test_suspended_and_cancelled_elections_are_not_opened_or_closed(): void
    {
        $suspended = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'upcoming',
            'approved_at' => '2026-11-20 09:00:00',
            'finalized_at' => '2026-11-25 09:00:00',
            'suspended_at' => '2026-11-30 09:00:00',
            'start_time' => '2026-11-30 08:00:00',
            'end_time' => '2026-12-05 17:00:00',
        ]);
        $cancelled = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'active',
            'approved_at' => '2026-11-20 09:00:00',
            'finalized_at' => '2026-11-25 09:00:00',
            'cancelled_at' => '2026-11-30 09:00:00',
            'start_time' => '2026-11-26 08:00:00',
            'end_time' => '2026-11-30 17:00:00',
        ]);

        $result = $this->syncAt('2026-12-01 09:00:00');

        $this->assertSame('upcoming', $suspended->fresh()->status);
        $this->assertSame('active', $cancelled->fresh()->status);
        $this->assertSame(['opened' => 0, 'closed' => 0], $result);
        $this->assertNull($this->phase($cancelled));
    }

    public function test_a_filing_election_that_missed_every_phase_catches_up_in_one_pass(): void
    {
        $this->approvedCandidate();

        $this->syncAt('2026-12-10 09:00:00');

        $this->assertSame('voting', $this->phase());
        $this->assertSame('active', $this->election->fresh()->status);
    }

    public function test_the_engine_can_be_scoped_to_one_election(): void
    {
        $other = $this->filingElection();

        Carbon::setTestNow('2026-12-03 09:00:00');
        Election::synchronizeScheduledStatuses([$this->organization->id], $this->election->id);

        $this->assertSame('filing', $this->phase());
        $this->assertNull($this->phase($other));
    }

    public function test_a_screening_decision_while_held_does_not_alert_the_admin_again(): void
    {
        $this->syncAt('2026-12-07 10:00:00');
        $first = $this->application('pending_review');
        $this->application('pending_review');
        $this->syncAt('2026-12-08 08:00:00');
        $this->assertSame(1, $this->noticesFor($this->admin, 'Election needs attention'));

        $first->forceFill(['status' => 'approved'])->save();
        $this->syncAt('2026-12-08 08:01:00');

        $election = $this->election->fresh();
        $this->assertSame('Screening is not finished: 1 application still needs a decision.', $election->phase_alert);
        $this->assertSame(1, $this->noticesFor($this->admin, 'Election needs attention'));
        $this->assertSame(1, AuditLog::where('action', 'phase_alert')->where('record_id', $this->election->id)->count());
    }

    public function test_a_filing_election_that_never_opened_voting_is_not_closed_at_its_end_time(): void
    {
        $this->election->forceFill(['results_visible' => false])->save();
        $this->syncAt('2026-12-07 10:00:00');
        $this->application('pending_review');
        $this->syncAt('2026-12-10 08:00:00');
        $this->assertNull($this->election->fresh()->finalized_at);

        $this->syncAt('2026-12-12 09:00:00');

        $election = $this->election->fresh();
        $this->assertSame('upcoming', $election->status);
        $this->assertNotSame('canvassing', $election->phase);
        $this->assertFalse((bool) $election->results_visible);
        $this->assertSame(0, Notification::where('reference_type', 'election')->where('reference_id', $election->id)->where('title', 'like', '%unoff%')->count());
        $this->assertSame(0, AuditLog::where('action', 'results_published')->where('record_id', $election->id)->count());
    }

    public function test_a_legacy_election_is_still_closed_at_its_end_time_without_a_finalized_ballot(): void
    {
        $legacy = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'upcoming',
            'approved_at' => '2026-11-20 09:00:00',
            'finalized_at' => null,
            'start_time' => '2026-12-10 08:00:00',
            'end_time' => '2026-12-11 17:00:00',
        ]);

        $this->syncAt('2026-12-12 09:00:00');

        $this->assertSame('closed', $legacy->fresh()->status);
    }
}
