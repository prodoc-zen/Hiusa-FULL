<?php

namespace App\Services;

use App\Models\AcademicSemester;
use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Notification;
use App\Models\OfficerAppointment;
use App\Models\OfficerHandover;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use App\Support\RenewalDeadline;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Turns a released election into staged officer appointments. A winner is Upcoming until the term start, which is the
 * official renewal deadline in Compliance minus one calendar month; on that date the profile receives the role. The
 * officers they replace keep access until the end of the school year and then become plain students, never removed.
 *
 * Every method is safe to run on every sync: rows are created once, notices are tracked on the row, and a failed
 * activation is recorded once and retried on the next run.
 */
class OfficerAppointmentService
{
    /** Roles a profile may hold and still be given, or lose, a seat here. */
    private const SEAT_ROLES = ['ADMIN', 'SBO_OFFICER', 'STUDENT'];

    public function __construct(
        private readonly ElectionTallyService $tally,
        private readonly OrganizationRecipients $recipients,
    ) {}

    /**
     * Creates the Upcoming appointment of every finalized winner and the outgoing rows of the officers they replace.
     * Positions still waiting on a runoff or a tie decision create nothing; a later run adds only the missing ones.
     *
     * @return array{granted: array<int, array<string, mixed>>, skipped: array<int, array<string, mixed>>, ties: array<int, string>}|null null when the election is not released, or was cancelled
     */
    public function prepare(Election $election, ?int $actorSchoolId = null, ?string $ipAddress = null): ?array
    {
        $election = $election->fresh();
        $organization = $election ? Organization::find($election->organization_id) : null;

        if (! $election || ! $organization || ! $this->released($election)) {
            return null;
        }

        $granted = [];
        $skipped = [];
        $ties = [];
        $outgoing = [];
        $schoolYearEnd = $this->schoolYearEnd($election);
        $academicYear = $this->academicYear($election);

        foreach ($this->tally->standings($election) as $row) {
            $position = $row['position'];
            $waitsOnRunoffNotice = $row['runoff'] !== null && $election->runoff_publish_at !== null && now()->lt($election->runoff_publish_at);

            if (! in_array($row['status'], ['decided', 'unopposed', 'resolved'], true) || $waitsOnRunoffNotice) {
                if (in_array($row['status'], ElectionTallyService::UNRESOLVED, true) || $waitsOnRunoffNotice) {
                    $ties[] = $position->title;
                }

                continue;
            }

            $title = trim($position->title);
            $role = $this->roleFor($title);
            $winnerIds = $row['winners']->pluck('user_id')->map(fn ($id) => (int) $id)->all();

            foreach ($winnerIds as $schoolId) {
                $exists = OfficerAppointment::where('election_id', $election->id)
                    ->where('election_position_id', $position->id)
                    ->where('user_school_id', $schoolId)
                    ->exists();

                if ($exists) {
                    continue;
                }

                if ($reason = $this->cannotTakeSeat($organization, $schoolId)) {
                    $skipped[] = ['school_id' => $schoolId, 'position_title' => $title, 'reason' => $reason];

                    continue;
                }

                $appointment = OfficerAppointment::create([
                    'organization_id' => $organization->id,
                    'election_id' => $election->id,
                    'election_position_id' => $position->id,
                    'user_school_id' => $schoolId,
                    'position_title' => $title,
                    'is_executive' => (bool) $position->is_executive,
                    'role' => $role,
                    'kind' => 'incoming',
                    'status' => 'upcoming',
                    'activation_status' => 'scheduled',
                    'academic_year' => $academicYear,
                    'academic_semester_id' => $election->academic_semester_id,
                    'result_final_at' => now(),
                ]);

                $this->audit($appointment, 'appointment_created', $actorSchoolId, $ipAddress, [
                    'appointment_id' => $appointment->id,
                    'user_school_id' => $schoolId,
                    'position_title' => $title,
                    'role' => $role,
                    'kind' => 'incoming',
                ]);
                $granted[] = ['school_id' => $schoolId, 'position_title' => $title, 'role' => $role];
                $this->calculate($appointment, true);
                $this->announceWin($election, $appointment->fresh());
            }

            $outgoing[] = [$position, $title, $winnerIds];
        }

        foreach ($outgoing as [$position, $title, $winnerIds]) {
            if (OfficerAppointment::where('election_id', $election->id)->where('election_position_id', $position->id)->where('kind', 'incoming')->doesntExist()) {
                continue;
            }

            $this->prepareOutgoing($election, $organization, $position, $title, $winnerIds, $schoolYearEnd, $academicYear, $actorSchoolId, $ipAddress);
        }

        if (OfficerAppointment::where('election_id', $election->id)->exists()) {
            OfficerHandover::ensureFor($election);
        }

        $reported = AuditLog::where('record_type', Election::class)->where('record_id', $election->id)->where('action', 'appointments_prepared')->exists();
        if ($granted !== [] || ! $reported) {
            AuditLog::create([
                'organization_id' => $organization->id,
                'user_id' => $actorSchoolId,
                'module' => 'records',
                'action' => 'appointments_prepared',
                'record_type' => Election::class,
                'record_id' => $election->id,
                'old_values' => null,
                'new_values' => ['granted' => $granted, 'skipped' => $skipped, 'ties' => $ties],
                'ip_address' => $ipAddress,
                'created_at' => now(),
            ]);
        }

        return ['granted' => $granted, 'skipped' => $skipped, 'ties' => $ties];
    }

