<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PersonalAttendanceSummaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_student_sees_only_their_recorded_attendance_in_their_organization(): void
    {
        $organization = Organization::factory()->create();
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $other = User::factory()->student()->create(['organization_id' => $organization->id]);
        $present = Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $student->school_id, 'status' => 'completed', 'title' => 'Attended event']);
        $absent = Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $student->school_id, 'status' => 'completed', 'title' => 'Missed event']);
        $foreign = Event::factory()->create(['organization_id' => Organization::factory()->create()->id, 'created_by' => $student->school_id, 'status' => 'completed']);
        $planning = Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $student->school_id, 'status' => 'planning']);
        Attendance::factory()->create(['event_id' => $present->id, 'user_id' => $student->school_id, 'status' => 'present', 'method' => 'manual']);
        Attendance::factory()->create(['event_id' => $absent->id, 'user_id' => $student->school_id, 'status' => 'absent']);
        Attendance::factory()->create(['event_id' => $present->id, 'user_id' => $other->school_id, 'status' => 'present']);
        Attendance::factory()->create(['event_id' => $foreign->id, 'user_id' => $student->school_id, 'status' => 'present']);
        Attendance::factory()->create(['event_id' => $planning->id, 'user_id' => $student->school_id, 'status' => 'present']);

        Sanctum::actingAs($student);
        $this->getJson('/api/attendance/personal-summary')
            ->assertOk()
            ->assertJsonPath('summary.attended', 1)
            ->assertJsonPath('summary.missed', 1)
            ->assertJsonPath('summary.rate', 50)
            ->assertJsonPath('pagination.total', 2)
            ->assertJsonCount(2, 'records');
    }

    public function test_only_students_can_access_the_personal_summary(): void
    {
        $admin = User::factory()->admin()->create();
        Sanctum::actingAs($admin);
        $this->getJson('/api/attendance/personal-summary')->assertForbidden();
    }
}
