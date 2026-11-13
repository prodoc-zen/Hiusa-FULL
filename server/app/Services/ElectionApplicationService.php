<?php

namespace App\Services;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionPosition;
use App\Models\Notification;
use App\Models\Partylist;
use App\Models\User;
use App\Support\AdviserPosition;
use App\Support\YearLevel;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * The rules of candidacy filing and screening: who may run, for what, what a complete application holds, where its
 * documents live and what a screening decision does. The controller only reads the request and answers.
 */
class ElectionApplicationService
{
    public const DOCUMENT_KINDS = ['coc', 'credentials'];

    public const STATUSES = ['draft', 'pending_review', 'for_revision', 'approved', 'rejected', 'withdrawn'];

    /** Phases in which a candidacy can still be withdrawn: voting has not opened. */
    private const WITHDRAWABLE_PHASES = ['scheduled', 'filing', 'screening', 'campaign'];

    public function __construct(private readonly OrganizationRecipients $recipients) {}

    /** Stops the request with a plain message, the way the other election endpoints answer a refusal. */
    public static function refuse(string $message, int $status = 422): never
    {
        throw new HttpResponseException(response()->json(['message' => $message], $status));
    }

    /** A filing election among the organizations the caller reads or votes in, or a 404. */
    public function memberElection(User $user, mixed $id): Election
    {
        $election = Election::whereIn('organization_id', $user->electionOrganizationIds())->find($id);

        if (! $election || ! $election->usesFiling()) {
            self::refuse('Election not found.', 404);
        }

        return $election;
    }

    /** A filing election of the Admin's own organization, or a 404. */
    public function adminElection(User $user, mixed $id): Election
    {
        $election = Election::where('organization_id', $user->organization_id)->find($id);

        if (! $election || ! $election->usesFiling()) {
            self::refuse('Election not found.', 404);
        }

        return $election;
    }

    /** Every action needs an approved election that nothing has paused. */
    public function assertRunning(Election $election): void
    {
        if ($election->approved_at === null) {
            self::refuse('This election has not been approved yet.', 409);
        }

        if ($election->isHalted()) {
            self::refuse('This election is '.($election->cancelled_at !== null ? 'cancelled' : 'suspended').'.', 409);
        }
    }

    public function assertPhase(Election $election, string $phase, string $message): void
    {
        if ($election->phase !== $phase) {
            self::refuse($message, 409);
        }
    }

    public function assertCanWithdrawIn(Election $election): void
    {
        if (! in_array($election->phase, self::WITHDRAWABLE_PHASES, true) || $election->openRound() !== null) {
            self::refuse('A candidacy cannot be withdrawn once voting has opened.', 409);
        }
    }

    /** Who may be a candidate: a voting member of the organization who is not its faculty adviser. */
    public function assertMayRun(Election $election, int $schoolId, ?string $name = null): void
    {
        $member = AccountProfile::votingMembers()
            ->where('account_profiles.organization_id', $election->organization_id)
            ->where('account_profiles.user_school_id', $schoolId)
            ->where(fn ($title) => AdviserPosition::whereNot($title, 'account_profiles.position_title'))
            ->exists();

        if (! $member) {
            self::refuse(($name ? $name.' is' : 'You are').' not a voting member of this organization, so '.($name ? 'they' : 'you').' cannot run in its election.');
        }
    }

    public function position(Election $election, int $positionId): ElectionPosition
    {
        $position = ElectionPosition::where('election_id', $election->id)->where('is_active', true)->find($positionId);

        if (! $position) {
            self::refuse('Choose a position from this election.');
        }

        return $position;
    }

    /** The position's own limits: year levels and the executive rule. A student with no year level on record may file. */
    public function assertEligible(ElectionPosition $position, ?User $student, ?string $name = null): void
    {
        $year = YearLevel::parse($student?->year_level);
        $who = $name ? $name : 'You';

        if ($year === null) {
            return;
        }

        if ($position->is_executive && $year >= 4) {
            self::refuse($name ? $name.' is a fourth year student. Fourth year students cannot run for an executive position.' : 'Fourth year students cannot run for an executive position.');
        }

        $levels = array_map('intval', $position->eligible_year_levels ?? []);
        if ($levels !== [] && ! in_array($year, $levels, true)) {
            self::refuse($who.' '.($name ? 'is' : 'are').' not in a year level that may run for this position. It is open to '.implode(', ', array_map(fn (int $level) => YearLevel::label($level), $levels)).' students.');
        }
    }

