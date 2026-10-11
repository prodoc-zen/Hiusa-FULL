<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class CollegeHierarchyPolishTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private function director(): User
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();

        return User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
    }

    public function test_sao_edit_ignores_is_active_and_college_changes_but_keeps_editing_details(): void
    {
        $computing = $this->makeCollege('CCS');
        $business = $this->makeCollege('CBE');
        $organization = $this->makeCollegeStudentOrganization($computing, ['is_active' => true, 'lifecycle_status' => 'active']);
        Sanctum::actingAs($this->director());

        $this->putJson('/api/system/organizations/'.$organization->id, [
            'name' => 'Renamed Society',
            'description' => 'New description',
            'is_active' => false,
            'college_id' => $business->id,
            'college' => $business->name,
        ])->assertOk()->assertJsonPath('name', 'Renamed Society');

        $fresh = $organization->fresh();
        $this->assertSame('Renamed Society', $fresh->name);
        $this->assertSame('New description', $fresh->description);
        $this->assertTrue($fresh->is_active);
        $this->assertSame('active', $fresh->lifecycle_status);
        $this->assertSame($computing->id, $fresh->college_id);
        $this->assertSame($computing->name, $fresh->college);
        $this->assertDatabaseHas('audit_logs', ['organization_id' => $organization->id, 'action' => 'organization_updated']);
    }

    public function test_a_seeded_department_head_payload_names_their_college_and_never_a_student_organization(): void
    {
        $this->seed(DatabaseSeeder::class);
        $college = College::where('name', 'College of Computer Studies')->firstOrFail();

        $login = $this->postJson('/api/login', ['school_id' => 940001, 'password' => 'Demo@12345'])->assertOk();
        $login->assertJsonPath('user.role', 'DEPARTMENT_HEAD')
            ->assertJsonPath('user.organization.college_id', $college->id)
            ->assertJsonPath('user.organization.college', 'College of Computer Studies')
            ->assertJsonPath('user.organization.name', 'College of Computer Studies')
            ->assertJsonPath('user.organization.organization_type', 'COLLEGE');
        $this->assertStringNotContainsString('PSITS', json_encode($login->json('user.organization')));

        Sanctum::actingAs(User::findOrFail(940001));
        $this->getJson('/api/user')->assertOk()->assertJsonPath('organization.college_id', $college->id);
    }

    public function test_head_list_carries_role_counts_and_leadership_for_their_college_only(): void
    {
        $computing = $this->makeCollege('CCS');
        $business = $this->makeCollege('CBE');
        $society = $this->makeCollegeStudentOrganization($computing, ['lifecycle_status' => 'active']);
        $guild = $this->makeCollegeStudentOrganization($computing, ['lifecycle_status' => 'active']);
        $outside = $this->makeCollegeStudentOrganization($business, ['lifecycle_status' => 'active']);
        $head = $this->makeCollegeHead($computing);
        $otherHead = $this->makeCollegeHead($business);

        User::factory()->admin()->create(['organization_id' => $society->id, 'first_name' => 'Ada', 'last_name' => 'Admin']);
        User::factory()->officer()->create(['organization_id' => $society->id, 'first_name' => 'Pia', 'last_name' => 'President', 'position_title' => 'President']);
        User::factory()->officer()->create(['organization_id' => $society->id, 'first_name' => 'Sam', 'last_name' => 'Secretary', 'position_title' => 'Secretary']);
        User::factory()->student()->count(3)->create(['organization_id' => $society->id]);
        User::factory()->student()->create(['organization_id' => $society->id, 'account_status' => 'inactive']);
        User::factory()->student()->create(['organization_id' => $guild->id]);
        User::factory()->admin()->count(2)->create(['organization_id' => $outside->id]);
        User::factory()->student()->count(5)->create(['organization_id' => $outside->id]);

        Sanctum::actingAs($head);
        $rows = collect($this->getJson('/api/college/organizations')->assertOk()->json('data'))->keyBy('id');

        $this->assertSame([$society->id, $guild->id], $rows->keys()->sort()->values()->all());
        $this->assertSame(['admin' => 1, 'sbo_officer' => 2, 'student' => 3], $rows[$society->id]['role_counts']);
        $this->assertSame(['admin' => 0, 'sbo_officer' => 0, 'student' => 1], $rows[$guild->id]['role_counts']);
        $this->assertSame(
            [['Ada Admin', 'ADMIN', null], ['Pia President', 'SBO_OFFICER', 'President'], ['Sam Secretary', 'SBO_OFFICER', 'Secretary']],
            collect($rows[$society->id]['leadership'])->map(fn ($leader) => [$leader['name'], $leader['role'], $leader['position_title']])->all(),
        );
        $this->assertSame([], $rows[$guild->id]['leadership']);
        $this->assertStringNotContainsString('email', json_encode($rows[$society->id]['leadership']));

        Sanctum::actingAs($otherHead);
        $others = collect($this->getJson('/api/college/organizations')->assertOk()->json('data'))->keyBy('id');
        $this->assertSame([$outside->id], $others->keys()->all());
        $this->assertSame(['admin' => 2, 'sbo_officer' => 0, 'student' => 5], $others[$outside->id]['role_counts']);
    }

    public function test_a_head_with_no_organizations_gets_an_empty_list_and_other_roles_are_refused(): void
    {
        $computing = $this->makeCollege('CCS');
        $business = $this->makeCollege('CBE');
        $foreign = $this->makeCollegeStudentOrganization($business, ['lifecycle_status' => 'active']);
        User::factory()->admin()->create(['organization_id' => $foreign->id]);
        $head = $this->makeCollegeHead($computing);

        Sanctum::actingAs($head);
        $this->getJson('/api/college/organizations')->assertOk()->assertJsonPath('total', 0)->assertJsonPath('data', []);

        $admin = User::factory()->admin()->create(['organization_id' => $foreign->id]);
        Sanctum::actingAs($admin);
        $this->getJson('/api/college/organizations')->assertForbidden();
        $this->getJson('/api/college/overview')->assertForbidden();
    }

    public function test_college_overview_names_the_college_its_logo_and_the_head(): void
    {
        $computing = $this->makeCollege('CCS');
        $computing->update(['logo_url' => 'https://example.test/ccs.png', 'color' => '#0B8ED0']);
        $head = $this->makeCollegeHead($computing, ['first_name' => 'Ramon', 'last_name' => 'Castillo']);
        Sanctum::actingAs($head);

        $this->getJson('/api/college/overview')->assertOk()
            ->assertJsonPath('college.id', $computing->id)
            ->assertJsonPath('college.name', 'College of CCS')
            ->assertJsonPath('college.logo_url', 'https://example.test/ccs.png')
            ->assertJsonPath('head.name', 'Ramon Castillo');
    }
}
