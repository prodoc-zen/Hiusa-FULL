<?php

namespace App\Http\Controllers;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AiOutput;
use App\Models\Announcement;
use App\Models\AnnouncementView;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use App\Services\Ai\AiInstructions;
use App\Services\ApprovalEntityLabel;
use App\Support\FilterValues;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class AnnouncementController extends Controller
{
    private const DRAFT_CONTEXT = 'announcement-v2';

    /** A draft the provider wrote and billed but the checks rejected: it still counts toward the daily quota. */
    private const REJECTED_CONTEXT = 'announcement-rejected-v1';

    /** A reserved slot that has been pending longer than the provider deadline plus a margin belongs to a request that died. */
    private const PENDING_GRACE_MINUTES = 2;

    private const BODY_MESSAGES = ['body.max' => 'The announcement text can be at most 10,000 characters.'];

    public function __construct(
        private readonly TextGenerator $ai,
        private readonly ApprovalEntityLabel $entityLabels,
    ) {}

    public function generationQuota(Request $request)
    {
        return response()->json($this->announcementGenerationQuota($request));
    }

    public function generateDraft(Request $request)
    {
        if ($request->user()->role === 'SUPER_ADMIN') {
            return response()->json(['message' => 'SAO Directors do not use AI generation tools.'], 403);
        }
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'target_role' => ['required', 'in:all,STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD'],
            'category' => ['nullable', 'in:general,election,training,events,merchandise'],
            'details' => ['nullable', 'string', 'max:2000'],
        ], ['details.max' => 'The AI instructions can be at most 2,000 characters.']);

        $audience = [
            'all' => 'Everyone in the organization',
            'STUDENT' => 'Students',
            'SBO_OFFICER' => 'SBO officers',
            'ADMIN' => 'Organization admins',
            'DEPARTMENT_HEAD' => 'Department heads',
        ][$data['target_role']];
        $prompt = "Write a concise school organization announcement.\n"
            ."Title: {$data['title']}\n"
            ."Audience: {$audience}\n"
            .'Category: '.($data['category'] ?? 'general')."\n"
            .'Details: '.($data['details'] ?? 'Use a clear, formal, student-friendly tone.')."\n";

        $organizationId = $request->user()->organization_id;
        $aiOutput = DB::transaction(function () use ($request, $organizationId, $data, $prompt) {
            if ($organizationId) {
                Organization::whereKey($organizationId)->lockForUpdate()->first();
            }
            if ($this->announcementGenerationQuota($request)['remaining'] < 1) {
                return null;
            }

            return AiOutput::create([
                'organization_id' => $organizationId,
                'feature_type' => 'ANNOUNCEMENT_DRAFT',
                'reference_type' => 'announcement',
                'reference_id' => null,
                'prompt_text' => $prompt,
                'output_text' => '',
                'model_name' => null,
                'context_version' => self::DRAFT_CONTEXT,
                'structured_input' => $data,
                'structured_output' => null,
                'status' => 'pending',
                'version' => ((int) AiOutput::where('organization_id', $organizationId)
                    ->where('feature_type', 'ANNOUNCEMENT_DRAFT')->max('version')) + 1,
                'decision_status' => 'pending',
                'requested_by' => $request->user()->id,
                'created_at' => now(),
            ]);
        });

        if (! $aiOutput) {
            return response()->json([
                'message' => 'You have used all announcement drafts available today. Try again after the daily reset.',
                'quota' => $this->announcementGenerationQuota($request),
            ], 429);
        }

        try {
            $generated = $this->ai->generate(
                AiInstructions::announcementDraft(),
                $prompt,
                450,
                0.4,
            );
            $providerWrote = (bool) $generated;
            $rejection = null;
            if ($generated) {
                $generated['text'] = $this->ai->plainText($generated['text']);
                if ($generated['text'] === '') {
                    $rejection = 'empty';
                } elseif (! $this->keepsTheOfficersNumbers($generated['text'], $data['title'], $data['details'] ?? '')) {
                    $rejection = 'numbers';
                }
                if ($rejection) {
                    $generated = null;
                }
            }
        } catch (\Throwable $e) {
            $aiOutput->delete();

            throw $e;
        }

        $isTemplate = ! $generated;
        if ($isTemplate) {
            $generated = ['text' => $this->fallbackAnnouncementDraft($data), 'model' => 'template-draft'];
        }

        $output = $generated['text'];
        $model = $generated['model'];

        $aiOutput->update([
            'output_text' => $output,
            'model_name' => $model,
            'context_version' => ! $isTemplate ? self::DRAFT_CONTEXT : ($providerWrote ? self::REJECTED_CONTEXT : 'announcement-template-v1'),
            'structured_output' => ['body' => $output],
            'status' => 'completed',
        ]);

        $this->recordAnnouncementAudit($request, 'generated_draft', null, null, [
            'ai_output_id' => $aiOutput->id,
            'title' => $data['title'],
            'target_role' => $data['target_role'],
            'category' => $data['category'] ?? 'general',
        ]);

        return response()->json([
            'output_text' => $output,
            'ai_output_id' => $aiOutput->id,
            'model_name' => $model,
            'is_template' => $isTemplate,
            'notice' => $isTemplate ? $this->templateNotice($rejection, filled($data['details'] ?? null)) : null,
            'quota' => $this->announcementGenerationQuota($request),
        ]);
    }

    public function index(Request $request)
    {
        $user = $request->user();

        $filters = $request->validate([
            'category' => ['nullable', FilterValues::rule(['nullable', 'in:general,election,training,events,merchandise'])],
            'target_role' => ['nullable', FilterValues::rule(['nullable', 'in:all,STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD,SUPER_ADMIN'])],
            'approval_status' => ['nullable', FilterValues::rule(['nullable', 'in:draft,pending,approved,rejected'])],
            'publication_status' => ['nullable', FilterValues::rule(['nullable', 'in:published,draft'])],
            'search' => ['nullable', 'string', 'max:120'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'sort' => ['nullable', 'in:newest,oldest,title,most_viewed'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
            'managed' => ['nullable', 'boolean'],
        ]);

        $readableOrgIds = $this->readableOrganizationIds($request);
        $query = Announcement::with([
            'creator:school_id,first_name,last_name,email,role,position_title,department,program,year_level,section',
            'reviewer:school_id,first_name,last_name,email,role,position_title',
            'sourceOrganization:id,name,acronym',
            'organization:id,name,acronym',
        ])->withCount('reactions')
            ->withExists(['reactions as is_liked' => fn ($reactions) => $reactions->where('user_id', $user->school_id)])
            ->where(function ($scope) use ($user, $readableOrgIds) {
                $scope->whereIn('organization_id', $readableOrgIds)
                    ->orWhere(function ($global) use ($user) {
                        $global->whereIn('announcement_source', ['SAO', 'COMPLIANCE'])
                            ->whereHas('recipients', fn ($recipients) => $recipients->where('user_id', $user->school_id));
                    });
            });

        if (! empty($filters['category'])) {
            $query->whereIn('category', FilterValues::values($filters['category']));
        }

        if (! empty($filters['target_role'])) {
            $query->whereIn('target_role', FilterValues::values($filters['target_role']));
        }

        if (! empty($filters['approval_status'])) {
            $query->whereIn('approval_status', FilterValues::values($filters['approval_status']));
        }

        if (! empty($filters['publication_status'])) {
            $query->whereIn('is_published', array_map(fn ($status) => $status === 'published', FilterValues::values($filters['publication_status'])));
        }

        if (! empty($filters['search'])) {
            $search = trim($filters['search']);
            $query->where(function ($searchQuery) use ($search) {
                $searchQuery->where('title', 'like', "%{$search}%")
                    ->orWhere('body', 'like', "%{$search}%")
                    ->orWhereHas('creator', fn ($creator) => $creator
                        ->where('first_name', 'like', "%{$search}%")
                        ->orWhere('last_name', 'like', "%{$search}%"));
            });
        }

        if (! empty($filters['from'])) {
            $query->whereDate('created_at', '>=', $filters['from']);
        }

        if (! empty($filters['to'])) {
            $query->whereDate('created_at', '<=', $filters['to']);
        }

        $publishedOnly = $request->boolean('published_only');

        $canManageAnnouncements = in_array($user->role, ['ADMIN', 'SBO_OFFICER'], true)
            || ($user->role === 'DEPARTMENT_HEAD' && $request->boolean('managed'));
        if ($user->role === 'DEPARTMENT_HEAD' && $request->boolean('managed')) {
            $query->where('created_by', $user->school_id)->where('announcement_source', 'ORGANIZATION');
        }

        if ($canManageAnnouncements && ! $publishedOnly && $semester = AcademicSemester::selected($request)) {
            $query->where(fn ($period) => $period->whereNull('academic_semester_id')->orWhere('academic_semester_id', $semester->id));
        }

        if ($publishedOnly || ! $canManageAnnouncements) {
            $query->where('is_published', true)
                ->where('approval_status', 'approved')
                ->where(fn ($q) => $q->whereNull('scheduled_at')->orWhere('scheduled_at', '<=', now()))
                ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()));
        }

        if (! $canManageAnnouncements || $publishedOnly) {
            $query->where(function ($q) use ($user) {
                $q->where('target_role', 'all')
                    ->orWhere('target_role', $user->role);
            });
        }

        match ($filters['sort'] ?? 'newest') {
            'oldest' => $query->orderBy('created_at'),
            'title' => $query->orderBy('title'),
            'most_viewed' => $query->orderByDesc('views_count')->orderByDesc('created_at'),
            default => $query->orderByDesc('created_at'),
        };
        $query->orderBy('id');

        $summaryQuery = clone $query;
        $summary = [
            'total' => (clone $summaryQuery)->count(),
            'published' => (clone $summaryQuery)->where('is_published', true)->count(),
            'unpublished' => (clone $summaryQuery)->where('is_published', false)->count(),
            'pending' => (clone $summaryQuery)->where('approval_status', 'pending')->count(),
            'views' => (int) (clone $summaryQuery)->sum('views_count'),
        ];

        $announcements = $query->paginate($filters['per_page'] ?? 20);

        // Reach is officer/admin-facing reporting data, not something other
        // students should see next to a bulletin they're reading.
        if (! $canManageAnnouncements) {
            $announcements->getCollection()->each->makeHidden('views_count');
        }

        $approvalIds = $canManageAnnouncements ? $this->latestApprovalIds($announcements->getCollection()->pluck('id')) : [];
        $announcements->getCollection()->each(fn (Announcement $row) => $row->setAttribute('approval_id', $approvalIds[$row->id] ?? null));

        return response()->json([
            ...$announcements->toArray(),
            'summary' => $summary,
        ]);
    }

    /** Latest approval request id per announcement id, in one query. */
    private function latestApprovalIds(Collection $announcementIds): array
    {
        if ($announcementIds->isEmpty()) {
            return [];
        }

        return ApprovalRequest::where('entity_type', 'announcement')
            ->whereIn('entity_id', $announcementIds)
            ->groupBy('entity_id')
            ->selectRaw('entity_id, MAX(id) as latest_id')
            ->pluck('latest_id', 'entity_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function withApprovalId(Announcement $announcement): Announcement
    {
        return $announcement->setAttribute('approval_id', $this->latestApprovalIds(collect([$announcement->id]))[$announcement->id] ?? null);
    }

    public function recordView(Request $request, $id)
    {
        $user = $request->user();
        $announcement = $this->visibleAnnouncement($user, $id);

        if (! $announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        try {
            AnnouncementView::create([
                'announcement_id' => $announcement->id,
                'user_id' => $user->id,
                'viewed_at' => now(),
            ]);
        } catch (UniqueConstraintViolationException) {
            return response()->json(['message' => 'View already recorded.', 'already_viewed' => true]);
        }

        $announcement->increment('views_count');

        return response()->json(['message' => 'View recorded.', 'already_viewed' => false]);
    }

    public function react(Request $request, $id)
    {
        $announcement = $this->visibleAnnouncement($request->user(), $id);
        if (! $announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        $announcement->reactions()->firstOrCreate(['user_id' => $request->user()->school_id]);

        return response()->json(['is_liked' => true, 'reactions_count' => $announcement->reactions()->count()]);
    }

    public function unreact(Request $request, $id)
    {
        $announcement = $this->visibleAnnouncement($request->user(), $id);
        if (! $announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        $announcement->reactions()->where('user_id', $request->user()->school_id)->delete();

        return response()->json(['is_liked' => false, 'reactions_count' => $announcement->reactions()->count()]);
    }

    private function visibleAnnouncement(User $user, $id): ?Announcement
    {
        return Announcement::where(function ($scope) use ($user) {
            $scope->whereIn('organization_id', $user->scopedOrganizationIds())
                ->orWhere(fn ($global) => $global->whereIn('announcement_source', ['SAO', 'COMPLIANCE'])->whereHas('recipients', fn ($recipients) => $recipients->where('user_id', $user->school_id)));
        })
            ->where('is_published', true)
            ->where('approval_status', 'approved')
            ->where(fn ($q) => $q->whereNull('scheduled_at')->orWhere('scheduled_at', '<=', now()))
            ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->where(function ($q) use ($user) {
                $q->where('target_role', 'all')->orWhere('target_role', $user->role);
            })
            ->find($id);
    }

    public function store(Request $request)
    {
        if ($request->user()->role === 'SUPER_ADMIN') {
            return response()->json(['message' => 'SAO Directors publish only through Global Announcements.'], 403);
        }
        $user = $request->user();
        $data = $request->validate([
            'organization_id' => $user->role === 'DEPARTMENT_HEAD' ? ['required', 'integer'] : ['prohibited'],
            'title' => ['required', 'string', 'max:255'],
            'body' => ['required', 'string', 'max:10000'],
            'target_role' => ['required', 'in:all,STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD'],
            'category' => ['nullable', 'in:general,election,training,events,merchandise'],
            'is_published' => ['boolean'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,webp', 'max:5120'],
            'is_pinned' => ['boolean'],
            'is_important' => ['boolean'],
            'ai_output_id' => ['nullable', 'integer'],
        ], self::BODY_MESSAGES);

        $organizationId = $user->organization_id;
        if ($user->role === 'DEPARTMENT_HEAD') {
            $organization = Organization::student()->whereIn('id', $user->scopedOrganizationIds())
                ->whereKey($data['organization_id'])->where('is_active', true)->firstOrFail();
            abort_unless($organization->isWritable(), 409, 'Choose an active organization in your college.');
            abort_if(! empty($data['ai_output_id']), 422, 'AI drafts are available to organization Admins and Officers.');
            $organizationId = $organization->id;
        }
        $canPublishWithoutApproval = in_array($user->role, ['ADMIN', 'DEPARTMENT_HEAD'], true);
        $isDirectPublish = $canPublishWithoutApproval && ($data['is_published'] ?? false);
        $draftOutput = null;
        if (! empty($data['ai_output_id'])) {
            $draftOutput = AiOutput::where('organization_id', $user->organization_id)
                ->where('requested_by', $user->school_id)
                ->where('feature_type', 'ANNOUNCEMENT_DRAFT')
                ->where('decision_status', 'pending')
                ->where('status', 'completed')
                ->find($data['ai_output_id']);
            if (! $draftOutput) {
                return response()->json(['message' => 'The selected AI draft is not available to this user.'], 422);
            }
        }

        $announcement = Announcement::create([
            'title' => $data['title'],
            'body' => $data['body'],
            'target_role' => $data['target_role'],
            'category' => $data['category'] ?? 'general',
            'is_published' => $isDirectPublish,
            'image_url' => $request->hasFile('image') ? Storage::disk('public')->url($request->file('image')->store('announcements', 'public')) : null,
            'is_pinned' => $data['is_pinned'] ?? false,
            'is_important' => $data['is_important'] ?? false,
            'approval_status' => $isDirectPublish ? 'approved' : ($user->role === 'SBO_OFFICER' ? 'pending' : 'draft'),
            'reviewed_by' => $isDirectPublish ? $user->id : null,
            'published_at' => $isDirectPublish ? now() : null,
            'created_by' => $user->id,
            'organization_id' => $organizationId,
        ]);

        if ($user->role === 'SBO_OFFICER') {
            ApprovalRequest::create([
                'organization_id' => $user->organization_id,
                'entity_type' => 'announcement',
                'entity_id' => $announcement->id,
                'requested_by' => $user->id,
                'required_role' => config('approvals.routes.announcement'),
            ]);
        }

        if ($announcement->is_published) {
            $this->dispatchAnnouncementNotifications($announcement);
        }

        $draftOutput?->update([
            'reference_id' => $announcement->id,
            'decision_status' => 'accepted',
            'decided_by' => $user->school_id,
            'decided_at' => now(),
        ]);

        $this->recordAnnouncementAudit($request, 'created', $announcement, null, $this->auditableAnnouncementValues($announcement));

        return response()->json($this->withApprovalId($announcement)->load([
            'creator:school_id,first_name,last_name,role',
            'reviewer:school_id,first_name,last_name,role',
        ]), 201);
    }

    public function update(Request $request, $id)
    {
        $announcement = $this->managedAnnouncementQuery($request)->find($id);

        if (! $announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        $user = $request->user();

        if ($announcement->created_by !== $user->id && $user->role !== 'ADMIN') {
            return response()->json(['message' => 'You can only edit your own announcements.'], 403);
        }

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'body' => ['sometimes', 'required', 'string', 'max:10000'],
            'target_role' => ['sometimes', 'required', 'in:all,STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD'],
            'category' => ['sometimes', 'required', 'in:general,election,training,events,merchandise'],
            'is_published' => ['sometimes', 'boolean'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,webp', 'max:5120'],
            'remove_image' => ['sometimes', 'boolean'],
            'is_pinned' => ['sometimes', 'boolean'],
            'is_important' => ['sometimes', 'boolean'],
        ], self::BODY_MESSAGES);

        $oldValues = $this->auditableAnnouncementValues($announcement);
        $hasMaterialChange = count(array_intersect(array_keys($data), [
            'title',
            'body',
            'target_role',
            'category',
            'image',
            'remove_image',
            'is_pinned',
            'is_important',
        ])) > 0;

        unset($data['is_published']);
        $oldImageUrl = $announcement->image_url;
        $removeImage = (bool) ($data['remove_image'] ?? false);
        unset($data['image'], $data['remove_image']);

        if ($request->hasFile('image')) {
            $data['image_url'] = Storage::disk('public')->url($request->file('image')->store('announcements', 'public'));
        } elseif ($removeImage) {
            $data['image_url'] = null;
        }

        $announcement->update($data);

        if (($request->hasFile('image') || $removeImage) && $oldImageUrl) {
            Storage::disk('public')->delete($this->publicStoragePath($oldImageUrl));
        }

        if ($user->role === 'SBO_OFFICER' && $hasMaterialChange && $announcement->approval_status !== 'pending') {
            $announcement->update([
                'approval_status' => 'pending',
                'is_published' => false,
                'published_at' => null,
                'reviewed_by' => null,
                'review_remarks' => null,
            ]);

            $approval = ApprovalRequest::where('entity_type', 'announcement')
                ->where('entity_id', $announcement->id)
                ->where('organization_id', $announcement->organization_id)
                ->latest('id')
                ->first();

            if ($approval) {
                $approval->reopen($user->id, config('approvals.routes.announcement'));
            } else {
                ApprovalRequest::create([
                    'organization_id' => $announcement->organization_id,
                    'entity_type' => 'announcement',
                    'entity_id' => $announcement->id,
                    'requested_by' => $user->id,
                    'required_role' => config('approvals.routes.announcement'),
                ]);
            }
        } elseif ($user->role === 'ADMIN' && $announcement->approval_status === 'rejected') {
            $announcement->update([
                'approval_status' => 'draft',
                'reviewed_by' => null,
                'review_remarks' => null,
            ]);
        }

        $freshAnnouncement = $announcement->fresh();
        $this->recordAnnouncementAudit($request, 'updated', $freshAnnouncement, $oldValues, $this->auditableAnnouncementValues($freshAnnouncement));

        return response()->json($this->withApprovalId($freshAnnouncement)->load([
            'creator:school_id,first_name,last_name,role',
            'reviewer:school_id,first_name,last_name,role',
        ]));
    }

    public function destroy(Request $request, $id)
    {
        $announcement = $this->managedAnnouncementQuery($request)->find($id);

        if (! $announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        $user = $request->user();

        if ($announcement->created_by !== $user->id && $user->role !== 'ADMIN') {
            return response()->json(['message' => 'You can only delete your own announcements.'], 403);
        }

        $oldValues = $this->auditableAnnouncementValues($announcement);
        $imageUrl = $announcement->image_url;
        DB::transaction(function () use ($announcement) {
            ApprovalRequest::where('organization_id', $announcement->organization_id)
                ->where('entity_type', 'announcement')
                ->where('entity_id', $announcement->id)
                ->delete();
            $announcement->delete();
        });
        if ($imageUrl) {
            Storage::disk('public')->delete($this->publicStoragePath($imageUrl));
        }
        $this->recordAnnouncementAudit($request, 'deleted', $announcement, $oldValues, null);

        return response()->json(['message' => 'Announcement deleted successfully.']);
    }

    private function publicStoragePath(string $url): string
    {
        $path = parse_url($url, PHP_URL_PATH) ?: $url;

        return ltrim(Str::after($path, '/storage/'), '/');
    }

    public function togglePublish(Request $request, $id)
    {
        $announcement = $this->managedAnnouncementQuery($request)->find($id);

        if (! $announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        $user = $request->user();

        if (! in_array($user->role, ['ADMIN', 'DEPARTMENT_HEAD'], true)) {
            return response()->json(['message' => 'Announcements from SBO officers require admin approval before publishing.'], 403);
        }

        $wasPublished = (bool) $announcement->is_published;

        if (! $wasPublished && $announcement->approval_status === 'pending') {
            if ($user->role !== 'ADMIN') {
                return response()->json(['message' => 'Pending SBO announcements require admin approval before publishing.'], 403);
            }

            $approval = ApprovalRequest::where('organization_id', $announcement->organization_id)
                ->where('entity_type', 'announcement')
                ->where('entity_id', $announcement->id)
                ->where('required_role', config('approvals.routes.announcement'))
                ->where('status', 'pending')
                ->latest('id')
                ->first();

            if (! $approval) {
                return response()->json(['message' => 'Pending approval request not found.'], 409);
            }

            if ($approval->requested_by === $user->id) {
                return response()->json(['message' => 'You cannot approve your own announcement request.'], 403);
            }

            $oldValues = $this->auditableAnnouncementValues($announcement);

            $freshAnnouncement = DB::transaction(function () use ($approval, $announcement, $request, $oldValues) {
                $approval->update([
                    'status' => 'approved',
                    'remarks' => null,
                    'reviewed_by' => $request->user()->id,
                    'reviewed_at' => now(),
                ]);

                $announcement->update([
                    'is_published' => true,
                    'approval_status' => 'approved',
                    'reviewed_by' => $request->user()->id,
                    'review_remarks' => null,
                    'published_at' => now(),
                ]);

                $fresh = $announcement->fresh();

                $this->notifyApprovalRequester($approval, 'approved');
                $this->recordApprovalAudit($request, $approval->fresh(), 'approved');
                $this->recordAnnouncementAudit(
                    $request,
                    'published',
                    $fresh,
                    $oldValues,
                    $this->auditableAnnouncementValues($fresh)
                );

                return $fresh;
            });

            $this->dispatchAnnouncementNotifications($freshAnnouncement);

            return response()->json($this->withApprovalId($freshAnnouncement)->load([
                'creator:school_id,first_name,last_name,role',
                'reviewer:school_id,first_name,last_name,role',
            ]));
        }

        if (! $wasPublished && $announcement->approval_status === 'rejected') {
            return response()->json(['message' => 'Edit the rejected announcement to resubmit it before publishing.'], 422);
        }

        $oldValues = $this->auditableAnnouncementValues($announcement);

        $announcement->update([
            'is_published' => ! $wasPublished,
            'approval_status' => $wasPublished ? 'draft' : 'approved',
            'reviewed_by' => $wasPublished ? null : $user->id,
            'published_at' => $wasPublished ? null : now(),
        ]);

        if (! $wasPublished) {
            $this->dispatchAnnouncementNotifications($announcement->fresh());
        }

        $freshAnnouncement = $announcement->fresh();
        $this->recordAnnouncementAudit(
            $request,
            $wasPublished ? 'unpublished' : 'published',
            $freshAnnouncement,
            $oldValues,
            $this->auditableAnnouncementValues($freshAnnouncement)
        );

        return response()->json($this->withApprovalId($freshAnnouncement)->load([
            'creator:school_id,first_name,last_name,role',
            'reviewer:school_id,first_name,last_name,role',
        ]));
    }

    private function managedAnnouncementQuery(Request $request): Builder
    {
        $user = $request->user();
        $query = Announcement::where('announcement_source', 'ORGANIZATION');
        if ($user->role === 'DEPARTMENT_HEAD') {
            return $query->whereIn('organization_id', $user->scopedOrganizationIds())
                ->where('created_by', $user->school_id)
                ->whereHas('organization', fn ($organizations) => $organizations->where('is_active', true)->where('lifecycle_status', 'active'));
        }

        return $query->where('organization_id', $user->organization_id);
    }

    private function dispatchAnnouncementNotifications(Announcement $announcement): void
    {
        $query = User::where('account_status', 'active')->where('school_id', '!=', $announcement->created_by)
            ->whereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $announcement->organization_id)
                ->where('account_status', 'active')
                ->when($announcement->target_role !== 'all', fn ($roles) => $roles->where('role', $announcement->target_role)));

        $userIds = $query->pluck('school_id');

        if ($userIds->isEmpty()) {
            return;
        }

        $now = now();
        $message = Str::limit(trim(preg_replace('/\s+/', ' ', (string) $announcement->body)), 180);
        $title = 'New Announcement: '.Str::limit($announcement->title, 230);

        foreach ($userIds->chunk(100) as $chunk) {
            Notification::insert(
                $chunk->map(fn ($userId) => [
                    'organization_id' => $announcement->organization_id,
                    'user_id' => $userId,
                    'notification_type' => 'announcement',
                    'title' => $title,
                    'message' => $message,
                    'reference_type' => 'announcement',
                    'reference_id' => $announcement->id,
                    'is_read' => false,
                    'sent_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all()
            );
        }
    }

    private function templateNotice(?string $rejection, bool $hasDetails): string
    {
        $reason = [
            'numbers' => 'The AI draft added a date, time or number you did not give, so a template was used instead. Check the date, time and fees in your notes.',
            'empty' => 'The AI writer sent back an empty draft, so a template was used instead.',
        ][$rejection] ?? 'The AI writer did not send back a draft this time, so a template was used instead.';

        return 'This is a template draft. '.$reason.' '.($hasDetails
            ? 'Your notes were inserted as written, except instructions about tone. Check them and add any missing details before you post it.'
            : 'Add the date, place and other details before you post it.');
    }

    private function fallbackAnnouncementDraft(array $data): string
    {
        $lines = [rtrim($data['title'], '.:').': please read the details below.'];
        $sentences = preg_split('/(?<=[.!?])\s+/u', trim((string) ($data['details'] ?? ''))) ?: [];
        $details = trim(implode(' ', array_filter($sentences, fn (string $sentence) => ! preg_match('/\btone\b/iu', $sentence))));
        $lines[] = $details !== '' ? $details : 'Date and venue: to be announced.';
        $lines[] = in_array($data['target_role'], ['all', 'STUDENT'], true)
            ? 'If you have questions, please ask your organization officers.'
            : 'If you have questions, please contact the person who posted this announcement.';

        return implode("\n\n", $lines);
    }

    /**
     * The draft may restate the officer's times and dates in any ordinary written form ("3pm" as "3:00 PM",
     * "Nov 20" as "November 20, 2026" or "11/20") but may not add a number the officer did not give.
     */
    private function keepsTheOfficersNumbers(string $draft, string $title, string $details): bool
    {
        $facts = $title."\n".$details;
        $extras = [(int) now()->year, (int) now()->year + 1];
        if (preg_match('/(?<![\pL])[ap]\.?m\b/iu', $facts)) {
            preg_match_all('/(?<![\pL\pN:.,])\d{1,2}(?![\pN])/u', $facts, $hours);
            foreach ($hours[0] as $hour) {
                if ($hour >= 1 && $hour <= 12) {
                    array_push($extras, (int) $hour, (int) $hour + 12);
                }
            }
        }
        foreach (['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as $index => $month) {
            if (preg_match('/\b'.$month.'[a-z]*\b/iu', $facts)) {
                $extras[] = $index + 1;
            }
        }

        return $this->ai->preservesNumericFacts($this->withClockTimesAsNumbers($draft), [$this->withClockTimesAsNumbers($facts), $extras]);
    }

    /** "3pm", "3 PM" and "3:00 PM" all become 15; "10:30am" and "10:30" become 10.30, so ":00" is never read as a separate 0. */
    private function withClockTimesAsNumbers(string $text): string
    {
        $text = preg_replace_callback(
            '/(?<![\pL\pN:.,])(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b\.?/iu',
            function (array $match) {
                $hour = ((int) $match[1]) % 12 + (strtolower($match[3]) === 'p' ? 12 : 0);

                return ($match[2] ?? '') !== '' && (int) $match[2] > 0 ? $hour.'.'.$match[2] : (string) $hour;
            },
            $text,
        ) ?? $text;

        return preg_replace_callback(
            '/(?<![\pL\pN:.,])(\d{1,2}):(\d{2})(?![\pN])/u',
            fn (array $match) => (int) $match[2] > 0 ? $match[1].'.'.$match[2] : $match[1],
            $text,
        ) ?? $text;
    }

    private function announcementGenerationQuota(Request $request): array
    {
        $limit = max(1, (int) config('services.groq.announcement_daily_limit', 20));
        $used = AiOutput::query()
            ->where('organization_id', $request->user()->organization_id)
            ->where('requested_by', $request->user()->school_id)
            ->where('feature_type', 'ANNOUNCEMENT_DRAFT')
            ->whereIn('context_version', [self::DRAFT_CONTEXT, self::REJECTED_CONTEXT])
            ->where(fn ($query) => $query->where('status', '!=', 'pending')->orWhere('created_at', '>=', now()->subMinutes(self::PENDING_GRACE_MINUTES)))
            ->whereDate('created_at', now()->toDateString())
            ->count();

        return [
            'limit' => $limit,
            'used' => $used,
            'remaining' => max(0, $limit - $used),
            'resets_at' => now()->addDay()->startOfDay()->toIso8601String(),
        ];
    }

    private function auditableAnnouncementValues(Announcement $announcement): array
    {
        return [
            'id' => $announcement->id,
            'title' => $announcement->title,
            'target_role' => $announcement->target_role,
            'category' => $announcement->category,
            'is_published' => $announcement->is_published,
            'image_url' => $announcement->image_url,
            'is_pinned' => $announcement->is_pinned,
            'is_important' => $announcement->is_important,
            'approval_status' => $announcement->approval_status,
            'created_by' => $announcement->created_by,
        ];
    }

    private function recordAnnouncementAudit(Request $request, string $action, ?Announcement $announcement, ?array $oldValues, ?array $newValues): void
    {
        AuditLog::create([
            'organization_id' => $announcement?->organization_id ?? $request->user()?->organization_id,
            'user_id' => $request->user()?->school_id,
            'module' => 'announcements',
            'action' => $action,
            'record_type' => Announcement::class,
            'record_id' => $announcement?->id,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }

    private function notifyApprovalRequester(ApprovalRequest $approval, string $status): void
    {
        $label = $this->entityLabels->for($approval);
        Notification::create([
            'organization_id' => $approval->organization_id,
            'user_id' => $approval->requested_by,
            'title' => 'Approval Request '.Str::headline($status),
            'message' => Str::headline($approval->entity_type).' "'.$label.'" was '.$status.'.',
            'notification_type' => 'general',
            'reference_type' => $approval->entity_type,
            'reference_id' => $approval->entity_id,
            'is_read' => false,
            'sent_at' => now(),
        ]);
    }

    private function recordApprovalAudit(Request $request, ApprovalRequest $approval, string $status): void
    {
        AuditLog::create([
            'organization_id' => $request->user()?->organization_id,
            'user_id' => $request->user()?->school_id,
            'module' => 'approvals',
            'action' => 'reviewed_'.$status,
            'record_type' => ApprovalRequest::class,
            'record_id' => $approval->id,
            'old_values' => null,
            'new_values' => [
                'entity_type' => $approval->entity_type,
                'entity_id' => $approval->entity_id,
                'status' => $status,
                'remarks' => $approval->remarks,
            ],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
