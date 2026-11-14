<?php

namespace Tests\Feature;

use App\Services\Ai\Concerns\GuardsGeneratedText;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class MarkdownNumericGuardTest extends TestCase
{
    private object $guard;

    protected function setUp(): void
    {
        parent::setUp();
        $this->guard = new class
        {
            use GuardsGeneratedText;
        };
    }

    public static function passing(): array
    {
        $facts = ['pending' => 3, 'amount' => 12500.5, 'today' => 'Saturday, November 14, 2026 (2026-11-14)'];

        return [
            'ordered list with a dot' => ["1. Review the files\n2. Approve the budget", $facts],
            'ordered list with a paren' => ["1) Review\n2) Approve\n3) Publish", $facts],
            'nested ordered list' => ["- Steps:\n   1. First\n   2. Second", $facts],
            'quoted ordered list' => ["> 1. First\n> 2. Second", $facts],
            'heading hashes' => ["## 3 things to do\n### Next", $facts],
            'table pipes' => ["| Organization | Files |\n| --- | --- |\n| Chess Club | 3 |", $facts],
            'link target digits' => ['Open [compliance](/dashboard/compliance?tab=2024&id=77) now.', $facts],
            'link with a title' => ['See [the page](/dashboard/events/55 "Event 55") for 3 items.', $facts],
            'reference definition' => ["See [the page][1] for 3 items.\n\n[1]: /dashboard/events/99", $facts],
            'peso amount in the facts' => ['The balance is PHP 12,500.50.', $facts],
            'date written out' => ['Due by November 14, 2026.', $facts],
            'date as iso' => ['Today is 2026-11-14.', $facts],
            'day and month parts' => ['That is 11/14.', $facts],
            'html attribute in the facts' => ['<progress value="3" max="3"></progress>', $facts],
            'percentage bar out of 100' => ['<progress value="66.67" max="100"></progress>', ['completion' => '66.67%']],
            'progress with value and total from the facts' => ['<progress value="2" max="5"></progress>', ['done' => 2, 'total' => 5]],
            'digits separated by a comma' => ['Members 1,2 are overdue.', ['a' => 1, 'b' => 2]],
            'thousands separator' => ['Dues total PHP 1,234,567.50.', ['dues' => 1234567.5]],
            'real reference definition with a title' => ["See [the page][a] now.\n\n[a]: /dashboard/events/99 \"Event 99\"", $facts],
            'list numbering up to twenty' => ["19. Nineteenth step\n20) Twentieth step", $facts],
            'letter and digit code from the facts' => ['Q4 is the quarter in question.', ['period' => 'Q4 2026']],
        ];
    }

    #[DataProvider('passing')]
    public function test_markdown_structure_is_not_mistaken_for_a_new_number(string $text, array $facts): void
    {
        $this->assertTrue($this->guard->preservesNumericFacts($text, $facts), $text);
    }

    public static function failing(): array
    {
        $facts = ['pending' => 3, 'amount' => 12500.5, 'today' => '2026-11-14'];

        return [
            'new peso amount' => ['The balance is PHP 99,999.', $facts],
            'new peso amount in a list item' => ["1. Pay PHP 4,200 today\n2. Done", $facts],
            'percentage not in the facts' => ['Completion is at 45%.', $facts],
            'new count in a heading' => ['## 17 organizations late', $facts],
            'new number in a table cell' => ["| Club | Files |\n| --- | --- |\n| Chess | 8 |", $facts],
            'new number in a link label' => ['Open [all 41 files](/dashboard/files).', $facts],
            'new number in a list item body' => ["1. First\n2. Review 26 files", $facts],
            'new year' => ['Due by November 14, 2027.', $facts],
            'html attribute value' => ['<progress value="82" max="100"></progress>', $facts],
            'html attribute value with a stat' => ['<div class="stat"><span class="stat-value">88</span></div>', $facts],
            'number glued to a list marker' => ['1. 500 pesos', $facts],
            'text after a link' => ['[Open](/dashboard/x) then pay 600.', $facts],
            'bracketed label that is not a reference definition' => ['[Total]: PHP 99,999.00 is missing from the fund.', $facts],
            'bracketed reminder line' => ['[Reminder]: 7 members still owe.', $facts],
            'large number that looks like a list marker' => ['250. members have not paid.', $facts],
            'amount glued to its currency' => ['The fund is short by PHP9999.', $facts],
            'code that the facts do not carry' => ['Q4 has 9 files.', $facts],
            'comma joins two invented numbers' => ['Members 41,7 are overdue.', $facts],
        ];
    }

    #[DataProvider('failing')]
    public function test_a_truly_new_number_is_still_rejected(string $text, array $facts): void
    {
        $this->assertFalse($this->guard->preservesNumericFacts($text, $facts), $text);
    }

    public function test_existing_plain_text_behaviour_is_unchanged(): void
    {
        $this->assertTrue($this->guard->preservesNumericFacts('Income is PHP 12,500.50 at 80%.', ['income' => 12500.5, 'ratio' => 0.8]));
        $this->assertFalse($this->guard->preservesNumericFacts('Income is PHP 99,999.', ['income' => 12500.5]));
        $this->assertTrue($this->guard->preservesNumericFacts('No numbers here.', []));
    }
}
