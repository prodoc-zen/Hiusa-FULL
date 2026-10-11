<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class FlagDefaultPasswordsCommandTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
    }

    private function user(int $schoolId, string $password, array $attributes = []): User
    {
        $user = User::factory()->student()->create([
            'organization_id' => $this->organization->id,
            'school_id' => $schoolId,
            'password_hash' => $password,
            'must_change_password' => false,
            ...$attributes,
        ]);
        $user->createToken('seen');

        return $user;
    }

    public function test_flags_accounts_still_on_a_known_default_password_and_leaves_the_rest(): void
    {
        $classList = $this->user(20214321, '4321-uclm');
        $shortId = $this->user(7, '0007-uclm');
        $demo = $this->user(20210001, 'Demo@12345');
        $admin = $this->user(20210002, 'Admin@123456');
        $own = $this->user(20210003, 'a-Much-Better-One-9');
        $otherStudentsPattern = $this->user(20219999, '4321-uclm');

        $this->artisan('users:flag-default-passwords')
            ->expectsOutputToContain('Checked 6 account(s)')
            ->expectsOutputToContain('Flagged 4 account(s)')
            ->assertSuccessful();

        $this->assertFalse($own->fresh()->must_change_password);
        $this->assertTrue($classList->fresh()->must_change_password);
        $this->assertTrue($shortId->fresh()->must_change_password);
        $this->assertTrue($demo->fresh()->must_change_password);
        $this->assertTrue($admin->fresh()->must_change_password);
        $this->assertFalse($otherStudentsPattern->fresh()->must_change_password);
    }

    public function test_is_idempotent_and_never_prints_a_password_or_hash(): void
    {
        $user = $this->user(20214321, '4321-uclm');
        $hash = $user->password_hash;

        $this->artisan('users:flag-default-passwords')->assertSuccessful();
        $first = $user->fresh();
        $this->artisan('users:flag-default-passwords')
            ->expectsOutputToContain('Checked 0 account(s)')
            ->expectsOutputToContain('Flagged 0 account(s)')
            ->doesntExpectOutputToContain('4321-uclm')
            ->doesntExpectOutputToContain($hash)
            ->assertSuccessful();

        $this->assertTrue($first->must_change_password);
        $this->assertSame($hash, $user->fresh()->password_hash);
    }

    public function test_dry_run_reports_without_writing(): void
    {
        $user = $this->user(20214321, '4321-uclm');

        $this->artisan('users:flag-default-passwords', ['--dry-run' => true])
            ->expectsOutputToContain('Flagged 1 account(s)')
            ->expectsOutputToContain('Dry run')
            ->assertSuccessful();

        $this->assertFalse($user->fresh()->must_change_password);
    }

    public function test_never_signed_in_option_also_flags_accounts_with_no_token_row(): void
    {
        $neverSignedIn = $this->user(20210003, 'a-Much-Better-One-9');
        $neverSignedIn->tokens()->delete();
        $signedIn = $this->user(20210004, 'another-Own-One-7');

        $this->artisan('users:flag-default-passwords')->expectsOutputToContain('Flagged 0 account(s)')->assertSuccessful();
        $this->assertFalse($neverSignedIn->fresh()->must_change_password);

        $this->artisan('users:flag-default-passwords', ['--never-signed-in' => true])
            ->expectsOutputToContain('Flagged 1 account(s)')
            ->assertSuccessful();

        $this->assertTrue($neverSignedIn->fresh()->must_change_password);
        $this->assertFalse($signedIn->fresh()->must_change_password);
    }

    public function test_walks_every_account_across_chunks_and_survives_a_hash_it_cannot_verify(): void
    {
        foreach (range(1, 101) as $offset) {
            $this->user(30000000 + $offset, $offset === 101 ? '1-uclm' : "Own-Password-{$offset}x");
        }
        $this->user(30000500, 'placeholder');
        DB::table('users')->where('school_id', 30000500)->update(['password_hash' => 'not-a-bcrypt-hash']);

        $this->artisan('users:flag-default-passwords')
            ->expectsOutputToContain('Checked 102 account(s)')
            ->expectsOutputToContain('Flagged 0 account(s)')
            ->assertSuccessful();

    }
}
