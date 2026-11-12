<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SaoAdminProvisioningTest extends TestCase
{
    use RefreshDatabase;

    private function signInSao(): User
    {
        $user = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]);
        Sanctum::actingAs($user);

        return $user;
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
