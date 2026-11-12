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
     * Saves the marks sent with a decision. Approving is refused while any file of the event still
     * says Needs changes at this step, whether the mark arrived now or on an earlier return.
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
    }
}
