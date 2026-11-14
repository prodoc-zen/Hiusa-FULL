<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class CreateSao extends Command
{
    /** Staff numbers stay below this; the ids from here up belong to the system itself. */
    private const INTERNAL_ID_START = 95000000;

    protected $signature = 'hiusa:create-sao {school_id? : The SAO director\'s school ID} {--first-name= : First name} {--last-name= : Last name} {--email= : Email address}';

    protected $description = 'Create the first SAO account on a new install and print its one-time password';

    public function handle(): int
    {
        if (User::query()->where('role', 'SUPER_ADMIN')->where('account_status', 'active')->exists()) {
            $this->error('An active SAO account already exists. Sign in with it and add SAO staff from University users. If its password is lost, run: php artisan hiusa:reset-sao-password <school_id>');

            return Command::FAILURE;
        }

        $home = Organization::where('organization_type', 'SYSTEM_ADMINISTRATION')->orderBy('id')->first();
        if (! $home) {
            $this->error('The SAO organization was not found. Run php artisan migrate --force first.');

            return Command::FAILURE;
        }

        $input = [
            'school_id' => trim((string) ($this->argument('school_id') ?? $this->ask('School ID'))),
            'first_name' => trim((string) ($this->option('first-name') ?? $this->ask('First name'))),
            'last_name' => trim((string) ($this->option('last-name') ?? $this->ask('Last name'))),
            'email' => trim((string) ($this->option('email') ?? $this->ask('Email'))),
        ];
        $validator = Validator::make($input, [
            'school_id' => ['required', 'integer', 'min:1', 'max:'.(self::INTERNAL_ID_START - 1), 'unique:users,school_id'],
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
        ], [
            'school_id.unique' => 'That school ID already has an account.',
            'school_id.max' => 'That school ID is reserved. Use the director\'s own employee number.',
            'email.unique' => 'That email already has an account.',
        ], ['school_id' => 'school ID', 'first_name' => 'first name', 'last_name' => 'last name']);
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $message) {
                $this->error($message);
            }

            return Command::FAILURE;
        }

        // A random password nobody chose: it is shown once here and must be changed at the first sign-in.
        $password = Str::password(16, symbols: false);

        $user = DB::transaction(function () use ($home, $input, $password) {
            $user = User::create([
                'organization_id' => $home->id,
                'school_id' => (int) $input['school_id'],
                'first_name' => $input['first_name'],
                'last_name' => $input['last_name'],
                'email' => $input['email'],
                'password_hash' => $password,
                'must_change_password' => true,
                'role' => 'SUPER_ADMIN',
                'position_title' => 'SAO Director',
                'account_status' => 'active',
                'is_member' => true,
            ]);

            AuditLog::create([
                'organization_id' => $home->id, 'actor_role' => 'SUPER_ADMIN', 'module' => 'users', 'action' => 'sao_account_created_from_server',
                'record_type' => User::class, 'record_id' => $user->school_id, 'new_values' => ['school_id' => $user->school_id, 'role' => 'SUPER_ADMIN'],
                'description' => 'The first SAO account was created from the server command line.', 'created_at' => now(),
            ]);

            return $user;
        });

        $this->info("SAO account created for {$user->first_name} {$user->last_name}.");
        $this->line("School ID: {$user->school_id}");
        $this->line("Password: {$password}");
        $this->warn('Write the password down now. It is shown once, and the SAO must choose a new one at the first sign-in.');

        return Command::SUCCESS;
    }
}
