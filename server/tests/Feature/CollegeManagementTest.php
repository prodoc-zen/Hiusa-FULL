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

    public function test_colleges_are_a_fixed_list_so_nobody_can_add_or_delete_one(): void
    {
        $college = College::create(['name' => 'Empty College', 'is_active' => true]);

        $this->actingAsSao();
        $this->postJson('/api/system/colleges', ['name' => 'New College'])->assertStatus(405);
        $this->deleteJson('/api/system/colleges/'.$college->id)->assertStatus(405);
        $this->assertDatabaseMissing('colleges', ['name' => 'New College']);
        $this->assertNotNull($college->fresh());
    }

    public function test_the_college_list_no_longer_reports_transfer_or_assignment_flags(): void
    {
        College::create(['name' => 'Some College', 'is_active' => true]);
        $this->actingAsSao();

        $row = $this->getJson('/api/system/colleges')->assertOk()->json('0');

        $this->assertArrayNotHasKey('has_assignments', $row);
        $this->assertArrayNotHasKey('can_receive_transfer', $row);
        $this->assertArrayHasKey('department_head', $row);
    }

    public function test_sao_can_edit_a_college_and_its_home_organization_follows(): void
    {
        $college = College::create(['name' => 'Old College', 'code' => 'OLD', 'is_active' => true]);
        $home = Organization::factory()->create(['college' => 'Old College', 'college_id' => $college->id, 'organization_type' => 'COLLEGE']);
        $this->actingAsSao();

        $this->putJson('/api/system/colleges/'.$college->id, ['name' => 'College of Computing', 'code' => 'COC', 'description' => 'Computing programs.'])
            ->assertOk()->assertJsonPath('name', 'College of Computing');

        $this->assertSame('COC', $home->fresh()->acronym);
        $this->assertSame('College of Computing', $home->fresh()->college);
    }

    public function test_college_edit_rejects_a_duplicate_name_or_code_and_non_sao_callers(): void
    {
        $first = College::create(['name' => 'First College', 'code' => 'FIR', 'is_active' => true]);
        $second = College::create(['name' => 'Second College', 'code' => 'SEC', 'is_active' => true]);

        Sanctum::actingAs(User::factory()->admin()->create());
        $this->putJson('/api/system/colleges/'.$second->id, ['name' => 'Second College'])->assertForbidden();

        $this->actingAsSao();
        $this->putJson('/api/system/colleges/'.$second->id, ['name' => 'First College'])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->putJson('/api/system/colleges/'.$second->id, ['name' => 'Second College', 'code' => 'FIR'])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->assertSame('First College', $first->fresh()->name);
    }

    public function test_archive_and_restore_still_work_on_a_college(): void
    {
        $college = College::create(['name' => 'Archive College', 'code' => 'ARC', 'is_active' => true]);
        Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE']);
        $this->actingAsSao();

        $this->postJson("/api/system/colleges/{$college->id}/archive")->assertOk();
        $this->assertFalse($college->fresh()->is_active);
        $this->postJson("/api/system/colleges/{$college->id}/restore")->assertOk();
        $this->assertTrue($college->fresh()->is_active);
    }

    private function actingAsSao(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => $sao->id]));
    }
}
