<?php

namespace App\Services;

use App\Models\ApprovalRequest;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use Illuminate\Support\Collection;

/**
 * The Department Head approves every event proposal. When active SAO requirements apply to the
 * event, the Student Affairs Office clears it afterwards, once the Admin has uploaded the files.
 * The stage is computed from the approval rows that exist, so events filed under the old routing
 * (an SAO row and no Department Head row) keep working.
 */
class EventApprovalChain
{
    private const SAO_ROLE = 'SUPER_ADMIN';

    public function requiresRequirements(Event $event): bool
    {
        return EventRequirement::activeForEvent($event)->exists();
    }

    public function requirementsSubmitted(Event $event): bool
    {
        return $this->filesComplete(
            EventRequirement::activeForEvent($event)->get(),
            EventRequirementFile::where('event_id', $event->id)->pluck('requirement_id'),
        );
    }

    public function headRow(Event $event): ?ApprovalRequest
    {
        return $this->rows($event)->first(fn (ApprovalRequest $row) => $row->required_role !== self::SAO_ROLE);
    }

    public function saoRow(Event $event): ?ApprovalRequest
    {
        return $this->rows($event)->first(fn (ApprovalRequest $row) => $row->required_role === self::SAO_ROLE);
    }

    public function submitToHead(Event $event, int $requestedBy): void
    {
        $head = $this->headRow($event);

        if (! $head) {
            ApprovalRequest::create([
                'organization_id' => $event->organization_id,
                'entity_type' => 'event',
                'entity_id' => $event->id,
                'requested_by' => $requestedBy,
                'required_role' => config('approvals.routes.event'),
            ]);
        } elseif ($head->status !== 'pending') {
            $head->reopen($requestedBy, config('approvals.routes.event'));
        }
    }

    public function openSaoReview(Event $event, int $requestedBy): void
    {
        $sao = $this->saoRow($event);

        if (! $sao) {
            ApprovalRequest::create([
                'organization_id' => $event->organization_id,
                'entity_type' => 'event',
                'entity_id' => $event->id,
                'requested_by' => $requestedBy,
                'required_role' => self::SAO_ROLE,
            ]);
        } elseif ($sao->status !== 'pending') {
            $sao->reopen($requestedBy, self::SAO_ROLE);
        }
    }

    /**
     * Approval fields keyed by event id. One query for the approval rows, one for the uploaded
     * files and one per distinct (semester, venue type) shape on the page, never one per event.
     *
     * @param  iterable<Event>  $events
     */
    public function describe(iterable $events): array
    {
        $events = collect($events)->values();
        if ($events->isEmpty()) {
            return [];
        }

        $ids = $events->pluck('id');
        $rows = ApprovalRequest::where('entity_type', 'event')->whereIn('entity_id', $ids)->orderByDesc('id')->get()->groupBy('entity_id');
        $uploaded = EventRequirementFile::whereIn('event_id', $ids)->get(['event_id', 'requirement_id'])->groupBy('event_id');
        $requirementsByShape = [];

        return $events->mapWithKeys(function (Event $event) use ($rows, $uploaded, &$requirementsByShape) {
            $shape = ($event->academic_semester_id ?? 'none').'|'.data_get($event->planning_details, 'venue_type');
            $requirements = $requirementsByShape[$shape] ??= EventRequirement::activeForEvent($event)->get();
            $eventRows = $rows->get($event->id, collect());
            $required = $requirements->isNotEmpty();
            $submitted = $this->filesComplete($requirements, $uploaded->get($event->id, collect())->pluck('requirement_id'));
            [$stage, $row] = $this->resolve(
                $event,
                $eventRows->first(fn (ApprovalRequest $candidate) => $candidate->required_role !== self::SAO_ROLE),
                $eventRows->first(fn (ApprovalRequest $candidate) => $candidate->required_role === self::SAO_ROLE),
                $required,
            );

            return [$event->id => [
                'approval_id' => $row?->id,
                'approval_status' => $row?->status,
                'approval_remarks' => $row?->remarks,
                'approval_required_role' => $row?->status === 'pending' ? $row->required_role : null,
                'requirements_required' => $required,
                'requirements_submitted' => $required && $submitted,
                'approval_stage' => $stage,
            ]];
        })->all();
    }

    /** @param  iterable<Event>  $events */
    public function attach(iterable $events): void
    {
        $events = collect($events);
        $fields = $this->describe($events);

        foreach ($events as $event) {
            foreach ($fields[$event->id] as $key => $value) {
                $event->{$key} = $value;
            }
        }
    }

    private function resolve(Event $event, ?ApprovalRequest $head, ?ApprovalRequest $sao, bool $required): array
    {
        return match (true) {
            $event->approved_at !== null => ['approved', collect([$head, $sao])->filter()->sortBy('id')->last()],
            $head?->status === 'pending' => ['awaiting_department_head', $head],
            $head?->status === 'rejected' => ['rejected', $head],
            $sao?->status === 'pending' => ['awaiting_sao', $sao],
            $sao?->status === 'rejected' => ['requirements_returned', $sao],
            $head !== null && $required => ['awaiting_requirements', $head],
            default => ['not_submitted', null],
        };
    }

    private function filesComplete(Collection $requirements, Collection $uploadedRequirementIds): bool
    {
        return $requirements->isNotEmpty()
            && $uploadedRequirementIds->isNotEmpty()
            && $requirements->where('is_optional', false)->pluck('id')->diff($uploadedRequirementIds)->isEmpty();
    }

    private function rows(Event $event): Collection
    {
        return ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->orderByDesc('id')->get();
    }
}
