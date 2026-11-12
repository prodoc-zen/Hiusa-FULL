<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SaoAdministratorsUnitRemovedTest extends TestCase
{
    use RefreshDatabase;

    public function test_no_role_can_reach_the_administrators_unit_endpoints(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        foreach (['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] as $role) {
            $this->app['auth']->forgetGuards();
            Sanctum::actingAs(User::factory()->create(['role' => $role, 'organization_id' => $organization->id]));

            foreach ([
                ['GET', '/api/system/admins'],
                ['POST', '/api/system/admins'],
                ['PUT', "/api/system/admins/{$admin->school_id}"],
                ['DELETE', "/api/system/admins/{$admin->school_id}"],
                ['POST', "/api/system/admins/{$admin->school_id}/password-reset"],
                ['POST', "/api/system/admins/{$admin->school_id}/handover"],
                ['GET', "/api/system/organizations/{$organization->id}/members"],
            ] as [$method, $path]) {
                $this->json($method, $path)->assertNotFound();
            }
        }
    }

    public function test_an_organization_admin_is_still_reached_through_the_university_users_list(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]));

        $this->getJson('/api/system/users?role=ADMIN')->assertOk()->assertJsonFragment(['school_id' => $admin->school_id]);
    }
}
