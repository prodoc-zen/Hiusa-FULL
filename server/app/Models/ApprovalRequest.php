<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class ApprovalRequest extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'requested_at' => 'datetime',
            'reviewed_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::created(function (ApprovalRequest $approval): void {
            $approval->notifyApprovers();
            $approval->recordSubmissionAudit();
        });
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by', 'school_id');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by', 'school_id');
    }

    public function resubmit(): void
    {
        if ($this->status !== 'rejected') {
            return;
        }

        $this->reopen((int) $this->requested_by, (string) $this->required_role);
    }

    public function reopen(int $requestedBy, string $requiredRole): void
    {

        $oldValues = [
            'status' => $this->status,
            'requested_by' => $this->requested_by,
            'required_role' => $this->required_role,
            'reviewed_by' => $this->reviewed_by,
            'reviewed_at' => $this->reviewed_at,
            'remarks' => $this->remarks,
        ];

        $this->update([
            'status' => 'pending',
            'requested_by' => $requestedBy,
            'required_role' => $requiredRole,
            'reviewed_by' => null,
            'reviewed_at' => null,
            'remarks' => null,
            'requested_at' => now(),
        ]);

        $this->notifyApprovers();
        $this->recordSubmissionAudit('resubmitted', $oldValues);
    }

    private function notifyApprovers(): void
    {
        $approvers = User::query()
            ->where('organization_id', $this->organization_id)
            ->where('role', $this->required_role)
            ->where('account_status', 'active')
            ->get(['school_id']);

        foreach ($approvers as $approver) {
            Notification::create([
                'organization_id' => $this->organization_id,
                'user_id' => $approver->school_id,
                'title' => 'Approval Request Submitted',
                'message' => Str::headline($this->entity_type).' request #'.$this->entity_id.' requires your review.',
                'notification_type' => 'general',
                'reference_type' => 'approval_request',
                'reference_id' => $this->id,
                'is_read' => false,
                'sent_at' => now(),
            ]);
        }
    }

    private function recordSubmissionAudit(string $action = 'submitted', ?array $oldValues = null): void
    {
        AuditLog::create([
            'organization_id' => $this->organization_id,
            'user_id' => $this->requested_by,
            'module' => 'approvals',
            'action' => $action,
            'record_type' => self::class,
            'record_id' => $this->id,
            'old_values' => $oldValues,
            'new_values' => [
                'entity_type' => $this->entity_type,
                'entity_id' => $this->entity_id,
                'required_role' => $this->required_role,
                'status' => $this->status,
            ],
            'ip_address' => null,
            'created_at' => now(),
        ]);
    }
}
