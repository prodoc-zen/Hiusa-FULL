<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
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
    private const SUPPORTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx'];

    public function index(Request $request)
    {
        return response()->json(EventRequirement::query()
            ->when($request->user()->role !== 'SUPER_ADMIN', fn ($query) => $query->where('is_active', true))
            ->orderBy('id')->get());
    }

    public function store(Request $request)
    {
        $data = $this->validateRequirement($request);

        return response()->json(EventRequirement::create($data), 201);
    }

    public function update(Request $request, EventRequirement $requirement)
    {
        $data = $this->validateRequirement($request);
        $requirement->update($data);

        return response()->json($requirement->fresh());
    }

    private function validateRequirement(Request $request): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:150'],
            'allowed_extensions' => ['required', 'array', 'min:1'],
            'allowed_extensions.*' => ['required', 'string', 'distinct', Rule::in(self::SUPPORTED_EXTENSIONS)],
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
            'requirements' => EventRequirement::where('is_active', true)->orderBy('id')->get(),
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
        $requirements = EventRequirement::where('is_active', true)->get();
        if ($requirements->isEmpty()) {
            return response()->json(['message' => 'SAO has not configured any event requirements.'], 422);
        }

        $documents = $request->file('documents', []);
        if (array_diff($requirements->pluck('id')->all(), array_map('intval', array_keys($documents)))
            || array_diff(array_map('intval', array_keys($documents)), $requirements->pluck('id')->all())) {
            return response()->json(['message' => 'Upload one file for every active SAO requirement.'], 422);
        }

        foreach ($requirements as $requirement) {
            Validator::make(['file' => $documents[$requirement->id]], [
                'file' => ['required', 'file', 'max:10240', 'mimes:'.implode(',', $requirement->allowed_extensions)],
            ])->validate();
        }

        $storedPaths = [];
        $oldPaths = EventRequirementFile::where('event_id', $event->id)->pluck('path')->all();
        try {
            DB::transaction(function () use ($request, $event, $requirements, $documents, $previousApproval, &$storedPaths) {
                EventRequirementFile::where('event_id', $event->id)->delete();
                foreach ($requirements as $requirement) {
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
