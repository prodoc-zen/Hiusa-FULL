<?php

namespace App\Http\Controllers;

use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionPosition;
use App\Models\Partylist;
use App\Models\User;
use App\Services\ElectionApplicationService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Throwable;

/**
 * Candidacy filing and screening. A voting member files alone or as the representative of a party list; the Admin
 * screens one application at a time and an approval becomes a row of the official candidate list.
 */
class ElectionApplicationController extends Controller
{
    private const APPLICATION_NOT_FOUND = 'Application not found.';

    public function __construct(private readonly ElectionApplicationService $applications) {}

    /** The Admin's screening list, and the officer's read only copy of it. */
    public function index(Request $request, $id)
    {
        $user = $request->user();
        $election = $this->applications->adminElection($user, $id);
        $withUrls = $user->role === 'ADMIN';

        $rows = ElectionApplication::where('election_id', $election->id)
            ->orderByRaw("CASE status WHEN 'pending_review' THEN 0 WHEN 'for_revision' THEN 1 WHEN 'approved' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END")
            ->orderBy('submitted_at')->orderBy('id')
            ->get();

        return response()->json([
            'applications' => $rows->map(fn (ElectionApplication $application) => $this->applications->present($application, $withUrls))->all(),
            'counts' => $this->applications->counts($election),
        ]);
    }

    /** The caller's own application, and the party list they represent with every member's status. */
    public function mine(Request $request, $id)
    {
        $user = $request->user();
        $election = $this->applications->memberElection($user, $id);

        $application = ElectionApplication::where('election_id', $election->id)->where('user_school_id', $user->school_id)->first();
        $slate = Partylist::where('election_id', $election->id)->where('representative_school_id', $user->school_id)->first();

        return response()->json([
            'application' => $application ? $this->applications->present($application, true) : null,
            'slate' => $slate ? $this->applications->presentSlate($slate) : null,
        ]);
    }

    /** Files the caller's own candidacy: a draft, or straight to screening with submit and all three documents. */
    public function store(Request $request, $id)
    {
        $user = $request->user();
        $election = $this->applications->memberElection($user, $id);
        $this->applications->assertRunning($election);
        $this->applications->assertPhase($election, 'filing', 'Candidacy filing is not open for this election.');

        $submit = $request->boolean('submit');
        $data = $request->validate([
            'position_id' => ['required', 'integer'],
            'platform' => ['nullable', 'string', 'max:2000'],
            'rules_accepted' => ['accepted'],
            'submit' => ['nullable', 'boolean'],
            ...$this->documentRules($submit),
        ], $this->messages());

        $position = $this->applications->position($election, (int) $data['position_id']);
        $this->applications->assertMayRun($election, $user->school_id);
        $this->applications->assertEligible($position, $user);
        $existing = $this->applications->reusableRow($election, $user->school_id);

        $application = $this->saveApplication($request, $election, $existing, $user->school_id, $position, null, $user, $data['platform'] ?? null);
        if ($submit) {
            $this->applications->submit($request, $election, $application);
        }

        return response()->json($this->applications->present($application->fresh(), true), 201);
    }

    /** A draft changes freely during filing; a correction replaces documents only and goes back to screening. */
    public function update(Request $request, $id, $application)
    {
        $user = $request->user();
        $election = $this->applications->memberElection($user, $id);
        $this->applications->assertRunning($election);
        $row = $this->ownedApplication($election, $application, $user);

        if ($row->status === 'draft') {
            $this->applications->assertPhase($election, 'filing', 'An application can be changed only while filing is open.');
        } elseif ($row->status === 'for_revision') {
            $this->applications->assertPhase($election, 'screening', 'Corrections can be made only while screening is open.');
            if ($request->hasAny(['position_id', 'platform'])) {
                ElectionApplicationService::refuse('Only the documents can be replaced.');
            }
        } else {
            ElectionApplicationService::refuse('This application can no longer be changed.', 409);
        }

        $data = $request->validate([
            'position_id' => ['sometimes', 'integer'],
            'platform' => ['sometimes', 'nullable', 'string', 'max:2000'],
            ...$this->documentRules(false),
        ], $this->messages());

        $wasCorrection = $row->status === 'for_revision';
        if ($wasCorrection && ! $request->hasFile('photo') && ! $request->hasFile('coc') && ! $request->hasFile('credentials')) {
            ElectionApplicationService::refuse('Choose at least one document to replace.');
        }

        if (! $wasCorrection && isset($data['position_id']) && (int) $data['position_id'] !== (int) $row->position_id) {
            $position = $this->applications->position($election, (int) $data['position_id']);
            $applicant = $this->applications->userNamed((int) $row->user_school_id);
            $own = (int) $row->user_school_id === (int) $user->school_id;
            $this->applications->assertEligible($position, $applicant, $own ? null : $this->applications->nameOf($applicant));
            if ($row->partylist_id) {
                $this->applications->assertSeatAvailable($row->partylist, $position, $row->id);
            }
            $row->position_id = $position->id;
        }
        if (! $wasCorrection && array_key_exists('platform', $data)) {
            $row->platform = $data['platform'];
        }

        $documents = $this->applications->storeDocuments($request, $election);
        $replaced = $this->applications->applyDocuments($row, $documents);

        try {
            $row->save();
        } catch (Throwable $error) {
            $this->applications->discardDocuments($documents);

            throw $error;
        }
        $this->applications->discardDocuments($replaced);

        if ($wasCorrection) {
            $this->applications->submit($request, $election, $row, true);
        }

        return response()->json($this->applications->present($row->fresh(), true));
    }

