<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ExistingOrganizationMembershipTest extends TestCase
{
    use RefreshDatabase;

    private function organization(array $data = []): Organization
    {
        return Organization::factory()->create(['college' => 'College of Computer Studies', ...$data]);
    }

    public function test_admin_can_add_to_main_and_child_organizations_without_changing_the_login(): void
    {
        $main = $this->organization();
        $child = $this->organization(['parent_organization_id' => $main->id]);
        $student = User::factory()->student()->create(['organization_id' => $child->id, 'department' => $main->college]);
        $admin = User::factory()->admin()->create(['organization_id' => $main->id]);
        $password = $student->getRawOriginal('password_hash');
        Sanctum::actingAs($admin);
        $this->postJson('/api/account-profiles/invite', ['organization_id' => $main->id, 'school_id' => $student->school_id, 'role' => 'SBO_OFFICER'])
            ->assertCreated()->assertJsonPath('organization_id', $main->id)->assertJsonPath('role', 'SBO_OFFICER');
        $this->assertSame('STUDENT', $student->fresh()->role);
        $this->assertSame($child->id, $student->fresh()->organization_id);
        $this->assertSame($password, $student->fresh()->getRawOriginal('password_hash'));
        $this->assertCount(2, $student->accountProfiles()->get());
        $this->assertDatabaseHas('audit_logs', ['organization_id' => $main->id, 'user_id' => $admin->school_id, 'action' => 'organization_membership_added']);
        $mainStudent = User::factory()->student()->create(['organization_id' => $main->id]);
        $this->postJson('/api/account-profiles/invite', ['organization_id' => $child->id, 'school_id' => $mainStudent->school_id, 'role' => 'STUDENT'])->assertCreated();
        $this->postJson('/api/account-profiles/invite', ['organization_id' => $child->id, 'school_id' => $mainStudent->school_id, 'role' => 'STUDENT'])->assertStatus(409);
        $this->assertCount(2, $mainStudent->accountProfiles()->get());
    }

    public function test_search_matches_names_school_ids_and_emails_only_within_the_college(): void
    {
        $target = $this->organization();
        $source = $this->organization();
        $actor = User::factory()->admin()->create(['organization_id' => $target->id]);
        $eligible = User::factory()->student()->create(['organization_id' => $source->id, 'school_id' => 24001001, 'first_name' => 'Maria', 'last_name' => 'Reyes', 'email' => 'maria.reyes@example.test']);
        $foreign = User::factory()->student()->create(['organization_id' => $this->organization(['college' => 'College of Business'])->id, 'first_name' => 'Maria', 'last_name' => 'Reyes']);
        $mismatch = User::factory()->student()->create(['organization_id' => $source->id, 'first_name' => 'Maria', 'department' => 'College of Business']);
        $inactive = User::factory()->student()->create(['organization_id' => $source->id, 'first_name' => 'Maria', 'account_status' => 'inactive']);
        Sanctum::actingAs($actor);
        foreach (['Maria Reyes', '24001001', 'maria.reyes@example.test'] as $search) {
            $response = $this->getJson('/api/account-profiles/candidates?'.http_build_query(['organization_id' => $target->id, 'search' => $search, 'per_page' => 1]))
                ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.school_id', $eligible->school_id);
            $this->assertArrayNotHasKey('password_hash', $response->json('data.0'));
            $this->assertArrayNotHasKey('biometric_template', $response->json('data.0'));
        }
        $ids = $this->getJson('/api/account-profiles/candidates?organization_id='.$target->id)->assertOk()->json('data.*.school_id');
        foreach ([$actor, $foreign, $mismatch, $inactive] as $excluded) {
            $this->assertNotContains($excluded->school_id, $ids);
        }
        User::factory()->student()->create(['organization_id' => $source->id]);
        $this->getJson('/api/account-profiles/candidates?organization_id='.$target->id.'&per_page=1&page=2')
            ->assertOk()->assertJsonPath('current_page', 2)->assertJsonPath('total', 2)->assertJsonCount(1, 'data');
    }

    public function test_admin_targets_are_limited_to_its_own_organization_and_same_college_children(): void
    {
        $main = $this->organization();
        $child = $this->organization(['parent_organization_id' => $main->id]);
        $unrelated = $this->organization();
        $wrongCollegeChild = $this->organization(['parent_organization_id' => $main->id, 'college' => 'College of Business']);
        $student = User::factory()->student()->create(['organization_id' => $main->id]);
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $main->id]));
        $this->getJson('/api/account-profiles/organizations')->assertOk()->assertJsonCount(2)->assertJsonFragment(['id' => $child->id]);
        foreach ([$unrelated, $wrongCollegeChild] as $target) {
            $this->getJson('/api/account-profiles/candidates?organization_id='.$target->id)->assertNotFound();
            $this->postJson('/api/account-profiles/invite', ['organization_id' => $target->id, 'school_id' => $student->school_id, 'role' => 'STUDENT'])->assertNotFound();
        }
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $child->id]));
        $this->getJson('/api/account-profiles/candidates?organization_id='.$main->id)->assertNotFound();
    }

    public function test_sao_can_add_to_main_or_suborganizations_and_counts_include_secondary_profiles(): void
    {
        $source = $this->organization();
        $main = $this->organization();
        $child = $this->organization(['parent_organization_id' => $main->id]);
        $student = User::factory()->student()->create(['organization_id' => $source->id]);
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]));
        foreach ([$main, $child] as $target) {
            $this->postJson('/api/account-profiles/invite', ['organization_id' => $target->id, 'school_id' => $student->school_id, 'role' => 'STUDENT'])->assertCreated();
        }
        $rows = $this->getJson('/api/system/organizations?per_page=100')->assertOk()->json('data');
        $this->assertSame(1, collect($rows)->firstWhere('id', $child->id)['users_count']);
        $this->assertCount(3, $student->accountProfiles()->get());
    }

    public function test_cross_college_users_cannot_be_added_even_with_forged_department(): void
    {
        $target = $this->organization();
        $foreign = User::factory()->student()->create(['organization_id' => $this->organization(['college' => 'College of Business'])->id, 'department' => $target->college]);
        $mismatch = User::factory()->student()->create(['organization_id' => $this->organization()->id, 'department' => 'College of Business']);
        foreach (['ADMIN', 'SUPER_ADMIN'] as $role) {
            Sanctum::actingAs(User::factory()->create(['organization_id' => $target->id, 'role' => $role]));
            foreach ([$foreign, $mismatch] as $user) {
                $this->postJson('/api/account-profiles/invite', ['organization_id' => $target->id, 'school_id' => $user->school_id, 'role' => 'STUDENT'])
                    ->assertUnprocessable()->assertJsonValidationErrors('school_id');
                $this->assertDatabaseMissing('account_profiles', ['organization_id' => $target->id, 'user_school_id' => $user->school_id]);
            }
        }
    }

    public function test_sao_can_assign_one_existing_admin_to_multiple_suborganizations_and_switch_scopes(): void
    {
        $main = $this->organization();
        $children = [
            $this->organization(['parent_organization_id' => $main->id]),
            $this->organization(['parent_organization_id' => $main->id]),
        ];
        $admin = User::factory()->admin()->create(['organization_id' => $main->id, 'department' => $main->college]);
        $password = $admin->getRawOriginal('password_hash');
        $students = array_map(fn ($child) => User::factory()->student()->create(['organization_id' => $child->id]), $children);
        $sao = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        Sanctum::actingAs($sao);
        $profiles = [];

        foreach ($children as $child) {
            $this->getJson('/api/account-profiles/candidates?'.http_build_query(['organization_id' => $child->id, 'search' => $admin->school_id]))
                ->assertOk()->assertJsonPath('data.0.school_id', $admin->school_id);
            $profiles[] = $this->postJson('/api/account-profiles/invite', ['organization_id' => $child->id, 'school_id' => $admin->school_id, 'role' => 'ADMIN'])
                ->assertCreated()->assertJsonPath('role', 'ADMIN')->assertJsonPath('organization_id', $child->id)->json('id');
        }
        $this->postJson('/api/account-profiles/invite', ['organization_id' => $children[0]->id, 'school_id' => $admin->school_id, 'role' => 'ADMIN'])->assertStatus(409);
        $this->assertCount(3, $admin->accountProfiles()->get());
        $this->assertSame($main->id, $admin->fresh()->organization_id);
        $this->assertSame('ADMIN', $admin->fresh()->role);
        $this->assertSame($password, $admin->fresh()->getRawOriginal('password_hash'));
        $rows = collect($this->getJson('/api/system/organizations?per_page=100')->assertOk()->json('data'));
        foreach ($children as $child) {
            $this->assertSame(1, $rows->firstWhere('id', $child->id)['administrators_count']);
            $this->assertSame(2, $rows->firstWhere('id', $child->id)['users_count']);
        }

        $this->app['auth']->forgetGuards();
        $token = $this->postJson('/api/login', ['school_id' => $admin->school_id, 'password' => 'password'])->assertOk()->json('access_token');
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/user/profiles')->assertOk()->assertJsonCount(3, 'profiles');
        foreach ($children as $index => $child) {
            $this->withToken($token)->postJson('/api/user/profiles/'.$profiles[$index].'/switch')
                ->assertOk()->assertJsonPath('user.role', 'ADMIN')->assertJsonPath('user.organization_id', $child->id);
            $this->withToken($token)->getJson('/api/users')->assertOk()
                ->assertJsonFragment(['school_id' => $students[$index]->school_id])
                ->assertJsonMissing(['school_id' => $students[1 - $index]->school_id]);
            $this->withToken($token)->getJson('/api/system/organizations')->assertForbidden();
        }
    }

    public function test_only_sao_can_assign_admin_membership_and_college_eligibility_still_applies(): void
    {
        $main = $this->organization();
        $child = $this->organization(['parent_organization_id' => $main->id]);
        $student = User::factory()->student()->create(['organization_id' => $main->id]);
        $foreignAdmin = User::factory()->admin()->create(['organization_id' => $this->organization(['college' => 'College of Business'])->id]);
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $main->id]));
        $this->postJson('/api/account-profiles/invite', ['organization_id' => $child->id, 'school_id' => $student->school_id, 'role' => 'ADMIN'])
            ->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->assertDatabaseMissing('account_profiles', ['organization_id' => $child->id, 'user_school_id' => $student->school_id]);

        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]));
        $this->postJson('/api/account-profiles/invite', ['organization_id' => $child->id, 'school_id' => $foreignAdmin->school_id, 'role' => 'ADMIN'])
            ->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $this->assertDatabaseMissing('account_profiles', ['organization_id' => $child->id, 'user_school_id' => $foreignAdmin->school_id]);
        $this->postJson('/api/account-profiles/invite', ['organization_id' => $child->id, 'school_id' => $student->school_id, 'role' => 'ADMIN'])
            ->assertCreated()->assertJsonPath('role', 'ADMIN');
        $this->assertSame('STUDENT', $student->fresh()->role);
        $this->assertSame($main->id, $student->fresh()->organization_id);
    }

    public function test_member_roles_cannot_search_or_add_profiles(): void
    {
        $target = $this->organization();
        foreach (['STUDENT', 'SBO_OFFICER', 'DEPARTMENT_HEAD'] as $role) {
            Sanctum::actingAs(User::factory()->create(['organization_id' => $target->id, 'role' => $role]));
            $this->getJson('/api/account-profiles/organizations')->assertForbidden();
            $this->getJson('/api/account-profiles/candidates?organization_id='.$target->id)->assertForbidden();
            $this->postJson('/api/account-profiles/invite', ['organization_id' => $target->id, 'school_id' => 123, 'role' => 'STUDENT'])->assertForbidden();
        }
    }

    public function test_disabled_unassigned_and_system_organizations_cannot_receive_members_and_roles_are_validated(): void
    {
        $target = $this->organization();
        $source = $this->organization();
        $student = User::factory()->student()->create(['organization_id' => $source->id]);
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => $target->id]));
        $this->postJson('/api/account-profiles/invite', ['organization_id' => $target->id, 'school_id' => $student->school_id, 'role' => 'SUPER_ADMIN'])
            ->assertUnprocessable()->assertJsonValidationErrors('role');
        foreach ([$this->organization(['is_active' => false]), Organization::where('slug', 'student-affairs-office')->firstOrFail()] as $invalid) {
            $this->postJson('/api/account-profiles/invite', ['organization_id' => $invalid->id, 'school_id' => $student->school_id, 'role' => 'STUDENT'])->assertNotFound();
        }
        $unassigned = $this->organization(['college' => null]);
        $this->getJson('/api/account-profiles/candidates?organization_id='.$unassigned->id)->assertUnprocessable()->assertJsonValidationErrors('organization_id');
        $this->postJson('/api/account-profiles/invite', ['organization_id' => $unassigned->id, 'school_id' => $student->school_id, 'role' => 'STUDENT'])->assertUnprocessable();
    }
}
