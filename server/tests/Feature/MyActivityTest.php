<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MyActivityTest extends TestCase
{
    use RefreshDatabase;

    private function log(User $actor, string $module, string $action, $createdAt): void
    {
        AuditLog::create([
            'organization_id' => $actor->organization_id,
            'user_id' => $actor->school_id,
            'actor_role' => $actor->role,
            'module' => $module,
            'action' => $action,
            'record_type' => Event::class,
            'record_id' => 12,
            'created_at' => $createdAt,
        ]);
    }

    public function test_people_see_only_their_own_actions_newest_first_with_readable_labels(): void
    {
        $organization = Organization::factory()->create();
        $student = User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $someoneElse = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->log($student, 'event_registrations', 'registered', now()->subDay());
        $this->log($student, 'grievances', 'grievance.submitted', now());
        $this->log($someoneElse, 'events', 'updated', now());
        Sanctum::actingAs($student);

        $response = $this->getJson('/api/me/activity')->assertOk();

        $this->assertSame(2, $response->json('total'));
        $this->assertSame(['Grievances', 'Event Registrations'], array_column($response->json('data'), 'module_label'));
        $this->assertSame('Grievance Submitted', $response->json('data.0.action_label'));
        $this->assertSame('Event #12', $response->json('data.0.record_label'));
        $this->assertArrayNotHasKey('new_values', $response->json('data.0'));
    }

    public function test_activity_requires_sign_in(): void
    {
        $this->getJson('/api/me/activity')->assertUnauthorized();
    }
}
