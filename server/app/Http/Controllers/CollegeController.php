<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\College;
use App\Models\Organization;
use App\Services\OrganizationDeletionService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class CollegeController extends Controller
{
    public function index()
    {
        $heads = $this->departmentHeadsByCollege();
        $colleges = College::query()
            ->withCount(['organizations' => fn ($query) => $query->student()])
            ->with('homeOrganization:id,college_id,is_active')
            ->orderBy('name')
            ->get();
        $organizations = Organization::whereIn('college_id', $colleges->pluck('id'))
            ->orWhereIn('college', $colleges->pluck('name'))
            ->get(['id', 'college_id', 'college']);
        $organizationIds = $organizations->pluck('id');
        $assignedOrganizationIds = DB::table('users')->whereIn('organization_id', $organizationIds)->pluck('organization_id')
            ->merge(DB::table('account_profiles')->whereIn('organization_id', $organizationIds)->pluck('organization_id'))
            ->unique();

        return response()->json(
            $colleges->each(function (College $college) use ($heads, $organizations, $assignedOrganizationIds) {
                $college->setAttribute('home_organization_id', $college->homeOrganization?->id);
                $homeIsActive = $college->homeOrganization?->is_active;
                $college->unsetRelation('homeOrganization');
                $college->setAttribute('department_head', $heads[$college->id] ?? null);
                $hasAssignments = $organizations->contains(fn ($organization) => ((int) $organization->college_id === $college->id || $organization->college === $college->name)
                    && ($organization->id !== $college->home_organization_id || $assignedOrganizationIds->contains($organization->id)));
                $college->setAttribute('has_assignments', $hasAssignments);
                $college->setAttribute('can_receive_transfer', $college->is_active && $homeIsActive && ! $hasAssignments);
            })
        );
    }

    public function store(Request $request)
    {
        $request->merge([
            'name' => is_string($request->input('name')) ? trim($request->input('name')) : $request->input('name'),
            'code' => is_string($request->input('code')) ? (trim($request->input('code')) ?: null) : $request->input('code'),
        ]);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', Rule::unique('colleges', 'name')],
            'code' => ['nullable', 'string', 'max:50', Rule::unique('colleges', 'code')],
            'description' => ['nullable', 'string', 'max:3000'],
        ]);

        $college = DB::transaction(function () use ($request, $data) {
            $college = College::create([...$data, 'is_active' => true]);
            $name = $college->name;
            for ($suffix = 2; Organization::where('name', $name)->exists(); $suffix++) {
                $tail = ' (College'.($suffix > 2 ? ' '.$suffix : '').')';
                $name = mb_substr($college->name, 0, 255 - mb_strlen($tail)).$tail;
            }
            $base = rtrim(mb_substr(Str::slug($name), 0, 240), '-') ?: 'college';
            $slug = $base;
            for ($suffix = 2; Organization::where('slug', $slug)->exists(); $suffix++) {
                $slug = $base.'-'.$suffix;
            }
            $home = Organization::create([
                'name' => $name,
                'slug' => $slug,
                'college' => $college->name,
                'college_id' => $college->id,
                'acronym' => $college->code,
                'organization_type' => 'COLLEGE',
                'is_active' => true,
                'lifecycle_status' => 'active',
            ]);
            $this->audit($request, $college, 'created');

            return $college->setAttribute('home_organization_id', $home->id);
        });

        return response()->json($college, 201);
    }

    /** One head per college: the active one, else an inactive one (the last by School ID) so the SAO can still reactivate it. */
    private function departmentHeadsByCollege(): array
    {
        return DB::table('users')
            ->join('organizations', 'organizations.id', '=', 'users.organization_id')
            ->where('organizations.organization_type', 'COLLEGE')
            ->where('users.role', 'DEPARTMENT_HEAD')
            ->orderByRaw("case when users.account_status = 'active' then 1 else 0 end")
            ->orderBy('users.school_id')
            ->get(['organizations.college_id', 'users.school_id', 'users.first_name', 'users.last_name', 'users.email', 'users.account_status'])
            ->mapWithKeys(fn ($head) => [$head->college_id => [
                'school_id' => (int) $head->school_id,
                'name' => trim("{$head->first_name} {$head->last_name}"),
                'first_name' => $head->first_name,
                'last_name' => $head->last_name,
                'email' => $head->email,
                'account_status' => $head->account_status,
            ]])
            ->all();
    }

    public function uploadLogo(Request $request, College $college)
    {
        $request->validate(['logo' => ['required', 'image', 'mimes:jpeg,png,webp', 'max:2048']]);
        $path = $request->file('logo')->store('college-logos', 'public');
        $oldUrl = $college->logo_url;
        try {
            $college->update(['logo_url' => Storage::disk('public')->url($path)]);
            $this->audit($request, $college, 'logo_updated');
        } catch (\Throwable $error) {
            Storage::disk('public')->delete($path);
            throw $error;
        }
        $oldPath = is_string($oldUrl) ? parse_url($oldUrl, PHP_URL_PATH) : null;
        if (is_string($oldPath) && str_starts_with($oldPath, '/storage/')) {
            Storage::disk('public')->delete(substr($oldPath, strlen('/storage/')));
        }

        return response()->json($college->fresh());
    }

    public function destroy(Request $request, College $college)
    {
        if ($request->input('mode') === 'permanent') {
            $request->validate(['confirmation_name' => ['required', 'string', Rule::in([$college->name])], 'transfer_to_college_id' => ['prohibited']]);
            app(OrganizationDeletionService::class)->deleteCollege($college, $request->user(), $request->ip());

            return response()->noContent();
        }
        $request->validate(['mode' => ['sometimes', 'in:transfer']]);
        $data = $request->validate(['transfer_to_college_id' => ['nullable', 'integer', Rule::exists('colleges', 'id')->where('is_active', true)->whereNull('deleted_at')->whereNot('id', $college->id)]]);
        DB::transaction(function () use ($request, $college, $data) {
            $college = College::whereKey($college->id)->lockForUpdate()->firstOrFail();
            $target = ! empty($data['transfer_to_college_id']) ? College::whereKey($data['transfer_to_college_id'])->where('is_active', true)->lockForUpdate()->firstOrFail() : null;
            $organizationIds = Organization::where(fn ($query) => $query->where('college_id', $college->id)->orWhere('college', $college->name))->pluck('id');
            $homeId = Organization::where('college_id', $college->id)->where('organization_type', 'COLLEGE')->value('id');
            $assignedIds = $organizationIds->reject(fn ($id) => $id === $homeId)->values();
            $userIds = DB::table('users')->whereIn('organization_id', $organizationIds)->pluck('school_id')
                ->merge(DB::table('account_profiles')->whereIn('organization_id', $organizationIds)->pluck('user_school_id'))
                ->unique();
            $profileIds = DB::table('account_profiles')->whereIn('organization_id', $organizationIds)->pluck('id');
            if (($assignedIds->isNotEmpty() || $userIds->isNotEmpty() || $profileIds->isNotEmpty()) && ! $target) {
                throw ValidationException::withMessages(['transfer_to_college_id' => 'Choose an empty replacement college before deleting a college with organizations or users.']);
            }
            if ($target) {
                $targetHomeId = Organization::where('college_id', $target->id)->where('organization_type', 'COLLEGE')->where('is_active', true)->value('id');
                abort_if(! $targetHomeId || ! $this->replacementIsEmpty($target, $targetHomeId), 409, 'The replacement college must be empty and have a home organization.');
                Organization::whereIn('id', $assignedIds)->update(['college_id' => $target->id, 'college' => $target->name]);
                if ($homeId) {
                    Organization::whereIn('id', $assignedIds)->where('parent_organization_id', $homeId)->update(['parent_organization_id' => $targetHomeId]);
                    DB::table('users')->where('organization_id', $homeId)->update(['organization_id' => $targetHomeId, 'department' => $target->name]);
                    DB::table('account_profiles')->where('organization_id', $homeId)->update(['organization_id' => $targetHomeId]);
                }
                DB::table('users')->whereIn('organization_id', $assignedIds)->update(['department' => $target->name]);
            }
            DB::table('personal_access_tokens')->where(fn ($q) => $q->whereIn('account_profile_id', $profileIds)->orWhereIn('tokenable_id', $userIds))->delete();
            if ($homeId) {
                Organization::whereKey($homeId)->update(['is_active' => false]);
            }
            $college->update(['is_active' => false]);
            $this->audit($request, $college, $target ? 'deleted_and_transferred' : 'deleted_empty');
            $college->delete();
        });
        $logoPath = is_string($college->logo_url) ? parse_url($college->logo_url, PHP_URL_PATH) : null;
        if (is_string($logoPath) && str_starts_with($logoPath, '/storage/')) {
            Storage::disk('public')->delete(substr($logoPath, strlen('/storage/')));
        }

        return response()->noContent();
    }

    private function replacementIsEmpty(College $college, int $homeId): bool
    {
        return ! $this->hasAssignments($college, $homeId);
    }

    public function archive(Request $request, College $college)
    {
        return $this->setArchived($request, $college, true);
    }

    public function restore(Request $request, College $college)
    {
        return $this->setArchived($request, $college, false);
    }

    private function setArchived(Request $request, College $college, bool $archived)
    {
        DB::transaction(function () use ($request, $college, $archived) {
            $college = College::whereKey($college->id)->lockForUpdate()->firstOrFail();
            abort_if($college->is_active === ! $archived, 409, $archived ? 'This college is already archived.' : 'This college is already active.');
            $organizations = Organization::where(fn ($query) => $query->where('college_id', $college->id)->orWhere('college', $college->name))->lockForUpdate()->get();
            abort_if($organizations->contains('organization_type', 'SYSTEM_ADMINISTRATION'), 409, 'The SAO department cannot be archived.');
            abort_if(DB::table('users')->whereIn('organization_id', $organizations->pluck('id'))->where('role', 'SUPER_ADMIN')->exists()
                || DB::table('account_profiles')->whereIn('organization_id', $organizations->pluck('id'))->where('role', 'SUPER_ADMIN')->exists(), 409, 'A college containing an SAO account cannot be archived.');
            $college->update(['is_active' => ! $archived]);
            $profileIds = DB::table('account_profiles')->whereIn('organization_id', $organizations->pluck('id'))->pluck('id');
            $users = DB::table('users')->whereIn('organization_id', $organizations->pluck('id'))->pluck('school_id');
            DB::table('personal_access_tokens')->where(fn ($query) => $query->whereIn('account_profile_id', $profileIds)->orWhereIn('tokenable_id', $users))->delete();
            $this->audit($request, $college, $archived ? 'archived' : 'restored');
        });

        return response()->json($college->fresh());
    }

    private function hasAssignments(College $college, ?int $homeId): bool
    {
        $organizationIds = Organization::where(fn ($query) => $query->where('college_id', $college->id)->orWhere('college', $college->name))->pluck('id');

        return Organization::whereIn('id', $organizationIds)->when($homeId, fn ($query) => $query->whereKeyNot($homeId))->exists()
            || DB::table('users')->whereIn('organization_id', $organizationIds)->exists()
            || DB::table('account_profiles')->whereIn('organization_id', $organizationIds)->exists();
    }

    private function audit(Request $request, College $college, string $action): void
    {
        AuditLog::create([
            'organization_id' => $request->user()->organization_id,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'colleges',
            'action' => $action,
            'record_type' => College::class,
            'record_id' => $college->id,
            'new_values' => $college->toArray(),
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
