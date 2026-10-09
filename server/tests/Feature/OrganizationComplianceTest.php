<?php

namespace Tests\Feature;

use App\Http\Controllers\ComplianceController;
use App\Models\ComplianceRequirementType;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrganizationComplianceTest extends TestCase
{
    use RefreshDatabase;

    /** A review carries the submitted_at the reviewer saw, exactly as the SAO client sends it. */
    private function review(int $submissionId, array $payload): array
    {
        return $payload + [
            'submitted_at' => OrganizationComplianceSubmission::findOrFail($submissionId)->submitted_at->toIso8601String(),
        ];
    }

    private function user(string $role, ?int $organizationId = null): User
    {
        return User::factory()->create(['role' => $role, 'organization_id' => $organizationId ?? Organization::factory(), 'account_status' => 'active']);
    }

    public function test_super_admin_defines_requirement_type_and_notifies_every_active_admin(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $orgA = Organization::factory()->create();
        $adminA = $this->user('ADMIN', $orgA->id);
        Sanctum::actingAs($superAdmin);

        $response = $this->postJson('/api/compliance/requirement-types', [
            'academic_year' => '2026-2027',
            'name' => 'Financial Statement',
            'deadline_at' => now()->addMonth()->toISOString(),
        ])->assertCreated();

        $this->assertDatabaseHas('audit_logs', ['module' => 'compliance', 'action' => 'requirement_type_created']);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $adminA->school_id,
            'organization_id' => $adminA->organization_id,
            'reference_type' => 'compliance_requirement_type',
            'reference_id' => $response->json('id'),
        ]);
    }

    public function test_only_super_admin_can_define_requirement_types(): void
    {
        Sanctum::actingAs($this->user('ADMIN'));
        $this->postJson('/api/compliance/requirement-types', [
            'academic_year' => '2026-2027',
            'name' => 'Financial Statement',
            'deadline_at' => now()->addMonth()->toISOString(),
        ])->assertForbidden();
    }

    public function test_admin_submits_document_and_sao_reviews_it_to_accreditation(): void
    {
        Storage::fake('local');
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);

        Sanctum::actingAs($superAdmin);
        $requirementTypeId = $this->postJson('/api/compliance/requirement-types', [
            'academic_year' => '2026-2027',
            'name' => 'Financial Statement',
            'deadline_at' => now()->addMonth()->toISOString(),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($admin);
        $this->getJson('/api/compliance/status')->assertOk()->assertJsonPath('organizations.accreditation_status', 'incomplete');

        $submissionId = $this->postJson('/api/compliance/submissions', [
            'requirement_type_id' => $requirementTypeId,
            'document' => UploadedFile::fake()->create('statement.pdf', 200, 'application/pdf'),
        ])->assertCreated()->json('id');

        $this->assertDatabaseHas('audit_logs', ['module' => 'compliance', 'action' => 'submission_submitted', 'organization_id' => $organization->id]);
        $this->assertDatabaseHas('notifications', ['user_id' => $superAdmin->school_id, 'reference_type' => 'organization_compliance_submission', 'reference_id' => $submissionId]);
        $this->getJson('/api/compliance/status')->assertOk()->assertJsonPath('organizations.accreditation_status', 'pending_review');

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/compliance/submissions/{$submissionId}/review", $this->review($submissionId, ['status' => 'approved']))
            ->assertOk()->assertJsonPath('status', 'approved');
        $this->assertDatabaseHas('notifications', ['user_id' => $admin->school_id, 'reference_type' => 'organization_compliance_submission', 'reference_id' => $submissionId]);

        // The reviewing SUPER_ADMIN belongs to a different organization than the
        // one whose cached GET /compliance/status response this affects, so the
        // shared api-response cache only guarantees consistency once its TTL
        // (api_cache.ttl_seconds, 20s by default) elapses - not instantly.
        $this->travel(21)->seconds();
        Sanctum::actingAs($admin);
        $this->getJson('/api/compliance/status')->assertOk()->assertJsonPath('organizations.accreditation_status', 'accredited');
    }

    public function test_submission_listings_never_expose_the_stored_file_path(): void
    {
        Storage::fake('local');
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);

        Sanctum::actingAs($superAdmin);
        $requirementTypeId = $this->postJson('/api/compliance/requirement-types', [
            'academic_year' => '2026-2027',
            'name' => 'Financial Statement',
            'deadline_at' => now()->addMonth()->toISOString(),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($admin);
        $created = $this->postJson('/api/compliance/submissions', [
            'requirement_type_id' => $requirementTypeId,
            'document' => UploadedFile::fake()->create('statement.pdf', 200, 'application/pdf'),
        ])->assertCreated();
        $this->assertArrayNotHasKey('file_path', $created->json());
        $submissionId = $created->json('id');

        $this->assertNotEmpty(OrganizationComplianceSubmission::findOrFail($submissionId)->file_path);
        foreach ([$admin, $superAdmin] as $viewer) {
            Sanctum::actingAs($viewer);
            $row = $this->getJson('/api/compliance/submissions')->assertOk()->assertJsonPath('data.0.id', $submissionId)->json('data.0');
            $this->assertArrayNotHasKey('file_path', $row);
        }
        $this->get("/api/compliance/submissions/{$submissionId}/document")->assertOk();
    }

    public function test_returned_submission_can_be_resubmitted_and_reuses_the_same_row(): void
    {
        Storage::fake('local');
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $requirementType = ComplianceRequirementType::create([
            'academic_year' => '2026-2027', 'name' => 'Financial Statement', 'deadline_at' => now()->addMonth(), 'created_by' => $superAdmin->school_id,
        ]);

        Sanctum::actingAs($admin);
        $submissionId = $this->postJson('/api/compliance/submissions', [
            'requirement_type_id' => $requirementType->id,
            'document' => UploadedFile::fake()->create('statement.pdf', 200, 'application/pdf'),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/compliance/submissions/{$submissionId}/review", $this->review($submissionId, ['status' => 'returned', 'remarks' => 'Missing signature page.']))
            ->assertOk()->assertJsonPath('status', 'returned');
        $this->patchJson("/api/compliance/submissions/{$submissionId}/review", $this->review($submissionId, ['status' => 'approved']))
            ->assertStatus(409);

        Sanctum::actingAs($admin);
        $resubmittedId = $this->postJson('/api/compliance/submissions', [
            'requirement_type_id' => $requirementType->id,
            'document' => UploadedFile::fake()->create('statement-v2.pdf', 200, 'application/pdf'),
        ])->assertOk()->json('id');

        $this->assertSame($submissionId, $resubmittedId);
        $this->assertSame('submitted', OrganizationComplianceSubmission::find($submissionId)->status);
        $this->assertDatabaseHas('audit_logs', ['module' => 'compliance', 'action' => 'submission_resubmitted']);
    }

    public function test_upload_is_rejected_for_wrong_mime_type_and_oversized_file(): void
    {
        Storage::fake('local');
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $requirementType = ComplianceRequirementType::create([
            'academic_year' => '2026-2027', 'name' => 'Financial Statement', 'deadline_at' => now()->addMonth(), 'created_by' => $superAdmin->school_id,
        ]);
        Sanctum::actingAs($admin);

        $this->postJson('/api/compliance/submissions', [
            'requirement_type_id' => $requirementType->id,
            'document' => UploadedFile::fake()->create('virus.exe', 200, 'application/x-msdownload'),
        ])->assertStatus(422);

        $this->postJson('/api/compliance/submissions', [
            'requirement_type_id' => $requirementType->id,
            'document' => UploadedFile::fake()->create('statement.pdf', 20000, 'application/pdf'),
        ])->assertStatus(422);

        $this->assertDatabaseCount('organization_compliance_submissions', 0);
    }

    public function test_organization_b_admin_cannot_see_review_or_download_organization_a_submission(): void
    {
        Storage::fake('local');
        $superAdmin = $this->user('SUPER_ADMIN');
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $adminA = $this->user('ADMIN', $orgA->id);
        $adminB = $this->user('ADMIN', $orgB->id);
        $requirementType = ComplianceRequirementType::create([
            'academic_year' => '2026-2027', 'name' => 'Financial Statement', 'deadline_at' => now()->addMonth(), 'created_by' => $superAdmin->school_id,
        ]);

        Sanctum::actingAs($adminA);
        $submissionId = $this->postJson('/api/compliance/submissions', [
            'requirement_type_id' => $requirementType->id,
            'document' => UploadedFile::fake()->create('statement.pdf', 200, 'application/pdf'),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($adminB);
        $this->getJson('/api/compliance/submissions')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/compliance/submissions/{$submissionId}/document")->assertStatus(404);
        $this->patchJson("/api/compliance/submissions/{$submissionId}/review", ['status' => 'approved'])->assertForbidden();
    }

    public function test_resubmitting_an_already_approved_requirement_is_rejected(): void
    {
        Storage::fake('local');
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $requirementType = ComplianceRequirementType::create([
            'academic_year' => '2026-2027', 'name' => 'Financial Statement', 'deadline_at' => now()->addMonth(), 'created_by' => $superAdmin->school_id,
        ]);

        Sanctum::actingAs($admin);
        $submissionId = $this->postJson('/api/compliance/submissions', [
            'requirement_type_id' => $requirementType->id,
            'document' => UploadedFile::fake()->create('statement.pdf', 200, 'application/pdf'),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/compliance/submissions/{$submissionId}/review", $this->review($submissionId, ['status' => 'approved']))->assertOk();

        Sanctum::actingAs($admin);
        $this->postJson('/api/compliance/submissions', [
            'requirement_type_id' => $requirementType->id,
            'document' => UploadedFile::fake()->create('statement-v2.pdf', 200, 'application/pdf'),
        ])->assertStatus(409);

        $this->assertSame('approved', OrganizationComplianceSubmission::find($submissionId)->status);
        $this->assertDatabaseCount('organization_compliance_submissions', 1);
    }

    public function test_admins_are_notified_when_a_requirement_deadline_changes(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        Sanctum::actingAs($superAdmin);

        $requirementTypeId = $this->postJson('/api/compliance/requirement-types', [
            'academic_year' => '2026-2027',
            'name' => 'Financial Statement',
            'deadline_at' => now()->addMonth()->toISOString(),
        ])->assertCreated()->json('id');

        $newDeadline = now()->addMonths(2);
        $this->putJson("/api/compliance/requirement-types/{$requirementTypeId}", [
            'deadline_at' => $newDeadline->toISOString(),
        ])->assertOk();

        $this->assertDatabaseHas('notifications', [
            'user_id' => $admin->school_id,
            'organization_id' => $admin->organization_id,
            'title' => 'Compliance deadline changed',
            'reference_type' => 'compliance_requirement_type',
            'reference_id' => $requirementTypeId,
        ]);
    }

    public function test_no_deadline_notification_when_the_deadline_is_unchanged(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $this->user('ADMIN', $organization->id);
        Sanctum::actingAs($superAdmin);

        $deadline = now()->addMonth();
        $requirementTypeId = $this->postJson('/api/compliance/requirement-types', [
            'academic_year' => '2026-2027',
            'name' => 'Financial Statement',
            'deadline_at' => $deadline->toISOString(),
        ])->assertCreated()->json('id');

        $this->putJson("/api/compliance/requirement-types/{$requirementTypeId}", [
            'name' => 'Financial Statement (Revised)',
        ])->assertOk();

        $this->assertDatabaseMissing('notifications', [
            'title' => 'Compliance deadline changed',
            'reference_type' => 'compliance_requirement_type',
            'reference_id' => $requirementTypeId,
        ]);
    }

    public function test_admin_requirement_types_are_scoped_to_active_current_academic_year(): void
    {
        // The route this hits is gated to role:SUPER_ADMIN,ADMIN by slice F1
        // (server/routes/api.php is outside this slice's scope, still
        // SUPER_ADMIN-only on this branch); this exercises
        // ComplianceController::requirementTypes() directly so the
        // ADMIN-scoping fix is covered independently of that route change.
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);

        ComplianceRequirementType::create([
            'academic_year' => '2025-2026', 'name' => 'Old Report', 'deadline_at' => now()->subMonth(),
            'is_active' => true, 'created_by' => $superAdmin->school_id,
        ]);
        $current = ComplianceRequirementType::create([
            'academic_year' => '2026-2027', 'name' => 'Financial Statement', 'deadline_at' => now()->addMonth(),
            'description' => 'Submit the audited financial statement.', 'is_active' => true, 'created_by' => $superAdmin->school_id,
        ]);
        ComplianceRequirementType::create([
            'academic_year' => '2026-2027', 'name' => 'Retired Requirement', 'deadline_at' => now()->addMonth(),
            'is_active' => false, 'created_by' => $superAdmin->school_id,
        ]);

        $request = Request::create('/api/compliance/requirement-types', 'GET');
        $request->setUserResolver(fn () => $admin);

        $response = app(ComplianceController::class)->requirementTypes($request);
        $payload = json_decode($response->getContent(), true);

        $this->assertSame([$current->id], collect($payload['data'])->pluck('id')->all());
        $this->assertSame('2026-2027', $payload['data'][0]['academic_year']);
        $this->assertSame('Submit the audited financial statement.', $payload['data'][0]['description']);
        $this->assertNotNull($payload['data'][0]['deadline_at']);
    }

    public function test_student_cannot_submit_or_review_compliance_documents(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        $requirementType = ComplianceRequirementType::create([
            'academic_year' => '2026-2027', 'name' => 'Financial Statement', 'deadline_at' => now()->addMonth(), 'created_by' => $superAdmin->school_id,
        ]);
        Sanctum::actingAs($student);

        $this->postJson('/api/compliance/submissions', [
            'requirement_type_id' => $requirementType->id,
            'document' => UploadedFile::fake()->create('statement.pdf', 200, 'application/pdf'),
        ])->assertForbidden();
        $this->getJson('/api/compliance/status')->assertForbidden();
    }

    public function test_a_review_of_a_version_resubmitted_after_loading_is_refused(): void
    {
        Storage::fake('local');
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);

        Sanctum::actingAs($superAdmin);
        $requirementTypeId = $this->postJson('/api/compliance/requirement-types', [
            'academic_year' => '2026-2027',
            'name' => 'Financial Statement',
            'deadline_at' => now()->addMonth()->toISOString(),
        ])->assertCreated()->json('id');

        Sanctum::actingAs($admin);
        $submissionId = $this->postJson('/api/compliance/submissions', [
            'requirement_type_id' => $requirementTypeId,
            'document' => UploadedFile::fake()->create('statement.pdf', 200, 'application/pdf'),
        ])->assertCreated()->json('id');

        // The SAO opens the submission, then the organization replaces the document.
        $reviewAsLoaded = $this->review($submissionId, ['status' => 'approved']);
        OrganizationComplianceSubmission::whereKey($submissionId)->update(['submitted_at' => now()->addMinute()]);

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/compliance/submissions/{$submissionId}/review", $reviewAsLoaded)->assertStatus(409);
        $this->assertSame('submitted', OrganizationComplianceSubmission::findOrFail($submissionId)->status);
    }
}
