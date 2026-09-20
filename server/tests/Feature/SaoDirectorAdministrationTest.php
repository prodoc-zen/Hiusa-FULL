<?php

namespace Tests\Feature;

use App\Mail\PasswordResetMail;
use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
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

    public function test_sao_can_edit_publish_and_archive_an_official_notice(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $organization = Organization::factory()->create();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($director);

        $announcementId = $this->postJson('/api/system/announcements', [
            'title' => 'Draft official notice',
            'body' => 'Draft details.',
            'target_scope' => 'selected_organizations',
            'target_organization_ids' => [$organization->id],
            'target_roles' => ['STUDENT'],
            'publish' => false,
        ])->assertCreated()->assertJsonPath('is_published', false)->json('id');

        $this->putJson('/api/system/announcements/'.$announcementId, [
            'title' => 'Published official notice',
            'body' => 'Final details.',
            'target_scope' => 'selected_organizations',
            'target_organization_ids' => [$organization->id],
            'target_roles' => ['STUDENT'],
            'publish' => true,
        ])->assertOk()->assertJsonPath('is_published', true);

        $this->assertDatabaseHas('notifications', ['user_id' => $student->school_id, 'reference_id' => $announcementId]);
        $this->assertDatabaseHas('audit_logs', ['user_id' => $director->school_id, 'action' => 'global_announcement_updated', 'record_id' => $announcementId]);
        $this->assertDatabaseHas('audit_logs', ['user_id' => $director->school_id, 'action' => 'global_announcement_published', 'record_id' => $announcementId]);

        $this->patchJson('/api/system/announcements/'.$announcementId.'/archive')
            ->assertOk()
            ->assertJsonPath('message', 'Official announcement archived.');
        $this->assertDatabaseHas('audit_logs', ['user_id' => $director->school_id, 'action' => 'global_announcement_archived', 'record_id' => $announcementId]);
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

    public function test_sao_registers_and_deactivates_an_organization_with_target_scoped_audits(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        Sanctum::actingAs($director);

        $created = $this->postJson('/api/system/organizations', [
            'name' => 'Computing Student Council',
            'acronym' => 'CSC',
            'college' => 'College of Computing',
        ])->assertCreated()->json();

        $this->putJson('/api/system/organizations/'.$created['id'], ['is_active' => false])
            ->assertOk()
            ->assertJsonPath('is_active', false);

        $this->assertDatabaseHas('audit_logs', ['organization_id' => $created['id'], 'user_id' => $director->school_id, 'actor_role' => 'SUPER_ADMIN', 'action' => 'organization_created']);
        $this->assertDatabaseHas('audit_logs', ['organization_id' => $created['id'], 'user_id' => $director->school_id, 'actor_role' => 'SUPER_ADMIN', 'action' => 'organization_deactivated']);
    }

    public function test_sao_sets_initial_admin_password_and_can_later_initiate_secure_reset(): void
    {
        Mail::fake();
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $organization = Organization::factory()->create();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        Sanctum::actingAs($director);

        $response = $this->postJson('/api/system/admins', [
            'organization_id' => $organization->id,
            'school_id' => 78001122,
            'first_name' => 'Org',
            'last_name' => 'Adviser',
            'email' => 'adviser@example.test',
            'position_title' => 'Adviser',
            'password' => 'Initial-Admin-Password-123!',
            'password_confirmation' => 'Initial-Admin-Password-123!',
        ])->assertCreated()
            ->assertJsonPath('role', 'ADMIN')
            ->assertJsonPath('position_title', 'Adviser')
            ->assertJsonMissing(['password_hash', 'password']);

        $admin = User::findOrFail($response->json('school_id'));
        $initialHash = $admin->password_hash;
        $this->assertTrue(Hash::check('Initial-Admin-Password-123!', $initialHash));
        Mail::assertNothingOutgoing();
        $this->assertDatabaseMissing('password_reset_tokens', ['organization_id' => $organization->id, 'email' => $admin->email]);

        $this->putJson('/api/system/admins/'.$admin->school_id, [
            'password' => 'SAO-must-not-set-this',
            'password_confirmation' => 'SAO-must-not-set-this',
        ])->assertUnprocessable();
        $this->assertSame($initialHash, $admin->fresh()->password_hash);

        $this->postJson('/api/system/admins/'.$admin->school_id.'/password-reset')
            ->assertOk()
            ->assertJsonPath('message', 'Password reset instructions were sent to the administrator email address.');

        Mail::assertQueued(PasswordResetMail::class, fn (PasswordResetMail $mail) => $mail->hasTo($admin->email));
        Mail::assertQueuedCount(1);
        $this->assertDatabaseHas('password_reset_tokens', ['organization_id' => $organization->id, 'email' => $admin->email]);
        $this->assertDatabaseHas('audit_logs', ['organization_id' => $organization->id, 'user_id' => $director->school_id, 'actor_role' => 'SUPER_ADMIN', 'action' => 'administrator_password_reset_initiated']);
        $this->assertFalse(Hash::check('SAO-must-not-set-this', $admin->fresh()->password_hash));
    }

    public function test_sao_admin_creation_requires_a_confirmed_password(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $organization = Organization::factory()->create();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        Sanctum::actingAs($director);

        $payload = [
            'organization_id' => $organization->id,
            'school_id' => 78001123,
            'first_name' => 'New',
            'last_name' => 'Administrator',
            'email' => 'new-administrator@example.test',
            'position_title' => 'President',
        ];

        $this->postJson('/api/system/admins', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['password']);

        $this->postJson('/api/system/admins', [
            ...$payload,
            'password' => 'Initial-Admin-Password-123!',
            'password_confirmation' => 'different-password',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['password']);

        $this->assertDatabaseMissing('users', ['school_id' => 78001123]);
    }

    public function test_sao_admin_management_excludes_the_system_administration_organization(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $invalidSystemAdmin = User::factory()->admin()->create(['organization_id' => $sao->id]);
        Sanctum::actingAs($director);

        $this->getJson('/api/system/admins')
            ->assertOk()
            ->assertJsonMissing(['school_id' => $invalidSystemAdmin->school_id]);
        $this->putJson('/api/system/admins/'.$invalidSystemAdmin->school_id, ['first_name' => 'Blocked'])
            ->assertUnprocessable();
        $this->postJson('/api/system/admins/'.$invalidSystemAdmin->school_id.'/password-reset')
            ->assertUnprocessable();
    }

    public function test_non_sao_roles_cannot_access_sao_administration_endpoints(): void
    {
        $organization = Organization::factory()->create();
        foreach (['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] as $role) {
            $user = User::factory()->create(['organization_id' => $organization->id, 'role' => $role]);
            Sanctum::actingAs($user);
            $this->getJson('/api/system/overview')->assertForbidden();
            $this->getJson('/api/system/organizations')->assertForbidden();
            $this->getJson('/api/system/admins')->assertForbidden();
            $this->getJson('/api/system/announcements')->assertForbidden();
        }
    }

    public function test_sao_only_reviews_routed_requests_and_rejection_notifies_and_audits(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $organization = Organization::factory()->create();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $otherDirector = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $requester = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $budget = Budget::factory()->create(['organization_id' => $organization->id, 'event_id' => null]);
        $otherBudget = Budget::factory()->create(['organization_id' => $organization->id, 'event_id' => null]);
        $approval = ApprovalRequest::create(['organization_id' => $organization->id, 'entity_type' => 'budget', 'entity_id' => $budget->id, 'requested_by' => $requester->school_id, 'required_role' => 'SUPER_ADMIN']);
        ApprovalRequest::create(['organization_id' => $organization->id, 'entity_type' => 'budget', 'entity_id' => $otherBudget->id, 'requested_by' => $requester->school_id, 'required_role' => 'SUPER_ADMIN', 'assigned_approver' => $otherDirector->school_id]);

        Sanctum::actingAs($director);
        $this->getJson('/api/approval-requests')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $approval->id);
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'rejected'])->assertUnprocessable()->assertJsonValidationErrors('remarks');
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'rejected', 'remarks' => 'Attach the approved quotation.'])
            ->assertOk()
            ->assertJsonPath('status', 'rejected')
            ->assertJsonPath('decision', 'rejected')
            ->assertJsonPath('reviewed_by', $director->school_id);

        $this->assertDatabaseHas('notifications', ['organization_id' => $organization->id, 'user_id' => $requester->school_id, 'reference_type' => 'budget', 'reference_id' => $budget->id]);
        $this->assertDatabaseHas('audit_logs', ['organization_id' => $organization->id, 'user_id' => $director->school_id, 'actor_role' => 'SUPER_ADMIN', 'action' => 'reviewed_rejected', 'record_id' => $approval->id]);
    }
}