    /**
     * Keeps every upcoming appointment's start in step with Compliance, tells the officers a week ahead, and gives an
     * outgoing officer with no school year end the incoming term start as their end.
     */
    public function schedule(?int $electionId = null, ?array $organizationIds = null): void
    {
        $today = now()->toDateString();

        $this->scoped(OfficerAppointment::query(), $electionId, $organizationIds)
            ->where('kind', 'incoming')
            ->where('status', 'upcoming')
            ->where(fn ($query) => $query->whereNull('term_starts_on')->orWhere('term_starts_on', '>', $today))
            ->orderBy('id')
            ->get()
            ->each(fn (OfficerAppointment $appointment) => $this->calculate($appointment, false));

        $this->alignOutgoingWithIncoming($electionId, $organizationIds);

        $this->scoped(OfficerAppointment::query(), $electionId, $organizationIds)
            ->where('kind', 'incoming')
            ->where('status', 'upcoming')
            ->whereNull('start_notice_at')
            ->whereNotNull('term_starts_on')
            ->where('term_starts_on', '>', $today)
            ->where('term_starts_on', '<=', now()->addDays(7)->toDateString())
            ->get()
            ->each(function (OfficerAppointment $appointment) {
                $this->notifyAppointee($appointment, 'Officer access starts soon', 'Your officer access as '.$appointment->position_title.' starts in 7 days, on '.$this->day($appointment->term_starts_on).'.');
                $appointment->forceFill(['start_notice_at' => now()])->save();
            });
    }

    /**
     * Gives the profile its role on the term start date. A failure is caught per appointment, recorded once and retried.
     *
     * @return int appointments activated in this run
     */
    public function activateDue(?int $electionId = null, ?array $organizationIds = null): int
    {
        $activated = 0;

        $this->scoped(OfficerAppointment::query(), $electionId, $organizationIds)
            ->where('kind', 'incoming')
            ->where('status', 'upcoming')
            ->whereNotNull('term_starts_on')
            ->where('term_starts_on', '<=', now()->toDateString())
            ->orderBy('id')
            ->get()
            ->each(function (OfficerAppointment $appointment) use (&$activated) {
                try {
                    if ($this->activate($appointment)) {
                        $activated++;
                    }
                } catch (\Throwable $exception) {
                    $this->recordActivationFailure($appointment, $exception);
                }
            });

        return $activated;
    }

