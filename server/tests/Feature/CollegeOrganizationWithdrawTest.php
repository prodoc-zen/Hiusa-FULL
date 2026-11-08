<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** A Department Head no longer registers, edits or withdraws organizations: new ones arrive as applications from a student the head allowed to apply. */
class CollegeOrganizationWithdrawTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_dean_registration_routes_are_gone_and_existing_rows_stay_readable(): void
    {
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $home = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE']);
        $head = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $legacy = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'returned', 'is_active' => false, 'review_remarks' => 'Fix the constitution.']);
        Sanctum::actingAs($head);

        $this->assertContains($this->postJson('/api/college/organizations', ['name' => 'Robotics Guild'])->status(), [404, 405]);
        $this->assertContains($this->putJson("/api/college/organizations/{$legacy->id}", ['name' => 'Renamed'])->status(), [404, 405]);
        $this->assertContains($this->deleteJson("/api/college/organizations/{$legacy->id}")->status(), [404, 405]);
        $this->assertContains($this->getJson('/api/college/organizations/requirements')->status(), [404, 405]);
        $this->assertDatabaseHas('organizations', ['id' => $legacy->id, 'name' => $legacy->name, 'lifecycle_status' => 'returned']);

        $this->getJson('/api/college/organizations')->assertOk()->assertJsonPath('data.0.id', $legacy->id)
            ->assertJsonPath('data.0.lifecycle_status', 'returned')->assertJsonPath('data.0.review_remarks', 'Fix the constitution.');
    }
}
