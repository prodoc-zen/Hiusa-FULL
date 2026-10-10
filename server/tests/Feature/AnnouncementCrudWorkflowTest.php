<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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

    public function test_announcement_payloads_carry_the_latest_approval_request_id(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($officer);
        $stored = $this->postJson('/api/announcements', ['title' => 'Officer notice', 'body' => 'Needs approval.', 'target_role' => 'all'])->assertCreated();
        $id = $stored->json('id');
        $approval = ApprovalRequest::where('entity_type', 'announcement')->where('entity_id', $id)->firstOrFail();
        $stored->assertJsonPath('approval_id', $approval->id);

        $newer = ApprovalRequest::create([
            'organization_id' => $organization->id, 'entity_type' => 'announcement', 'entity_id' => $id,
            'requested_by' => $officer->id, 'required_role' => config('approvals.routes.announcement'),
        ]);

        $this->getJson('/api/announcements')->assertOk()->assertJsonPath('data.0.approval_id', $newer->id);

        $this->putJson("/api/announcements/{$id}", ['title' => 'Officer notice edited'])->assertOk()->assertJsonPath('approval_id', $newer->id);

        Sanctum::actingAs($admin);
        $directId = $this->postJson('/api/announcements', ['title' => 'Admin notice', 'body' => 'Published directly.', 'target_role' => 'all', 'is_published' => true])
            ->assertCreated()->assertJsonPath('approval_id', null)->json('id');
        $rows = collect($this->getJson('/api/announcements')->assertOk()->json('data'))->keyBy('id');
        $this->assertSame($newer->id, $rows[$id]['approval_id']);
        $this->assertNull($rows[$directId]['approval_id']);
    }

    public function test_announcement_index_resolves_approval_ids_in_one_query_and_students_get_none(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($officer);
        foreach (range(1, 5) as $n) {
            $this->postJson('/api/announcements', ['title' => "Notice {$n}", 'body' => 'Body.', 'target_role' => 'all'])->assertCreated();
        }

        DB::enableQueryLog();
        $rows = $this->getJson('/api/announcements')->assertOk()->json('data');
        $approvalQueries = collect(DB::getQueryLog())->filter(fn ($q) => str_contains($q['query'], 'approval_requests'))->count();
        DB::disableQueryLog();

        $this->assertCount(5, $rows);
        $this->assertSame(1, $approvalQueries);
        $this->assertNotContains(null, array_column($rows, 'approval_id'));

        Sanctum::actingAs($student);
        foreach ($this->getJson('/api/announcements')->assertOk()->json('data') as $row) {
            $this->assertNull($row['approval_id'] ?? null);
        }
    }
}
