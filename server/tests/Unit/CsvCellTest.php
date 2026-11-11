<?php

namespace Tests\Unit;

use App\Support\Csv;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class CsvCellTest extends TestCase
{
    #[DataProvider('formulaLooking')]
    public function test_text_a_spreadsheet_would_run_as_a_formula_gets_a_leading_quote(string $value): void
    {
        $this->assertSame("'".$value, Csv::cell($value));
    }

    public static function formulaLooking(): array
    {
        return [
            'equals' => ['=1+1'],
            'at sign' => ['@x'],
            'minus word' => ['-cmd'],
            'phone with spaces' => ['+63 917 123 4567'],
            'sum of numbers' => ['+1+1'],
            'amount with text' => ['-325.00 PHP'],
            'bare sign' => ['-'],
            'leading dot' => ['-.5'],
            'trailing dot' => ['-5.'],
            'exponent' => ['-1e5'],
            'number then newline' => ["-325.00\n"],
            'tab' => ["\t=1+1"],
        ];
    }

    #[DataProvider('plainNumbers')]
    public function test_a_plain_number_is_left_alone(mixed $value, string $expected): void
    {
        $this->assertSame($expected, Csv::cell($value));
    }

    public static function plainNumbers(): array
    {
        return [
            'negative amount' => ['-325.00', '-325.00'],
            'negative int' => [-325, '-325'],
            'signed whole number' => ['+63', '+63'],
            'unsigned amount' => ['180.50', '180.50'],
            'widest accepted' => ['-'.str_repeat('9', 30).'.'.str_repeat('9', 30), '-'.str_repeat('9', 30).'.'.str_repeat('9', 30)],
        ];
    }

    public function test_a_very_long_run_of_digits_after_a_sign_is_guarded_and_fast(): void
    {
        $started = microtime(true);

        $this->assertStringStartsWith("'", Csv::cell('-'.str_repeat('9', 1_000_000).'x'));
        $this->assertStringStartsWith("'", Csv::cell('-'.str_repeat('9', 1_000_000)));
        $this->assertLessThan(0.5, microtime(true) - $started);
    }
}
