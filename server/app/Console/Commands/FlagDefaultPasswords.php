<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\DefaultPasswords;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Throwable;

class FlagDefaultPasswords extends Command
{
    protected $signature = 'users:flag-default-passwords {--dry-run : Report how many accounts would be flagged without writing} {--never-signed-in : Also flag accounts that have never held a sign-in token}';

    protected $description = 'Require a password change for accounts still using a known default password';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $neverSignedIn = (bool) $this->option('never-signed-in');
        $tokenType = (new User)->getMorphClass();
        $checked = 0;
        $flagged = 0;

        User::query()->where('must_change_password', false)->chunkById(100, function ($users) use ($dryRun, $neverSignedIn, $tokenType, &$checked, &$flagged) {
            $withTokens = $neverSignedIn
                ? DB::table('personal_access_tokens')->where('tokenable_type', $tokenType)->whereIn('tokenable_id', $users->modelKeys())->distinct()->pluck('tokenable_id')->flip()
                : collect();
            $ids = [];
            foreach ($users as $user) {
                $checked++;
                if (($neverSignedIn && ! $withTokens->has($user->school_id)) || $this->usesDefault($user)) {
                    $ids[] = $user->school_id;
                }
            }
            $flagged += count($ids);
            if (! $dryRun && $ids) {
                User::whereIn('school_id', $ids)->update(['must_change_password' => true]);
            }
        }, 'school_id');

        $this->info("Checked {$checked} account(s) not yet flagged.");
        $this->info("Flagged {$flagged} account(s).");
        if ($dryRun) {
            $this->line('Dry run: nothing was written.');
        }

        return Command::SUCCESS;
    }

    private function usesDefault(User $user): bool
    {
        foreach (DefaultPasswords::for($user->school_id) as $candidate) {
            try {
                if (Hash::check($candidate, $user->password_hash)) {
                    return true;
                }
            } catch (Throwable) {
                return false;
            }
        }

        return false;
    }
}