    /** Sends a complete draft to screening. */
    public function submit(Request $request, $id, $application)
    {
        $user = $request->user();
        $election = $this->applications->memberElection($user, $id);
        $this->applications->assertRunning($election);
        $this->applications->assertPhase($election, 'filing', 'Applications can be submitted only while filing is open.');
        $row = $this->ownedApplication($election, $application, $user);

        if ($row->status !== 'draft') {
            ElectionApplicationService::refuse('Only a draft can be submitted.', 409);
        }

        $missing = $this->applications->missingDocuments($row);
        if ($missing !== []) {
            ElectionApplicationService::refuse('Add the missing documents before submitting: '.implode(', ', $missing).'.');
        }

        $this->applications->submit($request, $election, $row);

        return response()->json($this->applications->present($row->fresh(), true));
    }

    /** The applicant, or the representative who listed them, withdraws before voting opens. */
    public function withdraw(Request $request, $id, $application)
    {
        $user = $request->user();
        $election = $this->applications->memberElection($user, $id);
        $this->applications->assertRunning($election);
        $row = $this->ownedApplication($election, $application, $user);

        if (! in_array($row->status, ['draft', 'pending_review', 'for_revision', 'approved'], true)) {
            ElectionApplicationService::refuse('This application is already closed.', 409);
        }

        $this->applications->assertCanWithdrawIn($election);
        $this->applications->withdraw($request, $election, $row);

        return response()->json($this->applications->present($row->fresh(), true));
    }

    /** A private document, inline, only for the applicant, the representative who filed it, or an Admin of the organization. */
    public function file(Request $request, $id, $application, $kind)
    {
        $user = $request->user();
        $election = $this->applications->memberElection($user, $id);
        $row = ElectionApplication::where('election_id', $election->id)->find($application);

        if (! $row || ! in_array($kind, ElectionApplicationService::DOCUMENT_KINDS, true)) {
            return response()->json(['message' => self::APPLICATION_NOT_FOUND], 404);
        }

        $isAdmin = $user->role === 'ADMIN' && (int) $election->organization_id === (int) $user->organization_id;
        if (! $isAdmin && ! $this->applications->isApplicantOrRepresentative($row, $user)) {
            abort(403);
        }

        $path = $row->{$kind.'_path'};
        if (! $path || ! Storage::disk('local')->exists($path)) {
            return response()->json(['message' => 'Document not found.'], 404);
        }

        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $response = response()->file(Storage::disk('local')->path($path), [
            'Content-Type' => ['pdf' => 'application/pdf', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg'][$extension] ?? 'application/octet-stream',
            'X-Content-Type-Options' => 'nosniff',
        ]);
        $response->setContentDisposition('inline', $kind.'-'.$row->id.'.'.$extension);
        $response->setPrivate();
        $response->headers->addCacheControlDirective('no-store');

        return $response;
    }

    /** The caller becomes the representative of a new party list for this election. */
    public function slateStore(Request $request, $id)
    {
        $user = $request->user();
        $election = $this->applications->memberElection($user, $id);
        $this->applications->assertRunning($election);
        $this->applications->assertPhase($election, 'filing', 'Candidacy filing is not open for this election.');

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', Rule::unique('partylists', 'name')->where(fn ($query) => $query->where('organization_id', $election->organization_id))],
            'motto' => ['required', 'string', 'max:255'],
            'color' => ['required', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'banner' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
            'rules_accepted' => ['accepted'],
        ], $this->messages());

        $this->applications->assertMayRun($election, $user->school_id);
        if (Partylist::where('election_id', $election->id)->where('representative_school_id', $user->school_id)->exists()) {
            ElectionApplicationService::refuse('You already represent a party list in this election.');
        }

        $bannerUrl = $request->hasFile('banner') ? $this->applications->storeBanner($request->file('banner')) : null;

        try {
            $slate = Partylist::create([
                'name' => $data['name'],
                'organization_id' => $election->organization_id,
                'election_id' => $election->id,
                'representative_school_id' => $user->school_id,
                'motto' => $data['motto'],
                'color' => strtoupper($data['color']),
                'banner_url' => $bannerUrl,
            ]);
        } catch (UniqueConstraintViolationException) {
            $this->applications->deleteBanner($bannerUrl);

            return response()->json(['message' => 'A party list with this name already exists.'], 422);
        }

        return response()->json($this->applications->presentSlate($slate), 201);
    }

