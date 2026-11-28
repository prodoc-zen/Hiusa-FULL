<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\Budget;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * Paper Fig 31: the Adviser reviews operational execution and participation records and officers monitor event
 * budget use. The event detail gives the dean, the dean's office staff and the organization's officers the attendance
 * breakdown and the linked budgets, read only: the delete blockers stay the Admin's.
 */
class EventOversightReadTest extends TestCase
{
    use CreatesCollegeFixtures, RefreshDatabase;

    private Organization $club;

    private Organization $otherClub;

    private Organization $foreignClub;

    private User $admin;

    private User $dean;

    private User $staff;

    private User $foreignDean;

    private User $officer;

    private User $otherOfficer;

    private User $student;

    private Event $event;

    private Event $otherEvent;

    protected function setUp(): void
    {
        parent::setUp();

        $computing = $this->makeCollege('COC');
        $arts = $this->makeCollege('CAS');
        $home = $this->makeCollegeHome($computing);
        $this->makeCollegeHome($arts);
        $this->club = $this->makeCollegeStudentOrganization($computing, ['name' => 'PSITS']);
        $this->otherClub = $this->makeCollegeStudentOrganization($computing, ['name' => 'CompSoc']);
        $this->foreignClub = $this->makeCollegeStudentOrganization($arts, ['name' => 'Arts Club']);
        $this->dean = $this->makeCollegeHead($computing);
        $this->foreignDean = $this->makeCollegeHead($arts, ['school_id' => 9000001]);
        $this->staff = User::factory()->admin()->create(['organization_id' => $home->id, 'position_title' => 'College Secretary']);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->club->id]);
        $this->officer = User::factory()->officer()->create(['organization_id' => $this->club->id, 'account_status' => 'active']);
        $this->otherOfficer = User::factory()->officer()->create(['organization_id' => $this->otherClub->id, 'account_status' => 'active']);
        $this->student = User::factory()->student()->create(['organization_id' => $this->club->id]);

        $this->event = Event::factory()->create([
            'organization_id' => $this->club->id, 'created_by' => $this->admin->school_id, 'status' => 'completed',
        ]);
        $this->otherEvent = Event::factory()->create([
            'organization_id' => $this->otherClub->id, 'created_by' => $this->admin->school_id, 'status' => 'completed',
        ]);

        foreach (['present', 'present', 'late', 'excused', 'absent'] as $status) {
            Attendance::factory()->create([
                'event_id' => $this->event->id, 'user_id' => User::factory()->student()->create(['organization_id' => $this->club->id])->school_id,
                'method' => 'manual', 'status' => $status, 'check_in_time' => now(),
            ]);
        }

        Budget::create([
            'organization_id' => $this->club->id, 'event_id' => $this->event->id, 'title' => 'Venue and food',
            'allocated_amount' => 5000, 'remaining_amount' => 5000, 'warning_threshold' => 500,
        ]);
    }

    private function viewAs(User $user, ?Event $event = null)
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user);

        return $this->getJson('/api/events/'.($event ?? $this->event)->id);
    }

    private function assertOversight($response): void
    {
        $response->assertOk()
            ->assertJsonPath('attendance_summary.present', 2)
            ->assertJsonPath('attendance_summary.late', 1)
            ->assertJsonPath('attendance_summary.excused', 1)
            ->assertJsonPath('attendance_summary.absent', 1)
            ->assertJsonCount(1, 'budgets')
            ->assertJsonPath('budgets.0.title', 'Venue and food')
            ->assertJsonPath('financial_summary.allocated_budget', fn ($value) => is_numeric($value))
            ->assertJsonMissingPath('delete_blocked_reason');
    }

    public function test_the_dean_of_the_college_reads_the_attendance_breakdown_and_budgets(): void
    {
        $this->assertOversight($this->viewAs($this->dean));
    }

    public function test_the_deans_office_staff_read_exactly_what_the_dean_reads(): void
    {
        $this->assertOversight($this->viewAs($this->staff));
    }

    public function test_the_officer_of_the_organization_reads_the_attendance_breakdown_and_budgets(): void
    {
        $this->assertOversight($this->viewAs($this->officer));
    }

    public function test_a_dean_of_another_college_does_not_reach_the_event(): void
    {
        $this->viewAs($this->foreignDean)->assertNotFound();
    }

    public function test_an_officer_of_another_organization_does_not_reach_the_event(): void
    {
        $this->viewAs($this->otherOfficer)->assertNotFound();
    }

    public function test_the_deans_own_college_other_club_event_stays_readable_with_its_own_numbers(): void
    {
        $this->viewAs($this->dean, $this->otherEvent)->assertOk()
            ->assertJsonPath('attendance_summary.present', 0)
            ->assertJsonCount(0, 'budgets');
    }

    public function test_a_student_gets_no_attendance_breakdown_and_no_budgets(): void
    {
        $this->viewAs($this->student)->assertOk()
            ->assertJsonMissingPath('attendance_summary')
            ->assertJsonMissingPath('budgets')
            ->assertJsonMissingPath('financial_summary')
            ->assertJsonMissingPath('delete_blocked_reason');
    }

    public function test_only_the_admin_gets_the_delete_blockers(): void
    {
        $this->viewAs($this->admin)->assertOk()
            ->assertJsonPath('delete_blocked_reason', fn ($reason) => is_string($reason))
            ->assertJsonCount(1, 'budgets');

        foreach ([$this->dean, $this->staff, $this->officer, $this->student] as $viewer) {
            $this->viewAs($viewer)->assertOk()->assertJsonMissingPath('delete_blocked_reason');
        }
    }
}
