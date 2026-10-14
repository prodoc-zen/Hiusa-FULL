<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\Announcement;
use App\Models\AnnouncementRecipient;
use App\Models\AuditLog;
use App\Models\ComplianceRequirementType;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ComplianceReminderController extends Controller
{
    public function store(Request $request, Organization $organization)
    {
        $actor = $request->user();
        abort_unless($actor->role === 'SUPER_ADMIN' || ($actor->role === 'DEPARTMENT_HEAD' && in_array($organization->id, $actor->scopedOrganizationIds(), true)), 403);
        abort_unless($organization->organization_type === 'STUDENT_ORGANIZATION' && $organization->lifecycle_status === 'active', 404);

        $data = $request->validate([
            'requirement_type_id' => ['required', 'integer', 'exists:compliance_requirement_types,id'],
            'message' => ['required', 'string', 'min:5', 'max:2000'],
        ]);
        $requirement = ComplianceRequirementType::whereKey($data['requirement_type_id'])->where('is_active', true)->firstOrFail();
        $approved = OrganizationComplianceSubmission::where('organization_id', $organization->id)
            ->where('requirement_type_id', $requirement->id)->where('status', 'approved')->exists();
        abort_if($approved, 409, 'This requirement has already been approved.');

        $memberProfiles = AccountProfile::where('organization_id', $organization->id)->where('account_status', 'active')->get(['user_school_id', 'organization_id']);
        $memberIds = $memberProfiles->pluck('user_school_id');
        $recipientIds = $memberIds->merge(User::where('organization_id', $organization->id)->where('account_status', 'active')->pluck('school_id'));
        if ($organization->college_id) {
            $heads = User::where('role', 'DEPARTMENT_HEAD')->where('account_status', 'active')
                ->whereHas('organization', fn ($home) => $home->where('organization_type', 'COLLEGE')->where('college_id', $organization->college_id))
                ->pluck('school_id');
            $recipientIds = $recipientIds->merge($heads);
        }
        $recipients = User::whereIn('school_id', $recipientIds->unique())->where('account_status', 'active')->get(['school_id', 'organization_id']);
        $contexts = $memberProfiles->map(fn ($profile) => ['user_id' => $profile->user_school_id, 'organization_id' => $profile->organization_id])
            ->concat($recipients->map(fn ($user) => ['user_id' => $user->school_id, 'organization_id' => $user->organization_id]))
            ->filter(fn ($context) => $recipients->contains('school_id', $context['user_id']))
            ->unique(fn ($context) => $context['user_id'].':'.$context['organization_id']);

        $announcement = DB::transaction(function () use ($request, $actor, $organization, $requirement, $data, $recipients, $contexts) {
            $now = now();
            $title = mb_strimwidth('Compliance reminder: '.$requirement->name, 0, 255, '…');
            $body = $organization->name.': '.$requirement->name."\n\n".trim($data['message']);
            $announcement = Announcement::create([
                'organization_id' => $actor->organization_id,
                'source_organization_id' => $actor->organization_id,
                'announcement_source' => 'COMPLIANCE',
                'title' => $title,
                'body' => $body,
                'category' => 'general',
                'target_role' => 'all',
                'target_scope' => 'selected_organizations',
                'target_organization_ids' => [$organization->id],
                'approval_status' => 'approved',
                'is_published' => true,
                'published_at' => $now,
                'created_by' => $actor->school_id,
                'reviewed_by' => $actor->school_id,
            ]);
            foreach ($recipients->chunk(250) as $chunk) {
                AnnouncementRecipient::insert($chunk->map(fn (User $user) => [
                    'announcement_id' => $announcement->id, 'user_id' => $user->school_id,
                    'organization_id' => $user->organization_id, 'created_at' => $now, 'updated_at' => $now,
                ])->all());
            }
            foreach ($contexts->chunk(250) as $chunk) {
                Notification::insert($chunk->map(fn ($context) => [
                    'organization_id' => $context['organization_id'], 'user_id' => $context['user_id'],
                    'notification_type' => 'announcement', 'title' => $title,
                    'message' => mb_strimwidth(trim($data['message']), 0, 180, '…'),
                    'reference_type' => Announcement::class, 'reference_id' => $announcement->id,
                    'is_read' => false, 'sent_at' => $now, 'created_at' => $now, 'updated_at' => $now,
                ])->all());
            }
            AuditLog::create([
                'organization_id' => $organization->id, 'user_id' => $actor->school_id,
                'actor_role' => $actor->role, 'module' => 'compliance', 'action' => 'requirement_reminder_sent',
                'record_type' => Announcement::class, 'record_id' => $announcement->id,
                'new_values' => ['requirement_type_id' => $requirement->id, 'recipient_count' => $recipients->count()],
                'ip_address' => $request->ip(), 'created_at' => $now,
            ]);

            return $announcement;
        });

        return response()->json(['id' => $announcement->id, 'recipient_count' => $recipients->count()], 201);
    }
}
