<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\College;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class OrgAccessGrantTest extends TestCase
{
    use CreatesCollegeFixtures, RefreshDatabase;

    private College $computing;

    private College $arts;

    private Organization $computingHome;

    private Organization $computingOrg;

    private Organization $artsOrg;

    protected function setUp(): void
    {
        parent::setUp();

        $this->computing = $this->makeCollege('COC');
        $this->arts = $this->makeCollege('CAS');
        $this->computingHome = $this->makeCollegeHome($this->computing);
        $this->makeCollegeHome($this->arts);
        $this->computingOrg = $this->makeCollegeStudentOrganization($this->computing, ['name' => 'Computing Society']);
        $this->artsOrg = $this->makeCollegeStudentOrganization($this->arts, ['name' => 'Arts Guild']);
    }

    private function homeStudent(array $overrides = []): User
    {
        return User::factory()->student()->create(['organization_id' => $this->computingHome->id, ...$overrides]);
    }

    private function orgHead(Organization $organization): User
    {
        return User::factory()->admin()->create(['organization_id' => $organization->id]);
    }

    private function grant(User $actor, array $body)
    {
        Sanctum::actingAs($actor);

        return $this->postJson('/api/account-profiles/invite', $body);
    }

    public function test_the_dean_makes_a_student_org_head_in_their_own_college(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        $student = $this->homeStudent();
        SboPosition::create(['organization_id' => $this->computingOrg->id, 'role' => 'ADMIN', 'title' => 'President', 'is_active' => true]);

        $this->grant($dean, [
            'school_id' => $student->school_id, 'organization_id' => $this->computingOrg->id,
            'role' => 'ADMIN', 'position_title' => 'President',
        ])->assertCreated()->assertJsonPath('role', 'ADMIN')->assertJsonPath('position_title', 'President');

        $this->assertDatabaseHas('account_profiles', [
            'user_school_id' => $student->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'ADMIN', 'position_title' => 'President',
        ]);
        $this->assertSame($this->computingHome->id, $student->fresh()->organization_id);
    }

    public function test_the_dean_cannot_grant_in_another_college(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        $student = $this->homeStudent();

        $this->grant($dean, ['school_id' => $student->school_id, 'organization_id' => $this->artsOrg->id, 'role' => 'SBO_OFFICER'])
            ->assertNotFound();
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $student->school_id, 'organization_id' => $this->artsOrg->id]);
    }

    public function test_the_dean_cannot_grant_to_a_student_of_another_college(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        $outsider = User::factory()->student()->create(['organization_id' => $this->artsOrg->id]);

        $this->grant($dean, ['school_id' => $outsider->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'SBO_OFFICER'])
            ->assertUnprocessable()->assertJsonValidationErrors(['school_id']);
    }

    public function test_staff_and_the_dean_themselves_are_not_valid_targets(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        $staff = User::factory()->create(['role' => 'COLLEGE_STAFF', 'organization_id' => $this->computingHome->id]);

        $this->grant($dean, ['school_id' => $staff->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'SBO_OFFICER'])
            ->assertUnprocessable();
        $this->grant($dean, ['school_id' => $dean->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'SBO_OFFICER'])
            ->assertUnprocessable();
    }

    public function test_the_org_head_gives_an_officer_limited_modules(): void
    {
        $head = $this->orgHead($this->computingOrg);
        $student = $this->homeStudent();

        $this->grant($head, [
            'school_id' => $student->school_id, 'role' => 'SBO_OFFICER', 'modules' => ['events', 'tasks'],
        ])->assertCreated();

        $this->assertSame(['events', 'tasks'], AccountProfile::where('user_school_id', $student->school_id)
            ->where('organization_id', $this->computingOrg->id)->firstOrFail()->modules);
    }

    public function test_a_full_set_of_modules_is_stored_as_all(): void
    {
        $head = $this->orgHead($this->computingOrg);
        $student = $this->homeStudent();

        $this->grant($head, ['school_id' => $student->school_id, 'role' => 'SBO_OFFICER', 'modules' => AccountProfile::MODULES])->assertCreated();

        $this->assertNull(AccountProfile::where('user_school_id', $student->school_id)->where('organization_id', $this->computingOrg->id)->firstOrFail()->modules);
    }

    public function test_modules_only_apply_to_officers(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        $student = $this->homeStudent();

        $this->grant($dean, ['school_id' => $student->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'ADMIN', 'modules' => ['events']])->assertCreated();

        $this->assertNull(AccountProfile::where('user_school_id', $student->school_id)->where('organization_id', $this->computingOrg->id)->firstOrFail()->modules);
    }

    public function test_unknown_modules_and_an_empty_officer_set_are_rejected(): void
    {
        $head = $this->orgHead($this->computingOrg);
        $student = $this->homeStudent();

        $this->grant($head, ['school_id' => $student->school_id, 'role' => 'SBO_OFFICER', 'modules' => ['payroll']])
            ->assertUnprocessable()->assertJsonValidationErrors(['modules.0']);
        $this->grant($head, ['school_id' => $student->school_id, 'role' => 'SBO_OFFICER', 'modules' => []])
            ->assertUnprocessable()->assertJsonValidationErrors(['modules']);
    }

    public function test_the_org_head_cannot_grant_their_own_level(): void
    {
        $head = $this->orgHead($this->computingOrg);
        $student = $this->homeStudent();

        $this->grant($head, ['school_id' => $student->school_id, 'role' => 'ADMIN'])
            ->assertUnprocessable()->assertJsonValidationErrors(['role']);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $student->school_id, 'organization_id' => $this->computingOrg->id]);
    }

    public function test_the_org_head_cannot_grant_in_another_organization(): void
    {
        $head = $this->orgHead($this->computingOrg);
        $other = $this->makeCollegeStudentOrganization($this->computing, ['name' => 'Robotics Club']);
        $student = $this->homeStudent();

        $this->grant($head, ['school_id' => $student->school_id, 'organization_id' => $other->id, 'role' => 'STUDENT'])->assertNotFound();
    }

    public function test_an_officer_and_a_student_cannot_grant(): void
    {
        $student = $this->homeStudent();
        $officer = User::factory()->officer()->create(['organization_id' => $this->computingOrg->id]);
        $target = $this->homeStudent();

        foreach ([$officer, $student] as $actor) {
            $this->grant($actor, ['school_id' => $target->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'STUDENT'])->assertForbidden();
        }
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $target->school_id, 'organization_id' => $this->computingOrg->id]);
    }

    public function test_a_position_must_come_from_the_organizations_list(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        $student = $this->homeStudent();
        SboPosition::create(['organization_id' => $this->computingOrg->id, 'role' => 'SBO_OFFICER', 'title' => 'Secretary', 'is_active' => true]);

        $this->grant($dean, ['school_id' => $student->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Warlord'])
            ->assertUnprocessable()->assertJsonValidationErrors(['position_title']);
        $this->grant($dean, ['school_id' => $student->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Secretary'])
            ->assertCreated();
    }

    public function test_the_student_gets_a_notification_naming_the_organization_and_position(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        $student = $this->homeStudent();
        SboPosition::create(['organization_id' => $this->computingOrg->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer', 'is_active' => true]);

        $this->grant($dean, ['school_id' => $student->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Treasurer'])->assertCreated();

        $this->assertDatabaseHas('notifications', [
            'user_id' => $student->school_id,
            'message' => 'You now have access to '.$this->computingOrg->name.' as Treasurer.',
        ]);
        $this->assertSame(1, Notification::where('user_id', $student->school_id)->count());
    }

    public function test_granting_twice_is_refused(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        $student = $this->homeStudent();
        $body = ['school_id' => $student->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'STUDENT'];

        $this->grant($dean, $body)->assertCreated();
        $this->grant($dean, $body)->assertStatus(409);
        $this->assertSame(1, Notification::where('user_id', $student->school_id)->count());
    }

    public function test_an_officer_is_blocked_from_modules_that_were_not_ticked(): void
    {
        $officer = User::factory()->officer()->create(['organization_id' => $this->computingOrg->id]);
        $officer->accountProfiles()->where('organization_id', $this->computingOrg->id)->update(['modules' => ['events']]);
        Sanctum::actingAs($officer);

        $this->getJson('/api/events')->assertSuccessful();
        $this->getJson('/api/tasks')->assertForbidden();
        $this->getJson('/api/budgets')->assertForbidden();
        $this->getJson('/api/orders')->assertForbidden();
        $this->getJson('/api/elections')->assertForbidden();
        $this->getJson('/api/announcements')->assertForbidden();
        $this->getJson('/api/users')->assertForbidden();
        $this->getJson('/api/compliance/status')->assertForbidden();
    }

    public function test_an_officer_with_all_modules_and_an_org_head_are_never_blocked(): void
    {
        $officer = User::factory()->officer()->create(['organization_id' => $this->computingOrg->id]);
        Sanctum::actingAs($officer);
        $this->getJson('/api/tasks')->assertSuccessful();

        $head = $this->orgHead($this->computingOrg);
        $head->accountProfiles()->where('organization_id', $this->computingOrg->id)->update(['modules' => ['events']]);
        Sanctum::actingAs($head);
        $this->getJson('/api/tasks')->assertSuccessful();
    }

    public function test_the_signed_in_user_payload_carries_the_active_profiles_modules(): void
    {
        $officer = User::factory()->officer()->create(['organization_id' => $this->computingOrg->id]);
        $officer->accountProfiles()->where('organization_id', $this->computingOrg->id)->update(['modules' => ['events', 'tasks']]);
        Sanctum::actingAs($officer);

        $this->getJson('/api/user')->assertOk()->assertJsonPath('modules', ['events', 'tasks']);
    }

    public function test_the_list_shows_position_and_modules(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        $student = $this->homeStudent();
        AccountProfile::create([
            'user_school_id' => $student->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'SBO_OFFICER',
            'account_status' => 'active', 'position_title' => 'Secretary', 'modules' => ['events'],
        ]);
        Sanctum::actingAs($dean);

        $this->getJson('/api/account-profiles?organization_id='.$this->computingOrg->id)->assertOk()
            ->assertJsonPath('data.0.position_title', 'Secretary')->assertJsonPath('data.0.modules', ['events']);
    }

    public function test_the_dean_changes_modules_and_the_org_head_cannot_touch_another_head(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        $head = $this->orgHead($this->computingOrg);
        $student = $this->homeStudent();
        $profile = AccountProfile::create([
            'user_school_id' => $student->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active',
        ]);

        Sanctum::actingAs($dean);
        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'SBO_OFFICER', 'modules' => ['finance']])
            ->assertOk()->assertJsonPath('modules', ['finance']);

        $coHead = AccountProfile::create([
            'user_school_id' => $this->homeStudent()->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'ADMIN', 'account_status' => 'active',
        ]);
        Sanctum::actingAs($head);
        $this->putJson('/api/account-profiles/'.$coHead->id, ['role' => 'SBO_OFFICER', 'modules' => ['finance']])->assertForbidden();
        $this->putJson('/api/account-profiles/'.$profile->id, ['role' => 'ADMIN'])->assertUnprocessable();
    }

    public function test_the_dean_removes_a_head_but_not_their_own_profile_and_never_the_account(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        $head = $this->orgHead($this->computingOrg);
        $second = AccountProfile::create([
            'user_school_id' => $this->homeStudent()->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'ADMIN', 'account_status' => 'active',
        ]);
        Sanctum::actingAs($dean);

        $this->deleteJson('/api/account-profiles/'.$second->id)->assertOk();
        $this->assertDatabaseMissing('account_profiles', ['id' => $second->id]);

        $deanProfile = $dean->accountProfiles()->firstOrFail();
        $this->deleteJson('/api/account-profiles/'.$deanProfile->id)->assertNotFound();
        $this->assertDatabaseHas('account_profiles', ['id' => $deanProfile->id]);

        $onlyProfile = $head->accountProfiles()->where('organization_id', $this->computingOrg->id)->firstOrFail();
        $this->deleteJson('/api/account-profiles/'.$onlyProfile->id)->assertUnprocessable();
        $this->assertDatabaseHas('users', ['school_id' => $head->school_id]);
    }

    public function test_the_dean_cannot_remove_access_in_another_college(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        $artsHead = $this->orgHead($this->artsOrg);
        Sanctum::actingAs($dean);

        $this->deleteJson('/api/account-profiles/'.$artsHead->accountProfiles()->firstOrFail()->id)->assertNotFound();
    }

    public function test_the_org_head_removes_an_officer(): void
    {
        $head = $this->orgHead($this->computingOrg);
        $student = $this->homeStudent();
        $profile = AccountProfile::create([
            'user_school_id' => $student->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active',
        ]);
        Sanctum::actingAs($head);

        $this->deleteJson('/api/account-profiles/'.$profile->id)->assertOk()->assertJsonPath('account_deleted', false);
        $this->assertDatabaseHas('users', ['school_id' => $student->school_id]);
    }

    public function test_the_dean_sees_positions_for_an_org_in_their_college_only(): void
    {
        $dean = $this->makeCollegeHead($this->computing);
        SboPosition::create(['organization_id' => $this->computingOrg->id, 'role' => 'ADMIN', 'title' => 'President', 'is_active' => true]);
        SboPosition::create(['organization_id' => $this->computingOrg->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer', 'is_active' => false]);
        Sanctum::actingAs($dean);

        $this->getJson('/api/account-profiles/positions?organization_id='.$this->computingOrg->id)->assertOk()
            ->assertJsonCount(1)->assertJsonPath('0.title', 'President');
        $this->getJson('/api/account-profiles/positions?organization_id='.$this->artsOrg->id)->assertNotFound();
    }
}
