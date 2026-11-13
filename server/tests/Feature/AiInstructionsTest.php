<?php

namespace Tests\Feature;

use App\Services\Ai\AiInstructions;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AiInstructionsTest extends TestCase
{
    public static function features(): array
    {
        return [
            'announcement' => ['announcementDraft', false],
            'budget advice' => ['budgetAdvice', true],
            'forecast' => ['forecastSummary', true],
            'financial report' => ['financialReportSummary', true],
            'task note' => ['taskAssignmentNote', false],
            'workflow explanations' => ['workflowAssignmentExplanations', false],
            'event plan' => ['eventPlan', true],
            'ask ai' => ['askAi', true],
        ];
    }

    #[DataProvider('features')]
    public function test_every_feature_is_grounded_and_says_what_to_do_with_missing_facts(string $method, bool $mentionsMoney): void
    {
        $text = AiInstructions::$method();

        $this->assertMatchesRegularExpression('/never invent|Use only|only the/i', $text);
        $this->assertMatchesRegularExpression('/not available|not yet|missing|to be announced|no data/i', $text);
        $this->assertStringNotContainsString("\u{2014}", $text);
        $this->assertStringNotContainsString("\u{2013}", $text);
        if ($mentionsMoney) {
            $this->assertStringContainsString('PHP 12,500.00', $text);
            $this->assertStringContainsString('Never use $', $text);
        }
    }

    public function test_the_event_plan_states_every_deadline_rule_the_server_enforces(): void
    {
        $text = AiInstructions::eventPlan();

        foreach (['later than current_time', 'before event.start_time', 'between event.start_time and event.end_time', 'within 30 days', 'allowed_positions'] as $rule) {
            $this->assertStringContainsString($rule, $text);
        }
    }
}
