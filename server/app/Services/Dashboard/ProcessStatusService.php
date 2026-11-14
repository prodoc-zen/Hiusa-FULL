<?php

namespace App\Services\Dashboard;

use App\Models\AcademicSemester;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\Organization;
use App\Models\OrganizationApplicantGrant;
use App\Models\OrganizationApplication;
use App\Models\OrganizationComplianceSubmission;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * "Where am I in the flow": the handful of steps that take each role from an empty system to a working one.
 * A step is done from real records, never from clicks, and the first step that is not done is the current one.
 * Done and current steps carry the page they belong to; a step still to do carries none.
 * Every action path is gated through the role's client route allowlist, like the dashboard briefing.
 */
class ProcessStatusService
{
    private const APPLICATION_REVIEWED = ['pending_sao', 'approved', 'returned', 'rejected'];

    private const DECIDE_APPLICATIONS = ['Review applications', '/dashboard/organization-applications'];

    public function __construct(private readonly ClientRouteAccess $routeAccess) {}

    public function forUser(User $user): array
    {
        // Office staff take the dean's role, but the setup steps (staff, records, applicant grants) are the dean's own.
        if ($user->isCollegeOfficeStaff()) {
            return $this->none();
        }

        return match ($user->role) {
            'SUPER_ADMIN' => $this->sao(),
            'DEPARTMENT_HEAD' => $this->dean($user),
            'ADMIN' => $this->organizationAdmin($user),
            'STUDENT' => $this->student($user),
            default => $this->none(),
        };
    }

    private function none(): array
    {
        return ['title' => null, 'complete' => false, 'steps' => []];
    }

    /** @param array<int, array<string, mixed>> $definitions */
    private function finish(string $role, ?string $title, array $definitions): array
    {
        $currentSeen = false;
        $steps = [];
        foreach ($definitions as $definition) {
            $state = $definition['done'] ? 'done' : ($currentSeen ? 'todo' : 'current');
            $currentSeen = $currentSeen || $state === 'current';
            $step = ['key' => $definition['key'], 'label' => $definition['label'], 'state' => $state];
            foreach (['count', 'total', 'note'] as $field) {
                if (isset($definition[$field])) {
                    $step[$field] = $definition[$field];
                }
            }
            // A step still to do links nowhere; one already visited links to the page where it was done, when this role has such a page.
            // A current step someone else holds carries a `link` instead of an action: where to look while waiting, never a task for this person.
            foreach (['action', 'link'] as $field) {
                if ($state !== 'todo' && isset($definition[$field])) {
                    $path = $this->actionPath($role, $definition[$field][1], $definition[$field][2] ?? []);
                    if ($path !== null) {
                        $step[$field] = ['label' => $definition[$field][0], 'path' => $path];
                    }
                }
            }
            $steps[] = $step;
        }

        return ['title' => $title, 'complete' => $steps !== [] && ! $currentSeen, 'steps' => $steps];
    }

    /** @param array<string, int|string> $params */
    private function actionPath(string $role, string $pattern, array $params): ?string
    {
        $path = $this->routeAccess->hrefFor($role, $pattern);
        if ($path === null) {
            return null;
        }
        foreach ($params as $name => $value) {
            $path = str_replace(':'.$name, (string) $value, $path);
        }

        return $path;
    }

