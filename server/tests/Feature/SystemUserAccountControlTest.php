<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\Grammars\SQLiteGrammar;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SystemUserAccountControlTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_sao_deactivates_an_account_and_its_sessions_end_and_it_is_logged(): void
    {
        $sao = User::factory()->superAdmin()->create(['account_status' => 'active']);
        $staff = User::factory()->superAdmin()->create(['account_status' => 'active']);
        $staff->createToken('session');

        Sanctum::actingAs($sao);
        $this->patchJson('/api/system/users/'.$staff->school_id.'/status', ['account_status' => 'disabled'])
            ->assertOk()->assertJsonPath('user.account_status', 'disabled');

        $this->assertSame('disabled', $staff->fresh()->getRawOriginal('account_status'));
        $this->assertSame(0, $staff->tokens()->count());
        $log = AuditLog::where('action', 'user_deactivated')->where('record_id', $staff->school_id)->firstOrFail();
        $this->assertSame($sao->school_id, $log->user_id);
        $this->assertSame('system_users', $log->module);
        $this->assertSame('disabled', $log->new_values['account_status']);
    }

    public function test_the_sao_reactivates_a_disabled_account_and_it_is_logged(): void
    {
        $sao = User::factory()->superAdmin()->create(['account_status' => 'active']);
        $student = User::factory()->student()->create(['account_status' => 'disabled']);

        Sanctum::actingAs($sao);
        $this->patchJson('/api/system/users/'.$student->school_id.'/status', ['account_status' => 'active'])
            ->assertOk()->assertJsonPath('user.account_status', 'active');

        $this->assertSame('active', $student->fresh()->getRawOriginal('account_status'));
        $this->assertTrue(AuditLog::where('action', 'user_reactivated')->where('record_id', $student->school_id)->exists());
    }

    public function test_the_status_is_only_active_or_disabled_and_an_unchanged_status_is_refused(): void
    {
        $sao = User::factory()->superAdmin()->create(['account_status' => 'active']);
        $student = User::factory()->student()->create(['account_status' => 'active']);

        Sanctum::actingAs($sao);
        $this->patchJson('/api/system/users/'.$student->school_id.'/status', ['account_status' => 'banned'])->assertUnprocessable();
        $this->patchJson('/api/system/users/'.$student->school_id.'/status', [])->assertUnprocessable();
        $this->patchJson('/api/system/users/'.$student->school_id.'/status', ['account_status' => 'active'])
            ->assertUnprocessable()->assertJsonPath('message', 'This account is already active.');
        $this->assertSame(0, AuditLog::where('module', 'system_users')->whereIn('action', ['user_deactivated', 'user_reactivated'])->count());
    }

    public function test_the_sao_cannot_deactivate_their_own_account(): void
    {
        $sao = User::factory()->superAdmin()->create(['account_status' => 'active']);
        User::factory()->superAdmin()->create(['account_status' => 'active']);

        Sanctum::actingAs($sao);
        $this->patchJson('/api/system/users/'.$sao->school_id.'/status', ['account_status' => 'disabled'])
            ->assertUnprocessable()->assertJsonPath('message', 'You cannot deactivate your own account.');
        $this->assertSame('active', $sao->fresh()->getRawOriginal('account_status'));
    }

    public function test_the_last_active_sao_cannot_be_deactivated(): void
    {
        // A signed in SAO is itself active, so the only way to reach this is the acting account being switched off
        // by someone else between the sign-in check and the write. Do exactly that, inside the transaction.
        $actor = User::factory()->superAdmin()->create(['account_status' => 'active']);
        $last = User::factory()->superAdmin()->create(['account_status' => 'active']);
        $switched = false;
        DB::beforeExecuting(function () use (&$switched, $actor) {
            if (! $switched && DB::transactionLevel() > 0) {
                $switched = true;
                DB::table('users')->where('school_id', $actor->school_id)->update(['account_status' => 'disabled']);
            }
        });

        Sanctum::actingAs($actor);
        $this->patchJson('/api/system/users/'.$last->school_id.'/status', ['account_status' => 'disabled'])
            ->assertStatus(409)->assertJsonPath('message', 'The last active SAO account cannot be deactivated.');
        $this->assertTrue($switched);
        $this->assertSame('active', $last->fresh()->getRawOriginal('account_status'));
    }

    public function test_the_active_sao_rows_are_locked_before_the_last_sao_check_decides(): void
    {
        $actor = User::factory()->superAdmin()->create(['account_status' => 'active']);
        $target = User::factory()->superAdmin()->create(['account_status' => 'active']);
        $original = DB::connection()->getQueryGrammar();
        $recorder = new class(DB::connection()) extends SQLiteGrammar
        {
            public array $locked = [];

            public function compileSelect(Builder $query)
            {
                if ($query->lock) {
                    $this->locked[] = ['table' => $query->from, 'bindings' => $query->getBindings()];
                }

                return parent::compileSelect($query);
            }
        };
        DB::connection()->setQueryGrammar($recorder);

        Sanctum::actingAs($actor);
        $this->patchJson('/api/system/users/'.$target->school_id.'/status', ['account_status' => 'disabled'])->assertOk();
        DB::connection()->setQueryGrammar($original);

        $this->assertNotEmpty($recorder->locked);
        $first = $recorder->locked[0];
        $this->assertSame('users', $first['table']);
        $this->assertContains('SUPER_ADMIN', $first['bindings']);
        $this->assertContains('active', $first['bindings']);
    }

    public function test_a_sao_who_was_just_deactivated_cannot_deactivate_the_other_one_back(): void
    {
        $first = User::factory()->superAdmin()->create(['account_status' => 'active']);
        $second = User::factory()->superAdmin()->create(['account_status' => 'active']);

        Sanctum::actingAs($first);
        $this->patchJson('/api/system/users/'.$second->school_id.'/status', ['account_status' => 'disabled'])->assertOk();

        Sanctum::actingAs($second);
        $this->patchJson('/api/system/users/'.$first->school_id.'/status', ['account_status' => 'disabled'])
            ->assertForbidden();
        $this->assertSame('active', $first->fresh()->getRawOriginal('account_status'));
    }

    public function test_a_department_head_is_managed_from_colleges_not_here(): void
    {
        $sao = User::factory()->superAdmin()->create(['account_status' => 'active']);
        $head = User::factory()->create(['role' => 'DEPARTMENT_HEAD', 'account_status' => 'active']);

        Sanctum::actingAs($sao);
        $this->patchJson('/api/system/users/'.$head->school_id.'/status', ['account_status' => 'disabled'])
            ->assertUnprocessable()->assertJsonPath('message', 'A Department Head is managed from Colleges, under Manage Department Head.');
        $this->putJson('/api/system/users/'.$head->school_id, ['first_name' => 'Changed'])->assertUnprocessable();
        $this->assertSame('active', $head->fresh()->getRawOriginal('account_status'));
    }

    public function test_only_the_sao_can_change_status_or_details(): void
    {
        $admin = User::factory()->admin()->create(['account_status' => 'active']);
        $student = User::factory()->student()->create(['account_status' => 'active']);

        Sanctum::actingAs($admin);
        $this->patchJson('/api/system/users/'.$student->school_id.'/status', ['account_status' => 'disabled'])->assertForbidden();
        $this->putJson('/api/system/users/'.$student->school_id, ['first_name' => 'Changed'])->assertForbidden();
        $this->assertSame('active', $student->fresh()->getRawOriginal('account_status'));
    }

    public function test_the_sao_corrects_a_name_and_email_and_it_is_logged(): void
    {
        $sao = User::factory()->superAdmin()->create(['account_status' => 'active']);
        $student = User::factory()->student()->create(['first_name' => 'Anaa', 'last_name' => 'Cruz', 'email' => 'anaa@example.test', 'account_status' => 'active']);
        $student->createToken('session');

        Sanctum::actingAs($sao);
        $this->putJson('/api/system/users/'.$student->school_id, ['first_name' => ' Ana ', 'last_name' => 'Cruz', 'email' => ' ANA@Example.test '])
            ->assertOk()->assertJsonPath('user.first_name', 'Ana')->assertJsonPath('user.email', 'ana@example.test');

        $fresh = $student->fresh();
        $this->assertSame('Ana', $fresh->first_name);
        $this->assertSame('ana@example.test', $fresh->email);
        $this->assertSame(0, $fresh->tokens()->count(), 'A changed email ends the old sessions.');
        $log = AuditLog::where('action', 'user_updated')->where('record_id', $student->school_id)->firstOrFail();
        $this->assertSame($sao->school_id, $log->user_id);
        $this->assertSame('anaa@example.test', $log->new_values['before']['email']);
        $this->assertSame('ana@example.test', $log->new_values['after']['email']);
    }

    public function test_a_name_only_correction_keeps_the_sessions_and_an_email_in_use_is_refused(): void
    {
        $sao = User::factory()->superAdmin()->create(['account_status' => 'active']);
        $student = User::factory()->student()->create(['email' => 'one@example.test', 'account_status' => 'active']);
        User::factory()->student()->create(['email' => 'two@example.test', 'account_status' => 'active']);
        $student->createToken('session');

        Sanctum::actingAs($sao);
        $this->putJson('/api/system/users/'.$student->school_id, ['first_name' => 'Renamed'])->assertOk();
        $this->assertSame(1, $student->tokens()->count());
        $this->putJson('/api/system/users/'.$student->school_id, ['email' => 'two@example.test'])->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->putJson('/api/system/users/'.$student->school_id, ['email' => 'not-an-email'])->assertUnprocessable();
        $this->putJson('/api/system/users/'.$student->school_id, ['first_name' => ''])->assertUnprocessable();
        $this->putJson('/api/system/users/'.$student->school_id, ['password' => 'new-password-1'])
            ->assertUnprocessable()->assertJsonPath('message', 'The SAO cannot set a password. Create a reset link instead.');
        $this->assertSame('one@example.test', $student->fresh()->email);
    }

    public function test_a_disabled_student_or_officer_is_told_to_ask_their_organization_admin(): void
    {
        foreach (['student', 'officer'] as $state) {
            $user = User::factory()->{$state}()->create(['password_hash' => 'password123', 'account_status' => 'disabled']);
            $this->postJson('/api/login', ['organization_id' => $user->organization_id, 'school_id' => $user->school_id, 'password' => 'password123'])
                ->assertForbidden()->assertJsonPath('account_status', 'disabled')
                ->assertJsonPath('message', 'This account is not active. Ask your organization Admin to switch it back on.');
        }
    }

    public function test_a_disabled_admin_dean_or_sao_staff_is_told_to_ask_the_sao(): void
    {
        $users = [
            User::factory()->admin()->create(['password_hash' => 'password123', 'account_status' => 'disabled']),
            User::factory()->superAdmin()->create(['password_hash' => 'password123', 'account_status' => 'disabled']),
            User::factory()->create(['role' => 'DEPARTMENT_HEAD', 'password_hash' => 'password123', 'account_status' => 'disabled']),
        ];
        foreach ($users as $user) {
            $this->postJson('/api/login', ['organization_id' => $user->organization_id, 'school_id' => $user->school_id, 'password' => 'password123'])
                ->assertForbidden()->assertJsonPath('account_status', 'disabled')
                ->assertJsonPath('message', 'This account is not active. Ask the Student Affairs Office (SAO) to switch it back on.');
        }
    }
}
