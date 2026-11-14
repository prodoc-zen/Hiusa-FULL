<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** An application waiting at pending_dean is the dean's to endorse, so the dean's home must not say nothing needs them. */
class DeanApplicationBriefingTest extends TestCase
{
    use RefreshDatabase;

    private User $dean;

    private College $college;

    private College $otherCollege;

    protected function setUp(): void
    {
        parent::setUp();
        $this->college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $this->otherCollege = College::create(['name' => 'College of Arts', 'is_active' => true]);
        $home = Organization::factory()->create(['college' => $this->college->name, 'college_id' => $this->college->id, 'organization_type' => 'COLLEGE']);
        Organization::factory()->create(['college' => $this->otherCollege->name, 'college_id' => $this->otherCollege->id, 'organization_type' => 'COLLEGE']);
        $this->dean = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
    }

    private function application(College $college, string $status, int $schoolId): OrganizationApplication
    {
        return OrganizationApplication::create([
            'college_id' => $college->id, 'name' => 'Chess Club '.$schoolId, 'acronym' => 'CC'.$schoolId, 'school_id' => $schoolId,
            'first_name' => 'Ana', 'last_name' => 'Reyes', 'email' => "applicant{$schoolId}@example.test", 'position_title' => 'President',
            'status' => $status, 'round' => 1, 'submitted_at' => now()->subDays(2), 'endorsed_at' => $status === 'pending_sao' ? now()->subDay() : null,
        ]);
    }

    public function test_an_application_waiting_for_the_dean_shows_in_attention_and_the_headline(): void
    {
        $this->application($this->college, 'pending_dean', 2600201);
        $this->application($this->college, 'pending_dean', 2600202);
        Sanctum::actingAs($this->dean);

        $response = $this->getJson('/api/dashboard/briefing')->assertOk();
        $item = collect($response->json('attention'))->firstWhere('type', 'applications_endorsement_pending');

        $this->assertNotNull($item);
        $this->assertSame(2, $item['count']);
        $this->assertSame('/dashboard/organization-applications', $item['href']);
        $this->assertSame(1, $response->json('summary.attention_count'));
        $this->assertStringContainsString('two applications awaiting your endorsement', strtolower($response->json('summary.headline')));
        $this->assertStringNotContainsString('all caught up', strtolower($response->json('summary.headline')));
    }

    public function test_a_single_application_is_named_in_the_singular(): void
    {
        $this->application($this->college, 'pending_dean', 2600203);
        Sanctum::actingAs($this->dean);

        $headline = $this->getJson('/api/dashboard/briefing')->assertOk()->json('summary.headline');

        $this->assertStringContainsString('one application awaiting your endorsement', strtolower($headline));
    }

    public function test_applications_of_another_college_or_at_another_stage_are_not_the_deans_to_endorse(): void
    {
        $this->application($this->otherCollege, 'pending_dean', 2600211);
        $this->application($this->college, 'pending_sao', 2600212);
        $this->application($this->college, 'approved', 2600213);
        $this->application($this->college, 'returned', 2600214);
        Sanctum::actingAs($this->dean);

        $response = $this->getJson('/api/dashboard/briefing')->assertOk();

        $this->assertSame([], collect($response->json('attention'))->pluck('type')->all());
        $this->assertSame("You're all caught up.", $response->json('summary.headline'));
    }

    public function test_a_dean_without_a_college_home_organization_is_shown_none(): void
    {
        $this->application($this->college, 'pending_dean', 2600221);
        $stray = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION']);
        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => $stray->id]));

        $types = collect($this->getJson('/api/dashboard/briefing')->assertOk()->json('attention'))->pluck('type')->all();

        $this->assertNotContains('applications_endorsement_pending', $types);
    }
}
