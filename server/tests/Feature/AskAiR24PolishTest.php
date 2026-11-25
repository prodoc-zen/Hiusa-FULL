<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Budget;
use App\Models\ComplianceRequirementType;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\AskAiService;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

/**
 * r24: the three Ask AI misses left after r23 on production.
 * Q1 the numeric guard read the "-2" of a receipt number as a negative figure and replaced a correct finance answer,
 * Q3 an accreditation that is Returned was sent to the new-organization screen instead of the compliance screen.
 * (Q2, the overdue tasks in the report preparation facts, is covered in AskAiR23FactsTest.)
 */
class AskAiR24PolishTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
        RateLimiter::for('ai-generation', fn () => Limit::none());
        $this->travelTo(Carbon::parse('2026-11-25 08:00:00'));

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-06-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-06-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
    }

    private function fake(array $chunks = []): AskAiChatFakeGenerator
    {
        $fake = new AskAiChatFakeGenerator($chunks, null, 'claude-test');
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    private function factsOf(AskAiChatFakeGenerator $fake): array
    {
        $turn = $fake->lastUserTurn();

        return json_decode(substr($turn, strpos($turn, '```json') + 8, strrpos($turn, '```') - strpos($turn, '```json') - 8), true);
    }

    // -------------------------------------------------------------------------
    // Q1: a receipt number is a code, not a negative number
    // -------------------------------------------------------------------------

    public function test_q1_a_correct_finance_answer_that_quotes_a_receipt_number_is_kept(): void
    {
        $org = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active', 'is_active' => true]);
        $president = User::factory()->admin()->create(['organization_id' => $org->id]);
        $budget = Budget::create(['organization_id' => $org->id, 'title' => 'General Operations Fund', 'allocated_amount' => 50000, 'remaining_amount' => 36500, 'warning_threshold' => 5000, 'submission_status' => 'approved']);
        Transaction::factory()->create(['organization_id' => $org->id, 'budget_id' => $budget->id, 'type' => 'expense', 'category' => 'Operations', 'amount' => 13500, 'receipt_reference' => 'HIUSA-2-00000015', 'transaction_date' => '2026-11-24']);
        Sanctum::actingAs($president);
        $text = 'Your finance is steady. The newest expense, ₱13,500.00 for Operations with receipt HIUSA-2-00000015 on Nov 24, 2026, came out of General Operations Fund, which has ₱36,500.00 left.';
        $fake = $this->fake([$text]);

        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'How is our finance?'])->assertOk();

        // The receipt number must be in what the writer was given, or this test proves nothing.
        $this->assertStringContainsString('HIUSA-2-00000015', json_encode($this->factsOf($fake), JSON_UNESCAPED_UNICODE));
        $response->assertJsonPath('message.payload.intent', 'finance_health');
        $response->assertJsonPath('message.payload.engine', 'claude');
        $response->assertJsonPath('message.payload.notice', null);
        $this->assertSame($text, $response->json('message.content'));
    }

    public function test_q1_a_receipt_number_with_a_part_the_facts_do_not_carry_is_still_replaced(): void
    {
        $org = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active', 'is_active' => true]);
        $president = User::factory()->admin()->create(['organization_id' => $org->id]);
        $budget = Budget::create(['organization_id' => $org->id, 'title' => 'General Operations Fund', 'allocated_amount' => 50000, 'remaining_amount' => 36500, 'warning_threshold' => 5000, 'submission_status' => 'approved']);
        Transaction::factory()->create(['organization_id' => $org->id, 'budget_id' => $budget->id, 'type' => 'expense', 'category' => 'Operations', 'amount' => 13500, 'receipt_reference' => 'HIUSA-2-00000015', 'transaction_date' => '2026-11-24']);
        Sanctum::actingAs($president);
        $this->fake(['The newest expense has receipt HIUSA-7-00000015 and General Operations Fund has ₱36,500.00 left.']);

        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'How is our finance?'])->assertOk();

        $response->assertJsonPath('message.payload.engine', 'records');
        $this->assertNotNull($response->json('message.payload.notice'));
    }

    // -------------------------------------------------------------------------
    // Q3: a Returned accreditation is reviewed on the compliance screen
    // -------------------------------------------------------------------------

    /** @return array{0: User, 1: Organization} a Department Head and an organization of the college whose accreditation is Returned */
    private function returnedAccreditation(): array
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college);
        $org = $this->makeCollegeStudentOrganization($college, ['acronym' => 'PSITS-CCS', 'name' => 'PSITS', 'lifecycle_status' => 'active', 'is_active' => true]);
        $requester = User::factory()->admin()->create(['organization_id' => $org->id]);
        $type = ComplianceRequirementType::create(['category' => 'organization', 'academic_year' => '2026-2027', 'name' => 'Constitution', 'description' => 'x', 'deadline_at' => now()->addDays(14), 'is_active' => true, 'created_by' => $head->school_id]);
        OrganizationComplianceSubmission::create(['organization_id' => $org->id, 'requirement_type_id' => $type->id, 'status' => 'returned', 'file_path' => 'compliance/a.pdf', 'file_original_name' => 'a.pdf', 'mime_type' => 'application/pdf', 'file_size' => 10, 'submitted_by' => $requester->school_id, 'submitted_at' => now()]);

        return [$head, $org];
    }

    public function test_q3_a_returned_accreditation_row_names_the_compliance_screen_for_the_head(): void
    {
        [$head] = $this->returnedAccreditation();

        $payload = $this->app->make(AskAiService::class)->deterministicAnswer($head, 'Which organizations need my approval? PSITS accreditation', 'pending_approvals');
        $chunk = collect($payload['rag_chunks'])->first(fn (array $row) => str_contains((string) $row['secondary'], 'Accreditation: Returned'));

        $this->assertNotNull($chunk, json_encode(array_column($payload['rag_chunks'], 'secondary')));
        $this->assertStringContainsString('Review its accreditation in College compliance', $chunk['secondary']);
    }

    public function test_q3_an_accredited_organization_is_not_sent_to_review_anything(): void
    {
        [$head, $org] = $this->returnedAccreditation();
        OrganizationComplianceSubmission::where('organization_id', $org->id)->update(['status' => 'approved']);

        $payload = $this->app->make(AskAiService::class)->deterministicAnswer($head, 'Which organizations need my approval? PSITS accreditation', 'pending_approvals');
        $chunk = collect($payload['rag_chunks'])->first(fn (array $row) => str_contains((string) $row['secondary'], 'Accreditation: Accredited'));

        $this->assertNotNull($chunk);
        $this->assertStringNotContainsString('Review its accreditation', $chunk['secondary']);
    }

    public function test_q3_the_writer_is_told_that_organization_applications_decide_new_organizations_and_college_compliance_holds_accreditation(): void
    {
        [$head] = $this->returnedAccreditation();
        Sanctum::actingAs($head);
        $fake = $this->fake(['Nothing is waiting for you right now.']);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'Which organizations need my approval?'])->assertOk();

        $screens = collect($this->factsOf($fake)['screens'])->keyBy('screen');
        $this->assertSame('/dashboard/department-head/compliance', $screens['College compliance']['href']);
        $this->assertStringContainsString('accreditation requirements', $screens['College compliance']['use_it_to']);
        $this->assertStringContainsString('start a new organization', $screens['Organization applications']['use_it_to']);
        $this->assertStringContainsString('never holds an existing organization', $screens['Organization applications']['use_it_to']);
        $this->assertStringContainsString('Review its accreditation in College compliance', json_encode($this->factsOf($fake)['records'], JSON_UNESCAPED_UNICODE));
    }
}
