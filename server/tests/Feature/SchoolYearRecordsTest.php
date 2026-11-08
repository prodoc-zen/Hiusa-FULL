<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AccountProfile;
use App\Models\Announcement;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\Event;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\OrganizationSemesterRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class SchoolYearRecordsTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private AcademicSemester $closed;

    private AcademicSemester $active;

    private AcademicSemester $upcoming;

    private Organization $org;

    private User $admin;

    private User $sao;

    protected function setUp(): void
    {
        parent::setUp();
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $next = AcademicYear::create(['label' => '2027-2028', 'starts_on' => '2027-08-01', 'ends_on' => '2028-05-31', 'is_current' => false]);
        $this->closed = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'completed']);
        $this->active = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
        $this->upcoming = AcademicSemester::create(['academic_year_id' => $next->id, 'number' => 1, 'starts_on' => '2027-08-01', 'ends_on' => '2027-12-31', 'status' => 'upcoming']);

        $college = $this->makeCollege('CIT');
        $this->makeCollegeHome($college);
        $this->org = $this->makeCollegeStudentOrganization($college, ['name' => 'Code Guild', 'lifecycle_status' => 'active']);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->org->id]);
        $this->sao = User::factory()->superAdmin()->create(['organization_id' => Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION'])->id]);
    }

    private function inPeriod(AcademicSemester $semester): array
    {
        return [AcademicSemester::PERIOD_HEADER => (string) $semester->id];
    }

    private function eventPayload(string $date): array
    {
        return ['title' => 'Leadership Day', 'start_time' => "{$date} 09:00:00", 'end_time' => "{$date} 12:00:00", 'location' => 'Hall'];
    }

    public function test_the_period_header_picks_the_semester_for_reads(): void
    {
        $past = Event::factory()->create(['organization_id' => $this->org->id, 'academic_semester_id' => $this->closed->id, 'status' => 'approved', 'created_by' => $this->admin->school_id, 'title' => 'Orientation 2026']);
        Event::factory()->create(['organization_id' => $this->org->id, 'academic_semester_id' => $this->active->id, 'status' => 'approved', 'created_by' => $this->admin->school_id, 'title' => 'Foundation Week']);
        Sanctum::actingAs($this->admin);

        $this->getJson('/api/events')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.title', 'Foundation Week');
        $this->getJson('/api/events', $this->inPeriod($this->closed))->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $past->id);
    }

    public function test_an_unknown_or_unseen_period_falls_back_to_the_active_semester(): void
    {
        $officer = User::factory()->officer()->create(['organization_id' => $this->org->id]);
        $request = fn (User $user, string $value) => tap(Request::create('/api/events'), function (Request $request) use ($user, $value) {
            $request->headers->set(AcademicSemester::PERIOD_HEADER, $value);
            $request->setUserResolver(fn () => $user);
        });

        $this->assertSame($this->active->id, AcademicSemester::selected($request($this->admin, '999999'))->id);
        $this->assertSame($this->active->id, AcademicSemester::selected($request($this->admin, 'abc'))->id);
        $this->assertSame($this->closed->id, AcademicSemester::selected($request($officer, (string) $this->closed->id))->id);
        $this->assertSame($this->active->id, AcademicSemester::selected($request($officer, (string) $this->upcoming->id))->id);
        $this->assertSame($this->upcoming->id, AcademicSemester::selected($request($this->admin, (string) $this->upcoming->id))->id);
        $student = User::factory()->student()->create(['organization_id' => $this->org->id]);
        $this->assertSame($this->active->id, AcademicSemester::selected($request($student, (string) $this->closed->id))->id);
    }

    public function test_writes_are_refused_while_a_closed_period_is_selected(): void
    {
        $past = Event::factory()->create(['organization_id' => $this->org->id, 'academic_semester_id' => $this->closed->id, 'status' => 'approved', 'created_by' => $this->admin->school_id]);
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/events', $this->eventPayload('2026-10-10'), $this->inPeriod($this->closed))
            ->assertStatus(409)->assertJsonPath('message', 'This school year is closed. Its records are read only.');
        $this->postJson('/api/tasks', ['title' => 'Prepare'], $this->inPeriod($this->closed))->assertStatus(409);
        $this->putJson("/api/events/{$past->id}", ['title' => 'Changed'])->assertStatus(409)
            ->assertJsonPath('message', 'This school year is closed. Its records are read only.');
        $this->assertDatabaseMissing('events', ['title' => 'Leadership Day']);
        $this->assertDatabaseMissing('events', ['id' => $past->id, 'title' => 'Changed']);

        Sanctum::actingAs($this->sao);
        $this->postJson('/api/event-requirements', ['name' => 'Late form', 'venue_type' => 'on_campus', 'allowed_extensions' => ['pdf'], 'template_url' => 'https://example.edu/sample.pdf'], $this->inPeriod($this->closed))->assertStatus(409);
        $this->postJson('/api/compliance/requirement-types', ['academic_year' => '2026-2027', 'name' => 'Late letter', 'deadline_at' => '2026-12-31', 'allowed_extensions' => ['pdf'], 'template_url' => 'https://example.edu/sample.pdf'], $this->inPeriod($this->closed))->assertStatus(409);
    }

    public function test_a_missing_event_is_still_a_404_and_other_organizations_are_not_reachable(): void
    {
        $other = Event::factory()->create(['organization_id' => Organization::factory()->create()->id, 'academic_semester_id' => $this->active->id, 'created_by' => $this->admin->school_id]);
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/events/999999', ['title' => 'x'])->assertNotFound();
        $this->putJson("/api/events/{$other->id}", ['title' => 'x'])->assertNotFound();
    }

    public function test_planning_ahead_stamps_the_upcoming_semester_and_keeps_it_editable(): void
    {
        Sanctum::actingAs($this->admin);

        $created = $this->postJson('/api/events', $this->eventPayload('2027-09-10'), $this->inPeriod($this->upcoming))->assertCreated();
        $eventId = $created->json('id') ?? $created->json('event.id') ?? $created->json('data.id');
        $this->assertDatabaseHas('events', ['id' => $eventId, 'academic_semester_id' => $this->upcoming->id]);

        $this->putJson("/api/events/{$eventId}", ['title' => 'Leadership Day 2'])->assertOk();
        $this->assertDatabaseHas('events', ['id' => $eventId, 'title' => 'Leadership Day 2']);

        $this->postJson('/api/events', $this->eventPayload('2027-02-10'))->assertCreated();
        $this->assertDatabaseHas('events', ['title' => 'Leadership Day', 'academic_semester_id' => $this->active->id, 'start_time' => '2027-02-10 09:00:00']);

        $this->postJson('/api/events', $this->eventPayload('2027-02-10'), $this->inPeriod($this->upcoming))->assertStatus(422);
    }

    public function test_the_sao_plans_requirements_into_an_upcoming_semester(): void
    {
        Sanctum::actingAs($this->sao);

        $this->postJson('/api/event-requirements', ['name' => 'Next year form', 'venue_type' => 'on_campus', 'allowed_extensions' => ['pdf'], 'template_url' => 'https://example.edu/sample.pdf'], $this->inPeriod($this->upcoming))->assertCreated();
        $this->assertDatabaseHas('event_requirements', ['name' => 'Next year form', 'academic_semester_id' => $this->upcoming->id]);

        $this->postJson('/api/compliance/requirement-types', ['academic_year' => '2027-2028', 'name' => 'Next year letter', 'deadline_at' => '2027-12-31', 'allowed_extensions' => ['pdf'], 'template_url' => 'https://example.edu/sample.pdf'], $this->inPeriod($this->upcoming))->assertCreated();
        $this->assertDatabaseHas('compliance_requirement_types', ['name' => 'Next year letter', 'academic_semester_id' => $this->upcoming->id]);

        $this->postJson('/api/event-requirements', ['name' => 'This term form', 'venue_type' => 'on_campus', 'allowed_extensions' => ['pdf'], 'template_url' => 'https://example.edu/sample.pdf'])->assertCreated();
        $this->assertDatabaseHas('event_requirements', ['name' => 'This term form', 'academic_semester_id' => $this->active->id]);
    }

    public function test_an_organization_admin_uploads_for_an_upcoming_period_but_not_a_closed_one(): void
    {
        Storage::fake('local');
        $type = fn (AcademicSemester $semester, string $label) => ComplianceRequirementType::create([
            'academic_year' => $semester->academicYear->label, 'academic_semester_id' => $semester->id, 'name' => $label, 'category' => 'organization',
            'allowed_extensions' => ['pdf'], 'deadline_at' => $semester->ends_on, 'is_active' => true, 'created_by' => $this->sao->school_id,
        ]);
        $planned = $type($this->upcoming, 'Planned letter');
        $old = $type($this->closed, 'Old letter');
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/compliance/submissions', ['requirement_type_id' => $planned->id, 'document' => UploadedFile::fake()->create('p.pdf', 50, 'application/pdf')], $this->inPeriod($this->upcoming))->assertSuccessful();
        $this->assertDatabaseHas('organization_compliance_submissions', ['organization_id' => $this->org->id, 'requirement_type_id' => $planned->id]);
        $this->postJson('/api/compliance/submissions', ['requirement_type_id' => $old->id, 'document' => UploadedFile::fake()->create('o.pdf', 50, 'application/pdf')])->assertStatus(409);
        $this->assertDatabaseMissing('organization_compliance_submissions', ['requirement_type_id' => $old->id]);
    }

    public function test_an_organization_admin_sees_the_requirements_of_the_selected_period(): void
    {
        $type = fn (AcademicSemester $semester, string $label, string $year) => ComplianceRequirementType::create([
            'academic_year' => $year, 'academic_semester_id' => $semester->id, 'name' => $label, 'category' => 'organization',
            'allowed_extensions' => ['pdf'], 'deadline_at' => $semester->ends_on, 'is_active' => true, 'created_by' => $this->sao->school_id,
        ]);
        $type($this->active, 'Current letter', '2026-2027');
        $type($this->upcoming, 'Planned letter', '2027-2028');
        Sanctum::actingAs($this->admin);

        $names = fn (array $headers) => collect($this->getJson('/api/compliance/requirement-types', $headers)->assertOk()->json('data'))->pluck('name')->all();
        $this->assertSame(['Current letter'], $names([]));
        $this->assertSame(['Planned letter'], $names($this->inPeriod($this->upcoming)));
    }

    public function test_new_announcements_and_bookings_are_stamped_with_the_selected_period(): void
    {
        $request = request();
        $request->setUserResolver(fn () => $this->admin);
        $request->headers->set(AcademicSemester::PERIOD_HEADER, (string) $this->upcoming->id);
        $planned = Announcement::factory()->create(['organization_id' => $this->org->id, 'created_by' => $this->admin->school_id]);
        $request->headers->set(AcademicSemester::PERIOD_HEADER, (string) $this->closed->id);
        $fromArchiveView = Announcement::factory()->create(['organization_id' => $this->org->id, 'created_by' => $this->admin->school_id]);
        $request->headers->remove(AcademicSemester::PERIOD_HEADER);
        $now = Announcement::factory()->create(['organization_id' => $this->org->id, 'created_by' => $this->admin->school_id]);

        $this->assertSame($this->upcoming->id, $planned->academic_semester_id);
        $this->assertSame($this->active->id, $fromArchiveView->academic_semester_id);
        $this->assertSame($this->active->id, $now->academic_semester_id);
    }

    public function test_the_sao_announcement_list_follows_the_selected_period(): void
    {
        $make = fn (AcademicSemester $semester, string $title) => Announcement::factory()->create([
            'title' => $title, 'announcement_source' => 'SAO', 'organization_id' => $this->org->id, 'created_by' => $this->sao->school_id,
            'academic_semester_id' => $semester->id,
        ]);
        $make($this->closed, 'Enrolment notice');
        $make($this->active, 'Foundation week');
        Sanctum::actingAs($this->sao);

        $titles = fn (array $headers) => collect($this->getJson('/api/system/announcements', $headers)->assertOk()->json('data'))->pluck('title')->all();
        $this->assertSame(['Foundation week'], $titles([]));
        $this->assertSame(['Enrolment notice'], $titles($this->inPeriod($this->closed)));
    }

    public function test_activating_a_semester_snapshots_the_closing_one(): void
    {
        $leader = User::factory()->officer()->create(['organization_id' => $this->org->id, 'first_name' => 'Ana', 'last_name' => 'Reyes']);
        AccountProfile::updateOrCreate(['user_school_id' => $leader->school_id, 'organization_id' => $this->org->id], ['role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => 'Secretary']);
        Sanctum::actingAs($this->sao);

        $this->patchJson("/api/system/academic-semesters/{$this->upcoming->id}/active")->assertOk();

        $record = OrganizationSemesterRecord::where('organization_id', $this->org->id)->where('academic_semester_id', $this->active->id)->firstOrFail();
        $this->assertSame('active', $record->lifecycle_status);
        $this->assertSame(['school_id' => $leader->school_id, 'name' => 'Ana Reyes', 'position_title' => 'Secretary', 'role' => 'SBO_OFFICER'], collect($record->officers)->firstWhere('school_id', $leader->school_id));
        $this->assertContains($this->admin->school_id, collect($record->officers)->pluck('school_id')->all());
        $this->assertSame('completed', $this->active->fresh()->status);
        $this->assertDatabaseMissing('organization_semester_records', ['academic_semester_id' => $this->upcoming->id]);
    }

    public function test_closing_a_semester_snapshots_it(): void
    {
        Sanctum::actingAs($this->sao);

        $this->patchJson("/api/system/academic-semesters/{$this->active->id}/close")->assertOk();

        $this->assertDatabaseHas('organization_semester_records', ['organization_id' => $this->org->id, 'academic_semester_id' => $this->active->id]);
    }

    public function test_the_snapshot_command_records_the_active_semester_and_is_repeatable(): void
    {
        $this->artisan('hiusa:snapshot-semester')->assertSuccessful();
        $this->artisan('hiusa:snapshot-semester', ['semester' => $this->closed->id])->assertSuccessful();
        $this->artisan('hiusa:snapshot-semester', ['semester' => $this->closed->id])->assertSuccessful();

        $this->assertDatabaseHas('organization_semester_records', ['organization_id' => $this->org->id, 'academic_semester_id' => $this->active->id]);
        $this->assertSame(1, OrganizationSemesterRecord::where('academic_semester_id', $this->closed->id)->where('organization_id', $this->org->id)->count());
        $this->artisan('hiusa:snapshot-semester', ['semester' => 999999])->assertFailed();
    }

    public function test_records_show_the_snapshot_after_officers_change(): void
    {
        $leader = User::factory()->officer()->create(['organization_id' => $this->org->id, 'first_name' => 'Ana', 'last_name' => 'Reyes']);
        $profile = AccountProfile::updateOrCreate(['user_school_id' => $leader->school_id, 'organization_id' => $this->org->id], ['role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => 'Secretary']);
        $this->artisan('hiusa:snapshot-semester', ['semester' => $this->closed->id])->assertSuccessful();
        $this->org->update(['lifecycle_status' => 'archived']);
        $profile->update(['account_status' => 'inactive']);
        Sanctum::actingAs($this->sao);

        $past = $this->getJson("/api/records?academic_semester_id={$this->closed->id}&organization_id={$this->org->id}")->assertOk();
        $past->assertJsonPath('semester.read_only', true)
            ->assertJsonPath('organization.status.lifecycle_status', 'active')
            ->assertJsonFragment(['name' => 'Ana Reyes', 'position_title' => 'Secretary'])
            ->assertJsonPath('organizations.0.lifecycle_status', 'active');

        $now = $this->getJson("/api/records?organization_id={$this->org->id}")->assertOk();
        $now->assertJsonPath('semester.id', $this->active->id)->assertJsonPath('semester.read_only', false)
            ->assertJsonPath('organization.status.lifecycle_status', 'archived')
            ->assertJsonMissing(['name' => 'Ana Reyes']);
    }

    public function test_a_past_period_without_a_snapshot_says_it_was_not_recorded(): void
    {
        Sanctum::actingAs($this->sao);

        $this->getJson("/api/records?academic_semester_id={$this->closed->id}&organization_id={$this->org->id}")->assertOk()
            ->assertJsonPath('organization.status.recorded', false)->assertJsonPath('organization.officers', []);
    }

    public function test_records_list_the_period_with_counts_files_events_and_winners(): void
    {
        Event::factory()->create(['organization_id' => $this->org->id, 'academic_semester_id' => $this->closed->id, 'status' => 'completed', 'created_by' => $this->admin->school_id, 'title' => 'Orientation 2026']);
        $election = Election::factory()->create(['organization_id' => $this->org->id, 'academic_semester_id' => $this->closed->id, 'status' => 'closed', 'results_visible' => true]);
        $type = ComplianceRequirementType::create(['academic_year' => '2026-2027', 'academic_semester_id' => $this->closed->id, 'name' => 'Letter of Intent', 'deadline_at' => '2026-12-31 23:59:59', 'is_active' => true, 'created_by' => $this->sao->school_id]);
        $submission = OrganizationComplianceSubmission::create([
            'organization_id' => $this->org->id, 'requirement_type_id' => $type->id, 'status' => 'approved', 'file_path' => 'compliance-submissions/1/loi.pdf',
            'file_original_name' => 'loi.pdf', 'mime_type' => 'application/pdf', 'file_size' => 1200, 'submitted_by' => $this->admin->school_id, 'submitted_at' => '2026-09-01 08:00:00',
        ]);
        Sanctum::actingAs($this->sao);

        $response = $this->getJson("/api/records?academic_semester_id={$this->closed->id}&organization_id={$this->org->id}")->assertOk();
        $response->assertJsonPath('organizations.0.counts', ['events' => 1, 'elections' => 1, 'files' => 1])
            ->assertJsonPath('organization.events.0.title', 'Orientation 2026')
            ->assertJsonPath('organization.documents.compliance.0.open_url', '/compliance/submissions/'.$submission->id.'/document')
            ->assertJsonPath('organization.elections.0.id', $election->id);
        $this->assertNotNull($response->json('organization.elections.0.winners'));
        $this->assertSame([], $response->json('organization.documents.event_files'));
    }

    public function test_the_year_selector_lists_started_years_only(): void
    {
        Sanctum::actingAs($this->sao);

        $response = $this->getJson('/api/records')->assertOk();
        $this->assertSame(['2026-2027'], collect($response->json('periods'))->pluck('label')->all());
        $this->getJson("/api/records?academic_semester_id={$this->upcoming->id}")->assertNotFound();
        $this->getJson("/api/records?academic_year_id={$this->closed->academic_year_id}")->assertOk()->assertJsonPath('semester.id', $this->active->id);
    }

    public function test_a_department_head_reads_only_their_own_college(): void
    {
        $own = $this->org->college_id;
        $head = $this->makeCollegeHead(College::findOrFail($own));
        $otherCollege = $this->makeCollege('COE');
        $this->makeCollegeHome($otherCollege);
        $otherOrg = $this->makeCollegeStudentOrganization($otherCollege, ['name' => 'Builders Circle']);
        Sanctum::actingAs($head);

        $list = $this->getJson('/api/records')->assertOk();
        $this->assertSame(['Code Guild'], collect($list->json('organizations'))->pluck('name')->all());
        $this->getJson("/api/records?organization_id={$this->org->id}")->assertOk()->assertJsonPath('organization.name', 'Code Guild');
        $this->getJson("/api/records?organization_id={$otherOrg->id}")->assertForbidden();
    }

    public function test_an_organization_admin_and_officer_read_only_their_own_organization(): void
    {
        $other = $this->makeCollegeStudentOrganization(College::findOrFail($this->org->college_id), ['name' => 'Rival Club']);
        $officer = User::factory()->officer()->create(['organization_id' => $this->org->id]);

        foreach ([$this->admin, $officer] as $user) {
            Sanctum::actingAs($user);
            $response = $this->getJson("/api/records?organization_id={$other->id}")->assertOk();
            $response->assertJsonPath('organization.name', 'Code Guild')->assertJsonPath('organizations', []);
        }
    }

    public function test_students_cannot_open_records(): void
    {
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $this->org->id]));

        $this->getJson('/api/records')->assertForbidden();
    }
}
