<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\Budget;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * An event that has run, collected files or attendance, been reviewed or carried approved money is
 * kept on record: deleting it answers 409 and the Admin cancels it instead.
 */
class EventDeleteGuardTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        $this->admin = User::factory()->admin()->create(['organization_id' => Organization::factory()]);
        Sanctum::actingAs($this->admin);
    }

    private function event(string $status = 'planning'): Event
    {
        $event = Event::factory()->create([
            'organization_id' => $this->admin->organization_id,
            'created_by' => $this->admin->school_id,
            'status' => $status,
        ]);
        $this->approval($event, 'pending');

        return $event;
    }

    private function approval(Event $event, string $status): ApprovalRequest
    {
        return ApprovalRequest::create([
            'organization_id' => $event->organization_id,
            'entity_type' => 'event',
            'entity_id' => $event->id,
            'requested_by' => $this->admin->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => $status,
        ]);
    }

    private function budget(Event $event, string $submissionStatus): Budget
    {
        return Budget::create([
            'organization_id' => $event->organization_id, 'event_id' => $event->id, 'title' => 'Event budget', 'allocated_amount' => '5000.00',
            'remaining_amount' => '5000.00', 'warning_threshold' => '500.00', 'submission_status' => $submissionStatus,
        ]);
    }

    public function test_an_untouched_planning_event_with_only_a_pending_request_can_be_deleted(): void
    {
        $event = $this->event();

        $this->deleteJson("/api/events/{$event->id}")->assertOk();

        $this->assertModelMissing($event);
    }

    public function test_an_event_that_is_ongoing_or_completed_cannot_be_deleted(): void
    {
        foreach (['ongoing', 'completed'] as $status) {
            $event = $this->event($status);

            $this->deleteJson("/api/events/{$event->id}")
                ->assertConflict()
                ->assertJsonPath('message', "This event cannot be deleted because it is {$status}. Cancel it instead to keep the record.");
            $this->assertModelExists($event);
        }
    }

    public function test_an_event_with_submitted_requirement_files_cannot_be_deleted(): void
    {
        $event = $this->event();
        $requirement = EventRequirement::create(['name' => 'Event proposal', 'allowed_extensions' => ['pdf']]);
        EventRequirementFile::create([
            'event_id' => $event->id, 'requirement_id' => $requirement->id, 'organization_id' => $event->organization_id,
            'path' => 'event-requirements/proposal.pdf', 'original_name' => 'proposal.pdf', 'uploaded_by' => $this->admin->school_id,
        ]);

        $this->deleteJson("/api/events/{$event->id}")
            ->assertConflict()
            ->assertJsonPath('message', 'This event cannot be deleted because it has submitted requirement files. Cancel it instead to keep the record.');
        $this->assertModelExists($event);
    }

    public function test_an_event_whose_approval_request_was_decided_cannot_be_deleted(): void
    {
        foreach (['approved', 'rejected'] as $status) {
            $event = $this->event();
            ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->update(['status' => $status]);

            $this->deleteJson("/api/events/{$event->id}")
                ->assertConflict()
                ->assertJsonPath('message', 'This event cannot be deleted because it has already been reviewed in the approval workflow. Cancel it instead to keep the record.');
            $this->assertModelExists($event);
        }
    }

    public function test_an_event_with_attendance_cannot_be_deleted(): void
    {
        $event = $this->event();
        Attendance::factory()->create(['event_id' => $event->id, 'user_id' => User::factory()->create(['organization_id' => $event->organization_id])->school_id]);

        $this->deleteJson("/api/events/{$event->id}")
            ->assertConflict()
            ->assertJsonPath('message', 'This event cannot be deleted because it has attendance records. Cancel it instead to keep the record.');
        $this->assertModelExists($event);
    }

    public function test_an_event_with_an_approved_budget_or_budget_transactions_cannot_be_deleted(): void
    {
        $approved = $this->event();
        $this->budget($approved, 'approved');
        $spent = $this->event();
        $budget = $this->budget($spent, 'pending_department_head');
        Transaction::create([
            'organization_id' => $spent->organization_id, 'recorded_by' => $this->admin->school_id, 'budget_id' => $budget->id,
            'type' => 'expense', 'amount' => '100.00', 'category' => 'Supplies', 'description' => 'Supplies', 'transaction_date' => '2026-10-05',
        ]);

        foreach ([$approved, $spent] as $event) {
            $this->deleteJson("/api/events/{$event->id}")
                ->assertConflict()
                ->assertJsonPath('message', 'This event cannot be deleted because it has a budget. Cancel it instead to keep the record.');
            $this->assertModelExists($event);
        }
    }

    public function test_a_proposed_budget_still_waiting_for_review_blocks_deletion(): void
    {
        $event = $this->event();
        $budget = $this->budget($event, 'pending_department_head');

        $this->deleteJson("/api/events/{$event->id}")
            ->assertConflict()
            ->assertJsonPath('message', 'This event cannot be deleted because it has a budget. Cancel it instead to keep the record.');

        $this->assertModelExists($event);
        $this->assertModelExists($budget);
        $this->assertSame($event->id, $budget->fresh()->event_id);
    }

    public function test_a_blocked_cancelled_event_is_told_it_is_already_cancelled(): void
    {
        $event = $this->event('cancelled');
        $this->budget($event, 'approved');

        $this->deleteJson("/api/events/{$event->id}")
            ->assertConflict()
            ->assertJsonPath('message', 'This event cannot be deleted because it has a budget. It is already cancelled and stays on record.');
    }

    public function test_the_admin_event_list_and_detail_say_why_an_event_cannot_be_deleted(): void
    {
        $free = $this->event();
        $running = $this->event('ongoing');

        $rows = collect($this->getJson('/api/events')->assertOk()->json('data'))->keyBy('id');
        $this->assertNull($rows[$free->id]['delete_blocked_reason']);
        $this->assertSame('This event cannot be deleted because it is ongoing. Cancel it instead to keep the record.', $rows[$running->id]['delete_blocked_reason']);

        $this->getJson("/api/events/{$free->id}")->assertOk()->assertJsonPath('delete_blocked_reason', null);
        $this->getJson("/api/events/{$running->id}")->assertOk()
            ->assertJsonPath('delete_blocked_reason', 'This event cannot be deleted because it is ongoing. Cancel it instead to keep the record.');
    }
}
