<?php

namespace App\Console\Commands;

use App\Models\FinancialReport;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class SecureFinancialReportDocuments extends Command
{
    protected $signature = 'financial-reports:secure-documents';

    protected $description = 'Move financial report supporting documents from the public disk to the private local disk and drop their public URLs';

    public function handle(): int
    {
        $public = Storage::disk('public');
        $local = Storage::disk('local');
        $moved = 0;
        $missing = 0;

        FinancialReport::query()
            ->whereNotNull('supporting_documents')
            ->each(function (FinancialReport $report) use ($public, $local, &$moved, &$missing) {
                $documents = $report->supporting_documents ?? [];
                $changed = false;

                foreach ($documents as $index => $document) {
                    $path = $document['path'] ?? null;
                    if (! is_string($path)) {
                        continue;
                    }

                    if ($public->exists($path)) {
                        $local->writeStream($path, $public->readStream($path));
                        $public->delete($path);
                        $moved++;
                    } elseif (! $local->exists($path)) {
                        $missing++;
                        $this->warn("Report {$report->id} document {$index} has no file at {$path}.");

                        continue;
                    }

                    if (array_key_exists('url', $document)) {
                        unset($documents[$index]['url']);
                        $changed = true;
                    }
                }

                if ($changed) {
                    $report->update(['supporting_documents' => $documents]);
                }
            });

        $this->info("Moved {$moved} document(s) to private storage; {$missing} listed file(s) were missing.");

        return self::SUCCESS;
    }
}
