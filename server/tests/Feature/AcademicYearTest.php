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
use App\Models\User;
use App\Services\Compliance\AccreditationStatusService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AcademicYearTest extends TestCase
{
    use RefreshDatabase;

    private User $director;

    protected function setUp(): void
    {
        parent::setUp();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $this->director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        Sanctum::actingAs($this->director);
    }

    private function create(string $label, string $start, string $end)
    {
        return $this->postJson('/api/system/academic-years', ['label' => $label, 'starts_on' => $start, 'ends_on' => $end]);
    }

    public function test_the_first_year_becomes_current_and_switching_keeps_exactly_one_current(): void
    {
        $first = $this->create('2026-2027', '2026-08-01', '2027-05-31')->assertCreated()->assertJsonPath('is_current', true)->json('id');
        $second = $this->create('2027-2028', '2027-08-01', '2028-05-31')->assertCreated()->assertJsonPath('is_current', false)->json('id');

        $this->patchJson("/api/system/academic-years/{$second}/current")->assertOk()->assertJsonPath('is_current', true);

        $this->assertSame(['2027-2028'], AcademicYear::where('is_current', true)->pluck('label')->all());
        $this->assertFalse(AcademicYear::find($first)->is_current);
        $this->assertTrue(AuditLog::where('action', 'academic_year_made_current')->exists());
    }

    public function test_accreditation_follows_the_current_year_instead_of_the_newest_requirement_set(): void
    {
        DB::table('compliance_requirement_types')->insert([
            ['academic_year' => '2027-2028', 'name' => 'Constitution', 'deadline_at' => now()->addYear(), 'is_active' => true, 'created_by' => $this->director->school_id, 'created_at' => now(), 'updated_at' => now()],
        ]);
        $service = app(AccreditationStatusService::class);
        $this->assertSame('2027-2028', $service->currentAcademicYear(), 'Before any calendar exists, the newest requirement set stands in.');

        $this->create('2026-2027', '2026-08-01', '2027-05-31')->assertCreated();

        $this->assertSame('2026-2027', $service->currentAcademicYear());
    }

    public function test_labels_and_dates_are_validated(): void
    {
        $this->create('2026-2028', '2026-08-01', '2027-05-31')->assertUnprocessable()->assertJsonValidationErrors('label');
        $this->create('26-27', '2026-08-01', '2027-05-31')->assertUnprocessable()->assertJsonValidationErrors('label');
        $this->create('2026-2027', '2027-05-31', '2026-08-01')->assertUnprocessable()->assertJsonValidationErrors('ends_on');
        $this->create('2026-2027', '2026-08-01', '2027-05-31')->assertCreated();
        $this->create('2027-2028', '2027-05-01', '2028-05-31')->assertUnprocessable()->assertJsonPath('errors.starts_on.0', 'These dates overlap 2026-2027.');
        $this->create('2026-2027', '2030-08-01', '2031-05-31')->assertUnprocessable()->assertJsonValidationErrors('label');
    }

    public function test_a_year_in_use_or_with_a_started_semester_cannot_be_removed_or_renamed(): void
    {
        $current = $this->create('2026-2027', '2026-08-01', '2027-05-31')->json('id');
        AcademicSemester::create(['academic_year_id' => $current, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $past = $this->create('2025-2026', '2025-08-01', '2026-05-31')->json('id');
        $unused = $this->create('2028-2029', '2028-08-01', '2029-05-31')->json('id');
        DB::table('compliance_requirement_types')->insert(['academic_year' => '2025-2026', 'name' => 'Officers list', 'deadline_at' => now(), 'is_active' => true, 'created_by' => $this->director->school_id, 'created_at' => now(), 'updated_at' => now()]);

        $this->deleteJson("/api/system/academic-years/{$current}")->assertStatus(409);
        $this->deleteJson("/api/system/academic-years/{$past}")->assertStatus(409);
        $this->putJson("/api/system/academic-years/{$past}", ['label' => '2024-2025', 'starts_on' => '2024-08-01', 'ends_on' => '2025-05-31'])->assertUnprocessable();
        $this->putJson("/api/system/academic-years/{$past}", ['label' => '2025-2026', 'starts_on' => '2025-07-15', 'ends_on' => '2026-05-31'])->assertOk()->assertJsonPath('starts_on', '2025-07-15');
        $this->deleteJson("/api/system/academic-years/{$unused}")->assertOk();
        $this->assertSame(2, AcademicYear::count());
    }

    public function test_only_the_sao_manages_the_calendar(): void
    {
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]));

        $this->getJson('/api/system/academic-years')->assertForbidden();
        $this->create('2026-2027', '2026-08-01', '2027-05-31')->assertForbidden();
    }

    private function addSemester(int $yearId, int $number, string $start, string $end): int
    {
        return $this->postJson("/api/system/academic-years/{$yearId}/semesters", ['number' => $number, 'starts_on' => $start, 'ends_on' => $end])->assertCreated()->json('id');
    }

    /** The live state of 14 Nov 2026: year A is behind a completed 1st semester, year C is current with one semester that starts in 2028. */
    private function liveTrap(): array
    {
        $this->travelTo('2026-11-14');
        $a = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => false, 'closed_at' => null]);
        $aFirst = AcademicSemester::create(['academic_year_id' => $a->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'completed']);
        AcademicSemester::create(['academic_year_id' => $a->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        $c = AcademicYear::create(['label' => '2028-2029', 'starts_on' => '2028-08-01', 'ends_on' => '2029-05-31', 'is_current' => true]);
        $cFirst = $this->addSemester($c->id, 1, '2028-08-07', '2028-12-15');

        return [$a, $aFirst, $c, $cFirst];
    }

    public function test_a_current_year_whose_semesters_never_started_can_be_removed_with_them_and_none_is_promoted(): void
    {
        $other = $this->create('2026-2027', '2026-08-01', '2027-05-31')->assertJsonPath('is_current', true)->json('id');
        $trap = $this->create('2028-2029', '2028-08-01', '2029-05-31')->json('id');
        $this->patchJson("/api/system/academic-years/{$trap}/current")->assertOk();
        $first = $this->addSemester($trap, 1, '2028-08-07', '2028-12-15');
        $second = $this->addSemester($trap, 2, '2029-01-05', '2029-05-20');
        $this->assertGreaterThan(0, ComplianceRequirementType::where('academic_semester_id', $first)->count());

        $this->deleteJson("/api/system/academic-years/{$trap}")->assertOk();

        $this->assertNull(AcademicYear::find($trap));
        $this->assertSame(0, AcademicSemester::whereIn('id', [$first, $second])->count());
        $this->assertSame(0, ComplianceRequirementType::whereIn('academic_semester_id', [$first, $second])->count());
        $this->assertSame(0, ComplianceRequirementType::where('academic_year', '2028-2029')->count());
        $this->assertSame(0, AcademicYear::where('is_current', true)->count());
        $this->assertFalse(AcademicYear::find($other)->is_current);
        $this->assertSame(2, AuditLog::where('action', 'academic_semester_deleted')->count());
        $this->assertSame(1, AuditLog::where('action', 'academic_year_deleted')->count());
    }

    public function test_a_year_with_a_started_semester_or_loose_requirements_or_a_clearance_period_stays(): void
    {
        $started = $this->create('2026-2027', '2026-08-01', '2027-05-31')->json('id');
        AcademicSemester::create(['academic_year_id' => $started, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'completed']);
        $loose = $this->create('2027-2028', '2027-08-01', '2028-05-31')->json('id');
        $this->addSemester($loose, 1, '2027-08-01', '2027-12-15');
        ComplianceRequirementType::create(['category' => 'organization', 'academic_year' => '2027-2028', 'name' => 'Loose requirement', 'allowed_extensions' => ['pdf'], 'deadline_at' => now(), 'is_active' => true, 'created_by' => $this->director->school_id]);
        $period = $this->create('2028-2029', '2028-08-01', '2029-05-31')->json('id');
        ClearancePeriod::create(['academic_year' => '2028-2029', 'title' => 'Clearance', 'required_roles' => ['sao'], 'created_by' => $this->director->school_id]);

        $this->deleteJson("/api/system/academic-years/{$started}")->assertStatus(409)->assertJsonPath('message', '2026-2027 has a semester that has started, so it stays on the calendar.');
        $this->deleteJson("/api/system/academic-years/{$loose}")->assertStatus(409)->assertJsonPath('message', '2027-2028 already has accreditation requirements or clearance periods, so it stays on the calendar.');
        $this->deleteJson("/api/system/academic-years/{$period}")->assertStatus(409);

        $this->assertSame(3, AcademicYear::count());
        $this->assertSame(0, AuditLog::where('action', 'academic_year_deleted')->count());
    }

    public function test_removing_a_year_changes_nothing_when_a_semester_has_events_or_elections(): void
    {
        $year = $this->create('2028-2029', '2028-08-01', '2029-05-31')->json('id');
        $first = $this->addSemester($year, 1, '2028-08-07', '2028-12-15');
        $second = $this->addSemester($year, 2, '2029-01-05', '2029-05-20');
        Event::factory()->create(['academic_semester_id' => $second, 'status' => 'planning']);

        $this->deleteJson("/api/system/academic-years/{$year}")->assertStatus(409)->assertJsonPath('message', 'The 2nd semester of 2028-2029 has events, so the year stays on the calendar.');

        $this->assertSame(2, AcademicSemester::whereIn('id', [$first, $second])->count());
        $this->assertGreaterThan(0, ComplianceRequirementType::where('academic_semester_id', $first)->count());
        $this->assertSame(0, AuditLog::whereIn('action', ['academic_semester_deleted', 'academic_year_deleted'])->count());

        Event::query()->delete();
        Election::factory()->create(['academic_semester_id' => $first, 'status' => 'upcoming', 'approved_at' => null]);
        $this->deleteJson("/api/system/academic-years/{$year}")->assertStatus(409)->assertJsonPath('message', 'The 1st semester of 2028-2029 has elections, so the year stays on the calendar.');
        $this->assertNotNull(AcademicYear::find($year));
    }

    public function test_a_semester_that_never_started_does_not_lock_the_label_but_an_active_one_does(): void
    {
        $year = $this->create('2026-2027', '2026-08-01', '2027-05-31')->json('id');
        $semester = $this->addSemester($year, 1, '2026-08-01', '2026-12-15');

        $this->putJson("/api/system/academic-years/{$year}", ['label' => '2027-2028', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31'])->assertOk()->assertJsonPath('label', '2027-2028');
        $this->assertSame(0, ComplianceRequirementType::where('academic_year', '2026-2027')->count());
        $this->assertGreaterThan(0, ComplianceRequirementType::where('academic_semester_id', $semester)->where('academic_year', '2027-2028')->count());

        AcademicSemester::whereKey($semester)->update(['status' => 'active']);
        $this->putJson("/api/system/academic-years/{$year}", ['label' => '2028-2029', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31'])
            ->assertUnprocessable()->assertJsonPath('errors.label.0', '2027-2028 already labels requirements or clearance periods, so its name stays.');
        $this->assertSame('2027-2028', AcademicYear::find($year)->label);

        AcademicSemester::whereKey($semester)->update(['status' => 'completed']);
        $this->putJson("/api/system/academic-years/{$year}", ['label' => '2028-2029', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31'])->assertUnprocessable();
    }

    public function test_the_index_says_per_year_whether_it_can_be_removed_and_why_not(): void
    {
        $open = $this->create('2028-2029', '2028-08-01', '2029-05-31')->json('id');
        $this->addSemester($open, 1, '2028-08-07', '2028-12-15');
        $started = $this->create('2026-2027', '2026-08-01', '2027-05-31')->json('id');
        AcademicSemester::create(['academic_year_id' => $started, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'completed']);

        $rows = collect($this->getJson('/api/system/academic-years')->assertOk()->json())->keyBy('id');

        $this->assertTrue($rows[$open]['can_be_removed']);
        $this->assertNull($rows[$open]['removal_blocker']);
        $this->assertFalse($rows[$started]['can_be_removed']);
        $this->assertSame('2026-2027 has a semester that has started, so it stays on the calendar.', $rows[$started]['removal_blocker']);
    }

    public function test_the_calendar_and_the_active_period_answer_when_no_year_is_current_and_no_semester_is_active(): void
    {
        $this->assertSame(0, AcademicYear::where('is_current', true)->count());

        $this->getJson('/api/system/academic-years')->assertOk()->assertExactJson([]);
        $this->getJson('/api/academic-periods/active')->assertOk();

        $year = $this->create('2027-2028', '2027-08-01', '2028-05-31')->json('id');
        AcademicYear::whereKey($year)->update(['is_current' => false]);
        $this->getJson('/api/system/academic-years')->assertOk()->assertJsonCount(1);
        $this->getJson('/api/academic-periods/active')->assertOk();
        $this->getJson('/api/academic-periods')->assertOk();
    }

    public function test_an_organization_admin_dashboard_answers_when_no_year_is_current_and_no_semester_is_active(): void
    {
        $year = $this->create('2027-2028', '2027-08-01', '2028-05-31')->json('id');
        AcademicYear::whereKey($year)->update(['is_current' => false]);
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]));

        $this->assertSame(0, AcademicYear::where('is_current', true)->count());
        $this->assertSame(0, AcademicSemester::where('status', 'active')->count());
        $this->getJson('/api/admin/dashboard')->assertOk();
    }

    public function test_the_live_trap_activating_the_future_semester_is_refused_and_reopening_the_earlier_one_makes_its_year_current(): void
    {
        [$a, $aFirst, $c, $cFirst] = $this->liveTrap();

        $this->patchJson("/api/system/academic-semesters/{$cFirst}/active")->assertUnprocessable()
            ->assertJsonPath('errors.semester.0', 'This semester starts on Aug 7, 2028. It cannot be made active before then.');
        $this->patchJson("/api/system/academic-semesters/{$aFirst->id}/reopen")->assertOk()->assertJsonPath('status', 'active');

        $this->assertTrue($a->fresh()->is_current);
        $this->assertFalse($c->fresh()->is_current);
        $this->assertSame($aFirst->id, AcademicSemester::active()?->id);
    }

    public function test_the_live_trap_semester_that_never_started_can_be_deleted(): void
    {
        [, , $c, $cFirst] = $this->liveTrap();

        $this->deleteJson("/api/system/academic-semesters/{$cFirst}")->assertNoContent();

        $this->assertSame(0, AcademicSemester::where('academic_year_id', $c->id)->count());
        $this->assertTrue($c->fresh()->is_current);
    }

    public function test_the_live_trap_year_can_be_removed_while_it_is_current(): void
    {
        [$a, , $c, $cFirst] = $this->liveTrap();

        $this->deleteJson("/api/system/academic-years/{$c->id}")->assertOk();

        $this->assertNull(AcademicYear::find($c->id));
        $this->assertNull(AcademicSemester::find($cFirst));
        $this->assertSame(0, AcademicYear::where('is_current', true)->count());
        $this->assertFalse($a->fresh()->is_current);
    }
}
