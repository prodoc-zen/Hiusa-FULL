<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Notification;
use App\Models\OfficerAppointment;
use App\Models\OfficerHandover;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use App\Models\Vote;
use App\Services\ElectionHandoverService;
use App\Services\OfficerAppointmentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * A released election no longer hands the office over in the same minute. Each winner gets an Upcoming officer
 * appointment whose start is the Compliance renewal deadline minus one month, the access follows on that date, and
 * the officers they replace keep their access until the end of the school year and then become plain students.
 */
class OfficerAppointmentTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $dean;

    private AcademicSemester $semester;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);
        Storage::fake('local');
        Carbon::setTestNow('2026-11-20 09:00:00');

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $this->semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-11', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);

        $college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->dean = $this->makeCollegeHead($college);
        $this->admin = $this->member('ADMIN', 'Org Head');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function member(string $role = 'STUDENT', ?string $title = null): User
    {
        $user = User::factory()->create(['organization_id' => $this->organization->id, 'role' => $role, 'position_title' => $title]);
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

    private function deadline(string $date, array $overrides = []): ComplianceRequirementType
    {
        return ComplianceRequirementType::create([
            'category' => 'renewal',
            'academic_year' => '2026-2027',
            'name' => 'Renewal '.fake()->unique()->word(),
            'deadline_at' => $date.' 23:59:59',
            'is_active' => true,
            'created_by' => $this->admin->school_id,
            ...$overrides,
        ]);
    }

    private function election(array $overrides = []): Election
    {
        return Election::factory()->create([
            'organization_id' => $this->organization->id,
            'academic_semester_id' => $this->semester->id,
            'status' => 'closed',
            'phase' => 'completed',
            'start_time' => '2026-11-17 08:00:00',
            'end_time' => '2026-11-18 17:00:00',
            'approved_at' => '2026-11-01 09:00:00',
            'finalized_at' => '2026-11-10 09:00:00',
            'filing_starts_at' => '2026-11-02 08:00:00',
            'results_publish_at' => '2026-11-19 08:00:00',
            'results_visible' => true,
            'completed_at' => '2026-11-19 08:00:00',
            'tally_version' => 2,
            ...$overrides,
        ]);
    }

    /**
     * @param  array<int, int|User>  $entries  a vote count for a fresh student, or an existing user (given one vote)
     * @return array<int, User>
     */
    private function position(Election $election, string $title, array $entries, int $seats = 1): array
    {
        $position = ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => $title, 'max_winners' => $seats]);
        $users = [];
        foreach ($entries as $entry) {
            $user = $entry instanceof User ? $entry : User::factory()->student()->create(['organization_id' => $this->organization->id]);
            $votes = $entry instanceof User ? 1 : $entry;
            $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id, 'user_id' => $user->school_id]);
            for ($i = 0; $i < $votes; $i++) {
                Vote::create([
                    'election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id,
                    'voter_id' => null, 'round' => 1, 'vote_hash' => bin2hex(random_bytes(16)), 'cast_at' => '2026-11-17 00:00:00',
                ]);
            }
            $users[] = $user;
        }

        return $users;
    }

    private function service(): OfficerAppointmentService
    {
        return app(OfficerAppointmentService::class);
    }

    /** What the every-minute sync does for one election. */
    private function sync(Election $election): void
    {
        $this->service()->prepare($election->fresh(), null, null);
        $this->service()->schedule();
        $this->service()->activateDue();
        $this->service()->expireDue();
    }

    private function appointmentOf(User $user, ?string $kind = null): ?OfficerAppointment
    {
        return OfficerAppointment::where('user_school_id', $user->school_id)->when($kind, fn ($query) => $query->where('kind', $kind))->first();
    }

    private function notices(User $user, string $needle): int
    {
        return Notification::where('user_id', $user->school_id)->where('message', 'like', '%'.$needle.'%')->count();
    }

    public function test_a_winner_gets_an_upcoming_appointment_and_no_access_yet(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election();
        [$winner] = $this->position($election, 'Secretary', [5, 2]);

        $this->sync($election);

        $appointment = $this->appointmentOf($winner, 'incoming');
        $this->assertSame('upcoming', $appointment->status);
        $this->assertSame('scheduled', $appointment->activation_status);
        $this->assertSame('Secretary', $appointment->position_title);
        $this->assertSame('SBO_OFFICER', $appointment->role);
        $this->assertSame('2026-12-20', $appointment->term_starts_on->format('Y-m-d'));
        $this->assertSame('2027-01-20', $appointment->deadline_at->format('Y-m-d'));
        $this->assertSame('2026-2027', $appointment->academic_year);
        $this->assertSame($this->semester->id, (int) $appointment->academic_semester_id);
        $this->assertNull($appointment->flag);
        $this->assertNotNull($appointment->result_final_at);
        $this->assertSame('STUDENT', $this->profile($winner)->role);
        $this->assertSame(1, $this->notices($winner, 'You won Secretary'));
        $this->assertSame(1, $this->notices($winner, 'Dec 20, 2026'));
        $this->assertSame(1, AuditLog::where('module', 'records')->where('action', 'appointment_created')->where('record_id', $election->id)->count());
        $this->assertSame(6, OfficerHandover::where('election_id', $election->id)->count());
    }

    public function test_the_president_and_vice_presidents_become_admins_even_when_a_title_is_listed_under_both_roles(): void
    {
        foreach (['President', 'Vice President - Internal', 'Secretary'] as $title) {
            foreach (['ADMIN', 'SBO_OFFICER'] as $role) {
                SboPosition::create(['organization_id' => $this->organization->id, 'role' => $role, 'title' => $title]);
            }
        }
        $this->deadline('2027-01-20');
        $election = $this->election();
        [$president] = $this->position($election, ' PRESIDENT ', [3]);
        [$vice] = $this->position($election, 'Vice President - Internal', [3]);
        [$secretary] = $this->position($election, 'Secretary', [3]);

        $this->sync($election);

        $this->assertSame('ADMIN', $this->appointmentOf($president)->role);
        $this->assertSame('ADMIN', $this->appointmentOf($vice)->role);
        $this->assertSame('SBO_OFFICER', $this->appointmentOf($secretary)->role);
    }

    public function test_preparing_twice_creates_nothing_more(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election();
        [$winner] = $this->position($election, 'Secretary', [5, 2]);
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');

        $this->sync($election);
        $this->sync($election);

        $this->assertSame(2, OfficerAppointment::count());
        $this->assertSame(1, $this->notices($winner, 'You won Secretary'));
        $this->assertSame(1, $this->notices($outgoing, 'Your term as Secretary ends on'));
        $this->assertSame(2, AuditLog::where('action', 'appointment_created')->where('record_id', $election->id)->count());
        $this->assertSame(6, OfficerHandover::where('election_id', $election->id)->count());
    }

    public function test_unresolved_positions_create_nothing_and_a_later_run_adds_only_the_missing_ones(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election();
        [$decided] = $this->position($election, 'Secretary', [5, 2]);
        [$first, $second] = $this->position($election, 'Treasurer', [4, 4]);

        $this->sync($election);

        $this->assertNotNull($this->appointmentOf($decided));
        $this->assertNull($this->appointmentOf($first));
        $this->assertNull($this->appointmentOf($second));

        $treasurer = ElectionPosition::where('election_id', $election->id)->where('title', 'Treasurer')->first();
        $treasurer->update(['resolved_winner_ids' => [Candidate::where('user_id', $first->school_id)->value('id')]]);
        $this->sync($election);

        $this->assertNotNull($this->appointmentOf($first));
        $this->assertNull($this->appointmentOf($second));
        $this->assertSame(2, OfficerAppointment::where('kind', 'incoming')->count());
    }

    public function test_an_unpublished_runoff_outcome_waits_for_its_publication_time(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election(['runoff_starts_at' => '2026-11-22 08:00:00', 'runoff_ends_at' => '2026-11-22 17:00:00', 'runoff_publish_at' => '2026-11-25 08:00:00']);
        [$first, $second] = $this->position($election, 'Treasurer', [4, 4]);
        ElectionPosition::where('election_id', $election->id)->update(['resolved_winner_ids' => [Candidate::where('user_id', $first->school_id)->value('id')]]);

        $this->sync($election);
        $this->assertNull($this->appointmentOf($first));

        Carbon::setTestNow('2026-11-25 08:30:00');
        $this->sync($election);
        $this->assertNotNull($this->appointmentOf($first));
        $this->assertNull($this->appointmentOf($second));
    }

    public function test_a_winner_whose_profile_cannot_take_the_seat_is_skipped_and_recorded(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election();
        [$inactive] = $this->position($election, 'Secretary', [5]);
        [$staff] = $this->position($election, 'Treasurer', [5]);
        $this->profile($inactive)->update(['account_status' => 'inactive']);
        $this->profile($staff)->update(['role' => 'DEPARTMENT_HEAD']);

        $this->sync($election);

        $this->assertSame(0, OfficerAppointment::count());
        $audit = AuditLog::where('action', 'appointments_prepared')->where('record_id', $election->id)->firstOrFail();
        $this->assertCount(2, $audit->new_values['skipped']);
    }

    public function test_a_missing_deadline_flags_the_appointment_and_is_recalculated_once_compliance_has_one(): void
    {
        $election = $this->election();
        [$winner] = $this->position($election, 'Secretary', [5, 2]);
        $dean = $this->dean;

        $this->sync($election);
        $this->sync($election);

        $appointment = $this->appointmentOf($winner);
        $this->assertSame('upcoming', $appointment->status);
        $this->assertSame('failed', $appointment->activation_status);
        $this->assertSame('missing_deadline', $appointment->flag);
        $this->assertNull($appointment->term_starts_on);
        $this->assertSame(1, $this->notices($winner, 'renewal deadline'));
        $this->assertSame(1, Notification::where('user_id', $this->admin->school_id)->where('title', 'No renewal deadline in Compliance')->count());
        $this->assertSame(1, Notification::where('user_id', $dean->school_id)->where('title', 'No renewal deadline in Compliance')->count());

        $this->deadline('2027-01-20');
        $this->service()->schedule();

        $appointment = $appointment->fresh();
        $this->assertNull($appointment->flag);
        $this->assertSame('scheduled', $appointment->activation_status);
        $this->assertSame('2026-12-20', $appointment->term_starts_on->format('Y-m-d'));
        $this->assertSame(1, AuditLog::where('action', 'appointment_recalculated')->count());
        $this->assertSame(1, $this->notices($winner, 'Dec 20, 2026'));
    }

    public function test_a_start_date_that_already_passed_activates_at_once_and_is_flagged(): void
    {
        $this->deadline('2026-12-10');
        $election = $this->election();
        [$winner] = $this->position($election, 'Secretary', [5, 2]);

        $this->sync($election);

        $appointment = $this->appointmentOf($winner);
        $this->assertSame('active', $appointment->status);
        $this->assertSame('start_passed', $appointment->flag);
        $this->assertSame('2026-11-10', $appointment->term_starts_on->format('Y-m-d'));
        $this->assertSame('SBO_OFFICER', $this->profile($winner)->role);
        $this->assertSame('Secretary', $this->profile($winner)->position_title);
        $this->assertSame(1, Notification::where('user_id', $this->admin->school_id)->where('title', 'Officer start date already passed')->count());
        $this->assertSame(1, Notification::where('user_id', $this->dean->school_id)->where('title', 'Officer start date already passed')->count());
        $this->assertSame(1, $this->notices($winner, 'You now have access to'));
    }

    public function test_the_access_starts_on_the_calculated_date_and_not_before(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election();
        [$winner] = $this->position($election, 'President', [5, 2]);
        $this->sync($election);

        Carbon::setTestNow('2026-12-19 23:00:00');
        $this->service()->activateDue();
        $this->assertSame('STUDENT', $this->profile($winner)->role);

        Carbon::setTestNow('2026-12-20 00:30:00');
        $this->service()->activateDue();

        $profile = $this->profile($winner);
        $this->assertSame('ADMIN', $profile->role);
        $this->assertSame('President', $profile->position_title);
        $this->assertSame('active', $profile->account_status);
        $this->assertNull($profile->modules);
        $appointment = $this->appointmentOf($winner);
        $this->assertSame('active', $appointment->status);
        $this->assertSame('active', $appointment->activation_status);
        $this->assertNotNull($appointment->activated_at);
        $this->assertNull($appointment->flag);
        $this->assertSame(1, AuditLog::where('action', 'appointment_activated')->count());
        $this->assertSame(1, $this->notices($winner, 'You now have access to '.$this->organization->name));
    }

    public function test_a_deadline_moved_before_activation_recalculates_and_tells_the_appointee(): void
    {
        $type = $this->deadline('2027-01-20');
        $election = $this->election();
        [$winner] = $this->position($election, 'Secretary', [5, 2]);
        $this->sync($election);

        $type->update(['deadline_at' => '2027-02-20 23:59:59']);
        $this->service()->schedule();

        $appointment = $this->appointmentOf($winner);
        $this->assertSame('2027-01-20', $appointment->term_starts_on->format('Y-m-d'));
        $this->assertSame('2027-02-20', $appointment->deadline_at->format('Y-m-d'));
        $this->assertNotNull($appointment->last_recalculated_at);
        $this->assertSame(1, AuditLog::where('action', 'appointment_recalculated')->count());
        $this->assertSame(1, $this->notices($winner, 'Jan 20, 2027'));

        $this->service()->schedule();
        $this->assertSame(1, AuditLog::where('action', 'appointment_recalculated')->count());
    }

    public function test_a_deadline_moved_after_activation_changes_nothing(): void
    {
        $type = $this->deadline('2027-01-20');
        $election = $this->election();
        [$winner] = $this->position($election, 'Secretary', [5, 2]);
        $this->sync($election);
        Carbon::setTestNow('2026-12-21 09:00:00');
        $this->service()->activateDue();

        $type->update(['deadline_at' => '2027-03-20 23:59:59']);
        $this->service()->schedule();
        $this->service()->activateDue();

        $appointment = $this->appointmentOf($winner);
        $this->assertSame('active', $appointment->status);
        $this->assertSame('2026-12-20', $appointment->term_starts_on->format('Y-m-d'));
        $this->assertSame('SBO_OFFICER', $this->profile($winner)->role);
    }

    public function test_the_outgoing_officer_keeps_access_until_the_school_year_ends_then_becomes_a_student(): void
    {
        $this->deadline('2027-01-20');
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        AccountProfile::where('user_school_id', $outgoing->school_id)->update(['modules' => ['events']]);
        $bystander = $this->member('SBO_OFFICER', 'Treasurer');
        $election = $this->election();
        [$winner] = $this->position($election, 'Secretary', [5, 2]);
        $this->sync($election);

        $row = $this->appointmentOf($outgoing);
        $this->assertSame('outgoing', $row->kind);
        $this->assertSame('active', $row->status);
        $this->assertSame('2027-05-31', $row->term_ends_on->format('Y-m-d'));
        $this->assertNull($this->appointmentOf($bystander));
        $this->assertSame(1, $this->notices($outgoing, 'Your term as Secretary ends on May 31, 2027'));

        Carbon::setTestNow('2026-12-21 09:00:00');
        $this->sync($election);
        $this->assertSame('SBO_OFFICER', $this->profile($winner)->role);
        $this->assertSame('SBO_OFFICER', $this->profile($outgoing)->role);

        Carbon::setTestNow('2027-05-31 20:00:00');
        $this->service()->expireDue();
        $this->assertSame('SBO_OFFICER', $this->profile($outgoing)->role);

        Carbon::setTestNow('2027-06-01 09:00:00');
        $this->service()->expireDue();

        $profile = $this->profile($outgoing);
        $this->assertSame('STUDENT', $profile->role);
        $this->assertNull($profile->position_title);
        $this->assertNull($profile->modules);
        $this->assertSame('active', $profile->account_status);
        $this->assertSame('ended', $row->fresh()->status);
        $this->assertNotNull($row->fresh()->ended_at);
        $this->assertSame('SBO_OFFICER', $this->profile($bystander)->role);
        $this->assertSame(1, AuditLog::where('action', 'appointment_expired')->count());
        $this->assertSame(1, $this->notices($outgoing, 'Your term as Secretary has ended'));
        $this->assertTrue(AccountProfile::votingMembers()->where('organization_id', $this->organization->id)->where('user_school_id', $outgoing->school_id)->exists());
    }

    public function test_an_outgoing_officer_of_an_election_without_a_semester_keeps_access_to_the_end_of_the_active_school_year(): void
    {
        $this->deadline('2027-01-20');
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->election(['academic_semester_id' => null]);
        [$winner] = $this->position($election, 'Secretary', [5, 2]);

        $this->sync($election);

        $row = $this->appointmentOf($outgoing);
        $this->assertSame('2027-05-31', $row->term_ends_on->format('Y-m-d'));
        $this->assertSame('2026-2027', $this->appointmentOf($winner, 'incoming')->academic_year);
        Carbon::setTestNow('2026-12-21 09:00:00');
        $this->sync($election);
        $this->assertSame('SBO_OFFICER', $this->profile($winner)->role);
        $this->assertSame('SBO_OFFICER', $this->profile($outgoing)->role);
    }

    public function test_an_outgoing_officer_with_no_semester_at_all_ends_when_the_incoming_term_starts(): void
    {
        $this->deadline('2027-01-20');
        $this->semester->update(['status' => 'completed']);
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->election(['academic_semester_id' => null]);
        $this->position($election, 'Secretary', [5, 2]);

        $this->sync($election);

        $this->assertSame('2026-12-20', $this->appointmentOf($outgoing)->term_ends_on->format('Y-m-d'));
        Carbon::setTestNow('2026-12-21 09:00:00');
        $this->sync($election);
        $this->assertSame('STUDENT', $this->profile($outgoing)->role);
    }

    public function test_an_expiring_officer_with_another_active_appointment_keeps_their_seat(): void
    {
        $this->deadline('2027-01-20');
        $holder = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->election();
        $this->position($election, 'Secretary', [5, 2]);
        $this->position($election, 'Treasurer', [$holder]);
        $this->sync($election);
        Carbon::setTestNow('2026-12-21 09:00:00');
        $this->sync($election);

        $this->assertSame('Treasurer', $this->profile($holder)->position_title);

        Carbon::setTestNow('2027-06-02 09:00:00');
        $this->service()->expireDue();

        $this->assertSame('ended', $this->appointmentOf($holder, 'outgoing')->status);
        $this->assertSame('SBO_OFFICER', $this->profile($holder)->role);
        $this->assertSame('Treasurer', $this->profile($holder)->position_title);
    }

    public function test_an_expiring_officer_whose_title_changed_since_is_left_alone(): void
    {
        $this->deadline('2027-01-20');
        $holder = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->election();
        $this->position($election, 'Secretary', [5, 2]);
        $this->sync($election);
        $this->profile($holder)->update(['position_title' => 'Auditor']);

        Carbon::setTestNow('2027-06-02 09:00:00');
        $this->service()->expireDue();

        $this->assertSame('ended', $this->appointmentOf($holder, 'outgoing')->status);
        $this->assertSame('SBO_OFFICER', $this->profile($holder)->role);
        $this->assertSame('Auditor', $this->profile($holder)->position_title);
    }

    public function test_an_outgoing_president_who_wins_a_lower_seat_takes_it_and_a_dean_granted_admin_keeps_access(): void
    {
        $this->deadline('2027-01-20');
        $incumbent = $this->member('ADMIN', 'President');
        $election = $this->election();
        $this->position($election, 'President', [5]);
        $this->position($election, 'Secretary', [$incumbent]);
        $head = $this->member('ADMIN', 'Org Head');
        $this->position($election, 'Treasurer', [$head]);
        $this->sync($election);
        Carbon::setTestNow('2026-12-21 09:00:00');
        $this->sync($election);

        $this->assertSame('SBO_OFFICER', $this->profile($incumbent)->role);
        $this->assertSame('Secretary', $this->profile($incumbent)->position_title);
        $this->assertSame('ADMIN', $this->profile($head)->role);
        $this->assertSame('Org Head', $this->profile($head)->position_title);
        $this->assertSame('active', $this->appointmentOf($head)->status);
    }

    public function test_an_activation_that_fails_is_recorded_and_retried(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election();
        [$winner] = $this->position($election, 'Secretary', [5, 2]);
        $this->sync($election);
        User::where('school_id', $winner->school_id)->update(['account_status' => 'inactive']);

        Carbon::setTestNow('2026-12-21 09:00:00');
        $this->service()->activateDue();
        $this->service()->activateDue();

        $appointment = $this->appointmentOf($winner);
        $this->assertSame('upcoming', $appointment->status);
        $this->assertSame('failed', $appointment->activation_status);
        $this->assertSame('STUDENT', $this->profile($winner)->role);
        $this->assertSame(1, AuditLog::where('action', 'appointment_activation_failed')->count());

        User::where('school_id', $winner->school_id)->update(['account_status' => 'active']);
        $this->service()->activateDue();

        $this->assertSame('active', $appointment->fresh()->status);
        $this->assertSame('SBO_OFFICER', $this->profile($winner)->role);
    }

    public function test_the_notices_seven_days_before_the_start_and_the_end_go_out_once(): void
    {
        $this->deadline('2027-01-20');
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->election();
        [$winner] = $this->position($election, 'Secretary', [5, 2]);
        $this->sync($election);

        Carbon::setTestNow('2026-12-12 09:00:00');
        $this->service()->schedule();
        $this->service()->schedule();
        $this->assertSame(0, $this->notices($winner, 'starts in 7 days'));

        Carbon::setTestNow('2026-12-13 09:00:00');
        $this->service()->schedule();
        $this->service()->schedule();
        $this->assertSame(1, $this->notices($winner, 'starts in 7 days'));
        $this->assertNotNull($this->appointmentOf($winner)->start_notice_at);

        Carbon::setTestNow('2027-05-24 09:00:00');
        $this->service()->expireDue();
        $this->service()->expireDue();
        $this->assertSame(1, $this->notices($outgoing, 'ends in 7 days'));
    }

    public function test_activation_moves_the_prepared_handover_items_under_review(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election();
        $this->position($election, 'Secretary', [5, 2]);
        $this->sync($election);
        OfficerHandover::where('election_id', $election->id)->where('category', 'finance')->update(['status' => 'prepared']);

        Carbon::setTestNow('2026-12-21 09:00:00');
        $this->service()->activateDue();

        $this->assertSame('under_review', OfficerHandover::where('election_id', $election->id)->where('category', 'finance')->value('status'));
        $this->assertSame('pending', OfficerHandover::where('election_id', $election->id)->where('category', 'events')->value('status'));
    }

    public function test_an_election_that_is_not_released_or_was_cancelled_creates_nothing(): void
    {
        $this->deadline('2027-01-20');
        $hidden = $this->election(['results_visible' => false]);
        $this->position($hidden, 'Secretary', [5, 2]);
        $cancelled = $this->election(['cancelled_at' => '2026-11-19 10:00:00']);
        $this->position($cancelled, 'Treasurer', [5, 2]);
        $open = $this->election(['status' => 'active', 'end_time' => '2026-11-21 17:00:00']);
        $this->position($open, 'Auditor', [5, 2]);

        foreach ([$hidden, $cancelled, $open] as $election) {
            $this->assertNull($this->service()->prepare($election->fresh(), null, null));
        }

        $this->assertSame(0, OfficerAppointment::count());
    }

    public function test_the_results_show_the_officer_access_of_each_position(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election();
        $this->position($election, 'Secretary', [5, 2]);
        $this->position($election, 'Treasurer', [5, 2]);
        $this->sync($election);
        OfficerAppointment::where('position_title', 'Treasurer')->update(['status' => 'active']);

        Sanctum::actingAs($this->admin);
        $rows = collect($this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json())->keyBy('position.title');

        $this->assertSame('upcoming', $rows['Secretary']['officer_access']);
        $this->assertSame('2026-12-20', $rows['Secretary']['term_starts_on']);
        $this->assertSame('active', $rows['Treasurer']['officer_access']);
        $this->assertFalse($rows['Secretary']['access_handed_over']);
    }

    public function test_an_election_counted_under_the_earlier_reading_hands_over_at_once_and_creates_no_appointment(): void
    {
        $this->deadline('2027-01-20');
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->election(['tally_version' => 1, 'completed_at' => null, 'phase' => null]);
        [$winner] = $this->position($election, 'Secretary', [5, 2]);

        $result = app(ElectionHandoverService::class)->handOver($election->fresh(), $this->admin->school_id, '127.0.0.1');
        Election::synchronizeScheduledStatuses();

        $this->assertTrue($result['handed_over']);
        $this->assertSame('SBO_OFFICER', $this->profile($winner)->role);
        $this->assertSame('STUDENT', $this->profile($outgoing)->role);
        $this->assertNotNull($election->fresh()->access_handed_over_at);
        $this->assertSame(0, OfficerAppointment::count());
    }

    public function test_the_hand_over_of_a_new_election_prepares_appointments_and_sets_the_hand_over_time_once_completed(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election(['completed_at' => null, 'phase' => 'canvassing']);
        [$winner] = $this->position($election, 'Secretary', [5, 2]);

        $result = app(ElectionHandoverService::class)->handOver($election->fresh(), $this->admin->school_id, '127.0.0.1');

        $this->assertNotNull($result);
        $this->assertNotNull($this->appointmentOf($winner));
        $this->assertNull($election->fresh()->access_handed_over_at);

        $election->update(['completed_at' => now()]);
        app(ElectionHandoverService::class)->handOver($election->fresh());

        $this->assertNotNull($election->fresh()->access_handed_over_at);
        $this->assertSame(1, OfficerAppointment::where('kind', 'incoming')->count());
    }

    public function test_the_sync_runs_the_whole_engine_whatever_semester_is_active(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election(['completed_at' => null, 'phase' => 'canvassing']);
        [$winner] = $this->position($election, 'Secretary', [5, 2]);
        $this->semester->update(['status' => 'completed']);

        Election::synchronizeScheduledStatuses();
        $this->assertNotNull($this->appointmentOf($winner));

        Carbon::setTestNow('2026-12-21 09:00:00');
        Election::synchronizeScheduledStatuses();
        $this->assertSame('SBO_OFFICER', $this->profile($winner)->role);
    }

    public function test_the_admin_update_path_still_answers_with_the_same_shape(): void
    {
        $this->deadline('2027-01-20');
        $legacy = $this->election(['tally_version' => 1, 'completed_at' => null, 'phase' => null, 'results_visible' => false, 'filing_starts_at' => null]);
        // The short form (no filing window) is still released by the Admin; a filing election is published by the schedule only.
        $current = $this->election(['completed_at' => null, 'phase' => 'canvassing', 'results_visible' => false, 'filing_starts_at' => null]);
        $this->position($current, 'Secretary', [5, 2]);

        Sanctum::actingAs($this->admin);
        $before = $this->putJson('/api/elections/'.$legacy->id, ['results_visible' => true])->assertOk()->json();
        $after = $this->putJson('/api/elections/'.$current->id, ['results_visible' => true])->assertOk()->json();

        $this->assertSame(array_keys($before), array_keys($after));
        $this->assertSame(1, OfficerAppointment::where('election_id', $current->id)->count());
    }

    public function test_an_outgoing_officer_cannot_submit_a_renewal_once_the_incoming_officers_are_active(): void
    {
        $type = $this->deadline('2027-01-20');
        $outgoing = $this->member('ADMIN', 'Vice President');
        $election = $this->election();
        $this->position($election, 'Vice President', [5, 2]);
        $this->sync($election);
        $upload = fn () => ['requirement_type_id' => $type->id, 'document' => UploadedFile::fake()->create('renewal.pdf', 20, 'application/pdf')];

        Sanctum::actingAs($outgoing);
        $this->post('/api/compliance/submissions', $upload(), ['Accept' => 'application/json'])->assertCreated();

        OfficerAppointment::where('kind', 'incoming')->update(['status' => 'active']);
        $other = ComplianceRequirementType::create([
            'category' => 'renewal', 'academic_year' => '2026-2027', 'name' => 'Second renewal', 'deadline_at' => '2027-02-20 23:59:59',
            'is_active' => true, 'created_by' => $this->admin->school_id,
        ]);

        $this->post('/api/compliance/submissions', ['requirement_type_id' => $other->id, 'document' => UploadedFile::fake()->create('renewal.pdf', 20, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertForbidden()
            ->assertJsonPath('message', 'Renewal belongs to the incoming officers. You can view it and help them prepare.');

        $incoming = User::find(OfficerAppointment::where('kind', 'incoming')->value('user_school_id'));
        $incoming->update(['role' => 'ADMIN']);
        AccountProfile::where('user_school_id', $incoming->school_id)->where('organization_id', $this->organization->id)->update(['role' => 'ADMIN']);
        Sanctum::actingAs($incoming);
        $this->post('/api/compliance/submissions', ['requirement_type_id' => $other->id, 'document' => UploadedFile::fake()->create('renewal.pdf', 20, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertCreated();
    }

    public function test_a_renewal_deadline_change_also_tells_the_officers_with_an_appointment(): void
    {
        $type = $this->deadline('2027-01-20');
        $election = $this->election();
        [$winner] = $this->position($election, 'Secretary', [5, 2]);
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $this->sync($election);
        $saoHome = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $sao = User::factory()->superAdmin()->create(['organization_id' => $saoHome->id]);

        Sanctum::actingAs($sao);
        $this->putJson('/api/compliance/requirement-types/'.$type->id, ['deadline_at' => '2027-02-25', 'template_url' => 'https://example.com/renewal-sample'])->assertOk();

        $this->assertSame(1, Notification::where('user_id', $winner->school_id)->where('title', 'Compliance deadline changed')->count());
        $this->assertSame(1, Notification::where('user_id', $outgoing->school_id)->where('title', 'Compliance deadline changed')->count());
        $this->assertSame(1, Notification::where('user_id', $this->admin->school_id)->where('title', 'Compliance deadline changed')->count());
    }

    public function test_cancelling_a_released_election_ends_its_upcoming_and_outgoing_appointments_and_changes_no_role(): void
    {
        $this->deadline('2027-01-20');
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->election(['phase' => 'canvassing', 'completed_at' => null]);
        [$winner] = $this->position($election, 'Secretary', [5, 2]);
        $this->sync($election);
        $this->assertSame('upcoming', $this->appointmentOf($winner, 'incoming')->status);
        $this->assertSame('active', $this->appointmentOf($outgoing, 'outgoing')->status);

        Sanctum::actingAs($this->admin);
        $this->postJson('/api/elections/'.$election->id.'/cancel', ['reason' => 'The vote was challenged.'])->assertOk();

        $this->assertSame('ended', $this->appointmentOf($winner, 'incoming')->status);
        $this->assertSame('ended', $this->appointmentOf($outgoing, 'outgoing')->status);
        $voided = AuditLog::where('module', 'records')->where('action', 'appointment_voided')->where('record_id', $election->id)->get();
        $this->assertCount(2, $voided);
        $this->assertSame($this->admin->school_id, $voided->first()->user_id);

        foreach (['2026-12-21 09:00:00', '2027-06-01 09:00:00'] as $day) {
            Carbon::setTestNow($day);
            $this->sync($election);
        }
        $this->assertSame('STUDENT', $this->profile($winner)->role);
        $this->assertSame('SBO_OFFICER', $this->profile($outgoing)->role);
        $this->assertSame('Secretary', $this->profile($outgoing)->position_title);
    }

    public function test_an_appointment_left_upcoming_on_a_cancelled_election_is_ended_and_never_activated(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election(['phase' => 'canvassing', 'completed_at' => null]);
        [$winner] = $this->position($election, 'Secretary', [5, 2]);
        $this->sync($election);
        $election->forceFill(['cancelled_at' => '2026-11-21 09:00:00', 'phase' => 'cancelled'])->save();

        Carbon::setTestNow('2026-12-21 09:00:00');
        $this->assertSame(0, $this->service()->activateDue());

        $this->assertSame('STUDENT', $this->profile($winner)->role);
        $row = $this->appointmentOf($winner, 'incoming');
        $this->assertSame('ended', $row->status);
        $this->assertNotNull($row->ended_at);
        $this->assertSame(1, AuditLog::where('module', 'records')->where('action', 'appointment_voided')->where('record_id', $election->id)->count());
    }

    public function test_a_suspended_election_activates_nothing_until_it_is_resumed(): void
    {
        $this->deadline('2027-01-20');
        $election = $this->election(['phase' => 'canvassing', 'completed_at' => null]);
        [$winner] = $this->position($election, 'Secretary', [5, 2]);
        $this->sync($election);
        $election->forceFill(['suspended_at' => '2026-11-21 09:00:00', 'halt_reason' => 'Under review.'])->save();

        Carbon::setTestNow('2026-12-21 09:00:00');
        $this->assertSame(0, $this->service()->activateDue());
        $this->assertSame('upcoming', $this->appointmentOf($winner, 'incoming')->status);
        $this->assertSame('STUDENT', $this->profile($winner)->role);

        $election->forceFill(['suspended_at' => null, 'halt_reason' => null])->save();
        $this->assertSame(1, $this->service()->activateDue());
        $this->assertSame('SBO_OFFICER', $this->profile($winner)->role);
    }
}
