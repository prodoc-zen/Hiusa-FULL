<?php

namespace Tests\Feature;

use App\Http\Controllers\DepartmentHeadInvitationController;
use App\Mail\DeanInvitationMail;
use App\Models\College;
use App\Models\DepartmentHeadInvitation;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use ReflectionMethod;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class DepartmentHeadInvitationTest extends TestCase
{
    use RefreshDatabase;

    private User $sao;
    private College $college;
    private Organization $home;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();

        $saoOrg = Organization::firstOrCreate(
            ['acronym' => 'SAO'],
            ['name' => 'Student Affairs Office', 'slug' => 'student-affairs-office', 'organization_type' => 'UNIVERSITY', 'is_active' => true, 'lifecycle_status' => 'active']
        );

        $this->sao = User::create([
            'school_id' => 10000001,
            'organization_id' => $saoOrg->id,
            'first_name' => 'SAO',
            'last_name' => 'Director',
            'email' => 'sao@example.edu',
            'password_hash' => Hash::make('Sao-test-pass-1'),
            'role' => 'SUPER_ADMIN',
            'account_status' => 'active',
            'is_member' => true,
        ]);

        $this->college = College::create([
            'name' => 'College of Information Technology',
            'code' => 'CIT',
            'is_active' => true,
        ]);

        $this->home = Organization::create([
            'name' => 'College of Information Technology',
            'slug' => 'college-of-information-technology',
            'acronym' => 'CIT',
            'college' => 'College of Information Technology',
            'college_id' => $this->college->id,
            'organization_type' => 'COLLEGE',
            'is_active' => true,
            'lifecycle_status' => 'active',
        ]);
    }

    private function linkToken(array $response): string
    {
        parse_str((string) parse_url($response['magic_link'], PHP_URL_QUERY), $query);

        return $query['token'];
    }

    private function details(array $overrides = []): array
    {
        return [
            'first_name' => 'Arthur',
            'last_name' => 'Dent',
            'email' => 'arthur.dent@example.edu',
            'password' => 'SecurePass123!',
            'password_confirmation' => 'SecurePass123!',
            ...$overrides,
        ];
    }

    private function makeLink(array $payload = []): string
    {
        $response = $this->actingAs($this->sao)->postJson("/api/system/colleges/{$this->college->id}/invite-department-head", $payload);
        $response->assertCreated();

        return $this->linkToken($response->json());
    }

    public function test_sao_link_carries_no_identity_and_sends_nothing_without_an_email(): void
    {
        $response = $this->actingAs($this->sao)->postJson("/api/system/colleges/{$this->college->id}/invite-department-head");

        $response->assertCreated()->assertJsonPath('emailed', false);
        $this->assertStringContainsString('/accept-invitation?token=', $response->json('magic_link'));
        $this->assertDatabaseHas('department_head_invitations', [
            'college_id' => $this->college->id,
            'role' => 'DEPARTMENT_HEAD',
            'first_name' => null,
            'last_name' => null,
            'email' => null,
            'school_id' => null,
        ]);
        Mail::assertNothingQueued();
        Mail::assertNothingSent();
    }

    public function test_sao_typed_identity_fields_are_ignored(): void
    {
        $this->actingAs($this->sao)->postJson("/api/system/colleges/{$this->college->id}/invite-department-head", [
            'first_name' => 'Typed', 'last_name' => 'ByTheSao', 'school_id' => 20261111,
        ])->assertCreated();

        $this->assertDatabaseHas('department_head_invitations', ['college_id' => $this->college->id, 'first_name' => null, 'school_id' => null]);
    }

    public function test_optional_email_sends_the_link(): void
    {
        $response = $this->actingAs($this->sao)->postJson("/api/system/colleges/{$this->college->id}/invite-department-head", ['email' => 'Dean@Example.edu']);

        $response->assertCreated()->assertJsonPath('emailed', true);
        Mail::assertQueued(DeanInvitationMail::class, fn ($mail) => $mail->hasTo('dean@example.edu')
            && $mail->collegeName === 'College of Information Technology'
            && str_contains($mail->magicLink, '/accept-invitation?token='));
    }

    public function test_only_the_sao_can_make_a_dean_link(): void
    {
        $this->postJson("/api/system/colleges/{$this->college->id}/invite-department-head")->assertUnauthorized();

        $student = User::factory()->student()->create(['organization_id' => $this->home->id]);
        $this->actingAs($student)->postJson("/api/system/colleges/{$this->college->id}/invite-department-head")->assertForbidden();
    }

    public function test_a_new_link_replaces_the_pending_one(): void
    {
        $first = $this->makeLink();
        $second = $this->makeLink();

        $this->assertSame(1, DepartmentHeadInvitation::where('college_id', $this->college->id)->whereNull('accepted_at')->count());
        $this->getJson("/api/department-head-invitations/{$first}")->assertNotFound();
        $this->getJson("/api/department-head-invitations/{$second}")->assertOk();
    }

    public function test_link_is_refused_when_the_college_already_has_an_active_head(): void
    {
        User::factory()->departmentHead()->create(['organization_id' => $this->home->id]);

        $this->actingAs($this->sao)->postJson("/api/system/colleges/{$this->college->id}/invite-department-head")->assertStatus(409);
    }

    public function test_show_returns_only_the_college_role_and_expiry(): void
    {
        $token = $this->makeLink();

        $response = $this->getJson("/api/department-head-invitations/{$token}");

        $response->assertOk()
            ->assertJsonPath('college.id', $this->college->id)
            ->assertJsonPath('college.name', 'College of Information Technology')
            ->assertJsonPath('college.code', 'CIT')
            ->assertJsonPath('invitation.role', 'DEPARTMENT_HEAD')
            ->assertJsonStructure(['invitation' => ['role', 'position_title', 'expires_at'], 'college' => ['id', 'name', 'code']]);
        $this->assertArrayNotHasKey('token_hash', $response->json('invitation'));
        $this->assertArrayNotHasKey('first_name', $response->json('invitation'));
    }

    public function test_unknown_token_is_not_found(): void
    {
        $this->getJson('/api/department-head-invitations/'.Str::random(64))->assertNotFound();
        $this->postJson('/api/department-head-invitations/'.Str::random(64).'/accept', $this->details())->assertNotFound();
    }

    public function test_dean_registers_through_the_link_and_is_assigned_to_the_college(): void
    {
        $token = $this->makeLink();

        $response = $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['school_id' => 20263333]));

        $response->assertOk()->assertJsonStructure(['message', 'token', 'user']);
        $this->assertSame('DEPARTMENT_HEAD', $response->json('user.role'));
        $this->assertDatabaseHas('users', [
            'school_id' => 20263333,
            'email' => 'arthur.dent@example.edu',
            'role' => 'DEPARTMENT_HEAD',
            'organization_id' => $this->home->id,
            'department' => 'College of Information Technology',
        ]);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => 20263333, 'organization_id' => $this->home->id, 'role' => 'DEPARTMENT_HEAD', 'account_status' => 'active']);
        $this->assertTrue(Hash::check('SecurePass123!', User::find(20263333)->password_hash));
        $this->assertNotNull(DepartmentHeadInvitation::where('college_id', $this->college->id)->first()->accepted_at);
        $this->assertDatabaseHas('audit_logs', ['action' => 'department_head_invitation_accepted', 'user_id' => 20263333]);
    }

    public function test_dean_without_an_employee_number_gets_an_internal_id_and_signs_in_by_email(): void
    {
        $token = $this->makeLink();

        $response = $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details());

        $response->assertOk();
        $this->assertSame(95000000, (int) $response->json('user.school_id'));
        $this->postJson('/api/login', ['identifier' => 'arthur.dent@example.edu', 'password' => 'SecurePass123!'])->assertOk();
    }

    public function test_internal_ids_continue_from_the_highest_one_in_use(): void
    {
        User::factory()->create(['school_id' => 95000007, 'organization_id' => $this->home->id]);
        $token = $this->makeLink();

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertOk()->assertJsonPath('user.school_id', 95000008);
    }

    public function test_employee_number_must_be_unique_and_outside_the_internal_range(): void
    {
        User::factory()->create(['school_id' => 20264444, 'organization_id' => $this->home->id]);
        $token = $this->makeLink();

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['school_id' => 20264444]))->assertJsonValidationErrors('school_id');
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['school_id' => 95000001]))->assertJsonValidationErrors('school_id');
    }

    public function test_accept_validates_the_form(): void
    {
        User::factory()->create(['email' => 'taken@example.edu', 'organization_id' => $this->home->id]);
        $token = $this->makeLink();

        $this->postJson("/api/department-head-invitations/{$token}/accept", [])->assertJsonValidationErrors(['first_name', 'last_name', 'email', 'password']);
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['email' => 'TAKEN@example.edu']))->assertJsonValidationErrors('email');
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['password_confirmation' => 'different']))->assertJsonValidationErrors('password');
        $this->assertNull(DepartmentHeadInvitation::first()->accepted_at);
    }

    public function test_link_works_once(): void
    {
        $token = $this->makeLink();

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertOk();
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['email' => 'second@example.edu']))->assertStatus(410);
        $this->getJson("/api/department-head-invitations/{$token}")->assertStatus(410);
        $this->assertSame(1, User::where('role', 'DEPARTMENT_HEAD')->count());
    }

    public function test_expired_link_is_refused_and_creates_no_account(): void
    {
        $token = $this->makeLink();
        DepartmentHeadInvitation::query()->update(['expires_at' => now()->subMinute()]);

        $this->getJson("/api/department-head-invitations/{$token}")->assertStatus(410);
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertStatus(410);
        $this->assertDatabaseMissing('users', ['email' => 'arthur.dent@example.edu']);
    }

    public function test_token_is_stored_hashed_and_lives_for_48_hours(): void
    {
        $token = $this->makeLink();
        $invitation = DepartmentHeadInvitation::first();

        $this->assertSame(hash('sha256', $token), $invitation->token_hash);
        $this->assertEqualsWithDelta(48 * 3600, now()->diffInSeconds($invitation->expires_at, false), 5);
    }

    public function test_accept_is_refused_when_a_head_was_installed_after_the_link_was_made(): void
    {
        $token = $this->makeLink();
        User::factory()->departmentHead()->create(['organization_id' => $this->home->id]);

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertStatus(409);
        $this->assertDatabaseMissing('users', ['email' => 'arthur.dent@example.edu']);
        $this->assertNull(DepartmentHeadInvitation::first()->accepted_at);
    }

    public function test_a_link_used_between_the_check_and_the_write_is_refused_inside_the_transaction(): void
    {
        $token = $this->makeLink();
        $invitationId = DepartmentHeadInvitation::first()->id;

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertOk();

        $method = new ReflectionMethod(DepartmentHeadInvitationController::class, 'createAccount');

        try {
            $method->invoke(new DepartmentHeadInvitationController(), new Request(), $invitationId, $this->details(['email' => 'late@example.edu']));
            $this->fail('A used link must not create a second account.');
        } catch (HttpException $e) {
            $this->assertSame(410, $e->getStatusCode());
        }
        $this->assertDatabaseMissing('users', ['email' => 'late@example.edu']);
    }

    public function test_archived_college_link_is_refused(): void
    {
        $token = $this->makeLink();
        $this->college->update(['is_active' => false]);

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertStatus(410);
    }

    public function test_dean_makes_an_office_staff_link_and_the_staff_member_registers(): void
    {
        $head = User::factory()->departmentHead()->create(['organization_id' => $this->home->id]);

        $response = $this->actingAs($head)->postJson('/api/college/staff/invitations', ['position_title' => 'College Secretary']);
        $response->assertCreated()->assertJsonStructure(['magic_link']);
        $token = $this->linkToken($response->json());

        $this->assertDatabaseHas('department_head_invitations', ['college_id' => $this->college->id, 'role' => 'COLLEGE_STAFF', 'position_title' => 'College Secretary']);
        $this->getJson("/api/department-head-invitations/{$token}")->assertOk()
            ->assertJsonPath('invitation.role', 'COLLEGE_STAFF')
            ->assertJsonPath('invitation.position_title', 'College Secretary');

        $accepted = $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['first_name' => 'Clara', 'last_name' => 'Cruz', 'email' => 'clara@example.edu']));
        $accepted->assertOk()->assertJsonPath('user.role', 'ADMIN');
        $this->assertDatabaseHas('users', ['email' => 'clara@example.edu', 'role' => 'ADMIN', 'organization_id' => $this->home->id, 'position_title' => 'College Secretary']);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => $accepted->json('user.school_id'), 'organization_id' => $this->home->id, 'role' => 'ADMIN', 'position_title' => 'College Secretary']);

        $this->actingAs($head)->getJson('/api/college/staff')->assertOk()->assertJsonFragment(['email' => 'clara@example.edu', 'position_title' => 'College Secretary']);
    }

    public function test_staff_links_do_not_replace_each_other(): void
    {
        $head = User::factory()->departmentHead()->create(['organization_id' => $this->home->id]);

        $this->actingAs($head)->postJson('/api/college/staff/invitations', ['position_title' => 'Secretary'])->assertCreated();
        $this->actingAs($head)->postJson('/api/college/staff/invitations', ['position_title' => 'Clerk'])->assertCreated();

        $this->assertSame(2, DepartmentHeadInvitation::where('role', 'COLLEGE_STAFF')->count());
    }

    public function test_staff_link_needs_a_position_and_a_dean(): void
    {
        $head = User::factory()->departmentHead()->create(['organization_id' => $this->home->id]);
        $this->actingAs($head)->postJson('/api/college/staff/invitations', [])->assertJsonValidationErrors('position_title');

        $admin = User::factory()->admin()->create(['organization_id' => $this->home->id]);
        $this->actingAs($admin)->postJson('/api/college/staff/invitations', ['position_title' => 'Clerk'])->assertForbidden();
    }

    public function test_staff_link_belongs_to_the_deans_own_college(): void
    {
        $other = College::create(['name' => 'College of Arts', 'code' => 'CAS', 'is_active' => true]);
        $otherHome = Organization::create(['name' => 'College of Arts', 'slug' => 'college-of-arts', 'acronym' => 'CAS', 'college' => 'College of Arts', 'college_id' => $other->id, 'organization_type' => 'COLLEGE', 'is_active' => true, 'lifecycle_status' => 'active']);
        $head = User::factory()->departmentHead()->create(['organization_id' => $otherHome->id]);

        $this->actingAs($head)->postJson('/api/college/staff/invitations', ['position_title' => 'Clerk', 'college_id' => $this->college->id])->assertCreated();

        $this->assertDatabaseHas('department_head_invitations', ['college_id' => $other->id, 'role' => 'COLLEGE_STAFF']);
        $this->assertDatabaseMissing('department_head_invitations', ['college_id' => $this->college->id]);
    }
}
