<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\DepartmentHeadInvitation;
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

    public function test_sao_adds_a_college_and_its_home_organization_is_created(): void
    {
        $this->actingAsSao();

        $response = $this->postJson('/api/system/colleges', ['name' => 'College of Law', 'code' => 'LAW', 'color' => '#0B8ED0'])
            ->assertCreated()
            ->assertJsonPath('name', 'College of Law')
            ->assertJsonPath('code', 'LAW')
            ->assertJsonPath('color', '#0B8ED0')
            ->assertJsonPath('is_active', true)
            ->assertJsonPath('can_delete', true);

        $college = College::findOrFail($response->json('id'));
        $home = Organization::where('college_id', $college->id)->where('organization_type', 'COLLEGE')->firstOrFail();
        $this->assertSame($home->id, $response->json('home_organization_id'));
        $this->assertSame('LAW', $home->acronym);
        $this->assertSame('College of Law', $home->college);
        $this->assertTrue($home->is_active);
        $this->assertSame('active', $home->lifecycle_status);
        $this->assertDatabaseHas('audit_logs', ['module' => 'colleges', 'action' => 'created', 'record_id' => $college->id]);
    }

    public function test_adding_a_college_rejects_a_duplicate_name_or_code_and_a_bad_color(): void
    {
        College::create(['name' => 'Taken College', 'code' => 'TKN', 'is_active' => true]);
        $this->actingAsSao();

        $this->postJson('/api/system/colleges', ['name' => 'Taken College'])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->postJson('/api/system/colleges', ['name' => 'Another', 'code' => 'TKN'])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->postJson('/api/system/colleges', ['name' => 'Another', 'color' => 'blue'])->assertUnprocessable()->assertJsonValidationErrors('color');
        $this->postJson('/api/system/colleges', [])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->assertDatabaseMissing('colleges', ['name' => 'Another']);
    }

    public function test_only_the_sao_can_add_or_delete_a_college(): void
    {
        $college = College::create(['name' => 'Empty College', 'is_active' => true]);
        $organization = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id]);
        $home = Organization::factory()->create(['organization_type' => 'COLLEGE', 'college' => $college->name, 'college_id' => $college->id]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $home->id]);

        foreach ([$head, User::factory()->admin()->create(['organization_id' => $organization->id])] as $caller) {
            Sanctum::actingAs($caller);
            $this->postJson('/api/system/colleges', ['name' => 'New College'])->assertForbidden();
            $this->deleteJson('/api/system/colleges/'.$college->id)->assertForbidden();
        }
        $this->assertDatabaseMissing('colleges', ['name' => 'New College']);
        $this->assertNotNull($college->fresh());
    }

    public function test_an_empty_college_is_deleted_with_its_home_organization(): void
    {
        $this->actingAsSao();
        $id = $this->postJson('/api/system/colleges', ['name' => 'Mistake College', 'code' => 'MIS'])->assertCreated()->json('id');

        $this->deleteJson('/api/system/colleges/'.$id)->assertNoContent();

        $this->assertDatabaseMissing('colleges', ['id' => $id]);
        $this->assertDatabaseMissing('organizations', ['college_id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['module' => 'colleges', 'action' => 'deleted', 'record_id' => $id]);
        $this->postJson('/api/system/colleges', ['name' => 'Mistake College', 'code' => 'MIS'])->assertCreated();
    }

    public function test_a_college_with_a_student_organization_cannot_be_deleted(): void
    {
        $college = College::create(['name' => 'Busy College', 'is_active' => true]);
        Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'is_active' => false, 'lifecycle_status' => 'archived']);
        $this->actingAsSao();

        $this->assertBlocked($college);
    }

    public function test_a_college_with_people_on_its_home_organization_cannot_be_deleted(): void
    {
        $college = College::create(['name' => 'Staffed College', 'is_active' => true]);
        $home = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE']);
        User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $this->actingAsSao();

        $this->assertBlocked($college);
        $this->assertNotNull($home->fresh());
    }

    public function test_a_college_with_a_pending_dean_invitation_cannot_be_deleted_but_an_expired_one_does_not_block(): void
    {
        $college = College::create(['name' => 'Invited College', 'is_active' => true]);
        $home = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE']);
        $sao = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        $invitation = DepartmentHeadInvitation::create([
            'college_id' => $college->id,
            'role' => 'DEPARTMENT_HEAD',
            'token_hash' => hash('sha256', 'pending-link'),
            'invited_by' => $sao->school_id,
            'expires_at' => now()->addHours(48),
        ]);
        Sanctum::actingAs($sao);

        $this->assertBlocked($college);

        $invitation->update(['expires_at' => now()->subMinute()]);
        $this->deleteJson('/api/system/colleges/'.$college->id)->assertNoContent();
        $this->assertDatabaseMissing('colleges', ['id' => $college->id]);
        $this->assertDatabaseMissing('organizations', ['id' => $home->id]);
    }

    public function test_the_college_list_says_which_colleges_can_be_deleted(): void
    {
        $empty = College::create(['name' => 'A Empty College', 'is_active' => true]);
        $busy = College::create(['name' => 'B Busy College', 'is_active' => true]);
        Organization::factory()->create(['college' => $busy->name, 'college_id' => $busy->id]);
        $this->actingAsSao();

        $rows = collect($this->getJson('/api/system/colleges')->assertOk()->json())->keyBy('id');

        $this->assertTrue($rows[$empty->id]['can_delete']);
        $this->assertFalse($rows[$busy->id]['can_delete']);
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

    public function test_renaming_a_college_renames_its_home_organization_and_its_slug(): void
    {
        $this->actingAsSao();
        $id = $this->postJson('/api/system/colleges', ['name' => '34', 'code' => 'ENG'])->assertCreated()->json('id');
        $home = Organization::where('college_id', $id)->where('organization_type', 'COLLEGE')->firstOrFail();
        $this->assertSame('34', $home->name);

        $this->putJson('/api/system/colleges/'.$id, ['name' => 'College of Engineering', 'code' => 'ENG'])->assertOk();

        $this->assertSame('College of Engineering', $home->fresh()->name);
        $this->assertSame('college-of-engineering', $home->fresh()->slug);
        $this->assertSame('College of Engineering', $home->fresh()->college);
    }

    public function test_renaming_a_college_to_a_name_a_student_organization_holds_keeps_the_college_tag_and_a_free_slug(): void
    {
        Organization::factory()->create(['name' => 'College of Law', 'slug' => 'college-of-law']);
        $this->actingAsSao();
        $id = $this->postJson('/api/system/colleges', ['name' => 'Law School', 'code' => 'LAW'])->assertCreated()->json('id');
        $home = Organization::where('college_id', $id)->where('organization_type', 'COLLEGE')->firstOrFail();

        $this->putJson('/api/system/colleges/'.$id, ['name' => 'College of Law', 'code' => 'LAW'])->assertOk();

        $this->assertSame('College of Law (College)', $home->fresh()->name);
        $this->assertSame('college-of-law-college', $home->fresh()->slug);
    }

    public function test_saving_a_college_without_renaming_it_leaves_its_home_name_and_slug_alone(): void
    {
        $this->actingAsSao();
        $id = $this->postJson('/api/system/colleges', ['name' => 'Law School', 'code' => 'LAW'])->assertCreated()->json('id');
        $home = Organization::where('college_id', $id)->where('organization_type', 'COLLEGE')->firstOrFail();
        $home->update(['name' => 'Law School (College)', 'slug' => 'law-school-college']);

        $this->putJson('/api/system/colleges/'.$id, ['name' => 'Law School', 'code' => 'LWS'])->assertOk();

        $this->assertSame('Law School (College)', $home->fresh()->name);
        $this->assertSame('law-school-college', $home->fresh()->slug);
        $this->assertSame('LWS', $home->fresh()->acronym);
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

    private function assertBlocked(College $college): void
    {
        $this->deleteJson('/api/system/colleges/'.$college->id)
            ->assertStatus(409)
            ->assertJsonPath('message', 'This college still has organizations or people. Archive it instead.');
        $this->assertNotNull(College::find($college->id));
    }

    private function actingAsSao(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => $sao->id]));
    }
}
