<?php

namespace App\Http\Controllers;

use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PeopleSearchController extends Controller
{
    private const LIMIT = 10;

    private const MAX_TOKENS = 4;

    private const ROLES = ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER', 'STUDENT'];

    public function search(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'q' => ['required', 'string', 'min:2', 'max:100'],
            'scope' => ['nullable', Rule::in(['college', 'organization', 'all'])],
            'organization_id' => ['nullable', 'integer', 'min:1'],
            'role' => ['nullable', Rule::in(self::ROLES)],
        ]);

        $actor = $request->user();
        [$rules, $visibleOrganizationIds] = $this->scopeFor($actor, $validated);

        $people = User::query()
            ->where('users.account_status', 'active')
            ->whereHas('accountProfiles', function ($profiles) use ($rules, $validated) {
                $profiles->where('account_profiles.account_status', 'active')
                    ->where(function ($any) use ($rules) {
                        foreach ($rules as [$organizationIds, $onlyRole]) {
                            $any->orWhere(function ($rule) use ($organizationIds, $onlyRole) {
                                if ($organizationIds !== null) {
                                    $rule->whereIn('account_profiles.organization_id', $organizationIds);
                                }
                                if ($onlyRole) {
                                    $rule->where('account_profiles.role', $onlyRole);
                                }
                            });
                        }
                    });

                if (! empty($validated['role'])) {
                    $profiles->where('account_profiles.role', $validated['role']);
                }
            })
            ->where(fn ($query) => $this->matchTokens($query, $validated['q']))
            ->with(['accountProfiles' => fn ($profiles) => $profiles->where('account_status', 'active')->with('organization:id,name,college_id,college,organization_type')])
            ->orderBy('users.last_name')
            ->orderBy('users.first_name')
            ->orderBy('users.school_id')
            ->limit(self::LIMIT)
            ->get();

        $colleges = $this->collegeNames($people);

        return response()->json([
            'data' => $people->map(fn (User $person) => $this->present($person, $colleges, $visibleOrganizationIds))->values(),
        ])->header('Cache-Control', 'no-store, private');
    }

    /**
     * Who the actor may look for. Returns profile rules (organization ids or null for everyone,
     * optionally pinned to one role) and the organizations whose memberships may be shown back
     * (null for all).
     *
     * @return array{0: array<int, array{0: ?array<int, int>, 1: ?string}>, 1: ?array<int, int>}
     */
    private function scopeFor(User $actor, array $validated): array
    {
        $scope = $validated['scope'] ?? null;
        $requested = isset($validated['organization_id']) ? (int) $validated['organization_id'] : null;
        $home = Organization::whereKey($actor->organization_id)->first(['id', 'college_id', 'organization_type']);

        if ($actor->role === 'SUPER_ADMIN') {
            return [[[$requested ? [$requested] : null, null]], null];
        }

        $collegeOrganizationIds = $home?->college_id
            ? Organization::where('college_id', $home->college_id)->pluck('id')->map(fn ($id) => (int) $id)->all()
            : [(int) $actor->organization_id];

        if ($actor->role === 'DEPARTMENT_HEAD') {
            $studentOrganizationIds = $actor->scopedOrganizationIds();

            if ($requested !== null) {
                abort_unless(in_array($requested, $collegeOrganizationIds, true), 403, 'That organization is outside your college.');

                return [[[[$requested], null]], $collegeOrganizationIds];
            }

            $organizationIds = $scope === 'organization' ? $studentOrganizationIds : $collegeOrganizationIds;

            return [[[$organizationIds, null]], $collegeOrganizationIds];
        }

        if (in_array($actor->role, ['ADMIN', 'SBO_OFFICER'], true)) {
            $own = (int) $actor->organization_id;
            abort_if($requested !== null && $requested !== $own, 403, 'You can only search your own organization.');

            $rules = [[[$own], null]];
            if (in_array($scope, ['college', 'all'], true)) {
                $rules[] = [$collegeOrganizationIds, 'STUDENT'];
            }

            return [$rules, $collegeOrganizationIds];
        }

        abort(403, 'Forbidden.');
    }

    private function matchTokens($query, string $term): void
    {
        $tokens = array_slice(preg_split('/[\s,]+/', trim($term), -1, PREG_SPLIT_NO_EMPTY) ?: [], 0, self::MAX_TOKENS);

        foreach ($tokens as $token) {
            $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower($token)).'%';

            $query->where(function ($any) use ($like, $token) {
                $any->whereRaw("LOWER(users.first_name) LIKE ? ESCAPE '!'", [$like])
                    ->orWhereRaw("LOWER(users.last_name) LIKE ? ESCAPE '!'", [$like])
                    ->orWhereRaw("LOWER(users.email) LIKE ? ESCAPE '!'", [$like]);

                if (ctype_digit($token)) {
                    $any->orWhereRaw("CAST(users.school_id AS CHAR) LIKE ? ESCAPE '!'", [$like]);
                }
            });
        }
    }

    /** @return array<int, string> */
    private function collegeNames($people): array
    {
        $ids = $people->flatMap(fn (User $person) => [
            $person->organization?->college_id,
            ...$person->accountProfiles->map(fn ($profile) => $profile->organization?->college_id),
        ])->filter()->unique()->values();

        return $ids->isEmpty() ? [] : College::withTrashed()->whereIn('id', $ids)->pluck('name', 'id')->all();
    }

    /** @param array<int, string> $colleges */
    private function present(User $person, array $colleges, ?array $visibleOrganizationIds): array
    {
        $homeOrganization = $person->organization;
        $collegeId = $homeOrganization?->college_id
            ?? $person->accountProfiles->map(fn ($profile) => $profile->organization?->college_id)->filter()->first();

        return [
            'school_id' => (int) $person->school_id,
            'name' => trim($person->first_name.' '.$person->last_name),
            'email' => $person->email,
            'role' => $person->role,
            'program' => $person->program,
            'year_level' => $person->year_level,
            'college' => $collegeId ? ($colleges[$collegeId] ?? null) : ($homeOrganization?->getRawOriginal('college')),
            'organizations' => $person->accountProfiles
                ->filter(fn ($profile) => $profile->organization?->organization_type === 'STUDENT_ORGANIZATION'
                    && ($visibleOrganizationIds === null || in_array((int) $profile->organization_id, $visibleOrganizationIds, true)))
                ->map(fn ($profile) => [
                    'id' => (int) $profile->organization_id,
                    'name' => $profile->organization->name,
                    'position_title' => $profile->position_title,
                ])->values()->all(),
        ];
    }
}
