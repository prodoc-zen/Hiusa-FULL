<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\ClearancePeriod;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\Event;
use App\Models\Organization;
use App\Models\OrganizationSemesterRecord;
use App\Models\User;
use App\Services\Compliance\AccreditationStatusService;
use App\Services\Dashboard\SetupChecklistService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The SAO can put a whole school year away and set up a new one without wiping the database. */
class AcademicYearArchiveTest extends TestCase
{
    use RefreshDatabase;

    private User $director;

    private Organization $organization;

    private AcademicYear $year;

    private AcademicSemester $first;

    private AcademicSemester $second;

    protected function setUp(): void
    {
        parent::setUp();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $this->director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $this->organization = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'name' => 'Cold Computing Society']);
        $this->year = AcademicYear::create(['label' => '2024-2025', 'starts_on' => '2024-08-01', 'ends_on' => '2025-05-31', 'is_current' => true]);
        $this->first = AcademicSemester::create(['academic_year_id' => $this->year->id, 'number' => 1, 'starts_on' => '2024-08-01', 'ends_on' => '2024-12-31', 'status' => 'active']);
        $this->second = AcademicSemester::create(['academic_year_id' => $this->year->id, 'number' => 2, 'starts_on' => '2025-01-01', 'ends_on' => '2025-05-31', 'status' => 'upcoming']);
        Sanctum::actingAs($this->director);
    }

    private function archive(?AcademicYear $year = null)
    {
        return $this->postJson('/api/system/academic-years/'.($year ?? $this->year)->id.'/archive');
    }

    private function election(array $attributes): Election
    {
        return Election::factory()->create([
            'organization_id' => $this->organization->id, 'academic_semester_id' => $this->first->id, 'title' => '2024 Officer Election',
            'phase' => null, ...$attributes,
        ]);
    }

    public function test_archiving_is_refused_while_an_election_is_open_or_approved_and_upcoming(): void
    {
        $this->election(['status' => 'active']);
        $this->election(['status' => 'upcoming', 'approved_at' => now()->subDay(), 'title' => 'Batch Representative Election']);

        $response = $this->archive()->assertUnprocessable();

        $response->assertJsonPath('errors.semester.0', fn ($message) => str_contains($message, '2024 Officer Election') && str_contains($message, 'Batch Representative Election') && str_contains($message, 'Cold Computing Society'));
        $this->assertCount(2, $response->json('elections'));
        $year = $this->year->fresh();
        $this->assertNull($year->archived_at);
        $this->assertTrue($year->is_current);
        $this->assertSame('active', $this->first->fresh()->status);
        $this->assertSame('upcoming', $this->second->fresh()->status);
        $this->assertSame(0, AuditLog::where('action', 'academic_year_archived')->count());
    }

    public function test_an_election_still_waiting_for_approval_does_not_block_archiving(): void
    {
        $this->election(['status' => 'upcoming', 'approved_at' => null]);

        $this->archive()->assertOk();
    }

    public function test_archiving_snapshots_and_completes_the_active_semester_and_leaves_every_record_where_it_was(): void
    {
        $event = Event::factory()->create(['organization_id' => $this->organization->id, 'academic_semester_id' => $this->first->id, 'created_by' => $this->director->school_id]);
        $cancelled = $this->election(['status' => 'cancelled']);

        $response = $this->archive()->assertOk()->assertJsonPath('label', '2024-2025')->assertJsonPath('is_current', false);

        $this->assertNotNull($response->json('archived_at'));
        $this->assertSame($this->director->school_id, $response->json('archived_by'));
        $year = $this->year->fresh();
        $this->assertNotNull($year->archived_at);
        $this->assertSame($this->director->school_id, $year->archived_by);
        $this->assertFalse($year->is_current);
        $this->assertSame('completed', $this->first->fresh()->status);
        $this->assertSame('completed', $this->second->fresh()->status);
        $this->assertTrue(OrganizationSemesterRecord::where('academic_semester_id', $this->first->id)->where('organization_id', $this->organization->id)->exists(), 'The active semester is snapshotted so Records keeps its officers.');
        $this->assertSame($this->first->id, $event->fresh()->academic_semester_id);
        $this->assertSame($this->first->id, $cancelled->fresh()->academic_semester_id);
        $audit = AuditLog::where('action', 'academic_year_archived')->sole();
        $this->assertSame($this->year->id, $audit->record_id);
        $this->assertSame('SAO archived academic year 2024-2025.', $audit->description);
        $this->archive()->assertUnprocessable()->assertJsonPath('errors.academic_year.0', '2024-2025 is already archived.');
    }

    public function test_after_archiving_the_same_dates_can_be_added_again_and_activated_and_the_new_semester_is_the_active_one(): void
    {
        $this->archive()->assertOk();
        $this->assertNull(AcademicSemester::active());
        $this->getJson('/api/academic-periods/active')->assertOk()->assertJson([]);

        $new = $this->postJson('/api/system/academic-years', ['label' => '2023-2024', 'starts_on' => '2024-08-01', 'ends_on' => '2025-05-31'])
            ->assertCreated()->assertJsonPath('is_current', true)->json('id');
        $semester = $this->postJson("/api/system/academic-years/{$new}/semesters", ['number' => 1, 'starts_on' => '2024-08-01', 'ends_on' => '2024-12-31'])->assertCreated()->json('id');
        $this->patchJson("/api/system/academic-semesters/{$semester}/active")->assertOk()->assertJsonPath('status', 'active');

        $this->getJson('/api/academic-periods/active')->assertOk()->assertJsonPath('id', $semester)->assertJsonPath('academic_year.label', '2023-2024');
        $this->assertSame('2023-2024', AcademicYear::currentLabel());
        $this->assertSame([$new], AcademicYear::where('is_current', true)->pluck('id')->all());
        $this->assertSame('completed', $this->first->fresh()->status);
        $this->assertNotNull($this->year->fresh()->archived_at);
    }

    public function test_an_archived_year_leaves_the_pickers_but_stays_on_the_academic_years_page(): void
    {
        $this->archive()->assertOk();

        $this->getJson('/api/academic-periods')->assertOk()->assertExactJson([]);
        $years = $this->getJson('/api/system/academic-years')->assertOk()->assertJsonCount(1)->json();
        $this->assertSame('2024-2025', $years[0]['label']);
        $this->assertNotNull($years[0]['archived_at']);
        $this->assertFalse($years[0]['can_be_removed']);
        $this->assertSame(2, count($years[0]['semesters']));
    }

    public function test_a_stale_period_choice_in_an_archived_year_falls_back_to_the_active_semester(): void
    {
        $this->archive()->assertOk();
        $new = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $active = AcademicSemester::create(['academic_year_id' => $new->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $request = Request::create('/api/events');
        $request->setUserResolver(fn () => $this->director);
        $request->headers->set(AcademicSemester::PERIOD_HEADER, (string) $this->first->id);

        $this->assertSame($active->id, AcademicSemester::selected($request)->id);
    }

    public function test_an_archived_year_cannot_be_activated_reopened_made_current_edited_or_given_semesters(): void
    {
        $this->archive()->assertOk();

        $this->patchJson("/api/system/academic-semesters/{$this->first->id}/active")->assertUnprocessable()->assertJsonPath('errors.semester.0', 'Restore this year first.');
        $this->patchJson("/api/system/academic-semesters/{$this->second->id}/active")->assertUnprocessable()->assertJsonPath('errors.semester.0', 'Restore this year first.');
        $this->patchJson("/api/system/academic-semesters/{$this->first->id}/reopen")->assertUnprocessable()->assertJsonPath('errors.semester.0', 'Restore this year first.');
        $this->patchJson("/api/system/academic-years/{$this->year->id}/current")->assertUnprocessable()->assertJsonPath('errors.academic_year.0', 'Restore this year first.');
        $this->patchJson("/api/system/academic-years/{$this->year->id}/close")->assertUnprocessable()->assertJsonPath('errors.academic_year.0', 'Restore this year first.');
        $this->putJson("/api/system/academic-years/{$this->year->id}", ['label' => '2024-2025', 'starts_on' => '2024-07-01', 'ends_on' => '2025-05-31'])->assertUnprocessable()->assertJsonPath('errors.academic_year.0', 'Restore this year first.');
        $this->deleteJson("/api/system/academic-years/{$this->year->id}")->assertStatus(409);
        $this->deleteJson("/api/system/academic-semesters/{$this->first->id}")->assertStatus(409);

        $this->assertSame(0, AcademicSemester::where('status', 'active')->count());
        $this->assertNotNull($this->year->fresh());
        $this->assertNotNull($this->first->fresh());
        $this->assertFalse($this->year->fresh()->is_current);
    }

    public function test_restoring_is_refused_while_a_live_year_overlaps_and_allowed_once_that_year_is_removed(): void
    {
        $this->archive()->assertOk();
        $new = $this->postJson('/api/system/academic-years', ['label' => '2023-2024', 'starts_on' => '2025-01-01', 'ends_on' => '2025-12-31'])->assertCreated()->json('id');

        $this->postJson("/api/system/academic-years/{$this->year->id}/restore")->assertUnprocessable()
            ->assertJsonPath('errors.academic_year.0', fn ($message) => str_contains($message, '2023-2024'));
        $this->assertNotNull($this->year->fresh()->archived_at);

        $this->deleteJson("/api/system/academic-years/{$new}")->assertOk();
        $this->postJson("/api/system/academic-years/{$this->year->id}/restore")->assertOk()->assertJsonPath('archived_at', null)->assertJsonPath('is_current', false);

        $year = $this->year->fresh();
        $this->assertNull($year->archived_at);
        $this->assertNull($year->archived_by);
        $this->assertFalse($year->is_current, 'Restoring does not make the year current.');
        $this->assertSame(['completed', 'completed'], $year->semesters->pluck('status')->all(), 'Restoring reopens nothing.');
        $this->assertSame('SAO restored academic year 2024-2025.', AuditLog::where('action', 'academic_year_restored')->sole()->description);
        $this->postJson("/api/system/academic-years/{$this->year->id}/restore")->assertUnprocessable();
        $this->getJson('/api/academic-periods')->assertOk()->assertJsonCount(2);
    }

    public function test_an_archived_label_cannot_be_reused_and_the_message_says_to_restore_it(): void
    {
        $this->archive()->assertOk();

        $this->postJson('/api/system/academic-years', ['label' => '2024-2025', 'starts_on' => '2024-08-01', 'ends_on' => '2025-05-31'])
            ->assertUnprocessable()->assertJsonPath('errors.label.0', '2024-2025 is archived. Restore it, or use a different label.');
        $live = $this->postJson('/api/system/academic-years', ['label' => '2025-2026', 'starts_on' => '2025-08-01', 'ends_on' => '2026-05-31'])->assertCreated()->json('id');
        $this->postJson('/api/system/academic-years', ['label' => '2025-2026', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31'])
            ->assertUnprocessable()->assertJsonPath('errors.label.0', 'The label has already been taken.');
        $this->putJson("/api/system/academic-years/{$live}", ['label' => '2024-2025', 'starts_on' => '2025-08-01', 'ends_on' => '2026-05-31'])->assertUnprocessable()->assertJsonValidationErrors('label');
    }

    public function test_only_the_sao_can_archive_or_restore(): void
    {
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $this->organization->id]));

        $this->postJson("/api/system/academic-years/{$this->year->id}/archive")->assertForbidden();
        $this->postJson("/api/system/academic-years/{$this->year->id}/restore")->assertForbidden();
        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => $this->organization->id]));
        $this->postJson("/api/system/academic-years/{$this->year->id}/archive")->assertForbidden();
        $this->assertNull($this->year->fresh()->archived_at);
    }

    public function test_the_setup_tracker_says_no_academic_year_is_set_once_every_year_is_archived(): void
    {
        $stepOf = fn (string $key) => collect(app(SetupChecklistService::class)->forUser($this->director)['steps'])->firstWhere('key', $key);
        $status = fn (string $key) => collect($this->getJson('/api/process/status')->assertOk()->json('steps'))->firstWhere('key', $key);
        $this->assertTrue($stepOf('academic-year')['done']);
        $this->assertSame('done', $status('academic-year')['state']);

        $this->archive()->assertOk();

        $this->assertFalse($stepOf('academic-year')['done']);
        $this->assertFalse($stepOf('semester')['done']);
        $this->assertFalse($stepOf('semester-active')['done']);
        $this->assertSame('current', $status('academic-year')['state']);
        $this->assertSame('todo', $status('semester-active')['state']);
    }

    public function test_accreditation_and_renewals_do_not_fall_back_to_an_archived_years_requirements(): void
    {
        ComplianceRequirementType::create(['academic_year' => '2024-2025', 'academic_semester_id' => $this->first->id, 'category' => 'organization', 'name' => 'Constitution', 'allowed_extensions' => ['pdf'], 'deadline_at' => now()->addYear(), 'is_active' => true, 'created_by' => $this->director->school_id]);
        $this->assertSame('2024-2025', app(AccreditationStatusService::class)->currentAcademicYear());

        $this->archive()->assertOk();

        $this->assertNull(app(AccreditationStatusService::class)->currentAcademicYear());
    }

    public function test_a_clearance_period_cannot_be_opened_for_an_archived_year(): void
    {
        $this->archive()->assertOk();

        $this->postJson('/api/clearance-periods', ['academic_year' => '2024-2025', 'title' => 'Finals', 'required_roles' => ['organization']])
            ->assertUnprocessable()->assertJsonPath('errors.academic_year.0', '2024-2025 is archived, so it cannot take a new clearance period.');
        $this->assertSame(0, ClearancePeriod::count());
    }

    public function test_the_migration_is_reversible(): void
    {
        $migration = require database_path('migrations/2026_11_15_000001_add_archive_to_academic_years.php');

        $migration->down();
        $this->assertFalse(Schema::hasColumn('academic_years', 'archived_at'));
        $this->assertFalse(Schema::hasColumn('academic_years', 'archived_by'));
        $this->assertTrue(Schema::hasColumn('academic_years', 'closed_at'));
        $migration->up();
        $this->assertTrue(Schema::hasColumn('academic_years', 'archived_at'));
        $this->assertTrue(Schema::hasColumn('academic_years', 'archived_by'));
    }
}
