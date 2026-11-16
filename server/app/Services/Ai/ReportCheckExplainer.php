<?php

namespace App\Services\Ai;

use App\Contracts\TextGenerator;
use App\Services\Finance\FinancialReportChecks;

/**
 * Puts the findings of FinancialReportChecks in order and in words. The rules already found every problem; the model
 * may only order them and write one sentence for each, so an answer that adds, drops or repeats a finding, runs past
 * three summary sentences or one sentence per finding, or carries a number that is not in the findings is thrown away
 * and the rules list itself is used. A model outage therefore costs only the prose.
 */
class ReportCheckExplainer
{
    /** Past this many findings one answer is too long to trust, so the rules list is shown as it is. */
    private const MAX_EXPLAINED = 40;

    public function __construct(private readonly TextGenerator $ai) {}

    /**
     * The facts entry point: findings in, ordered text out. The key of each finding is the one from
     * FinancialReportChecks::keyOf; the model is given short keys of its own and never sees record ids.
     *
     * @param  list<array{code: string, severity: string, facts: array<string, mixed>, refs: list<int>, amount: float|null}>  $findings
     * @return array{summary: string, items: list<array{key: string, sentence: string}>, text: string, model: ?string, engine: string, facts: array<string, mixed>}
     */
    public function explainFromFindings(array $findings): array
    {
        $withSeverity = fn (string $severity) => count(array_filter($findings, fn (array $finding) => $finding['severity'] === $severity));
        $facts = [
            'counts' => ['total' => count($findings), 'high' => $withSeverity('high'), 'medium' => $withSeverity('medium'), 'low' => $withSeverity('low')],
            'findings' => array_map(fn (array $finding, int $index) => [
                'key' => 'f'.($index + 1),
                'rule' => $finding['code'],
                'severity' => $finding['severity'],
                'facts' => $finding['facts'],
                'amount' => $finding['amount'],
            ], $findings, array_keys($findings)),
        ];

        $generated = $findings === [] || count($findings) > self::MAX_EXPLAINED ? null : $this->ai->generateStructured(
            AiInstructions::reportCheck(),
            ReviewNoteDrafter::noticedFacts($facts),
            'hiusa_report_check',
            [
                'type' => 'object',
                'additionalProperties' => false,
                'required' => ['summary', 'items'],
                'properties' => [
                    'summary' => ['type' => 'string'],
                    'items' => [
                        'type' => 'array',
                        'items' => [
                            'type' => 'object',
                            'additionalProperties' => false,
                            'required' => ['key', 'sentence'],
                            'properties' => ['key' => ['type' => 'string'], 'sentence' => ['type' => 'string']],
                        ],
                    ],
                ],
            ],
            min(2400, max(500, count($findings) * 90 + 200)),
            0.2,
        );

        $written = $generated ? $this->validated($generated['data'] ?? [], $facts) : null;
        if ($written === null) {
            return $this->fromRules($findings, $facts);
        }

        $byShortKey = [];
        foreach ($findings as $index => $finding) {
            $byShortKey['f'.($index + 1)] = FinancialReportChecks::keyOf($finding);
        }
        $items = array_map(fn (array $item) => ['key' => $byShortKey[$item['key']], 'sentence' => $item['sentence']], $written['items']);

        return ['summary' => $written['summary'], 'items' => $items, 'text' => $this->textOf($written['summary'], $items), 'model' => $generated['model'] ?? null, 'engine' => $this->engineFor($generated['model'] ?? null), 'facts' => $facts];
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, mixed>  $facts
     * @return array{summary: string, items: list<array{key: string, sentence: string}>}|null
     */
    private function validated(array $data, array $facts): ?array
    {
        $summary = is_string($data['summary'] ?? null) ? $this->ai->plainText($data['summary']) : '';
        if ($summary === '' || $this->sentenceCount($summary) > 3 || ! $this->ai->preservesNumericFacts($summary, $facts)) {
            return null;
        }

        $expected = array_column($facts['findings'], 'key');
        $items = [];
        foreach (is_array($data['items'] ?? null) ? $data['items'] : [] as $item) {
            $key = is_array($item) && is_string($item['key'] ?? null) ? trim($item['key']) : '';
            $sentence = is_array($item) && is_string($item['sentence'] ?? null) ? $this->ai->plainText($item['sentence']) : '';
            if (! in_array($key, $expected, true) || isset($items[$key]) || $sentence === '' || $this->sentenceCount($sentence) > 1 || ! $this->ai->preservesNumericFacts($sentence, $facts)) {
                return null;
            }
            $items[$key] = ['key' => $key, 'sentence' => $sentence];
        }
        if (count($items) !== count($expected)) {
            return null;
        }

        return ['summary' => $summary, 'items' => array_values($items)];
    }

    /** Sentences are split where an end mark is followed by a space, so "PHP 1,200.50" stays whole. */
    private function sentenceCount(string $text): int
    {
        return count(array_filter(preg_split('/(?<=[.!?])\s+/u', trim($text)) ?: [], fn (string $part) => trim($part) !== ''));
    }

    /**
     * The rules list: every finding as its plain sentence, most urgent first, under a two sentence summary.
     *
     * @param  list<array<string, mixed>>  $findings
     * @param  array<string, mixed>  $facts
     * @return array{summary: string, items: list<array{key: string, sentence: string}>, text: string, model: ?string, engine: string, facts: array<string, mixed>}
     */
    private function fromRules(array $findings, array $facts): array
    {
        $high = count(array_filter($findings, fn (array $finding) => $finding['severity'] === 'high'));
        $summary = match (true) {
            $findings === [] => 'The checks found nothing to fix. You can send this report.',
            default => 'The checks found '.count($findings).(count($findings) === 1 ? ' thing' : ' things').' to look at before you send this report.'
                .($high > 0 ? ' '.$high.' of them '.($high === 1 ? 'is' : 'are').' high priority, so fix '.($high === 1 ? 'that one' : 'those').' first.' : ''),
        };
        $items = array_map(fn (array $finding) => ['key' => FinancialReportChecks::keyOf($finding), 'sentence' => FinancialReportChecks::describe($finding)], $findings);

        return ['summary' => $summary, 'items' => $items, 'text' => $this->textOf($summary, $items), 'model' => null, 'engine' => 'template', 'facts' => $facts];
    }

    /** @param  list<array{key: string, sentence: string}>  $items */
    private function textOf(string $summary, array $items): string
    {
        return trim($summary."\n".implode("\n", array_map(fn (array $item) => '- '.$item['sentence'], $items)));
    }

    private function engineFor(?string $model): string
    {
        if ($model === null || $model === '') {
            return 'template';
        }

        return str_starts_with($model, 'claude') ? 'claude' : 'groq';
    }
}
