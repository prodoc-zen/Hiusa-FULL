<?php

namespace Tests\Feature;

use App\Services\Ai\ReportCheckExplainer;
use App\Services\Finance\FinancialReportChecks;
use Tests\Support\ReportCheckFakeGenerator;
use Tests\TestCase;

/** The prose of the report check: what the model may do with the findings, and what happens when it does more. */
class ReportCheckExplainerTest extends TestCase
{
    /** @return list<array<string, mixed>> */
    private function findings(): array
    {
        return [
            ['code' => 'budget_overspent', 'severity' => 'high', 'refs' => [3], 'amount' => 200.5, 'facts' => ['budget' => 'Foundation Day budget', 'allocated' => 1000.0, 'income' => 0.0, 'expense' => 1200.5, 'remaining' => -200.5, 'over_by' => 200.5]],
            ['code' => 'missing_receipt', 'severity' => 'medium', 'refs' => [11], 'amount' => 1200.5, 'facts' => ['type' => 'expense', 'category' => 'Supplies', 'date' => '2026-09-02', 'amount' => 1200.5]],
        ];
    }

    private function explain(?callable $answer, ?array $findings = null): array
    {
        $generator = new ReportCheckFakeGenerator($answer);
        $explained = (new ReportCheckExplainer($generator))->explainFromFindings($findings ?? $this->findings());

        return [$explained, $generator];
    }

    private function validAnswer(): array
    {
        return [
            'summary' => 'There are 2 things to check. Fix the overspent budget first.',
            'items' => [
                ['key' => 'f2', 'sentence' => 'Add the receipt reference for the PHP 1,200.50 Supplies expense on 2026-09-02.'],
                ['key' => 'f1', 'sentence' => 'Foundation Day budget is over by PHP 200.50, so move the spending or raise the allocation.'],
            ],
        ];
    }

    public function test_the_model_orders_the_findings_and_every_one_comes_back_once(): void
    {
        [$explained, $generator] = $this->explain(fn () => $this->validAnswer());

        $this->assertSame('claude', $explained['engine']);
        $this->assertSame(['missing_receipt:11', 'budget_overspent:3'], array_column($explained['items'], 'key'));
        $this->assertStringContainsString('Fix the overspent budget first.', $explained['text']);
        $this->assertStringContainsString("\n- Add the receipt reference", $explained['text']);
        $this->assertCount(1, $generator->calls);
        $this->assertSame(['total' => 2, 'high' => 1, 'medium' => 1, 'low' => 0], $generator->calls[0]['input']['counts']);
    }

    public function test_no_model_answer_gives_the_rules_list_itself(): void
    {
        [$explained] = $this->explain(null);

        $this->assertSame('template', $explained['engine']);
        $this->assertNull($explained['model']);
        $this->assertSame(['budget_overspent:3', 'missing_receipt:11'], array_column($explained['items'], 'key'));
        $this->assertSame(FinancialReportChecks::describe($this->findings()[0]), $explained['items'][0]['sentence']);
        $this->assertStringContainsString('2 things to look at', $explained['summary']);
        $this->assertStringContainsString('1 of them is high priority', $explained['summary']);
    }

    public function test_an_answer_that_drops_a_finding_is_thrown_away(): void
    {
        $answer = $this->validAnswer();
        array_pop($answer['items']);

        [$explained] = $this->explain(fn () => $answer);

        $this->assertSame('template', $explained['engine']);
        $this->assertCount(2, $explained['items']);
    }

    public function test_an_answer_that_adds_or_repeats_a_finding_is_thrown_away(): void
    {
        $invented = $this->validAnswer();
        $invented['items'][] = ['key' => 'f3', 'sentence' => 'A third problem.'];
        $repeated = $this->validAnswer();
        $repeated['items'][1]['key'] = 'f2';

        $this->assertSame('template', $this->explain(fn () => $invented)[0]['engine']);
        $this->assertSame('template', $this->explain(fn () => $repeated)[0]['engine']);
    }

    public function test_a_number_that_is_not_in_the_findings_is_thrown_away(): void
    {
        $answer = $this->validAnswer();
        $answer['items'][1]['sentence'] = 'Foundation Day budget is over by PHP 999.00, so move the spending.';

        [$explained] = $this->explain(fn () => $answer);

        $this->assertSame('template', $explained['engine']);
    }

    public function test_more_than_one_sentence_per_finding_or_three_in_the_summary_is_thrown_away(): void
    {
        $long = $this->validAnswer();
        $long['items'][0]['sentence'] = 'Add the receipt reference. Then upload the photo.';
        $wordy = $this->validAnswer();
        $wordy['summary'] = 'There are 2 things. Start with the budget. Then the receipt. Then relax.';

        $this->assertSame('template', $this->explain(fn () => $long)[0]['engine']);
        $this->assertSame('template', $this->explain(fn () => $wordy)[0]['engine']);
    }

    public function test_no_findings_means_no_model_call(): void
    {
        [$explained, $generator] = $this->explain(fn () => $this->validAnswer(), []);

        $this->assertSame([], $generator->calls);
        $this->assertSame('template', $explained['engine']);
        $this->assertSame([], $explained['items']);
        $this->assertStringContainsString('nothing to fix', $explained['summary']);
    }

    public function test_the_model_is_given_amounts_and_categories_but_no_record_ids_or_descriptions(): void
    {
        [, $generator] = $this->explain(fn () => $this->validAnswer());

        $sent = json_encode($generator->calls[0]['input']);
        $this->assertStringContainsString('Supplies', $sent);
        $this->assertStringNotContainsString('refs', $sent);
        $this->assertStringNotContainsString('receipt_reference', $sent);
        $this->assertStringNotContainsString('description', $sent);
    }
}
