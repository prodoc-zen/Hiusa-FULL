<?php

namespace App\Services;

use App\Models\ComplianceRequirementType;
use App\Models\OrganizationApplication;
use Illuminate\Support\Collection;

/**
 * One shape for an application, read by the applicant on their own page and by the dean and the SAO
 * in the review queue. Files are never linked directly: every open_url is an API path that checks
 * who is asking and streams from the private disk.
 */
class OrganizationApplicationPresenter
{
    /** The status an application sits in while each reviewer's notes are still a draft nobody has acted on. */
    private const STAGE_WAITING_STATUS = ['dean' => 'pending_dean', 'sao' => 'pending_sao'];

    public const STAGE_LABEL = ['dean' => 'Department Head', 'sao' => 'SAO'];

    public function brief(OrganizationApplication $application): array
    {
        return [
            ...$application->only(['id', 'name', 'acronym', 'status', 'round', 'position_title', 'college_id', 'school_id', 'submitted_at', 'endorsed_at', 'returned_by_role', 'returned_at', 'reviewed_at', 'remarks', 'organization_id', 'required_documents_count']),
            'college' => $application->college?->only(['id', 'name']),
            'applicant' => $this->person($application),
        ];
    }

    /**
     * @param  string  $prefix  API path the file links hang from, e.g. /my/organization-applications or /organization-applications
     * @param  Collection<int, ComplianceRequirementType>|null  $extraTypes  requirements to list even when no file was uploaded for them yet
     * @param  string|null  $reviewerStage  the stage of the reviewer reading it; while the application waits for that stage, its earlier accepted marks on files the applicant did not change come back as accepted. The applicant is shown the accepted marks of both stages, with no note, because they saw each when it was returned.
     */
    public function detail(OrganizationApplication $application, string $prefix, bool $forApplicant, ?Collection $extraTypes = null, ?string $reviewerStage = null): array
    {
        $application->loadMissing(['college', 'documents.requirementType', 'applicant']);
        $round = $application->round;
        $reviews = $application->requirementReviews()->where('round', $round)->orderBy('id')->get()
            ->filter(fn ($review) => ! $forApplicant || $this->stageVisible($application, $review->stage))
            ->concat($forApplicant ? $this->carriedForApplicant($application) : $this->carriedForward($application, $reviewerStage))
            ->groupBy('requirement_type_id');
        $files = $application->reviewFiles()->where('round', $round)->orderBy('id')->with('uploader:school_id,first_name,last_name')->get()
            ->filter(fn ($file) => ! $forApplicant || $this->stageVisible($application, $file->stage));
        $documents = $application->documents->keyBy('requirement_type_id');
        $types = $application->documents->map->requirementType->filter()->merge($extraTypes ?? collect())->unique('id')->sortBy('id');

        return [
            ...$this->brief($application),
            'description' => $application->description,
            'endorsement_note' => $forApplicant && ! $this->stageVisible($application, 'dean') ? null : $application->endorsement_note,
            'requirements' => $types->map(function (ComplianceRequirementType $type) use ($documents, $reviews, $files, $application, $prefix) {
                $document = $documents->get($type->id);

                return [
                    ...$type->only(['id', 'name', 'description', 'template_original_name', 'template_url']),
                    'allowed_extensions' => $type->acceptedExtensions(),
                    'document' => $document ? ['id' => $document->id, 'name' => $document->file_original_name, 'open_url' => "{$prefix}/{$application->id}/documents/{$document->id}"] : null,
                    'reviews' => ($reviews->get($type->id) ?? collect())->map(fn ($review) => [
                        'stage' => $review->stage, 'stage_label' => self::STAGE_LABEL[$review->stage] ?? $review->stage, 'status' => $review->status, 'note' => $review->note,
                        ...($review->carried ? ['carried' => true] : []),
                    ])->values(),
                    'review_files' => $files->where('requirement_type_id', $type->id)->map(fn ($file) => $this->file($file, $application, $prefix))->values(),
                ];
            })->values(),
            'review_files' => $files->whereNull('requirement_type_id')->map(fn ($file) => $this->file($file, $application, $prefix))->values(),
        ];
    }

    /** What the applicant is shown after sending again: every earlier acceptance that still holds, from either stage, as a flag with no note. */
    private function carriedForApplicant(OrganizationApplication $application): Collection
    {
        return collect(array_keys(self::STAGE_WAITING_STATUS))
            ->flatMap(fn (string $stage) => $this->carriedForward($application, $stage, true))
            ->values();
    }

    /**
     * The reviewer's accepted marks from earlier rounds that still hold. A document row is never edited: replacing a file deletes the
     * row and stores a new one, so a document created before the mark was made is the very file that was accepted. A requirement
     * that any stage returned in the round just ended, or whose latest mark in this stage is not an acceptance, is never carried.
     */
    private function carriedForward(OrganizationApplication $application, ?string $stage, bool $anyStatus = false): Collection
    {
        if (! $stage || (! $anyStatus && $application->status !== (self::STAGE_WAITING_STATUS[$stage] ?? null)) || $application->round < 2) {
            return collect();
        }
        $current = $application->requirementReviews()->where('round', $application->round)->where('stage', $stage)->pluck('requirement_type_id');
        $returned = $application->requirementReviews()->where('round', $application->round - 1)->where('status', '!=', 'ok')->pluck('requirement_type_id');
        $documents = $application->documents->keyBy('requirement_type_id');

        return $application->requirementReviews()->where('stage', $stage)->where('round', '<', $application->round)
            ->orderByDesc('round')->orderByDesc('id')->get()
            ->unique('requirement_type_id')
            ->reject(fn ($review) => $current->contains($review->requirement_type_id) || $returned->contains($review->requirement_type_id))
            ->filter(fn ($review) => $review->status === 'ok' && $documents->get($review->requirement_type_id)?->created_at?->lt($review->updated_at))
            ->map(function ($review) use ($application) {
                $carried = $review->replicate()->forceFill(['round' => $application->round, 'note' => null]);
                $carried->setAttribute('carried', true);

                return $carried;
            })->values();
    }

    private function file($file, OrganizationApplication $application, string $prefix): array
    {
        $uploader = $file->uploader;

        return [
            'id' => $file->id,
            'name' => $file->file_original_name,
            'stage' => $file->stage,
            'stage_label' => self::STAGE_LABEL[$file->stage] ?? $file->stage,
            'uploaded_by' => $uploader ? trim("{$uploader->first_name} {$uploader->last_name}") : null,
            'uploaded_at' => $file->created_at,
            'open_url' => "{$prefix}/{$application->id}/review-files/{$file->id}",
        ];
    }

    /** The applicant reads a reviewer's notes and attachments only once that reviewer's stage is over. */
    public function stageVisible(OrganizationApplication $application, string $stage): bool
    {
        return $application->status !== (self::STAGE_WAITING_STATUS[$stage] ?? null);
    }

    private function person(OrganizationApplication $application): array
    {
        $user = $application->applicant;

        return [
            'school_id' => $application->school_id,
            'name' => $user ? trim("{$user->first_name} {$user->last_name}") : trim("{$application->first_name} {$application->last_name}"),
            'email' => $user?->email ?? $application->email,
        ];
    }
}
