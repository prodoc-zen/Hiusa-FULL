<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\AcademicYear;
use App\Models\AcademicSemester;
use App\Models\ComplianceRequirementType;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use App\Services\Compliance\AccreditationStatusService;
use App\Services\Compliance\ComplianceDocumentService;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
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
 * rather than keeping a full submission history. Accreditation status is
 * computed by the shared AccreditationStatusService so this controller and
 * the SUPER_ADMIN dashboard briefing never disagree on what "accredited"
 * means.
 */
class ComplianceController extends Controller
{
    public function __construct(private readonly AccreditationStatusService $accreditation) {}

    public function requirementTypes(Request $request)
    {
        $filters = $request->validate([
            'academic_year' => ['nullable', 'string', 'max:20'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = ComplianceRequirementType::query();

        if ($request->user()->role === 'ADMIN') {
            // ADMIN only needs what it must act on: active requirements for
            // the current academic year, never past years or retired types.
            $query->where('is_active', true)->where('academic_year', $this->accreditation->currentAcademicYear())
                ->where(fn ($period) => $period->whereNull('academic_semester_id')->orWhere('academic_semester_id', AcademicSemester::active()?->id));
        } else {
            $query->when($filters['academic_year'] ?? null, fn ($q, $year) => $q->where('academic_year', $year));
        }

        return response()->json($query->orderByDesc('academic_year')->orderBy('name')->paginate($filters['per_page'] ?? 20));
    }

    public function storeRequirementType(Request $request)
    {
        $data = $request->validate([
            'academic_year' => ['required', 'string', 'max:20', ...(AcademicYear::exists() ? [Rule::exists('academic_years', 'label')] : [])],
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:3000'],
            'deadline_at' => ['required', 'date'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $activeSemester = AcademicSemester::active();
        $requirementType = ComplianceRequirementType::create([
            ...$data,
            'academic_semester_id' => $activeSemester?->academicYear->label === $data['academic_year'] ? $activeSemester?->id : null,
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
            ->whereHas('organization', fn ($organization) => $organization->student())
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
        if ($requirementType->academic_semester_id && $requirementType->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Completed semester requirements are read only.'], 409);
        }
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:3000'],
            'deadline_at' => ['sometimes', 'required', 'date'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $old = $requirementType->toArray();
        $previousDeadline = $requirementType->deadline_at;
        $requirementType->update($data);
        $requirementType->refresh();

        AuditLog::create([
            'organization_id' => null,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'compliance',
            'action' => 'requirement_type_updated',
            'record_type' => ComplianceRequirementType::class,
            'record_id' => $requirementType->id,
            'new_values' => ['before' => $old, 'after' => $requirementType->toArray()],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        if (array_key_exists('deadline_at', $data) && ! $previousDeadline->equalTo($requirementType->deadline_at)) {
            $this->notifyAdminsOfDeadlineChange($requirementType);
        }

        return response()->json($requirementType);
    }

    public function destroyRequirementType(Request $request, ComplianceRequirementType $requirementType)
    {
        $deleted = DB::transaction(function () use ($request, $requirementType) {
            $locked = ComplianceRequirementType::whereKey($requirementType->id)->lockForUpdate()->firstOrFail();
            if ($locked->submissions()->exists()) {
                return false;
            }

            $locked->delete();
            AuditLog::create([
                'organization_id' => null,
                'user_id' => $request->user()->school_id,
                'actor_role' => $request->user()->role,
                'module' => 'compliance',
                'action' => 'requirement_type_deleted',
                'record_type' => ComplianceRequirementType::class,
                'record_id' => $locked->id,
                'old_values' => $locked->toArray(),
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            return true;
        });

        if (! $deleted) {
            return response()->json(['message' => 'This requirement already has submissions. Deactivate it to preserve those records.'], 409);
        }

        return response()->noContent();
    }

    private function notifyAdminsOfDeadlineChange(ComplianceRequirementType $requirementType): void
    {
        $admins = User::where('role', 'ADMIN')
            ->where('account_status', 'active')
            ->whereHas('organization', fn ($organization) => $organization->student())
            ->get(['school_id', 'organization_id']);

        Notification::insert($admins->map(fn (User $admin) => [
            'organization_id' => $admin->organization_id,
            'user_id' => $admin->school_id,
            'notification_type' => 'general',
            'title' => 'Compliance deadline changed',
            'message' => "The deadline for \"{$requirementType->name}\" ({$requirementType->academic_year}) is now ".$requirementType->deadline_at->format('F j, Y').'.',
            'reference_type' => 'compliance_requirement_type',
            'reference_id' => $requirementType->id,
            'is_read' => false,
            'sent_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ])->all());
    }

    public function status(Request $request)
    {
        $filters = $request->validate([
            'academic_year' => ['nullable', 'string', 'max:20'],
            'organization_id' => ['nullable', 'integer', Rule::exists('organizations', 'id')->where('organization_type', 'STUDENT_ORGANIZATION')],
        ]);

        $user = $request->user();
        if ($user->role === 'ADMIN') {
            $organizations = Organization::whereKey($user->organization_id)->where('lifecycle_status', 'active')->get();
        } else {
            $scope = $this->scopedOrganizationIds($user);
            if ($scope !== null && ($filters['organization_id'] ?? null) && ! in_array((int) $filters['organization_id'], $scope, true)) {
                return response()->json(['message' => 'That organization is outside your college.'], 403);
            }
            $organizations = Organization::student()->where('lifecycle_status', 'active')
                ->when($scope !== null, fn ($q) => $q->whereIn('id', $scope))
                ->when($filters['organization_id'] ?? null, fn ($q, $id) => $q->whereKey($id))
                ->orderBy('name')
                ->get();
        }

        $academicYear = $filters['academic_year'] ?? $this->accreditation->currentAcademicYear();
        $requirementTypes = ComplianceRequirementType::where('academic_year', $academicYear)->where('is_active', true)
            ->where(fn ($period) => $period->whereNull('academic_semester_id')->orWhere('academic_semester_id', AcademicSemester::active()?->id))->get();

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
                'accreditation_status' => $this->accreditation->resolve($breakdown->pluck('status')),
                'requirements' => $breakdown->values(),
            ];
        });

        return response()->json([
            'academic_year' => $academicYear,
            'organizations' => $request->user()->role === 'ADMIN' ? $result->first() : $result->values(),
        ]);
    }

    public function submissions(Request $request)
    {
        $filters = $request->validate([
            'organization_id' => ['nullable', 'integer', Rule::exists('organizations', 'id')->where('organization_type', 'STUDENT_ORGANIZATION')],
            'status' => ['nullable', 'in:submitted,approved,returned'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = OrganizationComplianceSubmission::with([
            'organization:id,name,acronym',
            'requirementType:id,academic_year,name,deadline_at',
            'submitter:school_id,first_name,last_name',
            'reviewer:school_id,first_name,last_name',
        ]);

        $user = $request->user();
        if ($user->role === 'ADMIN') {
            $query->where('organization_id', $user->organization_id);
        } else {
            $scope = $this->scopedOrganizationIds($user);
            if ($scope !== null && ($filters['organization_id'] ?? null) && ! in_array((int) $filters['organization_id'], $scope, true)) {
                return response()->json(['message' => 'That organization is outside your college.'], 403);
            }
            $query->when($scope !== null, fn ($q) => $q->whereIn('organization_id', $scope))
                ->when($filters['organization_id'] ?? null, fn ($q, $id) => $q->where('organization_id', $id));
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
        $requirement = ComplianceRequirementType::findOrFail($data['requirement_type_id']);
        if ($requirement->academic_semester_id && $requirement->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Completed semester requirements are read only.'], 409);
        }

        $organizationId = $request->user()->organization_id;
        if (Organization::whereKey($organizationId)->value('lifecycle_status') === 'archived') {
            return response()->json(['message' => 'This organization is archived and its documents are read only.'], 409);
        }

        // The already-approved check and the create-or-update must happen
        // against the same locked read: otherwise a resubmission racing a
        // concurrent SAO approval can read "not approved yet", then
        // overwrite the row the approval just committed.
        $result = DB::transaction(function () use ($request, $data, $organizationId) {
            $existing = OrganizationComplianceSubmission::where('organization_id', $organizationId)
                ->where('requirement_type_id', $data['requirement_type_id'])
                ->lockForUpdate()
                ->first();

            if ($existing && $existing->status === 'approved') {
                return ['conflict' => true];
            }

            $isResubmission = $existing !== null;

            $file = $request->file('document');
            $path = $file->store('compliance-submissions/'.$organizationId, 'local');
            if (! $path) {
                return ['storage_failed' => true];
            }

            $attributes = [
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
            ];

            if ($existing) {
                $existing->update($attributes);
                $submission = $existing;
            } else {
                $submission = OrganizationComplianceSubmission::create([
                    'organization_id' => $organizationId,
                    'requirement_type_id' => $data['requirement_type_id'],
                    ...$attributes,
                ]);
            }

            return ['submission' => $submission, 'is_resubmission' => $isResubmission];
        });

        if (isset($result['conflict'])) {
            return response()->json(['message' => 'This requirement has already been approved and cannot be resubmitted.'], 409);
        }

        if (isset($result['storage_failed'])) {
            return response()->json(['message' => 'Unable to store the compliance document.'], 500);
        }

        $submission = $result['submission'];
        $isResubmission = $result['is_resubmission'];

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
        $data = $request->validate([
            'status' => ['required', 'in:approved,returned'],
            'remarks' => ['nullable', 'string', 'max:3000', 'required_if:status,returned'],
            'submitted_at' => ['required', 'date'],
        ]);

        // The pending check and the update must happen against the same
        // locked read: otherwise an admin's resubmission can commit a new
        // "submitted" state (and a new document) between this request's
        // route binding and its write, and this review would approve or
        // return a version the SAO never actually looked at. Requiring the
        // submitted_at the reviewer saw catches that even when the
        // resubmission lands within the same status value.
        $reviewerId = $request->user()->school_id;
        $result = DB::transaction(function () use ($submission, $data, $reviewerId) {
            $locked = OrganizationComplianceSubmission::whereKey($submission->id)->lockForUpdate()->first();

            $lifecycle = Organization::whereKey($submission->organization_id)->value('lifecycle_status');
            if ($lifecycle === 'archived') {
                return ['error' => 'archived'];
            }
            if ($lifecycle !== 'active') {
                return ['error' => 'registration'];
            }
            if (! $locked || $locked->status !== 'submitted') {
                return ['error' => 'not_pending'];
            }
            if ($locked->requirementType?->academic_semester_id && $locked->requirementType->academic_semester_id !== AcademicSemester::active()?->id) {
                return ['error' => 'historical'];
            }

            if (! $locked->submitted_at || ! $locked->submitted_at->equalTo($data['submitted_at'])) {
                return ['error' => 'stale'];
            }

            $locked->update([
                'status' => $data['status'],
                'remarks' => $data['remarks'] ?? null,
                'reviewed_by' => $reviewerId,
                'reviewed_at' => now(),
            ]);

            return ['submission' => $locked];
        });

        if (isset($result['error'])) {
            return response()->json([
                'message' => match ($result['error']) {
                    'stale' => 'This submission was resubmitted after you loaded it. Refresh and review the latest version.',
                    'historical' => 'Completed semester submissions are read only.',
                    'archived' => 'This organization is archived and its documents are read only.',
                    'registration' => 'Registration documents are reviewed through the organization review.',
                    default => 'Only a pending submission can be reviewed.',
                },
            ], 409);
        }

        $submission = $result['submission'];

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
        $scope = $this->scopedOrganizationIds($request->user());
        if ($scope !== null && ! in_array($submission->organization_id, $scope, true)) {
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

    public function documents(Request $request, ComplianceDocumentService $documents)
    {
        $filters = $request->validate([
            'organization_id' => ['nullable', 'integer'],
            'academic_semester_id' => ['nullable', 'integer', Rule::exists('academic_semesters', 'id')],
            'source' => ['nullable', Rule::in(ComplianceDocumentService::SOURCES)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $scope = $this->scopedOrganizationIds($request->user()) ?? Organization::student()->pluck('id')->all();
        $organizationId = $filters['organization_id'] ?? null;
        if ($organizationId && ! in_array((int) $organizationId, $scope, true)) {
            return response()->json(['message' => 'That organization is outside your scope.'], 403);
        }

        $rows = $documents->rows($organizationId ? [(int) $organizationId] : $scope, $filters['academic_semester_id'] ?? null, $filters['source'] ?? null);
        $perPage = $filters['per_page'] ?? 20;
        $page = LengthAwarePaginator::resolveCurrentPage();

        return response()->json(new LengthAwarePaginator($rows->forPage($page, $perPage)->values(), $rows->count(), $perPage, $page, ['path' => $request->url(), 'query' => $request->query()]));
    }

    /** Organizations the caller may read compliance for, or null when it may read every organization. */
    private function scopedOrganizationIds(User $user): ?array
    {
        return $user->role === 'SUPER_ADMIN' ? null : $user->scopedOrganizationIds();
    }
}
