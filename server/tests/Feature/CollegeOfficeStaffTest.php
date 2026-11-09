<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\ApprovalRequest;
use App\Models\College;
use App\Models\DepartmentHeadInvitation;
use App\Models\Event;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * Office staff are faculty or other people the dean gives access to, never students. They sit on the college home
 * organization with an ADMIN profile and reach every student organization in the college, but never the SAO's
 * powers and never the dean's own staff and invitation controls. They arrive through a link, like the dean does.
 */
class CollegeOfficeStaffTest extends TestCase
{
    use CreatesCollegeFixtures, RefreshDatabase;

    private const NOT_STUDENTS = 'Students cannot be office staff. Pick someone from the employee records.';

    private College $computing;

    private College $arts;

    private Organization $home;

    private Organization $artsHome;

    private Organization $psits;

    private Organization $artsClub;

    private User $dean;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();

        $this->computing = $this->makeCollege('COC');
        $this->arts = $this->makeCollege('CAS');
        $this->home = $this->makeCollegeHome($this->computing);
        $this->artsHome = $this->makeCollegeHome($this->arts);
        $this->psits = $this->makeCollegeStudentOrganization($this->computing, ['name' => 'PSITS']);
        $this->artsClub = $this->makeCollegeStudentOrganization($this->arts, ['name' => 'Arts Club']);
        $this->dean = $this->makeCollegeHead($this->computing);
    }

    private function staffMember(array $overrides = []): User
    {
        return User::factory()->admin()->create(['organization_id' => $this->home->id, 'position_title' => 'College Secretary', ...$overrides]);
    }

    private function employee(int $schoolId, string $first = 'Marites', string $last = 'Faculty', array $overrides = []): StudentRegistryEntry
    {
        return StudentRegistryEntry::create([
            'record_type' => 'employee', 'school_id' => $schoolId, 'first_name' => $first, 'last_name' => $last,
            'birth_date' => '1988-05-17', 'college_id' => $this->computing->id,
            'program' => null, 'year_level' => null, 'position' => 'Department Secretary', ...$overrides,
        ]);
    }

    private function invite(array $body, ?User $actor = null)
    {
        return $this->actingAs($actor ?? $this->dean)->postJson('/api/college/staff/invitations', $body);
    }

    private function token(array $response): string
    {
        parse_str((string) parse_url($response['magic_link'], PHP_URL_QUERY), $query);

        return $query['token'];
    }

    // ---- S0: a delegate with college-level reach ----

    public function test_office_staff_reach_every_organization_in_the_college_and_none_in_another(): void
    {
        $staff = $this->staffMember();
        $this->assertEqualsCanonicalizing($this->dean->scopedOrganizationIds(), $staff->scopedOrganizationIds());
        $this->assertContains($this->psits->id, $staff->scopedOrganizationIds());
        $this->assertNotContains($this->artsClub->id, $staff->scopedOrganizationIds());

        Sanctum::actingAs($staff);
        $listed = collect($this->getJson('/api/college/organizations')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertContains($this->psits->id, $listed);
        $this->assertNotContains($this->artsClub->id, $listed);
        $this->getJson('/api/college/overview')->assertOk();
        foreach (['students', 'staff', 'leaders'] as $tab) {
            $this->getJson('/api/college/people?tab='.$tab)->assertOk();
        }
        $this->getJson('/api/college/staff')->assertOk()->assertJsonFragment(['school_id' => $staff->school_id]);
        $this->getJson("/api/college/organizations/{$this->psits->id}/space")->assertOk();
        $this->getJson("/api/college/organizations/{$this->artsClub->id}/space")->assertForbidden();
    }

    public function test_office_staff_see_and_decide_the_deans_approval_steps_for_every_college_organization(): void
    {
        $staff = $this->staffMember();
        $officer = User::factory()->officer()->create(['organization_id' => $this->psits->id]);
        $event = Event::factory()->create(['organization_id' => $this->psits->id, 'created_by' => $officer->id, 'status' => 'planning']);
        $deanStep = $this->approval($this->psits, $event->id, $officer, 'DEPARTMENT_HEAD');
        $adviserStep = $this->approval($this->psits, $event->id + 1, $officer, 'ADMIN');
        $foreign = $this->approval($this->artsClub, $event->id + 2, $officer, 'DEPARTMENT_HEAD');

        Sanctum::actingAs($staff);
        $listed = collect($this->getJson('/api/approval-requests')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertContains($deanStep->id, $listed);
        $this->assertNotContains($adviserStep->id, $listed, 'staff stand in for the dean, not for an organization adviser');
        $this->assertNotContains($foreign->id, $listed);

        $this->patchJson('/api/approval-requests/'.$adviserStep->id, ['status' => 'approved'])->assertForbidden();
        $this->patchJson('/api/approval-requests/'.$foreign->id, ['status' => 'approved'])->assertNotFound();
        $this->patchJson('/api/approval-requests/'.$deanStep->id, ['status' => 'approved'])->assertOk();
        $this->assertSame('approved', $event->fresh()->status);
    }

    private function approval(Organization $organization, int $entityId, User $requester, string $role): ApprovalRequest
    {
        return ApprovalRequest::create([
            'organization_id' => $organization->id, 'entity_type' => 'event', 'entity_id' => $entityId,
            'requested_by' => $requester->school_id, 'required_role' => $role, 'status' => 'pending', 'requested_at' => now()->subHour(),
        ]);
    }

    public function test_office_staff_open_the_college_files_and_applications_of_their_own_college_only(): void
    {
        Sanctum::actingAs($this->staffMember());

        $this->getJson('/api/compliance/documents')->assertOk();
        $this->getJson('/api/compliance/documents?organization_id='.$this->psits->id)->assertOk();
        $this->getJson('/api/compliance/documents?organization_id='.$this->artsClub->id)->assertForbidden();
        $this->getJson('/api/organization-applications')->assertOk();
    }

    public function test_office_staff_never_get_sao_powers_and_cannot_invite_or_remove_staff_or_deans(): void
    {
        $other = $this->staffMember();
        $staff = $this->staffMember();
        $this->employee(70000001);

        Sanctum::actingAs($staff);
        $this->postJson('/api/college/staff/invitations', ['registry_school_id' => 70000001])->assertForbidden();
        $this->getJson('/api/college/staff/invitations')->assertForbidden();
        $this->getJson('/api/college/staff/records')->assertForbidden();
        $this->deleteJson('/api/college/staff/'.$other->school_id)->assertForbidden();
        $this->postJson('/api/college/applicant-grants', ['school_id' => 1])->assertForbidden();
        $this->getJson('/api/system/colleges')->assertForbidden();
        $this->postJson("/api/system/colleges/{$this->computing->id}/invite-department-head", [])->assertForbidden();
    }

    public function test_an_org_adviser_is_not_college_office_staff(): void
    {
        $adviser = User::factory()->admin()->create(['organization_id' => $this->psits->id]);
        $this->assertSame([$this->psits->id], $adviser->scopedOrganizationIds());

        Sanctum::actingAs($adviser);
        $this->getJson('/api/college/organizations')->assertForbidden();
        $this->getJson('/api/college/people?tab=students')->assertForbidden();
    }

    // ---- S1: only office staff and deans count as already on staff ----

    public function test_a_student_in_the_home_org_is_not_reported_as_already_on_staff(): void
    {
        $maria = User::factory()->student()->create(['school_id' => 78978990, 'organization_id' => $this->home->id]);
        $this->employee(78978990, 'Maria', 'Santos');

        $message = $this->invite(['registry_school_id' => 78978990])->assertUnprocessable()->json('errors.registry_school_id.0');
        $this->assertSame(self::NOT_STUDENTS, $message);
        $this->assertDatabaseMissing('department_head_invitations', ['registry_school_id' => $maria->school_id]);
    }

    public function test_a_person_on_the_office_staff_or_the_dean_is_reported_as_already_on_staff(): void
    {
        $staff = $this->staffMember(['school_id' => 70000002]);
        $this->employee(70000002);
        $this->employee($this->dean->school_id, 'Dean', 'Santos');

        $this->invite(['registry_school_id' => 70000002])->assertUnprocessable()
            ->assertJsonPath('errors.registry_school_id.0', 'This person is already on the college office staff.');
        $this->invite(['registry_school_id' => $this->dean->school_id])->assertUnprocessable()
            ->assertJsonPath('errors.registry_school_id.0', 'This person is already on the college office staff.');

        $secondary = User::factory()->adviser()->create(['school_id' => 70000003, 'organization_id' => $this->psits->id]);
        $this->employee(70000003);
        AccountProfile::create(['user_school_id' => $secondary->school_id, 'organization_id' => $this->home->id, 'role' => 'ADMIN', 'position_title' => 'Clerk', 'account_status' => 'active']);
        $this->invite(['registry_school_id' => 70000003])->assertUnprocessable()
            ->assertJsonPath('errors.registry_school_id.0', 'This person is already on the college office staff.');
        $this->assertSame(70000002, $staff->school_id);
    }

    // ---- S2: office staff are never students ----

    public function test_a_student_cannot_be_invited_as_staff_by_record_account_or_profile(): void
    {
        StudentRegistryEntry::create([
            'school_id' => 70000010, 'first_name' => 'Stu', 'last_name' => 'Dent', 'birth_date' => '2007-01-02',
            'college_id' => $this->computing->id, 'program' => 'BSIT', 'year_level' => '1st Year',
        ]);
        $this->invite(['registry_school_id' => 70000010])->assertUnprocessable()->assertJsonPath('errors.registry_school_id.0', self::NOT_STUDENTS);

        $this->employee(70000011);
        User::factory()->student()->create(['school_id' => 70000011, 'organization_id' => $this->psits->id]);
        $this->invite(['registry_school_id' => 70000011])->assertUnprocessable()->assertJsonPath('errors.registry_school_id.0', self::NOT_STUDENTS);

        $marco = User::factory()->officer()->create(['school_id' => 900001, 'organization_id' => $this->psits->id, 'first_name' => 'Marco', 'last_name' => 'Dela Cruz']);
        $this->employee(900001, 'Marco', 'Dela Cruz');
        $this->invite(['registry_school_id' => 900001])->assertUnprocessable()->assertJsonPath('errors.registry_school_id.0', self::NOT_STUDENTS);

        $this->invite(['position_title' => 'Clerk', 'first_name' => 'Marco', 'last_name' => 'Dela Cruz', 'email' => $marco->email])
            ->assertUnprocessable()->assertJsonPath('errors.email.0', self::NOT_STUDENTS);

        $this->assertSame(0, DepartmentHeadInvitation::count());
    }

    public function test_a_disabled_account_the_sao_and_another_colleges_employee_cannot_be_invited(): void
    {
        $this->employee(70000040);
        User::factory()->adviser()->create(['school_id' => 70000040, 'organization_id' => $this->psits->id, 'account_status' => 'disabled']);
        $this->employee(70000041);
        User::factory()->superAdmin()->create(['school_id' => 70000041]);
        $this->employee(70000042, 'Other', 'College', ['college_id' => $this->arts->id]);

        foreach ([70000040, 70000041, 70000042] as $schoolId) {
            $this->invite(['registry_school_id' => $schoolId])->assertUnprocessable()->assertJsonValidationErrors('registry_school_id');
        }
        $this->assertSame(0, DepartmentHeadInvitation::count());
    }

    public function test_the_staff_record_search_lists_employees_only_and_never_a_student(): void
    {
        $this->employee(70000020, 'Elena', 'Faculty');
        StudentRegistryEntry::create([
            'school_id' => 70000021, 'first_name' => 'Elena', 'last_name' => 'Student', 'birth_date' => '2007-01-02',
            'college_id' => $this->computing->id, 'program' => 'BSIT', 'year_level' => '1st Year',
        ]);
        $this->employee(70000022, 'Elena', 'Enrolled');
        User::factory()->student()->create(['school_id' => 70000022, 'organization_id' => $this->psits->id]);
        $this->employee(70000023, 'Elena', 'Withaccount');
        User::factory()->adviser()->create(['school_id' => 70000023, 'organization_id' => $this->psits->id]);

        $found = collect($this->actingAs($this->dean)->getJson('/api/college/staff/records?q=Elena')->assertOk()->json('data'))->pluck('school_id')->all();

        $this->assertEqualsCanonicalizing([70000020, 70000023], $found);
    }

    public function test_a_non_student_who_is_not_in_the_records_can_be_invited_by_name_and_email(): void
    {
        $response = $this->invite(['position_title' => 'Lab Technician', 'first_name' => 'Ramon', 'last_name' => 'Cruz', 'email' => 'Ramon@Example.edu'])->assertCreated();

        $this->assertDatabaseHas('department_head_invitations', ['role' => 'COLLEGE_STAFF', 'first_name' => 'Ramon', 'last_name' => 'Cruz', 'email' => 'ramon@example.edu', 'position_title' => 'Lab Technician']);
        $response->assertJsonPath('emailed', false);
        Mail::assertNothingSent();
    }

    public function test_a_plain_link_needs_a_name_and_an_email_when_it_is_not_from_a_record(): void
    {
        $this->invite(['position_title' => 'Clerk'])->assertUnprocessable()->assertJsonValidationErrors(['first_name', 'last_name', 'email']);
    }

    // ---- S3: link only, nothing attaches until the person accepts ----

    public function test_staff_are_no_longer_attached_instantly(): void
    {
        $employee = User::factory()->adviser()->create(['school_id' => 70000030, 'organization_id' => $this->psits->id]);
        $this->employee(70000030);

        $this->actingAs($this->dean)->postJson('/api/college/staff', ['school_id' => $employee->school_id, 'position_title' => 'Clerk'])->assertStatus(405);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $employee->school_id, 'organization_id' => $this->home->id]);
    }

    public function test_an_employee_with_an_account_gets_a_link_and_only_the_signed_in_acceptance_attaches_the_profile(): void
    {
        $employee = User::factory()->adviser()->create(['school_id' => 70000031, 'organization_id' => $this->psits->id, 'first_name' => 'Elena', 'last_name' => 'Faculty']);
        $this->employee(70000031, 'Elena', 'Faculty');

        $created = $this->invite(['registry_school_id' => 70000031, 'position_title' => 'Dean Assistant'])->assertCreated();
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => 70000031, 'organization_id' => $this->home->id]);
        $token = $this->token($created->json());

        $shown = $this->getJson("/api/department-head-invitations/{$token}")->assertOk();
        $shown->assertJsonPath('invitation.existing_account', true)->assertJsonPath('invitation.position_title', 'Dean Assistant');

        $this->app['auth']->forgetGuards();
        $this->postJson("/api/department-head-invitations/{$token}/claim")->assertUnauthorized();

        $stranger = User::factory()->adviser()->create(['organization_id' => $this->psits->id]);
        $this->actingAs($stranger)->postJson("/api/department-head-invitations/{$token}/claim")->assertForbidden();
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $stranger->school_id, 'organization_id' => $this->home->id]);

        $this->actingAs($employee)->postJson("/api/department-head-invitations/{$token}/claim")->assertOk();
        $this->assertDatabaseHas('account_profiles', [
            'user_school_id' => 70000031, 'organization_id' => $this->home->id, 'role' => 'ADMIN', 'position_title' => 'Dean Assistant', 'account_status' => 'active',
        ]);
        $this->assertSame($this->psits->id, $employee->fresh()->getRawOriginal('organization_id'));
        $this->assertNotNull(DepartmentHeadInvitation::first()->accepted_at);

        $this->actingAs($employee)->postJson("/api/department-head-invitations/{$token}/claim")->assertStatus(410);
    }

    public function test_the_accept_form_cannot_make_a_second_account_for_an_employee_who_already_has_one(): void
    {
        User::factory()->adviser()->create(['school_id' => 70000032, 'organization_id' => $this->psits->id]);
        $this->employee(70000032);
        $token = $this->token($this->invite(['registry_school_id' => 70000032])->assertCreated()->json());

        $this->postJson("/api/department-head-invitations/{$token}/accept", ['email' => 'new@example.edu', 'password' => 'SecurePass123!', 'password_confirmation' => 'SecurePass123!'])
            ->assertStatus(409);
    }

    public function test_an_employee_without_an_account_sets_a_password_through_the_link_and_lands_on_the_office_staff(): void
    {
        $this->employee(70000033, 'Nora', 'Faculty');
        $token = $this->token($this->invite(['registry_school_id' => 70000033, 'position_title' => 'Records Clerk'])->assertCreated()->json());

        $this->getJson("/api/department-head-invitations/{$token}")->assertOk()->assertJsonPath('invitation.existing_account', false);
        $this->postJson("/api/department-head-invitations/{$token}/accept", ['email' => 'nora@example.edu', 'password' => 'SecurePass123!', 'password_confirmation' => 'SecurePass123!'])->assertOk();

        $this->assertDatabaseHas('users', ['school_id' => 70000033, 'role' => 'ADMIN', 'position_title' => 'Records Clerk', 'organization_id' => $this->home->id]);
    }

    public function test_a_plain_link_for_an_email_that_already_has_an_account_points_to_the_records(): void
    {
        User::factory()->create(['organization_id' => $this->artsHome->id, 'role' => 'ADMIN', 'email' => 'ramon@example.edu']);

        $this->invite(['position_title' => 'Clerk', 'first_name' => 'Ramon', 'last_name' => 'Cruz', 'email' => 'ramon@example.edu'])
            ->assertUnprocessable()->assertJsonPath('errors.email.0', 'That email already has an account. Pick them from the employee records.');
    }

    public function test_a_plain_link_holds_the_email_the_dean_typed_and_prefills_it(): void
    {
        $token = $this->token($this->invite(['position_title' => 'Lab Technician', 'first_name' => 'Ramon', 'last_name' => 'Cruz', 'email' => 'ramon@example.edu'])->assertCreated()->json());

        $this->getJson("/api/department-head-invitations/{$token}")->assertOk()
            ->assertJsonPath('invitation.existing_account', false)
            ->assertJsonPath('invitation.prefill.email', 'ramon@example.edu')
            ->assertJsonPath('invitation.prefill.first_name', 'Ramon');

        $body = ['first_name' => 'Ramon', 'last_name' => 'Cruz', 'password' => 'SecurePass123!', 'password_confirmation' => 'SecurePass123!'];
        $this->postJson("/api/department-head-invitations/{$token}/accept", [...$body, 'email' => 'someone.else@example.edu'])->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->postJson("/api/department-head-invitations/{$token}/accept", [...$body, 'email' => 'ramon@example.edu'])->assertOk();
        $this->assertDatabaseHas('users', ['email' => 'ramon@example.edu', 'role' => 'ADMIN', 'position_title' => 'Lab Technician']);
    }

    public function test_pending_links_list_copy_and_revoke(): void
    {
        $this->employee(70000034, 'Nora', 'Faculty');
        $first = $this->invite(['registry_school_id' => 70000034, 'position_title' => 'Records Clerk'])->assertCreated();
        $plain = $this->invite(['position_title' => 'Lab Technician', 'first_name' => 'Ramon', 'last_name' => 'Cruz', 'email' => 'ramon@example.edu'])->assertCreated();
        DepartmentHeadInvitation::create(['college_id' => $this->arts->id, 'role' => 'COLLEGE_STAFF', 'position_title' => 'Clerk', 'token_hash' => hash('sha256', 'x'), 'invited_by' => $this->dean->school_id, 'expires_at' => now()->addDay()]);
        DepartmentHeadInvitation::create(['college_id' => $this->computing->id, 'role' => 'DEPARTMENT_HEAD', 'token_hash' => hash('sha256', 'y'), 'invited_by' => $this->dean->school_id, 'expires_at' => now()->addDay()]);
        DepartmentHeadInvitation::create(['college_id' => $this->computing->id, 'role' => 'COLLEGE_STAFF', 'position_title' => 'Old', 'token_hash' => hash('sha256', 'z'), 'invited_by' => $this->dean->school_id, 'expires_at' => now()->subDay()]);

        $list = $this->actingAs($this->dean)->getJson('/api/college/staff/invitations')->assertOk()->json('data');
        $this->assertCount(2, $list);
        $this->assertEqualsCanonicalizing(['Nora Faculty', 'Ramon Cruz'], collect($list)->pluck('name')->all());
        $this->assertArrayNotHasKey('token_hash', $list[0]);

        $id = $first->json('invitation.id');
        $oldToken = $this->token($first->json());
        $copy = $this->actingAs($this->dean)->postJson("/api/college/staff/invitations/{$id}/link")->assertOk();
        $newToken = $this->token($copy->json());
        $this->assertNotSame($oldToken, $newToken);
        $this->getJson("/api/department-head-invitations/{$oldToken}")->assertNotFound();
        $this->getJson("/api/department-head-invitations/{$newToken}")->assertOk();

        $this->actingAs($this->dean)->deleteJson("/api/college/staff/invitations/{$id}")->assertOk();
        $this->getJson("/api/department-head-invitations/{$newToken}")->assertNotFound();
        $this->assertCount(1, $this->actingAs($this->dean)->getJson('/api/college/staff/invitations')->json('data'));
        $this->assertNotNull($plain->json('invitation.id'));

        $foreign = DepartmentHeadInvitation::where('college_id', $this->arts->id)->first();
        $this->actingAs($this->dean)->deleteJson("/api/college/staff/invitations/{$foreign->id}")->assertNotFound();
        $this->actingAs($this->dean)->postJson("/api/college/staff/invitations/{$foreign->id}/link")->assertNotFound();
    }
}
