<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\AccountProfile;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CollegeManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_only_sao_can_list_colleges_with_their_student_organization_counts(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $college = College::create(['name' => 'Old College', 'code' => 'OLD', 'color' => '#123ABC', 'is_active' => true]);
        $organization = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id]);
        $member = User::factory()->admin()->create(['organization_id' => $organization->id, 'department' => 'Old College']);
        Sanctum::actingAs($member);
        $this->getJson('/api/system/colleges')->assertForbidden();

        Sanctum::actingAs($director);
        $this->getJson('/api/system/colleges')->assertOk()
            ->assertJsonPath('0.name', 'Old College')
            ->assertJsonPath('0.color', '#123ABC')
            ->assertJsonPath('0.organizations_count', 1);
    }

    public function test_sao_can_create_an_empty_college_with_a_home_organization(): void
    {
        $this->actingAsSao();
        $response = $this->postJson('/api/system/colleges', ['name' => 'College of Computing', 'code' => 'COC', 'description' => 'Computing programs.'])
            ->assertCreated()->assertJsonPath('name', 'College of Computing');
        $college = College::findOrFail($response->json('id'));
        $home = $college->homeOrganization;
        $this->assertSame('COLLEGE', $home->organization_type);
        $this->assertSame($college->id, $home->college_id);
        $this->getJson('/api/system/colleges')->assertOk()->assertJsonPath('0.can_receive_transfer', true)->assertJsonPath('0.has_assignments', false);
        $this->postJson('/api/system/colleges', ['name' => 'College of Computing', 'code' => 'OTHER'])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->postJson('/api/system/colleges', ['name' => 'Another College', 'code' => 'COC'])->assertUnprocessable()->assertJsonValidationErrors('code');
    }

    public function test_only_sao_can_create_or_delete_colleges(): void
    {
        $college = College::create(['name' => 'Empty College', 'is_active' => true]);
        $this->postJson('/api/system/colleges', ['name' => 'New College'])->assertUnauthorized();
        Sanctum::actingAs(User::factory()->admin()->create());
        $this->postJson('/api/system/colleges', ['name' => 'New College'])->assertForbidden();
        $this->deleteJson('/api/system/colleges/'.$college->id)->assertForbidden();
    }

    public function test_populated_college_requires_an_empty_replacement_and_preserves_accounts_on_transfer(): void
    {
        $this->actingAsSao();
        $sourceId = $this->postJson('/api/system/colleges', ['name' => 'Source College'])->assertCreated()->json('id');
        $busyId = $this->postJson('/api/system/colleges', ['name' => 'Busy College'])->assertCreated()->json('id');
        $emptyId = $this->postJson('/api/system/colleges', ['name' => 'Replacement College'])->assertCreated()->json('id');
        $source = College::findOrFail($sourceId);
        $sourceHome = $source->homeOrganization;
        $targetHome = College::findOrFail($emptyId)->homeOrganization;
        $studentOrg = Organization::factory()->create(['college_id' => $sourceId, 'college' => $source->name, 'parent_organization_id' => $sourceHome->id]);
        $member = User::factory()->admin()->create(['organization_id' => $studentOrg->id, 'department' => $source->name]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $sourceHome->id, 'department' => $source->name]);
        $profile = AccountProfile::where('user_school_id', $head->school_id)->where('organization_id', $sourceHome->id)->firstOrFail();
        $member->createToken('member-session');
        $head->createToken('head-session');
        Organization::factory()->create(['college_id' => $busyId, 'college' => 'Busy College']);

        $this->deleteJson('/api/system/colleges/'.$sourceId)->assertUnprocessable()->assertJsonValidationErrors('transfer_to_college_id');
        $this->deleteJson('/api/system/colleges/'.$sourceId, ['transfer_to_college_id' => $busyId])->assertConflict();
        $this->deleteJson('/api/system/colleges/'.$sourceId, ['transfer_to_college_id' => $sourceId])->assertUnprocessable();
        $this->assertNull($source->fresh()->deleted_at);

        $this->deleteJson('/api/system/colleges/'.$sourceId, ['transfer_to_college_id' => $emptyId])->assertNoContent();
        $this->assertSoftDeleted($source);
        $this->assertSame($emptyId, $studentOrg->fresh()->college_id);
        $this->assertSame($targetHome->id, $studentOrg->fresh()->parent_organization_id);
        $this->assertSame('active', $member->fresh()->account_status);
        $this->assertSame('Replacement College', $member->fresh()->department);
        $this->assertSame($targetHome->id, $head->fresh()->organization_id);
        $this->assertSame('active', $head->fresh()->account_status);
        $this->assertSame($targetHome->id, $profile->fresh()->organization_id);
        $this->assertSame(0, $member->tokens()->count());
        $this->assertSame(0, $head->tokens()->count());
        $this->getJson('/api/system/colleges')->assertOk()->assertJsonPath('1.can_receive_transfer', false);
    }

    public function test_empty_college_can_be_deleted_without_a_replacement(): void
    {
        $this->actingAsSao();
        $id = $this->postJson('/api/system/colleges', ['name' => 'Unused College'])->assertCreated()->json('id');
        $this->deleteJson('/api/system/colleges/'.$id)->assertNoContent();
        $this->assertSoftDeleted(College::withTrashed()->findOrFail($id));
    }

    public function test_college_with_only_a_department_head_needs_a_replacement_without_any_users(): void
    {
        $this->actingAsSao();
        $sourceId = $this->postJson('/api/system/colleges', ['name' => 'Head College'])->assertCreated()->json('id');
        $busyId = $this->postJson('/api/system/colleges', ['name' => 'Head Destination'])->assertCreated()->json('id');
        $head = User::factory()->departmentHead()->create(['organization_id' => College::findOrFail($sourceId)->homeOrganization->id]);
        User::factory()->departmentHead()->create(['organization_id' => College::findOrFail($busyId)->homeOrganization->id]);

        $this->getJson('/api/system/colleges')->assertOk()->assertJsonPath('0.has_assignments', true)->assertJsonPath('1.can_receive_transfer', false);
        $this->deleteJson('/api/system/colleges/'.$sourceId)->assertUnprocessable()->assertJsonValidationErrors('transfer_to_college_id');
        $this->deleteJson('/api/system/colleges/'.$sourceId, ['transfer_to_college_id' => $busyId])->assertConflict();
        $this->assertSame('active', $head->fresh()->account_status);
    }

    public function test_profile_only_membership_moves_to_the_replacement_and_revokes_its_user_session(): void
    {
        $this->actingAsSao();
        $sourceId = $this->postJson('/api/system/colleges', ['name' => 'Profile College'])->assertCreated()->json('id');
        $targetId = $this->postJson('/api/system/colleges', ['name' => 'Profile Replacement'])->assertCreated()->json('id');
        $home = College::findOrFail($sourceId)->homeOrganization;
        $targetHome = College::findOrFail($targetId)->homeOrganization;
        $external = Organization::factory()->create();
        $user = User::factory()->admin()->create(['organization_id' => $external->id]);
        $profile = AccountProfile::create(['user_school_id' => $user->school_id, 'organization_id' => $home->id, 'role' => 'DEPARTMENT_HEAD', 'account_status' => 'active']);
        $user->createToken('session');

        $this->deleteJson('/api/system/colleges/'.$sourceId)->assertUnprocessable();
        $this->deleteJson('/api/system/colleges/'.$sourceId, ['transfer_to_college_id' => $targetId])->assertNoContent();
        $this->assertSame($targetHome->id, $profile->fresh()->organization_id);
        $this->assertSame($external->id, $user->fresh()->organization_id);
        $this->assertSame(0, $user->tokens()->count());
    }

    private function actingAsSao(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => $sao->id]));
    }
}
