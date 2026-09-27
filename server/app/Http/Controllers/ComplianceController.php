<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\ComplianceRequirementType;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * SAO organization compliance and accreditation.
 *
 * ComplianceRequirementType rows are SAO's catalog of what every organization
 * must submit for a given academic year. OrganizationComplianceSubmission is
 * one mutable row per (organization, requirement type): the first submission
 * creates it, a resubmission overwrites the same row and resets it back to
 * "submitted" - mirroring FinancialReportController's draft/resubmit pattern
 * rather than keeping a full submission history.
 */
class ComplianceController extends Controller
{
    public function requirementTypes(Request $request)
    {
        $filters = $request->validate([
            'academic_year' => ['nullable', 'string', 'max:20'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = ComplianceRequirementType::query()
            ->when($filters['academic_year'] ?? null, fn ($q, $year) => $q->where('academic_year', $year));

        return response()->json($query->orderByDesc('academic_year')->orderBy('name')->paginate($filters['per_page'] ?? 20));
    }

    public function storeRequirementType(Request $request)
    {
        $data = $request->validate([
            'academic_year' => ['required', 'string', 'max:20'],
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:3000'],
            'deadline_at' => ['required', 'date'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $requirementType = ComplianceRequirementType::create([
            ...$data,
            'is_active' => $data['is_active'] ?? true,
            'created_by' => $request->user()->school_id,
        ]);

        AuditLog::create([
            'organization_id' => null,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'compliance',
            'action' => 'requirement_type_created',
            'description' => 'SAO defined a new organization compliance requirement.',
            'record_type' => ComplianceRequirementType::class,
            'record_id' => $requirementType->id,
            'new_values' => $requirementType->toArray(),
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        $admins = User::where('role', 'ADMIN')
            ->where('account_status', 'active')
            ->whereHas('organization', fn ($organization) => $organization->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION'))
            ->get(['school_id', 'organization_id']);
        Notification::insert($admins->map(fn (User $admin) => [
            'organization_id' => $admin->organization_id,
            'user_id' => $admin->school_id,
            'notification_type' => 'general',
            'title' => 'New compliance requirement',
            'message' => "SAO added a new compliance requirement for {$requirementType->academic_year}: {$requirementType->name}. It is due ".$requirementType->deadline_at->format('F j, Y').'.',
            'reference_type' => 'compliance_requirement_type',
            'reference_id' => $requirementType->id,
            'is_read' => false,
            'sent_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ])->all());

        return response()->json($requirementType, 201);
    }

    public function updateRequirementType(Request $request, ComplianceRequirementType $requirementType)
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:3000'],
            'deadline_at' => ['sometimes', 'required', 'date'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $old = $requirementType->toArray();
        $requirementType->update($data);

        AuditLog::create([
            'organization_id' => null,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'compliance',
            'action' => 'requirement_type_updated',
            'record_type' => ComplianceRequirementType::class,
            'record_id' => $requirementType->id,
            'new_values' => ['before' => $old, 'after' => $requirementType->fresh()->toArray()],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        return response()->json($requirementType->fresh());
    }

    public function status(Request $request)
    {
        $filters = $request->validate([
            'academic_year' => ['nullable', 'string', 'max:20'],
            'organization_id' => ['nullable', 'integer', Rule::exists('organizations', 'id')->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')],
        ]);

        if ($request->user()->role === 'ADMIN') {
            $organizations = Organization::whereKey($request->user()->organization_id)->get();
        } else {
            $organizations = Organization::where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')
                ->when($filters['organization_id'] ?? null, fn ($q, $id) => $q->whereKey($id))
                ->orderBy('name')
                ->get();
        }

        $academicYear = $filters['academic_year'] ?? ComplianceRequirementType::where('is_active', true)->max('academic_year');
        $requirementTypes = ComplianceRequirementType::where('academic_year', $academicYear)->where('is_active', true)->get();

        $organizationIds = $organizations->pluck('id');
        $submissions = OrganizationComplianceSubmission::whereIn('organization_id', $organizationIds)
            ->whereIn('requirement_type_id', $requirementTypes->pluck('id'))
            ->get()
            ->groupBy('organization_id');

        $result = $organizations->map(function (Organization $organization) use ($requirementTypes, $submissions) {
            $bySubmission = ($submissions->get($organization->id) ?? collect())->keyBy('requirement_type_id');
            $breakdown = $requirementTypes->map(function (ComplianceRequirementType $type) use ($bySubmission) {
                $submission = $bySubmission->get($type->id);

                return [
                    'requirement_type_id' => $type->id,
                    'requirement_name' => $type->name,
                    'deadline_at' => $type->deadline_at,
                    'status' => $submission->status ?? 'not_submitted',
                    'submission_id' => $submission->id ?? null,
                ];
            });

            return [
                'organization_id' => $organization->id,
                'organization_name' => $organization->name,
                'accreditation_status' => $this->accreditationStatus($breakdown),
                'requirements' => $breakdown->values(),
            ];
        });

        return response()->json([
            'academic_year' => $academicYear,
            'organizations' => $request->user()->role === 'ADMIN' ? $result->first() : $result->values(),
        ]);
    }

    private function accreditationStatus($breakdown): string
    {
        if ($breakdown->isEmpty()) {
            return 'not_applicable';
        }
        if ($breakdown->contains(fn ($row) => $row['status'] === 'not_submitted')) {
            return 'incomplete';
        }
        if ($breakdown->contains(fn ($row) => $row['status'] === 'returned')) {
            return 'returned';
        }
        if ($breakdown->contains(fn ($row) => $row['status'] === 'submitted')) {
            return 'pending_review';
        }

        return 'accredited';
    }

    public function submissions(Request $request)
    {
        $filters = $request->validate([
            'organization_id' => ['nullable', 'integer', Rule::exists('organizations', 'id')->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')],
            'status' => ['nullable', 'in:submitted,approved,returned'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = OrganizationComplianceSubmission::with([
            'organization:id,name,acronym',
            'requirementType:id,academic_year,name,deadline_at',
            'submitter:school_id,first_name,last_name',
            'reviewer:school_id,first_name,last_name',
        ]);

        if ($request->user()->role === 'SUPER_ADMIN') {
            $query->when($filters['organization_id'] ?? null, fn ($q, $id) => $q->where('organization_id', $id));
        } else {
            $query->where('organization_id', $request->user()->organization_id);
        }
        $query->when($filters['status'] ?? null, fn ($q, $status) => $q->where('status', $status));

        return response()->json($query->orderByDesc('submitted_at')->paginate($filters['per_page'] ?? 20));
    }

    public function storeSubmission(Request $request)
    {
        $data = $request->validate([
            'requirement_type_id' => ['required', 'integer', Rule::exists('compliance_requirement_types', 'id')->where('is_active', true)],
            'document' => ['required', 'file', 'mimes:pdf,jpg,jpeg,png,doc,docx,xls,xlsx', 'max:10240'],
        ]);

        $organizationId = $request->user()->organization_id;
        $file = $request->file('document');
        $path = $file->store('compliance-submissions/'.$organizationId, 'local');
        if (! $path) {
            return response()->json(['message' => 'Unable to store the compliance document.'], 500);
        }

        $isResubmission = OrganizationComplianceSubmission::where('organization_id', $organizationId)
            ->where('requirement_type_id', $data['requirement_type_id'])
            ->exists();

        $submission = OrganizationComplianceSubmission::updateOrCreate(
            ['organization_id' => $organizationId, 'requirement_type_id' => $data['requirement_type_id']],
            [
                'status' => 'submitted',
                'file_path' => $path,
                'file_original_name' => $file->getClientOriginalName(),
                'mime_type' => $file->getClientMimeType(),
                'file_size' => $file->getSize(),
                'remarks' => null,
                'submitted_by' => $request->user()->school_id,
                'submitted_at' => now(),
                'reviewed_by' => null,
                'reviewed_at' => null,
            ]
        );

        AuditLog::create([
            'organization_id' => $organizationId,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'compliance',
            'action' => $isResubmission ? 'submission_resubmitted' : 'submission_submitted',
            'record_type' => OrganizationComplianceSubmission::class,
            'record_id' => $submission->id,
            'new_values' => ['requirement_type_id' => $data['requirement_type_id'], 'file_original_name' => $submission->file_original_name],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        $requirementType = $submission->requirementType()->first();
        User::where('role', 'SUPER_ADMIN')->where('account_status', 'active')->get(['school_id', 'organization_id'])
            ->each(fn (User $sao) => Notification::create([
                'organization_id' => $sao->organization_id,
                'user_id' => $sao->school_id,
                'notification_type' => 'general',
                'title' => $isResubmission ? 'Compliance document resubmitted' : 'Compliance document submitted',
                'message' => "An organization submitted \"{$requirementType?->name}\" for review.",
                'reference_type' => 'organization_compliance_submission',
                'reference_id' => $submission->id,
                'is_read' => false,
                'sent_at' => now(),
            ]));

        return response()->json($submission->load(['requirementType:id,name,academic_year']), $isResubmission ? 200 : 201);
    }

    public function reviewSubmission(Request $request, OrganizationComplianceSubmission $submission)
    {
        if ($submission->status !== 'submitted') {
            return response()->json(['message' => 'Only a pending submission can be reviewed.'], 409);
        }

        $data = $request->validate([
            'status' => ['required', 'in:approved,returned'],
            'remarks' => ['nullable', 'string', 'max:3000', 'required_if:status,returned'],
        ]);

        $submission->update([
            'status' => $data['status'],
            'remarks' => $data['remarks'] ?? null,
            'reviewed_by' => $request->user()->school_id,
            'reviewed_at' => now(),
        ]);

        AuditLog::create([
            'organization_id' => $submission->organization_id,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'compliance',
            'action' => $data['status'] === 'approved' ? 'submission_approved' : 'submission_returned',
            'record_type' => OrganizationComplianceSubmission::class,
            'record_id' => $submission->id,
            'new_values' => ['status' => $data['status'], 'remarks' => $data['remarks'] ?? null],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        $requirementType = $submission->requirementType()->first();
        User::where('organization_id', $submission->organization_id)
            ->where('role', 'ADMIN')
            ->where('account_status', 'active')
            ->get(['school_id', 'organization_id'])
            ->each(fn (User $admin) => Notification::create([
                'organization_id' => $admin->organization_id,
                'user_id' => $admin->school_id,
                'notification_type' => 'general',
                'title' => $data['status'] === 'approved' ? 'Compliance document approved' : 'Compliance document returned',
                'message' => $data['status'] === 'approved'
                    ? "SAO approved your submission for \"{$requirementType?->name}\"."
                    : "SAO returned your submission for \"{$requirementType?->name}\": ".$data['remarks'],
                'reference_type' => 'organization_compliance_submission',
                'reference_id' => $submission->id,
                'is_read' => false,
                'sent_at' => now(),
            ]));

        return response()->json($submission->fresh()->load(['requirementType:id,name,academic_year']));
    }

    public function downloadSubmission(Request $request, OrganizationComplianceSubmission $submission)
    {
        if ($request->user()->role !== 'SUPER_ADMIN' && $submission->organization_id !== $request->user()->organization_id) {
            return response()->json(['message' => 'Compliance submission not found.'], 404);
        }

        $disk = Storage::disk('local');
        if (! preg_match('#^compliance-submissions/\d+/[0-9a-zA-Z._-]+$#', $submission->file_path) || ! $disk->exists($submission->file_path)) {
            return response()->json(['message' => 'Compliance document not found.'], 404);
        }

        $path = $disk->path($submission->file_path);
        $response = response()->file($path, [
            'Content-Disposition' => 'inline; filename="compliance-'.$submission->id.'.'.pathinfo($path, PATHINFO_EXTENSION).'"',
            'X-Content-Type-Options' => 'nosniff',
        ]);
        $response->setPrivate();
        $response->setMaxAge(0);
        $response->headers->addCacheControlDirective('no-store');

        return $response;
    }
}
