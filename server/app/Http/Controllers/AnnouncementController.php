<?php

namespace App\Http\Controllers;

use App\Models\AiOutput;
use App\Models\Announcement;
use App\Models\AnnouncementView;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Notification;
use App\Models\User;
use App\Services\GroqResponsesService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class AnnouncementController extends Controller
{
    public function __construct(private readonly GroqResponsesService $groq) {}

    public function generateDraft(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'target_role' => ['required', 'in:all,STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD'],
            'category' => ['nullable', 'in:general,election,training,events,merchandise'],
            'details' => ['nullable', 'string'],
        ]);

        $prompt = "Write a concise school organization announcement.\n"
            ."Title: {$data['title']}\n"
            ."Audience: {$data['target_role']}\n"
            .'Category: '.($data['category'] ?? 'general')."\n"
            .'Details: '.($data['details'] ?? 'Use a clear, formal, student-friendly tone.')."\n";

        $model = (string) config('services.groq.model');
        $generated = $this->groq->generate(
            'Draft a polished, concise school-organization announcement using only supplied facts. Never invent dates, venues, fees, requirements, contacts, or names. Clearly mark important missing information as not yet specified. Return only the editable announcement body.',
            $prompt,
            450,
            0.4,
        );
        $version = ((int) AiOutput::where('organization_id', $request->user()->organization_id)
            ->where('feature_type', 'ANNOUNCEMENT_DRAFT')->max('version')) + 1;

        if (! $generated) {
            AiOutput::create([
                'organization_id' => $request->user()->organization_id,
                'feature_type' => 'ANNOUNCEMENT_DRAFT',
                'reference_type' => 'announcement',
                'prompt_text' => $prompt,
                'output_text' => '',
                'structured_input' => $data,
                'status' => 'failed',
                'error_message' => 'Groq was unavailable or returned an invalid response.',
                'version' => $version,
                'decision_status' => 'rejected',
                'requested_by' => $request->user()->id,
                'created_at' => now(),
            ]);

            return response()->json(['message' => 'AI service is temporarily unavailable. Unable to generate the announcement draft.'], 503);
        }

        $output = $generated['text'];
        $model = $generated['model'];

        $aiOutput = AiOutput::create([
            'organization_id' => $request->user()->organization_id,
            'feature_type' => 'ANNOUNCEMENT_DRAFT',
            'reference_type' => 'announcement',
            'reference_id' => null,
            'prompt_text' => $prompt,
            'output_text' => $output,
            'model_name' => $model,
            'context_version' => 'announcement-v2',
            'structured_input' => $data,
            'structured_output' => ['body' => $output],
            'status' => 'completed',
            'version' => $version,
            'decision_status' => 'pending',
            'requested_by' => $request->user()->id,
            'created_at' => now(),
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
        ]);
    }

    public function index(Request $request)
    {
        $user = $request->user();

        $filters = $request->validate([
            'category' => ['nullable', 'in:general,election,training,events,merchandise'],
            'target_role' => ['nullable', 'in:all,STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD'],
            'approval_status' => ['nullable', 'in:draft,pending,approved,rejected'],
            'publication_status' => ['nullable', 'in:published,draft'],
            'search' => ['nullable', 'string', 'max:120'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'sort' => ['nullable', 'in:newest,oldest,title,most_viewed'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $allowedCategories = ['general', 'election', 'training', 'events', 'merchandise'];
        $category = strtolower((string) ($filters['category'] ?? ''));

        $query = Announcement::with([
            'creator:school_id,first_name,last_name,email,role,position_title,department,program,year_level,section',
            'reviewer:school_id,first_name,last_name,email,role,position_title',
        ])
            ->where('organization_id', $user->organization_id);

        if ($category !== '' && in_array($category, $allowedCategories, true)) {
            $query->where('category', $category);
        }

        if (! empty($filters['target_role'])) {
            $query->where('target_role', $filters['target_role']);
        }

        if (! empty($filters['approval_status'])) {
            $query->where('approval_status', $filters['approval_status']);
        }

        if (! empty($filters['publication_status'])) {
            $query->where('is_published', $filters['publication_status'] === 'published');
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

        $canManageAnnouncements = in_array($user->role, ['ADMIN', 'SBO_OFFICER'], true);

        if ($publishedOnly || ! $canManageAnnouncements) {
            $query->where('is_published', true)
                ->where('approval_status', 'approved');
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

        $announcements = $query->paginate($filters['per_page'] ?? 20);

        // Reach is officer/admin-facing reporting data, not something other
        // students should see next to a bulletin they're reading.
        if (! $canManageAnnouncements) {
            $announcements->getCollection()->each->makeHidden('views_count');
        }

        return response()->json($announcements);
    }

    public function recordView(Request $request, $id)
    {
        $user = $request->user();

        $announcement = Announcement::where('organization_id', $user->organization_id)
            ->where('is_published', true)
            ->where('approval_status', 'approved')
            ->where(function ($q) use ($user) {
                $q->where('target_role', 'all')->orWhere('target_role', $user->role);
            })
            ->find($id);

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

    public function store(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'body' => ['required', 'string'],
            'target_role' => ['required', 'in:all,STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD'],
            'category' => ['nullable', 'in:general,election,training,events,merchandise'],
            'is_published' => ['boolean'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,webp', 'max:5120'],
            'is_pinned' => ['boolean'],
            'is_important' => ['boolean'],
            'ai_output_id' => ['nullable', 'integer'],
        ]);

        $user = $request->user();
        $canPublishWithoutApproval = $user->role === 'ADMIN';
        $isDirectPublish = $canPublishWithoutApproval && ($data['is_published'] ?? false);
        $draftOutput = null;
        if (! empty($data['ai_output_id'])) {
            $draftOutput = AiOutput::where('organization_id', $user->organization_id)
                ->where('requested_by', $user->school_id)
                ->where('feature_type', 'ANNOUNCEMENT_DRAFT')
                ->where('decision_status', 'pending')
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
            'organization_id' => $user->organization_id,
        ]);

        if ($user->role === 'SBO_OFFICER') {
            ApprovalRequest::create([
                'organization_id' => $user->organization_id,
                'entity_type' => 'announcement',
                'entity_id' => $announcement->id,
                'requested_by' => $user->id,
                'required_role' => 'ADMIN',
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

        return response()->json($announcement->load([
            'creator:school_id,first_name,last_name,role',
            'reviewer:school_id,first_name,last_name,role',
        ]), 201);
    }

    public function update(Request $request, $id)
    {
        $announcement = Announcement::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        $user = $request->user();

        if ($announcement->created_by !== $user->id && $user->role !== 'ADMIN') {
            return response()->json(['message' => 'You can only edit your own announcements.'], 403);
        }

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'body' => ['sometimes', 'required', 'string'],
            'target_role' => ['sometimes', 'required', 'in:all,STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD'],
            'category' => ['sometimes', 'required', 'in:general,election,training,events,merchandise'],
            'is_published' => ['sometimes', 'boolean'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,webp', 'max:5120'],
            'remove_image' => ['sometimes', 'boolean'],
            'is_pinned' => ['sometimes', 'boolean'],
            'is_important' => ['sometimes', 'boolean'],
        ]);

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
                $approval->reopen($user->id, 'ADMIN');
            } else {
                ApprovalRequest::create([
                    'organization_id' => $announcement->organization_id,
                    'entity_type' => 'announcement',
                    'entity_id' => $announcement->id,
                    'requested_by' => $user->id,
                    'required_role' => 'ADMIN',
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

        return response()->json($freshAnnouncement->load([
            'creator:school_id,first_name,last_name,role',
            'reviewer:school_id,first_name,last_name,role',
        ]));
    }

    public function destroy(Request $request, $id)
    {
        $announcement = Announcement::where('organization_id', $request->user()->organization_id)->find($id);

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
        $announcement = Announcement::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        $user = $request->user();

        if ($user->role !== 'ADMIN') {
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
                ->where('required_role', 'ADMIN')
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

            return response()->json($freshAnnouncement->load([
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

        return response()->json($freshAnnouncement->load([
            'creator:school_id,first_name,last_name,role',
            'reviewer:school_id,first_name,last_name,role',
        ]));
    }

    private function dispatchAnnouncementNotifications(Announcement $announcement): void
    {
        $query = User::query()
            ->where('organization_id', $announcement->organization_id)
            ->where('account_status', 'active')
            ->where('school_id', '!=', $announcement->created_by);

        if ($announcement->target_role !== 'all') {
            $query->where('role', $announcement->target_role);
        }

        $userIds = $query->pluck('school_id');

        if ($userIds->isEmpty()) {
            return;
        }

        $now = now();
        $message = Str::limit(trim(preg_replace('/\s+/', ' ', strip_tags((string) $announcement->body))), 180);
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

    private function fallbackAnnouncementDraft(string $prompt): string
    {
        $title = Str::after($prompt, 'Title: ');
        $title = trim(Str::before($title, "\n")) ?: 'Announcement';

        return "{$title}\n\nPlease be informed of this important HIUSA announcement. Kindly review the details, take note of any required action, and watch for further updates from the organization.\n\nThank you for your attention and cooperation.";
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
            'organization_id' => $request->user()?->organization_id,
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
        Notification::create([
            'organization_id' => $approval->organization_id,
            'user_id' => $approval->requested_by,
            'title' => 'Approval Request '.Str::headline($status),
            'message' => Str::headline($approval->entity_type).' request #'.$approval->entity_id.' was '.$status.'.',
            'notification_type' => 'general',
            'reference_type' => 'approval_request',
            'reference_id' => $approval->id,
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
