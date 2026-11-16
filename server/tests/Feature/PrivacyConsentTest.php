<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\College;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Agreeing to the Data Privacy Notice: sign-up and every invitation accept validate it on the server and write the
 * time and version themselves; a signed-in person with no agreement on record sends it once and cannot move it later.
 */
class PrivacyConsentTest extends TestCase
{
    use RefreshDatabase;

    private const VERSION = '2026-11';

    private StudentRegistryEntry $record;

    private function seedStudentRecord(): void
    {
        $college = College::create(['name' => 'College of Information Technology', 'code' => 'CIT', 'is_active' => true]);
        Organization::create([
            'name' => 'College of Information Technology', 'slug' => 'college-of-information-technology', 'acronym' => 'CIT',
            'college' => 'College of Information Technology', 'college_id' => $college->id,
            'organization_type' => 'COLLEGE', 'is_active' => true, 'lifecycle_status' => 'active',
        ]);
        $this->record = StudentRegistryEntry::create([
            'school_id' => 2600101, 'first_name' => 'Hannah', 'last_name' => 'Reyes', 'birth_date' => '2007-03-14',
            'college_id' => $college->id, 'program' => 'BS Information Technology', 'year_level' => '1st Year', 'section' => 'A',
        ]);
    }

    private function signUp(array $overrides = [])
    {
        return $this->postJson('/api/register', [
            'school_id' => 2600101, 'birth_date' => '2007-03-14', 'email' => 'hannah@example.edu',
            'password' => 'a-long-passphrase', 'password_confirmation' => 'a-long-passphrase',
            ...$overrides,
        ]);
    }

    private function saoLink(): string
    {
        Mail::fake();
        $sao = User::factory()->superAdmin()->create([
            'organization_id' => Organization::where('organization_type', 'SYSTEM_ADMINISTRATION')->firstOrFail()->id,
        ]);
        $response = $this->actingAs($sao)->postJson('/api/system/sao-staff/invitations')->assertCreated();
        parse_str((string) parse_url($response->json('magic_link'), PHP_URL_QUERY), $query);
        $this->app['auth']->forgetGuards();

        return $query['token'];
    }

    private function inviteBody(array $overrides = []): array
    {
        return [
            'first_name' => 'Ford', 'last_name' => 'Prefect', 'school_id' => 20265551, 'email' => 'ford@example.edu',
            'password' => 'SecurePass123!', 'password_confirmation' => 'SecurePass123!',
            ...$overrides,
        ];
    }

    public function test_sign_up_without_agreeing_is_refused_and_makes_no_account(): void
    {
        $this->seedStudentRecord();

        foreach ([[], ['privacy_accepted' => false], ['privacy_accepted' => 'no'], ['privacy_accepted' => null]] as $overrides) {
            $this->signUp($overrides)->assertUnprocessable()->assertJsonValidationErrors('privacy_accepted');
        }

        $this->assertNull(User::find(2600101));
        $this->assertNull($this->record->fresh()->claimed_at);
    }

    public function test_sign_up_stores_the_time_and_version_and_ignores_values_sent_by_the_client(): void
    {
        $this->seedStudentRecord();

        $response = $this->signUp([
            'privacy_accepted' => true,
            'privacy_accepted_at' => '2001-01-01 00:00:00',
            'privacy_notice_version' => 'forged',
        ])->assertCreated();

        $user = User::findOrFail(2600101);
        $this->assertNotNull($user->privacy_accepted_at);
        $this->assertTrue($user->privacy_accepted_at->isToday());
        $this->assertSame(self::VERSION, $user->privacy_notice_version);
        $response->assertJsonPath('user.privacy_notice_version', self::VERSION);
    }

