<?php

namespace App\Services;

use App\Models\ApprovalRequest;
use App\Models\EventRequirementFile;
use App\Models\EventRequirementFileReview;
use DomainException;
use Illuminate\Validation\Rule;

/**
 * Per-file marks on an event's SAO files, the same Accepted or Needs changes check that organization
 * applications use. A mark belongs to one file and one reviewing step, so a file that is replaced
 * starts unmarked and a file that is left alone keeps the acceptance it already earned.
 */
class EventFileReview
{
    public const MARK_FIRST_MESSAGE = 'Mark every file Accepted, or return the request.';

    public static function rules(): array
    {
        return [
            'files' => ['sometimes', 'array', 'max:50'],
            'files.*.id' => ['required', 'integer', 'distinct'],
            'files.*.status' => ['required', Rule::in(EventRequirementFileReview::STATUSES)],
            'files.*.note' => ['nullable', 'string', 'max:1000', 'required_if:files.*.status,needs_changes'],
        ];
    }

    public function stageOf(ApprovalRequest $approval): string
    {
        return $approval->required_role === 'SUPER_ADMIN' ? 'sao' : 'dean';
    }

    /**
     * Saves or clears one file's Accepted mark the moment the reviewer makes it, so a reload keeps it.
     * Clearing only removes an Accepted mark; a Needs changes mark is a return and goes with the decision.
     *
     * @return array<int, array{stage: string, status: string, note: ?string}>
     */
    public function mark(ApprovalRequest $approval, EventRequirementFile $file, string $status, int $reviewerId): array
    {
        $stage = $this->stageOf($approval);

        if ($status === 'ok') {
            EventRequirementFileReview::updateOrCreate(
                ['event_requirement_file_id' => $file->id, 'stage' => $stage],
                ['status' => 'ok', 'note' => null, 'reviewed_by' => $reviewerId],
            );
        } else {
            EventRequirementFileReview::where('event_requirement_file_id', $file->id)->where('stage', $stage)->where('status', 'ok')->delete();
        }

        return $file->reviews()->get()->map->only(['stage', 'status', 'note'])->values()->all();
    }

    /**
     * Saves the marks sent with a decision. Approving is refused while any file of the event still
     * says Needs changes at this step, whether the mark arrived now or on an earlier return, and while any
     * file has no Accepted mark at this step.
     *
     * @param  array<int, array{id: int, status: string, note?: ?string}>  $marks
     */
    public function record(ApprovalRequest $approval, array $marks, string $decision, int $reviewerId): void
    {
        $stage = $this->stageOf($approval);
        $ids = array_map(fn (array $mark) => (int) $mark['id'], $marks);

        if ($ids !== [] && EventRequirementFile::where('event_id', $approval->entity_id)->whereIn('id', $ids)->count() !== count($ids)) {
            throw new DomainException('A file in your review is not part of this event.');
        }

        foreach ($marks as $mark) {
            EventRequirementFileReview::updateOrCreate(
                ['event_requirement_file_id' => (int) $mark['id'], 'stage' => $stage],
                [
                    'status' => $mark['status'],
                    'note' => $mark['status'] === 'ok' ? null : trim((string) $mark['note']),
                    'reviewed_by' => $reviewerId,
                ],
            );
        }

        if ($decision === 'approved' && EventRequirementFileReview::where('stage', $stage)
            ->where('status', 'needs_changes')
            ->whereIn('event_requirement_file_id', EventRequirementFile::where('event_id', $approval->entity_id)->select('id'))
            ->exists()) {
            throw new DomainException(self::MARK_FIRST_MESSAGE);
        }

        // A file nobody marked is not Accepted either, so approving waits until every file has an ok mark at this step.
        if ($decision === 'approved' && EventRequirementFile::where('event_id', $approval->entity_id)
            ->whereDoesntHave('reviews', fn ($reviews) => $reviews->where('stage', $stage)->where('status', 'ok'))
            ->exists()) {
            throw new DomainException(self::MARK_FIRST_MESSAGE);
        }
    }
}