    /** What a student's earlier row in this election means for a new filing: a withdrawn one is reused, any other refuses. */
    public function reusableRow(Election $election, int $schoolId, bool $self = true): ?ElectionApplication
    {
        $existing = ElectionApplication::where('election_id', $election->id)->where('user_school_id', $schoolId)->first();

        if ($existing === null || $existing->status === 'withdrawn') {
            return $existing;
        }

        if ($existing->status === 'rejected') {
            self::refuse(($self ? 'Your' : 'Their').' application was rejected and cannot be filed again.');
        }

        self::refuse(($self ? 'You already have' : 'They already have').' an application in this election.');
    }

    /** At the position's seat count a party list cannot take another member for it. */
    public function assertSeatAvailable(Partylist $slate, ElectionPosition $position, ?int $exceptApplicationId = null): void
    {
        $taken = ElectionApplication::where('partylist_id', $slate->id)
            ->where('position_id', $position->id)
            ->whereNotIn('status', ['withdrawn', 'rejected'])
            ->when($exceptApplicationId, fn ($query) => $query->where('id', '!=', $exceptApplicationId))
            ->count();

        if ($taken >= max(1, (int) $position->max_winners)) {
            self::refuse('This party list already has '.$taken.' '.Str::plural('member', $taken).' for '.$position->title.', which is every seat.');
        }
    }

    /**
     * Stores the uploaded documents: the photo on the public disk with the other candidate photos, the certificate of
     * candidacy and credentials on the private local disk, never reachable by a URL.
     *
     * @return array<string, string> the columns to set, only for the files that came with the request
     */
    public function storeDocuments(Request $request, Election $election): array
    {
        $columns = [];

        if ($request->hasFile('photo')) {
            $columns['photo_url'] = Storage::url($request->file('photo')->store('candidates', 'public'));
        }

        foreach (self::DOCUMENT_KINDS as $kind) {
            if ($request->hasFile($kind)) {
                /** @var UploadedFile $file */
                $file = $request->file($kind);
                $columns[$kind.'_path'] = Storage::disk('local')->putFile('election-applications/'.$election->organization_id.'/'.$election->id, $file);
            }
        }

        return $columns;
    }

    /** Deletes files that a replacement or a failed save left behind. */
    public function discardDocuments(array $columns): void
    {
        foreach ($columns as $column => $value) {
            if ($column === 'photo_url') {
                $this->deletePhoto($value);
            } elseif ($value) {
                Storage::disk('local')->delete($value);
            }
        }
    }

    public function deletePhoto(?string $photoUrl): void
    {
        if ($photoUrl && str_starts_with($photoUrl, '/storage/candidates/')) {
            Storage::disk('public')->delete(ltrim(str_replace('/storage/', '', $photoUrl), '/'));
        }
    }

    /**
     * Puts newly stored documents on a row. The files they replace are returned, and the caller discards them once the
     * row is saved, so a failed save keeps the old ones.
     *
     * @return array<string, string> the replaced files, by column
     */
    public function applyDocuments(ElectionApplication $application, array $columns): array
    {
        $replaced = array_filter(
            array_intersect_key($application->getAttributes(), $columns),
            fn ($value, $column) => $value && $value !== $columns[$column],
            ARRAY_FILTER_USE_BOTH
        );
        $application->fill($columns);

        return $replaced;
    }

    public function hasAllDocuments(ElectionApplication $application): bool
    {
        return $application->photo_url && $application->coc_path && $application->credentials_path;
    }

    /** Which of the three documents a draft still lacks, in plain words. */
    public function missingDocuments(ElectionApplication $application): array
    {
        return array_keys(array_filter([
            'photo' => ! $application->photo_url,
            'certificate of candidacy' => ! $application->coc_path,
            'credentials' => ! $application->credentials_path,
        ]));
    }

    public function isApplicantOrRepresentative(ElectionApplication $application, User $user): bool
    {
        return (int) $application->user_school_id === (int) $user->school_id || (int) $application->submitted_by === (int) $user->school_id;
    }

    public function userNamed(int $schoolId): ?User
    {
        return User::where('school_id', $schoolId)->first(['school_id', 'first_name', 'last_name', 'year_level', 'program']);
    }

    public function nameOf(?User $user): string
    {
        return trim(($user?->first_name ?? '').' '.($user?->last_name ?? ''));
    }

