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
        return response()->json(College::query()->withCount(['organizations'])->orderBy('name')->get());
    }

    public function store(Request $request)
    {
        $data = $this->validated($request);
        $college = College::create($data);
        $this->audit($request, $college, 'created');

        return response()->json($college, 201);
    }

    public function update(Request $request, College $college)
    {
        $data = $this->validated($request, $college);
        $previousName = $college->name;
        DB::transaction(function () use ($request, $college, $data, $previousName) {
            $college->update($data);
            if ($previousName !== $college->name) {
                $organizationIds = Organization::where('college', $previousName)->pluck('id');
                Organization::whereIn('id', $organizationIds)->update(['college' => $college->name]);
                DB::table('users')->whereIn('organization_id', $organizationIds)->where('department', $previousName)->update(['department' => $college->name]);
            }
            $this->audit($request, $college, 'updated');
        });

        return response()->json($college->fresh());
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
        if (Organization::where('college', $college->name)->exists()) {
            return response()->json(['message' => 'This college is assigned to an organization. Reassign that organization before deleting it.'], 409);
        }
        $this->audit($request, $college, 'deleted');
        $college->delete();
        $logoPath = is_string($college->logo_url) ? parse_url($college->logo_url, PHP_URL_PATH) : null;
        if (is_string($logoPath) && str_starts_with($logoPath, '/storage/')) {
            Storage::disk('public')->delete(substr($logoPath, strlen('/storage/')));
        }

        return response()->noContent();
    }

    private function validated(Request $request, ?College $college = null): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:255', Rule::unique('colleges', 'name')->ignore($college?->id)],
            'code' => ['nullable', 'string', 'max:50', Rule::unique('colleges', 'code')->ignore($college?->id)],
            'description' => ['nullable', 'string', 'max:2000'],
            'color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
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
