<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class CollegeStaffDelegationTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    public function test_department_head_can_list_college_staff(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college, [
            'first_name' => 'John',
            'last_name' => 'Dean',
            'position_title' => 'Dean of Computing',
        ]);

        Sanctum::actingAs($head);

        $response = $this->getJson('/api/college/staff');
        $response->assertOk();
        $response->assertJsonFragment([
            'school_id' => $head->school_id,
            'name' => 'John Dean',
            'role' => 'DEPARTMENT_HEAD',
            'is_lead_head' => true,
        ]);
    }

    public function test_staff_endpoint_no_longer_creates_accounts_or_attaches_anyone(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college);

        Sanctum::actingAs($head);

        $this->postJson('/api/college/staff', [
            'school_id' => 20261199,
            'first_name' => 'Clara',
            'last_name' => 'Secretary',
            'email' => 'clara.sec@university.edu.ph',
            'position_title' => 'College Secretary',
        ])->assertStatus(405);
        $this->assertDatabaseMissing('users', ['school_id' => 20261199]);
        $this->assertDatabaseMissing('users', ['email' => 'clara.sec@university.edu.ph']);
    }

    public function test_department_head_cannot_remove_self_from_college_staff(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college);

        Sanctum::actingAs($head);

        $response = $this->deleteJson("/api/college/staff/{$head->school_id}");
        $response->assertStatus(422);
    }

    public function test_department_head_can_remove_delegated_staff(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college);
        $home = Organization::where('college_id', $college->id)->where('organization_type', 'COLLEGE')->first();

        $staffUser = User::factory()->admin()->create([
            'organization_id' => $home->id,
            'position_title' => 'College Secretary',
        ]);

        Sanctum::actingAs($head);

        $response = $this->deleteJson("/api/college/staff/{$staffUser->school_id}");
        $response->assertOk();

        $this->assertDatabaseHas('users', [
            'school_id' => $staffUser->school_id,
            'account_status' => 'disabled',
        ]);
    }
}