    /** The application as the screens read it. Open URLs are given only to a reader who may open the private files. */
    public function present(ElectionApplication $application, bool $withUrls = false): array
    {
        $application->loadMissing(['user:school_id,first_name,last_name,year_level,program', 'position:id,title,is_executive', 'partylist:id,name,motto,color']);
        $base = '/elections/'.$application->election_id.'/applications/'.$application->id.'/files/';

        return [
            'id' => $application->id,
            'election_id' => $application->election_id,
            'user_id' => $application->user_school_id,
            'school_id' => $application->user_school_id,
            'user_name' => $this->nameOf($application->user),
            'program' => $application->user?->program,
            'year_level' => $application->user?->year_level,
            'year_level_missing' => YearLevel::parse($application->user?->year_level) === null,
            'position_id' => $application->position_id,
            'position_title' => $application->position?->title,
            'partylist_id' => $application->partylist_id,
            'partylist_name' => $application->partylist?->name,
            'submitted_by' => $application->submitted_by,
            'status' => $application->status,
            'platform' => $application->platform,
            'photo_url' => $application->photo_url,
            'has_coc' => (bool) $application->coc_path,
            'has_credentials' => (bool) $application->credentials_path,
            'rules_version' => $application->rules_version,
            'rules_accepted_at' => $application->rules_accepted_at,
            'submitted_at' => $application->submitted_at,
            'review_notes' => $application->review_notes,
            'reviewed_at' => $application->reviewed_at,
            'candidate_id' => $application->candidate_id,
            'open_urls' => $withUrls ? [
                'coc' => $application->coc_path ? $base.'coc' : null,
                'credentials' => $application->credentials_path ? $base.'credentials' : null,
            ] : null,
        ];
    }

    /** The party list a representative runs, with every member and where that member's application stands. */
    public function presentSlate(Partylist $slate): array
    {
        $members = ElectionApplication::where('partylist_id', $slate->id)->orderBy('id')->get()
            ->map(fn (ElectionApplication $member) => $this->present($member, true))
            ->all();

        return [
            'id' => $slate->id,
            'name' => $slate->name,
            'motto' => $slate->motto,
            'color' => $slate->color,
            'banner_url' => $slate->banner_url,
            'election_id' => $slate->election_id,
            'representative_school_id' => $slate->representative_school_id,
            'members' => $members,
        ];
    }

    public function counts(Election $election): array
    {
        $counts = ElectionApplication::where('election_id', $election->id)
            ->selectRaw('status, COUNT(*) as total')->groupBy('status')->pluck('total', 'status');

        return collect(self::STATUSES)->mapWithKeys(fn (string $status) => [$status => (int) ($counts[$status] ?? 0)])->all();
    }

    /** Hands a draft to the Admin for screening. */
    public function submit(Request $request, Election $election, ElectionApplication $application, bool $resubmission = false): void
    {
        $application->forceFill(['status' => 'pending_review', 'submitted_at' => now()])->save();

        $this->notifyAdmins($election, 'Candidacy application received',
            $this->nameOf($this->userNamed((int) $application->user_school_id)).' '.($resubmission ? 'replaced the documents of the application for ' : 'filed a candidacy for ').$this->positionTitle($application).' in "'.$election->title.'". It is waiting for screening.');
        $this->audit($request, $election, 'application_submitted', null, [
            'application_id' => $application->id,
            'position_id' => $application->position_id,
            'user_school_id' => $application->user_school_id,
            'resubmitted' => $resubmission,
        ]);
    }

    /** Withdraws an application. The official list loses the candidate row that an approval had made. */
    public function withdraw(Request $request, Election $election, ElectionApplication $application): void
    {
        DB::transaction(function () use ($application) {
            $candidateId = $application->candidate_id;
            $application->forceFill(['status' => 'withdrawn', 'candidate_id' => null])->save();

            if ($candidateId) {
                Candidate::where('election_id', $application->election_id)->whereKey($candidateId)->delete();
            }
        });

        $this->audit($request, $election, 'application_withdrawn', ['status' => $application->getOriginal('status')], [
            'application_id' => $application->id,
            'position_id' => $application->position_id,
            'user_school_id' => $application->user_school_id,
        ]);
    }

