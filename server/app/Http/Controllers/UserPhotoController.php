<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

class UserPhotoController extends Controller
{
    public function store(Request $request, int $id)
    {
        $organizationId = $request->user()->organization_id;
        $user = User::whereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $organizationId))
            ->findOrFail($id);
        if ($user->role === 'SUPER_ADMIN' || in_array(strtolower(trim((string) $user->position_title)), ['adviser', 'advisor', 'organization adviser', 'organization advisor'], true)) {
            return response()->json(['message' => 'This account is managed by the SAO Director.'], 403);
        }
        $request->validate(['photo' => ['required', 'image', 'mimes:jpeg,png,webp', 'max:2048']]);

        $oldPath = $user->photo_path;
        $path = $request->file('photo')->store('user-photos', 'public');
        try {
            DB::transaction(function () use ($user, $path, $organizationId, $request) {
                $user->update(['photo_path' => $path]);
                AuditLog::create([
                    'organization_id' => $organizationId, 'user_id' => $request->user()->school_id,
                    'module' => 'users', 'action' => 'photo_updated', 'record_type' => User::class,
                    'record_id' => $user->school_id, 'new_values' => ['photo_updated' => true],
                    'ip_address' => $request->ip(), 'created_at' => now(),
                ]);
            });
        } catch (Throwable $error) {
            Storage::disk('public')->delete($path);
            throw $error;
        }
        if ($oldPath) {
            Storage::disk('public')->delete($oldPath);
        }

        return response()->json(['photo_url' => $user->photo_url]);
    }
}
