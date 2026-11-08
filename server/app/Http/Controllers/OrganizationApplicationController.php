<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Notification;
use App\Models\OrganizationApplicantGrant;
use App\Models\OrganizationApplication;
use App\Models\OrganizationApplicationDocument;
use App\Models\OrganizationApplicationReviewFile;
use App\Models\User;
use App\Services\OrganizationApplicationPresenter;
use App\Services\SubmissionStoragePolicy;
use App\Support\NotFound;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * The applicant's side of the one organization pipeline. A student the dean allowed to apply
 * submits from their own signed-in account: identity and college come from the account and the
 * grant, never from the request. The dean and the SAO review through OrganizationApplicationReviewController.
 */
class OrganizationApplicationController extends Controller
{
    private const NO_REQUIREMENTS = 'Applications are closed. The SAO must activate a semester and publish its requirements first.';

    private const PREFIX = '/my/organization-applications';

    public function __construct(private readonly OrganizationApplicationPresenter $presenter) {}

    private function applicationSemester(Request $request): ?AcademicSemester
    {
        return AcademicSemester::selected($request);
    }

    private function registrationRequirements(Request $request): array
    {
        $semester = $this->applicationSemester($request);
        $types = $semester
            ? ComplianceRequirementType::where('academic_semester_id', $semester->id)->where('is_active', true)
                ->where('category', 'organization')->orderBy('id')->get()
            : collect();

        return [$semester, $types];
    }

    private function semesterPayload(?AcademicSemester $semester): ?array
    {
        return $semester ? ['id' => $semester->id, 'number' => $semester->number, 'academic_year' => $semester->academicYear->label] : null;
    }

    private function requirementPayload($types)
    {
        return $types->map(fn (ComplianceRequirementType $type) => [...$type->only(['id', 'name', 'description', 'deadline_at', 'template_original_name', 'template_url']), 'allowed_extensions' => $type->acceptedExtensions()])->values();
    }

    public function mine(Request $request)
    {
        $user = $request->user();
        $grant = OrganizationApplicantGrant::open()->where('user_school_id', $user->school_id)->with('college:id,name')->orderBy('id')->first();
        [$semester, $types] = $grant ? $this->registrationRequirements($request) : [null, collect()];
        $applications = OrganizationApplication::where('school_id', $user->school_id)->whereNotIn('status', OrganizationApplication::LEGACY_UNQUEUED)
            ->with('college:id,name')->latest('id')->get();

        return response()->json([
            'can_apply' => $grant !== null,
            'college' => $grant?->college?->only(['id', 'name']),
            'academic_semester' => $this->semesterPayload($semester),
            'requirements' => $this->requirementPayload($types),
            'applications' => $applications->map(fn (OrganizationApplication $application) => $this->presenter->brief($application))->values(),
        ]);
    }

