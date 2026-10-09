<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** SAO decisions over an organization's lifecycle: registration review, archive and restore. */
class OrganizationLifecycleController extends Controller
{
    public function review(Request $request, Organization $organization)
    {
        $data = $request->validate([
            'decision' => ['required', 'in:approve,return'],
            'remarks' => ['nullable', 'string', 'max:3000', 'required_if:decision,return'],
            'submitted_at' => ['required', 'date'],
        ]);
        $reviewer = $request->user();

        // The lifecycle check and the write share one locked read, and the
        // submitted_at the reviewer saw must still be current, so a head's
        // resubmission cannot slip in between and be approved unseen.
        $result = DB::transaction(function () use ($request, $organization, $data, $reviewer) {
            $locked = Organization::whereKey($organization->id)->lockForUpdate()->first();
            if ($locked->organization_type !== 'STUDENT_ORGANIZATION' || $locked->lifecycle_status !== 'pending') {
                return 'not_pending';
            }
            if (! $locked->submitted_at || ! $locked->submitted_at->equalTo($data['submitted_at'])) {
                return 'stale';
            }

            $approved = $data['decision'] === 'approve';
            $locked->update([
                'lifecycle_status' => $approved ? 'active' : 'returned',
                'is_active' => $approved,
                'review_remarks' => $data['remarks'] ?? null,
                'reviewed_by' => $reviewer->school_id,
                'reviewed_at' => now(),
            ]);
            if ($approved) {
                OrganizationComplianceSubmission::where('organization_id', $locked->id)->where('status', 'submitted')
                    ->update(['status' => 'approved', 'reviewed_by' => $reviewer->school_id, 'reviewed_at' => now()]);
            }
            $this->audit($request, $approved ? 'organization_approved' : 'organization_returned', $locked, ['remarks' => $data['remarks'] ?? null], $approved ? 'SAO approved an organization registration.' : 'SAO returned an organization registration.');

            return $locked;
        });

        if (is_string($result)) {
            return response()->json(['message' => $result === 'stale'
                ? 'This registration was resubmitted after you loaded it. Refresh and review the latest version.'
                : 'Only a pending registration can be reviewed.'], 409);
        }

        $approved = $data['decision'] === 'approve';
        $this->notifySubmitter($result, $approved ? 'Organization registration approved' : 'Organization registration returned', $approved
            ? "{$result->name} was approved and is now active."
            : "{$result->name} was returned: ".$data['remarks']);

        return response()->json($result->fresh());
    }

    public function archive(Request $request, Organization $organization)
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:1000']]);

        $archived = DB::transaction(function () use ($organization, $request, $data) {
            $locked = Organization::whereKey($organization->id)->lockForUpdate()->first();
            if ($locked->organization_type !== 'STUDENT_ORGANIZATION' || $locked->lifecycle_status !== 'active') {
                return null;
            }
            $locked->update(['lifecycle_status' => 'archived', 'is_active' => false, 'archived_at' => now(), 'archived_by' => $request->user()->school_id]);
            $this->audit($request, 'organization_archived', $locked, ['reason' => $data['reason'] ?? null], 'SAO archived a student organization.');

            return $locked;
        });
        if (! $archived) {
            return response()->json(['message' => 'Only an active student organization can be archived.'], 409);
        }

        return response()->json($archived->fresh());
    }

    public function restore(Request $request, Organization $organization)
    {
        $restored = DB::transaction(function () use ($request, $organization) {
            $locked = Organization::whereKey($organization->id)->lockForUpdate()->first();
            if ($locked->lifecycle_status !== 'archived') {
                return null;
            }
            $locked->update(['lifecycle_status' => 'active', 'is_active' => true, 'archived_at' => null, 'archived_by' => null]);
            $this->audit($request, 'organization_restored', $locked, [], 'SAO restored an archived student organization.');

            return $locked;
        });
        if (! $restored) {
            return response()->json(['message' => 'Only an archived organization can be restored.'], 409);
        }

        return response()->json($restored->fresh());
    }

    private function notifySubmitter(Organization $organization, string $title, string $message): void
    {
        $submitter = $organization->submitted_by ? User::find($organization->submitted_by, ['school_id', 'organization_id']) : null;
        if (! $submitter) {
            return;
        }
        Notification::create([
            'organization_id' => $submitter->organization_id,
            'user_id' => $submitter->school_id,
            'notification_type' => 'general',
            'title' => $title,
            'message' => $message,
            'reference_type' => 'organization',
            'reference_id' => $organization->id,
            'is_read' => false,
            'sent_at' => now(),
        ]);
    }

    private function audit(Request $request, string $action, Organization $organization, array $values, string $description): void
    {
        AuditLog::create(['organization_id' => $organization->id, 'user_id' => $request->user()->school_id, 'actor_role' => $request->user()->role, 'module' => 'system_administration', 'action' => $action, 'description' => $description, 'record_type' => Organization::class, 'record_id' => $organization->id, 'new_values' => $values, 'ip_address' => $request->ip(), 'created_at' => now()]);
    }
}
