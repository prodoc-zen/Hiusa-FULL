<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\AskAiService;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

/**
 * r27: the one Ask AI line the numeric guard still left out in production after r25 was "across 6 expense entries" on a
 * question about this month's spending. The count was never a fact, so the writer added the category rows up and the
 * guard, which never works out a count, refused it. The month sentence now states how many entries each total is made of.
 */
class AskAiR27GuardTest extends TestCase
{
    use RefreshDatabase;

    private const ONE = 'One line was left out because its figure could not be checked against your records.';

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
        RateLimiter::for('ai-generation', fn () => Limit::none());
        $this->travelTo(Carbon::parse('2026-11-25 08:00:00', 'Asia/Manila'));

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-06-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-06-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
    }

    private function fake(array $chunks): AskAiChatFakeGenerator
    {
        $fake = new AskAiChatFakeGenerator($chunks, null, 'claude-test');
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    private function entry(Organization $org, string $type, string $category, float $amount, string $date): void
    {
        Transaction::factory()->create([
            'organization_id' => $org->id,
            'budget_id' => null,
            'event_id' => null,
            'type' => $type,
            'category' => $category,
            'amount' => $amount,
            'transaction_date' => $date,
            'receipt_reference' => 'OR-'.fake()->unique()->numerify('#####'),
        ]);
    }

    /** November holds 4 expense entries (15,500.00) and 1 income entry (9,000.00); October holds one of each. */
    private function treasurer(): User
    {
        $org = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active', 'is_active' => true]);
        foreach ([['Venue', 5000], ['Food', 4500], ['Printing', 2200], ['Supplies', 3800]] as [$category, $amount]) {
            $this->entry($org, 'expense', $category, $amount, '2026-11-12 10:00:00');
        }
        $this->entry($org, 'income', 'Sponsorship', 9000, '2026-11-05 10:00:00');
        $this->entry($org, 'expense', 'Venue', 6100, '2026-10-20 10:00:00');
        $this->entry($org, 'income', 'Membership', 3000, '2026-10-02 10:00:00');

        $user = User::factory()->admin()->create(['organization_id' => $org->id]);
        Sanctum::actingAs($user);

        return $user;
    }

    private function stream(): array
    {
        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'How much did we spend this month?'], ['Accept' => 'text/event-stream'])->assertOk();
        $events = [];
        foreach (preg_split("/\n\n/", trim($response->streamedContent())) as $block) {
            if (str_starts_with($block, 'event: ')) {
                [$name, $data] = explode("\ndata: ", substr($block, 7), 2);
                $events[] = ['event' => $name, 'data' => json_decode($data, true)];
            }
        }

        return $events;
    }

    private function done(array $events): array
    {
        return $events[array_key_last($events)]['data']['message'];
    }

    public function test_the_month_sentence_says_how_many_entries_each_total_is_made_of(): void
    {
        $user = $this->treasurer();

        $answer = $this->app->make(AskAiService::class)->deterministicAnswer($user, 'How much did we spend this month?', 'finance_health')['answer'];

        $this->assertStringContainsString('This month (November 2026) the ledger shows ₱9,000.00 income (1 entry) and ₱15,500.00 expenses (4 entries)', $answer);
        $this->assertStringContainsString('last month (October 2026), ₱3,000.00 income (1 entry) and ₱6,100.00 expenses (1 entry)', $answer);
    }

    public function test_a_month_with_no_income_entry_says_zero_entries_rather_than_dropping_the_count(): void
    {
        $org = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active', 'is_active' => true]);
        $this->entry($org, 'expense', 'Venue', 900, '2026-11-12 10:00:00');
        $user = User::factory()->admin()->create(['organization_id' => $org->id]);

        $answer = $this->app->make(AskAiService::class)->deterministicAnswer($user, 'How much did we spend this month?', 'finance_health')['answer'];

        $this->assertStringContainsString('₱0.00 income (0 entries) and ₱900.00 expenses (1 entry)', $answer);
    }

    public function test_a_line_that_counts_the_expense_entries_of_the_month_is_kept(): void
    {
        $this->treasurer();
        $text = "Your spending this month is under control.\nYou spent ₱15,500.00 across 4 expense entries.\nVenue alone took ₱5,000.00.";
        $this->fake([$text]);

        $done = $this->done($this->stream());

        $this->assertSame($text, $done['content']);
        $this->assertNull($done['payload']['notice']);
        $this->assertSame('claude', $done['payload']['engine']);
    }

    public function test_a_count_the_records_do_not_carry_is_still_left_out(): void
    {
        $this->treasurer();
        $this->fake(["Your spending this month is under control.\n", "You spent ₱15,500.00 across 9 expense entries.\n", 'Venue alone took ₱5,000.00.']);

        $done = $this->done($this->stream());

        $this->assertStringNotContainsString('9 expense entries', $done['content']);
        $this->assertStringContainsString('Venue alone took ₱5,000.00.', $done['content']);
        $this->assertSame(self::ONE, $done['payload']['notice']);
    }
}
