<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class SaoAdminProvisioningTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private function signInSao(): User
    {
        $user = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]);
        Sanctum::actingAs($user);

        return $user;
    }

    private function universityWide(): Organization
    {
        return Organization::factory()->create(['is_university_wide' => true, 'college_id' => null, 'college' => null, 'parent_organization_id' => null]);
    }

    public function test_sao_cannot_grant_any_role_in_a_college_organization_and_the_refusal_names_the_department_head(): void
    {
        $this->signInSao();
        $source = Organization::factory()->create(['college' => 'College of Computing']);
        $target = Organization::factory()->create(['college' => $source->college]);
        $user = User::factory()->student()->create(['organization_id' => $source->id]);

        foreach (['ADMIN', 'SBO_OFFICER', 'STUDENT'] as $role) {
            $this->postJson('/api/account-profiles/invite', ['organization_id' => $target->id, 'school_id' => $user->school_id, 'role' => $role])
                ->assertForbidden()->assertJsonPath('message', 'The Department Head gives access in a college organization.');
        }

        $this->assertDatabaseMissing('account_profiles', ['organization_id' => $target->id, 'user_school_id' => $user->school_id]);
    }

    public function test_sao_cannot_change_a_profile_in_a_college_organization_but_still_removes_one(): void
    {
        $this->signInSao();
        $organization = Organization::factory()->create(['college' => 'College of Computing']);
        $member = User::factory()->student()->create(['organization_id' => $organization->id]);
        $profile = AccountProfile::where('user_school_id', $member->school_id)->where('organization_id', $organization->id)->firstOrFail();

        foreach (['ADMIN', 'SBO_OFFICER', 'STUDENT'] as $role) {
            $this->putJson('/api/account-profiles/'.$profile->id, ['role' => $role])
                ->assertForbidden()->assertJsonPath('message', 'The Department Head gives access in a college organization.');
        }
        $this->getJson('/api/account-profiles?organization_id='.$organization->id)->assertOk();

        $other = User::factory()->student()->create(['organization_id' => Organization::factory()->create(['college' => 'College of Computing'])->id]);
        $second = $other->accountProfiles()->create(['organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $this->deleteJson('/api/account-profiles/'.$second->id)->assertOk();
        $this->assertDatabaseMissing('account_profiles', ['id' => $second->id]);
    }

    public function test_the_department_head_still_grants_in_a_college_organization(): void
    {
        $college = $this->makeCollege('CCS');
        $student = User::factory()->student()->create(['organization_id' => $this->makeCollegeStudentOrganization($college)->id]);
        $target = $this->makeCollegeStudentOrganization($college);
        $head = $this->makeCollegeHead($college);
        Sanctum::actingAs($head);

        $this->postJson('/api/account-profiles/invite', ['organization_id' => $target->id, 'school_id' => $student->school_id, 'role' => 'ADMIN'])
            ->assertCreated()->assertJsonPath('role', 'ADMIN');
    }

    public function test_sao_names_only_the_admin_of_a_university_wide_organization(): void
    {
        $this->signInSao();
        $organization = $this->universityWide();
        $user = User::factory()->student()->create(['organization_id' => Organization::factory()->create(['college' => 'College of Computing'])->id]);
        $password = $user->getRawOriginal('password_hash');

        foreach (['SBO_OFFICER', 'STUDENT'] as $role) {
            $this->postJson('/api/account-profiles/invite', ['organization_id' => $organization->id, 'school_id' => $user->school_id, 'role' => $role])
                ->assertForbidden()->assertJsonPath('message', 'The SAO names only the Admin of a university-wide organization.');
        }
        $profile = $this->postJson('/api/account-profiles/invite', ['organization_id' => $organization->id, 'school_id' => $user->school_id, 'role' => 'ADMIN'])
            ->assertCreated()->assertJsonPath('role', 'ADMIN')->json('id');
        $this->assertSame($password, $user->fresh()->getRawOriginal('password_hash'));
        $this->assertSame('STUDENT', $user->fresh()->role);
        $this->postJson('/api/account-profiles/invite', ['organization_id' => $organization->id, 'school_id' => $user->school_id, 'role' => 'ADMIN'])->assertConflict();

        $this->putJson('/api/account-profiles/'.$profile, ['role' => 'STUDENT'])->assertForbidden();
        $this->putJson('/api/account-profiles/'.$profile, ['role' => 'ADMIN', 'position_title' => null])->assertOk();
    }
}
