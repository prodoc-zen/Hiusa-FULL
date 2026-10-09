<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CollegeHierarchyTest extends TestCase
{
    use RefreshDatabase;

    private function migration(): object
    {
        return require database_path('migrations/2026_10_09_000001_add_college_hierarchy.php');
    }

    private function director(): User
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();

        return User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
    }

    private function homeOrganization(College $college, array $overrides = []): Organization
    {
        return Organization::factory()->create([
            'name' => $college->name,
            'college' => $college->name,
            'college_id' => $college->id,
            'organization_type' => 'COLLEGE',
            ...$overrides,
        ]);
    }

    public function test_migration_backfills_college_ids_creates_home_organizations_and_moves_heads(): void
    {
        $migration = $this->migration();
        $migration->down();

        $computing = College::create(['name' => 'College of Computing', 'code' => 'COC', 'is_active' => true]);
        $arts = College::create(['name' => 'College of Arts', 'is_active' => true]);
        $student = Organization::factory()->create(['college' => $computing->name, 'is_active' => false]);
        $collision = Organization::factory()->create(['name' => $arts->name, 'college' => $arts->name]);
        $stray = Organization::factory()->create(['college' => 'Unknown College']);
        $head = User::factory()->departmentHead()->create(['organization_id' => $student->id, 'department' => null]);
        $artsHead = User::factory()->departmentHead()->create(['organization_id' => $collision->id]);
        $strayHead = User::factory()->departmentHead()->create(['organization_id' => $stray->id]);
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();

        $migration->up();

        $this->assertSame($computing->id, (int) $student->fresh()->college_id);
        $this->assertSame('active', $student->fresh()->lifecycle_status);
        $this->assertFalse($student->fresh()->is_active);
        $this->assertNull($stray->fresh()->college_id);
        $this->assertNull($sao->fresh()->college_id);

        $home = Organization::where('organization_type', 'COLLEGE')->where('college_id', $computing->id)->firstOrFail();
        $this->assertSame('College of Computing', $home->name);
        $this->assertSame('COC', $home->acronym);
        $this->assertSame($computing->name, $home->college);
        $this->assertTrue($home->is_active);
        $this->assertSame('active', $home->lifecycle_status);
        $this->assertSame('college-of-computing', $home->slug);

        $artsHome = Organization::where('organization_type', 'COLLEGE')->where('college_id', $arts->id)->firstOrFail();
        $this->assertSame('College of Arts (College)', $artsHome->name);
        $this->assertNotSame($collision->slug, $artsHome->slug);

        $this->assertSame($home->id, (int) DB::table('users')->where('school_id', $head->school_id)->value('organization_id'));
        $this->assertSame('College of Computing', DB::table('users')->where('school_id', $head->school_id)->value('department'));
        $profiles = DB::table('account_profiles')->where('user_school_id', $head->school_id)->get();
        $this->assertCount(1, $profiles);
        $this->assertSame($home->id, (int) $profiles[0]->organization_id);
        $this->assertSame('DEPARTMENT_HEAD', $profiles[0]->role);
        $this->assertSame($artsHome->id, (int) DB::table('users')->where('school_id', $artsHead->school_id)->value('organization_id'));
        $this->assertSame($stray->id, (int) DB::table('users')->where('school_id', $strayHead->school_id)->value('organization_id'));
        $this->assertSame($stray->id, (int) DB::table('account_profiles')->where('user_school_id', $strayHead->school_id)->value('organization_id'));
        $this->assertSame(1, DB::table('account_profiles')->where('organization_id', $home->id)->count());
    }

    public function test_migration_keeps_the_profile_unique_constraint_when_a_head_already_has_a_home_profile(): void
    {
        $migration = $this->migration();
        $migration->down();

        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $student = Organization::factory()->create(['college' => $college->name]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $student->id]);
        $migration->up();
        $home = Organization::where('organization_type', 'COLLEGE')->where('college_id', $college->id)->firstOrFail();

        DB::table('account_profiles')->insert(['user_school_id' => $head->school_id, 'organization_id' => $student->id, 'role' => 'DEPARTMENT_HEAD', 'account_status' => 'active', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('users')->where('school_id', $head->school_id)->update(['organization_id' => $student->id]);
        $migration->up();

        $this->assertSame(1, Organization::where('organization_type', 'COLLEGE')->where('college_id', $college->id)->count());
        $this->assertSame([$home->id], DB::table('account_profiles')->where('user_school_id', $head->school_id)->pluck('organization_id')->map(fn ($id) => (int) $id)->all());
        $this->assertSame($home->id, (int) DB::table('users')->where('school_id', $head->school_id)->value('organization_id'));
    }

    public function test_migration_rolls_back_to_the_first_student_organization_and_runs_again(): void
    {
        $migration = $this->migration();
        $migration->down();
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $first = Organization::factory()->create(['college' => $college->name]);
        Organization::factory()->create(['college' => $college->name]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $first->id]);
        $migration->up();
        $this->assertTrue(Schema::hasColumn('organizations', 'college_id'));
        $this->assertTrue(Schema::hasColumn('organizations', 'lifecycle_status'));

        $migration->down();

        $this->assertFalse(Schema::hasColumn('organizations', 'college_id'));
        $this->assertFalse(Schema::hasColumn('organizations', 'lifecycle_status'));
        $this->assertFalse(Schema::hasColumn('organizations', 'archived_by'));
        $this->assertSame(0, Organization::where('organization_type', 'COLLEGE')->count());
        $this->assertSame($first->id, (int) DB::table('users')->where('school_id', $head->school_id)->value('organization_id'));
        $this->assertSame([$first->id], DB::table('account_profiles')->where('user_school_id', $head->school_id)->pluck('organization_id')->map(fn ($id) => (int) $id)->all());

        $migration->up();
        $this->assertTrue(Schema::hasColumn('organizations', 'college_id'));
        $this->assertSame(1, Organization::where('organization_type', 'COLLEGE')->count());
    }

    public function test_seeded_database_has_fixed_colleges_home_organizations_and_heads_in_them(): void
    {
        Storage::fake('local');
        $this->seed(DatabaseSeeder::class);

        $this->assertSame(['CBE', 'CCS', 'CHS', 'COE', 'CTE'], College::orderBy('code')->pluck('code')->all());
        foreach (College::all() as $college) {
            $home = Organization::where('organization_type', 'COLLEGE')->where('college_id', $college->id)->sole();
            $this->assertSame($college->name, $home->college);
            $this->assertSame(1, Organization::student()->where('college_id', $college->id)->count());
            $this->assertSame($home->id, $college->homeOrganization->id);
        }
        $heads = User::where('role', 'DEPARTMENT_HEAD')->get();
        $this->assertCount(5, $heads);
        foreach ($heads as $head) {
            $organization = Organization::find($head->organization_id);
            $this->assertSame('COLLEGE', $organization->organization_type);
            $this->assertSame($organization->college, $head->department);
        }
        $this->assertGreaterThan(0, ApprovalRequest::where('required_role', 'DEPARTMENT_HEAD')->where('status', 'approved')->count());
        $this->assertSame(0, ApprovalRequest::where('required_role', 'DEPARTMENT_HEAD')->where('status', 'approved')->whereNull('reviewed_by')->count());
        $this->assertSame(0, Organization::student()->where('organization_type', 'COLLEGE')->count());
        $this->assertSame(0, User::whereHas('organization', fn ($q) => $q->where('organization_type', 'COLLEGE'))->where('role', '!=', 'DEPARTMENT_HEAD')->count());
    }

    public function test_scoped_organization_ids_cover_a_heads_college_including_archived_organizations(): void
    {
        $ccs = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        $cbe = College::create(['name' => 'College of Business Education', 'code' => 'CBE']);
        $home = $this->homeOrganization($ccs);
        $first = Organization::factory()->create(['college' => $ccs->name, 'college_id' => $ccs->id]);
        $archived = Organization::factory()->create(['college' => $ccs->name, 'college_id' => $ccs->id, 'lifecycle_status' => 'archived', 'is_active' => false]);
        $other = Organization::factory()->create(['college' => $cbe->name, 'college_id' => $cbe->id]);
        $otherHome = $this->homeOrganization($cbe);
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $head = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $first->id]);

        $ids = $head->scopedOrganizationIds();

        $this->assertEqualsCanonicalizing([$first->id, $archived->id], $ids);
        $this->assertNotContains($home->id, $ids);
        $this->assertNotContains($other->id, $ids);
        $this->assertNotContains($otherHome->id, $ids);
        $this->assertNotContains($sao->id, $ids);
        $this->assertSame([$first->id], $admin->scopedOrganizationIds());
    }

    public function test_head_without_a_college_is_scoped_to_their_own_organization(): void
    {
        $organization = Organization::factory()->create(['college_id' => null]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);

        $this->assertSame([$organization->id], $head->scopedOrganizationIds());
    }

    public function test_college_relations_use_the_college_id(): void
    {
        $college = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        $home = $this->homeOrganization($college);
        $student = Organization::factory()->create(['college' => 'Stale Name', 'college_id' => $college->id])->fresh();

        $this->assertSame($college->id, $student->college()->first()->id);
        $this->assertSame($home->id, $college->homeOrganization->id);
        $this->assertEqualsCanonicalizing([$home->id, $student->id], $college->organizations()->pluck('id')->all());
        $this->assertTrue($student->isWritable());
        $this->assertFalse($student->isArchived());
        $student->lifecycle_status = 'archived';
        $this->assertTrue($student->isArchived());
        $this->assertFalse($student->isWritable());
    }

    public function test_student_scope_excludes_the_sao_and_college_home_organizations(): void
    {
        $college = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        $home = $this->homeOrganization($college);
        $student = Organization::factory()->create();

        $ids = Organization::student()->pluck('id')->all();

        $this->assertContains($student->id, $ids);
        $this->assertNotContains($home->id, $ids);
        $this->assertNotContains(Organization::where('slug', 'student-affairs-office')->value('id'), $ids);
    }

    public function test_public_organization_list_excludes_college_and_sao_organizations(): void
    {
        $college = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        $home = $this->homeOrganization($college);
        $student = Organization::factory()->create();

        $ids = collect($this->getJson('/api/organizations')->assertOk()->json())->pluck('id');
        $this->assertTrue($ids->contains($student->id));
        $this->assertFalse($ids->contains($home->id));

        $loginIds = collect($this->getJson('/api/organizations?for_login=1')->assertOk()->json());
        $this->assertFalse($loginIds->pluck('id')->contains($home->id));
        $this->assertTrue($loginIds->pluck('organization_type')->contains('SYSTEM_ADMINISTRATION'));
    }

    public function test_college_and_organization_creation_endpoints_no_longer_exist(): void
    {
        $director = $this->director();
        $college = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        Sanctum::actingAs($director);

        $this->postJson('/api/system/colleges', ['name' => 'New College'])->assertStatus(405);
        $this->putJson('/api/system/colleges/'.$college->id, ['name' => 'Renamed'])->assertNotFound();
        $this->deleteJson('/api/system/colleges/'.$college->id)->assertNotFound();
        $this->postJson('/api/system/organizations', ['name' => 'New Org', 'acronym' => 'NEW', 'college' => $college->name])->assertStatus(405);

        $this->assertDatabaseMissing('colleges', ['name' => 'New College']);
        $this->assertDatabaseMissing('organizations', ['name' => 'New Org']);
        $this->assertSame('College of Computer Studies', $college->fresh()->name);
    }

    public function test_college_list_counts_student_organizations_and_exposes_the_home_organization(): void
    {
        $college = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        $home = $this->homeOrganization($college);
        Organization::factory()->count(2)->create(['college' => $college->name, 'college_id' => $college->id]);
        Sanctum::actingAs($this->director());

        $row = collect($this->getJson('/api/system/colleges')->assertOk()->json())->firstWhere('id', $college->id);

        $this->assertSame(2, $row['organizations_count']);
        $this->assertSame($home->id, $row['home_organization_id']);
    }

    public function test_sao_cannot_edit_a_college_home_organization_or_an_archived_one(): void
    {
        $college = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        $home = $this->homeOrganization($college);
        $archived = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'lifecycle_status' => 'archived', 'is_active' => false]);
        Sanctum::actingAs($this->director());

        $this->putJson('/api/system/organizations/'.$home->id, ['color' => '#123ABC'])->assertForbidden()->assertJsonPath('message', 'College home organizations are managed through their college.');
        $this->putJson('/api/system/organizations/'.$archived->id, ['color' => '#123ABC'])->assertStatus(409)->assertJsonPath('message', 'Archived organizations cannot be edited.');
        $this->assertNull($archived->fresh()->color);
    }

    public function test_sao_changes_the_college_by_id_and_the_name_string_follows(): void
    {
        $ccs = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        $cbe = College::create(['name' => 'College of Business Education', 'code' => 'CBE']);
        $organization = Organization::factory()->create(['college' => $ccs->name, 'college_id' => $ccs->id]);
        Sanctum::actingAs($this->director());

        $this->putJson('/api/system/organizations/'.$organization->id, ['college_id' => $cbe->id])
            ->assertOk()->assertJsonPath('college', $cbe->name)->assertJsonPath('college_id', $cbe->id);
        $this->putJson('/api/system/organizations/'.$organization->id, ['college_id' => 99999])->assertUnprocessable()->assertJsonValidationErrors('college_id');

        $this->assertSame($cbe->name, $organization->fresh()->college);
    }
}
