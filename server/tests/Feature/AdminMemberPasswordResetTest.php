<?php

namespace Tests\Feature;

use App\Mail\PasswordResetMail;
use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Election;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminMemberPasswordResetTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($this->admin);
    }

    private function mailOff(): void
    {
        config(['mail.default' => 'log', 'app.frontend_url' => 'https://hiusa.example.test']);
        Mail::fake();
    }

    private function openElection(Organization $organization, string $status = 'active', array $overrides = []): Election
    {
        return Election::factory()->create(['organization_id' => $organization->id, 'status' => $status, 'approved_at' => now(), 'finalized_at' => now(), ...$overrides]);
    }

    public function test_with_mail_off_the_admin_gets_a_one_time_link_for_a_member_that_works_once(): void
    {
        $this->mailOff();
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id, 'email' => 'ana@example.test', 'password_hash' => 'old-password']);

        $response = $this->postJson("/api/users/{$student->school_id}/password-reset")->assertOk();

        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        parse_str((string) parse_url($response->json('reset_link'), PHP_URL_QUERY), $query);
        $this->assertSame('ana@example.test', $query['email']);
        Mail::assertNothingOutgoing();
        $audit = AuditLog::where('action', 'member_password_reset_initiated')->firstOrFail();
        $this->assertSame($student->school_id, (int) $audit->record_id);
        $this->assertSame($this->admin->school_id, (int) $audit->user_id);
        $this->assertStringNotContainsString($query['token'], json_encode(AuditLog::all()->toArray()));

        app('auth')->forgetGuards();
        $payload = ['organization_id' => $student->organization_id, 'email' => 'ana@example.test', 'token' => $query['token'], 'password' => 'New-password-2026', 'password_confirmation' => 'New-password-2026'];
        $this->postJson('/api/password/reset', $payload)->assertOk();
        $this->assertTrue(Hash::check('New-password-2026', $student->fresh()->password_hash));
        $this->postJson('/api/password/reset', $payload)->assertUnprocessable();
    }

    public function test_with_mail_on_the_link_is_emailed_and_not_returned(): void
    {
        config(['mail.default' => 'smtp']);
        Mail::fake();
        $officer = User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'SBO_OFFICER']);

        $response = $this->postJson("/api/users/{$officer->school_id}/password-reset")->assertOk();

        $this->assertArrayNotHasKey('reset_link', $response->json());
        Mail::assertQueued(PasswordResetMail::class, fn ($mail) => $mail->hasTo($officer->email));
    }

    public function test_the_reset_is_refused_while_voting_is_open_in_the_organization(): void
    {
        $this->mailOff();
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->openElection($this->organization);

        $this->postJson("/api/users/{$student->school_id}/password-reset")
            ->assertStatus(409)
            ->assertJsonPath('message', 'Voting is open in your organization. Ask the SAO to reset this member\'s password until the election closes.');
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    public function test_an_approved_finalized_upcoming_election_blocks_the_reset_the_night_before_voting(): void
    {
        $this->mailOff();
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->openElection($this->organization, 'upcoming', ['start_time' => now()->addHours(10), 'end_time' => now()->addDays(2)]);

        $this->postJson("/api/users/{$student->school_id}/password-reset")->assertStatus(409);
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    public function test_a_closed_unapproved_unfinalized_or_another_organizations_election_does_not_block_the_reset(): void
    {
        $this->mailOff();
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->openElection($this->organization, 'closed');
        $this->openElection($this->organization, 'upcoming', ['approved_at' => null]);
        $this->openElection($this->organization, 'upcoming', ['finalized_at' => null]);
        $this->openElection(Organization::factory()->create());

        $this->postJson("/api/users/{$student->school_id}/password-reset")->assertOk();
    }

    public function test_an_election_in_an_organization_the_member_votes_in_through_a_secondary_profile_blocks_the_reset(): void
    {
        $this->mailOff();
        $club = Organization::factory()->create();
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        AccountProfile::create(['user_school_id' => $student->school_id, 'organization_id' => $club->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $this->openElection($club, 'upcoming', ['start_time' => now()->addDay(), 'end_time' => now()->addDays(2)]);

        $this->postJson("/api/users/{$student->school_id}/password-reset")->assertStatus(409);
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    public function test_a_stale_stored_status_is_refreshed_before_the_reset_is_decided(): void
    {
        $this->mailOff();
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $stale = $this->openElection($this->organization, 'active', ['start_time' => now()->subDays(3), 'end_time' => now()->subDay()]);

        $this->postJson("/api/users/{$student->school_id}/password-reset")->assertOk();
        $this->assertSame('closed', $stale->fresh()->status);

        $this->openElection($this->organization, 'upcoming', ['start_time' => now()->subHour(), 'end_time' => now()->addDay()]);

        $this->postJson("/api/users/{$student->school_id}/password-reset")->assertStatus(409);
    }

    public function test_only_active_student_and_officer_members_of_the_primary_organization_can_be_reset(): void
    {
        $this->mailOff();
        $colleague = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $outsider = User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
        $inactive = User::factory()->student()->create(['organization_id' => $this->organization->id, 'account_status' => 'inactive']);
        $secondary = User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
        $secondary->accountProfiles()->create(['organization_id' => $this->organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        $this->postJson("/api/users/{$colleague->school_id}/password-reset")
            ->assertStatus(409)
            ->assertJsonPath('message', 'Ask the SAO to reset this password.');
        $this->assertDatabaseCount('password_reset_tokens', 0);
        $this->postJson("/api/users/{$this->admin->school_id}/password-reset")
            ->assertStatus(409)
            ->assertJsonPath('message', 'Ask the SAO to reset this password.');
        $this->assertDatabaseCount('password_reset_tokens', 0);
        $this->postJson("/api/users/{$outsider->school_id}/password-reset")->assertStatus(404);
        $this->postJson("/api/users/{$secondary->school_id}/password-reset")->assertStatus(404);
        $this->postJson("/api/users/{$inactive->school_id}/password-reset")->assertUnprocessable();
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    public function test_a_member_with_an_active_elevated_profile_in_another_organization_is_refused(): void
    {
        $this->mailOff();
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $other = Organization::factory()->create();
        AccountProfile::create(['user_school_id' => $student->school_id, 'organization_id' => $other->id, 'role' => 'ADMIN', 'account_status' => 'active']);

        $this->postJson("/api/users/{$student->school_id}/password-reset")
            ->assertStatus(409)
            ->assertJsonPath('message', 'Ask the SAO to reset this password.');
        $this->assertDatabaseCount('password_reset_tokens', 0);

        $officer = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        AccountProfile::create(['user_school_id' => $officer->school_id, 'organization_id' => $other->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active']);

        $this->postJson("/api/users/{$officer->school_id}/password-reset")->assertStatus(409);
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    public function test_an_extra_student_profile_or_an_inactive_elevated_profile_elsewhere_does_not_block_the_reset(): void
    {
        $this->mailOff();
        $other = Organization::factory()->create();
        $studentOnly = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        AccountProfile::create(['user_school_id' => $studentOnly->school_id, 'organization_id' => $other->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $dormant = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        AccountProfile::create(['user_school_id' => $dormant->school_id, 'organization_id' => $other->id, 'role' => 'ADMIN', 'account_status' => 'inactive']);

        $this->postJson("/api/users/{$studentOnly->school_id}/password-reset")->assertOk();
        $this->postJson("/api/users/{$dormant->school_id}/password-reset")->assertOk();
    }

    public function test_the_member_list_says_whether_the_organization_is_the_members_primary_profile(): void
    {
        $primary = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $secondary = User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
        $secondary->accountProfiles()->create(['organization_id' => $this->organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        $rows = collect($this->getJson('/api/users?role=STUDENT')->assertOk()->json('data'))->keyBy('school_id');

        $this->assertTrue($rows[$primary->school_id]['is_primary_profile']);
        $this->assertFalse($rows[$secondary->school_id]['is_primary_profile']);
    }

    public function test_students_and_officers_cannot_use_the_reset(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $officer = User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'SBO_OFFICER']);

        Sanctum::actingAs($officer);
        $this->postJson("/api/users/{$student->school_id}/password-reset")->assertForbidden();
        Sanctum::actingAs($student);
        $this->postJson("/api/users/{$officer->school_id}/password-reset")->assertForbidden();
    }

    public function test_an_admin_cannot_type_a_password_for_another_person(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id, 'password_hash' => 'old-password']);

        $this->putJson("/api/users/{$student->school_id}", ['first_name' => 'Renamed', 'password' => 'Chosen-by-staff-1', 'password_confirmation' => 'Chosen-by-staff-1'])->assertOk();

        $student->refresh();
        $this->assertTrue(Hash::check('old-password', $student->password_hash));
        $this->assertFalse((bool) $student->must_change_password);
        $this->assertSame('Renamed', $student->first_name);
    }

    public function test_an_admin_cannot_change_another_persons_email_but_can_resend_the_same_one(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id, 'email' => 'ana@example.test']);

        $this->putJson("/api/users/{$student->school_id}", ['email' => 'attacker@example.test'])->assertForbidden();
        $this->assertSame('ana@example.test', $student->fresh()->email);

        $this->putJson("/api/users/{$student->school_id}", ['email' => 'ana@example.test', 'first_name' => 'Ana'])->assertOk();
    }
}
