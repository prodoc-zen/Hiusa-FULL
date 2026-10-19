<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SaoAdminProvisioningTest extends TestCase
{
    use RefreshDatabase;

    private function payload(Organization $organization): array
    {
        return ['organization_id' => $organization->id, 'school_id' => 78123456, 'first_name' => 'New', 'last_name' => 'Administrator', 'email' => 'admin@example.test', 'password' => 'Initial-Password-123!', 'password_confirmation' => 'Initial-Password-123!', 'position_title' => 'President'];
    }

    private function signInSao(): User
    {
        $user = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]);
        Sanctum::actingAs($user);

        return $user;
    }

    public function test_sao_creates_an_admin_profile_with_a_hashed_initial_password_and_an_audit_without_credentials(): void
    {
        Mail::fake();
        $director = $this->signInSao();
        $organization = Organization::factory()->create();
        $response = $this->postJson('/api/system/admins', $this->payload($organization))->assertCreated()
            ->assertJsonPath('role', 'ADMIN')->assertJsonPath('must_change_password', true)->assertJsonMissingPath('password_hash');
        $user = User::findOrFail($response->json('school_id'));
        $this->assertTrue(Hash::check('Initial-Password-123!', $user->password_hash));
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => $user->school_id, 'organization_id' => $organization->id, 'role' => 'ADMIN', 'account_status' => 'active']);
        $this->assertDatabaseHas('audit_logs', ['user_id' => $director->school_id, 'action' => 'administrator_created']);
        $audit = AuditLog::where('action', 'administrator_created')->sole();
        $this->assertStringNotContainsString('Initial-Password', json_encode($audit->new_values));
        $this->assertStringNotContainsString('password', json_encode($audit->new_values));
        Mail::assertNothingOutgoing();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/login', ['school_id' => $user->school_id, 'password' => 'Initial-Password-123!', 'organization_id' => $organization->id])->assertOk()
            ->assertJsonPath('user.role', 'ADMIN')->assertJsonPath('user.must_change_password', true);
    }

    public function test_additional_admins_do_not_replace_the_existing_administrator(): void
    {
        $this->signInSao();
        $organization = Organization::factory()->create();
        $existing = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->postJson('/api/system/admins', $this->payload($organization))->assertCreated();
        $this->assertSame('ADMIN', $existing->fresh()->role);
        $this->assertSame('active', $existing->fresh()->account_status);
        $this->assertSame(2, $organization->accountProfiles()->where('role', 'ADMIN')->count());
    }

    public function test_non_sao_roles_cannot_create_an_admin(): void
    {
        $organization = Organization::factory()->create();
        foreach (['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] as $role) {
            Sanctum::actingAs(User::factory()->create(['organization_id' => $organization->id, 'role' => $role]));
            $this->postJson('/api/system/admins', $this->payload($organization))->assertForbidden();
        }
        $this->assertDatabaseMissing('users', ['school_id' => 78123456]);
    }

    public function test_invalid_credentials_and_privilege_fields_fail_before_creating_an_account(): void
    {
        $this->signInSao();
        $organization = Organization::factory()->create();
        $payload = $this->payload($organization);
        $this->postJson('/api/system/admins', [...$payload, 'password_confirmation' => 'wrong'])->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->postJson('/api/system/admins', [...$payload, 'role' => 'SUPER_ADMIN'])->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->postJson('/api/system/admins', [...$payload, 'password_hash' => 'injected'])->assertUnprocessable()->assertJsonValidationErrors('password_hash');
        $this->postJson('/api/system/admins', [...$payload, 'school_id' => 0])->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $this->assertDatabaseMissing('users', ['email' => $payload['email']]);
        $this->postJson('/api/system/admins', $payload)->assertCreated();
        $this->postJson('/api/system/admins', $payload)->assertUnprocessable()->assertJsonValidationErrors(['email', 'school_id']);
    }

    public function test_inactive_pending_system_and_archived_college_destinations_cannot_receive_an_admin(): void
    {
        $this->signInSao();
        foreach ([['is_active' => false], ['lifecycle_status' => 'pending'], ['lifecycle_status' => 'archived']] as $attributes) {
            $organization = Organization::factory()->create($attributes);
            $this->postJson('/api/system/admins', $this->payload($organization))->assertConflict();
        }
        $college = College::create(['name' => 'Archived College', 'is_active' => false]);
        $organization = Organization::factory()->create(['college_id' => $college->id, 'college' => $college->name]);
        $this->postJson('/api/system/admins', $this->payload($organization))->assertConflict();
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $this->postJson('/api/system/admins', $this->payload($sao))->assertUnprocessable()->assertJsonValidationErrors('organization_id');
        $this->assertDatabaseMissing('users', ['school_id' => 78123456]);
    }

    public function test_sao_can_add_an_existing_same_college_login_as_an_admin_without_replacing_its_profiles_or_password(): void
    {
        $this->signInSao();
        $source = Organization::factory()->create(['college' => 'College of Computing']);
        $target = Organization::factory()->create(['college' => $source->college]);
        $user = User::factory()->student()->create(['organization_id' => $source->id]);
        $password = $user->getRawOriginal('password_hash');
        $payload = ['organization_id' => $target->id, 'school_id' => $user->school_id, 'role' => 'ADMIN'];
        $this->postJson('/api/account-profiles/invite', $payload)->assertCreated()->assertJsonPath('role', 'ADMIN');
        $this->assertSame('STUDENT', $user->fresh()->role);
        $this->assertSame($password, $user->fresh()->getRawOriginal('password_hash'));
        $this->assertCount(2, $user->accountProfiles()->get());
        $this->getJson('/api/system/users?role=ADMIN')->assertOk()
            ->assertJsonPath('data.0.school_id', $user->school_id)
            ->assertJsonPath('data.0.role', 'STUDENT')
            ->assertJsonPath('data.0.profile_roles.1', 'ADMIN');
        $this->postJson('/api/account-profiles/invite', $payload)->assertConflict();
        $foreign = User::factory()->student()->create(['organization_id' => Organization::factory()->create(['college' => 'Other College'])->id]);
        $this->postJson('/api/account-profiles/invite', [...$payload, 'school_id' => $foreign->school_id])->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $this->assertDatabaseMissing('account_profiles', ['organization_id' => $target->id, 'user_school_id' => $foreign->school_id]);
    }
}