    public function store(Request $request, SubmissionStoragePolicy $storagePolicy)
    {
        $user = $request->user();
        abort_unless(OrganizationApplicantGrant::open()->where('user_school_id', $user->school_id)->exists(), 403, 'Ask your Department Head to allow you to apply.');
        [$semester, $types] = $this->registrationRequirements($request);
        if (! $semester || $types->isEmpty()) {
            return response()->json(['message' => self::NO_REQUIREMENTS], 422);
        }
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:organizations,name'],
            'acronym' => ['required', 'string', 'max:50', 'unique:organizations,acronym'],
            'description' => ['nullable', 'string', 'max:3000'],
            'position_title' => ['required', 'string', 'max:100'],
            'files' => ['required', 'array:'.$types->pluck('id')->implode(',')],
            ...$types->mapWithKeys(fn (ComplianceRequirementType $type) => ["files.{$type->id}" => ['required', ...$type->uploadRules()]])->all(),
        ]);
        unset($data['files']);
        $storagePolicy->assertUpload(array_values($request->file('files', [])), field: 'files');

        $stored = [];
        try {
            $application = DB::transaction(function () use ($data, $request, $user, $semester, $types, &$stored) {
                $grant = OrganizationApplicantGrant::open()->where('user_school_id', $user->school_id)->orderBy('id')->lockForUpdate()->first();
                abort_unless($grant, 403, 'Ask your Department Head to allow you to apply.');
                College::whereKey($grant->college_id)->where('is_active', true)->lockForUpdate()->firstOrFail();
                abort_unless($this->applicationSemester($request)?->id === $semester->id
                    && $this->registrationRequirements($request)[1]->pluck('id')->all() === $types->pluck('id')->all(), 409, 'The requirements changed. Reload the page.');
                $this->assertNameFree($data);

                $application = OrganizationApplication::create([
                    ...$data,
                    'college_id' => $grant->college_id,
                    'school_id' => $user->school_id,
                    'first_name' => $user->first_name,
                    'last_name' => $user->last_name,
                    'email' => $user->email,
                    'status' => 'pending_dean',
                    'round' => 1,
                    'submitted_at' => now(),
                    'requires_documents' => true,
                    'required_documents_count' => $types->count(),
                ]);
                foreach ($types as $type) {
                    $this->storeDocument($application, $type, $request->file("files.{$type->id}"), $stored);
                }
                $grant->update(['used_application_id' => $application->id]);
                $this->audit($request, 'submitted', $application, ['status' => 'pending_dean', 'college_id' => $grant->college_id]);

                return $application;
            });
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($stored);
            throw $error;
        }
        $this->notifyDeans($application, 'Organization application awaiting your review');

        return response()->json($this->presenter->detail($application->refresh(), self::PREFIX, true), 201);
    }

    public function show(Request $request, OrganizationApplication $application)
    {
        $this->authorizeOwner($request, $application);
        $extra = $application->status === 'returned' ? $this->registrationRequirements($request)[1] : null;

        return response()->json($this->presenter->detail($application, self::PREFIX, true, $extra));
    }

    public function resubmit(Request $request, OrganizationApplication $application, SubmissionStoragePolicy $storagePolicy)
    {
        $this->authorizeOwner($request, $application);
        abort_unless($application->status === 'returned', 409, 'Only a returned application can be sent again.');
        [$semester, $types] = $this->registrationRequirements($request);
        if (! $semester || $types->isEmpty()) {
            return response()->json(['message' => self::NO_REQUIREMENTS], 422);
        }
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:organizations,name'],
            'acronym' => ['required', 'string', 'max:50', 'unique:organizations,acronym'],
            'description' => ['nullable', 'string', 'max:3000'],
            'position_title' => ['required', 'string', 'max:100'],
            'files' => ['sometimes', 'array:'.$types->pluck('id')->implode(',')],
            ...$types->mapWithKeys(fn (ComplianceRequirementType $type) => ["files.{$type->id}" => ['sometimes', ...$type->uploadRules()]])->all(),
        ]);
        unset($data['files']);
        $storagePolicy->assertUpload(array_values($request->file('files', [])), field: 'files');

        $stored = [];
        $obsolete = [];
        try {
            $application = DB::transaction(function () use ($application, $data, $request, $semester, $types, &$stored, &$obsolete) {
                $locked = OrganizationApplication::whereKey($application->id)->lockForUpdate()->firstOrFail();
                abort_unless($locked->status === 'returned', 409, 'Only a returned application can be sent again.');
                College::whereKey($locked->college_id)->where('is_active', true)->lockForUpdate()->firstOrFail();
                abort_unless($this->applicationSemester($request)?->id === $semester->id
                    && $this->registrationRequirements($request)[1]->pluck('id')->all() === $types->pluck('id')->all(), 409, 'The requirements changed. Reload the page.');
                $this->assertNameFree($data, $locked->id);

                $currentIds = $types->pluck('id')->all();
                $documents = $locked->documents()->lockForUpdate()->get()->keyBy('requirement_type_id');
                foreach ($documents as $document) {
                    if (! in_array((int) $document->requirement_type_id, $currentIds, true)) {
                        $obsolete[] = $document->file_path;
                        $document->delete();
                    }
                }
                foreach ($types as $type) {
                    $file = $request->file("files.{$type->id}");
                    $document = $documents->get($type->id);
                    if (! $file) {
                        if (! $document || ! Storage::disk('local')->exists($document->file_path)) {
                            throw ValidationException::withMessages(["files.{$type->id}" => ['Upload this document.']]);
                        }

                        continue;
                    }
                    if ($document) {
                        $obsolete[] = $document->file_path;
                        $document->delete();
                    }
                    $this->storeDocument($locked, $type, $file, $stored);
                }

                $locked->fill($data);
                $locked->forceFill([
                    'status' => 'pending_dean', 'round' => $locked->round + 1, 'submitted_at' => now(),
                    'remarks' => null, 'endorsement_note' => null, 'endorsed_by' => null, 'endorsed_at' => null,
                    'returned_by' => null, 'returned_by_role' => null, 'returned_at' => null, 'reviewed_by' => null, 'reviewed_at' => null,
                    'requires_documents' => true, 'required_documents_count' => $types->count(),
                ])->save();
                $this->audit($request, 'resubmitted', $locked, ['status' => 'pending_dean', 'round' => $locked->round]);

                return $locked;
            });
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($stored);
            throw $error;
        }
        Storage::disk('local')->delete($obsolete);
        $this->notifyDeans($application, 'Resubmitted organization application awaiting your review');

        return response()->json($this->presenter->detail($application->refresh(), self::PREFIX, true));
    }

    public function document(Request $request, OrganizationApplication $application, OrganizationApplicationDocument $document)
    {
        $this->authorizeOwner($request, $application);
        NotFound::unless($document->organization_application_id === $application->id && Storage::disk('local')->exists($document->file_path));

        return Storage::disk('local')->response($document->file_path, $document->file_original_name);
    }

    public function reviewFile(Request $request, OrganizationApplication $application, OrganizationApplicationReviewFile $file)
    {
        $this->authorizeOwner($request, $application);
        NotFound::unless($file->organization_application_id === $application->id && $this->presenter->stageVisible($application, $file->stage) && Storage::disk('local')->exists($file->file_path));

        return Storage::disk('local')->response($file->file_path, $file->file_original_name);
    }

    private function authorizeOwner(Request $request, OrganizationApplication $application): void
    {
        NotFound::unless($application->school_id === $request->user()->school_id && ! in_array($application->status, OrganizationApplication::LEGACY_UNQUEUED, true));
    }

    private function assertNameFree(array $data, ?int $ignoreApplicationId = null): void
    {
        $taken = OrganizationApplication::whereNotIn('status', ['rejected', 'approved', ...OrganizationApplication::LEGACY_UNQUEUED])
            ->when($ignoreApplicationId, fn ($query) => $query->whereKeyNot($ignoreApplicationId))
            ->where(fn ($query) => $query->where('name', $data['name'])->orWhere('acronym', $data['acronym']))->exists();
        if ($taken) {
            throw ValidationException::withMessages(['name' => 'An application for this organization is already being reviewed.']);
        }
    }

    private function storeDocument(OrganizationApplication $application, ComplianceRequirementType $type, $file, array &$stored): void
    {
        $stored[] = $path = $file->store('organization-applications/'.$application->id, 'local');
        abort_unless($path, 500, 'Could not save the document. Try again.');
        $application->documents()->create([
            'requirement_type_id' => $type->id,
            'file_path' => $path,
            'file_original_name' => $file->getClientOriginalName(),
            'mime_type' => $file->getClientMimeType(),
            'file_size' => $file->getSize(),
        ]);
    }

    private function notifyDeans(OrganizationApplication $application, string $title): void
    {
        User::where('role', 'DEPARTMENT_HEAD')->where('account_status', 'active')
            ->whereHas('organization', fn ($organization) => $organization->where('organization_type', 'COLLEGE')->where('college_id', $application->college_id))
            ->get()->each(fn (User $dean) => Notification::create([
                'organization_id' => $dean->organization_id, 'user_id' => $dean->school_id, 'notification_type' => 'general', 'title' => $title,
                'message' => $application->name, 'reference_type' => 'organization_application', 'reference_id' => $application->id, 'is_read' => false, 'sent_at' => now(),
            ]));
    }

    private function audit(Request $request, string $action, OrganizationApplication $application, array $values): void
    {
        AuditLog::create(['organization_id' => null, 'user_id' => $request->user()->school_id, 'actor_role' => 'APPLICANT', 'module' => 'organization_applications', 'action' => $action, 'record_type' => OrganizationApplication::class, 'record_id' => $application->id, 'new_values' => $values, 'created_at' => now(), 'ip_address' => $request->ip()]);
    }
}