    private function sao(): array
    {
        $colleges = College::query()->where('is_active', true)->orderBy('name')->get(['id', 'name', 'code']);
        // The university-wide steps come first, in the order they unlock each other: nothing else works without a current year, an active semester and colleges.
        $currentYear = DB::table('academic_years')->where('is_current', true)->first(['id']);
        $calendar = [
            ['key' => 'academic-year', 'label' => 'Academic year set', 'done' => $currentYear !== null, 'action' => ['Set the academic year', '/dashboard/super-admin/academic-years']],
            ['key' => 'semester', 'label' => 'Semesters added', 'done' => $currentYear !== null && DB::table('academic_semesters')->where('academic_year_id', $currentYear->id)->exists(), 'action' => ['Add the semesters', '/dashboard/super-admin/academic-years']],
            ['key' => 'semester-active', 'label' => 'Semester activated', 'done' => DB::table('academic_semesters')->where('status', 'active')->exists(), 'action' => ['Activate a semester', '/dashboard/super-admin/academic-years']],
            ['key' => 'colleges-added', 'label' => 'Colleges added', 'done' => $colleges->isNotEmpty(), 'action' => ['Add the colleges', '/dashboard/super-admin/colleges']],
        ];
        if ($colleges->isEmpty()) {
            return $this->finish('SUPER_ADMIN', 'Setting up HIUSA', $calendar);
        }

        $invited = DB::table('department_head_invitations')->where('role', 'DEPARTMENT_HEAD')->groupBy('college_id')
            ->selectRaw('college_id, count(*) as total')->pluck('total', 'college_id');
        $deans = DB::table('account_profiles')
            ->join('organizations', 'organizations.id', '=', 'account_profiles.organization_id')
            ->join('users', 'users.school_id', '=', 'account_profiles.user_school_id')
            ->where('organizations.organization_type', 'COLLEGE')
            ->where('account_profiles.role', 'DEPARTMENT_HEAD')
            ->where('account_profiles.account_status', 'active')
            ->where('users.account_status', 'active')
            ->groupBy('organizations.college_id')->selectRaw('organizations.college_id as college_id, count(*) as total')->pluck('total', 'college_id');
        $records = DB::table('student_registry')->where('record_type', StudentRegistryEntry::STUDENT)->groupBy('college_id')->selectRaw('college_id, count(*) as total')->pluck('total', 'college_id');
        $applications = DB::table('organization_applications')->whereNotIn('status', OrganizationApplication::LEGACY_UNQUEUED)
            ->whereNotNull('college_id')->groupBy('college_id')->selectRaw('college_id, count(*) as total')->pluck('total', 'college_id');
        $active = Organization::student()->where('lifecycle_status', 'active')->whereNotNull('college_id')
            ->groupBy('college_id')->selectRaw('college_id, count(*) as total')->pluck('total', 'college_id');
        // Endorsed by the Department Head and waiting for the SAO: the next step is to decide them, not to look at the organizations.
        $endorsed = DB::table('organization_applications')->where('status', 'pending_sao')
            ->whereNotNull('college_id')->groupBy('college_id')->selectRaw('college_id, count(*) as total')->pluck('total', 'college_id');

        $rows = $colleges->map(function (College $college) use ($invited, $deans, $records, $applications, $active, $endorsed) {
            $deanCount = (int) ($deans[$college->id] ?? 0);
            $inviteCount = (int) ($invited[$college->id] ?? 0);
            $applicationCount = (int) ($applications[$college->id] ?? 0);
            $activeCount = (int) ($active[$college->id] ?? 0);
            $endorsedCount = (int) ($endorsed[$college->id] ?? 0);

            return ['college' => $college, 'definitions' => [
                ['key' => 'dean-invited', 'label' => 'Dean invited', 'done' => $inviteCount > 0 || $deanCount > 0, 'count' => $inviteCount, 'action' => ['Invite the Department Head', '/dashboard/super-admin/colleges']],
                ['key' => 'dean-active', 'label' => 'Dean active', 'done' => $deanCount > 0, 'count' => $deanCount, 'action' => ['Open colleges', '/dashboard/super-admin/colleges']],
                ['key' => 'records-loaded', 'label' => 'School records loaded', 'done' => ($records[$college->id] ?? 0) > 0, 'count' => (int) ($records[$college->id] ?? 0), 'action' => ['Load school records', '/dashboard/super-admin/student-records']],
                ['key' => 'organizations-applying', 'label' => 'Organizations applying', 'done' => $applicationCount > 0 || $activeCount > 0, 'count' => $applicationCount, 'action' => ['View applications', '/dashboard/organization-applications']],
                [
                    'key' => 'organizations-active', 'label' => 'Organizations active', 'done' => $activeCount > 0, 'count' => $activeCount,
                    'action' => $endorsedCount > 0 ? self::DECIDE_APPLICATIONS : ['View organizations', '/dashboard/super-admin/organizations'],
                    'note' => $endorsedCount > 0 ? $this->endorsedNote($endorsedCount) : null,
                ],
            ]];
        });

        $total = $rows->count();
        $endorsedTotal = (int) $endorsed->sum();
        $aggregate = [];
        foreach ($rows->first()['definitions'] as $index => $definition) {
            $finished = $rows->filter(fn (array $row) => $row['definitions'][$index]['done'])->count();
            $waiting = $definition['key'] === 'organizations-active' && $endorsedTotal > 0;
            // Requirements are published once for the whole university, after the records and before organizations can apply.
            if ($definition['key'] === 'organizations-applying') {
                $aggregate[] = ['key' => 'requirements-published', 'label' => 'Requirements published', 'done' => ComplianceRequirementType::query()->exists(), 'action' => ['Publish the requirements', '/dashboard/super-admin/compliance']];
            }
            $aggregate[] = [
                'key' => $definition['key'],
                'label' => $definition['label'],
                'done' => $finished === $total,
                'count' => $finished,
                'total' => $total,
                'action' => $waiting ? self::DECIDE_APPLICATIONS : $definition['action'],
                'note' => $waiting ? $this->endorsedNote($endorsedTotal) : null,
            ];
        }
        $summary = $this->finish('SUPER_ADMIN', 'Setting up HIUSA', [...$calendar, ...$aggregate]);
        $summary['colleges'] = $rows->map(fn (array $row) => [
            'id' => $row['college']->id,
            'name' => $row['college']->name,
            'code' => $row['college']->code,
            ...$this->finish('SUPER_ADMIN', null, $row['definitions']),
        ])->values()->all();

        return $summary;
    }

