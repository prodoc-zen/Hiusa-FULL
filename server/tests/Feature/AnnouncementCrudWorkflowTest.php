<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AnnouncementCrudWorkflowTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_create_view_update_and_delete_an_announcement(): void
    {
        $admin = User::factory()->admin()->create();
        Sanctum::actingAs($admin);

        $created = $this->postJson('/api/announcements', [
            'title' => 'Campus assembly',
            'body' => 'Meet in the auditorium.',
            'target_role' => 'STUDENT',
            'category' => 'events',
        ])->assertCreated()->assertJsonPath('approval_status', 'draft');
        $id = $created->json('id');

        $this->getJson('/api/announcements?search=Campus')->assertOk()->assertJsonPath('data.0.id', $id);
        $this->putJson("/api/announcements/{$id}", ['title' => 'Campus assembly updated', 'body' => 'Meet at noon.'])
            ->assertOk()->assertJsonPath('title', 'Campus assembly updated');
        $this->assertDatabaseHas('announcements', ['id' => $id, 'title' => 'Campus assembly updated', 'approval_status' => 'draft']);
        $this->deleteJson("/api/announcements/{$id}")->assertOk();
        $this->assertDatabaseMissing('announcements', ['id' => $id]);
    }

    public function test_student_and_other_organization_cannot_mutate_an_announcement(): void
    {
        $admin = User::factory()->admin()->create();
        Sanctum::actingAs($admin);
        $id = $this->postJson('/api/announcements', ['title' => 'Private draft', 'body' => 'Review first.', 'target_role' => 'all'])->assertCreated()->json('id');

        $student = User::factory()->student()->create(['organization_id' => $admin->organization_id]);
        Sanctum::actingAs($student);
        $this->putJson("/api/announcements/{$id}", ['title' => 'Changed'])->assertForbidden();
        $this->deleteJson("/api/announcements/{$id}")->assertForbidden();

        $foreignAdmin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($foreignAdmin);
        $this->putJson("/api/announcements/{$id}", ['title' => 'Changed'])->assertNotFound();
        $this->deleteJson("/api/announcements/{$id}")->assertNotFound();
    }
}
