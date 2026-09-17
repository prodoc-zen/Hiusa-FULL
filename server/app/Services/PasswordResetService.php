<?php

namespace App\Services;

use App\Mail\PasswordResetMail;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class PasswordResetService
{
    public function issue(User $user): void
    {
        $token = Str::random(64);

        DB::table('password_reset_tokens')->updateOrInsert(
            [
                'organization_id' => $user->organization_id,
                'email' => $user->email,
            ],
            [
                'token' => Hash::make($token),
                'created_at' => now(),
            ]
        );

        $frontendUrl = rtrim((string) config('app.frontend_url'), '/');
        $resetUrl = $frontendUrl.'/reset-password?'.http_build_query([
            'organization_id' => $user->organization_id,
            'email' => $user->email,
            'token' => $token,
        ]);

        Mail::to($user->email)->send(new PasswordResetMail(
            $user,
            $resetUrl,
            (int) config('auth.passwords.users.expire', 60),
        ));
    }
}
