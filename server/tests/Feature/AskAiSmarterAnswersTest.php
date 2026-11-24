<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Budget;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\AiInstructions;
use App\Services\Ai\AskAiService;
use App\Services\Ai\Concerns\GuardsGeneratedText;
use App\Services\Ai\HowToGuideLibrary;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\Support\ScriptedTextGenerator;
use Tests\TestCase;

/**
 * r22 smarter answers: the finance facts count ledger entries that are not linked to a budget (the "0.00" answer),
 * the numeric guard accepts a figure the writer worked out from the facts and still rejects one it made up, and the
 * Ask AI brief names the role, the position, the answer-first shape and the real screens.
 */
class AskAiSmarterAnswersTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
        RateLimiter::for('ai-generation', fn () => Limit::none());
    }

    private function guard(): object
    {
        return new class
        {
            use GuardsGeneratedText;
        };
    }

    private function org(): Organization
    {
        return Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active', 'is_active' => true]);
    }

    private function admin(Organization $org): User
    {
        return User::factory()->admin()->create(['organization_id' => $org->id]);
    }

    private function fake(array $chunks = []): AskAiChatFakeGenerator
    {
        $fake = new AskAiChatFakeGenerator($chunks, null, 'claude-test');
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    /** A ledger entry that belongs to the organization and to no budget, the way a manual entry or a collection lands. */
    private function unlinked(Organization $org, string $type, float $amount, string $category, string $date = 'now'): Transaction
    {
        return Transaction::factory()->create([
            'budget_id' => null,
            'organization_id' => $org->id,
            'type' => $type,
            'amount' => $amount,
            'category' => $category,
            'transaction_date' => $date,
        ]);
    }

    private function factsOf(AskAiChatFakeGenerator $fake): array
    {
        $turn = $fake->lastUserTurn();

        return json_decode(substr($turn, strpos($turn, '```json') + 8, strrpos($turn, '```') - strpos($turn, '```json') - 8), true);
    }

    // -------------------------------------------------------------------------
    // The numeric guard
    // -------------------------------------------------------------------------

    public function test_a_sum_a_difference_and_a_percentage_of_fact_figures_pass_when_derived_figures_are_allowed(): void
    {
        $facts = ['income' => 15000.00, 'expense' => 4250.50, 'allocated' => 10000, 'spent' => 4500, 'fees' => 1200.25];

        $this->assertTrue($this->guard()->preservesNumericFacts('Net is PHP 10,749.50.', $facts, true));
        $this->assertTrue($this->guard()->preservesNumericFacts('Income and fees together are PHP 16,200.25.', $facts, true));
        $this->assertTrue($this->guard()->preservesNumericFacts('Income less expense and fees leaves PHP 9,549.25.', $facts, true));
        $this->assertTrue($this->guard()->preservesNumericFacts('You have used 45% of the budget.', $facts, true));
        $this->assertTrue($this->guard()->preservesNumericFacts('That leaves 55% unspent.', $facts, true));
        $this->assertTrue($this->guard()->preservesNumericFacts('Spending is 28.34% of income.', $facts, true));
    }

    public function test_the_same_derived_figures_are_still_refused_when_derived_figures_are_not_allowed(): void
    {
        $facts = ['income' => 15000.00, 'expense' => 4250.50, 'allocated' => 10000, 'spent' => 4500];

        $this->assertFalse($this->guard()->preservesNumericFacts('Net is PHP 10,749.50.', $facts));
        $this->assertFalse($this->guard()->preservesNumericFacts('You have used 45% of the budget.', $facts, false));
        $this->assertTrue($this->guard()->preservesNumericFacts('Income is PHP 15,000.00.', $facts));
    }

    public function test_an_invented_figure_is_still_caught_when_derived_figures_are_allowed(): void
    {
        $facts = ['income' => 15000.00, 'expense' => 4250.50, 'allocated' => 10000, 'spent' => 4500];

        $this->assertFalse($this->guard()->preservesNumericFacts('Net is PHP 7,777.77.', $facts, true));
        $this->assertFalse($this->guard()->preservesNumericFacts('Net is PHP 10,749.51.', $facts, true));
        $this->assertFalse($this->guard()->preservesNumericFacts('You have used 71% of the budget.', $facts, true));
        $this->assertFalse($this->guard()->preservesNumericFacts('Income is PHP 15,000.00 and the fund holds PHP 50,000.00.', $facts, true));
    }

    public function test_a_small_whole_number_is_never_accepted_as_a_sum_so_a_count_cannot_be_worked_out(): void
    {
        $facts = ['pending' => 2, 'overdue' => 3, 'amount' => 1200];

        $this->assertFalse($this->guard()->preservesNumericFacts('You have 5 open tasks.', $facts, true));
        $this->assertTrue($this->guard()->preservesNumericFacts('You have 3 overdue tasks.', $facts, true));
    }

    public function test_the_derived_search_stays_fast_on_the_largest_facts_and_on_a_figure_that_matches_nothing(): void
    {
        $facts = ['rows' => array_map(fn (int $i) => ['amount' => 1000 + $i * 7.31, 'count' => $i], range(1, 400))];

        $started = microtime(true);
        $this->assertFalse($this->guard()->preservesNumericFacts('Total PHP 123,456,789.01 and 999999.99% done.', $facts, true));
        $this->assertTrue($this->guard()->preservesNumericFacts('Two rows together are PHP 2,021.93.', $facts, true));
        $this->assertLessThan(1.5, microtime(true) - $started);
    }

    // -------------------------------------------------------------------------
    // Finance facts: ledger entries not linked to a budget
    // -------------------------------------------------------------------------

    public function test_a_finance_answer_counts_ledger_entries_that_are_not_linked_to_a_budget(): void
    {
        $org = $this->org();
        $admin = $this->admin($org);
        $this->unlinked($org, 'income', 15000, 'membership');
        $this->unlinked($org, 'income', 2500, 'sponsorship');
        $this->unlinked($org, 'expense', 4250.50, 'materials');
        $this->unlinked($this->org(), 'income', 99999, 'membership');

        $service = $this->app->make(AskAiService::class);
        $payload = $service->deterministicAnswer($admin, 'How is our finance?', 'finance_health');

        $this->assertStringContainsString('₱17,500.00 income', $payload['answer']);
        $this->assertStringContainsString('₱4,250.50 expenses', $payload['answer']);
        $this->assertStringContainsString('₱13,249.50', $payload['answer']);
        $this->assertStringContainsString('not linked to a budget', $payload['answer']);
        $this->assertStringNotContainsString('99,999', json_encode($payload));

        $labels = array_column($payload['highlights'], 'value', 'label');
        $this->assertSame('₱17,500.00', $labels['Ledger income']);
        $this->assertSame('₱4,250.50', $labels['Ledger expenses']);
        $this->assertSame('₱13,249.50', $labels['Ledger net']);

        $section = collect($payload['sections'])->firstWhere('id', 'ledger-by-category');
        $this->assertNotNull($section);
        $materials = collect($section['rows'])->first(fn (array $row) => str_starts_with($row['primary'], 'Materials'));
        $this->assertSame('Income: ₱0.00 · Expenses: ₱4,250.50', $materials['secondary']);
        $this->assertSame('/dashboard/finance/financial-ledger', $materials['href']);
    }

    public function test_entries_linked_to_a_budget_and_entries_that_are_not_both_count_and_the_split_is_stated(): void
    {
        $org = $this->org();
        $admin = $this->admin($org);
        $budget = Budget::create(['organization_id' => $org->id, 'title' => 'General Fund', 'allocated_amount' => 20000, 'remaining_amount' => 18000, 'warning_threshold' => 100, 'submission_status' => 'approved']);
        Transaction::factory()->create(['budget_id' => $budget->id, 'organization_id' => $org->id, 'type' => 'expense', 'amount' => 2000, 'transaction_date' => 'now']);
        $this->unlinked($org, 'income', 5000, 'membership');
        $this->unlinked($org, 'expense', 750, 'materials');

        $payload = $this->app->make(AskAiService::class)->deterministicAnswer($admin, 'How is our finance?', 'finance_health');

        $this->assertStringContainsString('₱5,000.00 income and ₱2,750.00 expenses', $payload['answer']);
        $this->assertStringContainsString('₱5,000.00 income and ₱750.00 expenses are not linked to a budget', $payload['answer']);
        $this->assertStringStartsWith('Your organization\'s approved budgets total ₱20,000.00 allocated with ₱18,000.00 remaining', $payload['answer']);
    }

    public function test_only_the_current_semester_counts(): void
    {
        $org = $this->org();
        $admin = $this->admin($org);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $this->unlinked($org, 'income', 3000, 'membership', '2026-10-05 09:00:00');
        $this->unlinked($org, 'income', 8000, 'membership', '2026-03-05 09:00:00');

        $payload = $this->app->make(AskAiService::class)->deterministicAnswer($admin, 'How is our finance?', 'finance_health');

        $figures = json_encode([$payload['answer'], $payload['highlights'], $payload['sections']]);
        $this->assertStringContainsString('₱3,000.00 income', $payload['answer']);
        $this->assertStringNotContainsString('8,000', $figures);
        $this->assertStringNotContainsString('11,000', $figures);
    }

    public function test_archived_ledger_entries_are_left_out_when_the_table_has_an_archived_at_column(): void
    {
        Schema::table('transactions', fn ($table) => $table->timestamp('archived_at')->nullable());
        $org = $this->org();
        $admin = $this->admin($org);
        $this->unlinked($org, 'income', 3000, 'membership');
        $archived = $this->unlinked($org, 'income', 7000, 'membership');
        Transaction::whereKey($archived->id)->update(['archived_at' => now()]);

        $payload = $this->app->make(AskAiService::class)->deterministicAnswer($admin, 'How is our finance?', 'finance_health');

        $this->assertStringContainsString('₱3,000.00 income', $payload['answer']);
        $this->assertStringNotContainsString('7,000', json_encode($payload));
        $this->assertStringNotContainsString('10,000', json_encode($payload));
    }

    public function test_an_organization_with_no_ledger_entries_gets_no_ledger_sentence(): void
    {
        $org = $this->org();
        $payload = $this->app->make(AskAiService::class)->deterministicAnswer($this->admin($org), 'How is our finance?', 'finance_health');

        $this->assertStringNotContainsString('ledger', strtolower($payload['answer']));
        $this->assertSame([], array_values(array_filter($payload['highlights'], fn (array $h) => str_starts_with($h['label'], 'Ledger'))));
    }

    public function test_the_chat_keeps_a_correct_finance_answer_that_the_old_facts_replaced_with_zero(): void
    {
        $org = $this->org();
        Sanctum::actingAs($this->admin($org));
        $this->unlinked($org, 'income', 15000, 'membership');
        $this->unlinked($org, 'expense', 4250.50, 'materials');
        $text = 'The ledger shows PHP 15,000.00 income and PHP 4,250.50 expenses, so PHP 10,749.50 net.';
        $fake = $this->fake([$text]);

        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'How is our finance?'])->assertOk();

        $response->assertJsonPath('message.payload.engine', 'claude');
        $this->assertSame($text, $response->json('message.content'));
        $this->assertSame('₱15,000.00', array_column($this->factsOf($fake)['highlights'], 'value', 'label')['Ledger income']);
    }

    private function twoExpenseLedger(): void
    {
        $org = $this->org();
        Sanctum::actingAs($this->admin($org));
        $this->unlinked($org, 'income', 15000, 'membership');
        $this->unlinked($org, 'expense', 4250.50, 'materials');
        $this->unlinked($org, 'expense', 1000, 'venue');
    }

    public function test_the_chat_keeps_an_answer_whose_figures_are_sums_of_the_facts(): void
    {
        $this->twoExpenseLedger();
        $derived = 'After materials and venue together, PHP 5,250.50, you keep PHP 9,749.50 of the PHP 15,000.00 income.';
        $this->fake([$derived]);

        $kept = $this->postJson('/api/ai/assistant/chat', ['message' => 'How is our finance?'])->assertOk();

        $kept->assertJsonPath('message.payload.engine', 'claude');
        $this->assertSame($derived, $kept->json('message.content'));
    }

    public function test_the_chat_replaces_an_answer_with_a_figure_that_is_not_in_the_facts_or_derivable_from_them(): void
    {
        $this->twoExpenseLedger();
        $this->fake(['You keep PHP 9,999.99 of the PHP 15,000.00 income.']);

        $replaced = $this->postJson('/api/ai/assistant/chat', ['message' => 'How is our finance?'])->assertOk();

        $this->assertStringNotContainsString('9,999.99', $replaced->json('message.content'));
        $this->assertNotSame('claude', $replaced->json('message.payload.engine'));
    }

    // -------------------------------------------------------------------------
    // The brief: role, position, answer first, real screens
    // -------------------------------------------------------------------------

    public function test_the_chat_brief_leads_with_the_answer_then_figures_then_next_steps_that_name_a_real_screen(): void
    {
        $text = AiInstructions::askAiChat();

        $this->assertStringContainsString('The first one or two sentences answer the question', $text);
        $this->assertStringContainsString('what each figure means for this person', $text);
        $this->assertStringContainsString('one to three next steps', $text);
        $this->assertStringContainsString('screens', $text);
        $this->assertStringContainsString('say plainly', $text);
        $this->assertStringContainsString('how to add it', $text);
        $this->assertStringNotContainsString('Never calculate a new number', $text);
        $this->assertStringContainsString('add or subtract', $text);
    }

    public function test_the_chat_brief_tells_the_model_how_each_role_and_position_reads_the_same_records(): void
    {
        $text = AiInstructions::askAiChat();

        foreach (['Treasurer', 'Auditor', 'President', 'Secretary', 'Department Head', 'Dean', 'SAO', 'Student'] as $seat) {
            $this->assertStringContainsString($seat, $text);
        }
        $this->assertStringContainsString('position', $text);
        $this->assertStringContainsString('has no position title', $text);
    }

    public function test_the_briefs_hold_no_dash_pressure_wording_or_prompts_for_older_models(): void
    {
        foreach (['askAi', 'askAiChat', 'budgetAdvice', 'forecastSummary', 'financialReportSummary', 'reportCheck', 'semesterNarrative', 'handoverNote', 'announcementDraft', 'eventPlan'] as $method) {
            $text = AiInstructions::$method();
            $this->assertStringNotContainsString("\u{2014}", $text, $method);
            $this->assertStringNotContainsString("\u{2013}", $text, $method);
            $this->assertDoesNotMatchRegularExpression('/\b(CRITICAL|IMPORTANT|MUST|ALWAYS)\b/', $text, $method);
            $this->assertDoesNotMatchRegularExpression('/think step by step|take a deep breath|do not be lazy/i', $text, $method);
        }
    }

    public function test_the_one_shot_advice_briefs_say_who_reads_them_and_which_screen_to_open(): void
    {
        $this->assertStringContainsString('Finance → Budgets', AiInstructions::budgetAdvice());
        $this->assertStringContainsString('Finance → Forecast', AiInstructions::forecastSummary());
        $this->assertStringContainsString('Finance → Financial reports', AiInstructions::reportCheck());
        foreach (['budgetAdvice', 'forecastSummary', 'reportCheck'] as $method) {
            $this->assertMatchesRegularExpression('/Treasurer|Admin|officer/', AiInstructions::$method(), $method);
        }
    }

    public function test_the_one_shot_answer_is_given_the_position_as_well_as_the_role(): void
    {
        $org = $this->org();
        Sanctum::actingAs(User::factory()->officer()->create(['organization_id' => $org->id, 'position_title' => 'Treasurer']));
        $fake = new ScriptedTextGenerator('Your budgets are on track.');
        $this->app->instance(TextGenerator::class, $fake);

        $this->postJson('/api/ai/assistant/ask', ['message' => 'How is our finance?', 'question' => 'How is our finance?'])->assertOk();

        $this->assertNotEmpty($fake->calls);
        $sent = json_decode($fake->calls[0]['input'], true);
        $this->assertSame('SBO_OFFICER', $sent['role']);
        $this->assertSame('Treasurer', $sent['position']);
    }

    public function test_the_facts_carry_the_screens_the_asking_role_may_open_with_their_sidebar_names(): void
    {
        $org = $this->org();
        Sanctum::actingAs($this->admin($org));
        $fake = $this->fake(['Open the ledger.']);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'How is our finance?'])->assertOk();

        $screens = collect($this->factsOf($fake)['screens']);
        $ledger = $screens->firstWhere('href', '/dashboard/finance/financial-ledger');
        $this->assertSame('Finance → Ledger', $ledger['screen']);
        $this->assertNotEmpty($ledger['use_it_to']);
        $this->assertNull($screens->firstWhere('href', '/dashboard/super-admin/colleges'));
    }

    public function test_a_student_is_never_shown_an_officer_screen(): void
    {
        $org = $this->org();
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $org->id]));
        $fake = $this->fake(['Open your statement.']);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'What fees do I owe?'])->assertOk();

        $hrefs = collect($this->factsOf($fake)['screens'])->pluck('href');
        $this->assertTrue($hrefs->contains('/dashboard/finance/statement-of-account'));
        $this->assertFalse($hrefs->contains('/dashboard/finance/budget-allocation'));
        $this->assertFalse($hrefs->contains('/dashboard/finance/financial-ledger'));
    }

    public function test_every_screen_in_the_directory_is_a_route_some_role_may_open(): void
    {
        $library = app(HowToGuideLibrary::class);
        $open = collect(['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER', 'STUDENT'])
            ->flatMap(fn (string $role) => config("client_routes.{$role}"))
            ->unique();

        foreach (HowToGuideLibrary::SCREENS as $path => $screen) {
            $this->assertTrue($open->contains($path), "{$path} is not in any role's allowlist");
            $this->assertNotSame('', $screen[0], $path);
        }
        $this->assertNotEmpty($library->screensFor('ADMIN'));
    }

    public function test_every_screen_title_matches_the_page_title_the_client_shows(): void
    {
        $meta = file_get_contents(base_path('../client/src/lib/pageMeta.js'));
        $this->assertNotFalse($meta);

        foreach (HowToGuideLibrary::SCREENS as $path => $screen) {
            $pattern = '~\''.preg_quote($path, '~').'\':\s*\{\s*title: \'((?:[^\'\\\\]|\\\\.)+)\'~';
            $this->assertSame(1, preg_match($pattern, $meta, $found), "{$path} has no title in pageMeta.js");
            $this->assertSame(stripslashes($found[1]), $screen[1], $path);
        }
    }
}
