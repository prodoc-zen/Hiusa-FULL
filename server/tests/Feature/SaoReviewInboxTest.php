<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** An application the Department Head endorsed is the SAO's to decide, so every SAO count and next step must say so. */
class SaoReviewInboxTest extends TestCase
{
    use RefreshDatabase;

    private User $sao;

    private College $college;

    protected function setUp(): void
    {
        parent::setUp();
        $home = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $this->sao = User::factory()->superAdmin()->create(['organization_id' => $home->id]);
        $this->college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        Organization::factory()->create(['college' => $this->college->name, 'college_id' => $this->college->id, 'organization_type' => 'COLLEGE']);
    }

    private function application(string $status, int $schoolId): OrganizationApplication
    {
        return OrganizationApplication::create([
            'college_id' => $this->college->id, 'name' => 'Chess Club '.$schoolId, 'acronym' => 'CC'.$schoolId, 'school_id' => $schoolId,
            'first_name' => 'Ana', 'last_name' => 'Reyes', 'email' => "applicant{$schoolId}@example.test", 'position_title' => 'President',
            'status' => $status, 'round' => 1, 'submitted_at' => now()->subDays(2), 'endorsed_at' => $status === 'pending_sao' ? now()->subDay() : null,
        ]);
    }

    public function test_an_endorsed_application_appears_in_the_sao_review_inbox_and_the_headline(): void
    {
        $this->application('pending_sao', 2600101);
        $this->application('pending_sao', 2600102);
        $this->application('pending_dean', 2600103);
        Sanctum::actingAs($this->sao);

        $response = $this->getJson('/api/dashboard/briefing')->assertOk();
        $item = collect($response->json('attention'))->firstWhere('type', 'applications_pending');

        $this->assertNotNull($item);
        $this->assertSame(2, $item['count']);
        $this->assertSame('/dashboard/organization-applications', $item['href']);
        $this->assertStringContainsString('2 application(s)', $item['detail']);
        $this->assertStringContainsString('two applications awaiting your decision', strtolower($response->json('summary.headline')));
    }

    public function test_applications_still_with_the_dean_or_already_decided_are_not_the_saos_to_review(): void
    {
        $this->application('pending_dean', 2600111);
        $this->application('approved', 2600112);
        $this->application('returned', 2600113);
        Sanctum::actingAs($this->sao);

        $types = collect($this->getJson('/api/dashboard/briefing')->assertOk()->json('attention'))->pluck('type')->all();

        $this->assertNotContains('applications_pending', $types);
    }

    /** Every earlier step is done, so "organizations active" is the one the SAO is on. */
    private function collegeReadyForOrganizations(): void
    {
        User::factory()->departmentHead()->create(['organization_id' => Organization::where('college_id', $this->college->id)->value('id')]);
        StudentRegistryEntry::create([
            'school_id' => 2600100, 'first_name' => 'Ana', 'last_name' => 'Reyes', 'birth_date' => '2005-01-01',
            'college_id' => $this->college->id, 'program' => 'BSIT', 'year_level' => '1st Year',
        ]);
    }

    public function test_the_saos_next_step_is_the_endorsed_application_not_the_organizations_list(): void
    {
        $this->collegeReadyForOrganizations();
        $this->application('pending_sao', 2600121);
        Sanctum::actingAs($this->sao);

        $payload = $this->getJson('/api/process/status')->assertOk()->json();
        $aggregate = collect($payload['steps'])->keyBy('key')['organizations-active'];
        $row = collect($payload['colleges'])->firstWhere('name', 'College of Computing');
        $own = collect($row['steps'])->keyBy('key')['organizations-active'];

        $this->assertSame('/dashboard/organization-applications', $aggregate['action']['path']);
        $this->assertSame('Review applications', $aggregate['action']['label']);
        $this->assertSame('1 application is waiting for your decision.', $aggregate['note']);
        $this->assertSame('/dashboard/organization-applications', $own['action']['path']);
    }

    public function test_the_saos_next_step_stays_on_the_organizations_list_while_no_application_waits_for_the_sao(): void
    {
        $this->collegeReadyForOrganizations();
        $this->application('pending_dean', 2600131);
        Sanctum::actingAs($this->sao);

        $payload = $this->getJson('/api/process/status')->assertOk()->json();
        $aggregate = collect($payload['steps'])->keyBy('key')['organizations-active'];

        $this->assertSame('/dashboard/super-admin/organizations', $aggregate['action']['path']);
        $this->assertArrayNotHasKey('note', $aggregate);
    }
}
