<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Election;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** An election that is still upcoming or open stops the SAO closing a semester, so the refusal must say which and who can end it. */
class SemesterCloseElectionsTest extends TestCase
{
    use RefreshDatabase;

    private User $director;

    private Organization $organization;

    private AcademicSemester $first;

    private AcademicSemester $second;

    protected function setUp(): void
    {
        parent::setUp();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $this->director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $this->organization = Organization::factory()->create(['name' => 'Cold Computing Society']);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $this->first = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $this->second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
    }

    private function upcomingElection(array $attributes = []): Election
    {
        return Election::factory()->create([
            'organization_id' => $this->organization->id, 'academic_semester_id' => $this->first->id, 'title' => '2026 Officer Election',
            'status' => 'upcoming', 'phase' => null, 'approved_at' => now()->subDay(), 'start_time' => now()->addDays(26), 'end_time' => now()->addDays(27),
            ...$attributes,
        ]);
    }

    private function closing(): array
    {
        return ['confirmation' => '1st semester, AY 2026-2027'];
    }

    public function test_the_refusal_to_close_names_each_election_with_its_organization_and_status(): void
    {
        $upcoming = $this->upcomingElection();
        $open = $this->upcomingElection(['title' => 'Batch Representative Election', 'status' => 'active']);
        Sanctum::actingAs($this->director);

        $response = $this->patchJson("/api/system/academic-semesters/{$this->first->id}/close", $this->closing())->assertUnprocessable();

        $response->assertJsonPath('errors.semester.0', fn ($message) => str_contains($message, '2026 Officer Election') && str_contains($message, 'Cold Computing Society'));
        $this->assertSame([
            ['id' => $upcoming->id, 'title' => '2026 Officer Election', 'status' => 'upcoming', 'organization_id' => $this->organization->id, 'organization_name' => 'Cold Computing Society'],
            ['id' => $open->id, 'title' => 'Batch Representative Election', 'status' => 'active', 'organization_id' => $this->organization->id, 'organization_name' => 'Cold Computing Society'],
        ], $response->json('elections'));
        $this->assertSame('active', $this->first->fresh()->status);
    }

    public function test_the_refusal_to_activate_the_next_semester_carries_the_same_list(): void
    {
        $upcoming = $this->upcomingElection();
        $this->travelTo('2027-01-02');
        Sanctum::actingAs($this->director);

        $this->patchJson("/api/system/academic-semesters/{$this->second->id}/active")
            ->assertUnprocessable()
            ->assertJsonPath('elections.0.id', $upcoming->id)
            ->assertJsonPath('elections.0.organization_name', 'Cold Computing Society');
    }

    public function test_a_refusal_for_another_reason_carries_no_election_list(): void
    {
        Sanctum::actingAs($this->director);

        $this->patchJson("/api/system/academic-semesters/{$this->first->id}/close", ['confirmation' => 'wrong'])
            ->assertUnprocessable()->assertJsonMissingPath('elections');
    }

    public function test_the_organization_admin_cancels_an_approved_upcoming_election_and_the_semester_then_closes(): void
    {
        $election = $this->upcomingElection();
        $admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($admin);

        $this->postJson("/api/elections/{$election->id}/cancel", ['reason' => 'The calendar was entered wrongly.'])->assertOk();

        Sanctum::actingAs($this->director);
        $this->patchJson("/api/system/academic-semesters/{$this->first->id}/close", $this->closing())->assertOk();
        $this->assertSame('completed', $this->first->fresh()->status);
    }
}