    private function endorsedNote(int $count): string
    {
        return $count === 1 ? '1 application is waiting for your decision.' : "{$count} applications are waiting for your decision.";
    }

    private function dean(User $user): array
    {
        $home = Organization::whereKey($user->organization_id)->first(['id', 'organization_type', 'college_id']);
        if (! $home || $home->organization_type !== 'COLLEGE' || ! $home->college_id) {
            return $this->none();
        }
        $collegeId = $home->college_id;

        $staff = DB::table('account_profiles')
            ->join('users', 'users.school_id', '=', 'account_profiles.user_school_id')
            ->where('account_profiles.organization_id', $home->id)->where('account_profiles.role', 'ADMIN')
            ->where('account_profiles.account_status', 'active')->where('users.account_status', 'active')->count();
        $records = DB::table('student_registry')->where('college_id', $collegeId)->where('record_type', StudentRegistryEntry::STUDENT)->count();
        $grants = OrganizationApplicantGrant::where('college_id', $collegeId)->whereNull('revoked_at')->count();
        $applications = DB::table('organization_applications')->where('college_id', $collegeId)
            ->whereNotIn('status', OrganizationApplication::LEGACY_UNQUEUED)->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $waiting = (int) ($applications['pending_dean'] ?? 0);
        $reviewed = (int) collect(self::APPLICATION_REVIEWED)->sum(fn (string $status) => $applications[$status] ?? 0);
        $active = Organization::student()->where('college_id', $collegeId)->where('lifecycle_status', 'active')->count();
        $headless = Organization::student()->where('college_id', $collegeId)->where('lifecycle_status', 'active')
            ->whereDoesntHave('accountProfiles', fn ($profiles) => $profiles->activeAdministrators())
            ->orderBy('name')->get(['id', 'name']);

        return $this->finish('DEPARTMENT_HEAD', 'Setting up your college', array_values(array_filter([
            ['key' => 'staff-added', 'label' => 'Office staff added', 'done' => $staff > 0, 'count' => $staff, 'action' => ['Add office staff', '/dashboard/department-head/people']],
            ['key' => 'records-loaded', 'label' => 'Student records loaded', 'done' => $records > 0, 'count' => $records, 'action' => ['Load student records', '/dashboard/department-head/people']],
            ['key' => 'students-allowed', 'label' => 'Students allowed to apply', 'done' => $grants > 0 || $applications->sum() > 0 || $active > 0, 'count' => $grants, 'action' => ['Allow a student to apply', '/dashboard/department-head/organizations']],
            ['key' => 'applications-reviewed', 'label' => 'Applications reviewed', 'done' => $waiting === 0 && $reviewed > 0, 'count' => $reviewed, 'total' => ($reviewed + $waiting) ?: null, 'action' => ['Review applications', '/dashboard/organization-applications']],
            ['key' => 'organizations-active', 'label' => 'Organizations active', 'done' => $active > 0, 'count' => $active, 'action' => ['Open organizations', '/dashboard/department-head/organizations']],
            $headless->isEmpty() ? null : ['key' => 'organization-head', 'label' => 'Name the organization head of '.$headless->first()->name, 'done' => false,
                'note' => $headless->count() > 1 ? ($headless->count() - 1).' more '.($headless->count() === 2 ? 'organization needs' : 'organizations need').' a head too.' : null,
                'action' => ['Give access', '/dashboard/department-head/org/:orgId?tab=people', ['orgId' => $headless->first()->id]]],
        ])));
    }

