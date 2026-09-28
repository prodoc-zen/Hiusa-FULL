<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AccountProfileTest extends TestCase
{
    use RefreshDatabase;

    public function test_suborganization_membership_switches_token_role_and_scope(): void
    {
        $main = Organization::factory()->create();
        $child = Organization::factory()->create(['parent_organization_id' => $main->id, 'college' => $main->college]);
        $student = User::factory()->create([
            'organization_id' => $main->id, 'role' => 'STUDENT', 'password_hash' => 'password123',
        ]);
        $childAdmin = User::factory()->admin()->create(['organization_id' => $child->id]);

        $adminToken = $this->postJson('/api/login', [
            'school_id' => $childAdmin->school_id, 'password' => 'password',
        ])->json('access_token');
        $this->withToken($adminToken)->postJson('/api/account-profiles/invite', [
            'school_id' => $student->school_id, 'role' => 'SBO_OFFICER',
        ])->assertCreated()->assertJsonPath('organization_id', $child->id);
        $this->withToken($adminToken)->getJson('/api/users')
            ->assertOk()->assertJsonFragment(['school_id' => $student->school_id, 'role' => 'SBO_OFFICER']);

        $this->app['auth']->forgetGuards();
        $studentToken = $this->postJson('/api/login', [
            'school_id' => $student->school_id, 'password' => 'password123',
        ])->assertOk()->json('access_token');
        $this->app['auth']->forgetGuards();
        $this->withToken($studentToken)->getJson('/api/user')->assertJsonPath('role', 'STUDENT')->assertJsonPath('organization_id', $main->id);
        $profiles = $this->withToken($studentToken)->getJson('/api/user/profiles')->assertOk()->json('profiles');
        $this->assertCount(2, $profiles);
        $childProfile = collect($profiles)->firstWhere('organization_id', $child->id);

        $this->withToken($studentToken)->postJson('/api/user/profiles/'.$childProfile['id'].'/switch')
            ->assertOk()->assertJsonPath('user.role', 'SBO_OFFICER')->assertJsonPath('user.organization_id', $child->id);
        $this->withToken($studentToken)->getJson('/api/user')->assertJsonPath('role', 'SBO_OFFICER')->assertJsonPath('organization_id', $child->id);
        $this->assertSame($main->id, $student->fresh()->organization_id);
    }

    public function test_only_suborganization_admin_can_invite_and_profiles_cannot_be_stolen(): void
    {
        $main = Organization::factory()->create();
        $student = User::factory()->create(['organization_id' => $main->id, 'role' => 'STUDENT', 'password_hash' => 'password123']);
        $admin = User::factory()->admin()->create(['organization_id' => $main->id]);
        $adminToken = $this->postJson('/api/login', ['school_id' => $admin->school_id, 'password' => 'password'])->json('access_token');
        $this->withToken($adminToken)->postJson('/api/account-profiles/invite', [
            'school_id' => $student->school_id, 'role' => 'STUDENT',
        ])->assertForbidden();

        $child = Organization::factory()->create(['parent_organization_id' => $main->id]);
        $childAdmin = User::factory()->admin()->create(['organization_id' => $child->id]);
        $foreignStudent = User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
        $this->app['auth']->forgetGuards();
        $childToken = $this->postJson('/api/login', ['school_id' => $childAdmin->school_id, 'password' => 'password'])->json('access_token');
        $this->app['auth']->forgetGuards();
        $this->withToken($childToken)->postJson('/api/account-profiles/invite', [
            'school_id' => $foreignStudent->school_id, 'role' => 'STUDENT',
        ])->assertUnprocessable();

        $this->app['auth']->forgetGuards();
        $studentToken = $this->postJson('/api/login', ['school_id' => $student->school_id, 'password' => 'password123'])->json('access_token');
        $this->app['auth']->forgetGuards();
        $this->withToken($studentToken)->postJson('/api/user/profiles/'.$admin->accountProfiles()->first()->id.'/switch')->assertNotFound();
    }

    public function test_suborganization_admin_can_manage_its_membership_without_deleting_the_shared_login(): void
    {
        $main = Organization::factory()->create();
        $child = Organization::factory()->create(['parent_organization_id' => $main->id]);
        $student = User::factory()->student()->create(['organization_id' => $main->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $child->id]);
        $membership = $student->accountProfiles()->create([
            'organization_id' => $child->id, 'role' => 'STUDENT', 'account_status' => 'active',
        ]);
        $token = $this->postJson('/api/login', ['school_id' => $admin->school_id, 'password' => 'password'])->json('access_token');
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->putJson('/api/users/'.$student->school_id, ['role' => 'SBO_OFFICER'])
            ->assertOk()->assertJsonPath('role', 'SBO_OFFICER');
        $this->assertSame('STUDENT', $student->fresh()->role);
        $this->assertSame('SBO_OFFICER', $membership->fresh()->role);

        $this->withToken($token)->deleteJson('/api/users/'.$student->school_id)->assertOk();
        $this->assertDatabaseHas('users', ['school_id' => $student->school_id, 'organization_id' => $main->id]);
        $this->assertDatabaseMissing('account_profiles', ['id' => $membership->id]);
    }

    public function test_only_sao_can_delete_an_admin_and_last_active_admin_is_protected(): void
    {
        $organization = Organization::factory()->create();
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $first = User::factory()->admin()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($first);
        $this->deleteJson('/api/system/admins/'.$first->school_id)->assertForbidden();

        Sanctum::actingAs($director);
        $this->deleteJson('/api/system/admins/'.$first->school_id)->assertUnprocessable();

        $second = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->deleteJson('/api/system/admins/'.$second->school_id)->assertOk();
        $this->assertDatabaseMissing('users', ['school_id' => $second->school_id]);
    }

    public function test_invited_student_can_be_billed_and_notified_only_in_the_child_organization(): void
    {
        $main = Organization::factory()->create();
        $child = Organization::factory()->create(['parent_organization_id' => $main->id]);
        $other = Organization::factory()->create();
        $student = User::factory()->student()->create(['organization_id' => $main->id]);
        $student->accountProfiles()->create(['organization_id' => $child->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $admin = User::factory()->admin()->create(['organization_id' => $child->id]);
        $otherAdmin = User::factory()->admin()->create(['organization_id' => $other->id]);

        Sanctum::actingAs($admin);
        $this->postJson('/api/invoices', [
            'student_id' => $student->school_id, 'description' => 'Membership fee', 'amount_due' => 100,
        ])->assertCreated();
        $this->postJson('/api/notifications', [
            'user_id' => $student->school_id, 'title' => 'Fee notice', 'message' => 'Please review your account.',
        ])->assertCreated();
        $this->assertDatabaseHas('invoices', ['organization_id' => $child->id, 'student_id' => $student->school_id]);
        $this->assertDatabaseHas('notifications', ['organization_id' => $child->id, 'user_id' => $student->school_id]);

        Sanctum::actingAs($otherAdmin);
        $this->postJson('/api/invoices', [
            'student_id' => $student->school_id, 'description' => 'Wrong organization', 'amount_due' => 100,
        ])->assertUnprocessable();
    }
}
