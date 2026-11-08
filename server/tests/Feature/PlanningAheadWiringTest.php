<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\ApprovalRequest;
use App\Models\Election;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class PlanningAheadWiringTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private AcademicSemester $closed;

    private AcademicSemester $active;

    private AcademicSemester $upcoming;

    private Organization $org;

    private User $admin;

    private User $dean;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $next = AcademicYear::create(['label' => '2027-2028', 'starts_on' => '2027-08-01', 'ends_on' => '2028-05-31', 'is_current' => false]);
        $this->closed = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'completed']);
        $this->active = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
        $this->upcoming = AcademicSemester::create(['academic_year_id' => $next->id, 'number' => 1, 'starts_on' => '2027-08-01', 'ends_on' => '2027-12-31', 'status' => 'upcoming']);

        $college = $this->makeCollege('CIT');
        $this->dean = $this->makeCollegeHead($college);
        $this->org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active']);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->org->id]);
    }

    private function inPeriod(AcademicSemester $semester): array
    {
        return [AcademicSemester::PERIOD_HEADER => (string) $semester->id, 'Accept' => 'application/json'];
    }

    private function electionPayload(string $date): array
    {
        return [
            'title' => 'Officer election',
            'start_time' => "{$date} 09:00:00",
            'end_time' => "{$date} 17:00:00",
            'positions' => [['title' => 'President', 'max_winners' => 1]],
            'informative_letter' => UploadedFile::fake()->create('letter.pdf', 20, 'application/pdf'),
        ];
    }

    public function test_an_election_planned_in_an_upcoming_semester_is_stamped_there_listed_there_and_can_be_approved(): void
    {
        Sanctum::actingAs($this->admin);

        $response = $this->post('/api/elections', $this->electionPayload('2027-09-10'), $this->inPeriod($this->upcoming))->assertCreated();
        $election = Election::findOrFail($response->json('id'));

        $this->assertSame($this->upcoming->id, $election->academic_semester_id);
        $this->getJson('/api/elections', $this->inPeriod($this->upcoming))->assertOk()->assertJsonFragment(['id' => $election->id]);
        $this->getJson('/api/elections')->assertOk()->assertJsonMissing(['id' => $election->id]);

        $approvalId = ApprovalRequest::where('entity_type', 'election')->where('entity_id', $election->id)->value('id');
        Sanctum::actingAs($this->dean);
        $this->patchJson("/api/approval-requests/{$approvalId}", ['status' => 'approved'])->assertOk();

        $this->assertNotNull($election->fresh()->approved_at);
    }

    public function test_an_event_planned_in_an_upcoming_semester_can_be_approved_before_that_semester_opens(): void
    {
        Sanctum::actingAs($this->admin);

        $id = $this->postJson('/api/events', ['title' => 'Freshman Welcome', 'start_time' => '2027-08-20 09:00:00', 'end_time' => '2027-08-20 12:00:00'], $this->inPeriod($this->upcoming))
            ->assertCreated()->json('id');
        $this->assertSame($this->upcoming->id, Event::findOrFail($id)->academic_semester_id);

        $approvalId = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $id)->value('id');
        Sanctum::actingAs($this->dean);
        $this->patchJson("/api/approval-requests/{$approvalId}", ['status' => 'approved'])->assertOk();

        $this->assertSame('approved', Event::findOrFail($id)->status);
    }

    public function test_an_event_from_a_closed_semester_still_cannot_be_approved(): void
    {
        Sanctum::actingAs($this->admin);
        $id = $this->postJson('/api/events', ['title' => 'Old Fair', 'start_time' => '2027-02-20 09:00:00', 'end_time' => '2027-02-20 12:00:00'])->assertCreated()->json('id');
        Event::whereKey($id)->update(['academic_semester_id' => $this->closed->id]);
        $approvalId = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $id)->value('id');

        Sanctum::actingAs($this->dean);
        $this->patchJson("/api/approval-requests/{$approvalId}", ['status' => 'approved'])
            ->assertStatus(409)->assertJsonPath('message', 'Historical semester event approvals are read only.');
    }

    public function test_a_new_election_is_refused_while_a_closed_year_is_selected(): void
    {
        Sanctum::actingAs($this->admin);

        $this->post('/api/elections', $this->electionPayload('2026-10-10'), $this->inPeriod($this->closed))
            ->assertStatus(409)->assertJsonPath('message', 'This school year is closed. Its records are read only.');
        $this->assertDatabaseMissing('elections', ['title' => 'Officer election']);
    }
}