    private function organizationAdmin(User $user): array
    {
        $organization = Organization::student()->whereKey($user->organization_id)->first(['id', 'lifecycle_status', 'reviewed_at']);
        if (! $organization) {
            return $this->none();
        }

        // Access is granted as an account profile: officers, or a named head (an elected president can be given the head role). The viewer is the head already, so they never count.
        $officers = DB::table('account_profiles')
            ->join('users', 'users.school_id', '=', 'account_profiles.user_school_id')
            ->where('account_profiles.organization_id', $organization->id)->whereIn('account_profiles.role', ['SBO_OFFICER', 'ADMIN'])
            ->where('account_profiles.user_school_id', '!=', $user->school_id)
            ->where('account_profiles.account_status', 'active')->where('users.account_status', 'active')->count();

        $semester = AcademicSemester::active();
        $semesterReports = $semester ? $this->requirementProgress($organization, $semester, 'semestral_report') : null;
        $renewalDue = $semester !== null
            && $organization->lifecycle_status === 'active'
            && ($organization->reviewed_at === null || $organization->reviewed_at->lt($semester->starts_on->copy()->startOfDay()));
        $renewal = $renewalDue ? $this->requirementProgress($organization, $semester, 'renewal') : null;
        $elections = $semester ? Election::where('organization_id', $organization->id)->where('academic_semester_id', $semester->id) : null;

        return $this->finish('ADMIN', 'Setting up your organization', array_values(array_filter([
            ['key' => 'organization-approved', 'label' => 'Organization approved', 'done' => $organization->lifecycle_status === 'active'],
            ['key' => 'officers-access', 'label' => 'Officers given access', 'done' => $officers > 0, 'count' => $officers, 'action' => ['Give officers access', '/dashboard/admin/users']],
            ['key' => 'semester-requirements', 'label' => 'Semester requirements submitted', 'done' => $semesterReports !== null && $semesterReports['submitted'] >= $semesterReports['total'],
                'count' => $semesterReports['submitted'] ?? null, 'total' => $semesterReports['total'] ?? null, 'action' => ['Submit requirements', '/dashboard/compliance']],
            ($renewal['total'] ?? 0) > 0 ? ['key' => 'renewal', 'label' => 'Renewal', 'done' => $renewal['submitted'] >= $renewal['total'],
                'count' => $renewal['submitted'], 'total' => $renewal['total'], 'action' => ['Submit renewal', '/dashboard/compliance']] : null,
            ['key' => 'next-election', 'label' => 'Election of next officers', 'done' => $elections !== null && (clone $elections)->whereNotNull('access_handed_over_at')->exists(),
                'count' => $elections ? (clone $elections)->count() : null, 'action' => ['Plan the election', '/dashboard/elections/manage-elections']],
        ])));
    }

    /** @return array{submitted: int, total: int} */
    private function requirementProgress(Organization $organization, AcademicSemester $semester, string $category): array
    {
        $typeIds = ComplianceRequirementType::where('academic_year', $semester->academicYear->label)->where('is_active', true)
            ->where('category', $category)
            ->where(fn ($period) => $period->whereNull('academic_semester_id')->orWhere('academic_semester_id', $semester->id))
            ->pluck('id');

        return [
            'total' => $typeIds->count(),
            'submitted' => OrganizationComplianceSubmission::where('organization_id', $organization->id)
                ->whereIn('requirement_type_id', $typeIds)->whereIn('status', ['submitted', 'approved'])
                ->distinct()->count('requirement_type_id'),
        ];
    }

    private function student(User $user): array
    {
        $grant = OrganizationApplicantGrant::usable()->where('user_school_id', $user->school_id)->exists();
        $application = OrganizationApplication::where('school_id', $user->school_id)
            ->whereNotIn('status', OrganizationApplication::LEGACY_UNQUEUED)->latest('id')->first(['id', 'status', 'endorsed_at', 'returned_by_role']);
        if (! $grant && ! $application) {
            return $this->none();
        }

        $status = $grant ? null : $application->status;
        $current = match ($status) {
            'pending_dean' => 2,
            'pending_sao' => 3,
            'approved' => 5,
            'rejected' => $application->endorsed_at ? 3 : 2,
            default => 1,
        };
        $note = match ($status) {
            'returned' => ($application->returned_by_role === 'SUPER_ADMIN' ? 'Returned by SAO' : 'Returned by your Department Head').'. Update it and send it again.',
            'rejected' => 'Not approved. Open the application for the reason.',
            default => null,
        };
        $action = match (true) {
            $current === 1 && $status === 'returned' => ['Update and send again', '/dashboard/student/organization-applications/:applicationId', ['applicationId' => $application->id]],
            $current === 1 => ['Apply for an organization', '/dashboard/student/apply-organization'],
            default => null,
        };
        // The Dean and the SAO hold their review steps, so the student gets no action there, only the place to look.
        $link = $current > 1 && $current < 5 ? ['Open your application', '/dashboard/student/organization-applications/:applicationId', ['applicationId' => $application->id]] : null;

        $definitions = [];
        foreach (['Allowed to apply', 'Application sent', 'Dean review', 'SAO review', 'Approved'] as $index => $label) {
            $definition = ['key' => str($label)->slug()->value(), 'label' => $label, 'done' => $index < $current];
            if ($index === $current) {
                $definition['note'] = $note;
                $definition['action'] = $action;
                $definition['link'] = $link;
            }
            if ($index >= 1 && $index < $current && $application) {
                $definition['action'] = ['Open your application', '/dashboard/student/organization-applications/:applicationId', ['applicationId' => $application->id]];
            }
            $definitions[] = array_filter($definition, fn ($value) => $value !== null);
        }

        return $this->finish('STUDENT', 'Your organization application', $definitions);
    }
}
