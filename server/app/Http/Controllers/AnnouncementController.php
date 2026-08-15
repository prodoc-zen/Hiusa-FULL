<?php

namespace App\Http\Controllers;

use App\Models\AiOutput;
use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

class AnnouncementController extends Controller
{
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
            ."Category: ".($data['category'] ?? 'general')."\n"
            ."Details: ".($data['details'] ?? 'Use a clear, formal, student-friendly tone.')."\n";

        $model = env('GROQ_MODEL', 'llama-3.1-8b-instant');
        $output = $this->generateAnnouncementTextWithGroq($prompt, $model);

        $aiOutput = AiOutput::create([
            'organization_id' => $request->user()->organization_id,
            'feature_type' => 'announcement_draft',
            'reference_type' => 'announcement',
            'reference_id' => null,
            'prompt_text' => $prompt,
            'output_text' => $output,
            'model_name' => $model,
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

        $allowedCategories = ['general', 'election', 'training', 'events', 'merchandise'];
        $category = strtolower((string) $request->query('category', ''));

        $query = Announcement::with([
            'creator:school_id,first_name,last_name,role',
            'reviewer:school_id,first_name,last_name,role',
        ])
            ->where('organization_id', $user->organization_id)
            ->orderBy('created_at', 'desc');

        if ($category !== '' && in_array($category, $allowedCategories, true)) {
            $query->where('category', $category);
        }

        $publishedOnly = $request->boolean('published_only');

        if ($publishedOnly || $user->role === 'STUDENT') {
            $query->where('is_published', true)
                ->where('approval_status', 'approved');
        }

        if ($user->role === 'STUDENT' || ($publishedOnly && $user->role === 'DEPARTMENT_HEAD')) {
            $query->where(function ($q) use ($user) {
                    $q->where('target_role', 'all')
                        ->orWhere('target_role', $user->role);
                });
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'body' => ['required', 'string'],
            'target_role' => ['required', 'in:all,STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD'],
            'category' => ['nullable', 'in:general,election,training,events,merchandise'],
            'is_published' => ['boolean'],
        ]);

        $user = $request->user();
        $canPublishWithoutApproval = in_array($user->role, ['ADMIN', 'DEPARTMENT_HEAD'], true);
        $isDirectPublish = $canPublishWithoutApproval && ($data['is_published'] ?? false);

        $announcement = Announcement::create([
            'title' => $data['title'],
            'body' => $data['body'],
            'target_role' => $data['target_role'],
            'category' => $data['category'] ?? 'general',
            'is_published' => $isDirectPublish,
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

        $this->recordAnnouncementAudit($request, 'created', $announcement, null, $this->auditableAnnouncementValues($announcement));

        return response()->json($announcement->load([
            'creator:school_id,first_name,last_name,role',
            'reviewer:school_id,first_name,last_name,role',
        ]), 201);
    }

    public function update(Request $request, $id)
    {
        $announcement = Announcement::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$announcement) {
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
        ]);

        $oldValues = $this->auditableAnnouncementValues($announcement);

        unset($data['is_published']);
        $announcement->update($data);

        if ($announcement->approval_status === 'rejected') {
            $announcement->update([
                'approval_status' => $user->role === 'ADMIN' ? 'draft' : 'pending',
                'reviewed_by' => null,
                'review_remarks' => null,
            ]);

            ApprovalRequest::where('entity_type', 'announcement')
                ->where('entity_id', $announcement->id)
                ->where('status', 'rejected')
                ->where('organization_id', $announcement->organization_id)
                ->get()
                ->each(fn (ApprovalRequest $approval) => $approval->resubmit());
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

        if (!$announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        $user = $request->user();

        if ($announcement->created_by !== $user->id && $user->role !== 'ADMIN') {
            return response()->json(['message' => 'You can only delete your own announcements.'], 403);
        }

        $oldValues = $this->auditableAnnouncementValues($announcement);
        $announcement->delete();
        $this->recordAnnouncementAudit($request, 'deleted', $announcement, $oldValues, null);

        return response()->json(['message' => 'Announcement deleted successfully.']);
    }

    public function togglePublish(Request $request, $id)
    {
        $announcement = Announcement::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        $user = $request->user();

        if (! in_array($user->role, ['ADMIN', 'DEPARTMENT_HEAD'], true)) {
            return response()->json(['message' => 'Announcements from SBO officers require admin approval before publishing.'], 403);
        }

        $wasPublished = (bool) $announcement->is_published;

        if ($user->role === 'DEPARTMENT_HEAD' && $announcement->created_by !== $user->id) {
            return response()->json(['message' => 'You can only publish or unpublish your own announcements.'], 403);
        }

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
            'is_published' => !$wasPublished,
            'approval_status' => $wasPublished ? 'draft' : 'approved',
            'reviewed_by' => $wasPublished ? null : $user->id,
            'published_at' => $wasPublished ? null : now(),
        ]);

        if (!$wasPublished) {
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
        $title = 'New Announcement: ' . Str::limit($announcement->title, 230);

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

    private function generateAnnouncementTextWithGroq(string $prompt, string $model): string
    {
        $apiKey = env('GROQ_API_KEY');

        if (!$apiKey) {
            return $this->fallbackAnnouncementDraft($prompt);
        }

        try {
            $response = Http::withToken($apiKey)
                ->timeout(20)
                ->post('https://api.groq.com/openai/v1/chat/completions', [
                    'model' => $model,
                    'messages' => [
                        ['role' => 'system', 'content' => 'You draft polished, concise school organization announcements. Return only the announcement body.'],
                        ['role' => 'user', 'content' => $prompt],
                    ],
                    'temperature' => 0.4,
                    'max_tokens' => 450,
                ]);

            if ($response->successful()) {
                $content = trim((string) data_get($response->json(), 'choices.0.message.content'));
                if ($content !== '') {
                    return $content;
                }
            }
        } catch (\Throwable) {
            return $this->fallbackAnnouncementDraft($prompt);
        }

        return $this->fallbackAnnouncementDraft($prompt);
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
