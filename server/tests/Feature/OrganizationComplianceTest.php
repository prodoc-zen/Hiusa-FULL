<?php

namespace Tests\Feature;

use App\Models\ComplianceRequirementType;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrganizationComplianceTest extends TestCase
{
    use RefreshDatabase;

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
        $this->patchJson("/api/compliance/submissions/{$submissionId}/review", ['status' => 'approved'])
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
        $this->patchJson("/api/compliance/submissions/{$submissionId}/review", ['status' => 'returned', 'remarks' => 'Missing signature page.'])
            ->assertOk()->assertJsonPath('status', 'returned');
        $this->patchJson("/api/compliance/submissions/{$submissionId}/review", ['status' => 'approved'])
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
}
