<?php

namespace Tests\Feature;

use App\Http\Controllers\DepartmentHeadInvitationController;
use App\Mail\DeanInvitationMail;
use App\Models\College;
use App\Models\DepartmentHeadInvitation;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
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
            'school_id' => 20265555,
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

    public function test_with_mail_off_the_answer_says_nothing_was_emailed(): void
    {
        config(['mail.default' => 'log']);

        $response = $this->actingAs($this->sao)->postJson("/api/system/colleges/{$this->college->id}/invite-department-head", ['email' => 'dean@example.edu']);

        $response->assertCreated()->assertJsonPath('emailed', false)->assertJsonPath('mail_is_off', true)->assertJsonStructure(['magic_link']);
        Mail::assertNothingSent();
        Mail::assertNothingQueued();
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

    public function test_show_names_who_invited_you_and_nothing_else_about_them(): void
    {
        $token = $this->makeLink();

        $response = $this->getJson("/api/department-head-invitations/{$token}");

        $response->assertOk();
        $this->assertSame(['name' => 'SAO Director'], $response->json('invitation.inviter'));
        $this->assertStringNotContainsString('sao@example.edu', $response->getContent());
        $this->assertStringNotContainsString('10000001', $response->getContent());
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

    public function test_dean_types_their_own_school_id_and_signs_in_with_it(): void
    {
        $token = $this->makeLink();

        $response = $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['school_id' => '20263333']));

        $response->assertOk()->assertJsonPath('user.school_id', 20263333);
        $this->postJson('/api/login', ['identifier' => '20263333', 'password' => 'SecurePass123!'])->assertOk();
        $this->postJson('/api/login', ['identifier' => 'arthur.dent@example.edu', 'password' => 'SecurePass123!'])->assertOk();
    }

    public function test_a_school_id_is_required_and_never_generated(): void
    {
        $token = $this->makeLink();
        $body = $this->details();
        unset($body['school_id']);

        $this->postJson("/api/department-head-invitations/{$token}/accept", $body)->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $this->assertDatabaseMissing('users', ['email' => 'arthur.dent@example.edu']);
        $this->assertNull(DepartmentHeadInvitation::first()->accepted_at);
    }

    public function test_a_taken_school_id_gets_a_plain_message(): void
    {
        User::factory()->create(['school_id' => 20264444, 'organization_id' => $this->home->id]);
        $token = $this->makeLink();

        $taken = $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['school_id' => 20264444]));

        $taken->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $this->assertSame('This school ID already has an account. Sign in, or reset your password.', $taken->json('errors.school_id.0'));
        $this->assertDatabaseMissing('users', ['email' => 'arthur.dent@example.edu']);
    }

    /** @dataProvider badSchoolIds */
    public function test_school_id_must_be_a_number_outside_the_internal_range(string $bad, string $message): void
    {
        $token = $this->makeLink();

        $response = $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['school_id' => $bad]));

        $response->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $this->assertSame($message, $response->json('errors.school_id.0'));
        $this->assertDatabaseMissing('users', ['email' => 'arthur.dent@example.edu']);
    }

    public static function badSchoolIds(): array
    {
        $numbersOnly = 'Enter your school ID using numbers only.';

        return [
            'internal range' => ['95000001', 'That school ID cannot be used. Check the number the school gave you.'],
            'letters' => ['abc', $numbersOnly], 'zero' => ['0', $numbersOnly], 'negative' => ['-5', $numbersOnly], 'decimal' => ['12.5', $numbersOnly],
        ];
    }

    public function test_school_id_of_a_student_record_is_refused(): void
    {
        StudentRegistryEntry::create(['school_id' => 20267777, 'first_name' => 'Stu', 'last_name' => 'Dent', 'birth_date' => '2005-01-01', 'record_type' => 'student', 'college_id' => $this->college->id]);
        $token = $this->makeLink();

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['school_id' => 20267777]))->assertJsonValidationErrors('school_id');
        $this->assertDatabaseMissing('users', ['school_id' => 20267777]);
    }

    public function test_a_dean_link_accepts_a_number_in_the_unclaimed_employee_records_and_claims_that_record(): void
    {
        $record = StudentRegistryEntry::create(['school_id' => 20268888, 'first_name' => 'Arthur', 'last_name' => 'Dent', 'birth_date' => '1980-01-01', 'record_type' => 'employee', 'college_id' => $this->college->id, 'position' => 'Dean']);
        $token = $this->makeLink();

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['school_id' => 20268888]))->assertOk()->assertJsonPath('user.role', 'DEPARTMENT_HEAD');

        $this->assertDatabaseHas('users', ['school_id' => 20268888, 'role' => 'DEPARTMENT_HEAD']);
        $this->assertNotNull($record->fresh()->claimed_at);
    }

    public function test_accept_validates_the_form(): void
    {
        User::factory()->create(['email' => 'taken@example.edu', 'organization_id' => $this->home->id]);
        $token = $this->makeLink();

        $this->postJson("/api/department-head-invitations/{$token}/accept", [])->assertJsonValidationErrors(['first_name', 'last_name', 'school_id', 'email', 'password']);
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
            $method->invoke(new DepartmentHeadInvitationController, new Request, $invitationId, $this->details(['email' => 'late@example.edu']));
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

    private function dean(): User
    {
        return User::factory()->departmentHead()->create(['organization_id' => $this->home->id]);
    }

    public function test_a_bare_staff_link_needs_nothing_and_works_for_whoever_opens_it_first_once(): void
    {
        $head = $this->dean();

        $response = $this->actingAs($head)->postJson('/api/college/staff/invitations', []);
        $response->assertCreated()->assertJsonStructure(['magic_link'])->assertJsonPath('emailed', false);
        $token = $this->linkToken($response->json());
        Mail::assertNothingQueued();

        $this->assertDatabaseHas('department_head_invitations', ['college_id' => $this->college->id, 'role' => 'COLLEGE_STAFF', 'email' => null, 'first_name' => null, 'last_name' => null, 'registry_school_id' => null, 'position_title' => null]);
        $this->assertEqualsWithDelta(48 * 3600, now()->diffInSeconds(DepartmentHeadInvitation::first()->expires_at, false), 5);
        $this->getJson("/api/department-head-invitations/{$token}")->assertOk()
            ->assertJsonPath('invitation.role', 'COLLEGE_STAFF')
            ->assertJsonPath('invitation.prefill', null)
            ->assertJsonPath('invitation.record', null);

        $accepted = $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['first_name' => 'Clara', 'last_name' => 'Cruz', 'school_id' => 20261234, 'email' => 'clara@example.edu']));
        $accepted->assertOk()->assertJsonPath('user.role', 'ADMIN')->assertJsonPath('user.school_id', 20261234);
        $this->assertDatabaseHas('users', ['email' => 'clara@example.edu', 'first_name' => 'Clara', 'role' => 'ADMIN', 'organization_id' => $this->home->id, 'position_title' => 'Office staff']);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => 20261234, 'organization_id' => $this->home->id, 'role' => 'ADMIN', 'position_title' => 'Office staff']);
        $this->postJson('/api/login', ['identifier' => '20261234', 'password' => 'SecurePass123!'])->assertOk();

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['email' => 'second@example.edu', 'school_id' => 20261235]))->assertStatus(410);
        $this->getJson("/api/department-head-invitations/{$token}")->assertStatus(410);
        $this->assertDatabaseMissing('users', ['email' => 'second@example.edu']);
    }

    public function test_a_bare_staff_link_expires_after_48_hours(): void
    {
        $token = $this->linkToken($this->actingAs($this->dean())->postJson('/api/college/staff/invitations', [])->assertCreated()->json());
        DepartmentHeadInvitation::query()->update(['expires_at' => now()->subMinute()]);

        $this->getJson("/api/department-head-invitations/{$token}")->assertStatus(410);
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertStatus(410);
        $this->assertDatabaseMissing('users', ['email' => 'arthur.dent@example.edu']);
    }

    public function test_a_staff_link_with_an_email_is_tied_to_it_and_emailed_when_mail_is_set_up(): void
    {
        $head = $this->dean();

        $response = $this->actingAs($head)->postJson('/api/college/staff/invitations', ['email' => 'Clara@Example.edu', 'position_title' => 'College Secretary']);
        $response->assertCreated()->assertJsonPath('emailed', true)->assertJsonPath('mail_is_off', false)->assertJsonStructure(['magic_link']);
        $token = $this->linkToken($response->json());
        Mail::assertQueued(DeanInvitationMail::class, fn ($mail) => $mail->hasTo('clara@example.edu') && str_contains($mail->magicLink, $token));

        $this->assertDatabaseHas('department_head_invitations', ['role' => 'COLLEGE_STAFF', 'email' => 'clara@example.edu', 'first_name' => null, 'position_title' => 'College Secretary']);
        $this->getJson("/api/department-head-invitations/{$token}")->assertOk()->assertJsonPath('invitation.prefill.email', 'clara@example.edu');

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['email' => 'someone.else@example.edu']))->assertJsonValidationErrors('email');
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['email' => 'clara@example.edu']))->assertOk();
        $this->assertDatabaseHas('users', ['email' => 'clara@example.edu', 'position_title' => 'College Secretary']);
    }

    public function test_with_mail_off_a_staff_link_with_an_email_says_nothing_was_emailed(): void
    {
        config(['mail.default' => 'log']);

        $this->actingAs($this->dean())->postJson('/api/college/staff/invitations', ['email' => 'clara@example.edu'])
            ->assertCreated()->assertJsonPath('emailed', false)->assertJsonPath('mail_is_off', true)->assertJsonStructure(['magic_link']);
        Mail::assertNothingSent();
        Mail::assertNothingQueued();
    }

    public function test_a_staff_link_refuses_an_email_that_already_has_an_account(): void
    {
        User::factory()->student()->create(['email' => 'stu@example.edu', 'organization_id' => $this->home->id]);
        User::factory()->create(['email' => 'prof@example.edu', 'organization_id' => $this->home->id]);
        $head = $this->dean();

        $this->actingAs($head)->postJson('/api/college/staff/invitations', ['email' => 'stu@example.edu'])->assertJsonValidationErrors('email');
        $this->actingAs($head)->postJson('/api/college/staff/invitations', ['email' => 'prof@example.edu'])->assertJsonValidationErrors('email');
        $this->actingAs($head)->postJson('/api/college/staff/invitations', ['email' => 'not an email'])->assertJsonValidationErrors('email');
        $this->assertSame(0, DepartmentHeadInvitation::count());
    }

    public function test_staff_links_do_not_replace_each_other_but_a_second_link_for_the_same_email_does(): void
    {
        $head = $this->dean();

        $this->actingAs($head)->postJson('/api/college/staff/invitations', [])->assertCreated();
        $this->actingAs($head)->postJson('/api/college/staff/invitations', [])->assertCreated();
        $this->actingAs($head)->postJson('/api/college/staff/invitations', ['email' => 'ana@example.edu'])->assertCreated();
        $this->actingAs($head)->postJson('/api/college/staff/invitations', ['email' => 'ben@example.edu'])->assertCreated();
        $this->assertSame(4, DepartmentHeadInvitation::where('role', 'COLLEGE_STAFF')->count());

        $this->actingAs($head)->postJson('/api/college/staff/invitations', ['email' => 'ana@example.edu'])->assertCreated();
        $this->assertSame(4, DepartmentHeadInvitation::where('role', 'COLLEGE_STAFF')->count());
    }

    public function test_the_pending_list_names_an_open_link_by_its_email_or_plainly(): void
    {
        $head = $this->dean();
        $this->actingAs($head)->postJson('/api/college/staff/invitations', [])->assertCreated();
        $this->actingAs($head)->postJson('/api/college/staff/invitations', ['email' => 'ana@example.edu'])->assertCreated();

        $names = collect($this->actingAs($head)->getJson('/api/college/staff/invitations')->assertOk()->json('data'))->pluck('name')->all();

        $this->assertEqualsCanonicalizing(['Open link', 'ana@example.edu'], $names);
    }

    public function test_the_dean_never_supplies_a_name_or_a_school_id(): void
    {
        $this->actingAs($this->dean())->postJson('/api/college/staff/invitations', ['first_name' => 'Typed', 'last_name' => 'ByDean', 'school_id' => 20269999])->assertCreated();

        $this->assertDatabaseHas('department_head_invitations', ['role' => 'COLLEGE_STAFF', 'first_name' => null, 'last_name' => null, 'school_id' => null]);
    }

    public function test_only_a_dean_makes_a_staff_link(): void
    {
        $admin = User::factory()->admin()->create(['organization_id' => $this->home->id]);
        $this->actingAs($admin)->postJson('/api/college/staff/invitations', [])->assertForbidden();
    }

    public function test_staff_link_belongs_to_the_deans_own_college(): void
    {
        $other = College::create(['name' => 'College of Arts', 'code' => 'CAS', 'is_active' => true]);
        $otherHome = Organization::create(['name' => 'College of Arts', 'slug' => 'college-of-arts', 'acronym' => 'CAS', 'college' => 'College of Arts', 'college_id' => $other->id, 'organization_type' => 'COLLEGE', 'is_active' => true, 'lifecycle_status' => 'active']);
        $head = User::factory()->departmentHead()->create(['organization_id' => $otherHome->id]);

        $this->actingAs($head)->postJson('/api/college/staff/invitations', ['college_id' => $this->college->id])->assertCreated();

        $this->assertDatabaseHas('department_head_invitations', ['college_id' => $other->id, 'role' => 'COLLEGE_STAFF']);
        $this->assertDatabaseMissing('department_head_invitations', ['college_id' => $this->college->id]);
    }
}
