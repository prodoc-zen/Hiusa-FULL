<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * One student walked through every slice: the school records, sign-up, the dean finding them by name,
 * both kinds of access the dean can give, and the college lines that must hold. Nobody types a school ID
 * after the student does it once at sign-up.
 */
class HierarchyFlowTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private College $college;

    private Organization $home;

    private Organization $club;

    private User $dean;

    protected function setUp(): void
    {
        parent::setUp();

        $this->college = $this->makeCollege('CIT');
        $this->home = $this->makeCollegeHome($this->college);
        $this->club = $this->makeCollegeStudentOrganization($this->college, ['name' => 'Code Guild', 'lifecycle_status' => 'active']);
        $this->dean = $this->makeCollegeHead($this->college);
        SboPosition::create(['organization_id' => $this->club->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer', 'is_active' => true]);

        StudentRegistryEntry::create([
            'school_id' => 2600101, 'first_name' => 'Hannah', 'last_name' => 'Reyes', 'birth_date' => '2007-03-14',
            'college_id' => $this->college->id, 'program' => 'BS Information Technology', 'year_level' => '1st Year',
        ]);
    }

    private function signUp(): void
    {
        $this->postJson('/api/register', [
            'school_id' => 2600101, 'birth_date' => '2007-03-14', 'email' => 'hannah@example.edu',
            'password' => 'a-long-passphrase', 'password_confirmation' => 'a-long-passphrase',
        ])->assertCreated();
    }

    public function test_the_dean_sees_a_student_before_and_after_sign_up_and_finds_them_by_name_only(): void
    {
        Sanctum::actingAs($this->dean);
        $this->getJson('/api/college/people?tab=students&q=Hannah')->assertOk()
            ->assertJsonPath('data.0.school_id', 2600101)->assertJsonPath('data.0.status', 'not_signed_up');
        $this->getJson('/api/people/search?q=Hannah&scope=college')->assertOk()->assertJsonCount(0, 'data');

        $this->signUp();

        Sanctum::actingAs($this->dean);
        $this->getJson('/api/college/people?tab=students&q=Hannah')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.school_id', 2600101)->assertJsonPath('data.0.status', 'signed_up');
        $this->getJson('/api/people/search?q=Hannah&scope=college')->assertOk()
            ->assertJsonPath('data.0.school_id', 2600101)->assertJsonPath('data.0.email', 'hannah@example.edu');
    }

    public function test_a_signed_up_student_can_be_allowed_to_apply_and_given_officer_access_by_the_dean(): void
    {
        $this->signUp();

        Sanctum::actingAs($this->dean);
        $this->postJson('/api/college/applicant-grants', ['school_id' => 2600101])->assertCreated();
        $this->getJson('/api/college/applicant-grants')->assertOk()->assertJsonFragment(['school_id' => 2600101]);

        $this->postJson('/api/account-profiles/invite', [
            'school_id' => 2600101, 'organization_id' => $this->club->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Treasurer', 'modules' => ['finance'],
        ])->assertCreated()->assertJsonPath('role', 'SBO_OFFICER');

        $student = User::findOrFail(2600101);
        $this->assertSame($this->home->id, $student->organization_id);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => 2600101, 'organization_id' => $this->club->id, 'role' => 'SBO_OFFICER']);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => 2600101, 'organization_id' => $this->home->id, 'role' => 'STUDENT']);

        Sanctum::actingAs($this->dean);
        $this->getJson('/api/college/people?tab=students&q=Hannah')->assertOk()
            ->assertJsonPath('data.0.organizations.0.name', 'Code Guild')->assertJsonPath('data.0.organizations.0.position_title', 'Treasurer');
        $this->getJson('/api/college/people?tab=leaders')->assertOk()->assertJsonPath('data.0.school_id', 2600101);
    }

    public function test_a_student_of_another_college_is_out_of_the_dean_reach(): void
    {
        $other = $this->makeCollege('COE');
        $otherHome = $this->makeCollegeHome($other);
        $outsider = User::factory()->student()->create(['organization_id' => $otherHome->id, 'first_name' => 'Hannah', 'last_name' => 'Outsider', 'department' => $other->name]);

        Sanctum::actingAs($this->dean);
        $this->getJson('/api/people/search?q=Outsider&scope=college')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/college/people?tab=students&q=Outsider')->assertOk()->assertJsonCount(0, 'data');
        $this->postJson('/api/college/applicant-grants', ['school_id' => $outsider->school_id])->assertUnprocessable();
        $this->postJson('/api/account-profiles/invite', [
            'school_id' => $outsider->school_id, 'organization_id' => $this->club->id, 'role' => 'STUDENT',
        ])->assertUnprocessable();
    }

    public function test_a_new_student_is_not_a_dean_and_reaches_no_dean_screens(): void
    {
        $this->signUp();

        Sanctum::actingAs(User::findOrFail(2600101));
        $this->getJson('/api/college/people?tab=students')->assertForbidden();
        $this->getJson('/api/college/applicant-grants')->assertForbidden();
        $this->getJson('/api/students/registry')->assertForbidden();
        $this->getJson('/api/people/search?q=Hannah&scope=college')->assertForbidden();
    }
}