    /**
     * Ends the terms that are over. The profile becomes a plain student of the same organization, never inactive,
     * unless the person holds another active appointment there or their title is no longer the one that ended.
     *
     * @return int appointments ended in this run
     */
    public function expireDue(?int $electionId = null, ?array $organizationIds = null): int
    {
        $ended = 0;
        $today = now()->toDateString();

        $this->scoped(OfficerAppointment::query(), $electionId, $organizationIds)
            ->where('status', 'active')
            ->whereNotNull('term_ends_on')
            ->where('term_ends_on', '<', $today)
            ->orderBy('id')
            ->get()
            ->each(function (OfficerAppointment $appointment) use (&$ended) {
                DB::transaction(function () use ($appointment, &$ended) {
                    $locked = OfficerAppointment::query()->lockForUpdate()->find($appointment->id);
                    if (! $locked || $locked->status !== 'active') {
                        return;
                    }

                    $locked->forceFill(['status' => 'ended', 'ended_at' => now()])->save();
                    $this->stepDown($locked);
                    $this->audit($locked, 'appointment_expired', null, null, [
                        'appointment_id' => $locked->id,
                        'user_school_id' => (int) $locked->user_school_id,
                        'position_title' => $locked->position_title,
                        'kind' => $locked->kind,
                    ]);
                    $this->notifyAppointee($locked, 'Officer term ended', 'Your term as '.$locked->position_title.' has ended. You remain a member of '.$this->organizationName($locked).'.');
                    $ended++;
                });
            });

        $this->scoped(OfficerAppointment::query(), $electionId, $organizationIds)
            ->where('status', 'active')
            ->whereNull('end_notice_at')
            ->whereNotNull('term_ends_on')
            ->where('term_ends_on', '>=', $today)
            ->where('term_ends_on', '<=', now()->addDays(7)->toDateString())
            ->get()
            ->each(function (OfficerAppointment $appointment) {
                $this->notifyAppointee($appointment, 'Officer term ends soon', 'Your term as '.$appointment->position_title.' ends in 7 days, on '.$this->day($appointment->term_ends_on).'.');
                $appointment->forceFill(['end_notice_at' => now()])->save();
            });

        return $ended;
    }

    /** Closed, released, finalized and not cancelled: the only election whose winners may be appointed. */
    private function released(Election $election): bool
    {
        return $election->status === 'closed'
            && $election->results_visible
            && $election->finalized_at !== null
            && $election->cancelled_at === null;
    }

    /** The President and every Vice President head the organization; every other seat is an officer. */
    private function roleFor(string $title): string
    {
        return SboPosition::normaliseTitle($title) === 'president' || SboPosition::isVicePresidentTitle($title) ? 'ADMIN' : 'SBO_OFFICER';
    }

    /** Why a winner cannot be given the seat, or null. A profile or account switched off for cause stays off. */
    private function cannotTakeSeat(Organization $organization, int $schoolId): ?string
    {
        $profile = AccountProfile::where('organization_id', $organization->id)->where('user_school_id', $schoolId)->first();

        if ($profile && ! in_array($profile->role, self::SEAT_ROLES, true)) {
            return 'profile_role';
        }

        if ($profile && $profile->account_status !== 'active') {
            return 'profile_inactive';
        }

        if (! User::where('school_id', $schoolId)->where('account_status', 'active')->exists()) {
            return 'account_inactive';
        }

        return null;
    }

    /**
     * @param  array<int, int>  $winnerIds
     */
    private function prepareOutgoing(Election $election, Organization $organization, ElectionPosition $position, string $title, array $winnerIds, ?Carbon $schoolYearEnd, ?string $academicYear, ?int $actor, ?string $ip): void
    {
        // A seat titled only with dashes normalises to nothing and names no incumbent.
        $seat = SboPosition::normaliseTitle($title);
        if ($seat === '') {
            return;
        }

        $holders = AccountProfile::where('organization_id', $organization->id)
            ->whereIn('role', ['ADMIN', 'SBO_OFFICER'])
            ->where('account_status', 'active')
            ->whereNotIn('user_school_id', $winnerIds)
            ->get()
            ->filter(fn (AccountProfile $profile) => $profile->position_title !== null && SboPosition::normaliseTitle($profile->position_title) === $seat);

        foreach ($holders as $profile) {
            $known = OfficerAppointment::where('election_id', $election->id)
                ->where('election_position_id', $position->id)
                ->where('user_school_id', $profile->user_school_id)
                ->exists();

            if ($known) {
                continue;
            }

            $appointment = OfficerAppointment::create([
                'organization_id' => $organization->id,
                'election_id' => $election->id,
                'election_position_id' => $position->id,
                'user_school_id' => $profile->user_school_id,
                'position_title' => $title,
                'is_executive' => (bool) $position->is_executive,
                'role' => $profile->role,
                'kind' => 'outgoing',
                'status' => 'active',
                'activation_status' => 'active',
                'academic_year' => $academicYear,
                'academic_semester_id' => $election->academic_semester_id,
                'term_ends_on' => $schoolYearEnd?->toDateString(),
                'result_final_at' => now(),
            ]);

            $this->audit($appointment, 'appointment_created', $actor, $ip, [
                'appointment_id' => $appointment->id,
                'user_school_id' => (int) $profile->user_school_id,
                'position_title' => $title,
                'role' => $profile->role,
                'kind' => 'outgoing',
                'term_ends_on' => $appointment->term_ends_on?->format('Y-m-d'),
            ]);

            if ($appointment->term_ends_on !== null) {
                $this->announceEnd($appointment);
            }
        }
    }

