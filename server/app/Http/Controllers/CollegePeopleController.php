<?php

namespace App\Http\Controllers;

use App\Models\College;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use App\Support\AdviserPosition;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** The Department Head's People page: one college's students, office staff and organization leaders. */
class CollegePeopleController extends Controller
{
    private const PER_PAGE = 25;

    private const MAX_TOKENS = 4;

    private const STAFF_ROLES = ['DEPARTMENT_HEAD', 'ADMIN'];

    private const LEADER_ROLES = ['ADMIN', 'SBO_OFFICER'];

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'tab' => ['required', Rule::in(['students', 'staff', 'leaders'])],
            'q' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        [$college, $home] = $this->collegeOf($request->user());
        $term = trim((string) ($validated['q'] ?? ''));
        $perPage = (int) ($validated['per_page'] ?? self::PER_PAGE);

        $page = match ($validated['tab']) {
            'students' => $this->students($college, $term, $perPage),
            'staff' => $this->paginate($this->staff($home, $term, (int) $request->user()->school_id), $perPage),
            'leaders' => $this->paginate($this->leaders($college, $term), $perPage),
        };

        return response()->json($page)->header('Cache-Control', 'no-store, private');
    }

    /** Employee records of the dean's own college that have no account yet, for picking who to invite as office staff. Birth dates never leave the server. */
    /**
     * Employee records of this college the dean can still make a staff link from: people with no account yet, and
     * employees whose account is active, not a student's and not already on the college office. Students never appear.
     */
    public function staffRecords(Request $request): JsonResponse
    {
        $validated = $request->validate(['q' => ['nullable', 'string', 'max:100']]);

        [$college, $home] = $this->collegeOf($request->user());
        $account = fn ($user) => $user->select(DB::raw(1))->from('users')->whereColumn('users.school_id', 'student_registry.school_id');
        $profile = fn ($query) => $query->select(DB::raw(1))->from('account_profiles')->whereColumn('account_profiles.user_school_id', 'student_registry.school_id');
        $staffRoles = ['ADMIN', 'DEPARTMENT_HEAD'];
        // A place in a student organization that an adviser title does not excuse, matching isStudentAccount in the invitation controller.
        $studentOrganization = fn ($query, string $organizationColumn, string $titleColumn) => $query->select(DB::raw(1))->from('organizations')
            ->whereColumn('organizations.id', $organizationColumn)->where('organizations.organization_type', 'STUDENT_ORGANIZATION')
            ->where(fn ($title) => AdviserPosition::whereNot($title, $titleColumn));

        $available = StudentRegistryEntry::employees()
            ->where('college_id', $college->id)
            ->where(function ($eligible) use ($account, $profile, $home, $staffRoles, $studentOrganization) {
                $eligible->where(fn ($new) => $new->whereNull('claimed_at')->whereNotExists($account))
                    ->orWhere(fn ($existing) => $existing
                        ->whereExists(fn ($user) => $account($user)->where('users.account_status', 'active')->whereNotIn('users.role', ['STUDENT', 'SUPER_ADMIN'])
                            ->where(fn ($primary) => $primary->where('users.organization_id', '!=', $home->id)->orWhereNotIn('users.role', $staffRoles))
                            ->whereNotExists(fn ($organization) => $studentOrganization($organization, 'users.organization_id', 'users.position_title')))
                        ->whereNotExists(fn ($query) => $profile($query)->where('account_profiles.account_status', 'active')->where(fn ($student) => $student
                            ->whereIn('account_profiles.role', ['STUDENT', 'SBO_OFFICER'])
                            ->orWhereExists(fn ($organization) => $studentOrganization($organization, 'account_profiles.organization_id', 'account_profiles.position_title'))))
                        ->whereNotExists(fn ($query) => $profile($query)->where('account_profiles.account_status', 'active')->where('account_profiles.organization_id', $home->id)->whereIn('account_profiles.role', $staffRoles)));
            });

        $records = (clone $available)
            ->where(fn ($query) => $this->matchTokens($query, trim((string) ($validated['q'] ?? '')), false))
            ->orderBy('last_name')->orderBy('first_name')->orderBy('school_id')
            ->limit(10)
            ->get();
        $withAccount = User::whereIn('school_id', $records->pluck('school_id')->all())->pluck('school_id')->all();

        return response()->json([
            'data' => $records->map(fn (StudentRegistryEntry $record) => [
                'school_id' => $record->school_id,
                'name' => $record->full_name,
                'position' => $record->position,
                'has_account' => in_array($record->school_id, $withAccount, true),
            ])->values(),
            'has_records' => $available->exists(),
        ])->header('Cache-Control', 'no-store, private');
    }

    private function students(College $college, string $term, int $perPage): array
    {
        $organizationIds = Organization::where('college_id', $college->id)->pluck('id')->map(fn ($id) => (int) $id)->all();

        $accounts = DB::table('users')
            ->where('users.role', 'STUDENT')
            ->where(function ($query) use ($organizationIds) {
                $query->whereIn('users.organization_id', $organizationIds)
                    ->orWhereExists(fn ($profile) => $profile->select(DB::raw(1))
                        ->from('account_profiles')
                        ->whereColumn('account_profiles.user_school_id', 'users.school_id')
                        ->whereIn('account_profiles.organization_id', $organizationIds));
            })
            ->where(fn ($query) => $this->matchTokens($query, $term, true))
            ->select('users.school_id', 'users.first_name', 'users.last_name', 'users.email', 'users.program', 'users.year_level', 'users.account_status', DB::raw("'account' as source"));

        $unclaimed = DB::table('student_registry')
            ->where('student_registry.college_id', $college->id)
            ->where('student_registry.record_type', StudentRegistryEntry::STUDENT)
            ->whereNull('student_registry.claimed_at')
            ->whereNotExists(fn ($user) => $user->select(DB::raw(1))->from('users')->whereColumn('users.school_id', 'student_registry.school_id'))
            ->where(fn ($query) => $this->matchTokens($query, $term, false))
            ->select('student_registry.school_id', 'student_registry.first_name', 'student_registry.last_name', DB::raw('NULL as email'), 'student_registry.program', 'student_registry.year_level', DB::raw("'not_signed_up' as account_status"), DB::raw("'registry' as source"));

        $page = DB::query()->fromSub($accounts->unionAll($unclaimed), 'people')
            ->orderBy('last_name')
            ->orderBy('first_name')
            ->orderBy('school_id')
            ->paginate($perPage);

        $memberships = $this->memberships($page->getCollection()->where('source', 'account')->pluck('school_id')->all(), $organizationIds);

        $page->setCollection($page->getCollection()->map(fn ($row) => [
            'school_id' => (int) $row->school_id,
            'name' => trim($row->first_name.' '.$row->last_name),
            'email' => $row->email,
            'program' => $row->program,
            'year_level' => $row->year_level,
            'status' => $row->source === 'registry' ? 'not_signed_up' : ($row->account_status === 'active' ? 'signed_up' : $row->account_status),
            'organizations' => $memberships[(int) $row->school_id] ?? [],
        ]));

        return $page->toArray();
    }

    /**
     * Student organization memberships for a page of students, from their active profiles (every
     * account has one for the organization it sits on).
     *
     * @param  array<int, int|string>  $schoolIds
     * @param  array<int, int>  $collegeOrganizationIds
     * @return array<int, array<int, array{id: int, name: string, position_title: ?string}>>
     */
    private function memberships(array $schoolIds, array $collegeOrganizationIds): array
    {
        if ($schoolIds === []) {
            return [];
        }

        $organizations = Organization::student()->whereIn('id', $collegeOrganizationIds)->pluck('name', 'id');
        $result = [];

        DB::table('account_profiles')
            ->whereIn('user_school_id', $schoolIds)
            ->whereIn('organization_id', $organizations->keys())
            ->where('account_status', 'active')
            ->orderBy('id')
            ->get(['user_school_id', 'organization_id', 'position_title'])
            ->each(function ($profile) use (&$result, $organizations) {
                $result[(int) $profile->user_school_id][(int) $profile->organization_id] = [
                    'id' => (int) $profile->organization_id,
                    'name' => $organizations[$profile->organization_id],
                    'position_title' => $profile->position_title,
                ];
            });

        return array_map('array_values', $result);
    }

    private function staff(Organization $home, string $term, int $viewerSchoolId): Collection
    {
        return DB::table('account_profiles')
            ->join('users', 'users.school_id', '=', 'account_profiles.user_school_id')
            ->where('account_profiles.organization_id', $home->id)
            ->whereIn('account_profiles.role', self::STAFF_ROLES)
            ->where('account_profiles.account_status', 'active')
            ->where('users.account_status', 'active')
            ->where(fn ($query) => $this->matchTokens($query, $term, true))
            ->get(['users.school_id', 'users.first_name', 'users.last_name', 'users.email', 'account_profiles.role', 'account_profiles.position_title'])
            ->map(fn ($row) => [
                'school_id' => (int) $row->school_id,
                'name' => trim($row->first_name.' '.$row->last_name),
                'email' => $row->email,
                'role' => $row->role,
                'position_title' => $row->position_title ?? ($row->role === 'DEPARTMENT_HEAD' ? 'Department Head / Dean' : 'College Secretary'),
                'is_lead_head' => $row->role === 'DEPARTMENT_HEAD',
                'is_you' => (int) $row->school_id === $viewerSchoolId,
            ])
            ->sortBy([
                fn ($a, $b) => $b['is_lead_head'] <=> $a['is_lead_head'],
                fn ($a, $b) => strcasecmp($a['name'], $b['name']),
            ])
            ->values();
    }

    private function leaders(College $college, string $term): Collection
    {
        $organizations = Organization::student()->where('college_id', $college->id)->pluck('name', 'id');
        $leaders = DB::table('account_profiles')
            ->join('users', 'users.school_id', '=', 'account_profiles.user_school_id')
            ->whereIn('account_profiles.organization_id', $organizations->keys())
            ->whereIn('account_profiles.role', self::LEADER_ROLES)
            ->where('account_profiles.account_status', 'active')
            ->where('users.account_status', 'active')
            ->get(['users.school_id', 'users.first_name', 'users.last_name', 'users.email', 'account_profiles.organization_id', 'account_profiles.role', 'account_profiles.position_title'])
            ->map(fn ($row) => $this->leader($row, $organizations));

        $needle = mb_strtolower($term);

        return $leaders
            ->when($needle !== '', fn (Collection $all) => $all->filter(function ($leader) use ($needle) {
                $haystack = mb_strtolower(implode(' ', [$leader['name'], $leader['email'], $leader['school_id'], $leader['organization']['name'], $leader['position_title']]));

                return collect(preg_split('/[\s,]+/', $needle, -1, PREG_SPLIT_NO_EMPTY))
                    ->take(self::MAX_TOKENS)
                    ->every(fn ($token) => str_contains($haystack, $token));
            }))
            ->sortBy([
                fn ($a, $b) => strcasecmp($a['organization']['name'], $b['organization']['name']),
                fn ($a, $b) => ($a['role'] === 'ADMIN' ? 0 : 1) <=> ($b['role'] === 'ADMIN' ? 0 : 1),
                fn ($a, $b) => strcasecmp($a['name'], $b['name']),
            ])
            ->values();
    }

    private function leader(object $row, Collection $organizations): array
    {
        return [
            'school_id' => (int) $row->school_id,
            'name' => trim($row->first_name.' '.$row->last_name),
            'email' => $row->email,
            'role' => $row->role,
            'position_title' => $row->position_title,
            'organization' => ['id' => (int) $row->organization_id, 'name' => $organizations[$row->organization_id]],
        ];
    }

    private function paginate(Collection $items, int $perPage): array
    {
        $page = LengthAwarePaginator::resolveCurrentPage();

        return (new LengthAwarePaginator($items->forPage($page, $perPage)->values(), $items->count(), $perPage, $page))->toArray();
    }

    /** Name, email (when the source has one) and school ID digits, every typed word must match somewhere. */
    private function matchTokens($query, string $term, bool $hasEmail): void
    {
        $table = $hasEmail ? 'users' : 'student_registry';
        $tokens = array_slice(preg_split('/[\s,]+/', $term, -1, PREG_SPLIT_NO_EMPTY) ?: [], 0, self::MAX_TOKENS);

        foreach ($tokens as $token) {
            $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower($token)).'%';

            $query->where(function ($any) use ($like, $token, $table, $hasEmail) {
                $any->whereRaw("LOWER({$table}.first_name) LIKE ? ESCAPE '!'", [$like])
                    ->orWhereRaw("LOWER({$table}.last_name) LIKE ? ESCAPE '!'", [$like]);

                if ($hasEmail) {
                    $any->orWhereRaw("LOWER({$table}.email) LIKE ? ESCAPE '!'", [$like]);
                }

                if (ctype_digit($token)) {
                    $any->orWhereRaw("CAST({$table}.school_id AS CHAR) LIKE ? ESCAPE '!'", [$like]);
                }
            });
        }
    }

    /** @return array{0: College, 1: Organization} */
    private function collegeOf(User $user): array
    {
        $home = Organization::whereKey($user->organization_id)->first();
        $college = $home && $home->organization_type === 'COLLEGE' && $home->college_id ? College::find($home->college_id) : null;
        abort_if(! $college, 403, 'Your account is not assigned to a college.');

        return [$college, $home];
    }
}
