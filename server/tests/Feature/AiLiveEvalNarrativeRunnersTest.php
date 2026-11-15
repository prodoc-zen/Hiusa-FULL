<?php

namespace Tests\Feature;

use Tests\TestCase;

/** The held-out runners for the semester narrative and the handover notes, run with no model through the template. */
class AiLiveEvalNarrativeRunnersTest extends TestCase
{
    /** @var list<string> */
    private array $paths = [];

    protected function tearDown(): void
    {
        foreach (array_reverse($this->paths) as $path) {
            is_dir($path) ? @rmdir($path) : @unlink($path);
        }
        parent::tearDown();
    }

    private function scratchDir(): string
    {
        $dir = sys_get_temp_dir().'/hiusa-narrative-eval-'.bin2hex(random_bytes(4));
        mkdir($dir);
        $this->paths[] = $dir;

        return $dir;
    }

    /**
     * Writes the case file and runs it; returns the record the harness leaves.
     *
     * @return array<string, mixed>
     */
    private function heldout(string $feature, array $cases, string $split = 'dev'): array
    {
        config()->set('services.anthropic.key', '');
        $dir = $this->scratchDir();
        $file = "{$dir}/cases.{$split}.json";
        file_put_contents($file, json_encode(['feature' => $feature, 'author_note' => 'inline', 'cases' => $cases]));
        $this->paths[] = $file;
        $out = $this->scratchDir();
        $record = "{$out}/heldout-{$feature}-{$split}.json";
        $this->paths[] = $record;

        $this->artisan('ai:live-eval', ['--engine' => 'template', '--heldout' => $file, '--out' => $out])->assertSuccessful();

        return json_decode((string) file_get_contents($record), true);
    }

    private function narrativeCase(string $id, array $overrides = []): array
    {
        return [
            'id' => $id,
            'organization' => 'Computer Science Society',
            'semester' => '1st Semester 2026-2027',
            'events' => [['title' => 'Programming Contest', 'date' => '2026-09-12', 'status' => 'completed', 'attendance' => 120, 'budget_allocated' => 25000, 'budget_used' => 18400]],
            'tasks' => ['completed' => 14, 'overdue' => 2, 'open' => 3],
            'elections' => [],
            'merchandise' => ['orders' => 38, 'claimed' => 30],
            'announcements' => ['posted' => 12],
            'finance' => ['income' => 30000, 'expense' => 18400, 'closing_balance' => 11600],
            'upcoming_events' => [],
            'officers' => [],
            'expect' => ['titles' => ['Programming Contest'], 'cancelled_titles' => [], 'empty' => false],
            ...$overrides,
        ];
    }

    public function test_the_narrative_runner_checks_every_case_through_the_template(): void
    {
        $record = $this->heldout('semester_narrative', [
            $this->narrativeCase('sn-01'),
            $this->narrativeCase('sn-02', [
                'events' => [['title' => 'Foundation Day', 'date' => '2026-10-02', 'status' => 'cancelled', 'attendance' => null, 'budget_allocated' => null, 'budget_used' => null]],
                'expect' => ['titles' => ['Foundation Day'], 'cancelled_titles' => ['Foundation Day'], 'empty' => false],
            ]),
            $this->narrativeCase('sn-03', ['events' => [], 'expect' => ['titles' => [], 'cancelled_titles' => [], 'empty' => true]]),
        ]);

        $this->assertSame(['cases' => 3, 'passed_all' => 3, 'pass_rate' => 100, 'checks' => [
            'no_unsupplied_number' => ['passed' => 3, 'of' => 3],
            'titles_subset' => ['passed' => 3, 'of' => 3],
            'max_length' => ['passed' => 3, 'of' => 3],
            'cancelled_not_held' => ['passed' => 1, 'of' => 1],
            'empty_semester_says_none' => ['passed' => 1, 'of' => 1],
        ]], $record['summary']);
        $this->assertSame(['template'], array_unique(array_column($record['cases'], 'engine')));
        $this->assertSame('Programming Contest', $record['cases'][0]['facts']['events'][0]['title'], 'the facts sent are recorded');
        $this->assertStringContainsString('was cancelled and was not held', $record['cases'][1]['text']);
        $this->assertStringContainsString('No events were recorded', $record['cases'][2]['text']);
    }

