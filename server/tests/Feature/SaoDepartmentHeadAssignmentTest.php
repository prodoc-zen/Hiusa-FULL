<?php

namespace Tests\Feature;

use App\Mail\PasswordResetMail;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class SaoDepartmentHeadAssignmentTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private User $director;

    private College $computing;

    private College $business;

    private Organization $computingHome;

    protected function setUp(): void
    {
        parent::setUp();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $this->director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $this->computing = $this->makeCollege('CCS');
        $this->business = $this->makeCollege('CBE');
        $this->computingHome = $this->makeCollegeHome($this->computing);
        $this->makeCollegeHome($this->business);
    }

    private function acceptLink(College $college, string $email = 'ramon.castillo@example.edu', array $extra = []): TestResponse
    {
        Sanctum::actingAs($this->director);
        $link = $this->postJson("/api/system/colleges/{$college->id}/invite-department-head")->assertCreated()->json('magic_link');
        parse_str((string) parse_url($link, PHP_URL_QUERY), $query);
        app('auth')->forgetGuards();

        return $this->postJson("/api/department-head-invitations/{$query['token']}/accept", [
            'first_name' => 'Ramon',
            'last_name' => 'Castillo',
            'email' => $email,
            'password' => 'Dean2026!Pass',
            'password_confirmation' => 'Dean2026!Pass',
            ...$extra,
        ]);
    }

    public function test_a_new_head_has_college_scope_without_organization_profiles(): void
    {
        $approved = $this->makeCollegeStudentOrganization($this->computing);
        $other = $this->makeCollegeStudentOrganization($this->business);
        OrganizationApplication::create([
            'college_id' => $this->computing->id, 'name' => $approved->name, 'acronym' => $approved->acronym,
            'school_id' => 12345678, 'first_name' => 'Alex', 'last_name' => 'Rivera', 'email' => 'alex@example.test',
            'position_title' => 'President', 'status' => 'approved', 'email_verified_at' => now(), 'organization_id' => $approved->id,
        ]);
        OrganizationApplication::create([
            'college_id' => $this->business->id, 'name' => $other->name, 'acronym' => $other->acronym,
            'school_id' => 23456789, 'first_name' => 'Pat', 'last_name' => 'Lee', 'email' => 'pat@example.test',
            'position_title' => 'President', 'status' => 'approved', 'email_verified_at' => now(), 'organization_id' => $other->id,
        ]);

        $schoolId = (int) $this->acceptLink($this->computing, extra: ['school_id' => 20269001])->assertOk()->json('user.school_id');

        $this->assertSame(20269001, $schoolId);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => 20269001, 'organization_id' => $this->computingHome->id, 'role' => 'DEPARTMENT_HEAD']);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => 20269001, 'organization_id' => $approved->id]);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => 20269001, 'organization_id' => $other->id]);
        $this->assertContains($approved->id, User::findOrFail(20269001)->scopedOrganizationIds());
        $this->assertNotContains($other->id, User::findOrFail(20269001)->scopedOrganizationIds());
    }

    public function test_a_head_who_registers_through_the_link_signs_in_by_email_and_gets_college_scope(): void
    {
        $student = $this->makeCollegeStudentOrganization($this->computing);

        $this->acceptLink($this->computing)
            ->assertOk()
            ->assertJsonPath('user.role', 'DEPARTMENT_HEAD')
            ->assertJsonPath('user.email', 'ramon.castillo@example.edu')
            ->assertJsonMissingPath('user.password_hash');

        $head = User::where('email', 'ramon.castillo@example.edu')->firstOrFail();
        $this->assertSame($this->computingHome->id, $head->organization_id);
        $this->assertSame('active', $head->account_status);
        $this->assertSame($this->computing->name, $head->department);
        $this->assertTrue(Hash::check('Dean2026!Pass', $head->password_hash));
        $this->assertSame(1, $head->accountProfiles()->count());
        $this->assertSame(1, AuditLog::where('action', 'department_head_invited')->count());

        app('auth')->forgetGuards();
        $token = $this->postJson('/api/login', ['identifier' => 'Ramon.Castillo@example.edu', 'password' => 'Dean2026!Pass'])
            ->assertOk()
            ->json('access_token');
        $this->assertNotEmpty($token);

        app('auth')->forgetGuards();
        $this->withToken($token)->getJson('/api/college/organizations')
            ->assertOk()
            ->assertJsonFragment(['id' => $student->id]);
    }

    public function test_a_second_link_is_refused_while_a_head_is_active_but_another_college_is_unaffected(): void
    {
        $this->makeCollegeHead($this->computing);
        Sanctum::actingAs($this->director);

        $this->postJson("/api/system/colleges/{$this->computing->id}/invite-department-head")
            ->assertConflict()
            ->assertJsonPath('message', 'This college already has an active Department Head. Deactivate the current one first.');

        $this->postJson("/api/system/colleges/{$this->business->id}/invite-department-head")->assertCreated();
    }

    public function test_a_deactivated_head_can_be_replaced_through_a_new_link(): void
    {
        $this->makeCollegeHead($this->computing, ['account_status' => 'inactive']);

        $this->acceptLink($this->computing)->assertOk();
    }

    public function test_the_old_promote_and_password_routes_are_gone(): void
    {
        Sanctum::actingAs($this->director);

        $this->postJson("/api/system/colleges/{$this->computing->id}/department-head", ['school_id' => 20269001, 'account_mode' => 'existing'])->assertNotFound();
    }

    public function test_an_unknown_college_is_not_found(): void
    {
        Sanctum::actingAs($this->director);

        $this->postJson('/api/system/colleges/999999/invite-department-head')->assertNotFound();
    }

    public function test_the_sao_updates_a_head_and_the_old_token_dies_on_email_change_and_deactivation(): void
    {
        $head = $this->makeCollegeHead($this->computing, ['first_name' => 'Old', 'last_name' => 'Name']);
        $token = $head->createToken('session')->plainTextToken;
        Sanctum::actingAs($this->director);

        $this->putJson("/api/system/department-heads/{$head->school_id}", ['first_name' => 'Ramon', 'last_name' => 'Castillo', 'email' => ' New.Email@example.edu '])
            ->assertOk()
            ->assertJsonPath('first_name', 'Ramon')
            ->assertJsonPath('email', 'new.email@example.edu');
        $this->assertSame(0, $head->tokens()->count());
        $token = $head->createToken('session')->plainTextToken;
        $this->assertSame(1, AuditLog::where('action', 'department_head_updated')->count());

        $this->putJson("/api/system/department-heads/{$head->school_id}", ['account_status' => 'inactive'])
            ->assertOk()
            ->assertJsonPath('account_status', 'inactive');
        $this->assertSame(0, $head->tokens()->count());
        $this->assertSame('inactive', $head->accountProfiles()->where('organization_id', $this->computingHome->id)->value('account_status'));
        $this->assertSame(1, AuditLog::where('action', 'department_head_deactivated')->count());

        app('auth')->forgetGuards();
        $this->withToken($token)->getJson('/api/college/organizations')->assertUnauthorized();
    }

    public function test_reactivating_a_head_is_refused_while_another_active_head_exists(): void
    {
        $former = $this->makeCollegeHead($this->computing, ['account_status' => 'inactive']);
        $current = $this->makeCollegeHead($this->computing);
        Sanctum::actingAs($this->director);

        $this->putJson("/api/system/department-heads/{$former->school_id}", ['account_status' => 'active'])
            ->assertConflict()
            ->assertJsonPath('message', 'This college already has an active Department Head. Deactivate the current one first.');
        $this->assertSame('inactive', $former->fresh()->account_status);

        $this->putJson("/api/system/department-heads/{$current->school_id}", ['account_status' => 'inactive'])->assertOk();
        $this->putJson("/api/system/department-heads/{$former->school_id}", ['account_status' => 'active'])
            ->assertOk()
            ->assertJsonPath('account_status', 'active');
        $this->assertSame(1, AuditLog::where('action', 'department_head_activated')->count());
    }

    public function test_updating_a_head_leaves_another_college_and_other_roles_alone(): void
    {
        $head = $this->makeCollegeHead($this->computing);
        $otherHead = $this->makeCollegeHead($this->business);
        $otherToken = $otherHead->createToken('session');
        $admin = User::factory()->admin()->create(['organization_id' => $this->makeCollegeStudentOrganization($this->computing)->id]);
        Sanctum::actingAs($this->director);

        $this->putJson("/api/system/department-heads/{$head->school_id}", ['account_status' => 'inactive'])->assertOk();

        $this->assertSame('active', $otherHead->fresh()->account_status);
        $this->assertSame(1, $otherHead->tokens()->count());
        $this->putJson("/api/system/department-heads/{$admin->school_id}", ['first_name' => 'Nope'])->assertNotFound();
        $this->putJson("/api/system/department-heads/{$this->director->school_id}", ['first_name' => 'Nope'])->assertNotFound();
        $this->putJson('/api/system/department-heads/999999', ['first_name' => 'Nope'])->assertNotFound();
    }

    public function test_a_head_stored_outside_a_college_home_is_not_managed_here(): void
    {
        $student = $this->makeCollegeStudentOrganization($this->computing);
        $stray = User::factory()->departmentHead()->create(['organization_id' => $student->id]);
        Sanctum::actingAs($this->director);

        $this->putJson("/api/system/department-heads/{$stray->school_id}", ['first_name' => 'Nope'])->assertNotFound();
        $this->postJson("/api/system/department-heads/{$stray->school_id}/password-reset")->assertNotFound();
    }

    public function test_the_sao_cannot_set_a_head_password_through_the_update(): void
    {
        $head = $this->makeCollegeHead($this->computing);
        Sanctum::actingAs($this->director);

        $this->putJson("/api/system/department-heads/{$head->school_id}", ['password' => 'Another2026!Pass', 'password_confirmation' => 'Another2026!Pass'])
            ->assertUnprocessable();
    }

    public function test_the_sao_sends_a_password_reset_to_an_active_head(): void
    {
        Mail::fake();
        $head = $this->makeCollegeHead($this->computing);
        $inactive = $this->makeCollegeHead($this->business, ['account_status' => 'inactive']);
        Sanctum::actingAs($this->director);

        $this->postJson("/api/system/department-heads/{$head->school_id}/password-reset")->assertOk();
        Mail::assertQueued(PasswordResetMail::class, fn ($mail) => $mail->hasTo($head->email));
        $this->assertSame(1, AuditLog::where('action', 'department_head_password_reset_initiated')->count());

        $this->postJson("/api/system/department-heads/{$inactive->school_id}/password-reset")->assertUnprocessable();
    }

    public function test_an_admin_and_a_head_are_forbidden_from_every_new_route(): void
    {
        $head = $this->makeCollegeHead($this->computing);
        $adminOrganization = $this->makeCollegeStudentOrganization($this->computing);
        $admin = User::factory()->admin()->create(['organization_id' => $adminOrganization->id]);

        foreach ([$admin, $head] as $caller) {
            Sanctum::actingAs($caller);
            $this->postJson("/api/system/colleges/{$this->business->id}/invite-department-head")->assertForbidden();
            $this->putJson("/api/system/department-heads/{$head->school_id}", ['first_name' => 'Nope'])->assertForbidden();
            $this->postJson("/api/system/department-heads/{$head->school_id}/password-reset")->assertForbidden();
        }
        $this->assertNotSame('Nope', $head->fresh()->first_name);
    }

    public function test_the_colleges_index_names_each_colleges_head_or_null(): void
    {
        $head = $this->makeCollegeHead($this->computing, ['first_name' => 'Ramon', 'last_name' => 'Castillo']);
        Sanctum::actingAs($this->director);

        $response = $this->getJson('/api/system/colleges')->assertOk();
        $byCode = collect($response->json())->keyBy('code');
        $this->assertSame([
            'school_id' => $head->school_id,
            'name' => 'Ramon Castillo',
            'first_name' => 'Ramon',
            'last_name' => 'Castillo',
            'email' => $head->email,
            'account_status' => 'active',
        ], $byCode['CCS']['department_head']);
        $this->assertArrayHasKey('department_head', $byCode['CBE']);
        $this->assertNull($byCode['CBE']['department_head']);
        $this->assertArrayNotHasKey('home_organization', $byCode['CCS']);
    }

    public function test_the_colleges_index_prefers_the_active_head_and_does_not_query_per_college(): void
    {
        $this->makeCollegeHead($this->computing, ['account_status' => 'inactive', 'first_name' => 'Former']);
        $current = $this->makeCollegeHead($this->computing, ['first_name' => 'Current']);
        foreach (['ENG', 'NUR', 'LAW', 'ART'] as $code) {
            $college = $this->makeCollege($code);
            $this->makeCollegeHead($college);
        }
        Sanctum::actingAs($this->director);

        $queries = 0;
        DB::listen(function () use (&$queries) {
            $queries++;
        });
        $response = $this->getJson('/api/system/colleges')->assertOk();

        $byCode = collect($response->json())->keyBy('code');
        $this->assertSame($current->school_id, $byCode['CCS']['department_head']['school_id']);
        $this->assertLessThanOrEqual(8, $queries, "Colleges index ran {$queries} queries.");
    }
}
