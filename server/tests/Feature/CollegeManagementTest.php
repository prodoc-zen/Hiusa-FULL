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
}
