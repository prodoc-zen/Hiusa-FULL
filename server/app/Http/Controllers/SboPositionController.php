<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\SboPosition;
use App\Models\User;
use App\Support\FilterValues;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class SboPositionController extends Controller
{
    public function index(Request $request)
    {
        $filters = $request->validate([
            'role' => ['nullable', FilterValues::rule(['nullable', 'in:ADMIN,SBO_OFFICER'])],
            'active_only' => ['nullable', 'boolean'],
        ]);
        $query = SboPosition::where('organization_id', $request->user()->organization_id)
            ->orderBy('role')->orderBy('title');

        if ($request->user()->role === 'SBO_OFFICER') {
            $query->where('role', 'SBO_OFFICER');
        } elseif (! empty($filters['role'])) {
            $query->whereIn('role', FilterValues::values($filters['role']));
        }
        if ($request->boolean('active_only')) {
            $query->where('is_active', true);
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $request->merge(['title' => trim((string) $request->input('title'))]);
        $this->rejectSaoReservedAdviserTitle($request->input('title'));
        $organizationId = $request->user()->organization_id;
        $data = $request->validate([
            'role' => ['required', 'in:ADMIN,SBO_OFFICER'],
            'title' => ['required', 'string', 'min:2', 'max:100', Rule::unique('sbo_positions', 'title')->where(fn ($query) => $query->where('organization_id', $organizationId)->where('role', $request->input('role')))],
            'description' => ['nullable', 'string', 'max:2000'],
            'is_active' => ['nullable', 'boolean'],
            'can_book_venues' => ['sometimes', 'boolean'],
        ]);
        $row = SboPosition::create([...$data, 'organization_id' => $request->user()->organization_id]);
        $this->audit($request, 'created', $row, null, $row->getAttributes());

        return response()->json($row, 201);
    }

    public function update(Request $request, SboPosition $position)
    {
        abort_unless($position->organization_id === $request->user()->organization_id, 404);
        abort_if($position->role === 'ADMIN' && $this->isSaoAdviserTitle($position->title), 403, 'This position is managed by SAO.');
        if ($request->has('title')) {
            $request->merge(['title' => trim((string) $request->input('title'))]);
            $this->rejectSaoReservedAdviserTitle($request->input('title'));
        }
        $old = $position->getAttributes();
        $organizationId = $request->user()->organization_id;
        $role = $request->input('role', $position->role);
        $data = $request->validate([
            'role' => ['sometimes', 'required', 'in:ADMIN,SBO_OFFICER'],
            'title' => ['sometimes', 'required', 'string', 'min:2', 'max:100', Rule::unique('sbo_positions', 'title')->where(fn ($query) => $query->where('organization_id', $organizationId)->where('role', $role))->ignore($position->id)],
            'description' => ['nullable', 'string', 'max:2000'],
            'is_active' => ['nullable', 'boolean'],
            'can_book_venues' => ['sometimes', 'boolean'],
        ]);
        DB::transaction(function () use ($position, $data) {
            $oldRole = $position->role;
            $oldTitle = $position->title;
            $position->update($data);

            if ($oldRole !== $position->role || $oldTitle !== $position->title || ! $position->is_active) {
                $this->retitleHolders($position->organization_id, $oldRole, $oldTitle, $oldRole === $position->role && $position->is_active ? $position->title : null);
            }
        });
        $this->audit($request, 'updated', $position, $old, $position->fresh()->getAttributes());

        return response()->json($position->fresh());
    }

    public function destroy(Request $request, SboPosition $position)
    {
        abort_unless($position->organization_id === $request->user()->organization_id, 404);
        abort_if($position->role === 'ADMIN' && $this->isSaoAdviserTitle($position->title), 403, 'This position is managed by SAO.');
        $old = $position->getAttributes();

        DB::transaction(function () use ($position) {
            $this->retitleHolders($position->organization_id, $position->role, $position->title, null);
            $position->delete();
        });

        $this->audit($request, 'deleted', $position, $old, null);

        return response()->json(['message' => 'Position deleted successfully.']);
    }

    /**
     * Everyone holding the old title under the old role takes the new one (or none), on the account row and on the organization's profile.
     * Holders are found by normalised title, the way the booking switch and the election hand-over read it.
     * The profile is what the signed-in user reads first, so leaving its title behind would keep an officer on a position that no longer exists.
     */
    private function retitleHolders(int $organizationId, string $role, string $oldTitle, ?string $newTitle): void
    {
        $wanted = SboPosition::normaliseTitle($oldTitle);
        // The raw column: a User's position_title attribute reads the active profile first.
        $holds = fn ($row) => $row->getRawOriginal('position_title') !== null && SboPosition::normaliseTitle($row->getRawOriginal('position_title')) === $wanted;

        $userIds = User::where('organization_id', $organizationId)->where('role', $role)->whereNotNull('position_title')->get(['school_id', 'position_title'])->filter($holds)->pluck('school_id');
        if ($userIds->isNotEmpty()) {
            User::whereIn('school_id', $userIds->all())->update(['position_title' => $newTitle]);
        }

        $profileIds = AccountProfile::where('organization_id', $organizationId)->where('role', $role)->whereNotNull('position_title')->get(['id', 'position_title'])->filter($holds)->pluck('id');
        if ($profileIds->isNotEmpty()) {
            AccountProfile::whereIn('id', $profileIds->all())->update(['position_title' => $newTitle]);
        }
    }

    private function audit(Request $request, string $action, SboPosition $position, ?array $oldValues, ?array $newValues): void
    {
        AuditLog::create(['organization_id' => $position->organization_id, 'user_id' => $request->user()->school_id, 'module' => 'positions', 'action' => $action, 'record_type' => SboPosition::class, 'record_id' => $position->id, 'old_values' => $oldValues, 'new_values' => $newValues, 'ip_address' => $request->ip(), 'created_at' => now()]);
    }

    private function rejectSaoReservedAdviserTitle(mixed $title): void
    {
        if ($this->isSaoAdviserTitle($title)) {
            throw ValidationException::withMessages([
                'title' => ['The Adviser position is assigned only by the Student Affairs Office.'],
            ]);
        }
    }

    private function isSaoAdviserTitle(mixed $title): bool
    {
        return in_array(strtolower(trim((string) $title)), ['adviser', 'advisor', 'organization adviser', 'organization advisor'], true);
    }
}
