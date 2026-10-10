<?php

namespace Tests\Feature;

use App\Mail\PasswordResetMail;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
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

    private function payload(array $overrides = []): array
    {
        return [
            'school_id' => 20269001,
            'first_name' => 'Ramon',
            'last_name' => 'Castillo',
            'email' => 'Ramon.Castillo@example.edu ',
            'password' => 'Dean2026!Pass',
            'password_confirmation' => 'Dean2026!Pass',
            ...$overrides,
        ];
    }

    public function test_the_sao_creates_a_head_who_signs_in_and_gets_college_scope(): void
    {
        $student = $this->makeCollegeStudentOrganization($this->computing);
        Sanctum::actingAs($this->director);

        $this->postJson("/api/system/colleges/{$this->computing->id}/department-head", $this->payload())
            ->assertCreated()
            ->assertJsonPath('school_id', 20269001)
            ->assertJsonPath('role', 'DEPARTMENT_HEAD')
            ->assertJsonPath('email', 'ramon.castillo@example.edu')
            ->assertJsonMissingPath('password_hash');

        $head = User::findOrFail(20269001);
        $this->assertSame($this->computingHome->id, $head->organization_id);
        $this->assertSame('DEPARTMENT_HEAD', $head->role);
        $this->assertSame('active', $head->account_status);
        $this->assertSame($this->computing->name, $head->department);
        $this->assertTrue(Hash::check('Dean2026!Pass', $head->password_hash));
        $this->assertSame('DEPARTMENT_HEAD', $head->accountProfiles()->where('organization_id', $this->computingHome->id)->value('role'));
        $this->assertSame(1, Notification::where('user_id', 20269001)->where('organization_id', $this->computingHome->id)->count());
        $audit = AuditLog::where('action', 'department_head_created')->sole();
        $this->assertSame($this->director->school_id, $audit->user_id);
        $this->assertSame($this->computing->id, $audit->new_values['college_id']);
        $this->assertSame(20269001, $audit->new_values['department_head_id']);
        $this->assertStringNotContainsString('Dean2026', json_encode($audit->new_values));

        $token = $this->postJson('/api/login', ['school_id' => 20269001, 'password' => 'Dean2026!Pass'])
            ->assertOk()
            ->json('access_token');
        $this->assertNotEmpty($token);

        app('auth')->forgetGuards();
        $this->withToken($token)->getJson('/api/college/organizations')->assertForbidden()->assertJsonPath('error_code', 'PASSWORD_CHANGE_REQUIRED');

        app('auth')->forgetGuards();
        $this->withToken($token)->putJson('/api/user/password', ['current_password' => 'Dean2026!Pass', 'password' => 'My-own-Dean-pass1', 'password_confirmation' => 'My-own-Dean-pass1'])->assertOk();

        app('auth')->forgetGuards();
        $this->withToken($token)->getJson('/api/college/organizations')
            ->assertOk()
            ->assertJsonFragment(['id' => $student->id]);
    }

    public function test_the_create_form_is_validated_with_the_admin_rules(): void
    {
        User::factory()->create(['school_id' => 20269002, 'email' => 'taken@example.edu']);
        Sanctum::actingAs($this->director);
        $url = "/api/system/colleges/{$this->computing->id}/department-head";

        $this->postJson($url, [])->assertUnprocessable()
            ->assertJsonValidationErrors(['school_id', 'first_name', 'last_name', 'email', 'password']);
        $this->postJson($url, $this->payload(['school_id' => 20269002]))->assertUnprocessable()->assertJsonValidationErrors(['school_id']);
        $this->postJson($url, $this->payload(['email' => 'taken@example.edu']))->assertUnprocessable()->assertJsonValidationErrors(['email']);
        $this->postJson($url, $this->payload(['email' => str_repeat('a', 96).'@x.co']))->assertUnprocessable()->assertJsonValidationErrors(['email']);
        $this->postJson($url, $this->payload(['password_confirmation' => 'different']))->assertUnprocessable()->assertJsonValidationErrors(['password']);
        $this->postJson($url, $this->payload(['password' => 'short', 'password_confirmation' => 'short']))->assertUnprocessable()->assertJsonValidationErrors(['password']);
        $this->assertSame(0, User::where('role', 'DEPARTMENT_HEAD')->count());
    }

    public function test_an_unknown_college_is_not_found(): void
    {
        Sanctum::actingAs($this->director);

        $this->postJson('/api/system/colleges/999999/department-head', $this->payload())->assertNotFound();
    }

    public function test_a_second_active_head_is_refused_but_another_college_is_unaffected(): void
    {
        $this->makeCollegeHead($this->computing);
        Sanctum::actingAs($this->director);

        $this->postJson("/api/system/colleges/{$this->computing->id}/department-head", $this->payload())
            ->assertConflict()
            ->assertJsonPath('message', 'This college already has an active Department Head. Deactivate the current one first.');
        $this->assertNull(User::find(20269001));

        $this->postJson("/api/system/colleges/{$this->business->id}/department-head", $this->payload())->assertCreated();
    }

    public function test_a_deactivated_head_can_be_replaced(): void
    {
        $this->makeCollegeHead($this->computing, ['account_status' => 'inactive']);
        Sanctum::actingAs($this->director);

        $this->postJson("/api/system/colleges/{$this->computing->id}/department-head", $this->payload())->assertCreated();
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
            $this->postJson("/api/system/colleges/{$this->business->id}/department-head", $this->payload())->assertForbidden();
            $this->putJson("/api/system/department-heads/{$head->school_id}", ['first_name' => 'Nope'])->assertForbidden();
            $this->postJson("/api/system/department-heads/{$head->school_id}/password-reset")->assertForbidden();
        }
        $this->assertNull(User::find(20269001));
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
