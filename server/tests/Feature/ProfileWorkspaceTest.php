<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AccountProfile;
use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProfileWorkspaceTest extends TestCase
{
    use RefreshDatabase;

    private College $college;

    private Organization $home;

    private Organization $council;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $this->home = Organization::factory()->create(['college' => $this->college->name, 'college_id' => $this->college->id, 'organization_type' => 'COLLEGE', 'is_active' => true]);
        $this->council = Organization::factory()->create(['name' => 'Computing Council', 'college' => $this->college->name, 'college_id' => $this->college->id, 'organization_type' => 'STUDENT_ORGANIZATION', 'is_active' => true]);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->council->id]);
    }

    /** A person whose only profile is a plain member of the council, the shape an applicant or invited member can end up in. */
    private function councilOnlyMember(): array
    {
        $person = User::factory()->student()->create(['organization_id' => $this->council->id]);
        $profile = $person->accountProfiles()->where('organization_id', $this->council->id)->firstOrFail();

        return [$person, $profile];
    }

    public function test_promoting_a_person_with_only_an_organization_profile_gives_them_the_college_student_profile(): void
    {
        [$person, $profile] = $this->councilOnlyMember();
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'SBO_OFFICER'])->assertOk()->assertJsonPath('role', 'SBO_OFFICER');

        $this->assertSame('SBO_OFFICER', $profile->fresh()->role);
        $this->assertDatabaseHas('account_profiles', [
            'user_school_id' => $person->school_id, 'organization_id' => $this->home->id, 'role' => 'STUDENT', 'account_status' => 'active', 'position_title' => null,
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'student_profile_restored', 'organization_id' => $this->home->id, 'user_id' => $this->admin->school_id,
        ]);
        $this->assertSame(1, AccountProfile::where('user_school_id', $person->school_id)->where('role', 'STUDENT')->count());
    }

    public function test_a_person_who_already_has_a_student_profile_gets_no_second_one(): void
    {
        [$person, $profile] = $this->councilOnlyMember();
        $person->accountProfiles()->create(['organization_id' => $this->home->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'SBO_OFFICER'])->assertOk();

        $this->assertSame(1, AccountProfile::where('user_school_id', $person->school_id)->where('role', 'STUDENT')->count());
        $this->assertDatabaseMissing('audit_logs', ['action' => 'student_profile_restored']);
    }

    public function test_an_organization_without_a_known_college_leaves_the_promotion_as_it_was(): void
    {
        $loose = Organization::factory()->create(['name' => 'Loose Club', 'college' => $this->college->name, 'college_id' => null, 'organization_type' => 'STUDENT_ORGANIZATION', 'is_active' => true]);
        $admin = User::factory()->admin()->create(['organization_id' => $loose->id]);
        $person = User::factory()->student()->create(['organization_id' => $loose->id]);
        $profile = $person->accountProfiles()->where('organization_id', $loose->id)->firstOrFail();
        Sanctum::actingAs($admin);

        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'SBO_OFFICER'])->assertOk();

        $this->assertSame('SBO_OFFICER', $profile->fresh()->role);
        $this->assertSame(0, AccountProfile::where('user_school_id', $person->school_id)->where('role', 'STUDENT')->count());
        $this->assertDatabaseMissing('audit_logs', ['action' => 'student_profile_restored']);
    }

    public function test_a_faculty_adviser_promoted_in_another_organization_gets_no_college_student_profile(): void
    {
        $adviserHome = Organization::factory()->create(['name' => 'Robotics Club', 'college' => $this->college->name, 'college_id' => $this->college->id, 'organization_type' => 'STUDENT_ORGANIZATION', 'is_active' => true]);
        $adviser = User::factory()->admin()->position('Adviser')->create(['organization_id' => $adviserHome->id, 'account_status' => 'active']);
        $profile = $adviser->accountProfiles()->create(['organization_id' => $this->council->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'SBO_OFFICER'])->assertOk();

        $this->assertSame('SBO_OFFICER', $profile->fresh()->role);
        $this->assertSame(0, AccountProfile::where('user_school_id', $adviser->school_id)->where('organization_id', $this->home->id)->count());
        $this->assertSame(0, AccountProfile::where('user_school_id', $adviser->school_id)->where('role', 'STUDENT')->count());
        $this->assertDatabaseMissing('audit_logs', ['action' => 'student_profile_restored']);
    }

    public function test_a_person_holding_an_adviser_title_gets_no_student_profile_even_with_a_student_account_role(): void
    {
        $adviserHome = Organization::factory()->create(['name' => 'Robotics Club', 'college' => $this->college->name, 'college_id' => $this->college->id, 'organization_type' => 'STUDENT_ORGANIZATION', 'is_active' => true]);
        $person = User::factory()->student()->create(['organization_id' => $this->council->id, 'account_status' => 'active']);
        $person->accountProfiles()->create(['organization_id' => $adviserHome->id, 'role' => 'ADMIN', 'account_status' => 'active', 'position_title' => 'Adviser']);
        $profile = $person->accountProfiles()->where('organization_id', $this->council->id)->firstOrFail();
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'SBO_OFFICER'])->assertOk();

        $this->assertSame(0, AccountProfile::where('user_school_id', $person->school_id)->where('organization_id', $this->home->id)->count());
        $this->assertDatabaseMissing('audit_logs', ['action' => 'student_profile_restored']);
    }

    public function test_the_dean_promoting_a_real_student_to_admin_keeps_the_college_student_profile(): void
    {
        [$person, $profile] = $this->councilOnlyMember();
        $dean = User::factory()->departmentHead()->create(['organization_id' => $this->home->id, 'account_status' => 'active']);
        Sanctum::actingAs($dean);

        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'ADMIN'])->assertOk()->assertJsonPath('role', 'ADMIN');

        $this->assertDatabaseHas('account_profiles', [
            'user_school_id' => $person->school_id, 'organization_id' => $this->home->id, 'role' => 'STUDENT', 'account_status' => 'active',
        ]);
    }

    public function test_a_person_who_already_holds_another_profile_in_the_college_home_gets_nothing_created(): void
    {
        [$person, $profile] = $this->councilOnlyMember();
        $person->accountProfiles()->create(['organization_id' => $this->home->id, 'role' => 'ADMIN', 'account_status' => 'active']);
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'SBO_OFFICER'])->assertOk();

        $this->assertSame(1, AccountProfile::where('user_school_id', $person->school_id)->where('organization_id', $this->home->id)->count());
        $this->assertSame(0, AccountProfile::where('user_school_id', $person->school_id)->where('role', 'STUDENT')->count());
        $this->assertDatabaseMissing('audit_logs', ['action' => 'student_profile_restored']);
    }

    public function test_applicant_notice_points_to_the_menu_while_a_semester_is_active(): void
    {
        $this->grantNotice(withActiveSemester: true);

        $notice = \App\Models\Notification::where('title', 'You can apply for an organization')->firstOrFail();
        $this->assertStringContainsString('Open Apply for an organization in your menu.', $notice->message);
    }

    public function test_applicant_notice_says_applications_open_once_the_sao_starts_a_semester(): void
    {
        $this->grantNotice(withActiveSemester: false);

        $notice = \App\Models\Notification::where('title', 'You can apply for an organization')->firstOrFail();
        $this->assertStringContainsString('Applications open once the SAO starts a semester.', $notice->message);
        $this->assertStringNotContainsString('Open Apply for an organization in your menu.', $notice->message);
    }

    private function grantNotice(bool $withActiveSemester): void
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => $withActiveSemester ? 'active' : 'upcoming']);
        $dean = User::factory()->departmentHead()->create(['organization_id' => $this->home->id]);
        $student = User::factory()->student()->create(['organization_id' => $this->home->id]);
        Sanctum::actingAs($dean);

        $this->postJson('/api/college/applicant-grants', ['school_id' => $student->school_id])->assertCreated();
    }
}
