<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\ApprovalRequest;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use App\Services\EventApprovalChain;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class EventRequirementController extends Controller
{
    private const SUPPORTED_EXTENSIONS = ['pdf'];

    public function __construct(private readonly EventApprovalChain $approvalChain) {}

    public function index(Request $request)
    {
        return response()->json(EventRequirement::query()
            ->forPeriod(AcademicSemester::active()?->id)
            ->when($request->user()->role !== 'SUPER_ADMIN', fn ($query) => $query->where('is_active', true))
            ->orderBy('sort_order')->orderBy('id')->get());
    }

    public function store(Request $request)
    {
        $data = $this->validateRequirement($request);

        $data['sort_order'] = (int) EventRequirement::max('sort_order') + 1;
        $data['academic_semester_id'] = AcademicSemester::active()?->id;

        return response()->json(EventRequirement::create($data), 201);
    }

    public function update(Request $request, EventRequirement $requirement)
    {
        if ($requirement->academic_semester_id && $requirement->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Completed semester requirements are read only.'], 409);
        }
        $data = $this->validateRequirement($request);
        $requirement->update($data);

        return response()->json($requirement->fresh());
    }

    public function uploadTemplate(Request $request, EventRequirement $requirement)
    {
        if ($requirement->academic_semester_id && $requirement->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Completed semester requirements are read only.'], 409);
        }
        $request->validate(['template' => ['required', 'file', 'mimes:pdf', 'extensions:pdf', 'max:10240']]);

        $file = $request->file('template');
        $path = $file->store('event-requirement-templates/'.$requirement->id, 'local');
        if (! $path) {
            return response()->json(['message' => 'Could not save the sample template.'], 500);
        }
        $previousPath = $requirement->template_path;
        try {
            $requirement->update([
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

        return response()->json($requirement->fresh());
    }

    public function setTemplateLink(Request $request, EventRequirement $requirement)
    {
        if ($requirement->academic_semester_id && $requirement->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Completed semester requirements are read only.'], 409);
        }
        $data = $request->validate(['template_url' => ['required', 'string', 'max:2048', 'url:http,https']]);

        $previousPath = $requirement->template_path;
        $requirement->update([
            'template_url' => $data['template_url'],
            'template_path' => null,
            'template_original_name' => null,
        ]);
        if ($previousPath) {
            Storage::disk('local')->delete($previousPath);
        }

        return response()->json($requirement->fresh());
    }

    public function removeTemplate(EventRequirement $requirement)
    {
        if ($requirement->academic_semester_id && $requirement->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Completed semester requirements are read only.'], 409);
        }
        $path = $requirement->template_path;
        $requirement->update(['template_path' => null, 'template_original_name' => null, 'template_url' => null]);
        if ($path) {
            Storage::disk('local')->delete($path);
        }

        return response()->json($requirement->fresh());
    }

    public function template(Request $request, EventRequirement $requirement)
    {
        if ($request->user()->role !== 'SUPER_ADMIN' && ! $requirement->is_active) {
            return response()->json(['message' => 'Sample template not found.'], 404);
        }
        $disk = Storage::disk('local');
        if (! $requirement->template_path || ! $disk->exists($requirement->template_path)) {
            return response()->json(['message' => 'Sample template not found.'], 404);
        }

        $response = response()->file($disk->path($requirement->template_path), ['Content-Type' => 'application/pdf', 'X-Content-Type-Options' => 'nosniff']);
        $response->setContentDisposition('inline', $requirement->template_original_name ?: 'event-template-'.$requirement->id.'.pdf', 'event-template-'.$requirement->id.'.pdf');
        $response->setPrivate();
        $response->headers->addCacheControlDirective('no-store');

        return $response;
    }

    public function reorder(Request $request)
    {
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['required', 'integer', 'distinct', Rule::exists('event_requirements', 'id')],
        ]);
        $current = EventRequirement::forPeriod(AcademicSemester::active()?->id)->pluck('id')->sort()->values()->all();
        $submitted = collect($data['ids'])->map(fn ($id) => (int) $id)->sort()->values()->all();
        if ($current !== $submitted) {
            return response()->json(['message' => 'Include every requirement exactly once when reordering.'], 422);
        }

        DB::transaction(function () use ($data) {
            foreach ($data['ids'] as $index => $id) {
                EventRequirement::whereKey($id)->update(['sort_order' => $index + 1]);
            }
        });

        return response()->json(EventRequirement::forPeriod(AcademicSemester::active()?->id)->orderBy('sort_order')->orderBy('id')->get());
    }

    public function destroy(EventRequirement $requirement)
    {
        if ($requirement->academic_semester_id && $requirement->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Completed semester requirements are read only.'], 409);
        }
        if (EventRequirementFile::where('requirement_id', $requirement->id)->exists()) {
            return response()->json(['message' => 'This requirement has submitted files. Deactivate it to preserve those records.'], 409);
        }

        $templatePath = $requirement->template_path;
        $requirement->delete();
        if ($templatePath) {
            Storage::disk('local')->delete($templatePath);
        }

        return response()->noContent();
    }

    private function validateRequirement(Request $request): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:150'],
            'description' => ['nullable', 'string', 'max:500'],
            'allowed_extensions' => ['required', 'array', 'min:1'],
            'allowed_extensions.*' => ['required', 'string', 'distinct', Rule::in(self::SUPPORTED_EXTENSIONS)],
            'venue_type' => ['sometimes', 'in:all,on_campus,off_campus'],
            'is_optional' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    public function showSubmission(Request $request, Event $event)
    {
        if (! $this->canSeeSubmission($request, $event)) {
            return response()->json(['message' => 'Event submission not found.'], 404);
        }

        $approval = $this->approvalChain->describe([$event])[$event->id];

        return response()->json([
            'event' => $event->only(['id', 'title', 'organization_id', 'status']),
            'requirements' => EventRequirement::activeForEvent($event)->orderBy('sort_order')->orderBy('id')->get(),
            'files' => EventRequirementFile::with('requirement:id,name,allowed_extensions')
                ->where('event_id', $event->id)->orderBy('requirement_id')->get(),
            'approval_status' => $approval['approval_status'],
            'approval_stage' => $approval['approval_stage'],
            'approval_remarks' => $approval['approval_remarks'],
        ]);
    }

    public function submit(Request $request, Event $event)
    {
        if ($event->organization_id !== $request->user()->organization_id) {
            return response()->json(['message' => 'Event not found.'], 404);
        }
        $head = $this->approvalChain->headRow($event);
        $sao = $this->approvalChain->saoRow($event);
        if ($event->approved_at || $sao?->status === 'pending') {
            return response()->json(['message' => 'This event has already been submitted.'], 409);
        }

        $request->validate(['documents' => ['sometimes', 'array'], 'documents.*' => ['required', 'file', 'max:10240']]);
        $requirements = EventRequirement::activeForEvent($event)->get();
        if ($requirements->isEmpty()) {
            return response()->json(['message' => 'SAO has not configured any event requirements.'], 422);
        }

        $documents = $request->file('documents', []);
        $existing = EventRequirementFile::where('event_id', $event->id)->get()->keyBy('requirement_id');
        $availableIds = array_unique(array_merge($existing->keys()->all(), array_map('intval', array_keys($documents))));
        if (! array_intersect($availableIds, $requirements->pluck('id')->all())
            || array_diff($requirements->where('is_optional', false)->pluck('id')->all(), $availableIds)
            || array_diff(array_map('intval', array_keys($documents)), $requirements->pluck('id')->all())) {
            return response()->json(['message' => 'Upload a PDF for every required SAO item.'], 422);
        }

        foreach ($requirements as $requirement) {
            if (! isset($documents[$requirement->id])) {
                continue;
            }
            Validator::make(['file' => $documents[$requirement->id]], [
                'file' => ['required', 'file', 'max:10240', 'mimes:pdf', 'extensions:pdf'],
            ])->validate();
        }

        $storedPaths = [];
        $oldPaths = [];
        try {
            DB::transaction(function () use ($request, $event, $requirements, $documents, $head, $sao, $existing, &$storedPaths, &$oldPaths) {
                foreach ($requirements as $requirement) {
                    if (! isset($documents[$requirement->id])) {
                        continue;
                    }
                    $file = $documents[$requirement->id];
                    $path = $file->store('event-requirements/'.$event->organization_id.'/'.$event->id, 'local');
                    $storedPaths[] = $path;
                    if ($old = $existing->get($requirement->id)) {
                        $oldPaths[] = $old->path;
                        $old->delete();
                    }
                    EventRequirementFile::create([
                        'event_id' => $event->id,
                        'requirement_id' => $requirement->id,
                        'organization_id' => $event->organization_id,
                        'path' => $path,
                        'original_name' => $file->getClientOriginalName(),
                        'uploaded_by' => $request->user()->school_id,
                    ]);
                }

                if (! $head || $head->status === 'rejected') {
                    $this->approvalChain->submitToHead($event, $request->user()->school_id);
                } elseif ($head->status === 'approved') {
                    $this->approvalChain->openSaoReview($event, $request->user()->school_id);
                }
            });
        } catch (\Throwable $exception) {
            Storage::disk('local')->delete($storedPaths);
            throw $exception;
        }
        Storage::disk('local')->delete($oldPaths);

        return $this->showSubmission($request, $event);
    }

    public function download(Request $request, string $event, string $file)
    {
        $event = ctype_digit($event) ? Event::find($event) : null;
        $file = ctype_digit($file) ? EventRequirementFile::find($file) : null;
        if (! $event || ! $file || ! $this->canSeeSubmission($request, $event) || $file->event_id !== $event->id) {
            return response()->json(['message' => 'Event file not found.'], 404);
        }

        $disk = Storage::disk('local');
        if (! $disk->exists($file->path)) {
            return response()->json(['message' => 'Event file not found.'], 404);
        }

        $response = response()->file($disk->path($file->path), ['Content-Type' => 'application/pdf', 'X-Content-Type-Options' => 'nosniff']);
        $response->setContentDisposition('inline', $file->original_name, 'event-file-'.$file->id.'.pdf');
        $response->setPrivate();
        $response->headers->addCacheControlDirective('no-store');

        return $response;
    }

    private function canSeeSubmission(Request $request, Event $event): bool
    {
        if ($request->user()->role === 'SUPER_ADMIN') {
            return $this->approvalChain->saoRow($event) !== null;
        }

        if (! in_array($event->organization_id, $request->user()->scopedOrganizationIds(), true)) {
            return false;
        }

        return $request->user()->role === 'ADMIN'
            || ($request->user()->role === 'DEPARTMENT_HEAD'
                && ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->exists());
    }
}
