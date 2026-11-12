<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Event;
use App\Models\Organization;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/** The Events and Tasks pages carry no period picker of their own, so the top bar header alone must pick the semester they list. */
class PagePeriodFollowsTopBarTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private AcademicSemester $active;

    private AcademicSemester $upcoming;

    private Organization $org;

    private User $admin;

    private User $dean;

    private User $officer;

    private User $student;

    private Event $activeEvent;

    private Event $plannedEvent;

    protected function setUp(): void
    {
        parent::setUp();
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $next = AcademicYear::create(['label' => '2027-2028', 'starts_on' => '2027-08-01', 'ends_on' => '2028-05-31', 'is_current' => false]);
        $this->active = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
        $this->upcoming = AcademicSemester::create(['academic_year_id' => $next->id, 'number' => 1, 'starts_on' => '2027-08-01', 'ends_on' => '2027-12-31', 'status' => 'upcoming']);

        $college = $this->makeCollege('CIT');
        $this->dean = $this->makeCollegeHead($college);
        $this->org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active']);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->org->id]);
        $this->officer = User::factory()->officer()->create(['organization_id' => $this->org->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $this->org->id]);

        $this->activeEvent = $this->makeEvent('Active Fair', '2027-02-20', $this->active);
        $this->plannedEvent = $this->makeEvent('Planned Fair', '2027-09-20', $this->upcoming);
        $this->makeTask('Active Task', $this->active);
        $this->makeTask('Planned Task', $this->upcoming);
    }

    private function makeEvent(string $title, string $date, AcademicSemester $semester): Event
    {
        return Event::create([
            'organization_id' => $this->org->id,
            'academic_semester_id' => $semester->id,
            'title' => $title,
            'start_time' => "{$date} 09:00:00",
            'end_time' => "{$date} 12:00:00",
            'status' => 'approved',
            'created_by' => $this->admin->id,
        ]);
    }

    private function makeTask(string $title, AcademicSemester $semester): Task
    {
        return Task::factory()->create([
            'organization_id' => $this->org->id,
            'academic_semester_id' => $semester->id,
            'event_id' => null,
            'created_by' => $this->admin->id,
            'assigned_to' => $this->officer->id,
            'title' => $title,
            'status' => 'pending',
        ]);
    }

    private function inPeriod(AcademicSemester $semester): array
    {
        return [AcademicSemester::PERIOD_HEADER => (string) $semester->id, 'Accept' => 'application/json'];
    }

    private function titles(string $url, array $headers = []): array
    {
        return collect($this->getJson($url, $headers)->assertOk()->json('data'))->pluck('title')->sort()->values()->all();
    }

    public function test_the_events_list_follows_the_top_bar_semester_for_the_roles_that_can_pick_one(): void
    {
        foreach ([$this->admin, $this->dean] as $user) {
            Sanctum::actingAs($user);
            $this->assertSame(['Active Fair'], $this->titles('/api/events'), $user->role.' default');
            $this->assertSame(['Planned Fair'], $this->titles('/api/events', $this->inPeriod($this->upcoming)), $user->role.' planning');
            $this->assertSame(['Active Fair'], $this->titles('/api/events', $this->inPeriod($this->active)), $user->role.' back on the current semester');
        }
    }

    public function test_the_events_list_for_an_officer_and_a_student_stays_on_the_current_semester(): void
    {
        foreach ([$this->officer, $this->student] as $user) {
            Sanctum::actingAs($user);
            $this->assertSame(['Active Fair'], $this->titles('/api/events'), $user->role.' default');
            $this->assertSame(['Active Fair'], $this->titles('/api/events', $this->inPeriod($this->upcoming)), $user->role.' ignores a planning header');
        }
    }

    public function test_the_tasks_list_follows_the_top_bar_semester_for_the_admin_and_stays_current_for_an_officer(): void
    {
        Sanctum::actingAs($this->admin);
        $this->assertSame(['Active Task'], $this->titles('/api/tasks'));
        $this->assertSame(['Planned Task'], $this->titles('/api/tasks', $this->inPeriod($this->upcoming)));

        Sanctum::actingAs($this->officer);
        $this->assertSame(['Active Task'], $this->titles('/api/tasks'));
        $this->assertSame(['Active Task'], $this->titles('/api/tasks', $this->inPeriod($this->upcoming)));
    }
}
