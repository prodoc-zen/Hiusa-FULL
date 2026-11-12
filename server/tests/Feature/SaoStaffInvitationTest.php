<?php

namespace Tests\Feature;

use App\Mail\DeanInvitationMail;
use App\Models\DepartmentHeadInvitation;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * The SAO adds the people who help run the SAO through a link, the way it adds a Department Head: 48 hours, single use,
 * stored hashed, optionally tied to one email. Accepting makes a SUPER_ADMIN account on the SAO organization.
 */
class SaoStaffInvitationTest extends TestCase
{
    use CreatesCollegeFixtures, RefreshDatabase;

    private User $sao;

    private Organization $saoOrganization;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();

        $this->saoOrganization = Organization::where('organization_type', 'SYSTEM_ADMINISTRATION')->firstOrFail();
        $this->sao = User::factory()->superAdmin()->create(['organization_id' => $this->saoOrganization->id]);
    }

    private function details(array $overrides = []): array
    {
        return [
            'first_name' => 'Ford', 'last_name' => 'Prefect', 'school_id' => 20265551, 'email' => 'ford@example.edu',
            'password' => 'SecurePass123!', 'password_confirmation' => 'SecurePass123!',
            ...$overrides,
        ];
    }

    private function token(array $response): string
    {
        parse_str((string) parse_url($response['magic_link'], PHP_URL_QUERY), $query);

        return $query['token'];
    }

    private function makeLink(array $body = []): string
    {
        return $this->token($this->actingAs($this->sao)->postJson('/api/system/sao-staff/invitations', $body)->assertCreated()->json());
    }

    public function test_the_sao_makes_a_link_that_carries_no_identity_and_emails_nothing_without_an_address(): void
    {
        $response = $this->actingAs($this->sao)->postJson('/api/system/sao-staff/invitations')->assertCreated();

        $response->assertJsonPath('emailed', false);
        $this->assertStringContainsString('/accept-invitation?token=', $response->json('magic_link'));
        $this->assertDatabaseHas('department_head_invitations', [
            'role' => 'SAO_STAFF', 'college_id' => null, 'first_name' => null, 'last_name' => null, 'email' => null,
            'registry_school_id' => null, 'invited_by' => $this->sao->school_id,
        ]);
        $this->assertDatabaseMissing('department_head_invitations', ['token_hash' => $this->token($response->json())]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'sao_staff_invited', 'user_id' => $this->sao->school_id, 'organization_id' => $this->saoOrganization->id]);
        Mail::assertNothingQueued();
    }

    public function test_an_address_is_emailed_the_link_when_mail_is_on_and_not_when_it_is_off(): void
    {
        $this->actingAs($this->sao)->postJson('/api/system/sao-staff/invitations', ['email' => 'Arthur@Example.edu'])
            ->assertCreated()->assertJsonPath('emailed', true)->assertJsonPath('mail_is_off', false);
        Mail::assertQueued(DeanInvitationMail::class, fn ($mail) => $mail->hasTo('arthur@example.edu') && str_contains($mail->magicLink, '/accept-invitation?token='));

        config(['mail.default' => 'log']);
        $this->actingAs($this->sao)->postJson('/api/system/sao-staff/invitations', ['email' => 'zaphod@example.edu'])
            ->assertCreated()->assertJsonPath('emailed', false)->assertJsonPath('mail_is_off', true);
    }

    public function test_an_email_that_already_has_an_account_is_refused(): void
    {
        $this->actingAs($this->sao)->postJson('/api/system/sao-staff/invitations', ['email' => $this->sao->email])
            ->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->assertSame(0, DepartmentHeadInvitation::count());
    }

    public function test_accepting_creates_an_sao_account_that_signs_in_and_reaches_an_sao_only_route(): void
    {
        $token = $this->makeLink();

        $shown = $this->getJson("/api/department-head-invitations/{$token}")->assertOk();
        $shown->assertJsonPath('invitation.role', 'SAO_STAFF')->assertJsonPath('college', null)->assertJsonPath('invitation.existing_account', false);

        $accepted = $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertOk()->assertJsonPath('user.role', 'SUPER_ADMIN');

        $user = User::findOrFail(20265551);
        $this->assertSame('SUPER_ADMIN', $user->getRawOriginal('role'));
        $this->assertSame($this->saoOrganization->id, (int) $user->organization_id);
        $this->assertSame('active', $user->account_status);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => 20265551, 'organization_id' => $this->saoOrganization->id, 'role' => 'SUPER_ADMIN', 'account_status' => 'active']);
        $this->assertNotNull(DepartmentHeadInvitation::first()->accepted_at);
        $this->assertDatabaseHas('audit_logs', ['action' => 'sao_staff_invitation_accepted', 'user_id' => 20265551, 'organization_id' => $this->saoOrganization->id]);

        $this->postJson('/api/login', ['identifier' => 'ford@example.edu', 'password' => 'SecurePass123!'])->assertOk()->assertJsonPath('user.role', 'SUPER_ADMIN');

        $this->app['auth']->forgetGuards();
        $this->withToken($accepted->json('token'))->getJson('/api/system/colleges')->assertOk();
    }

    public function test_a_used_link_is_refused_and_makes_no_second_account(): void
    {
        $token = $this->makeLink();
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertOk();

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['school_id' => 20265552, 'email' => 'trillian@example.edu']))->assertStatus(410);
        $this->getJson("/api/department-head-invitations/{$token}")->assertStatus(410);
        $this->assertDatabaseMissing('users', ['school_id' => 20265552]);
    }

    public function test_an_expired_link_is_refused(): void
    {
        $token = $this->makeLink();
        DepartmentHeadInvitation::query()->update(['expires_at' => now()->subMinute()]);

        $this->getJson("/api/department-head-invitations/{$token}")->assertStatus(410);
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertStatus(410);
        $this->assertDatabaseMissing('users', ['school_id' => 20265551]);
    }

    public function test_a_link_lasts_forty_eight_hours(): void
    {
        $this->makeLink();

        $this->assertEqualsWithDelta(48 * 3600, now()->diffInSeconds(DepartmentHeadInvitation::first()->expires_at, false), 5);
    }

    public function test_a_revoked_link_stops_working_and_is_not_listed(): void
    {
        $token = $this->makeLink();
        $row = DepartmentHeadInvitation::first();

        $this->actingAs($this->sao)->deleteJson("/api/system/sao-staff/invitations/{$row->id}")->assertOk();

        $this->getJson("/api/department-head-invitations/{$token}")->assertNotFound();
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertNotFound();
        $this->actingAs($this->sao)->getJson('/api/system/sao-staff/invitations')->assertOk()->assertJsonCount(0, 'data');
        $this->assertDatabaseHas('audit_logs', ['action' => 'sao_staff_invitation_revoked']);
    }

    public function test_the_pending_list_shows_open_links_and_a_new_link_replaces_the_old_one(): void
    {
        $old = $this->makeLink();
        $this->makeLink(['email' => 'slartibartfast@example.edu']);

        $listed = $this->actingAs($this->sao)->getJson('/api/system/sao-staff/invitations')->assertOk();
        $listed->assertJsonCount(2, 'data');
        $this->assertSame(['slartibartfast@example.edu', 'Open link'], $listed->collect('data')->pluck('name')->all());
        $this->assertArrayNotHasKey('token_hash', $listed->json('data.0'));

        $openId = DepartmentHeadInvitation::whereNull('email')->value('id');
        $fresh = $this->token($this->actingAs($this->sao)->postJson("/api/system/sao-staff/invitations/{$openId}/link")->assertOk()->json());

        $this->getJson("/api/department-head-invitations/{$old}")->assertNotFound();
        $this->getJson("/api/department-head-invitations/{$fresh}")->assertOk();
        $this->assertDatabaseHas('audit_logs', ['action' => 'sao_staff_link_renewed']);
    }

    public function test_a_link_tied_to_an_email_is_refused_for_another_email(): void
    {
        $token = $this->makeLink(['email' => 'ford@example.edu']);

        $this->getJson("/api/department-head-invitations/{$token}")->assertOk()->assertJsonPath('invitation.prefill.email', 'ford@example.edu');
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['email' => 'someone.else@example.edu']))
            ->assertUnprocessable()->assertJsonPath('errors.email.0', 'Use the email this invitation was made for.');
        $this->assertDatabaseMissing('users', ['school_id' => 20265551]);

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertOk();
    }

    public function test_the_person_types_their_own_details_and_cannot_take_a_taken_school_id(): void
    {
        $token = $this->makeLink();

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['school_id' => $this->sao->school_id]))
            ->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['first_name' => '']))
            ->assertUnprocessable()->assertJsonValidationErrors('first_name');
        $this->assertSame(1, User::count());
    }

    public function test_an_sao_link_accepts_a_number_in_the_unclaimed_employee_records_and_claims_that_record(): void
    {
        $record = StudentRegistryEntry::create([
            'school_id' => 20265560, 'first_name' => 'Ford', 'last_name' => 'Prefect', 'birth_date' => '1980-01-01',
            'record_type' => 'employee', 'college_id' => $this->makeCollege('SAOEMP')->id, 'position' => 'Registrar',
        ]);
        $token = $this->makeLink();

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details(['school_id' => 20265560]))
            ->assertOk()->assertJsonPath('user.role', 'SUPER_ADMIN');

        $this->assertDatabaseHas('users', ['school_id' => 20265560, 'role' => 'SUPER_ADMIN']);
        $this->assertNotNull($record->fresh()->claimed_at);
    }

    public function test_nobody_but_the_sao_can_use_the_sao_staff_routes(): void
    {
        $token = $this->makeLink();
        $id = DepartmentHeadInvitation::value('id');

        $college = $this->makeCollege('COC');
        $this->makeCollegeHome($college);
        $dean = $this->makeCollegeHead($college);
        $student = User::factory()->student()->create();
        $admin = User::factory()->admin()->create();

        foreach ([$dean, $admin, $student] as $caller) {
            $this->actingAs($caller)->postJson('/api/system/sao-staff/invitations')->assertForbidden();
            $this->actingAs($caller)->getJson('/api/system/sao-staff/invitations')->assertForbidden();
            $this->actingAs($caller)->postJson("/api/system/sao-staff/invitations/{$id}/link")->assertForbidden();
            $this->actingAs($caller)->deleteJson("/api/system/sao-staff/invitations/{$id}")->assertForbidden();
        }

        $this->app['auth']->forgetGuards();
        $this->postJson('/api/system/sao-staff/invitations')->assertUnauthorized();
        $this->assertSame(1, DepartmentHeadInvitation::count());
        $this->getJson("/api/department-head-invitations/{$token}")->assertOk();
    }

    public function test_the_dean_staff_routes_never_show_or_change_an_sao_link(): void
    {
        $this->makeLink();
        $id = DepartmentHeadInvitation::value('id');

        $college = $this->makeCollege('COC');
        $this->makeCollegeHome($college);
        $dean = $this->makeCollegeHead($college);

        $this->actingAs($dean)->getJson('/api/college/staff/invitations')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($dean)->postJson("/api/college/staff/invitations/{$id}/link")->assertNotFound();
        $this->actingAs($dean)->deleteJson("/api/college/staff/invitations/{$id}")->assertNotFound();
    }

    public function test_a_college_staff_link_still_does_not_make_an_sao_account(): void
    {
        $college = $this->makeCollege('COC');
        $this->makeCollegeHome($college);
        $dean = $this->makeCollegeHead($college);
        $token = $this->token($this->actingAs($dean)->postJson('/api/college/staff/invitations', [])->assertCreated()->json());

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertOk();

        $this->assertNotSame('SUPER_ADMIN', User::findOrFail(20265551)->getRawOriginal('role'));
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => 20265551, 'role' => 'SUPER_ADMIN']);
    }

    public function test_the_new_sao_account_counts_as_an_active_sao_for_the_delete_guard(): void
    {
        $token = $this->makeLink();
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->details())->assertOk();
        $this->app['auth']->forgetGuards();

        $second = User::findOrFail(20265551);
        $lone = User::factory()->superAdmin()->create(['organization_id' => $this->saoOrganization->id]);

        $this->actingAs($second)->deleteJson("/api/system/users/{$lone->school_id}", ['school_id' => $lone->school_id])->assertOk();
        $this->assertDatabaseMissing('users', ['school_id' => $lone->school_id]);
    }
}
