<?php

namespace Tests\Feature;

use App\Models\AcademicProgram;
use App\Models\AccountProfile;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * The voter roll is the set of profiles that existed when the ballot was finalized, and a member an organization head
 * adds must be someone the college registry knows, so a head cannot mint voters for their own election.
 */
class VoterRollFreezeTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private const JOINED_LATE = 'You joined after the voter list was finalized, so you cannot vote in this election.';

    private Organization $organization;

    private User $admin;

    private Election $election;

    private ElectionPosition $position;

    private Candidate $candidate;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);

        $college = $this->makeCollege('CBE');
        $this->makeCollegeHome($college);
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        AcademicProgram::create(['organization_id' => $this->organization->id, 'name' => 'BSIT', 'duration_years' => 4]);
        $this->election = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'active',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
            'approved_at' => now()->subDays(2),
            'finalized_at' => now()->subDay(),
        ]);
        $this->position = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'President', 'max_winners' => 1]);
        $nominee = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->candidate = Candidate::create(['election_id' => $this->election->id, 'position_id' => $this->position->id, 'user_id' => $nominee->school_id]);
    }

    private function member(bool $beforeFinalization): User
    {
        $member = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $profile = AccountProfile::where('user_school_id', $member->school_id)->where('organization_id', $this->organization->id)->firstOrFail();
        $profile->forceFill(['created_at' => $beforeFinalization ? now()->subDays(3) : now()])->save();

        return $member;
    }

    private function ballot(): array
    {
        return ['votes' => [['position_id' => $this->position->id, 'candidate_id' => $this->candidate->id]]];
    }

    private function registry(int $schoolId): void
    {
        StudentRegistryEntry::create([
            'school_id' => $schoolId, 'first_name' => 'Reg', 'last_name' => 'Istered', 'birth_date' => '2005-01-02',
            'college_id' => $this->organization->college_id, 'program' => 'BSIT', 'year_level' => '1st Year',
        ]);
    }

    private function newStudent(int $schoolId): array
    {
        return [
            'school_id' => $schoolId, 'first_name' => 'Ana', 'last_name' => 'Reyes', 'email' => "s{$schoolId}@example.com",
            'role' => 'STUDENT', 'program' => 'BSIT', 'year_level' => '1st Year',
            'password' => 'Str0ng!Pass1', 'password_confirmation' => 'Str0ng!Pass1',
        ];
    }

    public function test_a_member_who_joined_after_the_ballot_was_finalized_cannot_vote(): void
    {
        $late = $this->member(false);
        Sanctum::actingAs($late);

        $this->postJson("/api/elections/{$this->election->id}/vote", $this->ballot())
            ->assertForbidden()
            ->assertJsonPath('message', self::JOINED_LATE);
        $this->assertDatabaseCount('votes', 0);
    }

    public function test_the_ballot_read_refuses_a_member_who_joined_after_the_ballot_was_finalized_with_the_vote_message(): void
    {
        Sanctum::actingAs($this->member(false));

        $this->getJson("/api/elections/{$this->election->id}")
            ->assertOk()
            ->assertJsonPath('ballot_refusal', self::JOINED_LATE);
    }

    public function test_the_ballot_read_has_no_refusal_for_a_member_on_the_roll(): void
    {
        Sanctum::actingAs($this->member(true));

        $this->getJson("/api/elections/{$this->election->id}")
            ->assertOk()
            ->assertJsonPath('ballot_refusal', null);
    }

    public function test_the_elections_list_counts_ballots_as_distinct_voters_not_selections(): void
    {
        $second = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'Treasurer', 'max_winners' => 1]);
        $secondCandidate = Candidate::create(['election_id' => $this->election->id, 'position_id' => $second->id, 'user_id' => User::factory()->student()->create(['organization_id' => $this->organization->id])->school_id]);
        $early = $this->member(true);
        Sanctum::actingAs($early);
        $this->postJson("/api/elections/{$this->election->id}/vote", ['votes' => [
            ['position_id' => $this->position->id, 'candidate_id' => $this->candidate->id],
            ['position_id' => $second->id, 'candidate_id' => $secondCandidate->id],
        ]])->assertOk();
        Sanctum::actingAs($this->admin);

        $row = collect($this->getJson('/api/elections')->assertOk()->json())->firstWhere('id', $this->election->id);

        $this->assertSame(2, $row['votes_count']);
        $this->assertSame(1, $row['voters_count']);
        $this->getJson("/api/elections/{$this->election->id}")->assertJsonPath('voters_count', 1);
    }

    public function test_a_member_on_the_roll_when_the_ballot_was_finalized_still_votes(): void
    {
        $early = $this->member(true);
        Sanctum::actingAs($early);

        $this->postJson("/api/elections/{$this->election->id}/vote", $this->ballot())->assertOk()->assertJsonPath('success', true);
        $this->assertDatabaseHas('votes', ['election_id' => $this->election->id, 'voter_id' => $early->school_id]);
    }

    public function test_the_voter_list_and_turnout_leave_out_members_who_joined_after_finalization(): void
    {
        $early = $this->member(true);
        $late = $this->member(false);
        Sanctum::actingAs($this->admin);

        $response = $this->getJson("/api/elections/{$this->election->id}/voters")->assertOk();

        $this->assertSame([$early->school_id], collect($response->json('data'))->pluck('school_id')->all());
        $this->assertSame(1, $response->json('summary.eligible_total'));
        $this->assertNotContains($late->school_id, collect($response->json('data'))->pluck('school_id')->all());
    }

    public function test_a_head_cannot_add_a_student_the_registry_does_not_know_once_the_college_has_a_registry(): void
    {
        $this->registry(20260001);
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/users', $this->newStudent(20269999))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['school_id' => 'This school ID is not in the student registry of your college. Ask your dean or the SAO to add the student there first.']);
        $this->assertDatabaseMissing('users', ['school_id' => 20269999]);

        $this->postJson('/api/users', $this->newStudent(20260001))->assertCreated();
    }

    public function test_a_college_without_a_loaded_registry_can_still_add_members(): void
    {
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/users', $this->newStudent(20269999))->assertCreated();
    }

    public function test_the_import_refuses_a_student_the_registry_does_not_know(): void
    {
        $this->registry(20260001);
        Sanctum::actingAs($this->admin);
        $csv = "school_id,first_name,last_name,email,role,program\n"
            ."20260001,Ana,Reyes,ana@example.com,Student,BSIT\n"
            ."20269999,Ben,Cruz,ben@example.com,Student,BSIT\n";

        $response = $this->post('/api/users/import', ['file' => UploadedFile::fake()->createWithContent('roster.csv', $csv), 'dry_run' => '1'], ['Accept' => 'application/json'])->assertOk();

        $rows = collect($response->json('rows'))->keyBy('row');
        $this->assertSame('ready', $rows[2]['status']);
        $this->assertSame('error', $rows[3]['status']);
        $this->assertStringContainsString('registry', strtolower(implode(' ', $rows[3]['errors'])));
    }
}
