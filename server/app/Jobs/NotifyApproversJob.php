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

    public function __construct(public readonly ApprovalRequest $approval) {}

    public function handle(): void
    {
        $approvers = User::query()
            ->where('organization_id', $this->approval->organization_id)
            ->where('role', $this->approval->required_role)
            ->where('account_status', 'active')
            ->get(['school_id']);

        foreach ($approvers as $approver) {
            Notification::create([
                'organization_id' => $this->approval->organization_id,
                'user_id' => $approver->school_id,
                'title' => 'Approval Request Submitted',
                'message' => Str::headline($this->approval->entity_type).' request #'.$this->approval->entity_id.' requires your review.',
                'notification_type' => 'general',
                'reference_type' => 'approval_request',
                'reference_id' => $this->approval->id,
                'is_read' => false,
                'sent_at' => now(),
            ]);
        }
    }
}
