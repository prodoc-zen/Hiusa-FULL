<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RoleAccessMatrixTest extends TestCase
{
    use RefreshDatabase;

    public function test_api_role_boundaries_match_the_system_use_case_matrix(): void
    {
        $organization = Organization::factory()->create();
        $users = collect(['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'])
            ->mapWithKeys(fn (string $role) => [
                $role => User::factory()->create([
                    'organization_id' => $organization->id,
                    'role' => $role,
                    'account_status' => 'active',
                ]),
            ]);

        $cases = [
            ['POST', '/api/users', ['ADMIN']],
            ['POST', '/api/announcements', ['ADMIN', 'SBO_OFFICER']],
            ['POST', '/api/announcements/generate-draft', ['ADMIN', 'SBO_OFFICER']],
            ['POST', '/api/elections', ['ADMIN']],
            ['POST', '/api/elections/999/candidates', ['ADMIN', 'SBO_OFFICER']],
            ['POST', '/api/partylists', ['ADMIN']],
            ['POST', '/api/elections/999/vote', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT']],
            ['GET', '/api/elections/999/results', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT']],
            ['POST', '/api/events', ['ADMIN']],
            ['GET', '/api/events', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT']],
            ['GET', '/api/events/999/attendance', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT']],
            ['POST', '/api/events/999/generate-plan', ['ADMIN']],
            ['POST', '/api/transactions', ['ADMIN']],
            ['POST', '/api/budgets', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD']],
            ['POST', '/api/budgets/999/advice', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD']],
            ['POST', '/api/financial-reports/generate', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD']],
            ['POST', '/api/forecasts/generate', ['ADMIN', 'SBO_OFFICER']],
            ['GET', '/api/transactions/personal-receipts', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT']],
            ['POST', '/api/merchandise', ['ADMIN']],
            ['PATCH', '/api/orders/999/status', ['ADMIN', 'SBO_OFFICER']],
            ['POST', '/api/orders', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT']],
            ['POST', '/api/tasks', ['ADMIN']],
            ['PATCH', '/api/tasks/999/status', ['ADMIN', 'SBO_OFFICER']],
            ['GET', '/api/approval-requests', ['ADMIN', 'DEPARTMENT_HEAD']],
        ];

        foreach ($cases as [$method, $uri, $allowedRoles]) {
            foreach ($users as $role => $user) {
                Sanctum::actingAs($user);
                $response = $this->json($method, $uri);

                if (in_array($role, $allowedRoles, true)) {
                    $this->assertNotSame(403, $response->status(), "{$role} should be allowed to access {$method} {$uri}.");
                } else {
                    $response->assertForbidden();
                }
            }
        }
    }
}
