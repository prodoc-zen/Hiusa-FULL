<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class CollegePeopleTest extends TestCase
{
    use CreatesCollegeFixtures, RefreshDatabase;

    private College $computing;

    private College $arts;

    private Organization $computingHome;

    private Organization $artsHome;

    private User $dean;

    protected function setUp(): void
    {
        parent::setUp();

        $this->ensureRegistryTable();

        $this->computing = $this->makeCollege('COC');
        $this->arts = $this->makeCollege('CAS');
        $this->computingHome = $this->makeCollegeHome($this->computing);
        $this->artsHome = $this->makeCollegeHome($this->arts);
        $this->dean = $this->makeCollegeHead($this->computing, ['first_name' => 'Dana', 'last_name' => 'Dean']);
    }

    private function ensureRegistryTable(): void
    {
        if (Schema::hasTable('student_registry')) {
            return;
        }

        Schema::create('student_registry', function ($table) {
            $table->id();
            $table->unsignedBigInteger('school_id')->unique();
            $table->string('first_name');
            $table->string('last_name');
            $table->date('birth_date');
            $table->unsignedBigInteger('college_id');
            $table->string('program')->nullable();
            $table->string('year_level')->nullable();
            $table->string('section')->nullable();
            $table->timestamp('claimed_at')->nullable();
        });
    }

    private function registryRow(int $schoolId, string $first, string $last, College $college, ?string $claimedAt = null): void
    {
        DB::table('student_registry')->insert([
            'school_id' => $schoolId,
            'first_name' => $first,
            'last_name' => $last,
            'birth_date' => '2005-03-14',
            'college_id' => $college->id,
            'program' => 'BSIT',
            'year_level' => '2',
            'claimed_at' => $claimedAt,
        ]);
    }

    private function student(Organization $organization, array $overrides = []): User
    {
        return User::factory()->student()->create(['organization_id' => $organization->id, ...$overrides]);
    }

    private function grant(User $user, Organization $organization, string $role, string $title, string $status = 'active'): void
    {
        AccountProfile::updateOrCreate(
            ['user_school_id' => $user->school_id, 'organization_id' => $organization->id],
            ['role' => $role, 'position_title' => $title, 'account_status' => $status],
        );
    }

    private function people(string $tab, array $query = [])
    {
        Sanctum::actingAs($this->dean);

        return $this->getJson('/api/college/people?'.http_build_query(['tab' => $tab, ...$query]));
    }

    public function test_students_tab_lists_home_org_signups_org_members_and_unclaimed_registry_rows(): void
    {
        $club = $this->makeCollegeStudentOrganization($this->computing, ['name' => 'Computing Society']);

        $signedUp = $this->student($this->computingHome, ['first_name' => 'Ana', 'last_name' => 'Alvarez', 'email' => 'ana@school.test', 'program' => 'BSIT', 'year_level' => '1']);
        $member = $this->student($club, ['first_name' => 'Ben', 'last_name' => 'Bautista']);
        $this->grant($member, $club, 'SBO_OFFICER', 'Treasurer');
        $this->registryRow(20260001, 'Cara', 'Cruz', $this->computing);
        $this->registryRow(20260002, 'Dino', 'Dela Cruz', $this->computing, now()->toDateTimeString());
        $this->registryRow(20260003, 'Elle', 'Estrada', $this->arts);
        $this->student($this->artsHome, ['first_name' => 'Fe', 'last_name' => 'Flores']);

        $response = $this->people('students')->assertOk();

        $names = collect($response->json('data'))->pluck('name')->all();
        $this->assertSame(['Ana Alvarez', 'Ben Bautista', 'Cara Cruz'], $names);

        $rows = collect($response->json('data'))->keyBy('school_id');
        $this->assertSame('signed_up', $rows[$signedUp->school_id]['status']);
        $this->assertSame([], $rows[$signedUp->school_id]['organizations']);
        $this->assertSame([['id' => $club->id, 'name' => 'Computing Society', 'position_title' => 'Treasurer']], $rows[$member->school_id]['organizations']);
        $this->assertSame('not_signed_up', $rows[20260001]['status']);
        $this->assertNull($rows[20260001]['email']);
        $this->assertSame('BSIT', $rows[20260001]['program']);
    }

    public function test_students_tab_never_returns_birth_dates_or_credentials(): void
    {
        $this->student($this->computingHome);
        $this->registryRow(20260001, 'Cara', 'Cruz', $this->computing);

        $body = $this->people('students')->assertOk()->getContent();

        $this->assertStringNotContainsString('birth_date', $body);
        $this->assertStringNotContainsString('2005-03-14', $body);
        $this->assertStringNotContainsString('password', $body);
        $this->assertStringNotContainsString('token', $body);
    }

    public function test_students_tab_searches_names_email_and_school_id(): void
    {
        $this->student($this->computingHome, ['school_id' => 20261234, 'first_name' => 'Ana', 'last_name' => 'Alvarez', 'email' => 'ana.alvarez@school.test']);
        $this->student($this->computingHome, ['school_id' => 20269999, 'first_name' => 'Ben', 'last_name' => 'Bautista', 'email' => 'ben@school.test']);
        $this->registryRow(20267777, 'Cara', 'Cruz', $this->computing);

        $this->assertSame(['Ana Alvarez'], collect($this->people('students', ['q' => 'ana alv'])->json('data'))->pluck('name')->all());
        $this->assertSame(['Ben Bautista'], collect($this->people('students', ['q' => '2026999'])->json('data'))->pluck('name')->all());
        $this->assertSame(['Cara Cruz'], collect($this->people('students', ['q' => 'cruz'])->json('data'))->pluck('name')->all());
        $this->assertSame(['Ana Alvarez'], collect($this->people('students', ['q' => 'school.test', 'per_page' => 1])->json('data'))->pluck('name')->all());
        $this->assertSame([], $this->people('students', ['q' => 'nobody'])->json('data'));
    }

    public function test_students_tab_paginates_accounts_and_registry_rows_together(): void
    {
        foreach (['Ana', 'Ben', 'Cyd'] as $index => $first) {
            $this->student($this->computingHome, ['first_name' => $first, 'last_name' => 'Same']);
        }
        $this->registryRow(20260001, 'Dee', 'Same', $this->computing);

        $first = $this->people('students', ['per_page' => 3])->assertOk();
        $this->assertSame(4, $first->json('total'));
        $this->assertSame(2, $first->json('last_page'));
        $this->assertCount(3, $first->json('data'));

        $second = $this->people('students', ['per_page' => 3, 'page' => 2])->assertOk();
        $this->assertSame(['Dee Same'], collect($second->json('data'))->pluck('name')->all());
    }

    public function test_college_with_no_student_organizations_still_lists_its_people(): void
    {
        $this->student($this->computingHome, ['first_name' => 'Ana', 'last_name' => 'Alvarez']);
        $this->registryRow(20260001, 'Cara', 'Cruz', $this->computing);

        $this->assertSame(2, $this->people('students')->assertOk()->json('total'));
        $this->assertSame(0, $this->people('leaders')->assertOk()->json('total'));
        $this->assertSame(1, $this->people('staff')->assertOk()->json('total'));
    }

    public function test_staff_tab_lists_the_office_and_nobody_from_other_colleges_or_student_organizations(): void
    {
        $club = $this->makeCollegeStudentOrganization($this->computing);
        $secretary = User::factory()->admin()->create(['organization_id' => $this->computingHome->id, 'first_name' => 'Sol', 'last_name' => 'Secretary', 'position_title' => 'College Secretary']);
        $delegate = User::factory()->student()->create(['organization_id' => $this->computingHome->id, 'first_name' => 'Tess', 'last_name' => 'Delegate']);
        $this->grant($delegate, $this->computingHome, 'ADMIN', 'Records Officer');
        User::factory()->admin()->create(['organization_id' => $club->id, 'first_name' => 'Org', 'last_name' => 'President']);
        User::factory()->admin()->create(['organization_id' => $this->artsHome->id, 'first_name' => 'Other', 'last_name' => 'Secretary']);
        User::factory()->admin()->create(['organization_id' => $this->computingHome->id, 'account_status' => 'disabled', 'first_name' => 'Gone', 'last_name' => 'Staff']);

        $rows = collect($this->people('staff')->assertOk()->json('data'));

        $this->assertSame(['Dana Dean', 'Sol Secretary', 'Tess Delegate'], $rows->pluck('name')->all());
        $this->assertTrue($rows[0]['is_lead_head']);
        $this->assertTrue($rows[0]['is_you']);
        $this->assertFalse($rows[1]['is_you']);
        $this->assertSame('College Secretary', $rows[1]['position_title']);
        $this->assertSame('Records Officer', $rows[2]['position_title']);
        $this->assertSame($secretary->email, $rows[1]['email']);
    }

    public function test_leaders_tab_lists_heads_and_officers_with_their_organization(): void
    {
        $robotics = $this->makeCollegeStudentOrganization($this->computing, ['name' => 'Robotics Club']);
        $society = $this->makeCollegeStudentOrganization($this->computing, ['name' => 'Computing Society']);
        $artsClub = $this->makeCollegeStudentOrganization($this->arts, ['name' => 'Arts Guild']);

        $president = User::factory()->admin()->create(['organization_id' => $society->id, 'first_name' => 'Pia', 'last_name' => 'Perez', 'position_title' => 'President']);
        $treasurer = User::factory()->student()->create(['organization_id' => $society->id, 'first_name' => 'Tom', 'last_name' => 'Tan']);
        $this->grant($treasurer, $society, 'SBO_OFFICER', 'Treasurer');
        $roboHead = User::factory()->student()->create(['organization_id' => $this->computingHome->id, 'first_name' => 'Rae', 'last_name' => 'Reyes']);
        $this->grant($roboHead, $robotics, 'ADMIN', 'Chairperson');
        $this->grant($roboHead, $society, 'SBO_OFFICER', 'Auditor', 'inactive');
        User::factory()->student()->create(['organization_id' => $society->id, 'first_name' => 'Mia', 'last_name' => 'Member']);
        User::factory()->admin()->create(['organization_id' => $artsClub->id, 'first_name' => 'Other', 'last_name' => 'Head']);

        $rows = collect($this->people('leaders')->assertOk()->json('data'));

        $this->assertSame(
            [['Computing Society', 'Pia Perez', 'President'], ['Computing Society', 'Tom Tan', 'Treasurer'], ['Robotics Club', 'Rae Reyes', 'Chairperson']],
            $rows->map(fn ($row) => [$row['organization']['name'], $row['name'], $row['position_title']])->all(),
        );
        $this->assertSame($president->email, $rows[0]['email']);

        $filtered = collect($this->people('leaders', ['q' => 'robotics'])->json('data'));
        $this->assertSame(['Rae Reyes'], $filtered->pluck('name')->all());
    }

    public function test_a_person_leading_two_organizations_appears_once_for_each(): void
    {
        $a = $this->makeCollegeStudentOrganization($this->computing, ['name' => 'Alpha']);
        $b = $this->makeCollegeStudentOrganization($this->computing, ['name' => 'Beta']);
        $person = User::factory()->student()->create(['organization_id' => $a->id]);
        $this->grant($person, $a, 'ADMIN', 'President');
        $this->grant($person, $b, 'SBO_OFFICER', 'Secretary');

        $this->assertSame(2, $this->people('leaders')->assertOk()->json('total'));
    }

    public function test_only_a_department_head_with_a_college_can_open_the_page_data(): void
    {
        foreach (['ADMIN', 'SBO_OFFICER', 'STUDENT'] as $role) {
            Sanctum::actingAs(User::factory()->create(['organization_id' => $this->computingHome->id, 'role' => $role]));
            $this->getJson('/api/college/people?tab=students')->assertForbidden();
        }

        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => $this->computingHome->id]));
        $this->getJson('/api/college/people?tab=students')->assertForbidden();

        $stray = Organization::factory()->create(['organization_type' => 'COLLEGE', 'college_id' => null]);
        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => $stray->id]));
        $this->getJson('/api/college/people?tab=students')->assertForbidden();

    }

    public function test_guests_and_bad_tabs_are_rejected(): void
    {
        $this->getJson('/api/college/people?tab=students')->assertUnauthorized();

        $this->people('everyone')->assertUnprocessable()->assertJsonValidationErrors('tab');
        Sanctum::actingAs($this->dean);
        $this->getJson('/api/college/people')->assertUnprocessable()->assertJsonValidationErrors('tab');
    }
}
