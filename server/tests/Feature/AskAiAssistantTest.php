<?php

namespace Tests\Feature;

use App\Models\AiOutput;
use App\Models\ClearancePeriod;
use App\Models\ClearanceSignature;
use App\Models\ComplianceRequirementType;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class AskAiAssistantTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        config(['services.groq.key' => '']);
    }

    public function test_unauthenticated_users_cannot_access_ask_ai_endpoints(): void
    {
        $this->getJson('/api/ai/assistant')->assertStatus(401);
        $this->postJson('/api/ai/assistant/ask', ['question' => 'What should I do today?'])->assertStatus(401);
    }

    public function test_ask_endpoint_validates_question_field(): void
    {
        $org = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        Sanctum::actingAs($admin);

        $this->postJson('/api/ai/assistant/ask', ['question' => ''])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['question']);
    }

    public function test_sao_can_ask_who_has_not_submitted_and_who_has_submitted_compliance(): void
    {
        $saoOrg = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $sao = User::factory()->create([
            'organization_id' => $saoOrg->id,
            'role' => 'SUPER_ADMIN',
            'account_status' => 'active',
        ]);

        $orgSubmitted = Organization::factory()->create([
            'name' => 'Alpha Computing Society',
            'acronym' => 'ACS',
            'organization_type' => 'STUDENT_ORGANIZATION',
            'lifecycle_status' => 'active',
        ]);
        $orgMissing = Organization::factory()->create([
            'name' => 'Beta Robotics Club',
            'acronym' => 'BRC',
            'organization_type' => 'STUDENT_ORGANIZATION',
            'lifecycle_status' => 'active',
        ]);

        $reqType = ComplianceRequirementType::create([
            'category' => 'organization',
            'academic_year' => '2026-2027',
            'name' => 'Constitution and By-Laws',
            'description' => 'Updated constitution',
            'deadline_at' => now()->addDays(14),
            'is_active' => true,
            'created_by' => $sao->school_id,
        ]);

        OrganizationComplianceSubmission::create([
            'organization_id' => $orgSubmitted->id,
            'requirement_type_id' => $reqType->id,
            'status' => 'submitted',
            'file_path' => 'compliance/acs-cbl.pdf',
            'file_original_name' => 'acs-cbl.pdf',
            'mime_type' => 'application/pdf',
            'file_size' => 1024,
            'submitted_by' => $sao->school_id,
            'submitted_at' => now(),
        ]);

        Sanctum::actingAs($sao);

        $overview = $this->getJson('/api/ai/assistant')->assertOk();
        $overview->assertJsonPath('role', 'SUPER_ADMIN');
        $overview->assertJsonPath('role_label', 'SAO Operations Copilot');
        $this->assertNotEmpty($overview->json('suggested_questions'));

        $missingRes = $this->postJson('/api/ai/assistant/ask', [
            'question' => "Who hasn't submitted compliance requirements?",
        ])->assertOk();

        $missingRes->assertJsonPath('intent', 'missing_submissions');
        $this->assertNotEmpty($missingRes->json('charts'));
        $this->assertNotEmpty($missingRes->json('formatted_blocks.headline'));
        $missingRows = collect($missingRes->json('sections.0.rows'));
        $this->assertTrue($missingRows->contains(fn (array $row) => str_contains($row['primary'], 'Beta Robotics Club')));
        $this->assertSame(0, $missingRows->first()['progress_percent']);
        $this->assertFalse($missingRows->contains(fn (array $row) => str_contains($row['primary'], 'Alpha Computing Society')));

        $submittedRes = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'Who has submitted compliance documents for review?',
        ])->assertOk();

        $submittedRes->assertJsonPath('intent', 'submitted_documents');
        $submittedRows = collect($submittedRes->json('sections.0.rows'));
        $this->assertTrue($submittedRows->contains(fn (array $row) => str_contains($row['primary'], 'Alpha Computing Society')));

        $this->assertDatabaseHas('ai_outputs', [
            'requested_by' => $sao->school_id,
            'feature_type' => 'ASK_AI_ASSISTANT',
        ]);
    }

    public function test_organization_roles_are_strictly_isolated_to_their_own_organization(): void
    {
        $orgA = Organization::factory()->create(['name' => 'Org Alpha']);
        $orgB = Organization::factory()->create(['name' => 'Org Beta']);

        $adminA = User::factory()->admin()->create(['organization_id' => $orgA->id]);
        $officerA = User::factory()->officer()->create(['organization_id' => $orgA->id, 'first_name' => 'Lena', 'last_name' => 'Cruz']);
        $officerB = User::factory()->officer()->create(['organization_id' => $orgB->id, 'first_name' => 'Marco', 'last_name' => 'Reyes']);

        Task::factory()->create([
            'organization_id' => $orgA->id,
            'title' => 'Alpha Stage Setup',
            'assigned_to' => $officerA->school_id,
            'created_by' => $adminA->school_id,
            'status' => 'overdue',
            'deadline' => now()->subDay(),
        ]);

        Task::factory()->create([
            'organization_id' => $orgB->id,
            'title' => 'Secret Beta Task',
            'assigned_to' => $officerB->school_id,
            'created_by' => $officerB->school_id,
            'status' => 'overdue',
            'deadline' => now()->subDay(),
        ]);

        Sanctum::actingAs($adminA);

        $res = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'Who has overdue or pending tasks in our organization?',
        ])->assertOk();

        $res->assertJsonPath('intent', 'tasks_workload');
        $rows = collect($res->json('sections.0.rows'));
        $this->assertTrue($rows->contains(fn (array $r) => $r['primary'] === 'Alpha Stage Setup'));
        $this->assertFalse($rows->contains(fn (array $r) => $r['primary'] === 'Secret Beta Task'));
    }

    public function test_student_can_ask_about_their_own_clearance_signatories(): void
    {
        $org = Organization::factory()->create(['name' => 'Supreme Student Council']);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $otherStudent = User::factory()->student()->create(['organization_id' => $org->id]);

        $period = ClearancePeriod::create([
            'academic_year' => '2026-2027',
            'title' => 'First Semester Clearance',
            'required_roles' => ['sbo_officer', 'admin', 'sao'],
            'created_by' => $admin->school_id,
        ]);

        ClearanceSignature::create([
            'clearance_period_id' => $period->id,
            'student_id' => $student->school_id,
            'organization_id' => $org->id,
            'required_role' => 'admin',
            'status' => 'held',
            'remarks' => 'Unsettled membership fee receipt',
        ]);

        ClearanceSignature::create([
            'clearance_period_id' => $period->id,
            'student_id' => $otherStudent->school_id,
            'organization_id' => $org->id,
            'required_role' => 'admin',
            'status' => 'held',
            'remarks' => 'Other student secret remark',
        ]);

        Sanctum::actingAs($student);

        $res = $this->postJson('/api/ai/assistant/ask', [
            'question' => "Who hasn't signed my clearance yet and why?",
        ])->assertOk();

        $res->assertJsonPath('intent', 'clearances_status');
        $rows = collect($res->json('sections.0.rows'));
        $this->assertCount(1, $rows);
        $this->assertStringContainsString('Unsettled membership fee receipt', $rows->first()['secondary']);
        $this->assertStringNotContainsString('Other student secret remark', json_encode($res->json()));
    }

    public function test_dynamic_semantic_rag_answers_open_ended_questions_about_officers_merchandise_and_entities(): void
    {
        $org = Organization::factory()->create([
            'name' => 'Philippine Society of IT Students',
            'acronym' => 'PSITS-CCS',
            'organization_type' => 'STUDENT_ORGANIZATION',
            'lifecycle_status' => 'active',
        ]);
        $otherOrg = Organization::factory()->create([
            'name' => 'Secret Rival Organization',
            'acronym' => 'SRO',
            'organization_type' => 'STUDENT_ORGANIZATION',
            'lifecycle_status' => 'active',
        ]);

        $admin = User::factory()->admin()->create([
            'organization_id' => $org->id,
            'first_name' => 'Marco',
            'last_name' => 'Dela Cruz',
            'position_title' => 'President',
            'account_status' => 'active',
        ]);
        User::factory()->officer()->create([
            'organization_id' => $org->id,
            'first_name' => 'Diego',
            'last_name' => 'Villanueva',
            'position_title' => 'Treasurer',
            'account_status' => 'active',
        ]);
        User::factory()->admin()->create([
            'organization_id' => $otherOrg->id,
            'first_name' => 'Rival',
            'last_name' => 'Leader',
            'position_title' => 'President',
            'account_status' => 'active',
        ]);

        \App\Models\Merchandise::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Official PSITS Lanyard',
            'category' => 'Accessories',
            'price' => 150.00,
            'stock_quantity' => 4,
            'low_stock_threshold' => 10,
            'is_active' => true,
        ]);

        Sanctum::actingAs($admin);

        $res = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'Who are the officers and treasurer, and how much stock of the Official PSITS Lanyard do we have?',
        ])->assertOk();

        $res->assertJsonPath('intent', 'semantic_rag');
        $this->assertGreaterThan(0, $res->json('rag_metadata.corpus_size'));
        $this->assertGreaterThan(0, $res->json('rag_metadata.retrieved_count'));
        $this->assertNotEmpty($res->json('charts'));

        $payloadString = json_encode($res->json());
        $this->assertStringContainsString('Diego Villanueva', $payloadString);
        $this->assertStringContainsString('Official PSITS Lanyard', $payloadString);
        $this->assertStringNotContainsString('Rival Leader', $payloadString);
    }
}
