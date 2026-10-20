<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DepartmentHeadAnnouncementTest extends TestCase
{
    use RefreshDatabase;

    private function context(): array
    {
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $home = Organization::factory()->create(['organization_type' => 'COLLEGE', 'college_id' => $college->id, 'college' => $college->name]);
        $organization = Organization::factory()->create(['college_id' => $college->id, 'college' => $college->name]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        Sanctum::actingAs($head);

        return [$organization, $head];
    }

    private function payload(Organization $organization): array
    {
        return ['organization_id' => $organization->id, 'title' => 'College orientation', 'body' => 'Meet at the organization office.', 'target_role' => 'all', 'is_published' => true];
    }

    public function test_head_publishes_to_selected_organization_and_secondary_members_receive_notifications(): void
    {
        [$organization, $head] = $this->context();
        $student = User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
        $student->accountProfiles()->create(['organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $id = $this->postJson('/api/announcements', $this->payload($organization))->assertCreated()
            ->assertJsonPath('organization_id', $organization->id)->assertJsonPath('created_by', $head->school_id)
            ->assertJsonPath('approval_status', 'approved')->assertJsonPath('is_published', true)->json('id');
        $this->assertDatabaseMissing('approval_requests', ['entity_type' => 'announcement', 'entity_id' => $id]);
        $this->assertDatabaseHas('notifications', ['user_id' => $student->school_id, 'organization_id' => $organization->id, 'reference_id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['organization_id' => $organization->id, 'user_id' => $head->school_id, 'record_id' => $id]);
        $this->getJson('/api/announcements?managed=1')->assertOk()->assertJsonFragment(['id' => $id]);
    }

    public function test_head_can_manage_own_drafts_but_cannot_manage_other_authors_posts(): void
    {
        [$organization, $head] = $this->context();
        $id = $this->postJson('/api/announcements', [...$this->payload($organization), 'is_published' => false])->assertCreated()->json('id');
        $this->getJson('/api/announcements')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/announcements?managed=1')->assertOk()->assertJsonCount(1, 'data');
        $this->putJson('/api/announcements/'.$id, ['title' => 'Updated title'])->assertOk()->assertJsonPath('title', 'Updated title');
        $this->patchJson('/api/announcements/'.$id.'/publish')->assertOk()->assertJsonPath('is_published', true);
        $other = Announcement::factory()->create(['organization_id' => $organization->id, 'created_by' => User::factory()->admin()->create(['organization_id' => $organization->id])->school_id]);
        $this->putJson('/api/announcements/'.$other->id, ['title' => 'Forbidden'])->assertNotFound();
        $this->deleteJson('/api/announcements/'.$other->id)->assertNotFound();
        $this->patchJson('/api/announcements/'.$other->id.'/publish')->assertNotFound();
        $this->deleteJson('/api/announcements/'.$id)->assertOk();
        $this->assertDatabaseMissing('announcements', ['id' => $id]);
    }

    public function test_foreign_inactive_and_unified_organizations_cannot_be_targeted_by_a_head(): void
    {
        [$organization] = $this->context();
        $foreign = Organization::factory()->create();
        $unified = Organization::factory()->create(['is_university_wide' => true, 'college_id' => null, 'college' => null]);
        foreach ([$foreign, $unified] as $target) {
            $this->postJson('/api/announcements', $this->payload($target))->assertNotFound();
        }
        $organization->update(['is_active' => false]);
        $this->postJson('/api/announcements', $this->payload($organization))->assertNotFound();
        $this->assertDatabaseCount('announcements', 0);
    }

    public function test_required_fields_and_role_boundaries_are_enforced(): void
    {
        [$organization] = $this->context();
        $this->postJson('/api/announcements', ['title' => 'Missing target'])->assertUnprocessable()->assertJsonValidationErrors(['organization_id', 'body', 'target_role']);
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $organization->id]));
        $this->postJson('/api/announcements', $this->payload($organization))->assertForbidden();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));
        $this->postJson('/api/announcements', $this->payload($organization))->assertUnprocessable()->assertJsonValidationErrors('organization_id');
    }
}
