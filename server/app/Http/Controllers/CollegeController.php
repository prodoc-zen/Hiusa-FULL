<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\College;
use App\Models\DepartmentHeadInvitation;
use App\Models\Organization;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

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
        $inUse = $this->collegesInUse($colleges);

        return response()->json(
            $colleges->each(function (College $college) use ($heads, $inUse) {
                $college->setAttribute('home_organization_id', $college->homeOrganization?->id);
                $college->unsetRelation('homeOrganization');
                $college->setAttribute('department_head', $heads[$college->id] ?? null);
                $college->setAttribute('can_delete', ! $inUse->has($college->id));
            })
        );
    }

    public function store(Request $request)
    {
        $request->merge([
            'name' => is_string($request->input('name')) ? trim($request->input('name')) : $request->input('name'),
            'code' => is_string($request->input('code')) ? (trim($request->input('code')) ?: null) : $request->input('code'),
            'color' => is_string($request->input('color')) ? (trim($request->input('color')) ?: null) : $request->input('color'),
        ]);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', Rule::unique('colleges', 'name')],
            'code' => ['nullable', 'string', 'max:50', Rule::unique('colleges', 'code')],
            'color' => ['nullable', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
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

            return $college->setAttribute('home_organization_id', $home->id)->setAttribute('can_delete', true);
        });

        return response()->json($college, 201);
    }

    /**
     * Only a college with nothing in it can go. The college row is removed for good, not soft deleted,
     * because colleges.name and colleges.code are unique and a tombstone would block adding the same
     * college again after a mistake. The audit row keeps a snapshot.
     */
    public function destroy(Request $request, College $college)
    {
        try {
            DB::transaction(function () use ($request, $college) {
                $college = College::whereKey($college->id)->lockForUpdate()->firstOrFail();
                abort_if($this->collegesInUse(collect([$college]))->has($college->id), 409, 'This college still has organizations or people. Archive it instead.');
                Organization::where('organization_type', 'COLLEGE')
                    ->where(fn ($query) => $query->where('college_id', $college->id)->orWhere('college', $college->name))
                    ->delete();
                $this->audit($request, $college, 'deleted');
                $college->forceDelete();
            });
        } catch (QueryException) {
            abort(409, 'This college still has organizations or people. Archive it instead.');
        }

        return response()->noContent();
    }

    /** College ids (as keys) that hold student organizations, any account, a pending dean or staff link, an application or a student record. */
    private function collegesInUse(Collection $colleges): Collection
    {
        if ($colleges->isEmpty()) {
            return collect();
        }
        $ids = $colleges->pluck('id');
        $idByName = $colleges->pluck('id', 'name');
        $organizations = Organization::whereIn('college_id', $ids)->orWhereIn('college', $colleges->pluck('name'))
            ->get(['id', 'college_id', 'college', 'organization_type']);
        $collegeOf = fn ($organization) => $organization->college_id ?? $idByName[$organization->college] ?? null;
        $collegeByOrganization = $organizations->mapWithKeys(fn ($organization) => [$organization->id => $collegeOf($organization)]);
        $organizationIds = $organizations->pluck('id');
        $people = DB::table('users')->select('organization_id')->whereIn('organization_id', $organizationIds)
            ->unionAll(DB::table('account_profiles')->select('organization_id')->whereIn('organization_id', $organizationIds))
            ->pluck('organization_id');
        $records = DB::table('department_head_invitations')->select('college_id')->whereIn('college_id', $ids)
            ->whereNull('accepted_at')->where('expires_at', '>', now())
            ->unionAll(DB::table('organization_applications')->select('college_id')->whereIn('college_id', $ids))
            ->unionAll(DB::table('student_registry')->select('college_id')->whereIn('college_id', $ids))
            ->pluck('college_id');

        return $organizations->toBase()->where('organization_type', '!=', 'COLLEGE')->map($collegeOf)
            ->merge($people->map(fn ($id) => $collegeByOrganization[$id]))
            ->merge($records)
            ->filter()->unique()->flip();
    }

    public function update(Request $request, College $college)
    {
        $request->merge([
            'name' => is_string($request->input('name')) ? trim($request->input('name')) : $request->input('name'),
            'code' => is_string($request->input('code')) ? (trim($request->input('code')) ?: null) : $request->input('code'),
        ]);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', Rule::unique('colleges', 'name')->ignore($college->id)],
            'code' => ['nullable', 'string', 'max:50', Rule::unique('colleges', 'code')->ignore($college->id)],
            'description' => ['nullable', 'string', 'max:3000'],
        ]);

        $updated = DB::transaction(function () use ($request, $college, $data) {
            $oldName = $college->name;
            $college->update($data);
            if ($oldName !== $college->name) {
                Organization::where('college_id', $college->id)->update(['college' => $college->name]);
            }
            if ($college->homeOrganization) {
                $college->homeOrganization->update([
                    'college' => $college->name,
                    'acronym' => $college->code,
                ]);
            }
            $this->audit($request, $college, 'updated');

            return $college->fresh();
        });

        return response()->json($updated);
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
