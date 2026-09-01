<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\SboPosition;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SboPositionController extends Controller
{
    public function index(Request $request)
    {
        $filters = $request->validate([
            'role' => ['nullable', 'in:ADMIN,SBO_OFFICER'],
            'active_only' => ['nullable', 'boolean'],
        ]);
        $query = SboPosition::where('organization_id', $request->user()->organization_id)
            ->orderBy('role')->orderBy('title');

        if ($request->user()->role === 'SBO_OFFICER') {
            $query->where('role', 'SBO_OFFICER');
        } elseif (! empty($filters['role'])) {
            $query->where('role', $filters['role']);
        }
        if ($request->boolean('active_only')) {
            $query->where('is_active', true);
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $request->merge(['title' => trim((string) $request->input('title'))]);
        $organizationId = $request->user()->organization_id;
        $data = $request->validate([
            'role' => ['required', 'in:ADMIN,SBO_OFFICER'],
            'title' => ['required', 'string', 'min:2', 'max:100', Rule::unique('sbo_positions', 'title')->where(fn ($query) => $query->where('organization_id', $organizationId)->where('role', $request->input('role')))],
            'description' => ['nullable', 'string', 'max:2000'],
            'is_active' => ['nullable', 'boolean'],
        ]);
        $row = SboPosition::create([...$data, 'organization_id' => $request->user()->organization_id]);
        $this->audit($request, 'created', $row, null, $row->getAttributes());

        return response()->json($row, 201);
    }

    public function update(Request $request, SboPosition $position)
    {
        abort_unless($position->organization_id === $request->user()->organization_id, 404);
        if ($request->has('title')) {
            $request->merge(['title' => trim((string) $request->input('title'))]);
        }
        $old = $position->getAttributes();
        $organizationId = $request->user()->organization_id;
        $role = $request->input('role', $position->role);
        $data = $request->validate([
            'role' => ['sometimes', 'required', 'in:ADMIN,SBO_OFFICER'],
            'title' => ['sometimes', 'required', 'string', 'min:2', 'max:100', Rule::unique('sbo_positions', 'title')->where(fn ($query) => $query->where('organization_id', $organizationId)->where('role', $role))->ignore($position->id)],
            'description' => ['nullable', 'string', 'max:2000'],
            'is_active' => ['nullable', 'boolean'],
        ]);
        DB::transaction(function () use ($position, $data) {
            $oldRole = $position->role;
            $oldTitle = $position->title;
            $position->update($data);

            if ($oldRole !== $position->role || $oldTitle !== $position->title || ! $position->is_active) {
                User::where('organization_id', $position->organization_id)
                    ->where('role', $oldRole)
                    ->where('position_title', $oldTitle)
                    ->update(['position_title' => $oldRole === $position->role && $position->is_active ? $position->title : null]);
            }
        });
        $this->audit($request, 'updated', $position, $old, $position->fresh()->getAttributes());

        return response()->json($position->fresh());
    }

    public function destroy(Request $request, SboPosition $position)
    {
        abort_unless($position->organization_id === $request->user()->organization_id, 404);
        $old = $position->getAttributes();

        DB::transaction(function () use ($position) {
            User::where('organization_id', $position->organization_id)
                ->where('role', $position->role)
                ->where('position_title', $position->title)
                ->update(['position_title' => null]);
            $position->delete();
        });

        $this->audit($request, 'deleted', $position, $old, null);

        return response()->json(['message' => 'Position deleted successfully.']);
    }

    private function audit(Request $request, string $action, SboPosition $position, ?array $oldValues, ?array $newValues): void
    {
        AuditLog::create(['organization_id' => $position->organization_id, 'user_id' => $request->user()->school_id, 'module' => 'positions', 'action' => $action, 'record_type' => SboPosition::class, 'record_id' => $position->id, 'old_values' => $oldValues, 'new_values' => $newValues, 'ip_address' => $request->ip(), 'created_at' => now()]);
    }
}
