<?php

namespace Tests\Feature;

use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class NotificationMarkReadTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $student;

    private User $classmate;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->student = User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $this->classmate = User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);
    }

    private function notificationFor(User $user): Notification
    {
        return Notification::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->school_id,
            'notification_type' => 'general',
            'title' => 'Hello',
            'message' => 'Hello',
            'is_read' => false,
            'sent_at' => now(),
        ]);
    }

    public function test_a_user_marks_their_own_notification_read(): void
    {
        $own = $this->notificationFor($this->student);
        Sanctum::actingAs($this->student);

        $this->patchJson('/api/notifications/'.$own->id.'/read')
            ->assertOk()
            ->assertJsonPath('is_read', true);
    }

    public function test_another_users_notification_answers_the_same_as_a_missing_one(): void
    {
        $theirs = $this->notificationFor($this->classmate);
        Sanctum::actingAs($this->student);

        $other = $this->patchJson('/api/notifications/'.$theirs->id.'/read');
        $missing = $this->patchJson('/api/notifications/999999/read');

        $other->assertNotFound();
        $this->assertSame($missing->getStatusCode(), $other->getStatusCode());
        $this->assertSame($missing->json(), $other->json());
        $this->assertFalse($theirs->fresh()->is_read);
    }
}
