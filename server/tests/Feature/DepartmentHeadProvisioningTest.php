<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class DepartmentHeadProvisioningTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private College $college;

    private Organization $organization;

    private Organization $sibling;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($this->college);
        $this->sibling = $this->makeCollegeStudentOrganization($this->college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
    }

    private function payload(int $schoolId, string $role = 'DEPARTMENT_HEAD'): array
    {
        return [
            'school_id' => $schoolId, 'first_name' => 'Rae', 'last_name' => 'Cruz', 'email' => "rae{$schoolId}@example.test",
            'role' => $role, 'password' => 'password123', 'password_confirmation' => 'password123',
        ];
    }

    public function test_an_admin_cannot_create_a_department_head(): void
    {
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/users', $this->payload(88000001))->assertUnprocessable()->assertJsonValidationErrors('role');

        $this->assertDatabaseMissing('users', ['school_id' => 88000001]);
    }

    public function test_an_admin_cannot_promote_a_member_to_department_head(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/users/'.$student->school_id, ['role' => 'DEPARTMENT_HEAD'])->assertUnprocessable()->assertJsonValidationErrors('role');

        $this->assertSame('STUDENT', $student->fresh()->role);
    }

    public function test_an_admin_cannot_import_a_department_head(): void
    {
        Sanctum::actingAs($this->admin);
        $csv = "school_id,first_name,last_name,email,role\n88000002,Rae,Cruz,rae88000002@example.test,DEPARTMENT_HEAD\n";

        $this->post('/api/users/import', ['file' => UploadedFile::fake()->createWithContent('roster.csv', $csv)], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonPath('summary.invalid', 1);

        $this->assertDatabaseMissing('users', ['school_id' => 88000002]);
    }

    public function test_an_admin_cannot_invite_a_department_head_and_sao_cannot_either(): void
    {
        $member = User::factory()->student()->create(['organization_id' => $this->sibling->id]);
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/account-profiles/invite', ['school_id' => $member->school_id, 'role' => 'DEPARTMENT_HEAD'])
            ->assertUnprocessable()->assertJsonValidationErrors('role');

        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]));
        $this->postJson('/api/account-profiles/invite', ['school_id' => $member->school_id, 'role' => 'DEPARTMENT_HEAD', 'organization_id' => $this->organization->id])
            ->assertUnprocessable()->assertJsonValidationErrors('role');

        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $member->school_id, 'role' => 'DEPARTMENT_HEAD']);
    }

    public function test_a_head_role_inside_a_student_organization_gets_no_college_scope(): void
    {
        $impostor = User::factory()->departmentHead()->create(['organization_id' => $this->organization->id]);

        $this->assertSame([$this->organization->id], $impostor->scopedOrganizationIds());

        Sanctum::actingAs($impostor);
        $this->getJson('/api/college/organizations')->assertForbidden();
        $this->postJson('/api/college/organizations', [])->assertForbidden();
        $this->getJson('/api/college/organizations/requirements')->assertForbidden();
    }

    public function test_a_head_in_a_college_home_organization_keeps_the_college_scope(): void
    {
        $head = $this->makeCollegeHead($this->college);

        $this->assertEqualsCanonicalizing([$this->organization->id, $this->sibling->id], $head->scopedOrganizationIds());

        Sanctum::actingAs($head);
        $this->getJson('/api/college/organizations')->assertOk();
    }

    public function test_an_admin_cannot_change_an_existing_department_head(): void
    {
        $head = User::factory()->departmentHead()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/users/'.$head->school_id, ['role' => 'STUDENT'])->assertForbidden();
        $this->putJson('/api/users/'.$head->school_id, ['first_name' => 'Renamed'])->assertForbidden();

        $this->assertSame('DEPARTMENT_HEAD', $head->fresh()->role);
    }
}
