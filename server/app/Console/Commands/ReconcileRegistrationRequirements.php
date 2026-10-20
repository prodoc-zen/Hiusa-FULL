<?php

namespace App\Console\Commands;

use App\Models\AcademicSemester;
use App\Models\AuditLog;
use App\Models\ComplianceRequirementType;
use App\Models\OrganizationApplication;
use App\Models\OrganizationComplianceSubmission;
use App\Services\Compliance\RegistrationRequirementCatalog;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

class ReconcileRegistrationRequirements extends Command
{
    protected $signature = 'hiusa:reconcile-registration-requirements {--apply : Apply the audited reconciliation; otherwise report only}';

    protected $description = 'Reconcile approved application files and duplicate current registration requirements without deleting uploads';

    public function handle(): int
    {
        $summary = DB::transaction(function () {
            $semester = AcademicSemester::where('status', 'active')->lockForUpdate()->first();
            if (! $semester) {
                throw new RuntimeException('An active semester is required.');
            }
            $types = ComplianceRequirementType::where('academic_year', $semester->academicYear->label)->where('category', 'organization')
                ->where(fn ($period) => $period->whereNull('academic_semester_id')->orWhere('academic_semester_id', $semester->id))
                ->orderByDesc('academic_semester_id')->orderBy('id')->lockForUpdate()->get();
            $canonical = collect(RegistrationRequirementCatalog::NAMES)->mapWithKeys(function ($name) use ($types) {
                $type = $types->first(fn ($type) => $type->name === $name && $type->is_active);
                if (! $type) {
                    throw new RuntimeException('Publish the canonical requirement before reconciliation: '.$name);
                }

                return [$name => $type];
            });
            $retired = $types->where('is_active', true)->whereNotIn('id', $canonical->pluck('id'))->pluck('id');
            $rows = OrganizationComplianceSubmission::with('organization')->whereIn('requirement_type_id', $types->pluck('id'))->lockForUpdate()->get();
            $applications = OrganizationApplication::with('documents')->where('status', 'approved')->whereIn('organization_id', $rows->pluck('organization_id'))->get()->keyBy('organization_id');
            $approvals = [];
            $unverified = 0;
            foreach ($rows as $row) {
                if ($row->status !== 'submitted' || ! $row->is_registration_document || ! in_array($row->organization?->lifecycle_status, ['active', 'archived'], true)) {
                    continue;
                }
                $application = $applications->get($row->organization_id);
                $document = $application?->documents->firstWhere('requirement_type_id', $row->requirement_type_id);
                if (! $application?->reviewed_by || ! $application->reviewed_at || ! $row->submitted_at || $row->submitted_at->greaterThan($application->reviewed_at)
                    || ! $document || ! Storage::disk('local')->exists($document->file_path) || ! Storage::disk('local')->exists($row->file_path)
                    || ! hash_equals(hash_file('sha256', Storage::disk('local')->path($document->file_path)), hash_file('sha256', Storage::disk('local')->path($row->file_path)))) {
                    $unverified++;

                    continue;
                }
                $approvals[$row->id] = ['status' => 'approved', 'reviewed_by' => $application->reviewed_by, 'reviewed_at' => $application->reviewed_at];
            }
            $seen = $rows->mapWithKeys(fn ($row) => [$row->organization_id.':'.$row->requirement_type_id => true])->all();
            $links = [];
            foreach ($types->whereIn('id', $retired) as $legacy) {
                $target = $canonical->get(RegistrationRequirementCatalog::canonicalName($legacy->name));
                if (! $target) {
                    continue;
                }
                foreach ($rows->where('requirement_type_id', $legacy->id) as $row) {
                    $key = $row->organization_id.':'.$target->id;
                    if (isset($seen[$key]) || ! Storage::disk('local')->exists($row->file_path)) {
                        continue;
                    }
                    $links[$row->id] = $target->id;
                    $seen[$key] = true;
                }
            }
            $summary = ['approved_registration_files' => count($approvals), 'linked_existing_files' => count($links), 'retired_requirement_ids' => $retired->values()->all(), 'files_needing_manual_review' => $unverified];
            if ($this->option('apply')) {
                foreach ($approvals as $id => $values) {
                    OrganizationComplianceSubmission::whereKey($id)->update($values);
                }
                foreach ($links as $id => $requirementId) {
                    OrganizationComplianceSubmission::whereKey($id)->update(['requirement_type_id' => $requirementId]);
                }
                ComplianceRequirementType::whereIn('id', $retired)->update(['is_active' => false]);
                if ($approvals || $links || $retired->isNotEmpty()) {
                    AuditLog::create(['module' => 'compliance', 'action' => 'registration_requirements_reconciled', 'description' => 'Reconciled existing files with recorded SAO application approvals and the current registration catalog.', 'new_values' => [...$summary, 'approved_submission_ids' => array_keys($approvals), 'submission_requirement_links' => $links], 'created_at' => now()]);
                }
            }

            return $summary;
        }, 3);
        $this->line(($this->option('apply') ? 'APPLIED ' : 'DRY RUN ').json_encode($summary, JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
