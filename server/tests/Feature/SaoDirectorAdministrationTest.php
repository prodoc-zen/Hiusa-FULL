<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SaoDirectorAdministrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_sao_director_publishes_one_official_notice_to_users_in_multiple_organizations(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $organizationA = Organization::factory()->create(['college' => 'College A']);
        $organizationB = Organization::factory()->create(['college' => 'College B']);
        $director = User::factory()->create(['organization_id' => $sao->id, 'role' => 'SUPER_ADMIN', 'position_title' => 'SAO Director']);
        $studentA = User::factory()->student()->create(['organization_id' => $organizationA->id]);
        $studentB = User::factory()->student()->create(['organization_id' => $organizationB->id]);

        Sanctum::actingAs($director);
        $this->postJson('/api/system/announcements', [
            'title' => 'University report deadline', 'body' => 'Submit the report by Friday.',
            'target_scope' => 'all_organizations', 'target_roles' => ['STUDENT'], 'publish' => true,
        ])->assertCreated()->assertJsonPath('announcement_source', 'SAO')->assertJsonPath('recipients_count', 2);

        $announcement = Announcement::firstOrFail();
        $this->assertSame('SAO', $announcement->announcement_source);
        $this->assertDatabaseHas('announcement_recipients', ['announcement_id' => $announcement->id, 'user_id' => $studentA->school_id]);
        $this->assertDatabaseHas('announcement_recipients', ['announcement_id' => $announcement->id, 'user_id' => $studentB->school_id]);
        $this->assertSame(2, Notification::where('reference_id', $announcement->id)->count());

        Sanctum::actingAs($studentB);
        $this->getJson('/api/announcements?published_only=1')->assertOk()->assertJsonPath('data.0.id', $announcement->id)->assertJsonPath('data.0.announcement_source', 'SAO');
    }

    public function test_sao_director_has_no_regular_or_ai_announcement_endpoint_and_admin_cannot_create_admins(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $organization = Organization::factory()->create();
        $director = User::factory()->create(['organization_id' => $sao->id, 'role' => 'SUPER_ADMIN']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($director);
        $this->postJson('/api/announcements/generate-draft', ['title' => 'No AI', 'target_role' => 'all'])->assertForbidden();
        $this->postJson('/api/announcements', ['title' => 'Wrong channel', 'body' => 'No', 'target_role' => 'all'])->assertForbidden();

        Sanctum::actingAs($admin);
        $this->postJson('/api/users', ['school_id' => 889900, 'first_name' => 'New', 'last_name' => 'Admin', 'email' => 'new-admin@example.test', 'password' => 'Password123!', 'password_confirmation' => 'Password123!', 'role' => 'ADMIN'])->assertForbidden();
    }
}
