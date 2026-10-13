<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CollegeManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_only_sao_can_manage_colleges_and_deletion_deactivates_assigned_organizations_and_accounts(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $organization = Organization::factory()->create(['college' => 'Old College']);
        $member = User::factory()->admin()->create(['organization_id' => $organization->id, 'department' => 'Old College']);
        Sanctum::actingAs($member);
        $this->getJson('/api/system/colleges')->assertForbidden();
        $this->postJson('/api/system/colleges', ['name' => 'New College'])->assertForbidden();

        Sanctum::actingAs($director);
        $college = $this->postJson('/api/system/colleges', ['name' => 'Old College', 'code' => 'OLD', 'color' => '#123ABC'])
            ->assertCreated()->assertJsonPath('color', '#123ABC')->json();
        $this->postJson('/api/system/colleges', ['name' => 'Bad color', 'color' => 'blue'])->assertUnprocessable()->assertJsonValidationErrors('color');
        $this->getJson('/api/system/colleges')->assertOk()->assertJsonPath('0.organizations_count', 1);
        $this->postJson('/api/system/colleges', ['name' => 'Old College'])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->putJson('/api/system/colleges/'.$college['id'], ['name' => 'Renamed College', 'code' => 'NEW', 'is_active' => false])
            ->assertOk()->assertJsonPath('name', 'Renamed College');
        $this->assertSame('Renamed College', $organization->fresh()->college);
        $this->assertSame('Renamed College', $member->fresh()->department);
        $this->deleteJson('/api/system/colleges/'.$college['id'])->assertNoContent();
        $this->assertSoftDeleted('colleges', ['id' => $college['id']]);
        $this->assertFalse($organization->fresh()->is_active);
        $this->assertSame('inactive', $member->fresh()->account_status);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => $member->school_id, 'organization_id' => $organization->id, 'account_status' => 'inactive']);
        $this->getJson('/api/system/colleges')->assertOk()->assertJsonCount(0);
    }

    public function test_college_deletion_can_transfer_organizations_without_deactivating_accounts(): void
    {
        $source = College::create(['name' => 'Source College', 'is_active' => true]);
        $target = College::create(['name' => 'Target College', 'is_active' => true]);
        $org = Organization::factory()->create(['college' => $source->name]);
        $user = User::factory()->admin()->create(['organization_id' => $org->id, 'department' => $source->name]);
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]));
        $this->deleteJson('/api/system/colleges/'.$source->id, ['transfer_to_college_id' => $source->id])->assertUnprocessable();
        $this->deleteJson('/api/system/colleges/'.$source->id, ['transfer_to_college_id' => $target->id])->assertNoContent();
        $this->assertSame($target->name, $org->fresh()->college);
        $this->assertTrue($org->fresh()->is_active);
        $this->assertSame($target->name, $user->fresh()->department);
        $this->assertSame('active', $user->fresh()->account_status);
    }
}
