<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The two server commands a school's IT person uses when no SAO can sign in: one makes the first SAO account on a
 * new install, the other hands a forgotten password back. Neither needs the database edited by hand.
 */
class SaoAccountCommandsTest extends TestCase
{
    use RefreshDatabase;

    private Organization $home;

    private string $lastOutput = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->home = Organization::where('organization_type', 'SYSTEM_ADMINISTRATION')->orderBy('id')->first()
            ?? Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
    }

    private function createSao(array $options = []): int
    {
        return Artisan::call('hiusa:create-sao', [
            'school_id' => '100200',
            '--first-name' => 'Maria',
            '--last-name' => 'Santos',
            '--email' => 'maria.santos@school.test',
            ...$options,
        ]);
    }

    private function printedPassword(): string
    {
        $this->lastOutput = Artisan::output();
        $this->assertSame(1, preg_match('/^Password: (\S+)/m', $this->lastOutput, $matches), 'The password is printed on its own line.');

        return $matches[1];
    }

    public function test_it_makes_the_first_sao_with_a_random_password_that_must_be_changed(): void
    {
        $this->assertSame(0, User::where('role', 'SUPER_ADMIN')->count());

        $this->assertSame(0, $this->createSao());

        $user = User::findOrFail(100200);
        $this->assertSame('SUPER_ADMIN', $user->getRawOriginal('role'));
        $this->assertSame('active', $user->getRawOriginal('account_status'));
        $this->assertTrue((bool) $user->must_change_password);
        $this->assertSame($this->home->id, $user->organization_id);
        $this->assertSame(['Maria', 'Santos', 'maria.santos@school.test'], [$user->first_name, $user->last_name, $user->email]);
        $this->assertSame(1, AccountProfile::where('user_school_id', 100200)->where('role', 'SUPER_ADMIN')->where('account_status', 'active')->count());

        $password = $this->printedPassword();
        $this->assertGreaterThanOrEqual(12, strlen($password));
        $this->assertTrue(Hash::check($password, $user->password_hash));
        $this->assertSame(1, substr_count($this->lastOutput, $password), 'The password is shown once.');
        $this->assertNotSame('Admin@123456', $password);
    }

    public function test_it_signs_in_with_the_printed_password_and_asks_for_a_new_one(): void
    {
        $this->createSao();
        $password = $this->printedPassword();

        $this->postJson('/api/login', ['school_id' => 100200, 'password' => $password])
            ->assertOk()
            ->assertJsonPath('user.must_change_password', true);
    }

    public function test_two_runs_print_two_different_passwords(): void
    {
        $this->createSao();
        $first = $this->printedPassword();
        User::query()->delete();
        $this->createSao();

        $this->assertNotSame($first, $this->printedPassword());
    }

    public function test_it_writes_an_audit_row_without_the_password(): void
    {
        $this->createSao();
        $password = $this->printedPassword();

        $row = AuditLog::where('action', 'sao_account_created_from_server')->first();
        $this->assertNotNull($row);
        $this->assertSame($this->home->id, $row->organization_id);
        $this->assertSame(100200, (int) $row->record_id);
        $this->assertStringNotContainsString($password, json_encode($row->toArray()));
    }

    public function test_it_refuses_when_an_active_sao_already_exists(): void
    {
        User::factory()->superAdmin()->create(['organization_id' => $this->home->id, 'account_status' => 'active']);

        $this->assertSame(1, $this->createSao());

        $this->assertStringContainsString('An active SAO account already exists', Artisan::output());
        $this->assertDatabaseMissing('users', ['school_id' => 100200]);
        $this->assertSame(0, AuditLog::where('action', 'sao_account_created_from_server')->count());
    }

    public function test_it_still_works_when_the_only_sao_is_disabled(): void
    {
        User::factory()->superAdmin()->create(['organization_id' => $this->home->id, 'account_status' => 'inactive']);

        $this->assertSame(0, $this->createSao());
        $this->assertDatabaseHas('users', ['school_id' => 100200, 'role' => 'SUPER_ADMIN', 'account_status' => 'active']);
    }

    public function test_it_refuses_a_school_id_or_email_that_is_taken_or_not_valid(): void
    {
        User::factory()->student()->create(['school_id' => 100200, 'email' => 'taken@school.test']);

        $this->assertSame(1, $this->createSao());
        $this->assertStringContainsString('school ID', Artisan::output());
        $this->assertSame(1, $this->createSao(['school_id' => '100201', '--email' => 'taken@school.test']));
        $this->assertSame(1, $this->createSao(['school_id' => '100201', '--email' => 'not-an-email']));
        $this->assertSame(1, $this->createSao(['school_id' => '95000001']));
        $this->assertSame(1, $this->createSao(['school_id' => 'abc']));
        $this->assertSame(1, $this->createSao(['school_id' => '100201', '--first-name' => ' ']));
        $this->assertSame(0, User::where('role', 'SUPER_ADMIN')->count());
    }

    public function test_it_asks_for_what_it_was_not_given(): void
    {
        $this->artisan('hiusa:create-sao')
            ->expectsQuestion('School ID', '100300')
            ->expectsQuestion('First name', 'Ana')
            ->expectsQuestion('Last name', 'Cruz')
            ->expectsQuestion('Email', 'ana.cruz@school.test')
            ->assertExitCode(0);

        $this->assertDatabaseHas('users', ['school_id' => 100300, 'role' => 'SUPER_ADMIN', 'email' => 'ana.cruz@school.test']);
    }

    public function test_it_stops_when_the_install_has_no_sao_organization(): void
    {
        \Illuminate\Support\Facades\DB::table('organizations')->where('organization_type', 'SYSTEM_ADMINISTRATION')->delete();

        $this->assertSame(1, $this->createSao());
        $this->assertStringContainsString('migrate', Artisan::output());
    }

    public function test_reset_hands_a_sole_sao_a_new_one_time_password_and_signs_them_out(): void
    {
        $sao = User::factory()->superAdmin()->create(['organization_id' => $this->home->id, 'account_status' => 'active', 'must_change_password' => false]);
        $sao->createToken('test');

        $this->assertSame(0, Artisan::call('hiusa:reset-sao-password', ['school_id' => (string) $sao->school_id]));

        $password = $this->printedPassword();
        $fresh = $sao->fresh();
        $this->assertTrue(Hash::check($password, $fresh->password_hash));
        $this->assertTrue((bool) $fresh->must_change_password);
        $this->assertSame(0, $fresh->tokens()->count());
        $this->assertSame(1, AuditLog::where('action', 'sao_password_reset_from_server')->where('record_id', $sao->school_id)->count());
        $this->postJson('/api/login', ['school_id' => $sao->school_id, 'password' => $password])->assertOk();
    }

    public function test_reset_only_touches_sao_accounts(): void
    {
        $student = User::factory()->student()->create(['account_status' => 'active']);
        $before = $student->password_hash;

        $this->assertSame(1, Artisan::call('hiusa:reset-sao-password', ['school_id' => (string) $student->school_id]));
        $this->assertStringContainsString('not an SAO account', Artisan::output());
        $this->assertSame(1, Artisan::call('hiusa:reset-sao-password', ['school_id' => '999999']));
        $this->assertSame($before, $student->fresh()->password_hash);
    }

    public function test_reset_works_for_a_disabled_sao_only_after_they_are_active_again(): void
    {
        $sao = User::factory()->superAdmin()->create(['organization_id' => $this->home->id, 'account_status' => 'inactive']);

        $this->assertSame(1, Artisan::call('hiusa:reset-sao-password', ['school_id' => (string) $sao->school_id]));
        $this->assertStringContainsString('not active', Artisan::output());
    }
}