    /**
     * A screening decision. Approving makes the official candidate row and is safe to repeat; the other two only move
     * the application. The candidate and, when someone else filed for them, the representative are told.
     *
     * @return ElectionApplication the application after the decision
     */
    public function review(Request $request, Election $election, int $applicationId, string $decision, ?string $notes): ElectionApplication
    {
        $reviewer = $request->user();

        $application = DB::transaction(function () use ($election, $applicationId, $decision, $notes, $reviewer) {
            $application = ElectionApplication::where('election_id', $election->id)->lockForUpdate()->find($applicationId);

            if (! $application) {
                self::refuse('Application not found.', 404);
            }

            if ($decision === 'approve' && $application->status === 'approved') {
                return $application->setAttribute('already_decided', true);
            }

            if ($application->status !== 'pending_review') {
                self::refuse('This application is not waiting for a decision.', 409);
            }

            $application->forceFill([
                'status' => ['approve' => 'approved', 'correction' => 'for_revision', 'reject' => 'rejected'][$decision],
                'review_notes' => $notes,
                'reviewed_by' => $reviewer->school_id,
                'reviewed_at' => now(),
            ]);

            if ($decision === 'approve') {
                $candidate = Candidate::firstOrCreate(
                    ['election_id' => $election->id, 'user_id' => $application->user_school_id],
                    [
                        'position_id' => $application->position_id,
                        'partylist_id' => $application->partylist_id,
                        'platform' => $application->platform,
                        'image_url' => $application->photo_url,
                    ]
                );
                $application->candidate_id = $candidate->id;
            }

            $application->save();

            return $application;
        });

        if ($application->getAttribute('already_decided')) {
            return $application;
        }

        $this->notifyDecision($election, $application, $decision, $notes);
        $this->audit($request, $election, 'application_reviewed', ['status' => 'pending_review'], [
            'application_id' => $application->id,
            'position_id' => $application->position_id,
            'user_school_id' => $application->user_school_id,
            'decision' => $decision,
            'notes' => $notes,
        ]);

        return $application;
    }

    private function notifyDecision(Election $election, ElectionApplication $application, string $decision, ?string $notes): void
    {
        $position = $this->positionTitle($application);
        $name = $this->nameOf($this->userNamed((int) $application->user_school_id));
        $where = ' for '.$position.' in "'.$election->title.'"';
        [$title, $own, $theirs] = match ($decision) {
            'approve' => ['Candidacy approved', 'was approved. You are now on the official list.', 'was approved. The candidate is now on the official list.'],
            'correction' => ['Candidacy needs a correction', 'needs a correction: '.$notes.'. Replace the documents before screening ends.', 'needs a correction: '.$notes.'. Replace the documents before screening ends.'],
            'reject' => ['Candidacy rejected', 'was rejected: '.$notes, 'was rejected: '.$notes],
        };

        $this->notifyUser($election, (int) $application->user_school_id, $title, 'Your application'.$where.' '.$own);

        if ($application->submitted_by !== null && (int) $application->submitted_by !== (int) $application->user_school_id) {
            $this->notifyUser($election, (int) $application->submitted_by, $title, 'The application of '.$name.$where.' '.$theirs);
        }
    }

    public function notifyUser(Election $election, int $schoolId, string $title, string $message): void
    {
        Notification::create([
            'organization_id' => $election->organization_id,
            'user_id' => $schoolId,
            'title' => $title,
            'message' => $message,
            'notification_type' => 'election',
            'reference_type' => 'election',
            'reference_id' => $election->id,
            'is_read' => false,
            'sent_at' => now(),
        ]);
    }

    public function notifyAdmins(Election $election, string $title, string $message): void
    {
        $rows = $this->recipients->administrators($election->organization_id)->map(fn ($admin) => [
            'organization_id' => $election->organization_id,
            'user_id' => $admin->user_school_id,
            'title' => $title,
            'message' => $message,
            'notification_type' => 'election',
            'reference_type' => 'election',
            'reference_id' => $election->id,
            'is_read' => false,
            'sent_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ])->all();

        if ($rows !== []) {
            Notification::insert($rows);
        }
    }

    /** Audit rows name the election as the record and carry the actor's school id, which outlives later role changes. */
    public function audit(Request $request, Election $election, string $action, ?array $oldValues, ?array $newValues): void
    {
        AuditLog::create([
            'organization_id' => $election->organization_id,
            'user_id' => $request->user()?->school_id,
            'module' => 'elections',
            'action' => $action,
            'record_type' => Election::class,
            'record_id' => $election->id,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }

    public function positionTitle(ElectionApplication $application): string
    {
        return $application->position?->title ?? ElectionPosition::whereKey($application->position_id)->value('title') ?? 'a position';
    }

    /** Stores a party list banner under public/uploads/partylists, where the other party list banners are. */
    public function storeBanner(UploadedFile $file): string
    {
        $filename = Str::uuid()->toString().'.'.strtolower($file->extension() ?: 'jpg');
        $destination = public_path('uploads/partylists');

        if (! is_dir($destination)) {
            mkdir($destination, 0755, true);
        }

        $file->move($destination, $filename);

        return '/uploads/partylists/'.$filename;
    }

    public function deleteBanner(?string $bannerUrl): void
    {
        if ($bannerUrl && str_starts_with($bannerUrl, '/uploads/partylists/')) {
            $path = public_path(ltrim($bannerUrl, '/'));
            if (is_file($path)) {
                @unlink($path);
            }
        }
    }
}
