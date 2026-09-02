<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use App\Models\Vote;
use Database\Seeders\OrganizationSeeder;
use Database\Seeders\SboPositionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DepartmentHeadGapsTest extends TestCase
{
    use RefreshDatabase;

    private function student(int $organizationId): User
    {
        return User::factory()->create([
            'organization_id' => $organizationId,
            'role' => 'STUDENT',
            'account_status' => 'active',
        ]);
    }

    // --- Task 1: election voters endpoint ---

    public function test_voters_endpoint_is_paginated_organization_scoped_and_reports_a_turnout_summary(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER']);
        $election = Election::factory()->create(['organization_id' => $organization->id, 'status' => 'active']);

        // 25 eligible students in this org so pagination (per_page 20) is exercised.
        $students = User::factory()->count(25)->create([
            'organization_id' => $organization->id,
            'role' => 'STUDENT',
        ]);

        // A student in a different org must never appear.
        $otherOrganization = Organization::factory()->create();
        $this->student($otherOrganization->id);

        $position = ElectionPosition::factory()->create(['election_id' => $election->id]);
        $votedStudent = $students->first();
        $candidate = Candidate::factory()->create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'user_id' => $votedStudent->school_id,
        ]);
        Vote::create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'candidate_id' => $candidate->id,
            'voter_id' => $votedStudent->school_id,
            'vote_hash' => 'test-hash-1',
        ]);

        Sanctum::actingAs($officer);

        $page1 = $this->getJson("/api/elections/{$election->id}/voters")->assertOk();
        $page1->assertJsonPath('per_page', 20);
        $page1->assertJsonPath('total', 25);
        $page1->assertJsonCount(20, 'data');
        $page1->assertJsonPath('summary.eligible_total', 25);
        $page1->assertJsonPath('summary.voted_count', 1);
        $this->assertEquals(4.0, $page1->json('summary.turnout_percent'));

        $page2 = $this->getJson("/api/elections/{$election->id}/voters?page=2")->assertOk();
        $page2->assertJsonCount(5, 'data');

        // has_voted correctness is checked across both pages since the
        // alphabetical sort (last_name, first_name) can place either
        // fake()-generated student on either page.
        $allRows = collect($page1->json('data'))->merge($page2->json('data'));

        $votedRow = $allRows->firstWhere('school_id', $votedStudent->school_id);
        $this->assertNotNull($votedRow);
        $this->assertTrue($votedRow['has_voted']);

        $notVotedRow = $allRows->first(fn ($row) => $row['school_id'] !== $votedStudent->school_id);
        $this->assertNotNull($notVotedRow);
        $this->assertFalse($notVotedRow['has_voted']);

        $allSchoolIds = $allRows->pluck('school_id');
        $this->assertTrue($allSchoolIds->every(fn ($id) => $students->pluck('school_id')->contains($id)));
    }

    public function test_voters_endpoint_is_blocked_for_students(): void
    {
        $organization = Organization::factory()->create();
        $election = Election::factory()->create(['organization_id' => $organization->id]);
        $student = $this->student($organization->id);

        Sanctum::actingAs($student);

        $this->getJson("/api/elections/{$election->id}/voters")->assertForbidden();
    }

    // --- Task 2: announcement view counter ---

    public function test_announcement_view_increments_once_per_reader_not_per_request(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $reader = $this->student($organization->id);
        $otherStudent = $this->student($organization->id);

        $announcement = Announcement::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->school_id,
            'target_role' => 'all',
            'is_published' => true,
            'approval_status' => 'approved',
        ]);

        Sanctum::actingAs($reader);
        $this->postJson("/api/announcements/{$announcement->id}/view")
            ->assertOk()
            ->assertJsonPath('already_viewed', false);
        $this->postJson("/api/announcements/{$announcement->id}/view")
            ->assertOk()
            ->assertJsonPath('already_viewed', true);

        $this->assertDatabaseHas('announcements', ['id' => $announcement->id, 'views_count' => 1]);

        Sanctum::actingAs($otherStudent);
        $this->postJson("/api/announcements/{$announcement->id}/view")->assertOk();

        $this->assertDatabaseHas('announcements', ['id' => $announcement->id, 'views_count' => 2]);
        $this->assertDatabaseCount('announcement_views', 2);
    }

    public function test_announcement_view_is_blocked_on_a_published_but_unapproved_announcement(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $student = $this->student($organization->id);

        $announcement = Announcement::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->school_id,
            'target_role' => 'all',
            'is_published' => true,
            'approval_status' => 'draft',
        ]);

        Sanctum::actingAs($student);
        $studentIds = collect($this->getJson('/api/announcements')->assertOk()->json('data'))->pluck('id');
        $this->assertFalse($studentIds->contains($announcement->id));

        $this->postJson("/api/announcements/{$announcement->id}/view")->assertNotFound();
        $this->assertDatabaseHas('announcements', ['id' => $announcement->id, 'views_count' => 0]);
    }

    public function test_announcement_view_count_is_visible_to_officers_but_not_to_students(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $officer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER']);
        $student = $this->student($organization->id);

        $announcement = Announcement::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->school_id,
            'target_role' => 'all',
            'is_published' => true,
            'approval_status' => 'approved',
            'views_count' => 3,
        ]);

        Sanctum::actingAs($student);
        $studentRow = collect($this->getJson('/api/announcements')->assertOk()->json('data'))
            ->firstWhere('id', $announcement->id);
        $this->assertArrayNotHasKey('views_count', $studentRow);

        Sanctum::actingAs($officer);
        $officerRow = collect($this->getJson('/api/announcements')->assertOk()->json('data'))
            ->firstWhere('id', $announcement->id);
        $this->assertSame(3, $officerRow['views_count']);
    }

    // --- Task 4: sbo_positions seeder ---

    public function test_sbo_position_seeder_populates_the_conventional_exec_board_per_organization(): void
    {
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();

        $this->seed(SboPositionSeeder::class);

        $expected = [
            'President', 'Vice President', 'Secretary', 'Treasurer',
            'Auditor', 'Public Relations Officer', 'Business Manager', 'Adviser',
        ];

        foreach ([$orgA, $orgB] as $organization) {
            $titles = SboPosition::where('organization_id', $organization->id)->pluck('title')->sort()->values();
            $this->assertSame(collect($expected)->sort()->values()->all(), $titles->all());
            $this->assertTrue(SboPosition::where('organization_id', $organization->id)->where('title', 'Adviser')->where('is_active', true)->exists());
        }
    }

    public function test_sbo_position_seeder_produces_rows_when_run_in_the_fresh_install_seeder_order(): void
    {
        $this->seed(OrganizationSeeder::class);
        $this->seed(SboPositionSeeder::class);

        $this->assertGreaterThan(0, SboPosition::count());
    }

    // --- Task 6: DEPARTMENT_HEAD announcement targeting ---

    public function test_department_head_sees_department_head_targeted_announcement_and_a_student_does_not(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $departmentHead = User::factory()->create(['organization_id' => $organization->id, 'role' => 'DEPARTMENT_HEAD']);
        $student = $this->student($organization->id);

        $announcement = Announcement::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->school_id,
            'target_role' => 'DEPARTMENT_HEAD',
            'is_published' => true,
            'approval_status' => 'approved',
        ]);

        Sanctum::actingAs($departmentHead);
        $this->getJson('/api/announcements')
            ->assertOk()
            ->assertJsonFragment(['id' => $announcement->id]);

        Sanctum::actingAs($student);
        $studentIds = collect($this->getJson('/api/announcements')->assertOk()->json('data'))->pluck('id');
        $this->assertFalse($studentIds->contains($announcement->id));
    }

    public function test_department_head_can_be_selected_as_an_announcement_target_role_on_create(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);

        Sanctum::actingAs($admin);

        $this->postJson('/api/announcements', [
            'title' => 'Department Head Sync',
            'body' => 'Quarterly review agenda.',
            'target_role' => 'DEPARTMENT_HEAD',
            'is_published' => true,
        ])->assertCreated()->assertJsonPath('target_role', 'DEPARTMENT_HEAD');
    }
}
