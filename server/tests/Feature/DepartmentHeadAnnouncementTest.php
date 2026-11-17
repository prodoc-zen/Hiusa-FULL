<?php

namespace Tests\Feature;

use App\Models\AiOutput;
use App\Models\Announcement;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
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

    public function test_head_announces_to_every_active_organization_of_the_college_and_to_no_other(): void
    {
        [$first, $head] = $this->context();
        $second = Organization::factory()->create(['college_id' => $first->college_id, 'college' => $first->college]);
        $archived = Organization::factory()->create(['college_id' => $first->college_id, 'college' => $first->college, 'lifecycle_status' => 'archived']);
        $inactive = Organization::factory()->create(['college_id' => $first->college_id, 'college' => $first->college, 'is_active' => false]);
        $foreign = Organization::factory()->create();
        $student = User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
        $student->accountProfiles()->create(['organization_id' => $second->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        $response = $this->postJson('/api/announcements', [...$this->payload($first), 'organization_id' => 'all'])
            ->assertCreated()->assertJsonPath('created_count', 2);

        $this->assertSame([$first->id, $second->id], Announcement::orderBy('organization_id')->pluck('organization_id')->all());
        $this->assertSame(2, Announcement::where('is_published', true)->where('approval_status', 'approved')->where('created_by', $head->id)->count());
        foreach ([$archived, $inactive, $foreign] as $skipped) {
            $this->assertDatabaseMissing('announcements', ['organization_id' => $skipped->id]);
        }
        $this->assertDatabaseHas('notifications', ['user_id' => $student->school_id, 'organization_id' => $second->id, 'notification_type' => 'announcement']);
        $this->assertSame(2, AuditLog::where('user_id', $head->school_id)->whereNotNull('record_id')->count());
        $this->assertNotNull($response->json('id'));
    }

    public function test_announcing_to_all_with_no_active_organization_creates_nothing(): void
    {
        [$organization] = $this->context();
        $organization->update(['is_active' => false]);

        $this->postJson('/api/announcements', [...$this->payload($organization), 'organization_id' => 'all'])->assertStatus(409);
        $this->postJson('/api/announcements', [...$this->payload($organization), 'organization_id' => 'everyone'])->assertUnprocessable()->assertJsonValidationErrors('organization_id');
        $this->assertDatabaseCount('announcements', 0);
    }

    public function test_head_drafts_with_ai_and_the_draft_is_accepted_once_and_only_for_its_author(): void
    {
        config(['services.groq.key' => 'test-key']);
        Http::fake(['*' => Http::response(['id' => 'dean-draft', 'model' => 'test-model', 'output_text' => 'Orientation is on the date and venue supplied.'])]);
        [$organization, $head] = $this->context();

        $generated = $this->postJson('/api/announcements/generate-draft', ['title' => 'College orientation', 'target_role' => 'all', 'details' => 'Orientation is in the main hall.'])
            ->assertOk()->assertJsonPath('quota.remaining', 19);
        $this->getJson('/api/announcements/generation-quota')->assertOk()->assertJsonPath('used', 1);

        $announcement = $this->postJson('/api/announcements', [...$this->payload($organization), 'ai_output_id' => $generated->json('ai_output_id')])->assertCreated();
        $output = AiOutput::findOrFail($generated->json('ai_output_id'));
        $this->assertSame('accepted', $output->decision_status);
        $this->assertSame($announcement->json('id'), (int) $output->reference_id);

        $strangerHead = User::factory()->departmentHead()->create(['organization_id' => $head->organization_id]);
        Sanctum::actingAs($strangerHead);
        $other = AiOutput::create([
            'organization_id' => $head->organization_id, 'feature_type' => 'ANNOUNCEMENT_DRAFT', 'reference_type' => 'announcement', 'prompt_text' => 'x', 'output_text' => 'x',
            'status' => 'completed', 'decision_status' => 'pending', 'requested_by' => $head->school_id, 'created_at' => now(),
        ]);
        $this->postJson('/api/announcements', [...$this->payload($organization), 'ai_output_id' => $other->id])->assertUnprocessable()
            ->assertJsonPath('message', 'The selected AI draft is not available to this user.');
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
