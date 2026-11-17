<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\Announcement;
use App\Models\Election;
use App\Models\Event;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A from-scratch demo database opens the current semester, and every seeded record that
 * belongs to a semester sits in it, so the semester-filtered lists show the seeded data instead of going empty.
 */
class SeededAcademicSemesterTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_fresh_seed_opens_the_current_semester_and_files_the_seeded_records_in_it(): void
    {
        config(['performance.api_cache.enabled' => false]);
        Storage::fake('local');

        $this->seed();

        $semester = AcademicSemester::active();
        $this->assertNotNull($semester);
        $this->assertTrue($semester->academicYear->is_current);
        $this->assertTrue(now()->between($semester->starts_on->startOfDay(), $semester->ends_on->endOfDay()));
        $this->assertSame(1, AcademicSemester::where('status', 'active')->count());

        $this->assertGreaterThan(0, Event::count());
        $this->assertSame(0, Event::whereNull('academic_semester_id')->count());
        $this->assertSame(0, Task::whereNull('academic_semester_id')->count());
        $this->assertSame(0, Announcement::whereNull('academic_semester_id')->count());
        $this->assertSame($semester->id, Election::firstOrFail()->academic_semester_id);
    }

    public function test_the_officer_still_lists_the_seeded_events_with_the_semester_open(): void
    {
        config(['performance.api_cache.enabled' => false]);
        Storage::fake('local');

        $this->seed();

        Sanctum::actingAs(User::where('school_id', 900001)->firstOrFail());
        $listed = collect($this->getJson('/api/events?per_page=100')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertNotEmpty($listed);
        $this->assertEqualsCanonicalizing(Event::where('organization_id', User::where('school_id', 900001)->value('organization_id'))->pluck('id')->all(), $listed);
    }

    public function test_seeding_again_keeps_the_one_active_semester(): void
    {
        config(['performance.api_cache.enabled' => false]);
        Storage::fake('local');

        $this->seed();
        $id = AcademicSemester::active()->id;
        $this->seed(\Database\Seeders\AcademicSemesterSeeder::class);

        $this->assertSame($id, AcademicSemester::active()->id);
        $this->assertSame(1, AcademicSemester::count());
    }
}
