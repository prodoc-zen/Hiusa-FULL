<?php

namespace Tests\Feature;

use App\Models\College;
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

    public function test_staff_endpoint_no_longer_creates_accounts_or_default_passwords(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college);

        Sanctum::actingAs($head);

        $response = $this->postJson('/api/college/staff', [
            'school_id' => 20261199,
            'first_name' => 'Clara',
            'last_name' => 'Secretary',
            'email' => 'clara.sec@university.edu.ph',
            'position_title' => 'College Secretary',
        ]);

        $response->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $this->assertDatabaseMissing('users', ['school_id' => 20261199]);
        $this->assertDatabaseMissing('users', ['email' => 'clara.sec@university.edu.ph']);
    }

    public function test_department_head_can_assign_existing_user_as_college_staff(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college);
        $studentOrg = $this->makeCollegeStudentOrganization($college);

        $existingUser = User::factory()->student()->create([
            'organization_id' => $studentOrg->id,
            'first_name' => 'Mark',
            'last_name' => 'Assistant',
            'email' => 'mark.assistant@university.edu.ph',
        ]);

        Sanctum::actingAs($head);

        $response = $this->postJson('/api/college/staff', ['school_id' => $existingUser->school_id, 'position_title' => 'Dean Assistant']);
        $response->assertStatus(201)->assertJsonFragment(['school_id' => $existingUser->school_id, 'name' => 'Mark Assistant', 'role' => 'ADMIN']);

        $home = Organization::where('college_id', $college->id)->where('organization_type', 'COLLEGE')->first();
        $this->assertDatabaseHas('account_profiles', [
            'user_school_id' => $existingUser->school_id,
            'organization_id' => $home->id,
            'role' => 'ADMIN',
            'position_title' => 'Dean Assistant',
        ]);
        $this->assertDatabaseHas('notifications', ['user_id' => $existingUser->school_id, 'title' => 'College Office Role Assigned']);
        $this->assertSame($studentOrg->id, $existingUser->fresh()->organization_id);
    }

    public function test_the_same_person_cannot_be_added_twice_and_a_second_dean_cannot_be_made_here(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college);
        $studentOrg = $this->makeCollegeStudentOrganization($college);
        $student = User::factory()->student()->create(['organization_id' => $studentOrg->id]);

        Sanctum::actingAs($head);

        $this->postJson('/api/college/staff', ['school_id' => $student->school_id, 'position_title' => 'Clerk', 'role' => 'DEPARTMENT_HEAD'])
            ->assertCreated()->assertJsonPath('role', 'ADMIN');
        $this->postJson('/api/college/staff', ['school_id' => $student->school_id, 'position_title' => 'Clerk'])->assertJsonValidationErrors('school_id');
        $this->postJson('/api/college/staff', ['school_id' => $head->school_id, 'position_title' => 'Clerk'])->assertJsonValidationErrors('school_id');
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $student->school_id, 'role' => 'DEPARTMENT_HEAD']);
    }

    public function test_an_inactive_account_or_the_sao_cannot_be_added_as_staff(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college);
        $studentOrg = $this->makeCollegeStudentOrganization($college);
        $inactive = User::factory()->student()->create(['organization_id' => $studentOrg->id, 'account_status' => 'disabled']);
        $sao = User::factory()->superAdmin()->create();

        Sanctum::actingAs($head);

        $this->postJson('/api/college/staff', ['school_id' => $inactive->school_id, 'position_title' => 'Clerk'])->assertJsonValidationErrors('school_id');
        $this->postJson('/api/college/staff', ['school_id' => $sao->school_id, 'position_title' => 'Clerk'])->assertJsonValidationErrors('school_id');
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

