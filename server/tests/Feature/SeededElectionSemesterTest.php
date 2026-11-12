<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Election;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The election list shows the selected semester's elections, so a seeded election that belongs to no semester
 * would vanish from every role's list as soon as a semester is active.
 */
class SeededElectionSemesterTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_seeded_election_belongs_to_the_active_semester_and_is_listed(): void
    {
        config(['performance.api_cache.enabled' => false]);
        Storage::fake('local');
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);

        $this->seed();

        $election = Election::where('title', 'HIUSA Student Council Election 2024-2025')->firstOrFail();
        $this->assertSame($semester->id, $election->academic_semester_id);

        Sanctum::actingAs(User::where('school_id', 900001)->firstOrFail());
        $listed = collect($this->getJson('/api/elections')->assertOk()->json())->pluck('id')->all();
        $this->assertContains($election->id, $listed);
    }
}
