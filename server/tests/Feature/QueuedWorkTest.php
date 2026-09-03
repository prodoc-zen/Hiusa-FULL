<?php

namespace Tests\Feature;

use App\Jobs\NotifyApproversJob;
use App\Mail\PasswordResetMail;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Covers the two pieces of the slow-path fan-out that were moved off the
 * request cycle: password reset mail and the approval-request notification
 * broadcast. Confirms the queue driver is only ever tested with fakes, per
 * the phpunit.xml QUEUE_CONNECTION=sync pin.
 */
class QueuedWorkTest extends TestCase
{
    use RefreshDatabase;

    public function test_password_reset_mail_is_queued_rather_than_sent_inline(): void
    {
        Mail::fake();

        $user = User::factory()->create([
            'email' => 'queued-reset@example.com',
            'account_status' => 'active',
        ]);

        $this->postJson('/api/password/forgot', [
            'organization_id' => $user->organization_id,
            'email' => 'queued-reset@example.com',
        ])->assertOk();

        Mail::assertQueued(PasswordResetMail::class, fn (PasswordResetMail $mail) => $mail->hasTo('queued-reset@example.com'));
        Mail::assertNotSent(PasswordResetMail::class);
    }

    public function test_creating_an_approval_request_dispatches_the_notification_job_instead_of_writing_notifications_inline(): void
    {
        Bus::fake();

        $officer = User::factory()->officer()->create();

        $approval = ApprovalRequest::create([
            'organization_id' => $officer->organization_id,
            'entity_type' => 'event',
            'entity_id' => 1,
            'requested_by' => $officer->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'pending',
        ]);

        Bus::assertDispatched(NotifyApproversJob::class, fn (NotifyApproversJob $job) => $job->approval->is($approval));
        $this->assertSame(0, Notification::count());

        // The audit trail must not depend on a queue worker being up.
        $this->assertDatabaseHas('audit_logs', [
            'record_type' => ApprovalRequest::class,
            'record_id' => $approval->id,
            'action' => 'submitted',
        ]);
    }

    public function test_running_the_dispatched_job_notifies_every_active_approver_in_the_organization_and_nobody_else(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();

        $requester = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $deptHeadOne = User::factory()->departmentHead()->create(['organization_id' => $organization->id, 'account_status' => 'active']);
        $deptHeadTwo = User::factory()->departmentHead()->create(['organization_id' => $organization->id, 'account_status' => 'active']);
        $disabledDeptHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id, 'account_status' => 'disabled']);
        $wrongRole = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $otherOrgDeptHead = User::factory()->departmentHead()->create(['organization_id' => $otherOrganization->id, 'account_status' => 'active']);

        $approval = ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'event',
            'entity_id' => 42,
            'requested_by' => $requester->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'pending',
        ]);

        // QUEUE_CONNECTION is pinned to sync for tests, so the dispatch above
        // already ran the job inline. Assert on its output directly.
        $this->assertSame(2, Notification::count());
        $this->assertDatabaseHas('notifications', [
            'user_id' => $deptHeadOne->school_id,
            'title' => 'Approval Request Submitted',
            'reference_type' => 'approval_request',
            'reference_id' => $approval->id,
        ]);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $deptHeadTwo->school_id,
            'reference_id' => $approval->id,
        ]);
        $this->assertDatabaseMissing('notifications', ['user_id' => $disabledDeptHead->school_id]);
        $this->assertDatabaseMissing('notifications', ['user_id' => $wrongRole->school_id]);
        $this->assertDatabaseMissing('notifications', ['user_id' => $otherOrgDeptHead->school_id]);
    }

    public function test_approval_request_without_events_still_suppresses_the_job_dispatch_and_the_audit_write(): void
    {
        Bus::fake();

        $officer = User::factory()->officer()->create();

        $approval = ApprovalRequest::withoutEvents(fn () => ApprovalRequest::create([
            'organization_id' => $officer->organization_id,
            'entity_type' => 'event',
            'entity_id' => 7,
            'requested_by' => $officer->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'approved',
        ]));

        Bus::assertNotDispatched(NotifyApproversJob::class);
        $this->assertSame(0, Notification::count());
        $this->assertSame(0, AuditLog::where('record_id', $approval->id)->where('record_type', ApprovalRequest::class)->count());
    }
}
