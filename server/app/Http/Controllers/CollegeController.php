<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\College;
use App\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class CollegeController extends Controller
{
    public function index()
    {
        $heads = $this->departmentHeadsByCollege();

        return response()->json(
            College::query()
                ->withCount(['organizations' => fn ($query) => $query->student()])
                ->with('homeOrganization:id,college_id')
                ->orderBy('name')
                ->get()
                ->each(function (College $college) use ($heads) {
                    $college->setAttribute('home_organization_id', $college->homeOrganization?->id);
                    $college->unsetRelation('homeOrganization');
                    $college->setAttribute('department_head', $heads[$college->id] ?? null);
                })
        );
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
        $data = $request->validate(['transfer_to_college_id' => ['nullable', 'integer', Rule::exists('colleges', 'id')->where('is_active', true)->whereNull('deleted_at')->whereNot('id', $college->id)]]);
        DB::transaction(function () use ($request, $college, $data) {
            $college = College::whereKey($college->id)->lockForUpdate()->firstOrFail();
            $target = ! empty($data['transfer_to_college_id']) ? College::whereKey($data['transfer_to_college_id'])->where('is_active', true)->lockForUpdate()->firstOrFail() : null;
            $organizationIds = Organization::where(fn ($query) => $query->where('college_id', $college->id)->orWhere('college', $college->name))->pluck('id');
            $homeId = Organization::where('college_id', $college->id)->where('organization_type', 'COLLEGE')->value('id');
            $studentIds = Organization::student()->whereIn('id', $organizationIds)->pluck('id');
            $users = DB::table('users')->whereIn('organization_id', $organizationIds);
            if ($target) {
                $targetHomeId = Organization::where('college_id', $target->id)->where('organization_type', 'COLLEGE')->value('id');
                abort_if($homeId && ! $targetHomeId, 409, 'The destination college has no home organization.');
                Organization::whereIn('id', $studentIds)->update(['college_id' => $target->id, 'college' => $target->name]);
                if ($homeId && $targetHomeId) {
                    Organization::whereIn('id', $studentIds)->where('parent_organization_id', $homeId)->update(['parent_organization_id' => $targetHomeId]);
                }
                DB::table('users')->whereIn('organization_id', $studentIds)->update(['department' => $target->name]);
                Organization::whereKey($homeId)->update(['is_active' => false]);
                $homeUsers = DB::table('users')->where('organization_id', $homeId)->pluck('school_id');
                $homeProfiles = DB::table('account_profiles')->where('organization_id', $homeId)->pluck('id');
                DB::table('users')->whereIn('school_id', $homeUsers)->update(['account_status' => 'inactive']);
                DB::table('account_profiles')->whereIn('id', $homeProfiles)->update(['account_status' => 'inactive']);
                DB::table('personal_access_tokens')->where(fn ($q) => $q->whereIn('account_profile_id', $homeProfiles)->orWhereIn('tokenable_id', $homeUsers))->delete();
            } else {
                $userIds = (clone $users)->pluck('school_id');
                $profileIds = DB::table('account_profiles')->whereIn('organization_id', $organizationIds)->pluck('id');
                Organization::whereIn('id', $organizationIds)->update(['is_active' => false]);
                $users->update(['account_status' => 'inactive']);
                DB::table('account_profiles')->whereIn('id', $profileIds)->update(['account_status' => 'inactive']);
                DB::table('personal_access_tokens')->where(fn ($q) => $q->whereIn('account_profile_id', $profileIds)->orWhereIn('tokenable_id', $userIds))->delete();
            }
            $college->update(['is_active' => false]);
            $this->audit($request, $college, $target ? 'deleted_and_transferred' : 'deleted_and_deactivated');
            $college->delete();
        });
        $logoPath = is_string($college->logo_url) ? parse_url($college->logo_url, PHP_URL_PATH) : null;
        if (is_string($logoPath) && str_starts_with($logoPath, '/storage/')) {
            Storage::disk('public')->delete(substr($logoPath, strlen('/storage/')));
        }

        return response()->noContent();
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
