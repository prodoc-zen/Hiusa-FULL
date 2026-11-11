<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StudentHomeEventsSemesterTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_home_coming_up_list_matches_the_events_page_for_the_active_semester(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT']);
        $oldYear = AcademicYear::create(['label' => '2025-2026', 'starts_on' => '2025-08-01', 'ends_on' => '2026-05-31', 'is_current' => false]);
        $old = AcademicSemester::create(['academic_year_id' => $oldYear->id, 'number' => 2, 'starts_on' => '2026-01-01', 'ends_on' => '2026-05-31', 'status' => 'completed']);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $current = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $make = fn (string $title, AcademicSemester $semester) => Event::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $admin->school_id, 'title' => $title, 'status' => 'approved',
            'academic_semester_id' => $semester->id, 'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(2),
        ]);
        $make('Left over from last term', $old);
        $make('This semester', $current);
        Sanctum::actingAs($student);

        $this->getJson('/api/events')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.title', 'This semester');
        $coming = collect($this->getJson('/api/student/feed')->assertOk()->json('sidebar.upcoming_events'))->pluck('title')->all();

        $this->assertSame(['This semester'], $coming);
    }
}