    public function slateUpdate(Request $request, $id, $partylist)
    {
        $user = $request->user();
        $election = $this->applications->memberElection($user, $id);
        $this->applications->assertRunning($election);
        $slate = $this->representedSlate($election, $partylist, $user);
        $this->applications->assertPhase($election, 'filing', 'A party list can be changed only while filing is open.');

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255', Rule::unique('partylists', 'name')->ignore($slate->id)->where(fn ($query) => $query->where('organization_id', $election->organization_id))],
            'motto' => ['sometimes', 'string', 'max:255'],
            'color' => ['sometimes', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'banner' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ], $this->messages());

        $oldBanner = $slate->banner_url;
        $slate->fill(array_intersect_key($data, array_flip(['name', 'motto'])));
        if (isset($data['color'])) {
            $slate->color = strtoupper($data['color']);
        }
        if ($request->hasFile('banner')) {
            $slate->banner_url = $this->applications->storeBanner($request->file('banner'));
        }

        try {
            $slate->save();
        } catch (UniqueConstraintViolationException) {
            if ($slate->banner_url !== $oldBanner) {
                $this->applications->deleteBanner($slate->banner_url);
            }

            return response()->json(['message' => 'A party list with this name already exists.'], 422);
        }

        if ($slate->banner_url !== $oldBanner) {
            $this->applications->deleteBanner($oldBanner);
        }

