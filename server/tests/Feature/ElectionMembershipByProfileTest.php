<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * A student joins an organization the way the application pipeline does it: the head gives them a student profile
 * there while their own account stays in the college. The ballot and the voter list must treat that profile as
 * membership, the same way the people directory the candidate picker reads from does.
 */
class ElectionMembershipByProfileTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private Organization $home;

    private User $admin;

    private Election $election;

    private ElectionPosition $position;

    protected function setUp(): void
    {
        parent::setUp();

        $college = $this->makeCollege('CBE');
        $this->home = $this->makeCollegeHome($college);
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->election = Election::factory()->create(['organization_id' => $this->organization->id, 'status' => 'upcoming', 'finalized_at' => null]);
        $this->position = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'President', 'max_winners' => 1]);
        Sanctum::actingAs($this->admin);
    }

    private function collegeStudent(?string $profileRole = 'STUDENT', string $profileStatus = 'active'): User
    {
        $student = User::factory()->student()->create(['organization_id' => $this->home->id]);
        if ($profileRole) {
            AccountProfile::create([
                'user_school_id' => $student->school_id,
                'organization_id' => $this->organization->id,
                'role' => $profileRole,
                'account_status' => $profileStatus,
            ]);
        }

        return $student;
    }

    public function test_a_student_added_through_a_profile_can_be_a_candidate(): void
    {
        $member = $this->collegeStudent();

        $this->postJson("/api/elections/{$this->election->id}/candidates", ['user_id' => $member->school_id, 'position_id' => $this->position->id])
            ->assertCreated();

        $this->assertDatabaseHas('candidates', ['election_id' => $this->election->id, 'user_id' => $member->school_id]);
    }

    public function test_a_student_of_the_college_with_no_profile_in_the_organization_is_refused(): void
    {
        $outsider = $this->collegeStudent(null);

        $this->postJson("/api/elections/{$this->election->id}/candidates", ['user_id' => $outsider->school_id, 'position_id' => $this->position->id])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Only students can be added as candidates.');

        $this->assertDatabaseCount('candidates', 0);
    }

    public function test_a_profile_that_is_no_longer_active_is_refused(): void
    {
        $former = $this->collegeStudent('STUDENT', 'inactive');

        $this->postJson("/api/elections/{$this->election->id}/candidates", ['user_id' => $former->school_id, 'position_id' => $this->position->id])
            ->assertUnprocessable();

        $this->assertDatabaseCount('candidates', 0);
    }

    public function test_a_disabled_account_with_an_active_profile_is_refused(): void
    {
        $disabled = $this->collegeStudent();
        $disabled->update(['account_status' => 'disabled']);

        $this->postJson("/api/elections/{$this->election->id}/candidates", ['user_id' => $disabled->school_id, 'position_id' => $this->position->id])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Only students can be added as candidates.');

        $this->assertDatabaseCount('candidates', 0);
    }

    public function test_an_officer_seat_holder_is_not_a_candidate(): void
    {
        $officer = $this->collegeStudent('SBO_OFFICER');

        $this->postJson("/api/elections/{$this->election->id}/candidates", ['user_id' => $officer->school_id, 'position_id' => $this->position->id])
            ->assertUnprocessable();

        $this->assertDatabaseCount('candidates', 0);
    }

    public function test_an_organization_student_whose_account_lives_there_is_still_accepted(): void
    {
        $native = User::factory()->student()->create(['organization_id' => $this->organization->id]);

        $this->postJson("/api/elections/{$this->election->id}/candidates", ['user_id' => $native->school_id, 'position_id' => $this->position->id])
            ->assertCreated();
    }

    public function test_a_candidate_can_be_changed_to_a_student_added_through_a_profile(): void
    {
        $native = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $member = $this->collegeStudent();
        $candidate = Candidate::factory()->create(['election_id' => $this->election->id, 'position_id' => $this->position->id, 'user_id' => $native->school_id]);

        $this->putJson("/api/elections/{$this->election->id}/candidates/{$candidate->id}", ['user_id' => $member->school_id])->assertOk();

        $this->assertSame($member->school_id, $candidate->fresh()->user_id);
    }

    public function test_the_voter_list_counts_profile_members_and_leaves_outsiders_out(): void
    {
        $member = $this->collegeStudent();
        $outsider = $this->collegeStudent(null);

        $response = $this->getJson("/api/elections/{$this->election->id}/voters")->assertOk();

        $ids = collect($response->json('data'))->pluck('school_id')->all();
        $this->assertContains($member->school_id, $ids);
        $this->assertContains($this->admin->school_id, $ids);
        $this->assertNotContains($outsider->school_id, $ids);
        $this->assertSame(2, $response->json('summary.eligible_total'));
        $this->assertSame('STUDENT', collect($response->json('data'))->firstWhere('school_id', $member->school_id)['role']);
    }
}
