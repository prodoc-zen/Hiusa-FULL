<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ResetSaoPassword extends Command
{
    protected $signature = 'hiusa:reset-sao-password {school_id : The school ID of the SAO account}';

    protected $description = 'Give an SAO account a new one-time password when nobody else can reset it';

    public function handle(): int
    {
        $user = User::find((int) $this->argument('school_id'));
        if (! $user) {
            $this->error('No account has that school ID.');

            return Command::FAILURE;
        }
        if ($user->getRawOriginal('role') !== 'SUPER_ADMIN') {
            $this->error('That is not an SAO account. Other people ask their Department Head, their organization Admin or the SAO to reset their password.');

            return Command::FAILURE;
        }
        if ($user->getRawOriginal('account_status') !== 'active') {
            $this->error('That SAO account is not active. Another SAO can activate it from University users.');

            return Command::FAILURE;
        }

        $password = Str::password(16, symbols: false);

        DB::transaction(function () use ($user, $password) {
            $user->update(['password_hash' => $password, 'must_change_password' => true]);
            $user->tokens()->delete();
            DB::table('password_reset_tokens')->where('organization_id', $user->organization_id)->where('email', $user->email)->delete();

            AuditLog::create([
                'organization_id' => $user->getRawOriginal('organization_id'), 'actor_role' => 'SUPER_ADMIN', 'module' => 'system_users', 'action' => 'sao_password_reset_from_server',
                'record_type' => User::class, 'record_id' => $user->school_id, 'new_values' => ['email' => $user->email],
                'description' => 'An SAO password was reset from the server command line.', 'created_at' => now(),
            ]);
        });

        $this->info("New password set for {$user->first_name} {$user->last_name}.");
        $this->line("School ID: {$user->school_id}");
        $this->line("Password: {$password}");
        $this->warn('Write the password down now. It is shown once, and the SAO must choose a new one at the next sign-in.');

        return Command::SUCCESS;
    }
}
