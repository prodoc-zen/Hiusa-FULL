<?php

namespace Tests\Feature;

use App\Models\AiOutput;
use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Candidate;
use App\Models\ClearancePeriod;
use App\Models\ClearanceSignature;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Event;
use App\Models\Merchandise;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\HowToGuideLibrary;
use App\Services\Dashboard\ClientRouteAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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
        $overview->assertJsonPath('role_label', 'SAO assistant');
        $this->assertNotEmpty($overview->json('suggested_questions'));

        $missingRes = $this->postJson('/api/ai/assistant/ask', [
            'question' => "Who hasn't submitted compliance requirements?",
        ])->assertOk();

        $missingRes->assertJsonPath('intent', 'missing_submissions');
        $this->assertSame([], $missingRes->json('charts'));
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

        Merchandise::factory()->create([
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
        $this->assertNotContains('Key Metrics Comparison', array_column($res->json('charts'), 'title'));

        $payloadString = json_encode($res->json());
        $this->assertStringContainsString('Diego Villanueva', $payloadString);
        $this->assertStringContainsString('Official PSITS Lanyard', $payloadString);
        $this->assertStringNotContainsString('Rival Leader', $payloadString);
    }

    public function test_how_to_guide_answers_procedural_questions_with_step_by_step_guidance(): void
    {
        $saoOrg = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $sao = User::factory()->create([
            'organization_id' => $saoOrg->id,
            'role' => 'SUPER_ADMIN',
            'account_status' => 'active',
        ]);

        Sanctum::actingAs($sao);

        // SAO asks how to create academic year / activate semester
        $res = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'How do I create an academic year and activate a semester?',
        ])->assertOk();

        $res->assertJsonPath('intent', 'how_to_guide');
        $this->assertStringContainsStringIgnoringCase('academic year', $res->json('title'));
        $stepsSection = collect($res->json('sections'))->firstWhere('layout', 'steps');
        $this->assertNotNull($stepsSection);
        $this->assertNotEmpty($stepsSection['rows']);
        $this->assertSame('Step 1', $stepsSection['rows'][0]['status']);
        $this->assertNotNull($stepsSection['rows'][0]['href']);

        // Student asks a procedure meant for another role
        $student = User::factory()->student()->create();
        Sanctum::actingAs($student);

        $studentRes = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'How do I approve a budget?',
        ])->assertOk();

        $studentRes->assertJsonPath('intent', 'how_to_guide');
        $this->assertStringContainsString('cannot do', $studentRes->json('answer'));
        $this->assertSame('Other role', collect($studentRes->json('highlights'))->firstWhere('label', 'Your access')['value']);
    }

    public function test_how_to_guide_matches_dean_magic_link_delegation_and_subaccount_questions(): void
    {
        $saoOrg = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $sao = User::factory()->create([
            'organization_id' => $saoOrg->id,
            'role' => 'SUPER_ADMIN',
            'account_status' => 'active',
        ]);

        Sanctum::actingAs($sao);

        // 1. SAO asks about dean magic link invitation
        $res = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'How do I invite a dean with a magic link?',
        ])->assertOk();

        $res->assertJsonPath('intent', 'how_to_guide');
        $this->assertStringContainsStringIgnoringCase('Invite a Department Head', $res->json('title'));
        $this->assertStringContainsStringIgnoringCase('invitation link', $res->json('answer'));

        // 2. Dean asks about delegating secretary and staff access
        $college = $this->makeCollege('COE');
        $dean = $this->makeCollegeHead($college);
        Sanctum::actingAs($dean);

        $staffRes = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'How do I add office staff or delegate a secretary?',
        ])->assertOk();

        $staffRes->assertJsonPath('intent', 'how_to_guide');
        $this->assertStringContainsStringIgnoringCase('College Secretary', $staffRes->json('title'));

        // 3. Dean asks about sub-account oversight mode
        $subaccountRes = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'How do I oversee organizations as sub-accounts?',
        ])->assertOk();

        $subaccountRes->assertJsonPath('intent', 'how_to_guide');
        $this->assertStringContainsStringIgnoringCase('sub-accounts', $subaccountRes->json('title'));

        // 4. Admin asks about advance planning
        $org = Organization::factory()->create(['college_id' => $college->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        Sanctum::actingAs($admin);

        $planRes = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'How do I switch academic periods for advance planning?',
        ])->assertOk();

        $planRes->assertJsonPath('intent', 'how_to_guide');
        $this->assertStringContainsStringIgnoringCase('advance planning', $planRes->json('title'));
    }

    public function test_a_student_is_not_shown_budgets_unapproved_events_or_announcements_for_other_roles(): void
    {
        $org = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);

        Budget::create(['organization_id' => $org->id, 'title' => 'Zorbfest', 'allocated_amount' => 5000, 'remaining_amount' => 5000, 'warning_threshold' => 100, 'submission_status' => 'approved']);
        Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'title' => 'Quillgate Summit', 'status' => 'planning']);
        Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'title' => 'Marmalade Fair', 'status' => 'approved']);
        Announcement::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'title' => 'Zephyr Memo', 'target_role' => 'SBO_OFFICER', 'is_published' => true, 'approval_status' => 'approved', 'published_at' => now()]);
        Announcement::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'title' => 'Zephyr Notice', 'target_role' => 'all', 'is_published' => true, 'approval_status' => 'approved', 'published_at' => now()]);

        Sanctum::actingAs($student);

        $res = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'Zorbfest Quillgate Marmalade Zephyr',
            'topic' => 'semantic_rag',
        ])->assertOk();

        $payload = json_encode(collect($res->json('sections'))->pluck('rows')->flatten(1)->pluck('primary'));
        $this->assertStringContainsString('Marmalade Fair', $payload);
        $this->assertStringContainsString('Zephyr Notice', $payload);
        $this->assertStringNotContainsString('Zorbfest', $payload);
        $this->assertStringNotContainsString('Quillgate Summit', $payload);
        $this->assertStringNotContainsString('Zephyr Memo', $payload);
    }

    public function test_an_officer_limited_to_tasks_is_refused_finance_and_cannot_find_budgets_by_search(): void
    {
        $org = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);
        $officer->accountProfiles()->update(['modules' => ['tasks']]);
        Budget::create(['organization_id' => $org->id, 'title' => 'Zorbfest', 'allocated_amount' => 5000, 'remaining_amount' => 4000, 'warning_threshold' => 100, 'submission_status' => 'approved']);

        Sanctum::actingAs($officer);

        $res = $this->postJson('/api/ai/assistant/ask', ['question' => 'How is our budget?'])->assertOk();
        $res->assertJsonPath('intent', 'finance_health');
        $res->assertJsonPath('sections', []);
        $this->assertStringNotContainsString('4,000', json_encode($res->json()));
        $this->assertStringContainsString('does not have access', $res->json('answer'));

        $search = $this->postJson('/api/ai/assistant/ask', ['question' => 'Zorbfest', 'topic' => 'semantic_rag'])->assertOk();
        $this->assertStringNotContainsString('Zorbfest', json_encode(collect($search->json('sections'))->pluck('rows')->flatten(1)->pluck('primary')));

        $topics = collect($this->getJson('/api/ai/assistant')->assertOk()->json('suggested_questions'))->pluck('topic');
        $this->assertNotContains('finance_health', $topics->all());
    }

    public function test_an_officer_with_the_finance_area_or_no_limit_still_gets_the_budget_answer(): void
    {
        $org = Organization::factory()->create();
        $limited = User::factory()->officer()->create(['organization_id' => $org->id]);
        $limited->accountProfiles()->update(['modules' => ['finance']]);
        $unlimited = User::factory()->officer()->create(['organization_id' => $org->id]);
        Budget::create(['organization_id' => $org->id, 'title' => 'Zorbfest', 'allocated_amount' => 5000, 'remaining_amount' => 4000, 'warning_threshold' => 100, 'submission_status' => 'approved']);

        foreach ([$limited, $unlimited] as $officer) {
            Sanctum::actingAs($officer);
            $res = $this->postJson('/api/ai/assistant/ask', ['question' => 'How is our budget?'])->assertOk();
            $this->assertStringContainsString('Zorbfest', json_encode($res->json()));
        }
    }

    public function test_the_sao_grievance_answer_counts_capitalized_high_and_critical_urgency(): void
    {
        $saoOrg = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $sao = User::factory()->superAdmin()->create(['organization_id' => $saoOrg->id]);
        $student = User::factory()->student()->create();
        DB::table('grievances')->insert(['organization_id' => $saoOrg->id, 'submitted_by' => $student->school_id, 'title' => 'Chained exit', 'description' => 'The gym exit is chained.', 'urgency' => 'Critical', 'status' => 'submitted', 'created_at' => now(), 'updated_at' => now()]);

        Sanctum::actingAs($sao);

        $res = $this->postJson('/api/ai/assistant/ask', ['question' => 'Any grievances?'])->assertOk();
        $res->assertJsonPath('intent', 'grievances_status');
        $this->assertStringContainsString('1 of them is high or critical urgency', $res->json('answer'));
        $this->assertSame('1', collect($res->json('highlights'))->firstWhere('label', 'High / critical urgency')['value']);
        $this->assertSame('danger', $res->json('sections.0.rows.0.status_tone'));

        $daily = $this->postJson('/api/ai/assistant/ask', ['question' => 'What should I do today?', 'topic' => 'daily_priorities'])->assertOk();
        $this->assertContains('prio-grievances', collect($daily->json('sections.0.rows'))->pluck('id')->all());
    }

    public function test_the_budget_search_rows_sum_expenses_for_spent_and_leave_out_unapproved_budgets(): void
    {
        $org = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $approved = Budget::create(['organization_id' => $org->id, 'title' => 'Zorbfest', 'allocated_amount' => 10000, 'remaining_amount' => 9000, 'warning_threshold' => 100, 'submission_status' => 'approved']);
        Budget::create(['organization_id' => $org->id, 'title' => 'Quillgate', 'allocated_amount' => 8000, 'remaining_amount' => 8000, 'warning_threshold' => 100, 'submission_status' => 'pending_department_head']);
        Transaction::create(['organization_id' => $org->id, 'budget_id' => $approved->id, 'recorded_by' => $admin->school_id, 'type' => 'expense', 'category' => 'venue', 'amount' => 4000, 'description' => 'Hall', 'transaction_date' => now()]);
        Transaction::create(['organization_id' => $org->id, 'budget_id' => $approved->id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'category' => 'sponsorship', 'amount' => 3000, 'description' => 'Sponsor', 'transaction_date' => now()]);

        Sanctum::actingAs($admin);

        $res = $this->postJson('/api/ai/assistant/ask', ['question' => 'Zorbfest Quillgate', 'topic' => 'semantic_rag'])->assertOk();

        $payload = json_encode(collect($res->json('sections'))->pluck('rows')->flatten(1)->map(fn (array $row) => $row['primary'].' '.$row['secondary']), JSON_UNESCAPED_UNICODE);
        $this->assertStringContainsString('Spent: ₱4,000.00', $payload);
        $this->assertStringNotContainsString('Quillgate', $payload);
    }

    /**
     * @return array{org: Organization, student: User, officer: User, sensitive: array<int, string>}
     */
    private function seedSensitiveOrganizationData(): array
    {
        $org = Organization::factory()->create(['review_remarks' => 'Vexillum registration remark']);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);
        $officer->accountProfiles()->update(['modules' => ['events']]);
        $requester = User::factory()->student()->create(['organization_id' => $org->id, 'first_name' => 'Quenby', 'last_name' => 'Zarathustra']);

        ApprovalRequest::create([
            'organization_id' => $org->id,
            'entity_type' => 'budget',
            'entity_id' => 999,
            'required_role' => 'ADMIN',
            'requested_by' => $requester->school_id,
            'status' => 'pending',
            'requested_at' => now(),
        ]);

        $reqType = ComplianceRequirementType::create([
            'category' => 'organization',
            'academic_year' => '2026-2027',
            'name' => 'Constitution and By-Laws',
            'description' => 'Updated constitution',
            'deadline_at' => now()->addDays(14),
            'is_active' => true,
            'created_by' => $admin->school_id,
        ]);
        OrganizationComplianceSubmission::create([
            'organization_id' => $org->id,
            'requirement_type_id' => $reqType->id,
            'status' => 'returned',
            'remarks' => 'Glimmerfen signature missing',
            'file_path' => 'compliance/zephyrcrest-minutes.pdf',
            'file_original_name' => 'zephyrcrest-minutes.pdf',
            'mime_type' => 'application/pdf',
            'file_size' => 1024,
            'submitted_by' => $admin->school_id,
            'submitted_at' => now(),
        ]);

        Task::factory()->create([
            'organization_id' => $org->id,
            'title' => 'Obsidian Roster Audit',
            'assigned_to' => $requester->school_id,
            'created_by' => $admin->school_id,
            'status' => 'overdue',
            'deadline' => now()->subDay(),
        ]);

        Merchandise::factory()->create(['organization_id' => $org->id, 'name' => 'Dormant Frostwhale Jersey', 'is_active' => false, 'stock_quantity' => 3]);
        Merchandise::factory()->create(['organization_id' => $org->id, 'name' => 'Plain Sunbird Lanyard', 'is_active' => true, 'stock_quantity' => 30]);

        return [
            'org' => $org,
            'student' => $student,
            'officer' => $officer,
            'sensitive' => ['Quenby', 'Zarathustra', 'zephyrcrest', 'Glimmerfen', 'Vexillum', 'Obsidian', 'Frostwhale'],
        ];
    }

    private function assertRefusedWithoutLeaking($response, array $sensitive): void
    {
        $response->assertOk();
        $response->assertJsonPath('title', 'Not available for your access');
        $response->assertJsonPath('sections', []);
        $response->assertJsonPath('engine', 'semantic_rag+deterministic');
        $this->assertStringContainsString('does not have access', $response->json('answer'));

        $payload = json_encode($response->json());
        foreach ($sensitive as $needle) {
            $this->assertStringNotContainsString($needle, $payload);
        }
    }

    public function test_a_student_is_refused_every_topic_outside_the_student_allowlist_without_leaking_data(): void
    {
        $seeded = $this->seedSensitiveOrganizationData();
        Sanctum::actingAs($seeded['student']);

        foreach (['missing_submissions', 'submitted_documents', 'pending_approvals', 'organizations_without_admin', 'tasks_workload', 'grievances_status'] as $topic) {
            $res = $this->postJson('/api/ai/assistant/ask', ['question' => 'Give me the status please', 'topic' => $topic]);
            $res->assertJsonPath('intent', $topic);
            $this->assertRefusedWithoutLeaking($res, $seeded['sensitive']);
        }
    }

    public function test_an_officer_without_the_module_is_refused_that_topic_without_leaking_data(): void
    {
        $seeded = $this->seedSensitiveOrganizationData();
        Sanctum::actingAs($seeded['officer']);

        foreach (['missing_submissions', 'submitted_documents'] as $topic) {
            $res = $this->postJson('/api/ai/assistant/ask', ['question' => 'Give me the status please', 'topic' => $topic]);
            $res->assertJsonPath('intent', $topic);
            $this->assertRefusedWithoutLeaking($res, $seeded['sensitive']);
        }
    }

    public function test_an_officer_without_the_tasks_module_never_gets_task_titles_or_assignees_from_a_free_text_question(): void
    {
        $seeded = $this->seedSensitiveOrganizationData();
        Task::factory()->create([
            'organization_id' => $seeded['org']->id,
            'title' => 'Gossamer Banner Sewing',
            'assigned_to' => $seeded['officer']->school_id,
            'status' => 'pending',
        ]);
        Sanctum::actingAs($seeded['officer']);

        $res = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'task workload assignment deliverable deadline progress banner sewing roster audit',
            'topic' => 'semantic_rag',
        ])->assertOk();

        $res->assertJsonPath('intent', 'semantic_rag');
        $payload = json_encode($res->json());
        foreach (['Gossamer', 'Obsidian', 'Quenby', 'Zarathustra'] as $needle) {
            $this->assertStringNotContainsString($needle, $payload);
        }
    }

    public function test_a_student_free_text_question_never_surfaces_compliance_remarks_other_tasks_or_inactive_items(): void
    {
        $seeded = $this->seedSensitiveOrganizationData();
        Sanctum::actingAs($seeded['student']);

        // The question avoids the seeded words themselves because the title and section descriptions repeat it.
        $res = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'lanyard jersey constitution returned signature missing minutes file overdue task roster audit',
            'topic' => 'semantic_rag',
        ])->assertOk();

        $res->assertJsonPath('intent', 'semantic_rag');
        $payload = json_encode($res->json());
        $this->assertStringContainsString('Plain Sunbird Lanyard', $payload);
        foreach ($seeded['sensitive'] as $needle) {
            $this->assertStringNotContainsString($needle, $payload);
        }
    }

    public function test_the_organization_head_guides_say_who_names_the_head(): void
    {
        $guides = collect(app(HowToGuideLibrary::class)->all())->keyBy('id');
        $sao = json_encode($guides['sao-create-admin']);
        $this->assertStringContainsString('university-wide', $sao);
        $this->assertStringNotContainsString('Add first administrator', $sao);
        $this->assertStringNotContainsString('Add first administrator', json_encode($guides['sao-create-organization']));
        $this->assertSame(['DEPARTMENT_HEAD'], $guides['dean-name-organization-head']['roles']);
        $this->assertStringContainsString('Give access', json_encode($guides['dean-name-organization-head']));
    }

    public function test_all_how_to_guide_paths_conform_to_client_route_allowlist(): void
    {
        $guides = app(HowToGuideLibrary::class)->all();
        $routeAccess = app(ClientRouteAccess::class);

        foreach ($guides as $guide) {
            foreach ($guide['steps'] as $stepIndex => $step) {
                $path = $step['path'];
                if ($path === null) {
                    continue;
                }

                foreach ($guide['roles'] as $role) {
                    $resolvedPath = is_array($path) ? ($path[$role] ?? null) : $path;
                    if ($resolvedPath === null) {
                        continue;
                    }

                    $checked = $routeAccess->hrefFor($role, $resolvedPath);
                    $this->assertNotNull(
                        $checked,
                        "Guide '{$guide['id']}' step #{$stepIndex} path '{$resolvedPath}' is not allowed for role {$role}"
                    );
                }
            }
        }
    }

    public function test_a_student_is_shown_candidates_only_for_finalized_active_or_closed_elections(): void
    {
        $org = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);

        $shown = [];
        foreach ([
            'Zorbfest' => ['upcoming', null, false],
            'Quillgate' => ['pending_approval', null, false],
            'Marmalade' => ['active', now(), true],
            'Zephyrine' => ['closed', now(), true],
        ] as $surname => [$status, $finalizedAt, $isShown]) {
            $election = Election::factory()->create(['organization_id' => $org->id, 'status' => $status, 'finalized_at' => $finalizedAt]);
            $position = ElectionPosition::factory()->create(['election_id' => $election->id]);
            $candidateUser = User::factory()->student()->create(['organization_id' => $org->id, 'first_name' => 'Candidate', 'last_name' => $surname]);
            Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id, 'user_id' => $candidateUser->school_id]);
            $shown[$surname] = $isShown;
        }

        $payloadFor = function (User $caller) {
            Sanctum::actingAs($caller);
            $res = $this->postJson('/api/ai/assistant/ask', ['question' => 'Zorbfest Quillgate Marmalade Zephyrine', 'topic' => 'semantic_rag'])->assertOk();

            return json_encode(collect($res->json('sections'))->pluck('rows')->flatten(1)->pluck('primary'));
        };

        $payload = $payloadFor($student);
        foreach ($shown as $surname => $isShown) {
            $isShown
                ? $this->assertStringContainsString($surname, $payload)
                : $this->assertStringNotContainsString($surname, $payload);
        }

        $this->assertStringContainsString('Zorbfest', $payloadFor($admin));
    }

    /** @return array{org: Organization, student: User, admin: User, officer: User} */
    private function seedDirectoryOrganization(): array
    {
        $org = Organization::factory()->create([
            'name' => 'Directory Guild',
            'acronym' => 'DGLD',
            'organization_type' => 'STUDENT_ORGANIZATION',
            'lifecycle_status' => 'active',
        ]);
        $student = User::factory()->student()->create([
            'organization_id' => $org->id,
            'school_id' => 7770001,
            'email' => 'asker.student@example.test',
            'account_status' => 'active',
        ]);
        $admin = User::factory()->admin()->create([
            'organization_id' => $org->id,
            'school_id' => 7770002,
            'first_name' => 'Marco',
            'last_name' => 'Dela Cruz',
            'email' => 'marco.admin@example.test',
            'position_title' => null,
            'account_status' => 'active',
        ]);
        $officer = User::factory()->officer()->create([
            'organization_id' => $org->id,
            'school_id' => 7770003,
            'first_name' => 'Diego',
            'last_name' => 'Villanueva',
            'email' => 'diego.treasurer@example.test',
            'position_title' => 'Treasurer',
            'account_status' => 'active',
        ]);

        return compact('org', 'student', 'admin', 'officer');
    }

    public function test_a_student_never_receives_another_persons_email_or_school_id_from_the_directory(): void
    {
        $seeded = $this->seedDirectoryOrganization();
        Sanctum::actingAs($seeded['student']);

        foreach ([
            'Who are the officers and treasurer, and what is the organization budget and how much is left?',
            'What is the organization budget and how much is left?',
            'give me the email and school id of the officers and admin',
            'Marco Dela Cruz contact details',
        ] as $question) {
            $res = $this->postJson('/api/ai/assistant/ask', ['question' => $question])->assertOk();
            $payload = json_encode($res->json());

            foreach (['admin', 'officer'] as $who) {
                $this->assertStringNotContainsString((string) $seeded[$who]->school_id, $payload, $question);
                $this->assertStringNotContainsString($seeded[$who]->email, $payload, $question);
            }
        }

        $res = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'Who are the officers and treasurer?',
            'topic' => 'semantic_rag',
        ])->assertOk();
        $payload = json_encode($res->json());
        $this->assertStringContainsString('Diego Villanueva', $payload);
        $this->assertStringContainsString('Treasurer', $payload);
    }

    public function test_an_officer_and_an_admin_still_get_the_directory_emails_and_school_ids(): void
    {
        $seeded = $this->seedDirectoryOrganization();

        foreach (['officer', 'admin'] as $asker) {
            Sanctum::actingAs($seeded[$asker]);
            $res = $this->postJson('/api/ai/assistant/ask', [
                'question' => 'Who are the officers and treasurer?',
                'topic' => 'semantic_rag',
            ])->assertOk();
            $payload = json_encode($res->json());

            $this->assertStringContainsString('diego.treasurer@example.test', $payload, $asker);
            $this->assertStringContainsString('7770003', $payload, $asker);
        }
    }

    public function test_the_directory_writes_role_names_as_normal_words_not_spaced_letters(): void
    {
        $seeded = $this->seedDirectoryOrganization();
        Sanctum::actingAs($seeded['admin']);

        $res = $this->postJson('/api/ai/assistant/ask', [
            'question' => 'Who are the officers, admin and treasurer?',
            'topic' => 'semantic_rag',
        ])->assertOk();
        $payload = json_encode($res->json());

        $this->assertStringContainsString('Role: Organization Head', $payload);
        $this->assertStringContainsString('Role: Officer', $payload);
        $this->assertStringNotContainsString('A D M I N', $payload);
        $this->assertStringNotContainsString('S B O', $payload);
    }

    private function storeAskAiRow(User $asker, string $role, string $text, string $featureType = 'ASK_AI_ASSISTANT'): AiOutput
    {
        return AiOutput::create([
            'organization_id' => $asker->organization_id,
            'feature_type' => $featureType,
            'reference_type' => User::class,
            'reference_id' => $asker->school_id,
            'prompt_text' => 'Who are the officers?',
            'output_text' => $text,
            'context_version' => 'ask-ai-rag-v2',
            'structured_input' => ['question' => 'Who are the officers?', 'topic' => 'semantic_rag', 'intent' => 'semantic_rag', 'role' => $role],
            'structured_output' => ['title' => 'Semantic Knowledge Search & Briefing', 'highlights' => [], 'section_count' => 1],
            'status' => 'completed',
            'decision_status' => 'accepted',
            'requested_by' => $asker->school_id,
            'decided_by' => $asker->school_id,
            'decided_at' => now(),
            'created_at' => now(),
        ]);
    }

    public function test_the_recent_questions_replay_stored_answers_word_for_word_until_the_migration_removes_a_students(): void
    {
        $seeded = $this->seedDirectoryOrganization();
        $leakedText = 'Semantic RAG retrieved 2 relevant record(s). Key findings: Diego Villanueva (Treasurer, ID #7770003); Marco Dela Cruz (Admin, ID #7770002).';
        $leakedStudent = $this->storeAskAiRow($seeded['student'], 'STUDENT', $leakedText);
        $plainStudent = $this->storeAskAiRow($seeded['student'], 'STUDENT', 'Your clearance has every signature.');
        $officerRow = $this->storeAskAiRow($seeded['officer'], 'SBO_OFFICER', $leakedText);
        $adminRow = $this->storeAskAiRow($seeded['admin'], 'ADMIN', $leakedText);
        $notAnAnswer = $this->storeAskAiRow($seeded['student'], 'STUDENT', $leakedText, 'FINANCIAL_SUMMARY');

        Sanctum::actingAs($seeded['student']);
        $replayed = $this->getJson('/api/ai/assistant')->assertOk()->json('recent_queries');
        $this->assertEqualsCanonicalizing([$leakedStudent->id, $plainStudent->id], array_column($replayed, 'id'));
        $this->assertStringContainsString('ID #7770003', collect($replayed)->firstWhere('id', $leakedStudent->id)['answer']);

        $migration = require database_path('migrations/2026_11_11_100001_delete_student_ask_ai_history.php');
        $migration->up();
        $migration->up();

        $this->assertDatabaseMissing('ai_outputs', ['id' => $leakedStudent->id]);
        $this->assertDatabaseMissing('ai_outputs', ['id' => $plainStudent->id]);
        $this->assertDatabaseHas('ai_outputs', ['id' => $officerRow->id]);
        $this->assertDatabaseHas('ai_outputs', ['id' => $adminRow->id]);
        $this->assertDatabaseHas('ai_outputs', ['id' => $notAnAnswer->id]);
        $this->assertSame(3, AiOutput::count());
        $this->assertSame([], $this->getJson('/api/ai/assistant')->assertOk()->json('recent_queries'));

        Sanctum::actingAs($seeded['officer']);
        $this->assertSame([$officerRow->id], array_column($this->getJson('/api/ai/assistant')->assertOk()->json('recent_queries'), 'id'));
    }
}