    public function test_an_invitation_without_agreeing_is_refused_and_makes_no_account(): void
    {
        $token = $this->saoLink();

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->inviteBody())
            ->assertUnprocessable()->assertJsonValidationErrors('privacy_accepted');
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->inviteBody(['privacy_accepted' => false]))
            ->assertUnprocessable()->assertJsonValidationErrors('privacy_accepted');

        $this->assertNull(User::find(20265551));
        $this->assertDatabaseHas('department_head_invitations', ['accepted_at' => null]);
    }

    public function test_an_invitation_stores_the_time_and_version_server_side(): void
    {
        $token = $this->saoLink();

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->inviteBody([
            'privacy_accepted' => true,
            'privacy_accepted_at' => '2001-01-01 00:00:00',
            'privacy_notice_version' => 'forged',
        ]))->assertOk();

        $user = User::findOrFail(20265551);
        $this->assertTrue($user->privacy_accepted_at->isToday());
        $this->assertSame(self::VERSION, $user->privacy_notice_version);
    }

    public function test_the_privacy_columns_cannot_be_mass_assigned(): void
    {
        $this->assertNotContains('privacy_accepted_at', (new User)->getFillable());
        $this->assertNotContains('privacy_notice_version', (new User)->getFillable());

        $user = User::factory()->withoutPrivacyConsent()->student()->create();
        $user->update(['first_name' => 'Renamed', 'privacy_accepted_at' => now(), 'privacy_notice_version' => 'forged']);

        $this->assertNull($user->fresh()->privacy_accepted_at);
        $this->assertNull($user->fresh()->privacy_notice_version);
    }

    public function test_a_signed_in_person_who_never_agreed_sees_it_null_and_can_agree_once(): void
    {
        $student = User::factory()->withoutPrivacyConsent()->student()->create();

        $this->actingAs($student)->getJson('/api/user')->assertOk()->assertJsonPath('privacy_accepted_at', null);

        $first = $this->actingAs($student)->postJson('/api/user/privacy-consent', ['privacy_accepted' => true])
            ->assertOk()->assertJsonPath('success', true)->assertJsonPath('data.privacy_notice_version', self::VERSION);
        $stored = $student->fresh();
        $this->assertNotNull($stored->privacy_accepted_at);
        $this->assertSame(self::VERSION, $stored->privacy_notice_version);
        $this->assertDatabaseHas('audit_logs', ['action' => 'privacy_consent_given', 'user_id' => $student->school_id]);

        $this->actingAs($student->fresh())->getJson('/api/user')->assertOk()->assertJsonPath('privacy_notice_version', self::VERSION);

        // A second request, for instance from another tab, answers the same and leaves the first time alone.
        $this->travel(2)->days();
        $second = $this->actingAs($student)->postJson('/api/user/privacy-consent', ['privacy_accepted' => true])->assertOk();
        $this->assertSame($first->json('data.privacy_accepted_at'), $second->json('data.privacy_accepted_at'));
        $this->assertEquals($stored->privacy_accepted_at, $student->fresh()->privacy_accepted_at);
        $this->assertSame(1, AuditLog::where('action', 'privacy_consent_given')->count());
    }

    public function test_agreeing_needs_the_flag_and_takes_the_time_and_version_from_the_server(): void
    {
        $student = User::factory()->withoutPrivacyConsent()->student()->create();

        foreach ([[], ['privacy_accepted' => false], ['privacy_accepted' => 'no']] as $body) {
            $this->actingAs($student)->postJson('/api/user/privacy-consent', $body)
                ->assertUnprocessable()->assertJsonValidationErrors('privacy_accepted');
        }
        $this->assertNull($student->fresh()->privacy_accepted_at);

        $this->actingAs($student)->postJson('/api/user/privacy-consent', [
            'privacy_accepted' => true, 'privacy_accepted_at' => '2001-01-01 00:00:00', 'privacy_notice_version' => 'forged',
        ])->assertOk();
        $this->assertTrue($student->fresh()->privacy_accepted_at->isToday());
        $this->assertSame(self::VERSION, $student->fresh()->privacy_notice_version);
    }

    public function test_agreeing_needs_a_signed_in_person_and_waits_for_a_forced_password_change(): void
    {
        $this->postJson('/api/user/privacy-consent', ['privacy_accepted' => true])->assertUnauthorized();

        $student = User::factory()->withoutPrivacyConsent()->student()->create(['must_change_password' => true]);
        $this->actingAs($student)->postJson('/api/user/privacy-consent', ['privacy_accepted' => true])->assertForbidden();
        $this->assertNull($student->fresh()->privacy_accepted_at);
    }

    public function test_the_demo_seeders_make_accounts_that_have_already_agreed(): void
    {
        $this->seed(DatabaseSeeder::class);

        $this->assertGreaterThan(0, User::count());
        $this->assertSame(0, User::whereNull('privacy_accepted_at')->count());
        $this->assertSame(0, User::where('privacy_notice_version', '!=', self::VERSION)->count());
    }

    public function test_the_two_columns_are_hidden_by_default_and_added_back_only_for_the_signed_in_payload(): void
    {
        $this->assertContains('privacy_accepted_at', (new User)->getHidden());
        $this->assertContains('privacy_notice_version', (new User)->getHidden());

        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $other = User::factory()->student()->create(['organization_id' => $organization->id]);

        $own = $this->actingAs($admin)->getJson('/api/user')->assertOk()->assertJsonPath('privacy_notice_version', self::VERSION);
        $this->assertNotNull($own->json('privacy_accepted_at'));
        $this->assertArrayNotHasKey('privacy_accepted_at', $other->toArray());
        $this->assertArrayNotHasKey('privacy_notice_version', $other->toArray());
    }

    public function test_another_persons_agreement_never_appears_in_a_member_list(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        User::factory()->student()->create(['organization_id' => $organization->id]);

        $rows = $this->actingAs($admin)->getJson('/api/users')->assertOk()->json('data');

        $this->assertNotEmpty($rows);
        foreach ($rows as $row) {
            $this->assertArrayNotHasKey('privacy_accepted_at', $row);
            $this->assertArrayNotHasKey('privacy_notice_version', $row);
        }
    }
}