    public function test_the_narrative_split_hyphenated_feature_key_also_runs(): void
    {
        $record = $this->heldout('semester-narrative', [$this->narrativeCase('sn-01')], 'test');

        $this->assertSame(['semester-narrative', 'test'], [$record['feature'], $record['split']]);
        $this->assertSame(1, $record['summary']['passed_all']);
    }

    public function test_the_handover_runner_checks_category_only_and_length(): void
    {
        $digest = [
            'organization' => 'Computer Science Society', 'semester' => '2nd Semester 2026-2027',
            'events' => [['title' => 'Programming Contest', 'date' => '2027-02-12', 'status' => 'completed', 'attendance' => 120, 'budget_allocated' => null, 'budget_used' => null]],
            'tasks' => ['completed' => 14, 'overdue' => 2, 'open' => 3], 'elections' => [], 'merchandise' => ['orders' => 38, 'claimed' => 30], 'announcements' => ['posted' => 12],
            'finance' => ['income' => 30000, 'expense' => 18400, 'closing_balance' => 11600], 'upcoming_events' => [], 'officers' => [],
        ];
        $open = ['pending_tasks' => [['title' => 'Liquidate the fund', 'owner' => 'Ana Reyes', 'deadline' => '2027-04-10']], 'unsettled' => [['kind' => 'cash_advance', 'amount' => 1500, 'note' => 'Not repaid.']], 'scheduled_events' => [], 'election_state' => 'none', 'missing_compliance' => []];

        $record = $this->heldout('handover_note', [
            ['id' => 'hn-01', 'category' => 'finance', 'digest' => $digest, 'open_items' => $open, 'expect' => ['must_mention' => ['1,500.00'], 'must_not_mention' => ['Programming Contest', 'Liquidate the fund']]],
            ['id' => 'hn-02', 'category' => 'tasks', 'digest' => $digest, 'open_items' => $open, 'expect' => ['must_mention' => ['Liquidate the fund'], 'must_not_mention' => ['Programming Contest', '11,600']]],
            ['id' => 'hn-03', 'category' => 'finance', 'digest' => $digest, 'open_items' => $open, 'expect' => ['must_mention' => [], 'must_not_mention' => ['Closing balance']]],
        ], 'test');

        $this->assertSame([true, true, false], array_column($record['cases'], 'passed'), 'the third case forbids a phrase the finance note must say');
        $this->assertSame(['no_unsupplied_number', 'category_only', 'must_mention', 'max_length'], array_keys($record['cases'][0]['checks']));
        $this->assertSame(['no_unsupplied_number' => ['passed' => 3, 'of' => 3], 'category_only' => ['passed' => 2, 'of' => 3]], array_intersect_key($record['summary']['checks'], ['category_only' => 1, 'no_unsupplied_number' => 1]));
        $this->assertSame('finance', $record['cases'][0]['facts']['category']);
        $this->assertArrayNotHasKey('events', $record['cases'][0]['facts'], 'the facts recorded are the ones the model would be shown');
    }

    public function test_a_handover_case_with_an_unknown_category_fails_its_own_case_only(): void
    {
        $record = $this->heldout('handover_note', [
            ['id' => 'hn-bad', 'category' => 'budget', 'digest' => [], 'open_items' => [], 'expect' => []],
            ['id' => 'hn-ok', 'category' => 'compliance', 'digest' => [], 'open_items' => ['missing_compliance' => ['Action Plan']], 'expect' => ['must_mention' => ['Action Plan'], 'must_not_mention' => []]],
        ]);

        $this->assertStringContainsString('InvalidArgumentException', $record['cases'][0]['error']);
        $this->assertFalse($record['cases'][0]['passed']);
        $this->assertTrue($record['cases'][1]['passed']);
    }
}
