<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\College;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

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
