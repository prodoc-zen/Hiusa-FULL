<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\ComplianceRequirementType;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\Organization;
use App\Models\User;
use App\Models\Venue;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertOk();
        $this->patchJson("/api/system/academic-years/{$year->id}/close")->assertUnprocessable();
        $this->patchJson("/api/system/academic-semesters/{$second->id}/close")->assertOk();
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
        $this->assertSame(10, ComplianceRequirementType::where('academic_semester_id', $first)->count());
        $this->assertSame(10, ComplianceRequirementType::where('academic_semester_id', $second)->count());
        $this->patchJson("/api/system/academic-semesters/{$first}/active")->assertOk();
        $requirement = ComplianceRequirementType::where('academic_semester_id', $first)->where('name', 'List of Members')->firstOrFail();
        $this->putJson("/api/compliance/requirement-types/{$requirement->id}", ['deadline_at' => '2026-12-20'])->assertOk();

        Sanctum::actingAs($admin);
        $this->getJson('/api/compliance/requirement-types?per_page=100')->assertOk()->assertJsonPath('total', 10);
        Sanctum::actingAs($director);
        $this->patchJson("/api/system/academic-semesters/{$second}/active")->assertOk();
        $this->putJson("/api/compliance/requirement-types/{$requirement->id}", ['is_active' => false])->assertStatus(409);
        Sanctum::actingAs($admin);
        $this->getJson('/api/compliance/requirement-types?per_page=100')->assertOk()->assertJsonPath('total', 10);
        $this->post('/api/compliance/submissions', [
            'requirement_type_id' => $requirement->id,
            'document' => UploadedFile::fake()->create('members.pdf', 20, 'application/pdf'),
        ])->assertStatus(409);
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
        $this->patchJson("/api/system/academic-semesters/{$semester}/active")->assertOk();
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
}
