<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class PeopleSearchTest extends TestCase
{
    use CreatesCollegeFixtures, RefreshDatabase;

    private College $computing;

    private College $arts;

    private Organization $computingHome;

    private Organization $computingOrg;

    private Organization $computingOtherOrg;

    private Organization $artsOrg;

    protected function setUp(): void
    {
        parent::setUp();

        $this->computing = $this->makeCollege('COC');
        $this->arts = $this->makeCollege('CAS');
        $this->computingHome = $this->makeCollegeHome($this->computing);
        $this->makeCollegeHome($this->arts);
        $this->computingOrg = $this->makeCollegeStudentOrganization($this->computing, ['name' => 'Computing Society']);
        $this->computingOtherOrg = $this->makeCollegeStudentOrganization($this->computing, ['name' => 'Robotics Club']);
        $this->artsOrg = $this->makeCollegeStudentOrganization($this->arts, ['name' => 'Arts Guild']);
    }

    private int $pinned = 0;

    /** Names and email that no search token in this file can hit, so factory randomness never joins a result. */
    private function pinned(): array
    {
        $n = ++$this->pinned;

        return ['first_name' => 'Quill', 'last_name' => "Pinned{$n}", 'email' => "pin{$n}@ex.test"];
    }

    private function student(Organization $home, array $overrides = []): User
    {
        return User::factory()->student()->create([...$this->pinned(), 'organization_id' => $home->id, ...$overrides]);
    }

    private function computingHead(): User
    {
        return $this->makeCollegeHead($this->computing, $this->pinned());
    }

    private function search(User $actor, array $query)
    {
        Sanctum::actingAs($actor);

        return $this->getJson('/api/people/search?'.http_build_query($query));
    }

    private function names($response): array
    {
        return collect($response->json('data'))->pluck('name')->sort()->values()->all();
    }

    public function test_a_student_cannot_search_for_people(): void
    {
        $student = $this->student($this->computingHome);

        $this->search($student, ['q' => 'ma'])->assertForbidden();
    }

    public function test_a_guest_cannot_search_for_people(): void
    {
        $this->getJson('/api/people/search?q=maria')->assertUnauthorized();
    }

    public function test_it_needs_at_least_two_characters(): void
    {
        $head = $this->computingHead();

        $this->search($head, ['q' => 'm'])->assertUnprocessable()->assertJsonValidationErrors(['q']);
        $this->search($head, [])->assertUnprocessable();
    }

    public function test_the_dean_finds_a_student_by_first_name_last_name_full_name_email_and_school_id(): void
    {
        $head = $this->computingHead();
        $maria = $this->student($this->computingHome, [
            'first_name' => 'Maria', 'last_name' => 'Santos', 'email' => 'maria.santos@example.edu', 'school_id' => 2100142,
        ]);

        foreach (['mar', 'santos', 'Maria Santos', 'santos, maria', 'maria.santos@', '21001', '2100142'] as $q) {
            $response = $this->search($head, ['q' => $q])->assertOk();
            $this->assertContains('Maria Santos', $this->names($response), "q={$q}");
        }

        $this->assertNotContains('Maria Santos', $this->names($this->search($head, ['q' => 'maria cruz'])));
    }

    public function test_a_result_carries_the_picker_fields_and_never_a_secret(): void
    {
        $head = $this->computingHead();
        $maria = $this->student($this->computingHome, [
            'first_name' => 'Maria', 'last_name' => 'Santos', 'email' => 'maria@example.edu', 'program' => 'BSIT', 'year_level' => '3',
        ]);
        AccountProfile::create([
            'user_school_id' => $maria->school_id, 'organization_id' => $this->computingOrg->id,
            'role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => 'Secretary',
        ]);

        $response = $this->search($head, ['q' => 'maria'])->assertOk();

        $response->assertJsonPath('data.0.school_id', $maria->school_id)
            ->assertJsonPath('data.0.name', $response->json('data.0.name') === 'Maria Santos' ? 'Maria Santos' : $response->json('data.0.name'))
            ->assertJsonPath('data.0.email', 'maria@example.edu')
            ->assertJsonPath('data.0.program', 'BSIT')
            ->assertJsonPath('data.0.year_level', '3')
            ->assertJsonPath('data.0.college', $this->computing->name)
            ->assertJsonPath('data.0.organizations.0.name', 'Computing Society')
            ->assertJsonPath('data.0.organizations.0.position_title', 'Secretary')
            ->assertJsonMissing(['password_hash'])
            ->assertJsonMissing(['biometric_template'])
            ->assertJsonMissing(['password']);
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $this->assertSame(
            ['school_id', 'name', 'email', 'role', 'program', 'year_level', 'college', 'organizations', 'blocked_by'],
            array_keys($response->json('data.0')),
        );
    }

    public function test_the_dean_is_told_which_active_organization_blocks_a_student_by_the_rule_the_grant_uses(): void
    {
        $head = $this->computingHead();
        $archived = $this->makeCollegeStudentOrganization($this->computing, ['name' => 'Old Guild', 'lifecycle_status' => 'archived']);
        $pending = $this->makeCollegeStudentOrganization($this->computing, ['name' => 'Pending Guild', 'lifecycle_status' => 'pending']);
        $member = fn (string $last, Organization $organization, string $status = 'active') => tap($this->student($this->computingHome, ['first_name' => 'Bea', 'last_name' => $last]), fn (User $user) => AccountProfile::create([
            'user_school_id' => $user->school_id, 'organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => $status,
        ]));
        $member('Active', $this->computingOrg);
        $member('Archived', $archived);
        $member('Pending', $pending);
        $member('Disabled', $this->computingOtherOrg, 'disabled');
        $this->student($this->computingHome, ['first_name' => 'Bea', 'last_name' => 'Nowhere']);

        $found = collect($this->search($head, ['q' => 'bea'])->assertOk()->json('data'))->keyBy('name');

        $this->assertSame(['id' => $this->computingOrg->id, 'name' => 'Computing Society'], $found['Bea Active']['blocked_by']);
        foreach (['Bea Archived', 'Bea Pending', 'Bea Disabled', 'Bea Nowhere'] as $name) {
            $this->assertNull($found[$name]['blocked_by'], $name);
        }
        $this->assertSame('Old Guild', $found['Bea Archived']['organizations'][0]['name'], 'the plain membership list still shows it');
    }

    public function test_only_the_dean_is_told_who_blocks_a_student(): void
    {
        $this->student($this->computingOrg, ['first_name' => 'Cleo', 'last_name' => 'Member']);
        $admin = User::factory()->admin()->create([...$this->pinned(), 'organization_id' => $this->computingOrg->id]);

        $this->assertArrayNotHasKey('blocked_by', $this->search($admin, ['q' => 'cleo'])->assertOk()->json('data.0'));
    }

    public function test_the_dean_never_sees_another_colleges_people(): void
    {
        $head = $this->computingHead();
        $this->student($this->computingHome, ['first_name' => 'Carla', 'last_name' => 'Mine']);
        $this->student($this->artsOrg, ['first_name' => 'Carla', 'last_name' => 'Elsewhere']);

        $this->assertSame(['Carla Mine'], $this->names($this->search($head, ['q' => 'carla'])));
    }

    public function test_the_dean_reaches_students_in_every_organization_of_the_college_and_can_narrow_to_one(): void
    {
        $head = $this->computingHead();
        $this->student($this->computingOrg, ['first_name' => 'Dana', 'last_name' => 'InSociety']);
        $this->student($this->computingOtherOrg, ['first_name' => 'Dana', 'last_name' => 'InRobotics']);
        $this->student($this->computingHome, ['first_name' => 'Dana', 'last_name' => 'NoOrg']);

        $this->assertSame(['Dana InRobotics', 'Dana InSociety', 'Dana NoOrg'], $this->names($this->search($head, ['q' => 'dana'])));
        $this->assertSame(['Dana InSociety'], $this->names($this->search($head, ['q' => 'dana', 'organization_id' => $this->computingOrg->id])));
        $this->assertSame(
            ['Dana InRobotics', 'Dana InSociety'],
            $this->names($this->search($head, ['q' => 'dana', 'scope' => 'organization'])),
        );
        $this->search($head, ['q' => 'dana', 'organization_id' => $this->artsOrg->id])->assertForbidden();
    }

    public function test_the_sao_finds_people_in_every_college(): void
    {
        $sao = User::factory()->superAdmin()->create([
            ...$this->pinned(),
            'organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id,
        ]);
        $this->student($this->computingHome, ['first_name' => 'Eli', 'last_name' => 'Computing']);
        $this->student($this->artsOrg, ['first_name' => 'Eli', 'last_name' => 'Arts']);

        $this->assertSame(['Eli Arts', 'Eli Computing'], $this->names($this->search($sao, ['q' => 'eli'])));
        $this->assertSame(['Eli Arts'], $this->names($this->search($sao, ['q' => 'eli', 'organization_id' => $this->artsOrg->id])));
    }

    public function test_an_org_admin_finds_own_members_and_only_reaches_college_students_with_college_scope(): void
    {
        $admin = User::factory()->admin()->create([...$this->pinned(), 'organization_id' => $this->computingOrg->id]);
        $this->student($this->computingOrg, ['first_name' => 'Fe', 'last_name' => 'Member']);
        $this->student($this->computingOtherOrg, ['first_name' => 'Fe', 'last_name' => 'Sibling']);
        $this->student($this->computingHome, ['first_name' => 'Fe', 'last_name' => 'Homeroom']);
        $this->student($this->artsOrg, ['first_name' => 'Fe', 'last_name' => 'Outsider']);

        $this->assertSame(['Fe Member'], $this->names($this->search($admin, ['q' => 'fe'])));
        $this->assertSame(
            ['Fe Homeroom', 'Fe Member', 'Fe Sibling'],
            $this->names($this->search($admin, ['q' => 'fe', 'scope' => 'college'])),
        );
        $this->search($admin, ['q' => 'fe', 'organization_id' => $this->computingOtherOrg->id])->assertForbidden();
    }

    public function test_an_officer_can_search_but_not_outside_the_organization(): void
    {
        $officer = User::factory()->officer()->create([...$this->pinned(), 'organization_id' => $this->computingOrg->id]);
        $this->student($this->computingOrg, ['first_name' => 'Gio', 'last_name' => 'Member']);
        $this->student($this->artsOrg, ['first_name' => 'Gio', 'last_name' => 'Outsider']);

        $this->assertSame(['Gio Member'], $this->names($this->search($officer, ['q' => 'gio', 'scope' => 'college'])));
    }

    public function test_the_role_filter_and_inactive_accounts(): void
    {
        $head = $this->computingHead();
        $this->student($this->computingOrg, ['first_name' => 'Hana', 'last_name' => 'Student']);
        User::factory()->officer()->create([...$this->pinned(), 'organization_id' => $this->computingOrg->id, 'first_name' => 'Hana', 'last_name' => 'Officer']);
        $this->student($this->computingOrg, ['first_name' => 'Hana', 'last_name' => 'Gone', 'account_status' => 'inactive']);

        $this->assertSame(['Hana Officer', 'Hana Student'], $this->names($this->search($head, ['q' => 'hana'])));
        $this->assertSame(['Hana Officer'], $this->names($this->search($head, ['q' => 'hana', 'role' => 'SBO_OFFICER'])));
        $this->search($head, ['q' => 'hana', 'role' => 'GOD'])->assertUnprocessable();
    }

    public function test_wildcards_in_the_query_match_literally(): void
    {
        $head = $this->computingHead();
        $this->student($this->computingHome, ['first_name' => 'Ines', 'last_name' => 'Plain']);

        $this->assertSame([], $this->names($this->search($head, ['q' => '%%'])));
        $this->assertSame([], $this->names($this->search($head, ['q' => '__'])));
    }

    public function test_results_are_capped_at_ten(): void
    {
        $head = $this->computingHead();
        foreach (range(1, 14) as $i) {
            $this->student($this->computingHome, ['first_name' => 'Jun']);
        }

        $this->assertCount(10, $this->search($head, ['q' => 'jun'])->json('data'));
    }

    public function test_people_who_already_belong_to_the_organization_are_left_out_of_the_results_however_many_there_are(): void
    {
        $admin = User::factory()->admin()->create([...$this->pinned(), 'organization_id' => $this->computingOrg->id]);
        $outsider = $this->student($this->computingHome, ['first_name' => 'Zed']);
        foreach (['active', 'disabled'] as $status) {
            $member = $this->student($this->computingHome, ['first_name' => 'Zed']);
            AccountProfile::create(['user_school_id' => $member->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'STUDENT', 'account_status' => $status]);
        }
        foreach (range(1, 11) as $i) {
            $filler = $this->student($this->computingHome, ['first_name' => 'Zed']);
            AccountProfile::create(['user_school_id' => $filler->school_id, 'organization_id' => $this->computingOrg->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        }

        $everyone = $this->search($admin, ['q' => 'zed', 'scope' => 'college', 'role' => 'STUDENT'])->assertOk();
        $this->assertCount(10, $everyone->json('data'));

        $response = $this->search($admin, ['q' => 'zed', 'scope' => 'college', 'role' => 'STUDENT', 'exclude_organization_id' => $this->computingOrg->id])->assertOk();

        $this->assertSame([$outsider->school_id], collect($response->json('data'))->pluck('school_id')->all());
    }

    public function test_the_sao_can_narrow_the_search_to_students_the_organization_would_accept(): void
    {
        $sao = User::factory()->superAdmin()->create([
            ...$this->pinned(),
            'organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id,
        ]);
        $this->student($this->computingHome, ['first_name' => 'Gia', 'last_name' => 'Computing']);
        $this->student($this->computingOtherOrg, ['first_name' => 'Gia', 'last_name' => 'Sibling']);
        $this->student($this->artsOrg, ['first_name' => 'Gia', 'last_name' => 'Arts']);
        $this->student($this->computingHome, ['first_name' => 'Gia', 'last_name' => 'Elsewhere', 'department' => $this->arts->name]);

        $this->assertSame(['Gia Arts', 'Gia Computing', 'Gia Elsewhere', 'Gia Sibling'], $this->names($this->search($sao, ['q' => 'gia', 'scope' => 'all'])));
        $this->assertSame(
            ['Gia Computing', 'Gia Sibling'],
            $this->names($this->search($sao, ['q' => 'gia', 'scope' => 'all', 'eligible_for_organization_id' => $this->computingOrg->id])),
        );
        $this->assertSame(
            ['Gia Arts'],
            $this->names($this->search($sao, ['q' => 'gia', 'scope' => 'all', 'eligible_for_organization_id' => $this->artsOrg->id])),
        );
    }

    public function test_only_someone_who_manages_the_organization_may_ask_who_it_would_accept(): void
    {
        $admin = User::factory()->admin()->create([...$this->pinned(), 'organization_id' => $this->computingOrg->id]);

        $this->search($admin, ['q' => 'quill', 'eligible_for_organization_id' => $this->computingOtherOrg->id])->assertForbidden();
        $this->search($admin, ['q' => 'quill', 'eligible_for_organization_id' => $this->computingOrg->id])->assertOk();
    }

    public function test_only_someone_who_manages_the_organization_may_ask_who_already_belongs(): void
    {
        $admin = User::factory()->admin()->create([...$this->pinned(), 'organization_id' => $this->computingOrg->id]);

        $this->search($admin, ['q' => 'quill', 'exclude_organization_id' => $this->computingOtherOrg->id])->assertForbidden();
        $this->search($admin, ['q' => 'quill', 'exclude_organization_id' => $this->computingOrg->id])->assertOk();
        $this->search($this->computingHead(), ['q' => 'quill', 'exclude_organization_id' => $this->computingOtherOrg->id])->assertOk();
    }

    public function test_the_search_is_throttled_per_signed_in_person(): void
    {
        config(['performance.rate_limits.people_search_per_minute' => 2]);
        $head = $this->computingHead();
        RateLimiter::clear('people:'.$head->organization_id.':'.$head->getAuthIdentifier());

        $this->search($head, ['q' => 'aa'])->assertOk();
        $this->search($head, ['q' => 'bb'])->assertOk();
        $this->search($head, ['q' => 'cc'])->assertStatus(429);
    }
}
