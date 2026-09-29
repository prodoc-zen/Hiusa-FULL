<?php

namespace App\Services;

use App\Models\FinancialReport;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class FinancialReportPdfService
{
    public function render(FinancialReport $report, Collection $transactions, float $openingBalance): array
    {
        $incomeTransactions = $transactions->where('type', 'income')->values();
        $expenseTransactions = $transactions->where('type', 'expense')->values();
        $incomeTotal = round((float) $incomeTransactions->sum('amount'), 2);
        $expenseTotal = round((float) $expenseTransactions->sum('amount'), 2);
        $periodNet = round($incomeTotal - $expenseTotal, 2);
        $closingBalance = round($openingBalance + $periodNet, 2);

        $incomeCategories = $this->categoryRows($incomeTransactions);
        $expenseCategories = $this->categoryRows($expenseTransactions);
        $documentType = $report->document_type ?: 'financial_report';
        $documentLabel = $documentType === 'income_statement' ? 'Income Statement' : 'Financial Report';
        $letter = $this->letterDetails($report, $documentLabel, $periodNet);

        $html = view(
            $documentType === 'income_statement' ? 'pdf.income-statement' : 'pdf.financial-report',
            [
                'report' => $report,
                'organization' => $report->organization,
                'letterheadDataUri' => $this->letterheadDataUri($report->letterhead_path),
                'letter' => $letter,
                'incomeTransactions' => $incomeTransactions,
                'expenseTransactions' => $expenseTransactions,
                'incomeCategories' => $incomeCategories,
                'expenseCategories' => $expenseCategories,
                'incomeTotal' => $incomeTotal,
                'expenseTotal' => $expenseTotal,
                'periodNet' => $periodNet,
                'openingBalance' => round($openingBalance, 2),
                'closingBalance' => $closingBalance,
                'custody' => $report->custody_snapshot,
            ],
        )->render();

        $options = new Options;
        $options->set('defaultFont', 'DejaVu Sans');
        $options->set('isRemoteEnabled', false);
        $options->set('isPhpEnabled', false);
        $dompdf = new Dompdf($options);
        $dompdf->loadHtml($html, 'UTF-8');
        $dompdf->setPaper('A4', 'portrait');
        $dompdf->render();
        $font = $dompdf->getFontMetrics()->getFont('DejaVu Sans', 'normal');
        $dompdf->getCanvas()->page_text(500, 812, 'Page {PAGE_NUM} of {PAGE_COUNT}', $font, 8, [0.39, 0.45, 0.55]);

        $filename = Str::slug($report->title ?: $documentLabel).'-'.$report->id.'.pdf';

        return ['content' => $dompdf->output(), 'filename' => $filename];
    }

    private function categoryRows(Collection $transactions): Collection
    {
        return $transactions
            ->groupBy(fn ($transaction) => trim((string) $transaction->category) ?: 'Uncategorized')
            ->map(fn ($rows, $category) => [
                'category' => $category,
                'amount' => round((float) $rows->sum('amount'), 2),
            ])
            ->sortBy('category', SORT_NATURAL | SORT_FLAG_CASE)
            ->values();
    }

    private function letterDetails(FinancialReport $report, string $documentLabel, float $periodNet): array
    {
        $details = $report->letter_details ?? [];
        $organizationName = $report->organization?->name ?: 'the organization';
        $period = $this->periodLabel($report);

        return [
            'date' => Carbon::parse($details['date'] ?? $report->generated_at ?? now())->format('F j, Y'),
            'subject' => trim((string) ($details['subject'] ?? '')) ?: 'Submission of '.$documentLabel,
            'recipient' => trim((string) ($details['recipient'] ?? '')) ?: 'To whom it may concern,',
            'body' => trim((string) ($details['body'] ?? '')) ?: "Please find attached the {$documentLabel} for {$organizationName}, covering {$period}. The statement is based on the financial transactions recorded for this period. Net activity for the period is PHP ".number_format($periodNet, 2).'.',
            'closing' => trim((string) ($details['closing'] ?? '')) ?: 'Thank you.',
        ];
    }

    private function periodLabel(FinancialReport $report): string
    {
        if (! $report->period_start || ! $report->period_end) {
            return 'the selected reporting period';
        }

        return Carbon::parse($report->period_start)->format('F j, Y').' to '.Carbon::parse($report->period_end)->format('F j, Y');
    }

    private function letterheadDataUri(?string $path): ?string
    {
        if (! $path || ! Storage::disk('local')->exists($path)) {
            return null;
        }

        $mime = Storage::disk('local')->mimeType($path);
        if (! in_array($mime, ['image/jpeg', 'image/png'], true)) {
            return null;
        }

        return 'data:'.$mime.';base64,'.base64_encode(Storage::disk('local')->get($path));
    }
}
