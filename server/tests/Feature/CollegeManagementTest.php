<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CollegeManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_only_sao_can_manage_colleges_and_used_colleges_are_protected(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $organization = Organization::factory()->create(['college' => 'Old College']);
        $member = User::factory()->admin()->create(['organization_id' => $organization->id, 'department' => 'Old College']);
        Sanctum::actingAs($member);
        $this->getJson('/api/system/colleges')->assertForbidden();
        $this->postJson('/api/system/colleges', ['name' => 'New College'])->assertForbidden();

        Sanctum::actingAs($director);
        $college = $this->postJson('/api/system/colleges', ['name' => 'Old College', 'code' => 'OLD'])
            ->assertCreated()->json();
        $this->getJson('/api/system/colleges')->assertOk()->assertJsonPath('0.organizations_count', 1);
        $this->postJson('/api/system/colleges', ['name' => 'Old College'])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->deleteJson('/api/system/colleges/'.$college['id'])->assertStatus(409);
        $this->putJson('/api/system/colleges/'.$college['id'], ['name' => 'Renamed College', 'code' => 'NEW', 'is_active' => false])
            ->assertOk()->assertJsonPath('name', 'Renamed College');
        $this->assertSame('Renamed College', $organization->fresh()->college);
        $this->assertSame('Renamed College', $member->fresh()->department);
        $this->deleteJson('/api/system/colleges/'.$college['id'])->assertStatus(409);
        $organization->update(['college' => null]);
        $this->deleteJson('/api/system/colleges/'.$college['id'])->assertNoContent();
        $this->assertDatabaseMissing('colleges', ['id' => $college['id']]);
    }
}
