<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\AcademicSemester;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class EventRequirementController extends Controller
{
    private const SUPPORTED_EXTENSIONS = ['pdf'];

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

        $requirement->delete();

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

        return response()->json([
            'event' => $event->only(['id', 'title', 'organization_id', 'status']),
            'requirements' => EventRequirement::forEvent($event)->where('is_active', true)->orderBy('sort_order')->orderBy('id')->get(),
            'files' => EventRequirementFile::with('requirement:id,name,allowed_extensions')
                ->where('event_id', $event->id)->orderBy('requirement_id')->get(),
            'approval_status' => ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->latest('id')->value('status'),
        ]);
    }

    public function submit(Request $request, Event $event)
    {
        if ($event->organization_id !== $request->user()->organization_id) {
            return response()->json(['message' => 'Event not found.'], 404);
        }
        $previousApproval = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->latest('id')->first();
        if ($event->approved_at || ($previousApproval && $previousApproval->status !== 'rejected')) {
            return response()->json(['message' => 'This event has already been submitted.'], 409);
        }

        $request->validate(['documents' => ['required', 'array'], 'documents.*' => ['required', 'file', 'max:10240']]);
        $requirements = EventRequirement::forEvent($event)->where('is_active', true)->get();
        if ($requirements->isEmpty()) {
            return response()->json(['message' => 'SAO has not configured any event requirements.'], 422);
        }

        $documents = $request->file('documents', []);
        if (array_diff($requirements->where('is_optional', false)->pluck('id')->all(), array_map('intval', array_keys($documents)))
            || array_diff(array_map('intval', array_keys($documents)), $requirements->pluck('id')->all())) {
            return response()->json(['message' => 'Upload a PDF for every required SAO item.'], 422);
        }

        foreach ($requirements as $requirement) {
            if (! isset($documents[$requirement->id])) {
                continue;
            }
            Validator::make(['file' => $documents[$requirement->id]], [
                'file' => ['required', 'file', 'max:10240', 'mimes:pdf'],
            ])->validate();
        }

        $storedPaths = [];
        $oldPaths = EventRequirementFile::where('event_id', $event->id)->pluck('path')->all();
        try {
            DB::transaction(function () use ($request, $event, $requirements, $documents, $previousApproval, &$storedPaths) {
                EventRequirementFile::where('event_id', $event->id)->delete();
                foreach ($requirements as $requirement) {
                    if (! isset($documents[$requirement->id])) {
                        continue;
                    }
                    $file = $documents[$requirement->id];
                    $path = $file->store('event-requirements/'.$event->organization_id.'/'.$event->id, 'local');
                    $storedPaths[] = $path;
                    EventRequirementFile::create([
                        'event_id' => $event->id,
                        'requirement_id' => $requirement->id,
                        'organization_id' => $event->organization_id,
                        'path' => $path,
                        'original_name' => $file->getClientOriginalName(),
                        'uploaded_by' => $request->user()->school_id,
                    ]);
                }

                if ($previousApproval) {
                    $previousApproval->reopen($request->user()->school_id, 'SUPER_ADMIN');
                } else {
                    ApprovalRequest::create([
                        'organization_id' => $event->organization_id,
                        'entity_type' => 'event',
                        'entity_id' => $event->id,
                        'requested_by' => $request->user()->school_id,
                        'required_role' => 'SUPER_ADMIN',
                    ]);
                }
            });
        } catch (\Throwable $exception) {
            Storage::disk('local')->delete($storedPaths);
            throw $exception;
        }
        Storage::disk('local')->delete($oldPaths);

        return $this->showSubmission($request, $event);
    }

    public function download(Request $request, Event $event, EventRequirementFile $file)
    {
        if (! $this->canSeeSubmission($request, $event) || $file->event_id !== $event->id) {
            return response()->json(['message' => 'Event file not found.'], 404);
        }

        return Storage::disk('local')->download($file->path, $file->original_name);
    }

    private function canSeeSubmission(Request $request, Event $event): bool
    {
        if ($request->user()->role === 'SUPER_ADMIN') {
            return ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->exists();
        }

        if ($event->organization_id !== $request->user()->organization_id) {
            return false;
        }

        return $request->user()->role === 'ADMIN'
            || ($request->user()->role === 'DEPARTMENT_HEAD'
                && ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->exists());
    }
}