        return response()->json($this->applications->presentSlate($slate->fresh()));
    }

    /** The representative lists one member for one position, with that member's own documents. */
    public function slateMemberStore(Request $request, $id, $partylist)
    {
        $user = $request->user();
        $election = $this->applications->memberElection($user, $id);
        $this->applications->assertRunning($election);
        $slate = $this->representedSlate($election, $partylist, $user);
        $this->applications->assertPhase($election, 'filing', 'Candidacy filing is not open for this election.');

        $data = $request->validate([
            'user_id' => ['required', 'integer', 'exists:users,school_id'],
            'position_id' => ['required', 'integer'],
            'platform' => ['nullable', 'string', 'max:2000'],
            ...$this->documentRules(false),
        ], $this->messages());

        $memberId = (int) $data['user_id'];
        $member = $this->applications->userNamed($memberId);
        $name = $memberId === (int) $user->school_id ? null : $this->applications->nameOf($member);
        $position = $this->applications->position($election, (int) $data['position_id']);
        $this->applications->assertMayRun($election, $memberId, $name);
        $this->applications->assertEligible($position, $member, $name);
        $existing = $this->applications->reusableRow($election, $memberId, $name === null);
        $this->applications->assertSeatAvailable($slate, $position, $existing?->id);

        $application = $this->saveApplication($request, $election, $existing, $memberId, $position, $slate, $user, $data['platform'] ?? null);

        if ($memberId !== (int) $user->school_id) {
            $this->applications->notifyUser($election, $memberId, 'You were listed as a candidate', 'You were listed as a candidate for '.$position->title.' under '.$slate->name.'.');
        }

        return response()->json($this->applications->present($application->fresh(), true), 201);
    }

    /**
     * Sends every complete draft of the party list to screening. Members with missing documents stay drafts and are
     * named, so the representative knows exactly whom to finish.
     */
    public function slateSubmit(Request $request, $id, $partylist)
    {
        $user = $request->user();
        $election = $this->applications->memberElection($user, $id);
        $this->applications->assertRunning($election);
        $slate = $this->representedSlate($election, $partylist, $user);
        $this->applications->assertPhase($election, 'filing', 'Applications can be submitted only while filing is open.');

        $drafts = ElectionApplication::where('partylist_id', $slate->id)->where('status', 'draft')->orderBy('id')->get();
        if ($drafts->isEmpty()) {
            ElectionApplicationService::refuse('Add at least one member with a draft application before submitting.');
        }

        $complete = $drafts->filter(fn (ElectionApplication $draft) => $this->applications->hasAllDocuments($draft));
        $incomplete = $drafts->reject(fn (ElectionApplication $draft) => $this->applications->hasAllDocuments($draft));
        $complete->each(fn (ElectionApplication $draft) => $this->applications->submit($request, $election, $draft));

        if ($incomplete->isNotEmpty()) {
            $names = $incomplete->map(fn (ElectionApplication $draft) => $this->applications->nameOf($this->applications->userNamed((int) $draft->user_school_id)))->values()->all();

            return response()->json([
                'message' => 'These members are missing documents: '.implode(', ', $names).'.'.($complete->isNotEmpty() ? ' The other members were submitted.' : ''),
                'incomplete' => $names,
                'submitted' => $complete->count(),
            ], 422);
        }

        return response()->json($this->applications->presentSlate($slate->fresh()));
    }

    /** One screening decision. Only the Admin, only while screening is open. */
    public function review(Request $request, $id, $application)
    {
        $user = $request->user();
        $election = $this->applications->adminElection($user, $id);
        $this->applications->assertRunning($election);
        $this->applications->assertPhase($election, 'screening', 'Applications are decided while screening is open.');

        $data = $request->validate([
            'decision' => ['required', 'in:approve,correction,reject'],
            'notes' => [Rule::requiredIf(fn () => in_array($request->input('decision'), ['correction', 'reject'], true)), 'nullable', 'string', 'max:2000'],
        ], ['notes.required' => 'Write the notes the candidate needs to see.']);

        $reviewed = $this->applications->review($request, $election, (int) $application, $data['decision'], isset($data['notes']) ? trim($data['notes']) : null);

        return response()->json($this->applications->present($reviewed->fresh(), true));
    }

    /** Creates or resets the row, stores the documents, and discards the files a replacement leaves behind. */
    private function saveApplication(Request $request, Election $election, ?ElectionApplication $existing, int $schoolId, ElectionPosition $position, ?Partylist $slate, User $actor, ?string $platform): ElectionApplication
    {
        $documents = $this->applications->storeDocuments($request, $election);

        try {
            [$application, $replaced] = DB::transaction(function () use ($election, $existing, $schoolId, $position, $slate, $actor, $platform, $documents) {
                $application = $existing ?? new ElectionApplication(['election_id' => $election->id, 'user_school_id' => $schoolId]);
                $replaced = $this->applications->applyDocuments($application, $documents);
                $application->fill([
                    'position_id' => $position->id,
                    'partylist_id' => $slate?->id,
                    'submitted_by' => $actor->school_id,
                    'status' => 'draft',
                    'platform' => $platform,
                    'rules_version' => $election->rules_version,
                    'rules_accepted_at' => now(),
                    'submitted_at' => null,
                    'review_notes' => null,
                    'reviewed_by' => null,
                    'reviewed_at' => null,
                    'candidate_id' => null,
                ])->save();

                return [$application, $replaced];
            });
        } catch (UniqueConstraintViolationException) {
            $this->applications->discardDocuments($documents);
            ElectionApplicationService::refuse('This student already has an application in this election.');
        } catch (Throwable $error) {
            $this->applications->discardDocuments($documents);

            throw $error;
        }

        $this->applications->discardDocuments($replaced);

        return $application;
    }

    /** An application of this election that the caller filed or represents; anyone else is refused. */
    private function ownedApplication(Election $election, mixed $applicationId, User $user): ElectionApplication
    {
        $row = ElectionApplication::where('election_id', $election->id)->find($applicationId);

        if (! $row) {
            ElectionApplicationService::refuse(self::APPLICATION_NOT_FOUND, 404);
        }

        if (! $this->applications->isApplicantOrRepresentative($row, $user)) {
            abort(403);
        }

        return $row;
    }

    private function representedSlate(Election $election, mixed $partylistId, User $user): Partylist
    {
        $slate = Partylist::where('election_id', $election->id)->find($partylistId);

        if (! $slate) {
            ElectionApplicationService::refuse('Party list not found.', 404);
        }

        if ((int) $slate->representative_school_id !== (int) $user->school_id) {
            abort(403);
        }

        return $slate;
    }

    private function documentRules(bool $required): array
    {
        return [
            'photo' => [$required ? 'required' : 'nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:2048'],
            'coc' => [$required ? 'required' : 'nullable', 'file', 'mimes:pdf,jpg,jpeg,png', 'max:10240'],
            'credentials' => [$required ? 'required' : 'nullable', 'file', 'mimes:pdf,jpg,jpeg,png', 'max:10240'],
        ];
    }

    private function messages(): array
    {
        return [
            'rules_accepted.accepted' => 'Read and accept the election rules first.',
            'photo.required' => 'Add a formal photo.',
            'coc.required' => 'Add the certificate of candidacy.',
            'credentials.required' => 'Add your credentials.',
        ];
    }
}
