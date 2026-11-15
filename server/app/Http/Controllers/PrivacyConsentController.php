<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Records that the signed-in person agreed to the Data Privacy Notice, for accounts made before the notice existed
 * and for accounts someone else made for them. The time and version are the server's; the body only has to agree.
 */
class PrivacyConsentController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $request->validate(['privacy_accepted' => ['accepted']], [
            'privacy_accepted.accepted' => 'Read the Data Privacy Notice and tick the box to agree.',
        ]);

        $user = $request->user();

        if ($user->privacy_accepted_at === null) {
            $attributes = User::privacyConsentAttributes();

            // Guarded on the column still being empty, so a second tab cannot move the time the person first agreed.
            $changed = User::whereKey($user->school_id)->whereNull('privacy_accepted_at')->update($attributes);

            if ($changed > 0) {
                AuditLog::create([
                    'organization_id' => $user->organization_id,
                    'user_id' => $user->school_id,
                    'module' => 'users',
                    'action' => 'privacy_consent_given',
                    'record_type' => User::class,
                    'record_id' => $user->school_id,
                    'new_values' => ['privacy_notice_version' => $attributes['privacy_notice_version']],
                    'ip_address' => $request->ip(),
                    'created_at' => now(),
                ]);
            }
        }

        $stored = User::whereKey($user->school_id)->first(['privacy_accepted_at', 'privacy_notice_version']);

        return response()->json(['success' => true, 'data' => [
            'privacy_accepted_at' => $stored?->privacy_accepted_at,
            'privacy_notice_version' => $stored?->privacy_notice_version,
        ]]);
    }
}