    /** Tells the winner the date, or that the date waits on Compliance, or that access starts now. */
    private function announceWin(Election $election, OfficerAppointment $appointment): void
    {
        $lead = 'You won '.$appointment->position_title.' in "'.$election->title.'". ';

        if ($appointment->term_starts_on === null) {
            $message = $lead.'Your officer access starts once the renewal deadline is set in Compliance.';
        } elseif ($appointment->flag === 'start_passed') {
            $message = $lead.'Your officer access starts now.';
        } else {
            $message = $lead.'Your officer access starts on '.$this->day($appointment->term_starts_on).'.';
            $soon = $appointment->term_starts_on->lte(now()->addDays(7));
            if ($soon) {
                $appointment->forceFill(['start_notice_at' => now()])->save();
            }
        }

        $this->notifyAppointee($appointment, 'You won '.$appointment->position_title, $message);
    }

    private function announceEnd(OfficerAppointment $appointment): void
    {
        $this->notifyAppointee($appointment, 'Your term end date is set', 'Your term as '.$appointment->position_title.' ends on '.$this->day($appointment->term_ends_on).'.');

        if ($appointment->term_ends_on->lte(now()->addDays(7))) {
            $appointment->forceFill(['end_notice_at' => now()])->save();
        }
    }

    /**
     * Reads Compliance and sets the start to the renewal deadline minus one calendar month. No deadline flags the
     * appointment and alerts the Admins and the dean once; a start already past is flagged and alerts once.
     */
    private function calculate(OfficerAppointment $appointment, bool $initial): void
    {
        $deadline = RenewalDeadline::for((int) $appointment->organization_id);

        if ($deadline === null) {
            if ($appointment->flag !== 'missing_deadline' || $appointment->activation_status !== 'failed') {
                $appointment->forceFill(['flag' => 'missing_deadline', 'activation_status' => 'failed', 'term_starts_on' => null])->save();
                $this->alertReviewers(
                    $appointment,
                    'No renewal deadline in Compliance',
                    'The officer start date for '.$appointment->position_title.' cannot be set because Compliance has no renewal deadline ahead. Set one so the new officers can start.',
                );
            }

            return;
        }

        $start = $deadline->copy()->subMonthNoOverflow()->toDateString();
        $changed = $appointment->term_starts_on?->format('Y-m-d') !== $start || $appointment->flag === 'missing_deadline';

        if ($changed) {
            $recovered = $appointment->flag === 'missing_deadline';
            $appointment->forceFill([
                'deadline_at' => $deadline,
                'term_starts_on' => $start,
                'last_recalculated_at' => now(),
                'flag' => $recovered ? null : $appointment->flag,
                'activation_status' => $recovered ? 'scheduled' : $appointment->activation_status,
            ])->save();

            if (! $initial) {
                $this->audit($appointment, 'appointment_recalculated', null, null, [
                    'appointment_id' => $appointment->id,
                    'deadline_at' => $deadline->toDateTimeString(),
                    'term_starts_on' => $start,
                ]);
                $this->notifyAppointee($appointment, 'Officer start date changed', 'Your officer access as '.$appointment->position_title.' now starts on '.$this->day($appointment->term_starts_on).'.');
            }
        }

        $passed = $appointment->result_final_at !== null && $start <= $appointment->result_final_at->toDateString();

        if ($passed && $appointment->flag !== 'start_passed') {
            $appointment->forceFill(['flag' => 'start_passed'])->save();
            $this->alertReviewers(
                $appointment,
                'Officer start date already passed',
                'The start date for '.$appointment->position_title.' had already passed when the results became final, so access starts at once. Check the renewal deadline in Compliance.',
            );
        } elseif (! $passed && $appointment->flag === 'start_passed') {
            $appointment->forceFill(['flag' => null])->save();
        }
    }

