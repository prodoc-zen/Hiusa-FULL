<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\ComplianceRequirementType;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationApplicationDocument;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use App\Services\Compliance\AccreditationStatusService;
use App\Services\Compliance\ComplianceDocumentService;
use App\Services\SubmissionStoragePolicy;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

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
            'allowed_extensions' => ['sometimes', 'required', 'array', 'min:1'],
            'allowed_extensions.*' => ['required', 'string', 'distinct', Rule::in(ComplianceRequirementType::SUPPORTED_EXTENSIONS)],
            'deadline_at' => ['required', 'date'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $activeSemester = AcademicSemester::active();
        $requirementType = ComplianceRequirementType::create([
            ...$data,
            'allowed_extensions' => $data['allowed_extensions'] ?? ['pdf'],
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
            'allowed_extensions' => ['sometimes', 'required', 'array', 'min:1'],
            'allowed_extensions.*' => ['required', 'string', 'distinct', Rule::in(ComplianceRequirementType::SUPPORTED_EXTENSIONS)],
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
        $templatePath = $requirementType->template_path;
        $deleted = DB::transaction(function () use ($request, $requirementType) {
            $locked = ComplianceRequirementType::whereKey($requirementType->id)->lockForUpdate()->firstOrFail();
            if ($locked->submissions()->exists() || OrganizationApplicationDocument::where('requirement_type_id', $locked->id)->exists()) {
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
            return response()->json(['message' => 'This requirement has submitted or application documents. Deactivate it to preserve those records.'], 409);
        }

        if ($templatePath) {
            Storage::disk('local')->delete($templatePath);
        }

        return response()->noContent();
    }

    public function uploadRequirementTemplate(Request $request, ComplianceRequirementType $requirementType)
    {
        if ($requirementType->academic_semester_id && $requirementType->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Completed semester requirements are read only.'], 409);
        }
        $extensions = implode(',', ComplianceRequirementType::SUPPORTED_EXTENSIONS);
        $request->validate(['template' => ['required', 'file', 'mimes:'.$extensions, 'extensions:'.$extensions, 'max:10240']]);

        $file = $request->file('template');
        $path = $file->store('compliance-requirement-templates/'.$requirementType->id, 'local');
        if (! $path) {
            return response()->json(['message' => 'Could not save the sample file.'], 500);
        }
        $previousPath = $requirementType->template_path;
        try {
            $requirementType->update([
                'template_path' => $path,
                'template_original_name' => mb_substr($file->getClientOriginalName(), 0, 255),
                'template_url' => null,
            ]);
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($path);
            throw $error;
        }
        if ($previousPath) {
            Storage::disk('local')->delete($previousPath);
        }

        return response()->json($requirementType->fresh());
    }

    public function setRequirementTemplateLink(Request $request, ComplianceRequirementType $requirementType)
    {
        if ($requirementType->academic_semester_id && $requirementType->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Completed semester requirements are read only.'], 409);
        }
        $data = $request->validate(['template_url' => ['required', 'string', 'max:2048', 'url:http,https']]);
        $previousPath = $requirementType->template_path;
        $requirementType->update(['template_url' => $data['template_url'], 'template_path' => null, 'template_original_name' => null]);
        if ($previousPath) {
            Storage::disk('local')->delete($previousPath);
        }

        return response()->json($requirementType->fresh());
    }

    public function removeRequirementTemplate(ComplianceRequirementType $requirementType)
    {
        if ($requirementType->academic_semester_id && $requirementType->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Completed semester requirements are read only.'], 409);
        }
        $path = $requirementType->template_path;
        $requirementType->update(['template_path' => null, 'template_original_name' => null, 'template_url' => null]);
        if ($path) {
            Storage::disk('local')->delete($path);
        }

        return response()->json($requirementType->fresh());
    }

    public function publicRequirementTemplate(ComplianceRequirementType $requirementType)
    {
        $semester = AcademicSemester::active();
        if (! $semester || ! $requirementType->is_active || $requirementType->academic_semester_id !== $semester->id
            || $requirementType->name === ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT) {
            abort(404);
        }

        return $this->serveRequirementTemplate($requirementType);
    }

    public function requirementTemplate(Request $request, ComplianceRequirementType $requirementType)
    {
        if ($request->user()->role !== 'SUPER_ADMIN'
            && (! $requirementType->is_active || $requirementType->academic_year !== $this->accreditation->currentAcademicYear()
                || ($requirementType->academic_semester_id && $requirementType->academic_semester_id !== AcademicSemester::active()?->id))) {
            abort(404);
        }

        return $this->serveRequirementTemplate($requirementType);
    }

    private function serveRequirementTemplate(ComplianceRequirementType $requirementType)
    {
        $disk = Storage::disk('local');
        if (! $requirementType->template_path || ! $disk->exists($requirementType->template_path)) {
            abort(404);
        }
        $extension = strtolower(pathinfo($requirementType->template_original_name ?: '', PATHINFO_EXTENSION));
        $contentType = match ($extension) {
            'pdf' => 'application/pdf',
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            default => 'application/octet-stream',
        };
        $response = response()->file($disk->path($requirementType->template_path), ['Content-Type' => $contentType, 'X-Content-Type-Options' => 'nosniff']);
        $response->setContentDisposition(in_array($extension, ['pdf', 'jpg', 'jpeg', 'png'], true) ? 'inline' : 'attachment',
            $requirementType->template_original_name ?: 'sample-'.$requirementType->id, 'sample-'.$requirementType->id.'.'.$extension);
        $response->setPrivate();
        $response->headers->addCacheControlDirective('no-store');

        return $response;
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
                    'file_name' => $submission->file_original_name ?? null,
                    'submitted_at' => $submission->submitted_at ?? null,
                    'remarks' => $submission->remarks ?? null,
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

    public function submissions(Request $request, ComplianceDocumentService $documents)
    {
        $filters = $request->validate([
            'organization_id' => ['nullable', 'integer', Rule::exists('organizations', 'id')->where('organization_type', 'STUDENT_ORGANIZATION')],
            'status' => ['nullable', 'in:submitted,approved,returned'],
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = OrganizationComplianceSubmission::with([
            'organization:id,name,acronym,lifecycle_status,submitted_at,reviewed_at',
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
        if ($search = trim($filters['search'] ?? '')) {
            $like = '%'.addcslashes($search, '\\%_').'%';
            $query->where(fn ($match) => $match->where('file_original_name', 'like', $like)
                ->orWhereHas('requirementType', fn ($type) => $type->where('name', 'like', $like)));
        }

        $page = $query->orderByDesc('submitted_at')->orderByDesc('id')->paginate($filters['per_page'] ?? 20);
        // Registration files are decided in the organization review, so the queue marks them instead of offering a decision.
        $page->getCollection()->each(fn (OrganizationComplianceSubmission $submission) => $submission->setAttribute(
            'is_registration',
            $documents->isRegistrationFile($submission->organization, $submission->submitted_at, $submission->is_registration_document),
        ));

        return response()->json($page);
    }

    public function storeSubmission(Request $request, SubmissionStoragePolicy $storagePolicy)
    {
        $data = $request->validate([
            'requirement_type_id' => ['required', 'integer', Rule::exists('compliance_requirement_types', 'id')->where('is_active', true)],
            'document' => ['required', 'file', 'max:10240'],
        ]);
        $requirement = ComplianceRequirementType::findOrFail($data['requirement_type_id']);
        $request->validate(['document' => $requirement->uploadRules()]);
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
        $result = DB::transaction(function () use ($request, $data, $organizationId, $storagePolicy) {
            Organization::whereKey($organizationId)->lockForUpdate()->firstOrFail();
            $existing = OrganizationComplianceSubmission::where('organization_id', $organizationId)
                ->where('requirement_type_id', $data['requirement_type_id'])
                ->lockForUpdate()
                ->first();

            if ($existing && $existing->status === 'approved') {
                return ['conflict' => true];
            }

            $storagePolicy->assertUpload([$request->file('document')], $organizationId, $existing?->file_size ?? 0);

            $isResubmission = $existing !== null;
            $oldPath = $existing?->file_path;

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

            return ['submission' => $submission, 'is_resubmission' => $isResubmission, 'old_path' => $isResubmission ? $oldPath : null];
        });

        if (isset($result['conflict'])) {
            return response()->json(['message' => 'This requirement has already been approved and cannot be resubmitted.'], 409);
        }

        if (isset($result['storage_failed'])) {
            return response()->json(['message' => 'Unable to store the compliance document.'], 500);
        }

        $submission = $result['submission'];
        $isResubmission = $result['is_resubmission'];
        if ($result['old_path']) {
            Storage::disk('local')->delete($result['old_path']);
        }

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

    public function replaceSubmissionDocument(Request $request, OrganizationComplianceSubmission $submission, SubmissionStoragePolicy $storagePolicy)
    {
        abort_unless($submission->organization_id === $request->user()->organization_id, 404);
        abort_unless(Organization::whereKey($submission->organization_id)->where('lifecycle_status', 'active')->exists(), 409, 'Only active organizations can change submitted files.');
        $requirement = $submission->requirementType;
        abort_unless($requirement && $requirement->is_active && (! $requirement->academic_semester_id || $requirement->academic_semester_id === AcademicSemester::active()?->id), 409, 'This requirement is no longer open.');
        $data = $request->validate(['document' => ['required', ...$requirement->uploadRules()], 'submitted_at' => ['required', 'date']]);

        $newPath = null;
        try {
            $oldPath = DB::transaction(function () use ($submission, $request, $data, $storagePolicy, &$newPath) {
                Organization::whereKey($submission->organization_id)->lockForUpdate()->firstOrFail();
                $locked = OrganizationComplianceSubmission::whereKey($submission->id)->lockForUpdate()->firstOrFail();
                abort_unless($locked->organization_id === $request->user()->organization_id, 404);
                abort_unless($locked->submitted_at?->equalTo($data['submitted_at']), 409, 'This file changed since you opened it. Refresh the list.');
                $file = $request->file('document');
                $storagePolicy->assertUpload([$file], $locked->organization_id, $locked->file_size);
                $newPath = $file->store('compliance-submissions/'.$locked->organization_id, 'local');
                abort_unless($newPath, 500, 'Could not store the replacement file.');
                $oldPath = $locked->file_path;
                $locked->update([
                    'file_path' => $newPath, 'file_original_name' => $file->getClientOriginalName(),
                    'mime_type' => $file->getClientMimeType(), 'file_size' => $file->getSize(),
                    'status' => 'submitted', 'remarks' => null, 'submitted_at' => now(),
                    'submitted_by' => $request->user()->school_id, 'reviewed_by' => null, 'reviewed_at' => null,
                ]);

                return $oldPath;
            });
        } catch (\Throwable $exception) {
            if ($newPath) {
                Storage::disk('local')->delete($newPath);
            }
            throw $exception;
        }
        Storage::disk('local')->delete($oldPath);
        $this->notifySubmissionChange($request, $submission, 'replaced');

        return response()->json($submission->fresh()->load('requirementType:id,name'));
    }

    public function deleteSubmission(Request $request, OrganizationComplianceSubmission $submission)
    {
        if ($request->user()->role !== 'SUPER_ADMIN') {
            abort_unless($submission->organization_id === $request->user()->organization_id, 404);
        }
        abort_unless(Organization::whereKey($submission->organization_id)->where('lifecycle_status', 'active')->exists(), 409, 'Registration and archived files cannot be deleted here.');
        $data = $request->validate(['submitted_at' => ['required', 'date']]);
        $oldPath = DB::transaction(function () use ($submission, $data) {
            $locked = OrganizationComplianceSubmission::whereKey($submission->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->submitted_at?->equalTo($data['submitted_at']), 409, 'This file changed since you opened it. Refresh the list.');
            $oldPath = $locked->file_path;
            $locked->delete();

            return $oldPath;
        });
        Storage::disk('local')->delete($oldPath);
        $this->notifySubmissionChange($request, $submission, 'deleted');

        return response()->json(['message' => 'File deleted. Reviewers and organization admins were notified.']);
    }

    private function notifySubmissionChange(Request $request, OrganizationComplianceSubmission $submission, string $action): void
    {
        $organization = Organization::findOrFail($submission->organization_id);
        $requirement = $submission->requirementType?->name ?? 'a requirement';
        AuditLog::create([
            'organization_id' => $organization->id, 'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role, 'module' => 'compliance', 'action' => 'submission_document_'.$action,
            'record_type' => OrganizationComplianceSubmission::class, 'record_id' => $submission->id,
            'description' => "Document for {$requirement} {$action}.", 'ip_address' => $request->ip(), 'created_at' => now(),
        ]);
        $recipients = User::where('account_status', 'active')->where(function ($query) use ($organization) {
            $query->where('role', 'SUPER_ADMIN')
                ->orWhere(fn ($admins) => $admins->where('role', 'ADMIN')->where('organization_id', $organization->id))
                ->orWhere(fn ($heads) => $heads->where('role', 'DEPARTMENT_HEAD')->whereHas('organization', fn ($home) => $home->where('organization_type', 'COLLEGE')->where('college_id', $organization->college_id)));
        })->get(['school_id', 'organization_id']);
        foreach ($recipients as $recipient) {
            if ($recipient->school_id === $request->user()->school_id) {
                continue;
            }
            Notification::create([
                'organization_id' => $recipient->organization_id, 'user_id' => $recipient->school_id,
                'notification_type' => 'general', 'title' => 'Submitted file '.$action,
                'message' => "{$organization->name}: {$requirement} was {$action} by {$request->user()->first_name} {$request->user()->last_name}.",
                'reference_type' => 'organization_compliance_submission', 'reference_id' => $submission->id,
                'is_read' => false, 'sent_at' => now(),
            ]);
        }
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
            'family' => ['nullable', Rule::in(ComplianceDocumentService::FAMILIES)],
            'group' => ['nullable', 'in:organization'],
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $scope = $this->scopedOrganizationIds($request->user()) ?? Organization::student()->pluck('id')->all();
        $organizationId = $filters['organization_id'] ?? null;
        if ($organizationId && ! in_array((int) $organizationId, $scope, true)) {
            return response()->json(['message' => 'That organization is outside your scope.'], 403);
        }

        $organizationIds = $organizationId ? [(int) $organizationId] : $scope;
        $search = trim($filters['search'] ?? '');
        if ($search && ($filters['group'] ?? null) === 'organization') {
            $like = '%'.addcslashes($search, '\%_').'%';
            $organizationIds = Organization::whereIn('id', $organizationIds)
                ->where(fn ($match) => $match->where('name', 'like', $like)->orWhere('acronym', 'like', $like))
                ->pluck('id')->all();
        }

        $arguments = [$organizationIds, $filters['academic_semester_id'] ?? null, $filters['source'] ?? null, $request->user()->role, $filters['family'] ?? null];
        $perPage = $filters['per_page'] ?? 20;
        $page = LengthAwarePaginator::resolveCurrentPage();
        $options = ['path' => $request->url(), 'query' => $request->query()];

        if (($filters['group'] ?? null) === 'organization') {
            $summaries = $documents->organizationSummaries(...$arguments);

            return response()->json(new LengthAwarePaginator($summaries->forPage($page, $perPage)->values(), $summaries->count(), $perPage, $page, $options));
        }
        if ($page * $perPage > ComplianceDocumentService::MAX_WINDOW) {
            throw ValidationException::withMessages(['page' => 'That page is too deep to load. Narrow the list with a filter or a search.']);
        }
        [$rows, $total] = $documents->page(...$arguments, page: $page, perPage: $perPage, search: $search ?: null);

        return response()->json(new LengthAwarePaginator($rows, $total, $perPage, $page, $options));
    }

    /** Organizations the caller may read compliance for, or null when it may read every organization. */
    private function scopedOrganizationIds(User $user): ?array
    {
        return $user->role === 'SUPER_ADMIN' ? null : $user->scopedOrganizationIds();
    }
}
