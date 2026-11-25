<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Budget;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

/**
 * r25: the numeric guard used to replace a whole Ask AI answer for one line it could not check. Now that line is left
 * out, the rest of the answer stays, and a short note says so. The whole answer is replaced only when most of it cannot
 * be checked or when it opens on a line that cannot.
 */
class AskAiR25GuardTest extends TestCase
{
    use RefreshDatabase;

    private const ONE = 'One line was left out because its figure could not be checked against your records.';

    private const REPLACED = 'The written answer was replaced with the verified summary.';

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
        RateLimiter::for('ai-generation', fn () => Limit::none());
        $this->travelTo(Carbon::parse('2026-11-25 08:00:00'));

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-06-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-06-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
    }

    private function fake(array $chunks): AskAiChatFakeGenerator
    {
        $fake = new AskAiChatFakeGenerator($chunks, null, 'claude-test');
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    /** The PSITS president of production in small: two budgets and a ledger whose Merchandise lines net to -3,495.00. */
    private function president(): User
    {
        $org = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active', 'is_active' => true]);
        $president = User::factory()->admin()->create(['organization_id' => $org->id, 'first_name' => 'Zacharias', 'last_name' => 'Quillfeather']);
        $general = Budget::create(['organization_id' => $org->id, 'title' => 'General Operations Fund', 'allocated_amount' => 50000, 'remaining_amount' => 36500, 'warning_threshold' => 5000, 'submission_status' => 'approved']);
        $merch = Budget::create(['organization_id' => $org->id, 'title' => 'Merchandise Fund', 'allocated_amount' => 30000, 'remaining_amount' => 26250, 'warning_threshold' => 5000, 'submission_status' => 'approved']);
        Transaction::factory()->create(['organization_id' => $org->id, 'budget_id' => $general->id, 'type' => 'expense', 'category' => 'Operations', 'amount' => 13500, 'transaction_date' => '2026-11-24']);
        Transaction::factory()->create(['organization_id' => $org->id, 'budget_id' => null, 'type' => 'income', 'category' => 'Merchandise', 'amount' => 255, 'transaction_date' => '2026-10-02']);
        Transaction::factory()->create(['organization_id' => $org->id, 'budget_id' => $merch->id, 'type' => 'expense', 'category' => 'Merchandise', 'amount' => 12500, 'transaction_date' => '2026-10-05']);
        Transaction::factory()->create(['organization_id' => $org->id, 'budget_id' => $merch->id, 'type' => 'income', 'category' => 'Merchandise Sales', 'amount' => 8750, 'transaction_date' => '2026-10-09']);
        Sanctum::actingAs($president);

        return $president;
    }

    private function stream(string $message = 'How is our finance?'): array
    {
        $response = $this->postJson('/api/ai/assistant/chat', ['message' => $message], ['Accept' => 'text/event-stream'])->assertOk();
        $events = [];
        foreach (preg_split("/\n\n/", trim($response->streamedContent())) as $block) {
            if (str_starts_with($block, 'event: ')) {
                [$name, $data] = explode("\ndata: ", substr($block, 7), 2);
                $events[] = ['event' => $name, 'data' => json_decode($data, true)];
            }
        }

        return $events;
    }

    private function streamed(array $events): string
    {
        return implode('', array_map(fn ($e) => $e['data']['text'] ?? '', array_filter($events, fn ($e) => $e['event'] === 'delta')));
    }

    private function done(array $events): array
    {
        return $events[array_key_last($events)]['data']['message'];
    }

    public function test_a_line_with_an_invented_figure_is_left_out_and_the_rest_of_the_answer_stays(): void
    {
        $this->president();
        $this->fake(["Your finance is steady.\n", "Exactly 98,765.00 is owed in dues.\n", "General Operations Fund has ₱36,500.00 left.\n", 'Merchandise Fund has ₱26,250.00 left.']);

        $events = $this->stream();

        $this->assertNotContains('replace', array_column($events, 'event'));
        $done = $this->done($events);
        $this->assertSame("Your finance is steady.\nGeneral Operations Fund has ₱36,500.00 left.\nMerchandise Fund has ₱26,250.00 left.", $done['content']);
        $this->assertSame($done['content'], $this->streamed($events));
        $this->assertStringNotContainsString('98,765', $done['content']);
        $this->assertSame('claude', $done['payload']['engine']);
        $this->assertTrue($done['payload']['model_written']);
        $this->assertSame(self::ONE, $done['payload']['notice']);
    }

    public function test_a_wrong_sign_on_a_figure_the_records_carry_is_left_out(): void
    {
        $this->president();
        $this->fake(["Your finance is steady.\n", "The ledger net is -2,705.00 overall.\n", 'General Operations Fund has ₱36,500.00 left.']);

        $done = $this->done($this->stream());

        $this->assertStringNotContainsString('-2,705', $done['content']);
        $this->assertStringContainsString('General Operations Fund has ₱36,500.00 left.', $done['content']);
        $this->assertSame(self::ONE, $done['payload']['notice']);
    }

    public function test_a_correct_derived_sum_is_kept_with_no_note(): void
    {
        $this->president();
        $text = "Your finance is steady.\nBetween the two funds you hold ₱62,750.00 (₱36,500.00 plus ₱26,250.00).\nGeneral Operations Fund has ₱36,500.00 left.";
        $this->fake([$text]);

        $done = $this->done($this->stream());

        $this->assertStringContainsString('₱62,750.00', $done['content']);
        $this->assertNull($done['payload']['notice']);
    }

    public function test_q01_the_merchandise_net_of_minus_3495_is_a_checked_figure_and_the_answer_is_untouched(): void
    {
        $this->president();
        $text = "Your finance is steady overall.\nMerchandise is the one soft spot: its income (₱255.00 and ₱8,750.00) against ₱12,500.00 spent nets to -3,495.00.\nGeneral Operations Fund has ₱36,500.00 left.";
        $fake = $this->fake([$text]);

        $events = $this->stream();

        // The figures the writer was given must be the ones that make -3,495.00, or this test proves nothing.
        $turn = $fake->lastUserTurn();
        $this->assertStringContainsString('Income: ₱255.00 · Expenses: ₱12,500.00', $turn);
        $this->assertStringContainsString('Income: ₱8,750.00 · Expenses: ₱0.00', $turn);
        $done = $this->done($events);
        $this->assertSame($text, $done['content']);
        $this->assertNull($done['payload']['notice']);
        $this->assertSame('claude', $done['payload']['engine']);
    }

    public function test_q01_a_near_miss_on_the_same_net_is_left_out(): void
    {
        $this->president();
        $this->fake(["Your finance is steady overall.\n", "Merchandise nets to -3,500.00 once income and spending are set side by side.\n", 'General Operations Fund has ₱36,500.00 left.']);

        $done = $this->done($this->stream());

        $this->assertStringNotContainsString('3,500', $done['content']);
        $this->assertSame(self::ONE, $done['payload']['notice']);
    }

    public function test_the_whole_answer_is_replaced_when_the_first_line_cannot_be_checked(): void
    {
        $this->president();
        $this->fake(["Exactly 98,765.00 is owed in dues.\n", "Your finance is steady.\n", 'General Operations Fund has ₱36,500.00 left.']);

        $events = $this->stream();

        $this->assertContains('replace', array_column($events, 'event'));
        $done = $this->done($events);
        $this->assertSame(self::REPLACED, $done['payload']['notice']);
        $this->assertSame('records', $done['payload']['engine']);
        $this->assertStringNotContainsString('98,765', $done['content']);
        $this->assertStringNotContainsString('98,765', $this->streamed($events));
    }

    public function test_the_whole_answer_is_replaced_when_more_than_half_of_the_lines_are_left_out(): void
    {
        $this->president();
        $this->fake(["Your finance is steady.\n", "Exactly 98,765.00 is owed in dues.\n", "Another 87,654.00 is overdue.\n", "A third 76,543.00 is pending.\n", 'General Operations Fund has ₱36,500.00 left.']);

        $done = $this->done($this->stream());

        $this->assertSame(self::REPLACED, $done['payload']['notice']);
        $this->assertSame('records', $done['payload']['engine']);
        $this->assertStringNotContainsString('98,765', $done['content']);
        $this->assertStringNotContainsString('87,654', $done['content']);
    }

    public function test_exactly_half_of_the_lines_left_out_keeps_the_answer_and_two_lines_use_the_plural_note(): void
    {
        $this->president();
        $this->fake(["Your finance is steady.\n", "Exactly 98,765.00 is owed in dues.\n", "General Operations Fund has ₱36,500.00 left.\n", 'Another 87,654.00 is overdue.']);

        $done = $this->done($this->stream());

        $this->assertSame('2 lines were left out because their figures could not be checked against your records.', $done['payload']['notice']);
        $this->assertSame('claude', $done['payload']['engine']);
        $this->assertSame("Your finance is steady.\nGeneral Operations Fund has ₱36,500.00 left.", $done['content']);
    }

    public function test_a_last_line_with_no_newline_after_it_is_left_out_too(): void
    {
        $this->president();
        $this->fake(["Your finance is steady.\nGeneral Operations Fund has ₱36,500.00 left.\nMerchandise Fund has ₱26,250.00 left.\n", 'Exactly 98,765.00 is owed in dues.']);

        $done = $this->done($this->stream());

        $this->assertSame("Your finance is steady.\nGeneral Operations Fund has ₱36,500.00 left.\nMerchandise Fund has ₱26,250.00 left.", $done['content']);
        $this->assertSame(self::ONE, $done['payload']['notice']);
    }

    public function test_every_left_out_line_is_logged_with_the_figure_the_line_the_fact_keys_and_no_names(): void
    {
        $this->president();
        $this->fake(["Your finance is steady.\n", 'Zacharias Quillfeather owes '.str_repeat('and so on, ', 30)."98,765.00 in dues.\n", "Exactly 87,654.00 is overdue.\n", "General Operations Fund has ₱36,500.00 left.\n", "Merchandise Fund has ₱26,250.00 left.\n", 'Nothing else needs you.']);
        Log::spy();

        $this->stream();

        Log::shouldHaveReceived('warning')->withArgs(function (string $message, array $context = []): bool {
            return str_contains($message, 'left out')
                && ($context['figure'] ?? null) === '87,654.00'
                && str_contains($context['line'], 'Exactly 87,654.00 is overdue.')
                && in_array('highlights', $context['fact_keys'], true)
                && in_array('records', $context['fact_keys'], true)
                && ! in_array('memories', $context['fact_keys'], true);
        })->once();
        Log::shouldHaveReceived('warning')->withArgs(function (string $message, array $context = []): bool {
            return str_contains($message, 'left out')
                && ($context['figure'] ?? null) === '98,765.00'
                && mb_strlen($context['line']) <= 200
                && ! str_contains($context['line'], 'Zacharias')
                && ! str_contains($context['line'], 'Quillfeather')
                && ! array_key_exists('prompt', $context)
                && ! array_key_exists('facts', $context);
        })->once();
    }

    public function test_a_two_word_last_name_is_masked_in_the_logged_line(): void
    {
        $this->president();
        User::factory()->create(['first_name' => 'Mary Ann', 'last_name' => 'De Leon']);
        $this->fake(["Your finance is steady.\n", "Ms. De Leon still owes 98,765.00 in dues.\n", "General Operations Fund has ₱36,500.00 left.\n", "Merchandise Fund has ₱26,250.00 left.\n", 'Nothing else needs you.']);
        Log::spy();

        $this->stream();

        Log::shouldHaveReceived('warning')->withArgs(function (string $message, array $context = []): bool {
            return str_contains($message, 'left out')
                && ($context['figure'] ?? null) === '98,765.00'
                && str_contains($context['line'], 'still owes 98,765.00')
                && ! str_contains($context['line'], 'De Leon')
                && ! str_contains($context['line'], 'Leon');
        })->once();
    }

    public function test_the_guard_tells_which_figure_failed(): void
    {
        $guard = new AskAiChatFakeGenerator;

        $this->assertSame('98,765.00', $guard->unverifiedFigure('Owed: 98,765.00 and 12 members.', ['members' => 12]));
        $this->assertNull($guard->unverifiedFigure('12 members.', ['members' => 12]));
        $this->assertSame('-2,705.00', $guard->unverifiedFigure('Net -2,705.00.', ['net' => 2705.0]));
    }

    public function test_a_net_over_rows_that_share_a_word_is_a_derived_figure_and_a_wrong_figure_is_not(): void
    {
        $guard = new AskAiChatFakeGenerator;
        $facts = ['sections' => [['title' => 'Ledger by Category', 'rows' => [
            ['primary' => 'Merchandise', 'secondary' => 'Income: ₱255.00 · Expenses: ₱12,500.00'],
            ['primary' => 'Merchandise Sales', 'secondary' => 'Income: ₱8,750.00 · Expenses: ₱0.00'],
            ['primary' => 'Venue', 'secondary' => 'Income: ₱0.00 · Expenses: ₱5,000.00'],
        ]]]];

        $this->assertTrue($guard->preservesNumericFacts('Merchandise nets -3,495.00.', $facts, true));
        $this->assertTrue($guard->preservesNumericFacts('Merchandise is short by 3,495.00.', $facts, true));
        $this->assertFalse($guard->preservesNumericFacts('Merchandise nets -3,500.00.', $facts, true));
        $this->assertFalse($guard->preservesNumericFacts('Merchandise nets -3,495.00.', $facts, false));
        // A net that is positive in the records is refused with a minus sign.
        $this->assertFalse($guard->preservesNumericFacts('Merchandise Sales nets -8,750.00.', $facts, true));
        // Without the Merchandise Sales row the same figure is nothing the records carry.
        $without = $facts;
        unset($without['sections'][0]['rows'][1]);
        $this->assertFalse($guard->preservesNumericFacts('Merchandise nets -3,495.00.', $without, true));
        // Rows with no word in common are not netted together.
        $unrelated = $facts;
        $unrelated['sections'][0]['rows'][1]['primary'] = 'Sponsorship';
        $this->assertFalse($guard->preservesNumericFacts('Together that is -3,495.00.', $unrelated, true));
    }

    public function test_the_net_search_stays_fast_on_a_long_ledger_and_on_hostile_row_text(): void
    {
        $guard = new AskAiChatFakeGenerator;

        // The largest legitimate list: 200 category rows sharing one word, each with an income and an expense.
        $rows = [];
        for ($i = 0; $i < 200; $i++) {
            $rows[] = ['primary' => 'Merchandise line '.$i, 'secondary' => 'Income: ₱'.number_format(100 + $i, 2).' · Expenses: ₱'.number_format(1000 + $i * 7, 2)];
        }
        $started = microtime(true);
        $this->assertTrue($guard->preservesNumericFacts('The lines net to -900.00.', ['sections' => [['rows' => $rows]]], true));
        $this->assertLessThan(1.0, microtime(true) - $started);

        // Row text built to make an unbounded amount pattern backtrack.
        $hostile = [['primary' => 'x', 'secondary' => str_repeat('Income: ', 4000).str_repeat('1,111', 20000).' Spent: '.str_repeat('9', 50000)]];
        $started = microtime(true);
        $guard->preservesNumericFacts('Net -3,495.00.', ['sections' => [['rows' => $hostile]]], true);
        $this->assertLessThan(1.0, microtime(true) - $started);
    }
}
