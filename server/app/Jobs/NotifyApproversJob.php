<?php

namespace App\Jobs;

use App\Models\ApprovalRequest;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Str;

class NotifyApproversJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 3;

    public function __construct(public readonly ApprovalRequest $approval)
    {
        // Keep the after-commit guarantee tied to this job rather than to
        // whichever queue connection happens to be configured - see
        // config/queue.php, where only the database connection sets it.
        $this->afterCommit();
    }

    public function handle(): void
    {
        $approvers = User::query()
            ->where('organization_id', $this->approval->organization_id)
            ->where('role', $this->approval->required_role)
            ->where('account_status', 'active')
            ->get(['school_id']);

        foreach ($approvers as $approver) {
            // firstOrCreate rather than create: a retried attempt (this job has
            // $tries = 3) must not re-notify an approver it already wrote to on a
            // prior, partially-completed run.
            Notification::firstOrCreate([
                'organization_id' => $this->approval->organization_id,
                'user_id' => $approver->school_id,
                'reference_type' => 'approval_request',
                'reference_id' => $this->approval->id,
            ], [
                'title' => 'Approval Request Submitted',
                'message' => Str::headline($this->approval->entity_type).' request #'.$this->approval->entity_id.' requires your review.',
                'notification_type' => 'general',
                'is_read' => false,
                'sent_at' => now(),
            ]);
        }
    }
}
