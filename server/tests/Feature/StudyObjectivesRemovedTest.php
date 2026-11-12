<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StudyObjectivesRemovedTest extends TestCase
{
    use RefreshDatabase;

    public function test_no_role_can_reach_the_study_objectives_endpoint(): void
    {
        $organization = Organization::factory()->create();

        foreach (['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] as $role) {
            $this->app['auth']->forgetGuards();
            Sanctum::actingAs(User::factory()->create(['role' => $role, 'organization_id' => $organization->id]));

            $this->getJson('/api/objectives/overview')->assertNotFound();
        }
    }
}
