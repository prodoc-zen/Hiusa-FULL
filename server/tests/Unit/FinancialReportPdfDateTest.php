<?php

namespace Tests\Unit;

use App\Models\FinancialReport;
use App\Services\FinancialReportPdfService;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class FinancialReportPdfDateTest extends TestCase
{
    public function test_generated_report_date_uses_philippine_time(): void
    {
        $originalTimezone = date_default_timezone_get();
        date_default_timezone_set('UTC');
        $report = new FinancialReport([
            'generated_at' => Carbon::parse('2026-10-05 18:30:00', 'UTC'),
        ]);

        $method = new \ReflectionMethod(FinancialReportPdfService::class, 'letterDetails');
        try {
            $letter = $method->invoke(new FinancialReportPdfService, $report, 'Financial Report', 0.0);
        } finally {
            date_default_timezone_set($originalTimezone);
        }

        $this->assertSame('October 6, 2026', $letter['date']);
    }

    public function test_explicit_letter_date_remains_the_selected_calendar_date(): void
    {
        $report = new FinancialReport([
            'generated_at' => Carbon::parse('2026-10-05 18:30:00', 'UTC'),
            'letter_details' => ['date' => '2026-10-05'],
        ]);

        $method = new \ReflectionMethod(FinancialReportPdfService::class, 'letterDetails');
        $letter = $method->invoke(new FinancialReportPdfService, $report, 'Financial Report', 0.0);

        $this->assertSame('October 5, 2026', $letter['date']);
    }

    public function test_letter_formatting_escapes_user_html(): void
    {
        $method = new \ReflectionMethod(FinancialReportPdfService::class, 'formatLetterBody');
        $html = $method->invoke(new FinancialReportPdfService, '**Approved** [font=serif]Report[/font] <script>alert(1)</script>');

        $this->assertStringContainsString('<strong>Approved</strong>', $html);
        $this->assertStringContainsString('font-family: Times New Roman, serif', $html);
        $this->assertStringContainsString('&lt;script&gt;', $html);
        $this->assertStringNotContainsString('<script>', $html);
    }
}
