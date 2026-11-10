<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SeededAccountsMustChangePasswordTest extends TestCase
{
    use RefreshDatabase;

    public function test_every_seeded_account_must_change_its_password_outside_local_and_testing(): void
    {
        $this->app['env'] = 'staging';

        $this->seed(DatabaseSeeder::class);

        $this->assertGreaterThan(0, User::count());
        $this->assertSame(
            0,
            User::where('must_change_password', false)->count(),
            'Seeded accounts left without a forced password change: '
                .User::where('must_change_password', false)->pluck('school_id')->implode(', ')
        );
    }

    public function test_seeded_accounts_keep_their_demo_passwords_without_a_forced_change_in_the_testing_environment(): void
    {
        $this->seed(DatabaseSeeder::class);

        $this->assertGreaterThan(0, User::count());
        $this->assertSame(0, User::where('must_change_password', true)->count());
    }
}
