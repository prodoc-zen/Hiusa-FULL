<?php

namespace App\Models;

use App\Jobs\NotifyApproversJob;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ApprovalRequest extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'assigned_approver' => 'integer',
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

    public function assignedApprover(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_approver', 'school_id');
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
            'assigned_approver' => $this->assigned_approver,
            'reviewed_by' => $this->reviewed_by,
            'decision' => $this->decision,
            'reviewed_at' => $this->reviewed_at,
            'remarks' => $this->remarks,
        ];

        $this->update([
            'status' => 'pending',
            'requested_by' => $requestedBy,
            'required_role' => $requiredRole,
            'assigned_approver' => null,
            'reviewed_by' => null,
            'decision' => null,
            'reviewed_at' => null,
            'remarks' => null,
            'requested_at' => now(),
        ]);

        $this->notifyApprovers();
        $this->recordSubmissionAudit('resubmitted', $oldValues);
    }

    private function notifyApprovers(): void
    {
        NotifyApproversJob::dispatch($this);
    }

    private function recordSubmissionAudit(string $action = 'submitted', ?array $oldValues = null): void
    {
        AuditLog::create([
            'organization_id' => $this->organization_id,
            'user_id' => $this->requested_by,
            'actor_role' => $this->requester()->value('role'),
            'module' => 'approvals',
            'action' => $action,
            'description' => 'Approval request '.$action.' for '.$this->entity_type.'.',
            'record_type' => self::class,
            'record_id' => $this->id,
            'old_values' => $oldValues,
            'new_values' => [
                'entity_type' => $this->entity_type,
                'entity_id' => $this->entity_id,
                'required_role' => $this->required_role,
                'assigned_approver' => $this->assigned_approver,
                'status' => $this->status,
            ],
            'ip_address' => null,
            'created_at' => now(),
        ]);
    }
}
