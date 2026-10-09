<?php

namespace App\Services\Dashboard;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * First-run guidance: the few steps that make HIUSA useful for each role.
 * Every step is checked off from real records, never from clicks, so the
 * list stays truthful when work happens somewhere else in the system.
 */
class SetupChecklistService
{
    public function __construct(private readonly ClientRouteAccess $routeAccess) {}

    public function forUser(User $user): ?array
    {
        $steps = array_values(array_filter(match ($user->role) {
            'SUPER_ADMIN' => $this->saoSteps(),
            'ADMIN' => $this->adminSteps($user),
            'DEPARTMENT_HEAD' => $this->departmentHeadSteps($user),
            default => $this->memberSteps($user),
        }));
        if ($steps === []) {
            return null;
        }

        return [
            'completed' => count(array_filter($steps, fn (array $step) => $step['done'])),
            'total' => count($steps),
            'steps' => array_map(fn (array $step) => [
                ...$step,
                'href' => $step['done'] || $step['href'] === null ? null : $this->routeAccess->hrefFor($user->role, $step['href']),
            ], $steps),
        ];
    }

    private function saoSteps(): array
    {
        $organizationIds = DB::table('organizations')->where('organization_type', 'STUDENT_ORGANIZATION')->where('is_active', true)->pluck('id');
        $withAdmin = DB::table('users')->whereIn('organization_id', $organizationIds)->where('role', 'ADMIN')->where('account_status', 'active')->distinct()->count('organization_id');
        $saoId = DB::table('organizations')->where('organization_type', 'SYSTEM_ADMINISTRATION')->value('id');
        $colleges = DB::table('colleges')->where('is_active', true);
        $collegesWithHead = (clone $colleges)->whereExists(fn ($query) => $query->selectRaw('1')->from('organizations')
            ->join('account_profiles', 'account_profiles.organization_id', '=', 'organizations.id')
            ->whereColumn('organizations.college_id', 'colleges.id')
            ->where('organizations.organization_type', 'COLLEGE')
            ->where('account_profiles.role', 'DEPARTMENT_HEAD')
            ->where('account_profiles.account_status', 'active'))->count();
        $collegeCount = $colleges->count();

        return [
            $this->step('academic-year', 'Set the current academic year', 'Accreditation, requirements and clearances all follow it.', DB::table('academic_years')->where('is_current', true)->exists(), '/dashboard/super-admin/academic-years'),
            $this->step(
                'college-heads',
                'Every college has a Department Head',
                $collegeCount === 0 ? 'Add the colleges first.' : "{$collegesWithHead} of {$collegeCount} colleges have an active Department Head.",
                $collegeCount > 0 && $collegesWithHead >= $collegeCount,
                '/dashboard/super-admin/colleges',
            ),
            $this->step(
                'admins',
                'Give every organization an administrator',
                $organizationIds->isEmpty() ? 'Register an organization first.' : "{$withAdmin} of {$organizationIds->count()} organizations have an active administrator.",
                $organizationIds->isNotEmpty() && $withAdmin >= $organizationIds->count(),
                '/dashboard/super-admin/admins',
            ),
            $this->step('requirements', 'Publish the accreditation requirements', 'Organizations then see what to submit and by when.', DB::table('compliance_requirement_types')->exists(), '/dashboard/super-admin/compliance'),
            $this->step('venues', 'List the venues organizations can book', 'Bookings are checked against each other for conflicts.', DB::table('venues')->exists(), '/dashboard/super-admin/venues'),
            $this->step(
                'announcement',
                'Publish a university announcement',
                'Reaches every organization at once.',
                $saoId !== null && DB::table('announcements')->where('organization_id', $saoId)->where('is_published', true)->exists(),
                '/dashboard/super-admin/announcements',
            ),
        ];
    }

