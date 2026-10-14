<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\OrganizationApplicationDocument;
use App\Models\OrganizationComplianceSubmission;
use App\Models\SboPosition;
use App\Models\User;
use App\Services\PasswordResetService;
use App\Services\SubmissionStoragePolicy;
use App\Support\FilterValues;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class OrganizationApplicationController extends Controller
{
    private const NO_REQUIREMENTS = 'No registration requirements are open. The SAO must activate a semester first.';

    private function registrationRequirements(): array
    {
        $semester = AcademicSemester::active();
        $types = $semester
            ? ComplianceRequirementType::where('academic_semester_id', $semester->id)->where('is_active', true)
                ->where('category', 'organization')->orderBy('id')->get()
            : collect();

        return [$semester, $types];
    }

    public function requirements()
    {
        [$semester, $types] = $this->registrationRequirements();

        return response()->json([
            'academic_semester' => $semester ? ['id' => $semester->id, 'number' => $semester->number, 'academic_year' => $semester->academicYear->label] : null,
            'requirements' => $types->map(fn (ComplianceRequirementType $type) => [...$type->only(['id', 'name', 'description', 'deadline_at', 'template_original_name', 'template_url']), 'allowed_extensions' => $type->acceptedExtensions()])->values(),
        ]);
    }

    public function colleges()
    {
        return response()->json(College::where('is_active', true)->orderBy('name')->get(['id', 'name']));
    }

    public function store(Request $request, SubmissionStoragePolicy $storagePolicy)
    {
        [$semester, $types] = $this->registrationRequirements();
        if (! $semester || $types->isEmpty()) {
            return response()->json(['message' => self::NO_REQUIREMENTS], 422);
        }
        $request->merge(['email' => Str::lower(trim((string) $request->input('email')))]);
        $data = $request->validate([
            'college_id' => ['required', Rule::exists('colleges', 'id')->where('is_active', true)->whereNull('deleted_at')],
            'name' => ['required', 'string', 'max:255', 'unique:organizations,name'],
            'acronym' => ['required', 'string', 'max:50', 'unique:organizations,acronym'],
            'description' => ['nullable', 'string', 'max:3000'],
            'school_id' => ['required', 'integer', 'min:1', 'max:99999999'],
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            'email' => ['required', 'email', 'max:255'],
            'position_title' => ['required', 'string', 'max:100'],
            'files' => ['required', 'array:'.$types->pluck('id')->implode(',')],
            ...$types->mapWithKeys(fn (ComplianceRequirementType $type) => ["files.{$type->id}" => ['required', ...$type->uploadRules()]])->all(),
        ]);
        unset($data['files']);
        $storagePolicy->assertUpload(array_values($request->file('files', [])), field: 'files');
        $existing = User::whereKey($data['school_id'])->orWhere('email', $data['email'])->first();
        if ($existing && ($existing->school_id !== (int) $data['school_id'] || Str::lower($existing->email) !== $data['email'] || $existing->role === 'SUPER_ADMIN' || $existing->account_status !== 'active')) {
            throw ValidationException::withMessages(['email' => 'Use the school ID and email belonging to the same applicant account.']);
        }
        $stored = [];
        try {
            $application = DB::transaction(function () use ($data, $request, $semester, $types, &$stored) {
                College::whereKey($data['college_id'])->where('is_active', true)->lockForUpdate()->firstOrFail();
                abort_unless(AcademicSemester::active()?->id === $semester->id, 409, 'Registration requirements changed. Reload the form.');
                $currentIds = $this->registrationRequirements()[1]->pluck('id')->all();
                abort_unless($currentIds === $types->pluck('id')->all(), 409, 'Registration requirements changed. Reload the form.');
                OrganizationApplication::where('status', 'pending_verification')->where('created_at', '<=', now()->subDays(2))->update(['status' => 'expired']);
                if (OrganizationApplication::whereNotIn('status', ['rejected', 'approved', 'expired'])
                    ->where(fn ($q) => $q->where('name', $data['name'])->orWhere('acronym', $data['acronym']))->exists()) {
                    throw ValidationException::withMessages(['name' => 'An application for this organization is already being reviewed.']);
                }

                $application = OrganizationApplication::create([...$data, 'requires_documents' => true, 'required_documents_count' => $types->count()]);
                foreach ($types as $type) {
                    $file = $request->file("files.{$type->id}");
                    $stored[] = $path = $file->store('organization-applications/'.$application->id, 'local');
                    $application->documents()->create([
                        'requirement_type_id' => $type->id,
                        'file_path' => $path,
                        'file_original_name' => $file->getClientOriginalName(),
                        'mime_type' => $file->getClientMimeType(),
                        'file_size' => $file->getSize(),
                    ]);
                }

                return $application;
            });
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($stored);
            throw $error;
        }
        try {
            $url = URL::temporarySignedRoute('organization-applications.verify', now()->addDays(2), ['application' => $application->id]);
            $trackingUrl = $this->trackingUrl($application);
            Mail::raw("Hello {$application->first_name} {$application->last_name},\n\nVerify your HIUSA organization application using this link within 48 hours:\n{$url}\n\nYour department head will then review it for endorsement before SAO approval. Track your application here:\n{$trackingUrl}\n\nThe private tracking link expires in 30 days. You can request a new one from the HIUSA home page.", fn ($mail) => $mail->to($application->email)->subject('Verify your HIUSA organization application'));
        } catch (\Throwable $error) {
            $application->delete();
            Storage::disk('local')->delete($stored);
            report($error);

            return response()->json(['message' => 'The verification email could not be sent. Please submit again later.'], 503);
        }

        return response()->json(['message' => 'Check your email to verify the application. The link expires in 48 hours.'], 201);
    }

    public function verify(OrganizationApplication $application)
    {
        $verified = DB::transaction(function () use ($application) {
            $application = OrganizationApplication::whereKey($application->id)->lockForUpdate()->firstOrFail();
            if ($application->status !== 'pending_verification') {
                return false;
            }
            abort_unless($application->college?->is_active, 409, 'This application’s college is no longer active.');
            $application->update(['status' => 'pending_endorsement', 'email_verified_at' => now()]);
            $college = $application->college;
            User::where('role', 'DEPARTMENT_HEAD')->where('account_status', 'active')
                ->whereHas('organization', fn ($org) => $org->where('organization_type', 'COLLEGE')->where('college_id', $college->id))
                ->get()->each(fn ($user) => $this->notify($user, $application, 'Organization application awaiting endorsement'));

            return true;
        });

        if ($verified) {
            $this->sendTrackingUpdate($application->refresh(), 'Your email is verified. Your application is now with your Department Head for endorsement.');
        }

        return redirect(rtrim(config('app.frontend_url'), '/').'/register-organization?verified=1');
    }

    private function trackingUrl(OrganizationApplication $application): string
    {
        $signed = URL::temporarySignedRoute('organization-applications.track', now()->addDays(30), [
            'application' => $application->id,
        ], absolute: false);

        return rtrim(config('app.frontend_url'), '/').'/track-organization/'.$application->id.'?'.parse_url($signed, PHP_URL_QUERY);
    }

    private function sendTrackingUpdate(OrganizationApplication $application, string $update): void
    {
        try {
            $url = $this->trackingUrl($application);
            Mail::raw("Hello {$application->first_name} {$application->last_name},\n\n{$update}\n\nTrack your application here:\n{$url}\n\nThis private link expires in 30 days.",
                fn ($mail) => $mail->to($application->email)->subject('HIUSA organization application status'));
        } catch (\Throwable $error) {
            report($error);
        }
    }

    public function track(OrganizationApplication $application)
    {
        return response()->json([
            'application' => [
                'name' => $application->name,
                'college' => $application->college?->name,
                'status' => $application->status,
                'submitted_at' => $application->created_at,
                'email_verified_at' => $application->email_verified_at,
                'endorsed_at' => $application->endorsed_at,
                'reviewed_at' => $application->reviewed_at,
                'remarks' => $application->status === 'rejected' ? $application->remarks : null,
            ],
        ]);
    }

    public function requestTrackingLink(Request $request)
    {
        $data = $request->validate([
            'school_id' => ['required', 'integer', 'min:1', 'max:99999999'],
            'email' => ['required', 'email', 'max:255'],
            'organization_name' => ['required', 'string', 'max:255'],
        ]);
        $application = OrganizationApplication::where('school_id', $data['school_id'])
            ->whereRaw('LOWER(email) = ?', [Str::lower(trim($data['email']))])
            ->whereRaw('LOWER(name) = ?', [Str::lower(trim($data['organization_name']))])
            ->latest()->first();

        if ($application) {
            $this->sendTrackingUpdate($application, 'Here is the tracking link you requested.');
        }

        return response()->json(['message' => 'If those details match an application, we will email a private tracking link.']);
    }

    private function authorizeEdit(Request $request, OrganizationApplication $application): void
    {
        $token = (string) $request->query('token');
        abort_unless($application->status === 'rejected' && $application->email_verified_at
            && $application->edit_token_hash && $token !== ''
            && hash_equals($application->edit_token_hash, hash('sha256', $token)), 404);
    }

    private function editUrl(OrganizationApplication $application, string $token): string
    {
        $signed = URL::temporarySignedRoute('organization-applications.edit', now()->addDays(14), [
            'application' => $application->id, 'token' => $token,
        ], absolute: false);

        return rtrim(config('app.frontend_url'), '/').'/register-organization/edit/'.$application->id.'?'.parse_url($signed, PHP_URL_QUERY);
    }

    public function requestEditLink(Request $request)
    {
        $data = $request->validate([
            'school_id' => ['required', 'integer', 'min:1', 'max:99999999'],
            'email' => ['required', 'email', 'max:255'],
            'organization_name' => ['required', 'string', 'max:255'],
        ]);
        $email = Str::lower(trim($data['email']));
        $name = Str::lower(trim($data['organization_name']));
        $application = OrganizationApplication::where('status', 'rejected')->whereNotNull('email_verified_at')
            ->where('school_id', $data['school_id'])->whereRaw('LOWER(email) = ?', [$email])
            ->whereRaw('LOWER(name) = ?', [$name])->latest()->first();

        if ($application) {
            $token = Str::random(48);
            $application->update(['edit_token_hash' => hash('sha256', $token)]);
            try {
                $url = $this->editUrl($application, $token);
                Mail::raw("Hello {$application->first_name} {$application->last_name},\n\nOpen your rejected organization application and review the remarks here:\n{$url}\n\nThis private link expires in 14 days and stops working after you resubmit.",
                    fn ($mail) => $mail->to($application->email)->subject('HIUSA application edit link'));
            } catch (\Throwable $error) {
                report($error);
            }
        }

        return response()->json(['message' => 'If those details match a rejected application, we will email a private edit link.']);
    }

    public function edit(Request $request, OrganizationApplication $application)
    {
        $this->authorizeEdit($request, $application);
        [$semester, $types] = $this->registrationRequirements();
        $documents = $application->documents()->get()->keyBy('requirement_type_id');

        return response()->json([
            'application' => $application->only(['id', 'college_id', 'name', 'acronym', 'description', 'first_name', 'last_name', 'school_id', 'email', 'position_title', 'remarks']),
            'academic_semester' => $semester ? ['id' => $semester->id, 'number' => $semester->number, 'academic_year' => $semester->academicYear->label] : null,
            'requirements' => $types->map(function (ComplianceRequirementType $type) use ($application, $documents, $request) {
                $document = $documents->get($type->id);

                return [
                    ...$type->only(['id', 'name', 'description', 'deadline_at', 'template_original_name', 'template_url']),
                    'allowed_extensions' => $type->acceptedExtensions(),
                    'current_file' => $document ? [
                        'name' => $document->file_original_name,
                        'view_url' => Str::after(URL::temporarySignedRoute('organization-applications.edit-document', now()->addMinutes(30), [
                            'application' => $application->id, 'document' => $document->id, 'token' => $request->query('token'),
                        ], absolute: false), '/api'),
                    ] : null,
                ];
            })->values(),
        ]);
    }

    public function editDocument(Request $request, OrganizationApplication $application, OrganizationApplicationDocument $document)
    {
        $this->authorizeEdit($request, $application);
        abort_unless($document->organization_application_id === $application->id && Storage::disk('local')->exists($document->file_path), 404);

        return Storage::disk('local')->response($document->file_path, $document->file_original_name);
    }

    public function resubmit(Request $request, OrganizationApplication $application, SubmissionStoragePolicy $storagePolicy)
    {
        $this->authorizeEdit($request, $application);
        [$semester, $types] = $this->registrationRequirements();
        if (! $semester || $types->isEmpty()) {
            return response()->json(['message' => self::NO_REQUIREMENTS], 422);
        }
        $data = $request->validate([
            'college_id' => ['required', Rule::exists('colleges', 'id')->where('is_active', true)->whereNull('deleted_at')],
            'name' => ['required', 'string', 'max:255', 'unique:organizations,name'],
            'acronym' => ['required', 'string', 'max:50', 'unique:organizations,acronym'],
            'description' => ['nullable', 'string', 'max:3000'],
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
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
                $application = OrganizationApplication::whereKey($application->id)->lockForUpdate()->firstOrFail();
                $this->authorizeEdit($request, $application);
                College::whereKey($data['college_id'])->where('is_active', true)->lockForUpdate()->firstOrFail();
                abort_unless(AcademicSemester::active()?->id === $semester->id
                    && $this->registrationRequirements()[1]->pluck('id')->all() === $types->pluck('id')->all(), 409, 'Registration requirements changed. Reload the form.');
                if (OrganizationApplication::whereKeyNot($application->id)->whereNotIn('status', ['rejected', 'approved', 'expired'])
                    ->where(fn ($query) => $query->where('name', $data['name'])->orWhere('acronym', $data['acronym']))->exists()) {
                    throw ValidationException::withMessages(['name' => ['An application for this organization is already being reviewed.']]);
                }

                $currentIds = $types->pluck('id')->all();
                foreach ($application->documents()->get() as $document) {
                    if (! in_array((int) $document->requirement_type_id, $currentIds, true)) {
                        $obsolete[] = $document->file_path;
                        $document->delete();
                    }
                }
                foreach ($types as $type) {
                    $file = $request->file("files.{$type->id}");
                    $document = $application->documents()->where('requirement_type_id', $type->id)->first();
                    if (! $file) {
                        if (! $document || ! Storage::disk('local')->exists($document->file_path)) {
                            throw ValidationException::withMessages(["files.{$type->id}" => ['Upload this required document.']]);
                        }

                        continue;
                    }
                    $stored[] = $path = $file->store('organization-applications/'.$application->id, 'local');
                    abort_unless($path, 500, 'Could not save the replacement document.');
                    if ($document) {
                        $obsolete[] = $document->file_path;
                        $document->update(['file_path' => $path, 'file_original_name' => $file->getClientOriginalName(), 'mime_type' => $file->getClientMimeType(), 'file_size' => $file->getSize()]);
                    } else {
                        $application->documents()->create(['requirement_type_id' => $type->id, 'file_path' => $path, 'file_original_name' => $file->getClientOriginalName(), 'mime_type' => $file->getClientMimeType(), 'file_size' => $file->getSize()]);
                    }
                }

                $application->fill($data);
                $application->forceFill(['status' => 'pending_endorsement', 'remarks' => null, 'endorsed_by' => null, 'endorsed_at' => null, 'reviewed_by' => null, 'reviewed_at' => null, 'edit_token_hash' => null, 'requires_documents' => true, 'required_documents_count' => $types->count()])->save();
                AuditLog::create(['organization_id' => null, 'user_id' => null, 'actor_role' => 'APPLICANT', 'module' => 'organization_applications', 'action' => 'resubmitted', 'record_type' => OrganizationApplication::class, 'record_id' => $application->id, 'new_values' => ['status' => 'pending_endorsement', 'school_id' => $application->school_id], 'created_at' => now(), 'ip_address' => $request->ip()]);

                return $application;
            });
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($stored);
            throw $error;
        }
        Storage::disk('local')->delete($obsolete);
        $college = $application->college;
        User::where('role', 'DEPARTMENT_HEAD')->where('account_status', 'active')
            ->whereHas('organization', fn ($query) => $query->where('organization_type', 'COLLEGE')->where('college_id', $college->id))
            ->get()->each(fn ($user) => $this->notify($user, $application, 'Resubmitted organization application awaiting endorsement'));
        $this->sendTrackingUpdate($application, 'Your revised application is now with your Department Head for endorsement.');

        return response()->json(['message' => 'Application resubmitted for Department Head endorsement.'], 200);
    }

    private function scopeForHead($query, User $user)
    {
        if ($user->organization?->organization_type === 'COLLEGE' && $user->organization?->college_id) {
            return $query->where('college_id', $user->organization->college_id);
        }

        return $query->whereRaw('1 = 0');
    }

    public function index(Request $request)
    {
        $data = $request->validate(['status' => ['nullable', FilterValues::rule(['in:pending_endorsement,endorsed,approved,rejected'])], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $query = OrganizationApplication::with(['college:id,name', 'documents.requirementType:id,name,description'])->whereNotNull('email_verified_at');
        if ($request->user()->role === 'DEPARTMENT_HEAD') {
            $this->scopeForHead($query, $request->user());
        }
        if (! empty($data['status'])) {
            $query->whereIn('status', FilterValues::values($data['status']));
        }

        return response()->json($query->latest()->paginate($data['per_page'] ?? 10));
    }

    public function download(Request $request, OrganizationApplication $application, OrganizationApplicationDocument $document)
    {
        if ($request->user()->role === 'DEPARTMENT_HEAD' && ! $this->scopeForHead(OrganizationApplication::whereKey($application->id), $request->user())->exists()) {
            abort(404);
        }
        abort_unless($application->email_verified_at && $document->organization_application_id === $application->id, 404);
        abort_unless(Storage::disk('local')->exists($document->file_path), 404);

        return Storage::disk('local')->download($document->file_path, $document->file_original_name);
    }

    public function review(Request $request, OrganizationApplication $application, PasswordResetService $passwords)
    {
        $actor = $request->user();
        if ($actor->role === 'DEPARTMENT_HEAD' && ! $this->scopeForHead(OrganizationApplication::whereKey($application->id), $actor)->exists()) {
            abort(404);
        }
        $data = $request->validate(['action' => ['required', Rule::in($actor->role === 'DEPARTMENT_HEAD' ? ['endorse', 'reject'] : ['approve', 'reject'])], 'remarks' => ['nullable', 'string', 'max:2000', 'required_if:action,reject']]);
        $newUser = false;
        $editToken = null;
        $copied = [];
        try {
            $admin = DB::transaction(function () use ($application, $data, $actor, &$newUser, &$editToken, &$copied) {
                $application = OrganizationApplication::whereKey($application->id)->lockForUpdate()->firstOrFail();
                if ($actor->role === 'DEPARTMENT_HEAD' && ! $this->scopeForHead(OrganizationApplication::whereKey($application->id), $actor)->exists()) {
                    abort(404);
                }
                $expected = $actor->role === 'DEPARTMENT_HEAD' ? 'pending_endorsement' : 'endorsed';
                abort_if($application->status !== $expected, 409, 'This application is not awaiting your review. Refresh the queue.');
                abort_unless($application->email_verified_at, 409, 'The applicant must verify their email before review.');
                $documents = $application->documents()->get();
                if ($application->requires_documents && $data['action'] !== 'reject') {
                    abort_if($documents->count() !== $application->required_documents_count || $documents->contains(fn ($document) => ! Storage::disk('local')->exists($document->file_path)), 409, 'Required application documents are missing.');
                }
                $college = College::whereKey($application->college_id)->where('is_active', true)->lockForUpdate()->first();
                abort_unless($college, 409, 'The college is no longer active.');
                $admin = null;
                if ($data['action'] === 'approve') {
                    abort_if(Organization::where('name', $application->name)->orWhere('acronym', $application->acronym)->exists(), 409, 'This organization is already registered.');
                    $organization = Organization::create(['name' => $application->name, 'slug' => Str::slug($application->name).'-'.Str::lower(Str::random(6)), 'acronym' => $application->acronym, 'college_id' => $college->id, 'college' => $college->name, 'parent_organization_id' => $college->homeOrganization?->id, 'description' => $application->description, 'organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active', 'is_active' => true, 'submitted_at' => $application->created_at, 'reviewed_by' => $actor->school_id, 'reviewed_at' => now()]);
                    $admin = User::whereKey($application->school_id)->lockForUpdate()->first();
                    abort_if($admin && (Str::lower($admin->email) !== $application->email || $admin->role === 'SUPER_ADMIN' || $admin->account_status !== 'active'), 409, 'The applicant account has changed or is inactive.');
                    SboPosition::firstOrCreate(['organization_id' => $organization->id, 'role' => 'ADMIN', 'title' => $application->position_title], ['is_active' => true]);
                    if ($admin) {
                        AccountProfile::create(['user_school_id' => $admin->school_id, 'organization_id' => $organization->id, 'role' => 'ADMIN', 'account_status' => 'active', 'position_title' => $application->position_title]);
                    } else {
                        abort_if(User::where('email', $application->email)->exists(), 409, 'The applicant email is already assigned to another school ID.');
                        $admin = User::create(['school_id' => $application->school_id, 'organization_id' => $organization->id, 'first_name' => $application->first_name, 'last_name' => $application->last_name, 'email' => $application->email, 'position_title' => $application->position_title, 'department' => $college->name, 'role' => 'ADMIN', 'account_status' => 'active', 'is_member' => true, 'password_hash' => Str::random(64)]);
                        $newUser = true;
                    }
                    $organization->update(['submitted_by' => $admin->school_id]);
                    foreach ($documents as $document) {
                        $path = 'compliance-submissions/'.$organization->id.'/'.Str::random(40).'.pdf';
                        abort_unless(Storage::disk('local')->copy($document->file_path, $path), 500, 'Could not save the compliance document.');
                        $copied[] = $path;
                        OrganizationComplianceSubmission::create([
                            'organization_id' => $organization->id,
                            'requirement_type_id' => $document->requirement_type_id,
                            'status' => 'submitted',
                            'file_path' => $path,
                            'file_original_name' => $document->file_original_name,
                            'mime_type' => $document->mime_type,
                            'file_size' => $document->file_size,
                            'is_registration_document' => true,
                            'submitted_by' => $admin->school_id,
                            'submitted_at' => now(),
                        ]);
                    }
                    $application->organization_id = $organization->id;
                }
                $application->status = match ($data['action']) {
                    'endorse' => 'endorsed', 'approve' => 'approved', default => 'rejected'
                };
                $application->remarks = $data['remarks'] ?? null;
                if ($data['action'] === 'reject') {
                    $editToken = Str::random(48);
                    $application->edit_token_hash = hash('sha256', $editToken);
                }
                if ($data['action'] === 'endorse') {
                    $application->endorsed_by = $actor->school_id;
                    $application->endorsed_at = now();
                    User::where('role', 'SUPER_ADMIN')->where('account_status', 'active')->get()->each(fn ($user) => $this->notify($user, $application, 'Endorsed organization application for SAO review'));
                } else {
                    $application->reviewed_by = $actor->school_id;
                    $application->reviewed_at = now();
                }
                $application->save();
                AuditLog::create(['organization_id' => $actor->organization_id, 'user_id' => $actor->school_id, 'actor_role' => $actor->role, 'module' => 'organization_applications', 'action' => $application->status, 'record_type' => OrganizationApplication::class, 'record_id' => $application->id, 'new_values' => ['status' => $application->status], 'created_at' => now(), 'ip_address' => request()->ip()]);

                return $admin;
            });
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($copied);
            throw $error;
        }
        $application->refresh();
        try {
            if ($newUser) {
                $passwords->issue($admin);
            }
            $editInstructions = '';
            if ($editToken) {
                $editUrl = $this->editUrl($application, $editToken);
                $editInstructions = "\n\nReview the remarks, edit your application, and resubmit it here:\n{$editUrl}\nThis private link expires in 14 days and stops working after you resubmit.";
            }
            $trackingInstructions = "\n\nTrack your application here:\n".$this->trackingUrl($application)."\nThis private link expires in 30 days.";
            Mail::raw("Hello {$application->first_name} {$application->last_name},\n\nYour application for {$application->name} is now {$application->status}.\n".($application->remarks ?: '').$editInstructions.$trackingInstructions.($admin ? "\nYou are the organization's first administrator. Sign in at ".rtrim(config('app.frontend_url'), '/').'/login'.($newUser ? '. A separate email contains your password setup link.' : ' using your existing account.') : ''), fn ($mail) => $mail->to($application->email)->subject('HIUSA organization application update'));
            $application->setAttribute('email_sent', true);
        } catch (\Throwable $error) {
            report($error);
            $application->setAttribute('email_sent', false);
        }

        return response()->json($application);
    }

    private function notify(User $user, OrganizationApplication $application, string $title): void
    {
        Notification::create(['organization_id' => $user->organization_id, 'user_id' => $user->school_id, 'notification_type' => 'general', 'title' => $title, 'message' => $application->name, 'reference_type' => 'organization_application', 'reference_id' => $application->id, 'is_read' => false, 'sent_at' => now()]);
    }
}
