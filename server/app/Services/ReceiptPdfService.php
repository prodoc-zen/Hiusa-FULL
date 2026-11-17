<?php

namespace App\Services;

use App\Models\Transaction;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Str;

/** Renders one payment receipt as a single A4 page, laid out like the receipt shown on the personal receipts page. */
class ReceiptPdfService
{
    public function render(Transaction $receipt): array
    {
        $number = $receipt->receipt_reference ?: ($receipt->receipt_number ? 'Receipt #'.$receipt->receipt_number : 'Receipt #'.$receipt->id);
        $html = view('pdf.receipt', [
            'receipt' => $receipt,
            'number' => $number,
            'organization' => $receipt->organization?->name ?: 'HIUSA',
            'method' => $receipt->merchandiseOrder?->payment_method,
        ])->render();

        $options = new Options;
        $options->set('defaultFont', 'DejaVu Sans');
        $options->set('isRemoteEnabled', false);
        $options->set('isPhpEnabled', false);
        $dompdf = new Dompdf($options);
        $dompdf->loadHtml($html, 'UTF-8');
        $dompdf->setPaper('A4', 'portrait');
        $dompdf->render();

        return ['content' => $dompdf->output(), 'filename' => 'receipt-'.(Str::slug($number) ?: $receipt->id).'.pdf'];
    }
}
