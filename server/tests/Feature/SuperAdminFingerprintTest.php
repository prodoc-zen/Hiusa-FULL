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
        $created = $this->postJson('/api/system/admins', [...$this->adminPayload(880002), 'organization_id' => $organization->id])
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
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
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

        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint', [
            'samples' => ['probe-scan'],
            'sample_format' => 5,
        ])->assertCreated()
            ->assertJsonPath('identified', true)
            ->assertJsonPath('user.school_id', $student->school_id)
            ->assertJsonPath('attendance.method', 'biometric');

        $this->assertCount(1, $matcher->lastIdentificationSamples);
        $this->assertCount(1, $matcher->lastCandidates);
        $this->assertSame($fingerprint->id, $matcher->lastCandidates[0]['id']);
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

        $this->assertSame(1, Attendance::where('event_id', $event->id)->count());

        Sanctum::actingAs($student);
        $this->postJson('/api/events/'.$event->id.'/attendance/fingerprint', [
            'samples' => ['probe-scan'],
            'sample_format' => 5,
        ])->assertForbidden();
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
                'score' => $candidate['id'] === $this->matchedFingerprintId ? 88.5 : 0.0,
                'threshold' => 40.0,
            ], $candidates),
            'elapsed_ms' => 2.1,
        ];
    }
}
