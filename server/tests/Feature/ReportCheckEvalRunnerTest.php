<?php

namespace Tests\Feature;

use Tests\TestCase;

/** The held-out runner for the report check prose, run through ai:live-eval with no model and no key. */
class ReportCheckEvalRunnerTest extends TestCase
{
    /** @var list<string> */
    private array $paths = [];

    protected function tearDown(): void
    {
        foreach ($this->paths as $path) {
            is_dir($path) ? @rmdir($path) : @unlink($path);
        }
        parent::tearDown();
    }

    /** @return array<string, mixed> */
    private function ledger(string $id, ?string $receipt, array $expected): array
    {
        return [
            'id' => $id, 'period' => ['from' => '2026-08-01', 'to' => '2026-12-31'], 'previous_report_closing' => null, 'opening_balance' => 0,
            'events' => [], 'budgets' => [],
            'transactions' => [['key' => 't1', 'type' => 'expense', 'amount' => 1200.50, 'category' => 'Supplies', 'transaction_date' => '2026-09-02', 'receipt_reference' => $receipt, 'budget_key' => null, 'event_key' => null]],
            'collections' => [['key' => 'c1', 'amount' => 800, 'verified' => false, 'remitted_amount' => 0]],
            'cash_advances' => [], 'report' => null, 'expected_findings' => $expected,
        ];
    }

    public function test_the_runner_judges_the_words_and_leaves_a_clean_ledger_with_nothing_to_say(): void
    {
        config()->set('services.anthropic.key', '');
        $dir = sys_get_temp_dir().'/hiusa-report-check-eval-'.bin2hex(random_bytes(4));
        mkdir($dir);
        $this->paths[] = $dir;
        $file = "{$dir}/report-checks.dev.json";
        $clean = $this->ledger('rc-clean', 'OR-1', []);
        $clean['collections'] = [];
        file_put_contents($file, json_encode(['feature' => 'report-checks', 'author_note' => 'inline', 'cases' => [
            $this->ledger('rc-d01', null, []),
            $clean,
        ]]));
        array_unshift($this->paths, $file, "{$dir}/heldout-report-checks-dev.json");

        $this->artisan('ai:live-eval', ['--engine' => 'template', '--heldout' => $file, '--out' => $dir])
            ->expectsOutputToContain('report-checks dev: 2 cases, 2 passed all checks (100%); every_finding_mentioned 2/2, none_invented 2/2, no_unsupplied_number 2/2')
            ->assertSuccessful();

        $record = json_decode((string) file_get_contents("{$dir}/heldout-report-checks-dev.json"), true);
        [$defective, $none] = $record['cases'];
        $this->assertSame('template', $defective['engine']);
        $this->assertCount(2, $defective['facts']['findings']);
        $this->assertStringContainsString('PHP 1,200.50', $defective['text']);
        $this->assertStringContainsString('PHP 800.00', $defective['text']);
        $this->assertSame([], $none['facts']['findings']);
        $this->assertStringContainsString('nothing to fix', $none['text']);
        $this->assertNull($defective['error']);
    }

    public function test_the_runner_is_also_registered_under_the_singular_feature_name(): void
    {
        config()->set('services.anthropic.key', '');
        $dir = sys_get_temp_dir().'/hiusa-report-check-eval-'.bin2hex(random_bytes(4));
        mkdir($dir);
        $this->paths[] = $dir;
        $file = "{$dir}/report-checks.test.json";
        file_put_contents($file, json_encode(['feature' => 'report_check', 'cases' => [$this->ledger('rc-t01', null, [])]]));
        array_unshift($this->paths, $file, "{$dir}/heldout-report_check-test.json");

        $this->artisan('ai:live-eval', ['--engine' => 'template', '--heldout' => $file, '--out' => $dir])->assertSuccessful();

        $this->assertFileExists("{$dir}/heldout-report_check-test.json");
    }
}
