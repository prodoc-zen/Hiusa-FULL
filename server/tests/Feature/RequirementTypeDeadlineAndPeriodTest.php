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

        $this->putJson("/api/compliance/requirement-types/{$type->id}", ['deadline_at' => '2027-01-15'])->assertOk();

        $this->assertSame('2027-01-15 17:00:00', $type->fresh()->deadline_at->format('Y-m-d H:i:s'));
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
}
