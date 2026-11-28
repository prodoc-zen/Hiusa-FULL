<?php

namespace Tests\Feature;

use App\Contracts\FingerprintMatcher;
use App\Models\AccountProfile;
use App\Models\Event;
use App\Models\Fingerprint;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A person belongs to an organization through an account profile there, not through the organization their login
 * lives in. A student organization officer whose account sits in the college must still be enrolled and checked in by
 * the organization they serve.
 */
class FingerprintMembershipTest extends TestCase
{
    use RefreshDatabase;

    private const COLLEGE = 'College of Computer Studies';

    private Organization $college;

    private Organization $club;

    private User $admin;

    private RecordingFingerprintMatcher $matcher;

    protected function setUp(): void
    {
        parent::setUp();

        $this->college = Organization::factory()->create(['college' => self::COLLEGE]);
        $this->club = Organization::factory()->create(['college' => self::COLLEGE]);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->club->id]);
        $this->matcher = new RecordingFingerprintMatcher;
        $this->app->instance(FingerprintMatcher::class, $this->matcher);
    }

    /** A student whose account lives in the college and who holds a profile in the club. */
    private function collegeStudentInClub(string $profileStatus = 'active', string $profileRole = 'SBO_OFFICER'): User
    {
        $student = User::factory()->student()->create([
            'organization_id' => $this->college->id,
            'department' => self::COLLEGE,
            'program' => 'BSIT',
            'year_level' => '3rd Year',
            'section' => 'A',
        ]);
        AccountProfile::create([
            'user_school_id' => $student->school_id,
            'organization_id' => $this->club->id,
            'role' => $profileRole,
            'account_status' => $profileStatus,
        ]);

        return $student;
    }

    private function enrollPayload(): array
    {
        return [
            'samples' => ['sample-1', 'sample-2', 'sample-3', 'sample-4'],
            'sample_format' => 5,
            'finger_index' => 1,
            'consent_confirmed' => true,
        ];
    }

    public function test_an_admin_enrolls_and_removes_a_fingerprint_for_a_member_whose_account_lives_in_the_college(): void
    {
        $member = $this->collegeStudentInClub();

        Sanctum::actingAs($this->admin);
        $this->postJson('/api/users/'.$member->school_id.'/fingerprint', $this->enrollPayload())->assertCreated();

        $this->assertDatabaseHas('fingerprints', [
            'organization_id' => $this->club->id,
            'user_id' => $member->school_id,
        ]);

        $this->deleteJson('/api/users/'.$member->school_id.'/fingerprint')->assertOk();
        $this->assertDatabaseMissing('fingerprints', ['user_id' => $member->school_id]);
    }

    public function test_such_a_member_is_identified_and_checked_in_to_an_event_of_the_organization(): void
    {
        $member = $this->collegeStudentInClub();
        Sanctum::actingAs($this->admin);

        $fingerprintId = $this->postJson('/api/users/'.$member->school_id.'/fingerprint', $this->enrollPayload())
            ->assertCreated()->json('fingerprint.id');
        $this->matcher->matchedFingerprintId = $fingerprintId;

        $this->postJson('/api/fingerprints/identify', ['samples' => ['probe-scan'], 'sample_format' => 5])
            ->assertOk()
            ->assertJsonPath('identified', true)
            ->assertJsonPath('user.school_id', $member->school_id);

        $event = Event::factory()->create([
            'organization_id' => $this->club->id,
            'created_by' => $this->admin->school_id,
            'status' => 'ongoing',
        ]);

        $preview = $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint', [
            'samples' => ['probe-scan'],
            'sample_format' => 5,
            'year_levels' => ['3rd Year'],
            'programs' => ['BSIT'],
            'sections' => ['A'],
        ])->assertOk()
            ->assertJsonPath('user.school_id', $member->school_id)
            ->assertJsonPath('action', 'check_in');

        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint/confirm', [
            'confirmation_token' => $preview->json('confirmation_token'),
        ])->assertCreated()->assertJsonPath('action', 'checked_in');

        $this->assertDatabaseHas('attendance', [
            'event_id' => $event->id,
            'user_id' => $member->school_id,
            'method' => 'biometric',
        ]);
    }

    public function test_a_person_with_no_profile_in_the_organization_is_not_found(): void
    {
        $outsider = User::factory()->student()->create(['organization_id' => $this->college->id]);

        Sanctum::actingAs($this->admin);
        $this->postJson('/api/users/'.$outsider->school_id.'/fingerprint', $this->enrollPayload())->assertNotFound();
        $this->deleteJson('/api/users/'.$outsider->school_id.'/fingerprint')->assertNotFound();
        $this->assertDatabaseCount('fingerprints', 0);
    }

    public function test_a_member_whose_profile_in_the_organization_is_inactive_is_refused(): void
    {
        $member = $this->collegeStudentInClub('inactive');

        Sanctum::actingAs($this->admin);
        $this->postJson('/api/users/'.$member->school_id.'/fingerprint', $this->enrollPayload())->assertNotFound();
        $this->assertDatabaseCount('fingerprints', 0);
    }

    public function test_a_member_deactivated_after_enrolling_is_no_longer_identified_or_confirmed(): void
    {
        $member = $this->collegeStudentInClub();
        Sanctum::actingAs($this->admin);
        $fingerprintId = $this->postJson('/api/users/'.$member->school_id.'/fingerprint', $this->enrollPayload())
            ->assertCreated()->json('fingerprint.id');
        $this->matcher->matchedFingerprintId = $fingerprintId;
        $event = Event::factory()->create([
            'organization_id' => $this->club->id,
            'created_by' => $this->admin->school_id,
            'status' => 'ongoing',
        ]);
        $preview = $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint', ['samples' => ['probe-scan'], 'sample_format' => 5])
            ->assertOk();

        AccountProfile::where('user_school_id', $member->school_id)->where('organization_id', $this->club->id)
            ->update(['account_status' => 'inactive']);

        $this->postJson('/api/fingerprints/identify', ['samples' => ['probe-scan'], 'sample_format' => 5])
            ->assertUnprocessable()->assertJsonPath('code', 'no_enrollments');
        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint/confirm', [
            'confirmation_token' => $preview->json('confirmation_token'),
        ])->assertUnprocessable();
        $this->assertSame(1, Fingerprint::count());
    }
}
