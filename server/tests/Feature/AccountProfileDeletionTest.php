<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AccountProfileDeletionTest extends TestCase
{
    use RefreshDatabase;

    private function setupMembers(): array
    {
        $main = Organization::factory()->create();
        $child = Organization::factory()->create(['parent_organization_id' => $main->id, 'college' => $main->college]);
        $admin = User::factory()->admin()->create(['organization_id' => $main->id]);
        $user = User::factory()->student()->create(['organization_id' => $main->id]);
        $extra = $user->accountProfiles()->create(['organization_id' => $child->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active']);
        Sanctum::actingAs($admin);

        return [$main, $child, $admin, $user, $extra];
    }

    public function test_secondary_then_final_deletion_removes_only_the_selected_profile_until_the_user_is_empty(): void
    {
        [$main, , , $user, $extra] = $this->setupMembers();
        $primary = $user->accountProfiles()->where('organization_id', $main->id)->firstOrFail();
        $retained = $user->createToken('primary')->accessToken;
        $retained->forceFill(['account_profile_id' => $primary->id])->save();
        $revoked = $user->createToken('secondary')->accessToken;
        $revoked->forceFill(['account_profile_id' => $extra->id])->save();
        $this->deleteJson('/api/account-profiles/'.$extra->id)->assertOk()->assertJsonPath('account_deleted', false)->assertJsonPath('remaining_profiles', 1);
        $this->assertDatabaseHas('users', ['school_id' => $user->school_id, 'organization_id' => $main->id, 'role' => 'STUDENT']);
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $retained->id]);
        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $revoked->id]);
        $this->deleteJson('/api/account-profiles/'.$primary->id)->assertOk()->assertJsonPath('account_deleted', true)->assertJsonPath('remaining_profiles', 0);
        $this->assertDatabaseMissing('users', ['school_id' => $user->school_id]);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $user->school_id]);
        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $retained->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'account_profile_deleted', 'record_id' => $primary->id]);
        $this->deleteJson('/api/account-profiles/'.$primary->id)->assertNotFound();
    }

    public function test_primary_deletion_promotes_a_surviving_profile_and_revokes_legacy_tokens(): void
    {
        [$main, $child, , $user, $extra] = $this->setupMembers();
        $hash = $user->password_hash;
        $legacy = $user->createToken('legacy')->accessToken;
        $secondary = $user->createToken('secondary')->accessToken;
        $secondary->forceFill(['account_profile_id' => $extra->id])->save();
        $primary = $user->accountProfiles()->where('organization_id', $main->id)->firstOrFail();
        $this->deleteJson('/api/account-profiles/'.$primary->id)->assertOk()->assertJsonPath('account_deleted', false);
        $this->assertDatabaseHas('users', ['school_id' => $user->school_id, 'organization_id' => $child->id, 'role' => 'SBO_OFFICER', 'password_hash' => $hash]);
        $this->assertDatabaseHas('account_profiles', ['id' => $extra->id, 'role' => 'SBO_OFFICER']);
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $secondary->id]);
        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $legacy->id]);
    }

    public function test_financial_records_block_final_deletion_and_roll_back_tokens_and_profile(): void
    {
        [, , , $user, $extra] = $this->setupMembers();
        $record = Transaction::factory()->create(['recorded_by' => $user->school_id]);
        $this->deleteJson('/api/account-profiles/'.$extra->id)->assertOk();
        $profile = $user->accountProfiles()->firstOrFail();
        $token = $user->createToken('retained')->accessToken;
        $this->deleteJson('/api/account-profiles/'.$profile->id)->assertStatus(409);
        $this->assertDatabaseHas('users', ['school_id' => $user->school_id]);
        $this->assertDatabaseHas('account_profiles', ['id' => $profile->id]);
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $token->id]);
        $this->assertDatabaseHas('transactions', ['id' => $record->id, 'recorded_by' => $user->school_id]);
    }

    public function test_operational_history_is_not_silently_cascaded_by_final_deletion(): void
    {
        [, , , $user, $extra] = $this->setupMembers();
        $task = Task::factory()->create(['created_by' => $user->school_id]);
        $this->deleteJson('/api/account-profiles/'.$extra->id)->assertOk();
        $this->deleteJson('/api/account-profiles/'.$user->accountProfiles()->firstOrFail()->id)->assertStatus(409);
        $this->assertDatabaseHas('tasks', ['id' => $task->id]);
        $this->assertDatabaseHas('users', ['school_id' => $user->school_id]);
    }

    public function test_profile_list_search_is_scoped_and_has_no_sensitive_fields(): void
    {
        [$main, $child, , $user] = $this->setupMembers();
        $foreign = User::factory()->student()->create(['organization_id' => Organization::factory()->create(['college' => 'Other'])->id]);
        $response = $this->getJson('/api/account-profiles?search='.$user->school_id.'&per_page=1')->assertOk()->assertJsonPath('total', 2)->assertJsonPath('data.0.profiles_count', 2);
        $this->assertArrayNotHasKey('password_hash', $response->json('data.0'));
        $this->getJson('/api/account-profiles?organization_id='.$child->id)->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/account-profiles?organization_id='.$foreign->organization_id)->assertNotFound();
        $this->getJson('/api/account-profiles?user_school_id='.$foreign->school_id)->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/account-profiles?per_page=51')->assertUnprocessable();
        $this->deleteJson('/api/account-profiles/'.$foreign->accountProfiles()->firstOrFail()->id)->assertNotFound();
        $this->assertSame($main->id, $user->organization_id);
    }

    public function test_organization_filter_does_not_add_a_mysql_unsupported_limit_to_the_profile_subquery(): void
    {
        [$main, $child, $admin, $user] = $this->setupMembers();
        $sao = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        $queries = [];
        DB::listen(function ($query) use (&$queries) {
            if (str_contains($query->sql, 'account_profiles') && preg_match('/\bin\s*\(select\b/i', $query->sql)) {
                $queries[] = $query->sql;
            }
        });

        foreach ([$admin, $sao] as $actor) {
            Sanctum::actingAs($actor);
            $this->getJson('/api/account-profiles?organization_id='.$child->id.'&per_page=1')
                ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.school_id', $user->school_id)
                ->assertJsonPath('data.0.organization_id', $child->id);
            $this->getJson('/api/account-profiles?organization_id='.$main->id.'&search='.$user->school_id)
                ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.organization_id', $main->id);
        }

        $this->assertNotEmpty($queries);
        foreach ($queries as $query) {
            $this->assertDoesNotMatchRegularExpression('/\bin\s*\(select\b[^)]*\blimit\b/i', $query);
        }
    }

    public function test_self_and_admin_profiles_are_protected_and_sao_counts_secondary_admins(): void
    {
        [$main, $child, $admin, $user, $extra] = $this->setupMembers();
        $this->deleteJson('/api/account-profiles/'.$admin->accountProfiles()->firstOrFail()->id)->assertForbidden();
        $extra->update(['role' => 'ADMIN']);
        $this->deleteJson('/api/account-profiles/'.$extra->id)->assertForbidden();
        $sao = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        Sanctum::actingAs($sao);
        $this->deleteJson('/api/account-profiles/'.$extra->id)->assertUnprocessable();
        $other = User::factory()->student()->create(['organization_id' => $main->id]);
        $other->accountProfiles()->create(['organization_id' => $child->id, 'role' => 'ADMIN', 'account_status' => 'active']);
        $this->deleteJson('/api/account-profiles/'.$extra->id)->assertOk()->assertJsonPath('account_deleted', false);
        $this->assertDatabaseHas('users', ['school_id' => $user->school_id]);
    }

    public function test_inactive_organization_profiles_can_be_removed_and_other_roles_cannot_manage_profiles(): void
    {
        [, $child, , $user, $extra] = $this->setupMembers();
        $child->update(['is_active' => false]);
        $this->getJson('/api/account-profiles?organization_id='.$child->id)->assertOk()->assertJsonPath('total', 1);
        $this->deleteJson('/api/account-profiles/'.$extra->id)->assertOk();
        foreach (['STUDENT', 'SBO_OFFICER', 'DEPARTMENT_HEAD'] as $role) {
            $actor = User::factory()->create(['role' => $role, 'organization_id' => $user->organization_id]);
            Sanctum::actingAs($actor);
            $this->getJson('/api/account-profiles')->assertForbidden();
            $this->deleteJson('/api/account-profiles/'.$user->accountProfiles()->firstOrFail()->id)->assertForbidden();
        }
    }
}
