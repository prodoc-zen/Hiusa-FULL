<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\ComplianceRequirementType;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RequirementTypeDeadlineAndPeriodTest extends TestCase
{
    use RefreshDatabase;

    private User $sao;

    private User $admin;

    private AcademicSemester $semester;

    protected function setUp(): void
    {
        parent::setUp();
        $office = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'lifecycle_status' => 'active']);
        $this->sao = User::factory()->superAdmin()->create(['organization_id' => $office->id, 'account_status' => 'active']);
        $this->admin = User::factory()->admin()->create([
            'organization_id' => Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active'])->id,
            'account_status' => 'active',
        ]);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicYear::create(['label' => '2027-2028', 'starts_on' => '2027-08-01', 'ends_on' => '2028-05-31', 'is_current' => false]);
        $this->semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        Sanctum::actingAs($this->sao);
    }

    private function storedType(string $deadline = '2026-12-31 17:00:00'): ComplianceRequirementType
    {
        return ComplianceRequirementType::create([
            'academic_year' => '2026-2027',
            'academic_semester_id' => $this->semester->id,
            'name' => 'Constitution and By-Laws',
            'deadline_at' => $deadline,
            'is_active' => true,
            'created_by' => $this->sao->school_id,
        ]);
    }

    private function payload(array $overrides = []): array
    {
        return [
            'academic_year' => '2026-2027',
            'name' => 'Safety pledge',
            'deadline_at' => '2026-11-30',
            'allowed_extensions' => ['pdf'],
            'template_url' => 'https://example.edu/pledge.pdf',
            ...$overrides,
        ];
    }

    public function test_an_edit_that_leaves_the_date_alone_keeps_the_stored_deadline_and_notifies_no_one(): void
    {
        $type = $this->storedType();

        $this->putJson("/api/compliance/requirement-types/{$type->id}", [
            'name' => 'Constitution and By-Laws (revised)',
            'description' => 'Updated wording',
            'deadline_at' => '2026-12-31',
            'allowed_extensions' => ['pdf'],
            'is_active' => true,
        ])->assertOk();

        $this->assertSame('2026-12-31 17:00:00', $type->fresh()->deadline_at->format('Y-m-d H:i:s'));
        $this->assertDatabaseMissing('notifications', ['title' => 'Compliance deadline changed', 'reference_id' => $type->id]);
        $this->assertDatabaseMissing('notifications', ['user_id' => $this->admin->school_id, 'reference_type' => 'compliance_requirement_type']);
    }

    public function test_an_edit_that_moves_the_date_keeps_the_time_of_day_and_notifies_once(): void
    {
        $type = $this->storedType();

        $this->putJson("/api/compliance/requirement-types/{$type->id}", ['deadline_at' => '2026-12-15'])->assertOk();

        $this->assertSame('2026-12-15 17:00:00', $type->fresh()->deadline_at->format('Y-m-d H:i:s'));
        $this->assertDatabaseHas('notifications', ['user_id' => $this->admin->school_id, 'title' => 'Compliance deadline changed', 'reference_id' => $type->id]);
        $this->assertSame(1, Notification::where('user_id', $this->admin->school_id)->where('title', 'Compliance deadline changed')->count());
    }

    public function test_a_new_requirement_is_due_at_the_end_of_the_chosen_day_like_the_semester_defaults(): void
    {
        $id = $this->postJson('/api/compliance/requirement-types', $this->payload())->assertCreated()->json('id');

        $this->assertSame('2026-11-30 23:59:59', ComplianceRequirementType::findOrFail($id)->deadline_at->format('Y-m-d H:i:s'));
    }

    public function test_a_new_requirement_belongs_to_the_selected_semester(): void
    {
        $id = $this->postJson('/api/compliance/requirement-types', $this->payload())->assertCreated()->json('id');

        $this->assertSame($this->semester->id, ComplianceRequirementType::findOrFail($id)->academic_semester_id);
    }

    public function test_a_year_other_than_the_selected_semesters_is_refused_and_creates_nothing(): void
    {
        $this->postJson('/api/compliance/requirement-types', $this->payload(['academic_year' => '2027-2028']))
            ->assertUnprocessable()
            ->assertJsonPath('message', 'New requirements belong to 2026-2027, the year you are working in. Switch the semester to add one for another year.');

        $this->assertDatabaseMissing('compliance_requirement_types', ['name' => 'Safety pledge']);
        $this->assertDatabaseMissing('notifications', ['user_id' => $this->admin->school_id, 'title' => 'New compliance requirement']);
    }

    public function test_creation_is_refused_when_no_semester_is_selected_or_active(): void
    {
        $this->semester->update(['status' => 'completed']);

        $this->postJson('/api/compliance/requirement-types', $this->payload())
            ->assertUnprocessable()
            ->assertJsonPath('message', 'There is no active semester. Activate or select a semester before adding a requirement.');

        $this->assertDatabaseMissing('compliance_requirement_types', ['name' => 'Safety pledge']);
    }

    public function test_the_compliance_status_says_whether_a_semester_is_selected_so_the_form_can_hold_back_new_requirements(): void
    {
        $this->getJson('/api/compliance/status')
            ->assertOk()
            ->assertJsonPath('academic_year', '2026-2027')
            ->assertJsonPath('academic_semester_id', $this->semester->id)
            ->assertJsonPath('no_semester', false);

        // The semester is closed straight in the database, so skip the response cache a real close would have invalidated.
        $this->semester->update(['status' => 'completed']);

        $this->getJson('/api/compliance/status', ['Cache-Control' => 'no-cache'])
            ->assertOk()
            ->assertJsonPath('academic_year', '2026-2027')
            ->assertJsonPath('academic_semester_id', null)
            ->assertJsonPath('no_semester', true);
    }

    public function test_an_event_requirement_belongs_to_the_selected_semester_and_is_refused_when_there_is_none(): void
    {
        $payload = ['name' => 'Venue clearance', 'venue_type' => 'all', 'allowed_extensions' => ['pdf'], 'template_url' => 'https://example.edu/clearance.pdf'];

        $id = $this->postJson('/api/event-requirements', $payload)->assertCreated()->json('id');
        $this->assertDatabaseHas('event_requirements', ['id' => $id, 'academic_semester_id' => $this->semester->id]);

        $this->semester->update(['status' => 'completed']);
        $this->postJson('/api/event-requirements', [...$payload, 'name' => 'Second clearance'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'There is no active semester. Activate or select a semester before adding a requirement.');
        $this->assertDatabaseMissing('event_requirements', ['name' => 'Second clearance']);
    }

    private function upcomingSemester(): AcademicSemester
    {
        $year = AcademicYear::where('label', '2027-2028')->firstOrFail();

        return AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2027-08-01', 'ends_on' => '2027-12-31', 'status' => 'upcoming']);
    }

    public function test_a_new_requirement_whose_deadline_is_outside_its_semester_is_refused_with_a_plain_message(): void
    {
        foreach (['2028-11-10', '2027-01-01', '2026-07-31'] as $outside) {
            $this->postJson('/api/compliance/requirement-types', $this->payload(['deadline_at' => $outside]))
                ->assertUnprocessable()
                ->assertJsonPath('errors.deadline_at.0', 'The deadline must fall inside this semester, between August 1, 2026 and December 31, 2026.');
        }

        $this->assertDatabaseMissing('compliance_requirement_types', ['name' => 'Safety pledge']);
        $this->assertDatabaseMissing('notifications', ['user_id' => $this->admin->school_id, 'title' => 'New compliance requirement']);
    }

    public function test_the_first_and_last_day_of_the_semester_are_accepted(): void
    {
        $this->postJson('/api/compliance/requirement-types', $this->payload(['name' => 'First day', 'deadline_at' => '2026-08-01']))->assertCreated();
        $this->postJson('/api/compliance/requirement-types', $this->payload(['name' => 'Last day', 'deadline_at' => '2026-12-31']))->assertCreated();
    }

    public function test_an_edit_that_moves_the_deadline_outside_the_semester_is_refused_and_changes_nothing(): void
    {
        $type = $this->storedType();

        $this->putJson("/api/compliance/requirement-types/{$type->id}", ['deadline_at' => '2028-11-10'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.deadline_at.0', 'The deadline must fall inside this semester, between August 1, 2026 and December 31, 2026.');

        $this->assertSame('2026-12-31 17:00:00', $type->fresh()->deadline_at->format('Y-m-d H:i:s'));
        $this->assertDatabaseMissing('notifications', ['title' => 'Compliance deadline changed', 'reference_id' => $type->id]);
    }

    public function test_a_stored_deadline_already_outside_its_semester_can_stay_while_the_rest_is_edited(): void
    {
        $type = $this->storedType('2028-11-10 23:59:59');

        $this->putJson("/api/compliance/requirement-types/{$type->id}", ['name' => 'Valid ID', 'deadline_at' => '2028-11-10'])->assertOk();

        $this->assertSame('2028-11-10 23:59:59', $type->fresh()->deadline_at->format('Y-m-d H:i:s'));
    }

    public function test_a_requirement_without_a_semester_has_no_range_to_keep_to(): void
    {
        $type = ComplianceRequirementType::create(['academic_year' => '2026-2027', 'name' => 'Legacy', 'deadline_at' => '2026-12-31 17:00:00', 'is_active' => true, 'created_by' => $this->sao->school_id]);

        $this->putJson("/api/compliance/requirement-types/{$type->id}", ['deadline_at' => '2028-11-10', 'template_url' => 'https://example.edu/legacy.pdf'])->assertOk();
    }

    public function test_switching_the_semester_shows_that_semesters_requirements_and_range_never_the_previous_ones(): void
    {
        $this->storedType();
        $upcoming = $this->upcomingSemester();
        ComplianceRequirementType::create([
            'academic_year' => '2027-2028',
            'academic_semester_id' => $upcoming->id,
            'name' => 'Next year roster',
            'deadline_at' => '2027-12-31 23:59:59',
            'is_active' => true,
            'created_by' => $this->sao->school_id,
        ]);
        $header = ['X-Academic-Semester' => (string) $upcoming->id, 'Cache-Control' => 'no-cache'];

        $this->getJson('/api/compliance/requirement-types?category=organization', ['Cache-Control' => 'no-cache'])
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Constitution and By-Laws');
        $this->getJson('/api/compliance/requirement-types?category=organization', $header)
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Next year roster');

        $this->getJson('/api/compliance/status', $header)
            ->assertOk()
            ->assertJsonPath('academic_semester_id', $upcoming->id)
            ->assertJsonPath('semester_starts_on', '2027-08-01')
            ->assertJsonPath('semester_ends_on', '2027-12-31')
            ->assertJsonPath('organizations.0.requirements.0.requirement_name', 'Next year roster');
    }

    public function test_a_new_requirement_in_a_switched_semester_must_fall_inside_that_semester(): void
    {
        $upcoming = $this->upcomingSemester();
        $header = ['X-Academic-Semester' => (string) $upcoming->id];

        $this->postJson('/api/compliance/requirement-types', $this->payload(['academic_year' => '2027-2028', 'deadline_at' => '2026-11-30']), $header)
            ->assertUnprocessable()
            ->assertJsonPath('errors.deadline_at.0', 'The deadline must fall inside this semester, between August 1, 2027 and December 31, 2027.');

        $id = $this->postJson('/api/compliance/requirement-types', $this->payload(['academic_year' => '2027-2028', 'deadline_at' => '2027-11-30']), $header)->assertCreated()->json('id');
        $this->assertSame($upcoming->id, ComplianceRequirementType::findOrFail($id)->academic_semester_id);
    }
}
