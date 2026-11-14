<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Event;
use App\Models\Organization;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Deleting or changing an event, and deleting a task, leave an audit row the SAO can read:
 * who did it, in which organization, and what the record was before.
 */
class EventTaskAuditTest extends TestCase
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
        return Event::factory()->create([
            'organization_id' => $this->admin->organization_id, 'created_by' => $this->admin->school_id,
            'title' => 'Orientation Day', 'status' => $status,
        ]);
    }

    private function task(): Task
    {
        return Task::factory()->create([
            'organization_id' => $this->admin->organization_id, 'created_by' => $this->admin->school_id,
            'event_id' => null, 'title' => 'Print the programs', 'status' => 'pending',
        ]);
    }

    public function test_deleting_an_event_is_audited_with_who_and_what_it_was(): void
    {
        $event = $this->event();

        $this->deleteJson("/api/events/{$event->id}")->assertOk();

        $log = AuditLog::where('module', 'events')->where('action', 'event_deleted')->firstOrFail();
        $this->assertSame($event->id, (int) $log->record_id);
        $this->assertSame(Event::class, $log->record_type);
        $this->assertSame($this->admin->organization_id, $log->organization_id);
        $this->assertSame($this->admin->school_id, $log->user_id);
        $this->assertSame('ADMIN', $log->actor_role);
        $this->assertSame('Orientation Day', $log->old_values['title']);
        $this->assertSame('planning', $log->old_values['status']);
    }

    public function test_a_refused_event_delete_leaves_no_audit_row(): void
    {
        $event = $this->event('completed');

        $this->deleteJson("/api/events/{$event->id}")->assertConflict();

        $this->assertSame(0, AuditLog::where('module', 'events')->count());
    }

    public function test_changing_an_event_is_audited_with_only_the_fields_that_changed(): void
    {
        $event = $this->event();

        $this->putJson("/api/events/{$event->id}", ['title' => 'Orientation Week', 'description' => $event->description])->assertOk();

        $log = AuditLog::where('module', 'events')->where('action', 'event_updated')->firstOrFail();
        $this->assertSame($event->id, (int) $log->record_id);
        $this->assertSame($this->admin->school_id, $log->user_id);
        $this->assertSame(['title' => 'Orientation Day'], $log->old_values);
        $this->assertSame(['title' => 'Orientation Week'], $log->new_values);
    }

    public function test_saving_an_event_without_changing_anything_writes_no_audit_row(): void
    {
        $event = $this->event();

        $this->putJson("/api/events/{$event->id}", ['title' => 'Orientation Day'])->assertOk();

        $this->assertSame(0, AuditLog::where('module', 'events')->count());
    }

    public function test_cancelling_an_event_is_audited_as_a_status_change(): void
    {
        $event = $this->event();

        $this->patchJson("/api/events/{$event->id}/status", ['status' => 'cancelled'])->assertOk();

        $log = AuditLog::where('module', 'events')->where('action', 'event_status_changed')->firstOrFail();
        $this->assertSame($event->id, (int) $log->record_id);
        $this->assertSame(['status' => 'planning'], $log->old_values);
        $this->assertSame(['status' => 'cancelled'], $log->new_values);
        $this->assertSame($this->admin->school_id, $log->user_id);
    }

    public function test_a_refused_status_change_leaves_no_audit_row(): void
    {
        $event = $this->event('cancelled');

        $this->patchJson("/api/events/{$event->id}/status", ['status' => 'planning'])->assertUnprocessable();

        $this->assertSame(0, AuditLog::where('module', 'events')->count());
    }

    public function test_deleting_a_task_is_audited_with_who_and_what_it_was(): void
    {
        $task = $this->task();

        $this->deleteJson("/api/tasks/{$task->id}")->assertOk();

        $log = AuditLog::where('module', 'tasks')->where('action', 'task_deleted')->firstOrFail();
        $this->assertSame($task->id, (int) $log->record_id);
        $this->assertSame(Task::class, $log->record_type);
        $this->assertSame($this->admin->organization_id, $log->organization_id);
        $this->assertSame($this->admin->school_id, $log->user_id);
        $this->assertSame('Print the programs', $log->old_values['title']);
        $this->assertSame('pending', $log->old_values['status']);
    }

    public function test_a_task_from_another_organization_is_not_deleted_and_not_audited(): void
    {
        $other = Task::factory()->create(['organization_id' => Organization::factory(), 'event_id' => null]);

        $this->deleteJson("/api/tasks/{$other->id}")->assertNotFound();

        $this->assertModelExists($other);
        $this->assertSame(0, AuditLog::where('module', 'tasks')->count());
    }
}
