<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\OrganizationApplicationDocument;
use App\Models\OrganizationApplicationRequirementReview;
use App\Models\OrganizationApplicationReviewFile;
use App\Models\OrganizationComplianceSubmission;
use App\Models\SboPosition;
use App\Models\User;
use App\Services\OrganizationApplicationPresenter;
use App\Services\SubmissionStoragePolicy;
use App\Support\FilterValues;
use App\Support\NotFound;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The review queue. The Department Head acts on applications from their own college while they
 * are pending_dean, the SAO on those pending_sao. Either may return an application with a note
 * per requirement and attached files; only the SAO approves or rejects. Either may also leave a
 * note that changes nothing about the application. Notes and decisions read back as one history,
 * for reviewers only: the applicant's own page never carries it.
 */
class OrganizationApplicationReviewController extends Controller
{
    private const PREFIX = '/organization-applications';

    private const MAX_REVIEW_FILES = 10;

    /** The word the history uses for each status a decision leaves behind. */
    private const DECISION_LABEL = ['pending_sao' => 'Endorsed', 'approved' => 'Approved', 'returned' => 'Returned', 'rejected' => 'Not approved'];

    public function __construct(private readonly OrganizationApplicationPresenter $presenter) {}

    public function index(Request $request)
    {
        $data = $request->validate([
            'status' => ['nullable', FilterValues::rule(['in:'.implode(',', OrganizationApplication::STATUSES)])],
            'search' => ['nullable', 'string', 'max:120'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $scoped = $this->scoped($request->user());
        $counts = (clone $scoped)->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');

        $query = $scoped->with(['college:id,name', 'applicant:school_id,first_name,last_name,email']);
        if (! empty($data['status'])) {
            $query->whereIn('status', FilterValues::values($data['status']));
        }
        if (! empty($data['search'])) {
            $term = trim($data['search']);
            $query->where(fn ($sub) => $sub->where('name', 'like', "%{$term}%")->orWhere('acronym', 'like', "%{$term}%")
                ->orWhere('first_name', 'like', "%{$term}%")->orWhere('last_name', 'like', "%{$term}%"));
        }
        $page = $query->latest('submitted_at')->latest('id')->paginate($data['per_page'] ?? 10);
        $page->getCollection()->transform(fn (OrganizationApplication $application) => $this->presenter->brief($application));

        return response()->json([...$page->toArray(), 'counts' => collect(OrganizationApplication::STATUSES)->mapWithKeys(fn ($status) => [$status => (int) ($counts[$status] ?? 0)])]);
    }

    public function show(Request $request, OrganizationApplication $application)
    {
        $this->authorizeScope($request->user(), $application);

        return response()->json($this->detail($application));
    }

    public function document(Request $request, OrganizationApplication $application, OrganizationApplicationDocument $document)
    {
        $this->authorizeScope($request->user(), $application);
        NotFound::unless($document->organization_application_id === $application->id && Storage::disk('local')->exists($document->file_path));

        return Storage::disk('local')->response($document->file_path, $document->file_original_name);
    }

    public function openFile(Request $request, OrganizationApplication $application, OrganizationApplicationReviewFile $file)
    {
        $this->authorizeScope($request->user(), $application);
        NotFound::unless($file->organization_application_id === $application->id && Storage::disk('local')->exists($file->file_path));

        return Storage::disk('local')->response($file->file_path, $file->file_original_name);
    }

    public function storeFile(Request $request, OrganizationApplication $application, SubmissionStoragePolicy $storagePolicy)
    {
        $actor = $request->user();
        $this->authorizeScope($actor, $application);
        $stage = $this->stageOf($actor);
        $data = $request->validate([
            'file' => ['required', 'file', 'max:10240', 'mimes:pdf,doc,docx,xls,xlsx,png,jpg,jpeg', 'extensions:pdf,doc,docx,xls,xlsx,png,jpg,jpeg'],
            'requirement_type_id' => ['nullable', 'integer'],
        ]);
        $storagePolicy->assertUpload([$request->file('file')], field: 'file');

        $stored = null;
        try {
            $record = DB::transaction(function () use ($request, $application, $actor, $stage, $data, &$stored) {
                $locked = OrganizationApplication::whereKey($application->id)->lockForUpdate()->firstOrFail();
                abort_unless($locked->status === $this->waitingStatus($stage), 409, 'This application is not waiting for you. Refresh the list.');
                if (! empty($data['requirement_type_id'])) {
                    abort_unless($locked->documents()->where('requirement_type_id', $data['requirement_type_id'])->exists(), 422, 'That requirement is not part of this application.');
                }
                abort_if($locked->reviewFiles()->where('round', $locked->round)->where('stage', $stage)->count() >= self::MAX_REVIEW_FILES, 422, 'You can attach up to '.self::MAX_REVIEW_FILES.' files.');
                $file = $request->file('file');
                $stored = $file->store('organization-application-reviews/'.$locked->id, 'local');
                abort_unless($stored, 500, 'Could not save the file. Try again.');

                return $locked->reviewFiles()->create([
                    'requirement_type_id' => $data['requirement_type_id'] ?? null,
                    'round' => $locked->round,
                    'stage' => $stage,
                    'uploaded_by' => $actor->school_id,
                    'file_path' => $stored,
                    'file_original_name' => $file->getClientOriginalName(),
                    'mime_type' => $file->getClientMimeType(),
                    'file_size' => $file->getSize(),
                ]);
            });
        } catch (\Throwable $error) {
            if ($stored) {
                Storage::disk('local')->delete($stored);
            }
            throw $error;
        }

        return response()->json([
            'id' => $record->id, 'name' => $record->file_original_name, 'stage' => $stage, 'stage_label' => OrganizationApplicationPresenter::STAGE_LABEL[$stage],
            'requirement_type_id' => $record->requirement_type_id,
            'uploaded_by' => trim("{$actor->first_name} {$actor->last_name}"), 'uploaded_at' => $record->created_at,
            'open_url' => self::PREFIX."/{$application->id}/review-files/{$record->id}",
        ], 201);
    }

    public function destroyFile(Request $request, OrganizationApplication $application, OrganizationApplicationReviewFile $file)
    {
        $actor = $request->user();
        $this->authorizeScope($actor, $application);
        $stage = $this->stageOf($actor);
        NotFound::unless($file->organization_application_id === $application->id && $file->stage === $stage && $file->round === $application->round);
        abort_unless($application->status === $this->waitingStatus($stage), 409, 'This application is not waiting for you. Refresh the list.');

        Storage::disk('local')->delete($file->file_path);
        $file->delete();

        return response()->noContent();
    }

    public function review(Request $request, OrganizationApplication $application)
    {
        $actor = $request->user();
        $this->authorizeScope($actor, $application);
        $stage = $this->stageOf($actor);
        $data = $request->validate([
            'action' => ['required', Rule::in($stage === 'dean' ? ['endorse', 'return'] : ['approve', 'return', 'reject'])],
            'remarks' => ['nullable', 'string', 'max:2000', 'required_if:action,reject'],
            'requirements' => ['nullable', 'array', 'max:50'],
            'requirements.*.requirement_type_id' => ['required', 'integer', 'distinct'],
            'requirements.*.status' => ['required', Rule::in(OrganizationApplicationRequirementReview::STATUSES)],
            'requirements.*.note' => ['nullable', 'string', 'max:1000'],
        ]);

        $copied = [];
        try {
            $locked = DB::transaction(function () use ($application, $data, $actor, $stage, &$copied) {
                $locked = OrganizationApplication::whereKey($application->id)->lockForUpdate()->firstOrFail();
                $this->authorizeScope($actor, $locked);
                abort_if($locked->status !== $this->waitingStatus($stage), 409, 'This application is not waiting for you. Refresh the list.');
                $documents = $locked->documents()->get();
                $entries = collect($data['requirements'] ?? [])->keyBy('requirement_type_id');
                if ($entries->keys()->map(fn ($id) => (int) $id)->diff($documents->pluck('requirement_type_id')->map(fn ($id) => (int) $id))->isNotEmpty()) {
                    throw ValidationException::withMessages(['requirements' => 'One of those requirements is not part of this application.']);
                }
                $flagged = $entries->filter(fn ($entry) => $entry['status'] !== 'ok');
                $passing = in_array($data['action'], ['endorse', 'approve'], true);
                if ($passing && $flagged->isNotEmpty()) {
                    throw ValidationException::withMessages(['requirements' => 'Mark every requirement OK, or return the application.']);
                }
                if ($data['action'] === 'return' && trim((string) ($data['remarks'] ?? '')) === '' && $flagged->isEmpty()) {
                    throw ValidationException::withMessages(['remarks' => 'Say what needs to change: write a note or mark a requirement.']);
                }
                if ($passing) {
                    abort_if($documents->count() !== $locked->required_documents_count
                        || $documents->contains(fn ($document) => ! Storage::disk('local')->exists($document->file_path)), 409, 'Some required documents are missing.');
                }

                foreach ($documents as $document) {
                    $entry = $entries->get($document->requirement_type_id);
                    if (! $entry && ! $passing) {
                        continue;
                    }
                    OrganizationApplicationRequirementReview::updateOrCreate(
                        ['organization_application_id' => $locked->id, 'requirement_type_id' => $document->requirement_type_id, 'round' => $locked->round, 'stage' => $stage],
                        ['status' => $entry['status'] ?? 'ok', 'note' => filled($entry['note'] ?? null) ? trim($entry['note']) : null, 'reviewed_by' => $actor->school_id],
                    );
                }

                match ($data['action']) {
                    'endorse' => $locked->forceFill(['status' => 'pending_sao', 'endorsed_by' => $actor->school_id, 'endorsed_at' => now(), 'endorsement_note' => $data['remarks'] ?? null]),
                    'approve' => $this->approve($locked, $documents, $actor, $data['remarks'] ?? null, $copied),
                    'return' => $locked->forceFill(['status' => 'returned', 'remarks' => $data['remarks'] ?? null, 'returned_by' => $actor->school_id, 'returned_by_role' => $actor->role, 'returned_at' => now()]),
                    'reject' => $locked->forceFill(['status' => 'rejected', 'remarks' => $data['remarks'], 'reviewed_by' => $actor->school_id, 'reviewed_at' => now()]),
                };
                $locked->save();
                AuditLog::create(['organization_id' => $actor->organization_id, 'user_id' => $actor->school_id, 'actor_role' => $actor->role, 'module' => 'organization_applications', 'action' => $locked->status, 'record_type' => OrganizationApplication::class, 'record_id' => $locked->id, 'new_values' => ['status' => $locked->status, 'round' => $locked->round, 'note' => filled($data['remarks'] ?? null) ? trim($data['remarks']) : null], 'created_at' => now(), 'ip_address' => request()->ip()]);

                return $locked;
            });
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($copied);
            throw $error;
        }

        $this->notifyAfterDecision($locked, $data['action']);

        return response()->json($this->detail($locked->refresh()));
    }

    /** A note from a reviewer. It never touches the status, the requirement marks or the applicant's notifications. */
    public function comment(Request $request, OrganizationApplication $application)
    {
        $actor = $request->user();
        $this->authorizeScope($actor, $application);
        $data = $request->validate(['note' => ['required', 'string', 'max:2000']]);
        $note = trim($data['note']);
        if ($note === '') {
            throw ValidationException::withMessages(['note' => 'Write a note before saving.']);
        }

        AuditLog::create(['organization_id' => $actor->organization_id, 'user_id' => $actor->school_id, 'actor_role' => $actor->role, 'module' => 'organization_applications', 'action' => 'comment', 'record_type' => OrganizationApplication::class, 'record_id' => $application->id, 'new_values' => ['note' => $note, 'round' => $application->round], 'created_at' => now(), 'ip_address' => $request->ip()]);

        return response()->json($this->detail($application), 201);
    }

    /** The shared application detail plus the reviewers' history. */
    private function detail(OrganizationApplication $application): array
    {
        return [...$this->presenter->detail($application, self::PREFIX, false), 'history' => $this->history($application)];
    }

    /** Notes and decisions, oldest first, read from the audit log so no second record of them exists. */
    private function history(OrganizationApplication $application): array
    {
        return AuditLog::query()
            ->where('module', 'organization_applications')->where('record_type', OrganizationApplication::class)->where('record_id', $application->id)
            ->whereIn('actor_role', ['DEPARTMENT_HEAD', 'SUPER_ADMIN'])
            ->whereIn('action', ['comment', ...array_keys(self::DECISION_LABEL)])
            ->with('user:school_id,first_name,last_name')->orderBy('id')->get()
            ->map(fn (AuditLog $entry) => [
                'id' => $entry->id,
                'kind' => $entry->action === 'comment' ? 'comment' : 'decision',
                'label' => $entry->action === 'comment' ? 'Comment' : self::DECISION_LABEL[$entry->action],
                'note' => $entry->new_values['note'] ?? null,
                'by' => $entry->user ? trim("{$entry->user->first_name} {$entry->user->last_name}") : null,
                'stage_label' => OrganizationApplicationPresenter::STAGE_LABEL[$entry->actor_role === 'DEPARTMENT_HEAD' ? 'dean' : 'sao'],
                'at' => $entry->created_at,
            ])->values()->all();
    }

    /** Creates the organization in the college the grant named and gives the applicant an ADMIN profile on it. Their account, role and home organization stay as they are. */
    private function approve(OrganizationApplication $application, $documents, User $actor, ?string $remarks, array &$copied): void
    {
        $college = College::whereKey($application->college_id)->where('is_active', true)->lockForUpdate()->first();
        abort_unless($college, 409, 'The college is no longer active.');
        abort_if(Organization::where('name', $application->name)->orWhere('acronym', $application->acronym)->exists(), 409, 'An organization with this name or acronym already exists.');
        $applicant = User::whereKey($application->school_id)->lockForUpdate()->first();
        abort_if(! $applicant, 409, 'The applicant has no HIUSA account, so they cannot lead the organization. Return this application.');
        abort_if($applicant->account_status !== 'active' || $applicant->role === 'SUPER_ADMIN', 409, 'The applicant\'s account is not active.');

        $organization = Organization::create([
            'name' => $application->name, 'slug' => Str::slug($application->name).'-'.Str::lower(Str::random(6)), 'acronym' => $application->acronym,
            'college_id' => $college->id, 'college' => $college->name, 'parent_organization_id' => $college->homeOrganization?->id,
            'description' => $application->description, 'organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active', 'is_active' => true,
            'submitted_at' => $application->submitted_at ?? $application->created_at, 'submitted_by' => $applicant->school_id, 'reviewed_by' => $actor->school_id, 'reviewed_at' => now(),
        ]);
        SboPosition::firstOrCreate(['organization_id' => $organization->id, 'role' => 'ADMIN', 'title' => $application->position_title], ['is_active' => true]);
        AccountProfile::create(['user_school_id' => $applicant->school_id, 'organization_id' => $organization->id, 'role' => 'ADMIN', 'account_status' => 'active', 'position_title' => $application->position_title]);

        foreach ($documents as $document) {
            $path = 'compliance-submissions/'.$organization->id.'/'.Str::random(40).'.pdf';
            abort_unless(Storage::disk('local')->copy($document->file_path, $path), 500, 'Could not save the compliance document.');
            $copied[] = $path;
            OrganizationComplianceSubmission::create([
                'organization_id' => $organization->id, 'requirement_type_id' => $document->requirement_type_id, 'status' => 'approved', 'file_path' => $path,
                'file_original_name' => $document->file_original_name, 'mime_type' => $document->mime_type, 'file_size' => $document->file_size,
                'is_registration_document' => true, 'reviewed_by' => $actor->school_id, 'reviewed_at' => $organization->reviewed_at,
                'submitted_by' => $applicant->school_id, 'submitted_at' => now(),
            ]);
        }
        $application->forceFill(['status' => 'approved', 'organization_id' => $organization->id, 'remarks' => $remarks, 'reviewed_by' => $actor->school_id, 'reviewed_at' => now()]);
    }

    private function notifyAfterDecision(OrganizationApplication $application, string $action): void
    {
        $applicant = User::find($application->school_id);
        if ($action === 'endorse') {
            User::where('role', 'SUPER_ADMIN')->where('account_status', 'active')->get()
                ->each(fn (User $sao) => $this->notify($sao, $application, 'Endorsed organization application for SAO review'));
        }
        if (! $applicant) {
            return;
        }
        $this->notify($applicant, $application, match ($action) {
            'endorse' => 'Your application is with the SAO',
            'approve' => "{$application->name} was approved",
            'return' => 'Your application was returned',
            'reject' => 'Your application was not approved',
        }, match ($action) {
            'endorse' => "Your Department Head endorsed {$application->name}. The SAO decides next.",
            'approve' => "You are now {$application->position_title} of {$application->name}. Switch to it from the account menu.",
            'return' => 'Open the application to see what to fix, then send it again.',
            'reject' => $application->remarks ?: $application->name,
        });
    }

    private function notify(User $user, OrganizationApplication $application, string $title, ?string $message = null): void
    {
        Notification::create(['organization_id' => $user->organization_id, 'user_id' => $user->school_id, 'notification_type' => 'general', 'title' => $title, 'message' => $message ?? $application->name, 'reference_type' => 'organization_application', 'reference_id' => $application->id, 'is_read' => false, 'sent_at' => now()]);
    }

    private function stageOf(User $actor): string
    {
        return $actor->role === 'DEPARTMENT_HEAD' ? 'dean' : 'sao';
    }

    private function waitingStatus(string $stage): string
    {
        return $stage === 'dean' ? 'pending_dean' : 'pending_sao';
    }

    private function scoped(User $user)
    {
        $query = OrganizationApplication::whereNotIn('status', OrganizationApplication::LEGACY_UNQUEUED);
        if ($user->role !== 'DEPARTMENT_HEAD') {
            return $query;
        }
        $home = $user->organization;

        return $home?->organization_type === 'COLLEGE' && $home->college_id ? $query->where('college_id', $home->college_id) : $query->whereRaw('1 = 0');
    }

    /** A wrong college and a missing id answer alike, so a Department Head cannot probe other colleges. */
    private function authorizeScope(User $user, OrganizationApplication $application): void
    {
        NotFound::unless($this->scoped($user)->whereKey($application->id)->exists());
    }
}