    /** With no school year end on record, an outgoing officer's term ends on the day the incoming term starts. */
    private function alignOutgoingWithIncoming(?int $electionId, ?array $organizationIds): void
    {
        $this->scoped(OfficerAppointment::query(), $electionId, $organizationIds)
            ->where('kind', 'outgoing')
            ->where('status', 'active')
            ->whereNotNull('election_id')
            ->get()
            ->groupBy('election_id')
            ->each(function (Collection $rows, $id) {
                $election = Election::find($id);
                if (! $election || $this->schoolYearEnd($election) !== null) {
                    return;
                }

                $start = OfficerAppointment::where('election_id', $id)->where('kind', 'incoming')->whereNotNull('term_starts_on')->min('term_starts_on');
                if ($start === null) {
                    return;
                }

                $start = Carbon::parse($start)->toDateString();
                $rows->each(function (OfficerAppointment $appointment) use ($start) {
                    if ($appointment->term_ends_on?->format('Y-m-d') === $start) {
                        return;
                    }

                    $appointment->forceFill(['term_ends_on' => $start, 'end_notice_at' => null])->save();
                    $this->announceEnd($appointment->fresh());
                });
            });
    }

    /** @return bool true when the appointment was activated here */
    private function activate(OfficerAppointment $appointment): bool
    {
        return DB::transaction(function () use ($appointment) {
            $locked = OfficerAppointment::query()->lockForUpdate()->find($appointment->id);
            if (! $locked || $locked->status !== 'upcoming') {
                return false;
            }

            $schoolId = (int) $locked->user_school_id;
            if (! User::where('school_id', $schoolId)->where('account_status', 'active')->exists()) {
                throw new \RuntimeException('The account is not active.');
            }

            $profile = AccountProfile::where('organization_id', $locked->organization_id)->where('user_school_id', $schoolId)->first();
            if ($profile && ! in_array($profile->role, self::SEAT_ROLES, true)) {
                throw new \RuntimeException('The profile holds a role that cannot take this seat.');
            }
            if ($profile && $profile->account_status !== 'active') {
                throw new \RuntimeException('The profile is not active.');
            }

            // An org head the dean granted keeps that access when they win a lower seat, unless this is the seat being replaced.
            $replaced = OfficerAppointment::where('election_id', $locked->election_id)->where('user_school_id', $schoolId)->where('kind', 'outgoing')->exists();
            $keeps = $profile && $profile->role === 'ADMIN' && $locked->role !== 'ADMIN' && ! $replaced;

            if (! $keeps) {
                $attributes = ['role' => $locked->role, 'position_title' => $locked->position_title, 'account_status' => 'active', 'modules' => null];
                if ($profile) {
                    $profile->update($attributes);
                } else {
                    AccountProfile::create(['user_school_id' => $schoolId, 'organization_id' => $locked->organization_id, ...$attributes]);
                }
            }

            $locked->forceFill(['status' => 'active', 'activation_status' => 'active', 'activated_at' => now()])->save();

            if ($locked->election_id !== null) {
                OfficerHandover::where('election_id', $locked->election_id)->where('status', 'prepared')->update(['status' => 'under_review']);
            }

            $this->audit($locked, 'appointment_activated', null, null, [
                'appointment_id' => $locked->id,
                'user_school_id' => $schoolId,
                'position_title' => $locked->position_title,
                'role' => $locked->role,
                'kept_existing_role' => $keeps,
            ]);
            $this->notifyAppointee($locked, 'You now have access to '.$this->organizationName($locked), 'You now have access to '.$this->organizationName($locked).' as '.$locked->position_title.'.');

            return true;
        });
    }

    /** Recorded and reported once; the next run retries without writing the same failure again. */
    private function recordActivationFailure(OfficerAppointment $appointment, \Throwable $exception): void
    {
        $current = $appointment->fresh();
        if (! $current || $current->activation_status === 'failed') {
            return;
        }

        $current->forceFill(['activation_status' => 'failed'])->save();
        $this->audit($current, 'appointment_activation_failed', null, null, [
            'appointment_id' => $current->id,
            'user_school_id' => (int) $current->user_school_id,
            'position_title' => $current->position_title,
            'reason' => $exception->getMessage(),
        ]);
        report($exception);
    }

    /** A former officer is still a member: the profile keeps the organization and loses only the seat. */
    private function stepDown(OfficerAppointment $ended): void
    {
        $stillServes = OfficerAppointment::where('organization_id', $ended->organization_id)
            ->where('user_school_id', $ended->user_school_id)
            ->where('status', 'active')
            ->whereKeyNot($ended->id)
            ->exists();

        $profile = AccountProfile::where('organization_id', $ended->organization_id)->where('user_school_id', $ended->user_school_id)->first();
        if ($stillServes || ! $profile || ! in_array($profile->role, ['ADMIN', 'SBO_OFFICER'], true)) {
            return;
        }

        if ($profile->position_title === null || SboPosition::normaliseTitle($profile->position_title) !== SboPosition::normaliseTitle($ended->position_title)) {
            return;
        }

        $profile->update(['role' => 'STUDENT', 'position_title' => null, 'modules' => null]);
        // The account row of a member whose home is this organization holds the title as well, and reads back when the profile has none.
        User::where('school_id', $ended->user_school_id)->where('organization_id', $ended->organization_id)->update(['position_title' => null]);
    }