    private function adminSteps(User $user): array
    {
        $organizationId = (int) $user->organization_id;
        $scoped = fn (string $table) => DB::table($table)->where('organization_id', $organizationId);

        return [
            $this->step('positions', 'Set up your officer positions', 'Positions decide task delegation and who reviews what.', $scoped('sbo_positions')->where('is_active', true)->exists(), '/dashboard/admin/positions'),
            $this->step('members', 'Add your members', 'Import a roster from a CSV file, or add people one at a time.', $scoped('users')->where('role', 'STUDENT')->exists(), '/dashboard/admin/users'),
            $this->step('academic', 'Set up programs and sections', 'Lets you filter members and target announcements by section.', $scoped('academic_programs')->exists(), '/dashboard/admin/programs-sections'),
            DB::table('compliance_requirement_types')->exists()
                ? $this->step('compliance', 'Submit your accreditation requirements', 'The Student Affairs Office reviews them for your accreditation.', $scoped('organization_compliance_submissions')->exists(), '/dashboard/compliance')
                : null,
            $this->step('budget', 'Propose your first budget', 'Approved budgets become the money your dashboard tracks.', $scoped('budgets')->exists(), '/dashboard/finance/budget-allocation'),
            $this->step('event', 'Plan your first event', 'The AI planner drafts the tasks and suggests who should take each one.', $scoped('events')->exists(), '/dashboard/events/manage-events'),
        ];
    }

    private function departmentHeadSteps(User $user): array
    {
        $byStatus = DB::table('organizations')->whereIn('id', $user->scopedOrganizationIds())
            ->selectRaw('lifecycle_status, COUNT(*) as total')->groupBy('lifecycle_status')->pluck('total', 'lifecycle_status');
        $total = (int) $byStatus->sum();
        $returned = (int) ($byStatus['returned'] ?? 0);
        $pending = (int) ($byStatus['pending'] ?? 0);
        $active = (int) ($byStatus['active'] ?? 0);
        $semesterOpen = DB::table('academic_semesters')->where('status', 'active')->exists();

        $followHref = match (true) {
            $returned > 0 => '/dashboard/department-head/organizations?status=returned',
            $pending > 0 => '/dashboard/department-head/organizations?status=pending',
            default => null,
        };

        return [
            $this->step(
                'register',
                'Register your first student organization',
                'Each organization you register goes to the Student Affairs Office for review.',
                $total > 0,
                '/dashboard/department-head/organizations',
                $semesterOpen ? null : 'Waiting for the SAO to open the semester',
            ),
            $this->step(
                'follow',
                'Follow your registration',
                match (true) {
                    $total === 0 => 'Register an organization first.',
                    $returned > 0 => "{$returned} returned by the SAO: edit and resubmit.",
                    $pending > 0 => 'Waiting for SAO review.',
                    default => 'Your organizations are active.',
                },
                $returned === 0 && $pending === 0 && $active > 0,
                $followHref,
            ),
            $this->step(
                'review',
                'Review approvals',
                'Events, budgets and reports from your organizations wait for your decision.',
                DB::table('approval_requests')->where('reviewed_by', $user->school_id)->exists(),
                '/dashboard/department-head/approvals',
            ),
        ];
    }

    private function memberSteps(User $user): array
    {
        $fingerprintEnrolled = DB::table('fingerprints')->where('organization_id', $user->organization_id)->where('user_id', $user->school_id)->exists();

        return [
            $this->step('contact', 'Add your contact number', 'Officers can reach you about events, orders and clearances.', filled($user->contact_number), '/dashboard/profile'),
            in_array($user->role, ['STUDENT', 'SBO_OFFICER'], true)
                ? $this->step('fingerprint', 'Enroll your fingerprint', 'Visit your SBO officers once; checking in at events then takes a second.', $fingerprintEnrolled, null)
                : null,
            $user->role === 'STUDENT'
                ? $this->step('event', 'Register for an upcoming event', 'Reserve your spot so organizers can plan for you.', DB::table('event_registrations')->where('user_id', $user->school_id)->exists(), '/dashboard/events/activity-calendar')
                : null,
        ];
    }

    /**
     * A step that cannot be acted on yet carries `blocked` and a `note`
     * saying who it is waiting for, and never a link. Once done it is never
     * shown as blocked.
     */
    private function step(string $key, string $label, string $detail, bool $done, ?string $href, ?string $blockedNote = null): array
    {
        $step = ['key' => $key, 'label' => $label, 'detail' => $detail, 'done' => $done, 'href' => $href];

        return $blockedNote !== null && ! $done ? [...$step, 'href' => null, 'blocked' => true, 'note' => $blockedNote] : $step;
    }
}
