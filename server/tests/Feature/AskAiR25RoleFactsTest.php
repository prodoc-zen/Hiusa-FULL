<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Budget;
use App\Models\Election;
use App\Models\ElectionBallot;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\FinancialReportDeadline;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\AiInstructions;
use App\Services\Ai\AnswerMarkdown;
use App\Services\Ai\AskAiService;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

/**
 * r25: five Ask AI answers that were wrong in production because the facts did not say what the person's role allows or
 * what this month holds. F1 a finance officer may record ledger entries, F2 this month and last month in the ledger,
 * F3 the forecast on file, F4 the elections a student can vote in, F5 the entries the report check counts as unlinked.
 * Every date is pinned to 25 November 2026, so the tests do not drift with the calendar.
 */
class AskAiR25RoleFactsTest extends TestCase
{
    use RefreshDatabase;

    private AcademicSemester $semester;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
        RateLimiter::for('ai-generation', fn () => Limit::none());
        $this->travelTo(Carbon::parse('2026-11-25 08:00:00', 'Asia/Manila'));

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-06-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $this->semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-06-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
    }

    private function org(): Organization
    {
        return Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active', 'is_active' => true]);
    }

    private function officer(Organization $org, ?string $title): User
    {
        return User::factory()->officer()->create(['organization_id' => $org->id, 'position_title' => $title]);
    }

    private function service(): AskAiService
    {
        return $this->app->make(AskAiService::class);
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

    private function section(array $payload, string $id): array
    {
        return collect($payload['sections'])->firstWhere('id', $id) ?? ['rows' => []];
    }

    private function rowText(array $rows): string
    {
        return implode("\n", array_map(fn (array $row) => implode(' | ', array_filter([$row['primary'] ?? null, $row['secondary'] ?? null, $row['status'] ?? null, $row['meta'] ?? null])), $rows));
    }

    private function everything(array $payload): string
    {
        return json_encode($payload, JSON_UNESCAPED_UNICODE);
    }

    private function entry(Organization $org, string $type, string $category, float $amount, string $date, array $overrides = []): Transaction
    {
        return Transaction::factory()->create([
            'organization_id' => $org->id,
            'budget_id' => null,
            'event_id' => null,
            'type' => $type,
            'category' => $category,
            'amount' => $amount,
            'transaction_date' => $date,
            'receipt_reference' => 'OR-'.fake()->unique()->numerify('#####'),
            ...$overrides,
        ]);
    }

    // -------------------------------------------------------------------------
    // F1: Can I record an expense against the Sports Fest budget?
    // -------------------------------------------------------------------------

    private function sportsFestOrg(): array
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $event = Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'academic_semester_id' => $this->semester->id, 'title' => 'Sports Fest 2024', 'status' => 'approved', 'start_time' => '2026-12-08 07:00:00', 'end_time' => '2026-12-08 18:00:00']);
        Budget::create(['organization_id' => $org->id, 'title' => 'General Operations Fund', 'allocated_amount' => 50000, 'remaining_amount' => 36500, 'warning_threshold' => 5000, 'submission_status' => 'approved']);
        Budget::create(['organization_id' => $org->id, 'event_id' => $event->id, 'title' => 'Sports Fest 2024 Budget', 'allocated_amount' => 25000, 'remaining_amount' => 25000, 'warning_threshold' => 5000, 'submission_status' => 'pending_department_head']);

        return [$org, $admin, $event];
    }

    private const RECORD_QUESTION = 'Can I record an expense against the Sports Fest budget?';

    public function test_f1_a_treasurer_is_told_she_can_record_ledger_entries_and_why_the_position_allows_it(): void
    {
        [$org] = $this->sportsFestOrg();
        $treasurer = $this->officer($org, 'Treasurer');

        $this->assertSame('how_to_guide', $this->service()->classifyIntent(self::RECORD_QUESTION, null, 'SBO_OFFICER'));
        $payload = $this->service()->deterministicAnswer($treasurer, self::RECORD_QUESTION, 'how_to_guide');

        $this->assertStringContainsString('Yes, you can', $payload['answer']);
        $this->assertStringNotContainsString('you cannot', $payload['answer']);
        $this->assertStringNotContainsString('done by the Organization Admin', $this->everything($payload));
        $this->assertStringContainsString('Treasurer', $payload['answer']);
        $this->assertStringContainsString('Can handle finance', $payload['answer']);
    }

    public function test_f1_the_budget_facts_say_the_sports_fest_budget_is_pending_so_nothing_can_be_linked_and_the_event_works_without_it(): void
    {
        [$org] = $this->sportsFestOrg();
        $treasurer = $this->officer($org, 'Treasurer');

        $payload = $this->service()->deterministicAnswer($treasurer, self::RECORD_QUESTION, 'how_to_guide');

        $this->assertStringContainsString('Sports Fest 2024 Budget', $payload['answer']);
        $this->assertStringContainsString('waiting for the Department Head', $payload['answer']);
        $this->assertStringContainsString('cannot be linked yet', $payload['answer']);
        $this->assertStringContainsString('General Operations Fund', $payload['answer']);
        $this->assertStringContainsString('under the Sports Fest 2024 event without a budget', $payload['answer']);
        $this->assertStringNotContainsString('[', $payload['answer']);
    }

    public function test_f1_the_plain_how_to_question_carries_the_same_facts_and_the_admin_keeps_working(): void
    {
        [$org, $admin] = $this->sportsFestOrg();
        $treasurer = $this->officer($org, 'Treasurer');

        foreach ([$treasurer, $admin] as $user) {
            $payload = $this->service()->deterministicAnswer($user, 'How do I record an expense in the ledger?', 'how_to_guide');

            $this->assertStringContainsString('From your records', $payload['answer']);
            $this->assertStringContainsString('Sports Fest 2024 Budget is waiting for the Department Head', $payload['answer']);
            $this->assertStringNotContainsString('done by', $payload['answer']);
            $this->assertNotEmpty($this->section($payload, 'how-to-readiness')['rows']);
        }
    }

    public function test_f1_an_officer_whose_position_does_not_handle_finance_is_told_why_with_the_position_named(): void
    {
        [$org] = $this->sportsFestOrg();
        $pio = $this->officer($org, 'Public Information Officer');

        $payload = $this->service()->deterministicAnswer($pio, self::RECORD_QUESTION, 'how_to_guide');

        $this->assertStringContainsString('Public Information Officer', $payload['answer']);
        $this->assertStringContainsString('Can handle finance', $payload['answer']);
        $this->assertStringContainsString('Organization Admin', $payload['answer']);
    }

    public function test_f1_the_facts_the_model_receives_say_whether_this_person_can_write_finance_and_which_position_decides_it(): void
    {
        [$org] = $this->sportsFestOrg();
        $treasurer = $this->officer($org, 'Treasurer');
        Sanctum::actingAs($treasurer);
        $fake = $this->fake(['Yes. As Treasurer you can record the expense in the ledger.']);

        $this->postJson('/api/ai/assistant/chat', ['message' => self::RECORD_QUESTION])->assertOk();

        $facts = $this->factsOf($fake);
        $this->assertStringContainsString('can record', $facts['finance_access']);
        $this->assertStringContainsString('Treasurer', $facts['finance_access']);

        $pio = $this->officer($org, 'Public Information Officer');
        $this->assertStringContainsString('cannot record', $this->service()->chatContext($pio)['finance_access']);
        $this->assertNull($this->service()->chatContext(User::factory()->student()->create(['organization_id' => $org->id]))['finance_access']);
    }

    public function test_f1_a_bracket_placeholder_step_in_an_answer_is_rewritten_into_words_and_a_drafted_message_is_left_alone(): void
    {
        $text = "1. **Get the expense posted.** Send the details: [amount], [date], [payee] and the receipt.\n2. Ask for the [Receipt number] in the ledger.\n\n> Dear [name], the meeting is on [date].";

        $clean = AnswerMarkdown::sanitize($text, fn () => false);

        $this->assertStringNotContainsString('amount\\]', $clean);
        $this->assertStringContainsString('the amount, the date, the payee and the receipt', $clean);
        $this->assertStringContainsString('the receipt number in the ledger', $clean);
        // A message the person copies keeps its placeholders, and a checkbox or a typed bracket is not one.
        $this->assertStringContainsString('Dear \\[name\\]', $clean);
        $this->assertStringContainsString('- [ ] ', AnswerMarkdown::sanitize('- [ ] Done', fn () => false));
        $this->assertStringContainsString('Budget \\[Draft\\]', AnswerMarkdown::sanitize('1. Open '.AnswerMarkdown::escape('Budget [Draft]'), fn () => false));
    }

    public function test_f1_the_placeholder_rewrite_is_bounded_and_fast_on_a_hostile_line(): void
    {
        $hostile = '1. '.str_repeat('[', 60000).str_repeat('a ', 30000);
        $started = microtime(true);
        AnswerMarkdown::sanitize($hostile, fn () => false);
        $this->assertLessThan(1.5, microtime(true) - $started);

        // The longest placeholder that still reads as one is rewritten.
        $name = str_repeat('x', 40);
        $this->assertStringContainsString("the {$name}", AnswerMarkdown::sanitize("1. Add [{$name}] now", fn () => false));
    }

    public function test_f1_the_instructions_forbid_bracket_placeholders_in_steps_and_describe_the_finance_access_fact(): void
    {
        $text = AiInstructions::askAiChat();

        $this->assertStringContainsString('finance_access', $text);
        $this->assertStringContainsString('never write a bracket placeholder', $text);
    }

    // -------------------------------------------------------------------------
    // F2: How much did we spend this month?
    // -------------------------------------------------------------------------

    private function novemberLedger(Organization $org): void
    {
        // Truth for November 2026: 37,300 spent. September and October are the traps.
        foreach ([['Operations', 20000], ['Venue', 5000], ['Food', 4500], ['Supplies', 3800], ['Printing', 2200], ['Transport', 1800]] as [$category, $amount]) {
            $this->entry($org, 'expense', $category, $amount, '2026-11-12 10:00:00');
        }
        $this->entry($org, 'income', 'Sponsorship', 9000, '2026-11-05 10:00:00');
        $this->entry($org, 'expense', 'Merchandise', 12500, '2026-09-12 10:00:00');
        $this->entry($org, 'expense', 'Venue', 6100, '2026-10-20 10:00:00');
        $this->entry($org, 'income', 'Membership', 3000, '2026-10-02 10:00:00');
    }

    public function test_f2_this_month_and_last_month_totals_are_in_the_finance_facts_and_the_september_row_is_not_this_month(): void
    {
        $org = $this->org();
        $treasurer = $this->officer($org, 'Treasurer');
        $this->novemberLedger($org);

        $this->assertSame('finance_health', $this->service()->classifyIntent('How much did we spend this month?', null, 'SBO_OFFICER'));
        $payload = $this->service()->deterministicAnswer($treasurer, 'How much did we spend this month?', 'finance_health');

        $this->assertStringContainsString('This month (November 2026)', $payload['answer']);
        $this->assertStringContainsString('₱37,300.00 expenses', $payload['answer']);
        $this->assertStringContainsString('last month (October 2026)', $payload['answer']);
        $this->assertStringContainsString('₱6,100.00 expenses', $payload['answer']);
        $labels = array_column($payload['highlights'], 'value', 'label');
        $this->assertSame('₱37,300.00', $labels['Spent in November 2026']);
        $this->assertSame('₱6,100.00', $labels['Spent in October 2026']);

        $rows = $this->rowText($this->section($payload, 'ledger-this-month')['rows']);
        $this->assertStringContainsString('Operations', $rows);
        $this->assertStringContainsString('₱20,000.00', $rows);
        $this->assertStringNotContainsString('Merchandise', $rows);
        $this->assertStringContainsString('Merchandise', $this->everything($this->section($payload, 'ledger-by-category')));
    }

    public function test_f2_month_edges_follow_manila_time(): void
    {
        $org = $this->org();
        $treasurer = $this->officer($org, 'Treasurer');
        $this->entry($org, 'expense', 'Edge', 100, '2026-10-31 23:59:59');
        $this->entry($org, 'expense', 'Edge', 200, '2026-11-01 00:00:00');
        $this->entry($org, 'expense', 'Edge', 400, '2026-11-30 23:59:59');
        $this->entry($org, 'expense', 'Edge', 800, '2026-12-01 00:00:00');

        $payload = $this->service()->deterministicAnswer($treasurer, 'How much did we spend this month?', 'finance_health');

        $labels = array_column($payload['highlights'], 'value', 'label');
        $this->assertSame('₱600.00', $labels['Spent in November 2026']);
        $this->assertSame('₱100.00', $labels['Spent in October 2026']);
    }

    public function test_f2_a_month_with_no_entries_says_so_instead_of_staying_silent(): void
    {
        $org = $this->org();
        $treasurer = $this->officer($org, 'Treasurer');
        $this->entry($org, 'expense', 'Venue', 900, '2026-09-12 10:00:00');

        $payload = $this->service()->deterministicAnswer($treasurer, 'How much did we spend this month?', 'finance_health');

        $this->assertStringContainsString('no ledger entries were recorded this month', mb_strtolower($payload['answer']));
        $this->assertSame('₱0.00', array_column($payload['highlights'], 'value', 'label')['Spent in November 2026']);
    }

    public function test_f2_the_chat_facts_for_the_treasurer_carry_the_month_figures(): void
    {
        $org = $this->org();
        $treasurer = $this->officer($org, 'Treasurer');
        $this->novemberLedger($org);
        Sanctum::actingAs($treasurer);
        $fake = $this->fake(['You spent PHP 37,300.00 this month.']);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'How much did we spend this month?'])->assertOk();

        $facts = json_encode($this->factsOf($fake), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $this->assertStringContainsString('₱37,300.00', $facts);
        $this->assertStringContainsString('Spent in November 2026', $facts);
    }

    // -------------------------------------------------------------------------
    // F3: What is the forecast for next month?
    // -------------------------------------------------------------------------

    private function decemberForecast(Organization $org, User $by): FinancialForecast
    {
        return FinancialForecast::create([
            'organization_id' => $org->id,
            'forecast_period' => '2026-12',
            'predicted_income' => 9250,
            'predicted_expense' => 4166.67,
            'predicted_balance' => 5083.33,
            'safe_spending_limit' => 89066.66,
            'generated_by' => $by->school_id,
            'model_details' => ['engine' => 'php-fallback'],
        ]);
    }

    public function test_f3_the_forecast_answer_leads_with_the_forecast_on_file_for_next_month(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $treasurer = $this->officer($org, 'Treasurer');
        $this->decemberForecast($org, $admin);

        $this->assertSame('ai_tools', $this->service()->classifyIntent('What is the forecast for next month?', null, 'SBO_OFFICER'));
        $payload = $this->service()->deterministicAnswer($treasurer, 'What is the forecast for next month?', 'ai_tools');

        $this->assertStringContainsString('December 2026', $payload['answer']);
        foreach (['₱9,250.00', '₱4,166.67', '₱5,083.33', '₱89,066.66'] as $figure) {
            $this->assertStringContainsString($figure, $payload['answer']);
        }
        $this->assertStringNotContainsString('none', mb_strtolower($payload['answer']));
        $this->assertStringContainsString('₱5,083.33', $this->rowText($this->section($payload, 'forecasts-on-file')['rows']));
    }

    public function test_f3_with_no_forecast_for_next_month_the_facts_say_so_and_name_the_latest_one(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $treasurer = $this->officer($org, 'Treasurer');
        FinancialForecast::create(['organization_id' => $org->id, 'forecast_period' => '2026-10', 'predicted_income' => 1000, 'predicted_expense' => 500, 'predicted_balance' => 500, 'safe_spending_limit' => 800, 'generated_by' => $admin->school_id, 'model_details' => ['engine' => 'php-fallback']]);

        $payload = $this->service()->deterministicAnswer($treasurer, 'What is the forecast for next month?', 'ai_tools');

        $this->assertStringContainsString('no forecast for December 2026', $payload['answer']);
        $this->assertStringContainsString('October 2026', $payload['answer']);
    }

    public function test_f3_the_finance_facts_of_a_finance_officer_carry_the_latest_forecasts_and_another_organizations_forecast_stays_out(): void
    {
        $org = $this->org();
        $other = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $otherAdmin = User::factory()->admin()->create(['organization_id' => $other->id]);
        $treasurer = $this->officer($org, 'Treasurer');
        $this->decemberForecast($org, $admin);
        $this->decemberForecast($other, $otherAdmin)->update(['predicted_income' => 77777]);

        $payload = $this->service()->deterministicAnswer($treasurer, 'How is our finance?', 'finance_health');

        $rows = $this->rowText($this->section($payload, 'forecasts-on-file')['rows']);
        $this->assertStringContainsString('₱9,250.00', $rows);
        $this->assertStringNotContainsString('77,777', $this->everything($payload));
    }

    public function test_f3_an_officer_whose_position_does_not_handle_finance_is_not_handed_the_forecast_figures(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $pio = $this->officer($org, 'Public Information Officer');
        $this->decemberForecast($org, $admin);

        $payload = $this->service()->deterministicAnswer($pio, 'What is the forecast for next month?', 'ai_tools');

        $this->assertStringNotContainsString('9,250', $this->everything($payload));
    }

    // -------------------------------------------------------------------------
    // F4: How do I vote?
    // -------------------------------------------------------------------------

    private function activeElection(Organization $org, string $title = 'HIUSA Student Council Election 2024-2025'): Election
    {
        return Election::factory()->create([
            'organization_id' => $org->id,
            'title' => $title,
            'status' => 'active',
            'approved_at' => now()->subDays(5),
            'finalized_at' => now(),
            'start_time' => now()->subDays(2),
            'end_time' => Carbon::parse('2026-12-01 17:00:00', 'Asia/Manila'),
        ]);
    }

    public function test_f4_a_student_asking_how_to_vote_gets_the_open_election_with_its_close_time_and_the_vote_screen(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $this->activeElection($org);

        $this->assertSame('how_to_guide', $this->service()->classifyIntent('How do I vote?', null, 'STUDENT'));
        $payload = $this->service()->deterministicAnswer($student, 'How do I vote?', 'how_to_guide');

        $this->assertStringContainsString('HIUSA Student Council Election 2024-2025', $payload['answer']);
        $this->assertStringContainsString('Dec 1, 2026 5:00 PM', $payload['answer']);
        $this->assertStringContainsString('not voted yet', $payload['answer']);
        $rows = $this->section($payload, 'how-to-readiness')['rows'];
        $this->assertStringContainsString('HIUSA Student Council Election 2024-2025', $this->rowText($rows));
        $this->assertSame('/dashboard/elections/cast-vote', collect($rows)->firstWhere('status', 'You can vote now')['href'] ?? null);
    }

    public function test_f4_a_student_who_already_voted_is_told_so_and_one_with_no_open_election_hears_that_too(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $election = $this->activeElection($org);
        ElectionBallot::factory()->create(['election_id' => $election->id, 'voter_id' => $student->school_id, 'round' => 1]);

        $payload = $this->service()->deterministicAnswer($student, 'How do I vote?', 'how_to_guide');
        $this->assertStringContainsString('already voted', $payload['answer']);

        $election->update(['status' => 'completed', 'end_time' => now()->subDay()]);
        $payload = $this->service()->deterministicAnswer($student, 'How do I vote?', 'how_to_guide');
        $this->assertStringContainsString('no election is open', mb_strtolower($payload['answer']));
    }

    public function test_f4_the_chat_facts_for_a_student_asking_how_to_vote_name_the_election(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $this->activeElection($org);
        Sanctum::actingAs($student);
        $fake = $this->fake(['Open Voting then Vote.']);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'How do I vote?'])->assertOk();

        $facts = json_encode($this->factsOf($fake), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $this->assertStringContainsString('HIUSA Student Council Election 2024-2025', $facts);
        $this->assertStringContainsString('/dashboard/elections/cast-vote', $facts);
    }

    // -------------------------------------------------------------------------
    // F5: the entries the report check counts as having no budget or event
    // -------------------------------------------------------------------------

    public function test_f5_the_unlinked_list_matches_its_count_and_leaves_out_the_expense_that_has_an_event(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $event = Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'academic_semester_id' => $this->semester->id, 'title' => 'Sports Fest 2024', 'status' => 'approved', 'start_time' => '2026-12-08 07:00:00', 'end_time' => '2026-12-08 18:00:00']);
        FinancialReportDeadline::create(['deadline_at' => '2026-12-08 17:00:00', 'set_by' => $admin->school_id]);
        $supplies = $this->entry($org, 'expense', 'Supplies', 3800, '2026-11-10 10:00:00', ['event_id' => $event->id, 'receipt_reference' => null, 'description' => 'Sports Fest banners and tape']);
        $one = $this->entry($org, 'income', 'Sponsorship', 6000, '2026-11-12 10:00:00', ['description' => 'Local sponsor donation']);
        $two = $this->entry($org, 'expense', 'Transport', 700, '2026-11-14 10:00:00', ['description' => 'Jeepney fare for the site visit']);

        $payload = $this->service()->deterministicAnswer($admin, 'What should I do before submitting the financial report?', 'report_preparation');

        $this->assertSame('2', array_column($payload['highlights'], 'value', 'label')['Entries not linked']);
        $rows = $this->section($payload, 'report-prep-unlinked')['rows'];
        $this->assertCount(2, $rows);
        $this->assertEqualsCanonicalizing(['report-prep-unlinked-'.$one->id, 'report-prep-unlinked-'.$two->id], array_column($rows, 'id'));
        $text = $this->rowText($rows);
        $this->assertStringContainsString('Local sponsor donation', $text);
        $this->assertStringContainsString('Jeepney fare for the site visit', $text);
        $this->assertStringNotContainsString('banners', $text);
        $this->assertStringNotContainsString('3,800', $text);

        $step = collect($this->section($payload, 'report-prep-steps')['rows'])->firstWhere('id', 'report-prep-unlinked');
        $this->assertStringContainsString('Local sponsor donation', $step['secondary']);
        $this->assertStringNotContainsString('3,800', $step['secondary']);
        $this->assertNotSame($supplies->id, $one->id);
    }

    public function test_f5_the_list_is_capped_and_says_how_many_more_there_are(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        foreach (range(1, 15) as $i) {
            $this->entry($org, 'expense', 'Misc', 100 + $i, '2026-11-10 10:00:00', ['description' => "Loose entry {$i}"]);
        }

        $payload = $this->service()->deterministicAnswer($admin, 'What should I do before submitting the financial report?', 'report_preparation');

        $section = $this->section($payload, 'report-prep-unlinked');
        $this->assertSame('15', array_column($payload['highlights'], 'value', 'label')['Entries not linked']);
        $this->assertCount(12, $section['rows']);
        $this->assertStringContainsString('12 of 15', $section['description']);
    }
}
