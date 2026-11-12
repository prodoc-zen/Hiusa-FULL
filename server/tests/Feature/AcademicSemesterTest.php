<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\Organization;
use App\Models\OrganizationSemesterRecord;
use App\Models\User;
use App\Models\Venue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AcademicSemesterTest extends TestCase
{
    use RefreshDatabase;

    public function test_sao_can_close_a_year_after_both_semesters_and_closed_years_cannot_be_reopened(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $org = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $first = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);

        Sanctum::actingAs($admin);
        $this->patchJson("/api/system/academic-years/{$year->id}/close")->assertForbidden();
        Sanctum::actingAs($director);
        $this->patchJson("/api/system/academic-years/{$year->id}/close")->assertUnprocessable();
        $this->travelTo('2026-11-11');
        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertUnprocessable()->assertJsonValidationErrors('semester');
        $this->assertSame('active', $first->fresh()->status);
        $this->travelTo('2027-01-02');
        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertOk();
        $this->patchJson("/api/system/academic-years/{$year->id}/close")->assertUnprocessable();
        $this->patchJson("/api/system/academic-semesters/{$second->id}/close", $this->confirming($second))->assertOk();
        $this->patchJson("/api/system/academic-years/{$year->id}/close")->assertOk()->assertJsonPath('is_current', false);
        $this->assertNotNull($year->fresh()->closed_at);
        $this->patchJson("/api/system/academic-years/{$year->id}/current")->assertUnprocessable();
        $this->patchJson("/api/system/academic-semesters/{$first->id}/active")->assertUnprocessable();
    }

    public function test_activating_a_new_year_completes_the_previous_year_without_deleting_records(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $oldYear = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $oldYear->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'completed']);
        $oldSecond = AcademicSemester::create(['academic_year_id' => $oldYear->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
        $newYear = AcademicYear::create(['label' => '2027-2028', 'starts_on' => '2027-08-01', 'ends_on' => '2028-05-31', 'is_current' => false]);
        $newFirst = AcademicSemester::create(['academic_year_id' => $newYear->id, 'number' => 1, 'starts_on' => '2027-08-01', 'ends_on' => '2027-12-31', 'status' => 'upcoming']);
        Sanctum::actingAs($director);
        $this->travelTo('2027-08-02');

        $this->patchJson("/api/system/academic-semesters/{$newFirst->id}/active")->assertOk();
        $this->assertSame('completed', $oldSecond->fresh()->status);
        $this->assertNotNull($oldYear->fresh()->closed_at);
        $this->assertFalse($oldYear->fresh()->is_current);
        $this->assertTrue($newYear->fresh()->is_current);
        $this->assertSame($newFirst->id, AcademicSemester::active()?->id);
    }

    public function test_only_sao_can_create_and_activate_a_semester_and_all_roles_can_read_the_active_period(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $org = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);

        Sanctum::actingAs($admin);
        $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31'])->assertForbidden();
        Sanctum::actingAs($director);
        $first = $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31'])->assertCreated()->json('id');
        $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31'])->assertUnprocessable();
        $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 2, 'starts_on' => '2026-12-01', 'ends_on' => '2027-05-31'])->assertUnprocessable();
        $second = $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31'])->assertCreated()->json('id');
        $this->patchJson("/api/system/academic-semesters/{$first}/active")->assertOk()->assertJsonPath('status', 'active');

        Sanctum::actingAs($admin);
        $this->getJson('/api/academic-periods/active')->assertOk()->assertJsonPath('id', $first)->assertJsonPath('academic_year.label', '2026-2027');
        $this->patchJson("/api/system/academic-semesters/{$second}/active")->assertForbidden();
        Sanctum::actingAs($director);
        $this->travelTo('2027-01-02');
        $this->patchJson("/api/system/academic-semesters/{$second}/active")->assertOk();
        $this->assertSame('completed', AcademicSemester::find($first)->status);
        $this->assertSame(1, AcademicSemester::where('status', 'active')->count());
        $this->patchJson("/api/system/academic-semesters/{$first}/active")->assertUnprocessable();
    }

    public function test_events_follow_active_semester_and_old_records_are_read_only(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $org = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $first = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);

        Sanctum::actingAs($admin);
        $event = $this->postJson('/api/events', ['title' => 'First semester event', 'start_time' => '2026-10-15 09:00:00', 'end_time' => '2026-10-15 12:00:00'])->assertCreated()->json('id');
        $this->assertSame($first->id, Event::find($event)->academic_semester_id);
        $this->postJson('/api/events', ['title' => 'Wrong term', 'start_time' => '2027-02-15 09:00:00', 'end_time' => '2027-02-15 12:00:00'])->assertUnprocessable();

        Sanctum::actingAs($director);
        $this->travelTo('2027-01-02');
        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertOk();
        Sanctum::actingAs($admin);
        $this->putJson("/api/events/{$event}", ['title' => 'Edited'])->assertStatus(409);
        $this->patchJson("/api/events/{$event}/status", ['status' => 'cancelled'])->assertStatus(409);
        $this->postJson("/api/events/{$event}/attendance", ['user_id' => $admin->school_id, 'status' => 'present'])->assertStatus(409);
        $this->deleteJson("/api/events/{$event}")->assertStatus(409);
        $this->assertDatabaseHas('events', ['id' => $event, 'title' => 'First semester event']);
        $this->getJson('/api/events?academic_semester_id='.$first->id)->assertOk()->assertJsonFragment(['title' => 'First semester event']);
    }

    public function test_renewal_requirements_are_seeded_per_semester_and_previous_submissions_are_locked(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $org = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        Sanctum::actingAs($director);
        $first = $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31'])->assertCreated()->json('id');
        $second = $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31'])->assertCreated()->json('id');
        $this->assertSame(30, ComplianceRequirementType::where('academic_semester_id', $first)->count());
        $this->assertSame(30, ComplianceRequirementType::where('academic_semester_id', $second)->count());
        $this->assertSame(30, ComplianceRequirementType::where('academic_semester_id', $first)->where('is_active', true)->count());
        $this->patchJson("/api/system/academic-semesters/{$first}/active")->assertOk();
        $requirement = ComplianceRequirementType::where('academic_semester_id', $first)->where('category', 'organization')->where('name', 'List of Members')->firstOrFail();
        $this->putJson("/api/compliance/requirement-types/{$requirement->id}", ['deadline_at' => '2026-12-20', 'is_active' => true, 'template_url' => 'https://example.edu/member-list-format'])->assertOk();

        Sanctum::actingAs($admin);
        $this->getJson('/api/compliance/requirement-types?per_page=100')->assertOk()->assertJsonPath('total', 30);
        Sanctum::actingAs($director);
        $this->travelTo('2027-01-02');
        $this->patchJson("/api/system/academic-semesters/{$second}/active")->assertOk();
        $this->putJson("/api/compliance/requirement-types/{$requirement->id}", ['is_active' => false])->assertStatus(409);
        Sanctum::actingAs($admin);
        $this->getJson('/api/compliance/requirement-types?per_page=100')->assertOk()->assertJsonPath('total', 30);
        $this->post('/api/compliance/submissions', [
            'requirement_type_id' => $requirement->id,
            'document' => UploadedFile::fake()->create('members.pdf', 20, 'application/pdf'),
        ])->assertStatus(409);
    }

    public function test_rollover_is_refused_while_the_closing_semester_has_an_upcoming_approved_or_active_election(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $org = Organization::factory()->create(['name' => 'Computer Science Society']);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $first = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        $election = Election::factory()->create([
            'organization_id' => $org->id, 'academic_semester_id' => $first->id, 'title' => 'Council Election 2026',
            'status' => 'active', 'approved_at' => '2026-10-01 08:00:00', 'start_time' => '2026-12-30 08:00:00', 'end_time' => '2027-01-05 17:00:00',
        ]);
        $this->travelTo('2027-01-02');
        Sanctum::actingAs($director);

        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")
            ->assertUnprocessable()->assertJsonPath('errors.semester.0', fn ($message) => str_contains($message, 'Council Election 2026') && str_contains($message, 'Computer Science Society'));
        $this->assertSame('active', $first->fresh()->status);

        $election->update(['status' => 'upcoming']);
        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertUnprocessable();

        $election->update(['status' => 'closed']);
        Election::factory()->create(['organization_id' => $org->id, 'academic_semester_id' => $first->id, 'status' => 'upcoming', 'approved_at' => null]);
        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertOk();
        $this->assertSame('completed', $first->fresh()->status);
    }

    public function test_closing_the_active_semester_is_refused_while_it_has_an_open_election_and_names_its_organization(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $org = Organization::factory()->create(['name' => 'Computer Science Society']);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $first = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $election = Election::factory()->create([
            'organization_id' => $org->id, 'academic_semester_id' => $first->id, 'title' => 'Council Election 2026',
            'status' => 'active', 'approved_at' => '2026-10-01 08:00:00', 'start_time' => '2026-12-30 08:00:00', 'end_time' => '2027-01-05 17:00:00',
        ]);
        Sanctum::actingAs($director);

        $this->patchJson("/api/system/academic-semesters/{$first->id}/close", $this->confirming($first))
            ->assertUnprocessable()
            ->assertJsonPath('errors.semester.0', fn ($message) => str_contains($message, 'Council Election 2026') && str_contains($message, 'Computer Science Society'));
        $this->assertSame('active', $first->fresh()->status);

        $election->update(['status' => 'closed']);
        $this->patchJson("/api/system/academic-semesters/{$first->id}/close", $this->confirming($first))->assertOk();
        $this->assertSame('completed', $first->fresh()->status);
    }

    public function test_event_pdf_checklists_follow_the_selected_venue_type(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $org = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        Sanctum::actingAs($director);
        $semester = $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31'])->assertCreated()->json('id');
        $this->assertSame(18, EventRequirement::where('academic_semester_id', $semester)->count());
        $this->assertSame(18, EventRequirement::where('academic_semester_id', $semester)->where('is_active', true)->count());
        $this->patchJson("/api/system/academic-semesters/{$semester}/active")->assertOk();
        foreach (EventRequirement::where('academic_semester_id', $semester)->get() as $requirement) {
            $this->putJson('/api/event-requirements/'.$requirement->id, [
                'name' => $requirement->name, 'allowed_extensions' => ['pdf'],
                'is_active' => true, 'template_url' => 'https://example.edu/event-format',
            ])->assertOk();
        }
        $venue = Venue::create(['name' => 'Hall', 'location' => 'Campus', 'capacity' => 100, 'is_active' => true]);

        Sanctum::actingAs($admin);
        $dates = ['start_time' => '2026-10-15 09:00:00', 'end_time' => '2026-10-15 12:00:00'];
        $inside = $this->postJson('/api/events', ['title' => 'Campus event', 'planning_details' => ['venue_type' => 'on_campus', 'venue_id' => $venue->id], ...$dates])->assertCreated()->json('id');
        $outside = $this->postJson('/api/events', ['title' => 'Trip', 'location' => 'City Center', 'planning_details' => ['venue_type' => 'off_campus'], ...$dates])->assertCreated()->json('id');
        $this->getJson("/api/events/{$inside}/submission")->assertOk()->assertJsonCount(3, 'requirements');
        $requirements = $this->getJson("/api/events/{$outside}/submission")->assertOk()->assertJsonCount(15, 'requirements')->json('requirements');
        $this->assertSame(2, collect($requirements)->where('is_optional', true)->count());
        Storage::fake('local');
        $documents = [];
        foreach ($requirements as $requirement) {
            if (! $requirement['is_optional']) {
                $documents[$requirement['id']] = UploadedFile::fake()->create('document.pdf', 20, 'application/pdf');
            }
        }
        $this->post("/api/events/{$outside}/submission", ['documents' => $documents])->assertOk()->assertJsonCount(13, 'files');
    }

    private function confirming(AcademicSemester $semester): array
    {
        return ['confirmation' => ($semester->number === 1 ? '1st' : '2nd').' semester, AY '.$semester->academicYear->label];
    }

    /** @return array{0: User, 1: AcademicYear, 2: AcademicSemester} */
    private function liveSemester(): array
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $first = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);

        return [$director, $year, $first];
    }

    public function test_closing_a_semester_needs_its_typed_name_and_a_wrong_name_changes_nothing(): void
    {
        [$director, , $first] = $this->liveSemester();
        Organization::factory()->create();
        Sanctum::actingAs($director);

        foreach ([[], ['confirmation' => ''], ['confirmation' => '2nd semester, AY 2026-2027'], ['confirmation' => '1st semester']] as $payload) {
            $this->patchJson("/api/system/academic-semesters/{$first->id}/close", $payload)
                ->assertUnprocessable()
                ->assertJsonPath('errors.confirmation.0', 'Type the semester name exactly as shown to close it: 1st semester, AY 2026-2027.');
        }
        $this->assertSame('active', $first->fresh()->status);
        $this->assertSame(0, OrganizationSemesterRecord::where('academic_semester_id', $first->id)->count());
        $this->assertFalse(AuditLog::where('action', 'academic_semester_closed')->exists());

        $this->patchJson("/api/system/academic-semesters/{$first->id}/close", ['confirmation' => ' 1st semester, AY 2026-2027 '])->assertOk();
        $this->assertSame('completed', $first->fresh()->status);
        $this->assertTrue(AuditLog::where('action', 'academic_semester_closed')->exists());
    }

    public function test_reopening_restores_the_semester_and_its_year_only_when_nothing_is_active(): void
    {
        [$director, $year, $first] = $this->liveSemester();
        $second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        $other = AcademicYear::create(['label' => '2027-2028', 'starts_on' => '2027-08-01', 'ends_on' => '2028-05-31', 'is_current' => false]);
        $org = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);

        Sanctum::actingAs($director);
        $this->patchJson("/api/system/academic-semesters/{$first->id}/reopen")->assertUnprocessable()->assertJsonPath('errors.semester.0', 'Only a completed semester can be reopened.');
        $this->patchJson("/api/system/academic-semesters/{$first->id}/close", $this->confirming($first))->assertOk();
        $snapshots = OrganizationSemesterRecord::where('academic_semester_id', $first->id)->count();
        $this->assertSame(0, AcademicSemester::where('status', 'active')->count());

        $year->update(['is_current' => false]);
        $other->update(['is_current' => true]);
        Sanctum::actingAs($admin);
        $this->patchJson("/api/system/academic-semesters/{$first->id}/reopen")->assertForbidden();
        Sanctum::actingAs($director);
        $this->patchJson("/api/system/academic-semesters/{$first->id}/reopen")->assertOk()->assertJsonPath('status', 'active');

        $this->assertSame($first->id, AcademicSemester::active()?->id);
        $this->assertSame(['2026-2027'], AcademicYear::where('is_current', true)->pluck('label')->all());
        $this->assertSame($snapshots, OrganizationSemesterRecord::where('academic_semester_id', $first->id)->count());
        $audit = AuditLog::where('action', 'academic_semester_reopened')->firstOrFail();
        $this->assertSame($first->id, $audit->record_id);
        $this->assertSame('system_administration', $audit->module);

        $this->patchJson("/api/system/academic-semesters/{$first->id}/close", $this->confirming($first))->assertOk();
        $this->travelTo('2027-01-02');
        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertOk();
        $this->patchJson("/api/system/academic-semesters/{$first->id}/reopen")->assertUnprocessable()->assertJsonPath('errors.semester.0', 'A semester is already active. Close it before reopening another one.');
        $this->assertSame('completed', $first->fresh()->status);
        $this->assertSame($second->id, AcademicSemester::active()?->id);
    }

    public function test_a_semester_of_a_completed_academic_year_cannot_be_reopened(): void
    {
        [$director, $year, $first] = $this->liveSemester();
        $second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        Organization::factory()->create();
        Sanctum::actingAs($director);
        $this->patchJson("/api/system/academic-semesters/{$first->id}/close", $this->confirming($first))->assertOk();
        $this->travelTo('2027-01-02');
        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertOk();
        $this->patchJson("/api/system/academic-semesters/{$second->id}/close", $this->confirming($second))->assertOk();
        $this->patchJson("/api/system/academic-years/{$year->id}/close")->assertOk();

        $this->patchJson("/api/system/academic-semesters/{$second->id}/reopen")->assertUnprocessable()->assertJsonPath('errors.semester.0', 'A completed academic year cannot be reopened.');
        $this->assertSame(0, AcademicSemester::where('status', 'active')->count());
        $this->assertSame(0, AcademicYear::where('is_current', true)->count());
    }

    public function test_the_incident_sequence_of_a_far_future_year_cannot_empty_the_app(): void
    {
        [$director, , $first] = $this->liveSemester();
        Organization::factory()->create();
        Sanctum::actingAs($director);
        $future = $this->postJson('/api/system/academic-years', ['label' => '2099-2100', 'starts_on' => '2099-08-01', 'ends_on' => '2100-05-31'])->assertCreated()->json('id');

        $this->patchJson("/api/system/academic-semesters/{$first->id}/close")->assertUnprocessable();
        $this->patchJson("/api/system/academic-years/{$future}/current")
            ->assertUnprocessable()
            ->assertJsonPath('errors.academic_year.0', 'A semester in another academic year is active. Activate a semester in this year to change the current year.');

        $this->assertSame($first->id, AcademicSemester::active()?->id);
        $this->assertSame(['2026-2027'], AcademicYear::where('is_current', true)->pluck('label')->all());
    }

    public function test_the_sao_can_walk_from_the_last_semester_of_the_year_to_the_first_of_the_next_without_leaving_the_app_empty(): void
    {
        [$director, $year, $first] = $this->liveSemester();
        Organization::factory()->create();
        Sanctum::actingAs($director);
        $second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        $next = $this->postJson('/api/system/academic-years', ['label' => '2027-2028', 'starts_on' => '2027-08-01', 'ends_on' => '2028-05-31'])->assertCreated()->json('id');
        $newFirst = $this->postJson("/api/system/academic-years/{$next}/semesters", ['number' => 1, 'starts_on' => '2027-08-01', 'ends_on' => '2027-12-15'])->assertCreated()->json('id');

        $this->travelTo('2026-11-12');
        $this->patchJson("/api/system/academic-semesters/{$newFirst}/active")->assertUnprocessable()->assertJsonPath('errors.semester.0', 'This semester starts on Aug 1, 2027. It cannot be made active before then.');
        $this->patchJson("/api/system/academic-years/{$next}/current")->assertUnprocessable()->assertJsonValidationErrors('academic_year');
        $this->assertSame($first->id, AcademicSemester::active()?->id);

        $this->travelTo('2027-08-02');
        $this->patchJson("/api/system/academic-semesters/{$newFirst}/active")->assertUnprocessable()->assertJsonPath('errors.semester.0', 'Complete both semesters in the current academic year before starting a new year.');
        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertOk();
        $this->assertSame($second->id, AcademicSemester::active()?->id);

        $this->patchJson("/api/system/academic-semesters/{$newFirst}/active")->assertOk()->assertJsonPath('status', 'active');
        $this->assertSame($newFirst, AcademicSemester::active()?->id);
        $this->assertSame(1, AcademicSemester::where('status', 'active')->count());
        $this->assertSame(['2027-2028'], AcademicYear::where('is_current', true)->pluck('label')->all());
        $this->assertNotNull($year->fresh()->closed_at);
        $this->assertSame('completed', $second->fresh()->status);
    }

    public function test_after_closing_the_last_semester_the_new_year_can_be_made_current_and_its_first_semester_activated(): void
    {
        [$director, $year, $first] = $this->liveSemester();
        Organization::factory()->create();
        Sanctum::actingAs($director);
        $second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        $next = $this->postJson('/api/system/academic-years', ['label' => '2027-2028', 'starts_on' => '2027-08-01', 'ends_on' => '2028-05-31'])->assertCreated()->json('id');
        $newFirst = $this->postJson("/api/system/academic-years/{$next}/semesters", ['number' => 1, 'starts_on' => '2027-08-01', 'ends_on' => '2027-12-15'])->assertCreated()->json('id');

        $this->travelTo('2027-01-02');
        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertOk();
        $this->patchJson("/api/system/academic-semesters/{$second->id}/close", $this->confirming($second))->assertOk();
        $this->patchJson("/api/system/academic-years/{$next}/current")->assertOk()->assertJsonPath('is_current', true);
        $this->assertSame(0, AcademicSemester::where('status', 'active')->count());

        $this->travelTo('2027-08-01');
        $this->patchJson("/api/system/academic-semesters/{$newFirst}/active")->assertOk();
        $this->assertSame($newFirst, AcademicSemester::active()?->id);
        $this->assertSame(['2027-2028'], AcademicYear::where('is_current', true)->pluck('label')->all());
    }

    public function test_making_a_year_current_is_refused_whenever_a_semester_of_another_year_is_active(): void
    {
        [$director, $year] = $this->liveSemester();
        $future = AcademicYear::create(['label' => '2027-2028', 'starts_on' => '2027-08-01', 'ends_on' => '2028-05-31', 'is_current' => true]);
        $year->update(['is_current' => false]);
        Sanctum::actingAs($director);

        $this->patchJson("/api/system/academic-years/{$future->id}/current")->assertUnprocessable()->assertJsonValidationErrors('academic_year');
        $this->assertSame(['2027-2028'], AcademicYear::where('is_current', true)->pluck('label')->all());
        $this->patchJson("/api/system/academic-years/{$year->id}/current")->assertOk();
        $this->assertSame(['2026-2027'], AcademicYear::where('is_current', true)->pluck('label')->all());
    }

    public function test_the_sao_can_change_the_dates_of_an_upcoming_semester_and_it_is_audited(): void
    {
        [$director, $year] = $this->liveSemester();
        Sanctum::actingAs($director);
        $second = $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31'])->assertCreated()->json('id');
        ComplianceRequirementType::where('academic_semester_id', $second)->update(['deadline_at' => '2027-03-15 23:59:59']);

        $this->patchJson("/api/system/academic-semesters/{$second}/dates", ['starts_on' => '2027-01-11', 'ends_on' => '2027-05-28'])
            ->assertOk()->assertJsonPath('starts_on', '2027-01-11')->assertJsonPath('ends_on', '2027-05-28')->assertJsonPath('status', 'upcoming');

        $this->assertSame('2027-01-11', AcademicSemester::find($second)->starts_on->toDateString());
        $this->assertSame('2027-05-28', AcademicSemester::find($second)->ends_on->toDateString());
        $audit = AuditLog::where('action', 'academic_semester_dates_changed')->where('record_id', $second)->first();
        $this->assertNotNull($audit);
        $this->assertSame($director->school_id, $audit->user_id);
        $this->assertSame('SUPER_ADMIN', $audit->actor_role);
    }

    public function test_changing_semester_dates_is_for_the_sao_only_and_throttled_as_a_write(): void
    {
        [$director, $year] = $this->liveSemester();
        $second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        $admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        $dean = User::factory()->departmentHead()->create();

        foreach ([$admin, $dean] as $user) {
            Sanctum::actingAs($user);
            $this->patchJson("/api/system/academic-semesters/{$second->id}/dates", ['starts_on' => '2027-01-11', 'ends_on' => '2027-05-31'])->assertForbidden();
        }
        $this->assertSame('2027-01-01', $second->fresh()->starts_on->toDateString());

        $route = app('router')->getRoutes()->match(Request::create("/api/system/academic-semesters/{$second->id}/dates", 'PATCH'));
        $this->assertContains('throttle:api-write', $route->gatherMiddleware());
        $this->assertContains('role:SUPER_ADMIN', $route->gatherMiddleware());
    }

    public function test_dates_of_an_active_or_completed_semester_cannot_be_changed(): void
    {
        [$director, $year, $first] = $this->liveSemester();
        Sanctum::actingAs($director);

        $this->patchJson("/api/system/academic-semesters/{$first->id}/dates", ['starts_on' => '2026-08-03', 'ends_on' => '2026-12-31'])
            ->assertUnprocessable()->assertJsonValidationErrors('semester');
        $first->update(['status' => 'completed']);
        $this->patchJson("/api/system/academic-semesters/{$first->id}/dates", ['starts_on' => '2026-08-03', 'ends_on' => '2026-12-31'])
            ->assertUnprocessable()->assertJsonValidationErrors('semester');
        $this->assertSame('2026-08-01', $first->fresh()->starts_on->toDateString());
        $this->assertSame(0, AuditLog::where('action', 'academic_semester_dates_changed')->count());
    }

    public function test_changed_semester_dates_are_validated_exactly_as_when_adding_one(): void
    {
        [$director, $year, $first] = $this->liveSemester();
        Sanctum::actingAs($director);
        $second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        $url = "/api/system/academic-semesters/{$second->id}/dates";

        $this->patchJson($url, ['starts_on' => '2027-01-01'])->assertUnprocessable()->assertJsonValidationErrors('ends_on');
        $this->patchJson($url, ['starts_on' => 'not a date', 'ends_on' => '2027-05-31'])->assertUnprocessable()->assertJsonValidationErrors('starts_on');
        $this->patchJson($url, ['starts_on' => '2027-05-31', 'ends_on' => '2027-05-31'])->assertUnprocessable()->assertJsonValidationErrors('ends_on');
        $this->patchJson($url, ['starts_on' => '2027-02-01', 'ends_on' => '2027-01-15'])->assertUnprocessable()->assertJsonValidationErrors('ends_on');
        $this->patchJson($url, ['starts_on' => '2026-07-15', 'ends_on' => '2027-05-31'])->assertUnprocessable()->assertJsonPath('errors.starts_on.0', 'Semester dates must fall within the academic year.');
        $this->patchJson($url, ['starts_on' => '2027-01-01', 'ends_on' => '2027-06-30'])->assertUnprocessable()->assertJsonPath('errors.starts_on.0', 'Semester dates must fall within the academic year.');
        $this->patchJson($url, ['starts_on' => '2026-12-31', 'ends_on' => '2027-05-31'])->assertUnprocessable()->assertJsonPath('errors.starts_on.0', 'Semester dates cannot overlap.');
        $this->assertSame('2027-01-01', $second->fresh()->starts_on->toDateString());
        $this->assertSame('2027-05-31', $second->fresh()->ends_on->toDateString());

        $this->patchJson($url, ['starts_on' => '2027-01-01', 'ends_on' => '2027-05-31'])->assertOk();
        $this->assertSame('2026-12-31', $first->fresh()->ends_on->toDateString());
    }

    public function test_changing_semester_dates_is_refused_when_requirement_deadlines_would_fall_outside_and_names_how_many(): void
    {
        [$director, $year] = $this->liveSemester();
        Sanctum::actingAs($director);
        $second = $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31'])->assertCreated()->json('id');
        $total = ComplianceRequirementType::where('academic_semester_id', $second)->count();
        $this->assertGreaterThan(2, $total);
        ComplianceRequirementType::where('academic_semester_id', $second)->update(['deadline_at' => '2027-03-15 23:59:59']);
        ComplianceRequirementType::where('academic_semester_id', $second)->orderBy('id')->limit(2)->update(['deadline_at' => '2027-05-31 23:59:59']);
        $before = ComplianceRequirementType::where('academic_semester_id', $second)->orderBy('id')->pluck('deadline_at', 'id')->map->toDateTimeString()->all();

        $this->patchJson("/api/system/academic-semesters/{$second}/dates", ['starts_on' => '2027-01-01', 'ends_on' => '2027-05-15'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.semester.0', '2 requirement deadlines in this semester fall outside these dates. Change those deadlines first, or pick dates that include them.');
        $this->patchJson("/api/system/academic-semesters/{$second}/dates", ['starts_on' => '2027-03-16', 'ends_on' => '2027-05-31'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.semester.0', ($total - 2).' requirement deadlines in this semester fall outside these dates. Change those deadlines first, or pick dates that include them.');

        $this->assertSame('2027-01-01', AcademicSemester::find($second)->starts_on->toDateString());
        $this->assertSame('2027-05-31', AcademicSemester::find($second)->ends_on->toDateString());
        $this->assertSame($before, ComplianceRequirementType::where('academic_semester_id', $second)->orderBy('id')->pluck('deadline_at', 'id')->map->toDateTimeString()->all());
        $this->assertSame(0, AuditLog::where('action', 'academic_semester_dates_changed')->count());
        $this->patchJson("/api/system/academic-semesters/{$second}/dates", ['starts_on' => '2027-01-01', 'ends_on' => '2027-05-31'])->assertOk();
    }

    public function test_activate_still_refuses_a_future_semester_until_its_dates_are_changed_to_start_today(): void
    {
        [$director, $year, $first] = $this->liveSemester();
        Sanctum::actingAs($director);
        $this->travelTo('2026-12-20');
        $first->update(['ends_on' => '2026-12-15']);
        $second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        $this->patchJson("/api/system/academic-semesters/{$first->id}/close", $this->confirming($first))->assertOk();

        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertUnprocessable()->assertJsonValidationErrors('semester');
        $this->patchJson("/api/system/academic-semesters/{$second->id}/dates", ['starts_on' => '2026-12-16', 'ends_on' => '2027-05-31'])->assertOk();
        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertOk()->assertJsonPath('status', 'active');
        $this->assertSame(1, AcademicSemester::where('status', 'active')->count());
    }
}
