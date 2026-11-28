<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\College;
use App\Models\Event;
use App\Models\EventPersonnel;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EventPersonnelTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private Event $event;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->event = Event::factory()->create([
            'organization_id' => $this->organization->id,
            'created_by' => $this->admin->school_id,
            'status' => 'approved',
            'approved_at' => now()->subDay(),
            'title' => 'Foundation Week',
        ]);
    }

    private function member(string $role = 'STUDENT', ?string $title = null, ?Organization $in = null): User
    {
        return User::factory()->create(['organization_id' => ($in ?? $this->organization)->id, 'role' => $role, 'position_title' => $title]);
    }

    private function assign(User $person, string $label = 'Logistics', ?Event $event = null): EventPersonnel
    {
        return EventPersonnel::create([
            'event_id' => ($event ?? $this->event)->id,
            'user_school_id' => $person->school_id,
            'role_label' => $label,
            'assigned_by' => $this->admin->school_id,
        ]);
    }

    public function test_the_admin_adds_a_member_to_the_team_and_the_list_shows_them(): void
    {
        $person = $this->member('SBO_OFFICER', 'Business Manager');
        Sanctum::actingAs($this->admin);

        $this->postJson("/api/events/{$this->event->id}/personnel", ['user_school_id' => $person->school_id, 'role_label' => '  Overall head '])
            ->assertCreated()
            ->assertJsonPath('role_label', 'Overall head')
            ->assertJsonPath('user_school_id', $person->school_id);

        $this->getJson("/api/events/{$this->event->id}/personnel")
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.name', trim($person->first_name.' '.$person->last_name))
            ->assertJsonPath('0.role_label', 'Overall head');
    }

    public function test_available_lists_active_members_not_yet_on_the_team_with_their_position(): void
    {
        $free = $this->member('SBO_OFFICER', 'Business Manager');
        $taken = $this->member();
        $inactive = $this->member();
        $inactive->update(['account_status' => 'inactive']);
        $elsewhere = $this->member('STUDENT', null, Organization::factory()->create());
        $this->assign($taken);
        Sanctum::actingAs($this->admin);

        $rows = collect($this->getJson("/api/events/{$this->event->id}/personnel/available")->assertOk()->json());

        $this->assertTrue($rows->contains('school_id', $free->school_id));
        $this->assertSame('Business Manager', $rows->firstWhere('school_id', $free->school_id)['position_title']);
        $this->assertFalse($rows->contains('school_id', $taken->school_id));
        $this->assertFalse($rows->contains('school_id', $inactive->school_id));
        $this->assertFalse($rows->contains('school_id', $elsewhere->school_id));
    }

    public function test_available_can_be_narrowed_by_name(): void
    {
        $match = User::factory()->student()->create(['organization_id' => $this->organization->id, 'first_name' => 'Zephyrine', 'last_name' => 'Quill']);
        $this->member();
        Sanctum::actingAs($this->admin);

        $rows = $this->getJson("/api/events/{$this->event->id}/personnel/available?q=zephy")->assertOk()->json();

        $this->assertSame([$match->school_id], array_column($rows, 'school_id'));
    }

    public function test_the_admin_removes_a_member_from_the_team(): void
    {
        $member = $this->assign($this->member());
        Sanctum::actingAs($this->admin);

        $this->deleteJson("/api/events/{$this->event->id}/personnel/{$member->id}")->assertOk();

        $this->assertDatabaseMissing('event_personnel', ['id' => $member->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'event_personnel_removed', 'record_id' => $this->event->id, 'user_id' => $this->admin->school_id]);
    }

    public function test_an_event_of_another_organization_is_not_found(): void
    {
        $other = Organization::factory()->create();
        $otherAdmin = User::factory()->admin()->create(['organization_id' => $other->id]);
        $person = $this->member();
        $member = $this->assign($person);
        Sanctum::actingAs($otherAdmin);

        $this->getJson("/api/events/{$this->event->id}/personnel")->assertNotFound();
        $this->getJson("/api/events/{$this->event->id}/personnel/available")->assertNotFound();
        $this->postJson("/api/events/{$this->event->id}/personnel", ['user_school_id' => $person->school_id, 'role_label' => 'Host'])->assertNotFound();
        $this->deleteJson("/api/events/{$this->event->id}/personnel/{$member->id}")->assertNotFound();
        $this->assertDatabaseHas('event_personnel', ['id' => $member->id]);
    }

    public function test_a_person_outside_the_organization_cannot_be_added(): void
    {
        $outsider = $this->member('STUDENT', null, Organization::factory()->create());
        Sanctum::actingAs($this->admin);

        $this->postJson("/api/events/{$this->event->id}/personnel", ['user_school_id' => $outsider->school_id, 'role_label' => 'Host'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('user_school_id');
        $this->assertDatabaseCount('event_personnel', 0);
    }

    public function test_an_inactive_member_cannot_be_added(): void
    {
        $person = $this->member();
        $person->update(['account_status' => 'inactive']);
        Sanctum::actingAs($this->admin);

        $this->postJson("/api/events/{$this->event->id}/personnel", ['user_school_id' => $person->school_id, 'role_label' => 'Host'])
            ->assertUnprocessable();
    }

    public function test_the_same_person_cannot_be_added_twice(): void
    {
        $person = $this->member();
        $this->assign($person);
        Sanctum::actingAs($this->admin);

        $this->postJson("/api/events/{$this->event->id}/personnel", ['user_school_id' => $person->school_id, 'role_label' => 'Host'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('user_school_id');
        $this->assertDatabaseCount('event_personnel', 1);
    }

    public function test_the_role_label_is_required_and_limited_to_80_characters(): void
    {
        $person = $this->member();
        Sanctum::actingAs($this->admin);
        $url = "/api/events/{$this->event->id}/personnel";

        $this->postJson($url, ['user_school_id' => $person->school_id])->assertUnprocessable()->assertJsonValidationErrors('role_label');
        $this->postJson($url, ['user_school_id' => $person->school_id, 'role_label' => '   '])->assertUnprocessable()->assertJsonValidationErrors('role_label');
        $this->postJson($url, ['user_school_id' => $person->school_id, 'role_label' => str_repeat('a', 81)])->assertUnprocessable()->assertJsonValidationErrors('role_label');
        $this->postJson($url, ['user_school_id' => $person->school_id, 'role_label' => str_repeat('a', 80)])->assertCreated();
    }

    public function test_an_officer_can_read_the_team_but_not_change_it(): void
    {
        $officer = $this->member('SBO_OFFICER');
        $person = $this->member();
        $member = $this->assign($person);
        Sanctum::actingAs($officer);

        $this->getJson("/api/events/{$this->event->id}/personnel")->assertOk()->assertJsonCount(1);
        $this->getJson("/api/events/{$this->event->id}/personnel/available")->assertOk();
        $this->postJson("/api/events/{$this->event->id}/personnel", ['user_school_id' => $this->member()->school_id, 'role_label' => 'Host'])->assertForbidden();
        $this->deleteJson("/api/events/{$this->event->id}/personnel/{$member->id}")->assertForbidden();
        $this->assertDatabaseCount('event_personnel', 1);
    }

    public function test_a_student_cannot_read_the_team(): void
    {
        Sanctum::actingAs($this->member());

        $this->getJson("/api/events/{$this->event->id}/personnel")->assertForbidden();
    }

    public function test_the_dean_reads_the_team_of_an_event_in_the_college_and_cannot_change_it(): void
    {
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $home = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE']);
        $club = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id]);
        $dean = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $clubAdmin = User::factory()->admin()->create(['organization_id' => $club->id]);
        $event = Event::factory()->create(['organization_id' => $club->id, 'created_by' => $clubAdmin->school_id, 'status' => 'approved', 'approved_at' => now()]);
        $member = $this->assign($this->member('STUDENT', null, $club), 'Logistics', $event);
        Sanctum::actingAs($dean);

        $this->getJson("/api/events/{$event->id}/personnel")->assertOk()->assertJsonPath('0.role_label', 'Logistics');
        $this->postJson("/api/events/{$event->id}/personnel", ['user_school_id' => $member->user_school_id, 'role_label' => 'Host'])->assertForbidden();
        $this->deleteJson("/api/events/{$event->id}/personnel/{$member->id}")->assertForbidden();
        $this->getJson("/api/events/{$this->event->id}/personnel")->assertNotFound();
    }

    public function test_a_cancelled_or_completed_event_refuses_team_changes_with_a_409(): void
    {
        $person = $this->member();
        $member = $this->assign($this->member());
        Sanctum::actingAs($this->admin);

        foreach (['cancelled', 'completed'] as $status) {
            $this->event->update(['status' => $status]);

            $this->postJson("/api/events/{$this->event->id}/personnel", ['user_school_id' => $person->school_id, 'role_label' => 'Host'])
                ->assertStatus(409)
                ->assertJsonPath('message', "The event team cannot change once an event is {$status}.");
            $this->deleteJson("/api/events/{$this->event->id}/personnel/{$member->id}")->assertStatus(409);
        }

        $this->assertDatabaseCount('event_personnel', 1);
        $this->getJson("/api/events/{$this->event->id}/personnel")->assertOk();
    }

    public function test_adding_a_member_notifies_them_under_the_events_organization(): void
    {
        $person = $this->member();
        Sanctum::actingAs($this->admin);

        $this->postJson("/api/events/{$this->event->id}/personnel", ['user_school_id' => $person->school_id, 'role_label' => 'Logistics'])->assertCreated();

        $notification = Notification::where('user_id', $person->school_id)->first();
        $this->assertNotNull($notification);
        $this->assertSame($this->organization->id, (int) $notification->organization_id);
        $this->assertSame(Event::class, $notification->reference_type);
        $this->assertSame($this->event->id, (int) $notification->reference_id);
        $this->assertStringContainsString('Foundation Week', $notification->message);
        $this->assertStringContainsString('Logistics', $notification->message);
        $this->assertFalse((bool) $notification->is_read);
    }

    public function test_the_admin_adding_themselves_is_not_notified(): void
    {
        Sanctum::actingAs($this->admin);

        $this->postJson("/api/events/{$this->event->id}/personnel", ['user_school_id' => $this->admin->school_id, 'role_label' => 'Overall head'])->assertCreated();

        $this->assertSame(0, Notification::where('user_id', $this->admin->school_id)->count());
    }

    public function test_adding_a_member_writes_an_audit_row(): void
    {
        $person = $this->member();
        Sanctum::actingAs($this->admin);

        $this->postJson("/api/events/{$this->event->id}/personnel", ['user_school_id' => $person->school_id, 'role_label' => 'Logistics'])->assertCreated();

        $audit = AuditLog::where('action', 'event_personnel_added')->first();
        $this->assertNotNull($audit);
        $this->assertSame($this->organization->id, (int) $audit->organization_id);
        $this->assertSame('events', $audit->module);
        $this->assertSame(Event::class, $audit->record_type);
        $this->assertSame($this->event->id, (int) $audit->record_id);
        $this->assertSame($this->admin->school_id, (int) $audit->user_id);
        $this->assertSame(['user_school_id' => $person->school_id, 'role_label' => 'Logistics'], $audit->new_values);
    }

    public function test_a_member_of_another_event_is_not_removable_through_this_one(): void
    {
        $otherEvent = Event::factory()->create(['organization_id' => $this->organization->id, 'created_by' => $this->admin->school_id, 'status' => 'approved', 'approved_at' => now()]);
        $member = $this->assign($this->member(), 'Logistics', $otherEvent);
        Sanctum::actingAs($this->admin);

        $this->deleteJson("/api/events/{$this->event->id}/personnel/{$member->id}")->assertNotFound();
        $this->assertDatabaseHas('event_personnel', ['id' => $member->id]);
    }

    public function test_deleting_an_event_removes_its_team(): void
    {
        $this->assign($this->member());

        $this->event->delete();

        $this->assertDatabaseCount('event_personnel', 0);
    }
}
