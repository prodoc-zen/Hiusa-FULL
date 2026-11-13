<?php

namespace App\Services;

use Dompdf\Dompdf;
use Dompdf\Options;

/** Renders one election report (title, election, columns, rows) as a plain A4 table, the way the financial report PDF is built. */
class ElectionReportPdfService
{
    /** @param array{title: string, election: array, generated_at: string, columns: array, rows: array} $report */
    public function render(array $report, string $slug): array
    {
        $html = view('reports.election', ['report' => $report])->render();

        $options = new Options;
        $options->set('defaultFont', 'DejaVu Sans');
        $options->set('isRemoteEnabled', false);
        $options->set('isPhpEnabled', false);
        $dompdf = new Dompdf($options);
        $dompdf->loadHtml($html, 'UTF-8');
        $dompdf->setPaper('A4', count($report['columns']) > 4 ? 'landscape' : 'portrait');
        $dompdf->render();
        $font = $dompdf->getFontMetrics()->getFont('DejaVu Sans', 'normal');
        $canvas = $dompdf->getCanvas();
        $canvas->page_text($canvas->get_width() - 100, $canvas->get_height() - 30, 'Page {PAGE_NUM} of {PAGE_COUNT}', $font, 8, [0.39, 0.45, 0.55]);

        return ['content' => $dompdf->output(), 'filename' => $slug.'.pdf'];
    }
}
