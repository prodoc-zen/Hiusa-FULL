<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AnnouncementNotificationTextTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_published_announcement_notifies_students_with_the_body_as_typed(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($admin);

        $id = $this->postJson('/api/announcements', [
            'title' => '<b>x</b> title',
            'body' => '<i>y</i> body text',
            'target_role' => 'STUDENT',
            'is_published' => true,
        ])->assertCreated()->json('id');

        $this->assertDatabaseHas('notifications', [
            'user_id' => $student->school_id,
            'reference_id' => $id,
            'title' => 'New Announcement: <b>x</b> title',
            'message' => '<i>y</i> body text',
        ]);
    }

    public function test_an_approved_announcement_notifies_students_with_the_body_as_typed(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $reviewer = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($officer);
        $id = $this->postJson('/api/announcements', [
            'title' => 'Typed notice',
            'body' => "<i>y</i>   body\ntext",
            'target_role' => 'STUDENT',
        ])->assertCreated()->json('id');
        $approval = ApprovalRequest::where('entity_type', 'announcement')->where('entity_id', $id)->firstOrFail();

        Sanctum::actingAs($reviewer);
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])->assertOk();

        $this->assertDatabaseHas('notifications', [
            'user_id' => $student->school_id,
            'reference_id' => $id,
            'message' => '<i>y</i> body text',
        ]);
    }
}
