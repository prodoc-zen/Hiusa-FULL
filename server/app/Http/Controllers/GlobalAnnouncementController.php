<?php

namespace App\Http\Controllers;

use App\Models\Announcement;
use App\Models\AnnouncementRecipient;
use App\Models\AuditLog;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/** Official SAO announcements; deliberately contains no AI generation endpoint. */
class GlobalAnnouncementController extends Controller
{
    private const SCOPES = ['all_users', 'all_organizations', 'selected_organizations', 'all_departments', 'selected_departments'];
    private const ROLES = ['STUDENT', 'SBO_OFFICER', 'ADMIN', 'DEPARTMENT_HEAD'];

    public function index(Request $request)
    {
        $data = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100'], 'status' => ['nullable', 'in:all,draft,published,archived']]);
        $query = Announcement::with(['creator:school_id,first_name,last_name,position_title', 'sourceOrganization:id,name,acronym'])
            ->withCount('recipients')->where('announcement_source', 'SAO');
        match ($data['status'] ?? 'all') {
            'draft' => $query->where('is_published', false),
            'published' => $query->where('is_published', true)->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now())),
            'archived' => $query->whereNotNull('expires_at')->where('expires_at', '<=', now()),
            default => null,
        };
        return response()->json($query->latest()->paginate($data['per_page'] ?? 20));
    }

    public function store(Request $request)
    {
        $data = $this->validatedPayload($request);
        $announcement = DB::transaction(function () use ($data, $request) {
            $sao = $this->sao();
            $publishNow = ($data['publish'] ?? false) && empty($data['scheduled_at']);
            $announcement = Announcement::create([
                'organization_id' => $sao->id,
                'source_organization_id' => $sao->id,
                'announcement_source' => 'SAO',
                'title' => $data['title'], 'body' => $data['body'], 'category' => $data['category'] ?? 'general',
                'target_role' => 'all', 'target_scope' => $data['target_scope'],
                'target_organization_ids' => $data['target_organization_ids'] ?? null,
                'target_departments' => $data['target_departments'] ?? null,
                'target_roles' => $data['target_roles'] ?? null,
                'is_pinned' => $data['is_pinned'] ?? false, 'is_important' => $data['is_important'] ?? false,
                'image_url' => $request->hasFile('image') ? Storage::disk('public')->url($request->file('image')->store('announcements', 'public')) : null,
                'approval_status' => 'approved', 'is_published' => ($data['publish'] ?? false),
                'created_by' => $request->user()->school_id, 'reviewed_by' => $publishNow ? $request->user()->school_id : null,
                'published_at' => $publishNow ? now() : null, 'scheduled_at' => $data['scheduled_at'] ?? null, 'expires_at' => $data['expires_at'] ?? null,
            ]);
            $this->syncRecipients($announcement);
            if ($publishNow) $this->notifyRecipients($announcement);
            $this->audit($request, 'global_announcement_created', $announcement, ['target_scope' => $announcement->target_scope, 'recipient_count' => $announcement->recipients()->count(), 'published' => $publishNow]);
            return $announcement;
        });
        return response()->json($announcement->load('sourceOrganization:id,name,acronym')->loadCount('recipients'), 201);
    }

    public function update(Request $request, Announcement $announcement)
    {
        if ($announcement->announcement_source !== 'SAO') return response()->json(['message' => 'Only official SAO announcements are managed here.'], 404);
        if ($announcement->is_published && $announcement->published_at) return response()->json(['message' => 'Published announcements can be archived, but their audience cannot be changed.'], 422);
        $data = $this->validatedPayload($request, true);
        $old = $announcement->only(['title', 'body', 'target_scope', 'target_organization_ids', 'target_departments', 'target_roles', 'scheduled_at', 'expires_at']);
        $publishNow = ($data['publish'] ?? false) && empty($data['scheduled_at']);
        $values = collect($data)->except(['publish', 'image'])->all();
        if ($request->hasFile('image')) $values['image_url'] = Storage::disk('public')->url($request->file('image')->store('announcements', 'public'));
        if ($publishNow) $values += ['is_published' => true, 'published_at' => now(), 'reviewed_by' => $request->user()->school_id];
        $announcement->update($values);
        $this->syncRecipients($announcement->fresh());
        if ($publishNow) $this->notifyRecipients($announcement->fresh());
        $this->audit($request, 'global_announcement_updated', $announcement, ['before' => $old, 'after' => $announcement->fresh()->only(array_keys($old))]);
        return response()->json($announcement->fresh()->load('sourceOrganization:id,name,acronym')->loadCount('recipients'));
    }

    public function archive(Request $request, Announcement $announcement)
    {
        if ($announcement->announcement_source !== 'SAO') return response()->json(['message' => 'Announcement not found.'], 404);
        $announcement->update(['is_published' => false, 'expires_at' => now()]);
        $this->audit($request, 'global_announcement_archived', $announcement, []);
        return response()->json(['message' => 'Official announcement archived.']);
    }

    public function publishScheduled(): int
    {
        $announcements = Announcement::where('announcement_source', 'SAO')->where('is_published', true)->whereNull('published_at')->whereNotNull('scheduled_at')->where('scheduled_at', '<=', now())->get();
        foreach ($announcements as $announcement) {
            $announcement->update(['published_at' => now(), 'reviewed_by' => $announcement->created_by]);
            $this->notifyRecipients($announcement->fresh());
        }
        return $announcements->count();
    }

    private function validatedPayload(Request $request, bool $updating = false): array
    {
        $required = $updating ? 'sometimes|required' : 'required';
        $data = $request->validate([
            'title' => [$required, 'string', 'max:255'], 'body' => [$required, 'string'],
            'category' => ['nullable', 'in:general,election,training,events,merchandise'], 'image' => ['nullable', 'image', 'mimes:jpeg,png,webp', 'max:5120'],
            'target_scope' => [$required, Rule::in(self::SCOPES)],
            'target_organization_ids' => ['nullable', 'array', 'max:200'], 'target_organization_ids.*' => ['integer', 'exists:organizations,id'],
            'target_departments' => ['nullable', 'array', 'max:100'], 'target_departments.*' => ['string', 'max:255'],
            'target_roles' => ['nullable', 'array', 'max:4'], 'target_roles.*' => [Rule::in(self::ROLES)],
            'publish' => ['sometimes', 'boolean'], 'scheduled_at' => ['nullable', 'date', 'after:now'], 'expires_at' => ['nullable', 'date', 'after:now'],
            'is_pinned' => ['sometimes', 'boolean'], 'is_important' => ['sometimes', 'boolean'],
        ]);
        $scope = $data['target_scope'] ?? null;
        if ($scope === 'selected_organizations' && empty($data['target_organization_ids'])) return abort(response()->json(['message' => 'Choose at least one organization.'], 422));
        if ($scope === 'selected_departments' && empty($data['target_departments'])) return abort(response()->json(['message' => 'Choose at least one department.'], 422));
        if (! empty($data['scheduled_at']) && ! empty($data['expires_at']) && strtotime($data['expires_at']) <= strtotime($data['scheduled_at'])) return abort(response()->json(['message' => 'Expiration must be after the scheduled publish date.'], 422));
        return $data;
    }

    private function syncRecipients(Announcement $announcement): void
    {
        $query = User::query()->where('account_status', 'active')->whereHas('organization', fn ($q) => $q->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION'));
        match ($announcement->target_scope) {
            'selected_organizations' => $query->whereIn('organization_id', $announcement->target_organization_ids ?? []),
            'all_departments' => $query->whereNotNull('department'),
            'selected_departments' => $query->whereIn('department', $announcement->target_departments ?? []),
            default => null,
        };
        if (! empty($announcement->target_roles)) $query->whereIn('role', $announcement->target_roles);
        $rows = $query->get(['school_id', 'organization_id'])->map(fn ($user) => ['announcement_id' => $announcement->id, 'user_id' => $user->school_id, 'organization_id' => $user->organization_id, 'created_at' => now(), 'updated_at' => now()]);
        AnnouncementRecipient::where('announcement_id', $announcement->id)->delete();
        foreach ($rows->chunk(250) as $chunk) AnnouncementRecipient::insert($chunk->all());
    }

    private function notifyRecipients(Announcement $announcement): void
    {
        $now = now(); $message = str($announcement->body)->stripTags()->squish()->limit(180)->toString();
        $rows = $announcement->recipients()->get(['user_id', 'organization_id'])->map(fn ($recipient) => ['organization_id' => $recipient->organization_id, 'user_id' => $recipient->user_id, 'notification_type' => 'announcement', 'title' => 'SAO Official: '.str($announcement->title)->limit(220), 'message' => $message, 'reference_type' => Announcement::class, 'reference_id' => $announcement->id, 'is_read' => false, 'sent_at' => $now, 'created_at' => $now, 'updated_at' => $now]);
        foreach ($rows->chunk(250) as $chunk) Notification::insert($chunk->all());
    }

    private function sao(): Organization
    {
        return Organization::where('organization_type', 'SYSTEM_ADMINISTRATION')->where('acronym', 'SAO')->firstOrFail();
    }

    private function audit(Request $request, string $action, Announcement $announcement, array $values): void
    {
        AuditLog::create(['organization_id' => $request->user()->organization_id, 'user_id' => $request->user()->school_id, 'module' => 'global_announcements', 'action' => $action, 'record_type' => Announcement::class, 'record_id' => $announcement->id, 'new_values' => $values, 'ip_address' => $request->ip(), 'created_at' => now()]);
    }
}
