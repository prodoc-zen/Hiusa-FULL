<?php

namespace Tests\Feature;

use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * The picker behind "Add member" on a party list: a voting member of the election's organization finds teammates by
 * name or school ID, and sees nothing beyond what the picker shows.
 */
class ElectionEligibleMembersTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $student;

    private Election $election;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);

        $college = $this->makeCollege('CBE');
        $this->makeCollegeHome($college);
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->student = $this->member(['first_name' => 'Rep', 'last_name' => 'Resentante']);
        $this->election = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'upcoming',
            'phase' => 'filing',
            'approved_at' => now()->subDay(),
            'filing_starts_at' => now()->subDay(),
            'filing_ends_at' => now()->addDay(),
            'screening_starts_at' => now()->addDay(),
            'screening_ends_at' => now()->addDays(2),
            'campaign_starts_at' => now()->addDays(2),
            'campaign_ends_at' => now()->addDays(3),
            'start_time' => now()->addDays(3),
            'end_time' => now()->addDays(4),
            'results_publish_at' => now()->addDays(5),
        ]);
    }

    private function member(array $attributes = [], string $role = 'student'): User
    {
        return User::factory()->{$role}()->create(['organization_id' => $this->organization->id, 'year_level' => '2nd Year', 'program' => 'BSIT', ...$attributes]);
    }

    private function search(string $q, ?User $as = null, ?Election $election = null)
    {
        Sanctum::actingAs($as ?? $this->student);

        return $this->getJson('/api/elections/'.($election ?? $this->election)->id.'/eligible-members?q='.urlencode($q));
    }

    public function test_an_eligible_student_finds_teammates_by_first_name_last_name_or_school_id_with_only_the_picker_fields(): void
    {
        $this->member(['first_name' => 'Anabel', 'last_name' => 'Zamora', 'school_id' => 20260111]);

        $expected = [['id' => 20260111, 'school_id' => 20260111, 'first_name' => 'Anabel', 'last_name' => 'Zamora', 'program' => 'BSIT', 'year_level' => '2nd Year']];

        $this->search('anab')->assertOk()->assertExactJson(['members' => $expected]);
        $this->search('zamo')->assertOk()->assertExactJson(['members' => $expected]);
        $this->search('20260111')->assertOk()->assertExactJson(['members' => $expected]);
        $this->search('Anabel Zamora')->assertOk()->assertExactJson(['members' => $expected]);
    }

    public function test_the_answer_never_carries_an_email_a_phone_number_or_a_birth_date(): void
    {
        $this->member(['first_name' => 'Anabel', 'last_name' => 'Zamora']);

        $row = $this->search('anab')->assertOk()->json('members.0');

        $this->assertSame(['first_name', 'id', 'last_name', 'program', 'school_id', 'year_level'], collect(array_keys($row))->sort()->values()->all());
    }

    public function test_at_most_ten_matches_come_back(): void
    {
        foreach (range(1, 12) as $number) {
            $this->member(['first_name' => 'Pat'.$number, 'last_name' => 'Cruz']);
        }

        $this->assertCount(10, $this->search('Pat')->assertOk()->json('members'));
    }

    public function test_a_search_shorter_than_two_characters_returns_nothing(): void
    {
        $this->member(['first_name' => 'Anabel']);

        $this->search('a')->assertOk()->assertExactJson(['members' => []]);
        $this->search('')->assertOk()->assertExactJson(['members' => []]);
    }

    public function test_a_student_who_does_not_vote_in_the_organization_is_refused(): void
    {
        $outsider = User::factory()->student()->create(['organization_id' => $this->makeCollegeStudentOrganization($this->makeCollege('CAS'))->id]);

        $this->search('Rep', $outsider)->assertForbidden();
    }

    public function test_the_faculty_adviser_who_does_not_vote_is_refused(): void
    {
        $this->search('Rep', $this->member([], 'adviser'))->assertForbidden();
    }

    public function test_members_of_another_organization_are_never_returned(): void
    {
        $other = $this->makeCollegeStudentOrganization($this->makeCollege('CAS'));
        User::factory()->student()->create(['organization_id' => $other->id, 'first_name' => 'Anabel', 'last_name' => 'Elsewhere']);
        $this->member(['first_name' => 'Anabel', 'last_name' => 'Local']);

        $this->assertSame(['Local'], collect($this->search('Anabel')->assertOk()->json('members'))->pluck('last_name')->all());
    }

    public function test_the_faculty_adviser_is_never_offered(): void
    {
        $this->member(['first_name' => 'Anabel', 'last_name' => 'Adviser'], 'adviser');

        $this->search('Anabel')->assertOk()->assertExactJson(['members' => []]);
    }

    public function test_someone_with_an_application_in_this_election_is_not_offered_but_a_withdrawn_one_is(): void
    {
        $position = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'Senator', 'max_winners' => 2]);
        $filed = $this->member(['first_name' => 'Anabel', 'last_name' => 'Filed']);
        $withdrawn = $this->member(['first_name' => 'Anabel', 'last_name' => 'Withdrawn']);
        foreach ([[$filed, 'draft'], [$withdrawn, 'withdrawn']] as [$user, $status]) {
            ElectionApplication::create(['election_id' => $this->election->id, 'position_id' => $position->id, 'user_school_id' => $user->school_id, 'status' => $status, 'submitted_by' => $this->student->school_id]);
        }

        $this->assertSame(['Withdrawn'], collect($this->search('Anabel')->assertOk()->json('members'))->pluck('last_name')->all());
    }

    public function test_the_caller_is_offered_only_while_they_have_no_application_of_their_own(): void
    {
        $this->assertSame([$this->student->school_id], collect($this->search('Resentante')->assertOk()->json('members'))->pluck('school_id')->all());

        $position = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'Senator', 'max_winners' => 2]);
        ElectionApplication::create(['election_id' => $this->election->id, 'position_id' => $position->id, 'user_school_id' => $this->student->school_id, 'status' => 'draft', 'submitted_by' => $this->student->school_id]);

        $this->search('Resentante')->assertOk()->assertExactJson(['members' => []]);
    }

    public function test_an_election_without_a_filing_window_or_a_missing_one_is_not_found(): void
    {
        $plain = Election::factory()->create(['organization_id' => $this->organization->id, 'filing_starts_at' => null]);

        $this->search('Rep', null, $plain)->assertNotFound();
        Sanctum::actingAs($this->student);
        $this->getJson('/api/elections/999999/eligible-members?q=Rep')->assertNotFound();
    }

    public function test_the_route_is_throttled_like_the_other_read_routes(): void
    {
        $route = collect(\Illuminate\Support\Facades\Route::getRoutes()->getRoutes())->first(fn ($candidate) => $candidate->uri() === 'api/elections/{id}/eligible-members');

        $this->assertNotNull($route);
        $this->assertContains('throttle:api-read', $route->gatherMiddleware());
    }
}
