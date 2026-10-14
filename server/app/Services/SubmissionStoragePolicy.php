<?php

namespace App\Services;

use App\Models\EventRequirementFile;
use App\Models\FinancialReport;
use App\Models\OrganizationComplianceSubmission;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

class SubmissionStoragePolicy
{
    public function settings(): object
    {
        return DB::table('file_storage_settings')->where('id', 1)->firstOrFail();
    }

    public function organizationBytes(int $organizationId): int
    {
        $bytes = (int) OrganizationComplianceSubmission::where('organization_id', $organizationId)->sum('file_size');
        $bytes += (int) DB::table('organization_application_documents as d')
            ->join('organization_applications as a', 'a.id', '=', 'd.organization_application_id')
            ->where('a.organization_id', $organizationId)->sum('d.file_size');
        $disk = Storage::disk('local');
        EventRequirementFile::where('organization_id', $organizationId)->pluck('path')->each(function ($path) use ($disk, &$bytes) {
            if ($disk->exists($path)) {
                $bytes += $disk->size($path);
            }
        });
        FinancialReport::where('organization_id', $organizationId)->get(['supporting_documents', 'letterhead_path'])->each(function ($report) use ($disk, &$bytes) {
            foreach ($report->supporting_documents ?? [] as $file) {
                $bytes += (int) ($file['size'] ?? ($disk->exists($file['path'] ?? '') ? $disk->size($file['path']) : 0));
            }
            if ($report->letterhead_path && $disk->exists($report->letterhead_path)) {
                $bytes += $disk->size($report->letterhead_path);
            }
        });

        return $bytes;
    }

    /** @param array<int, UploadedFile> $files */
    public function assertUpload(array $files, ?int $organizationId = null, int $replacedBytes = 0, string $field = 'document'): void
    {
        $settings = $this->settings();
        foreach ($files as $file) {
            if ($file->getSize() > $settings->max_file_mb * 1024 * 1024) {
                throw ValidationException::withMessages([$field => ["A file exceeds the SAO limit of {$settings->max_file_mb} MB."]]);
            }
        }
        if ($organizationId !== null && $this->organizationBytes($organizationId) - $replacedBytes + array_sum(array_map(fn ($file) => $file->getSize(), $files)) > $settings->max_organization_mb * 1024 * 1024) {
            throw ValidationException::withMessages([$field => ["This organization would exceed its {$settings->max_organization_mb} MB storage limit."]]);
        }
    }
}