    /** The end of the school year the election was held in: the latest semester end of its academic year. */
    private function schoolYearEnd(Election $election): ?Carbon
    {
        $semester = $election->academic_semester_id ? AcademicSemester::find($election->academic_semester_id) : null;
        if (! $semester) {
            return null;
        }

        $ends = collect([$semester->ends_on?->format('Y-m-d')]);
        if ($semester->academic_year_id) {
            $ends->push(AcademicSemester::where('academic_year_id', $semester->academic_year_id)->max('ends_on'));
        }

        $latest = $ends->filter()->map(fn ($date) => Carbon::parse($date)->toDateString())->max();

        return $latest ? Carbon::parse($latest, config('app.timezone')) : null;
    }

    private function academicYear(Election $election): ?string
    {
        return $election->academic_semester_id
            ? AcademicSemester::with('academicYear')->find($election->academic_semester_id)?->academicYear?->label
            : null;
    }

    private function scoped($query, ?int $electionId, ?array $organizationIds)
    {
        return $query
            ->when($electionId !== null, fn ($builder) => $builder->where('election_id', $electionId))
            ->when($organizationIds !== null, fn ($builder) => $builder->whereIn('organization_id', $organizationIds));
    }

    private function organizationName(OfficerAppointment $appointment): string
    {
        return (string) Organization::whereKey($appointment->organization_id)->value('name');
    }

    private function day($date): string
    {
        return Carbon::parse($date)->format('M j, Y');
    }

    private function notifyAppointee(OfficerAppointment $appointment, string $title, string $message): void
    {
        $this->insertNotices(
            collect([['user_school_id' => $appointment->user_school_id, 'organization_id' => $appointment->organization_id]]),
            $appointment->election_id,
            $title,
            $message,
        );
    }

    /** The organization's Admins and the college's Department Head (the SAO for a university-wide organization). */
    private function alertReviewers(OfficerAppointment $appointment, string $title, string $message): void
    {
        $organization = Organization::find($appointment->organization_id);
        if (! $organization) {
            return;
        }

        $role = $organization->approvalRole(config('approvals.routes.election'));
        $reviewers = AccountProfile::query()
            ->where('role', $role)
            ->where('account_status', 'active')
            ->whereHas('organization', function ($home) use ($role, $organization) {
                if ($role === 'SUPER_ADMIN') {
                    $home->where('organization_type', 'SYSTEM_ADMINISTRATION');
                } else {
                    $home->where('organization_type', 'COLLEGE')->where('college_id', $organization->college_id);
                }
            })
            ->get(['user_school_id', 'organization_id']);

        $this->insertNotices(
            $this->recipients->administrators($organization->id)->concat($reviewers)->unique(fn ($profile) => $profile->user_school_id.'-'.$profile->organization_id),
            $appointment->election_id,
            $title,
            $message,
        );
    }

    /** One notice per profile, written in chunks of 500. */
    private function insertNotices(Collection $profiles, ?int $electionId, string $title, string $message): void
    {
        $now = now();

        foreach ($profiles->values()->chunk(500) as $chunk) {
            Notification::insert($chunk->map(fn ($profile) => [
                'organization_id' => is_array($profile) ? $profile['organization_id'] : $profile->organization_id,
                'user_id' => is_array($profile) ? $profile['user_school_id'] : $profile->user_school_id,
                'title' => $title,
                'message' => $message,
                'notification_type' => 'general',
                'reference_type' => 'election',
                'reference_id' => $electionId,
                'is_read' => false,
                'sent_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ])->all());
        }
    }

    private function audit(OfficerAppointment $appointment, string $action, ?int $actorSchoolId, ?string $ip, array $new): void
    {
        AuditLog::create([
            'organization_id' => $appointment->organization_id,
            'user_id' => $actorSchoolId,
            'module' => 'records',
            'action' => $action,
            'record_type' => $appointment->election_id ? Election::class : OfficerAppointment::class,
            'record_id' => $appointment->election_id ?? $appointment->id,
            'old_values' => null,
            'new_values' => $new,
            'ip_address' => $ip,
            'created_at' => now(),
        ]);
    }
}
