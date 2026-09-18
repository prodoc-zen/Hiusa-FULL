<?php

namespace Tests\Feature;

use App\Contracts\FingerprintMatcher;
use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\Budget;
use App\Models\Event;
use App\Models\Fingerprint;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SuperAdminFingerprintTest extends TestCase
{
    use RefreshDatabase;

    public function test_sao_director_creates_and_manages_admin_accounts_through_system_administration(): void
    {
        $organization = Organization::factory()->create();
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id, 'position_title' => 'SAO Director']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($admin);
        $this->postJson('/api/users', $this->adminPayload(880001))->assertForbidden();

        Sanctum::actingAs($superAdmin);
        $payload = $this->adminPayload(880002);
        $created = $this->postJson('/api/system/admins', [...$payload, 'organization_id' => $organization->id])
            ->assertCreated()
            ->assertJsonPath('role', 'ADMIN');

        $createdId = $created->json('school_id');
        Sanctum::actingAs($admin);
        $this->putJson('/api/system/admins/'.$createdId, ['first_name' => 'Blocked'])->assertForbidden();

        Sanctum::actingAs($superAdmin);
        $this->putJson('/api/system/admins/'.$createdId, ['first_name' => 'Managed'])
            ->assertOk()
            ->assertJsonPath('first_name', 'Managed');
    }

    public function test_one_probe_identifies_an_enrolled_user_in_the_same_organization_and_checks_them_in(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create([
            'organization_id' => $organization->id,
            'department' => $organization->college,
            'program' => 'BSIT',
            'year_level' => '4th Year',
            'section' => 'A',
        ]);
        $otherStudent = User::factory()->student()->create(['organization_id' => $otherOrganization->id]);
        $matcher = new RecordingFingerprintMatcher;
        $this->app->instance(FingerprintMatcher::class, $matcher);

        Sanctum::actingAs($admin);
        $this->postJson('/api/users/'.$otherStudent->school_id.'/fingerprint', [
            'samples' => ['sample-1', 'sample-2', 'sample-3', 'sample-4'],
            'sample_format' => 5,
        ])->assertNotFound();

        $this->postJson('/api/users/'.$student->school_id.'/fingerprint', [
            'samples' => ['sample-1', 'sample-2', 'sample-3', 'sample-4'],
            'sample_format' => 5,
        ])->assertUnprocessable()->assertJsonValidationErrors('consent_confirmed');

        $response = $this->postJson('/api/users/'.$student->school_id.'/fingerprint', [
            'samples' => ['sample-1', 'sample-2', 'sample-3', 'sample-4'],
            'sample_format' => 5,
            'finger_index' => 1,
            'consent_confirmed' => true,
        ])->assertCreated();

        $fingerprint = Fingerprint::findOrFail($response->json('fingerprint.id'));
        $this->assertNotSame('enrolled-template', $fingerprint->template);
        $this->assertSame('enrolled-template', Crypt::decryptString($fingerprint->template));

        Fingerprint::create([
            'organization_id' => $otherOrganization->id,
            'user_id' => $otherStudent->school_id,
            'template' => Crypt::encryptString('other-template'),
            'template_format' => 'fscanner-sourceafis-dotnet-3.14.0-png-v1',
            'finger_index' => 1,
            'enrolled_by' => $otherStudent->school_id,
            'enrolled_at' => now(),
        ]);

        $matcher->matchedFingerprintId = $fingerprint->id;
        $event = Event::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->school_id,
            'status' => 'ongoing',
        ]);

        $preview = $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint', [
            'samples' => ['probe-scan'],
            'sample_format' => 5,
            'year_levels' => ['4th Year'],
            'programs' => ['BSIT'],
            'sections' => ['A'],
        ])->assertOk()
            ->assertJsonPath('identified', true)
            ->assertJsonPath('user.school_id', $student->school_id)
            ->assertJsonPath('action', 'check_in')
            ->assertJsonPath('match.threshold', 60)
            ->assertJsonStructure(['confirmation_token', 'confirmation_expires_at']);

        $this->assertCount(1, $matcher->lastIdentificationSamples);
        $this->assertCount(1, $matcher->lastCandidates);
        $this->assertSame($fingerprint->id, $matcher->lastCandidates[0]['id']);
        $this->assertDatabaseMissing('attendance', [
            'event_id' => $event->id,
            'user_id' => $student->school_id,
        ]);

        $otherAdmin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($otherAdmin);
        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint/confirm', [
            'confirmation_token' => $preview->json('confirmation_token'),
        ])->assertForbidden();

        Sanctum::actingAs($admin);
        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint/confirm', [
            'confirmation_token' => $preview->json('confirmation_token'),
        ])->assertCreated()
            ->assertJsonPath('action', 'checked_in')
            ->assertJsonPath('attendance.method', 'biometric');

        $this->assertDatabaseHas('attendance', [
            'event_id' => $event->id,
            'user_id' => $student->school_id,
            'method' => 'biometric',
            'status' => 'present',
        ]);

        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint', [
            'samples' => ['probe-scan', 'second-probe'],
            'sample_format' => 5,
        ])->assertUnprocessable()->assertJsonValidationErrors('samples');

        $checkoutPreview = $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint', [
            'samples' => ['probe-scan'],
            'sample_format' => 5,
        ])->assertOk()
            ->assertJsonPath('action', 'check_out');

        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint/confirm', [
            'confirmation_token' => $checkoutPreview->json('confirmation_token'),
        ])->assertOk()
            ->assertJsonPath('action', 'checked_out')
            ->assertJsonPath('user.school_id', $student->school_id)
            ->assertJsonPath('attendance.id', Attendance::where('event_id', $event->id)->value('id'));

        $this->assertNotNull(Attendance::where('event_id', $event->id)->value('check_out_time'));
        $this->assertDatabaseHas('audit_logs', [
            'module' => 'biometrics',
            'action' => 'biometric_attendance_checked_out',
            'record_id' => $student->school_id,
        ]);

        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint', [
            'samples' => ['probe-scan'],
            'sample_format' => 5,
        ])->assertConflict()
            ->assertJsonPath('message', $student->first_name.' '.$student->last_name.' is already checked out from this event.');

        $this->assertSame(1, Attendance::where('event_id', $event->id)->count());

        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint/confirm', [
            'confirmation_token' => $checkoutPreview->json('confirmation_token'),
        ])->assertConflict();

        Sanctum::actingAs($student);
        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint', [
            'samples' => ['probe-scan'],
            'sample_format' => 5,
        ])->assertForbidden();
    }

    public function test_attendance_identification_rejects_low_or_ambiguous_scores_and_wrong_academic_scope(): void
    {
        config()->set('fingerprint.identification.minimum_score', 60);
        config()->set('fingerprint.identification.minimum_margin', 10);

        $organization = Organization::factory()->create(['college' => 'College of Computer Studies']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $fourthYear = User::factory()->student()->create([
            'organization_id' => $organization->id,
            'department' => $organization->college,
            'program' => 'BSIT',
            'year_level' => '4th Year',
            'section' => 'A',
        ]);
        $thirdYear = User::factory()->student()->create([
            'organization_id' => $organization->id,
            'department' => $organization->college,
            'program' => 'BSCS',
            'year_level' => '3rd Year',
            'section' => 'B',
        ]);
        $wrongDepartment = User::factory()->student()->create([
            'organization_id' => $organization->id,
            'department' => 'College of Business Education',
            'program' => 'BSBA',
            'year_level' => '4th Year',
            'section' => 'C',
        ]);
        $matcher = new RecordingFingerprintMatcher;
        $this->app->instance(FingerprintMatcher::class, $matcher);

        foreach ([$fourthYear, $thirdYear, $wrongDepartment] as $student) {
            Fingerprint::create([
                'organization_id' => $organization->id,
                'user_id' => $student->school_id,
                'template' => Crypt::encryptString('template-'.$student->school_id),
                'template_format' => 'fscanner-sourceafis-dotnet-3.14.0-png-v1',
                'finger_index' => 1,
                'enrolled_by' => $admin->school_id,
                'enrolled_at' => now(),
            ]);
        }

        $event = Event::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->school_id,
            'status' => 'ongoing',
        ]);
        Sanctum::actingAs($admin);

        $matcher->matchedFingerprintId = Fingerprint::where('user_id', $fourthYear->school_id)->value('id');
        $matcher->matchedScore = 55;
        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint', [
            'samples' => ['probe-scan'],
            'sample_format' => 5,
            'year_levels' => ['4th Year'],
        ])->assertUnprocessable()
            ->assertJsonPath('code', 'no_match')
            ->assertJsonPath('best.threshold', 60);

        $matcher->matchedScore = 88.5;
        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint', [
            'samples' => ['probe-scan'],
            'sample_format' => 5,
            'year_levels' => ['2nd Year'],
        ])->assertUnprocessable()
            ->assertJsonPath('code', 'no_enrollments');

        $matcher->scores = [
            Fingerprint::where('user_id', $fourthYear->school_id)->value('id') => 88.5,
            Fingerprint::where('user_id', $thirdYear->school_id)->value('id') => 83.5,
        ];
        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint', [
            'samples' => ['probe-scan'],
            'sample_format' => 5,
        ])->assertUnprocessable()
            ->assertJsonPath('code', 'ambiguous_match');
        $this->assertCount(2, $matcher->lastCandidates);
    }

    public function test_organization_admin_can_manage_a_fellow_admin_fingerprint_only_in_their_organization(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $actor = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $colleague = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $foreignAdmin = User::factory()->admin()->create(['organization_id' => $otherOrganization->id]);
        $this->app->instance(FingerprintMatcher::class, new RecordingFingerprintMatcher);

        Sanctum::actingAs($actor);

        $this->postJson('/api/users/'.$colleague->school_id.'/fingerprint', [
            'samples' => ['sample-1', 'sample-2', 'sample-3', 'sample-4'],
            'sample_format' => 5,
            'consent_confirmed' => true,
        ])->assertCreated();

        $this->assertDatabaseHas('fingerprints', [
            'organization_id' => $organization->id,
            'user_id' => $colleague->school_id,
            'enrolled_by' => $actor->school_id,
        ]);

        $this->deleteJson('/api/users/'.$colleague->school_id.'/fingerprint')
            ->assertOk();

        $this->postJson('/api/users/'.$foreignAdmin->school_id.'/fingerprint', [
            'samples' => ['sample-1', 'sample-2', 'sample-3', 'sample-4'],
            'sample_format' => 5,
            'consent_confirmed' => true,
        ])->assertNotFound();
    }

    public function test_budget_approval_is_visible_to_and_reviewable_only_by_super_admin(): void
    {
        $organization = Organization::factory()->create();
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $organization->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        $budget = Budget::factory()->create([
            'organization_id' => $organization->id,
            'event_id' => null,
            'allocated_amount' => 25000,
            'remaining_amount' => 25000,
            'warning_threshold' => 5000,
        ]);
        $approval = ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'requested_by' => $admin->school_id,
            'required_role' => 'SUPER_ADMIN',
            'status' => 'pending',
        ]);

        Sanctum::actingAs($admin);
        $this->getJson('/api/approval-requests')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])->assertForbidden();

        Sanctum::actingAs($departmentHead);
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])->assertForbidden();

        Sanctum::actingAs($superAdmin);
        $this->getJson('/api/approval-requests')
            ->assertOk()
            ->assertJsonPath('data.0.id', $approval->id)
            ->assertJsonPath('data.0.required_role', 'SUPER_ADMIN');
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])
            ->assertOk()
            ->assertJsonPath('status', 'approved')
            ->assertJsonPath('decision', 'approved')
            ->assertJsonPath('reviewed_by', $superAdmin->school_id);
    }

    private function adminPayload(int $schoolId): array
    {
        return [
            'school_id' => $schoolId,
            'first_name' => 'New',
            'last_name' => 'Administrator',
            'email' => "admin{$schoolId}@example.test",
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'role' => 'ADMIN',
        ];
    }
}

class RecordingFingerprintMatcher implements FingerprintMatcher
{
    public ?int $matchedFingerprintId = null;

    public float $matchedScore = 88.5;

    public array $scores = [];

    public array $lastCandidates = [];

    public array $lastIdentificationSamples = [];

    public function enroll(array $samples, int $sampleFormat): array
    {
        return [
            'template' => 'enrolled-template',
            'template_format' => 'fscanner-sourceafis-dotnet-3.14.0-png-v1',
        ];
    }

    public function identify(array $candidates, array $samples, int $sampleFormat): array
    {
        $this->lastCandidates = $candidates;
        $this->lastIdentificationSamples = $samples;

        return [
            'candidates' => array_map(fn (array $candidate) => [
                'id' => $candidate['id'],
                'matched' => $candidate['id'] === $this->matchedFingerprintId,
                'score' => $this->scores[$candidate['id']] ?? ($candidate['id'] === $this->matchedFingerprintId ? $this->matchedScore : 0.0),
                'threshold' => 40.0,
            ], $candidates),
            'elapsed_ms' => 2.1,
        ];
    }
}
