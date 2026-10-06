<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Notification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EvaluationRemovalTest extends TestCase
{
    use RefreshDatabase;

    public function test_legacy_evaluation_notices_are_hidden_for_every_role(): void
    {
        foreach (['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] as $role) {
            $user = User::factory()->create(['role' => $role]);
            $notice = ['user_id' => $user->school_id, 'organization_id' => $user->organization_id, 'notification_type' => 'general', 'title' => 'Survey', 'message' => 'Old survey notice', 'is_read' => false];
            Notification::create([...$notice, 'reference_type' => 'App\\Models\\EvaluationWindow']);
            $general = Notification::create([...$notice, 'title' => 'General notice', 'reference_type' => null]);
            $this->app['auth']->forgetGuards();
            Sanctum::actingAs($user);
            $this->getJson('/api/notifications')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $general->id)->assertJsonPath('unread_count', 1);
        }
    }

    public function test_evaluation_endpoints_are_unavailable_to_every_role(): void
    {
        foreach (['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] as $role) {
            $this->app['auth']->forgetGuards();
            Sanctum::actingAs(User::factory()->create(['role' => $role]));
            foreach ([
                ['GET', '/api/evaluation/current'],
                ['POST', '/api/evaluation/responses'],
                ['GET', '/api/evaluation/results'],
                ['GET', '/api/evaluation/results/export'],
                ['GET', '/api/evaluation/windows'],
                ['POST', '/api/evaluation/windows'],
                ['PATCH', '/api/evaluation/windows/1'],
            ] as [$method, $path]) {
                $this->json($method, $path)->assertNotFound();
            }
            $payload = $this->getJson('/api/objectives/overview')->assertOk()->json();
            foreach ($payload['objectives'] as $objective) {
                foreach ($objective['evidence'] as $item) {
                    $this->assertStringNotContainsString('evaluation', $item['href'] ?? '');
                }
            }
        }
    }
}
