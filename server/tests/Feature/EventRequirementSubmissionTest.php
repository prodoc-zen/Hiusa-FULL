<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use App\Models\Organization;
use App\Models\User;
use App\Services\SubmissionStoragePolicy;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EventRequirementSubmissionTest extends TestCase
{
    use RefreshDatabase;

    public function test_failed_event_upload_preserves_existing_documents_and_does_not_open_review(): void
    {
        $admin = User::factory()->admin()->create();
        $event = Event::factory()->create(['organization_id' => $admin->organization_id, 'created_by' => $admin->school_id, 'status' => 'planning']);
        $requirement = EventRequirement::create(['name' => 'Proposal', 'allowed_extensions' => ['pdf'], 'is_active' => true]);
        $file = EventRequirementFile::create(['event_id' => $event->id, 'organization_id' => $admin->organization_id, 'requirement_id' => $requirement->id, 'path' => 'old.pdf', 'original_name' => 'old.pdf', 'uploaded_by' => $admin->school_id]);
        $this->mock(SubmissionStoragePolicy::class)->shouldReceive('assertUpload')->once();
        $disk = \Mockery::mock(FilesystemAdapter::class);
        $disk->shouldReceive('exists')->with('old.pdf')->andReturn(false);
        $disk->shouldReceive('putFileAs')->once()->andReturn(false);
        $disk->shouldReceive('delete')->andReturn(true);
        Storage::shouldReceive('disk')->with('local')->andReturn($disk);
        Sanctum::actingAs($admin);
        $this->post('/api/events/'.$event->id.'/submission', ['documents' => [$requirement->id => UploadedFile::fake()->create('replacement.pdf', 10, 'application/pdf')]], ['Accept' => 'application/json'])->assertStatus(500);
        $this->assertDatabaseHas('event_requirement_files', ['id' => $file->id, 'path' => 'old.pdf']);
        $this->assertDatabaseMissing('approval_requests', ['entity_type' => 'event', 'entity_id' => $event->id]);
    }

    public function test_existing_login_can_switch_to_sao_profile_and_manage_requirements(): void
    {
        $organization = Organization::factory()->create();
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $user = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $saoProfile = $user->accountProfiles()->create([
            'organization_id' => $sao->id,
            'role' => 'SUPER_ADMIN',
            'account_status' => 'active',
            'position_title' => 'SAO Officer',
        ]);

        $this->getJson('/api/event-requirements')->assertUnauthorized();

        $token = $this->postJson('/api/login', [
            'school_id' => $user->school_id,
            'password' => 'password',
        ])->assertOk()->assertJsonPath('user.role', 'ADMIN')->json('access_token');

        $this->app['auth']->forgetGuards();
        $this->withToken($token)->postJson('/api/event-requirements', [
            'name' => 'Event proposal', 'allowed_extensions' => ['pdf'],
        ])->assertForbidden();

        $this->withToken($token)->postJson('/api/user/profiles/'.$saoProfile->id.'/switch')
            ->assertOk()->assertJsonPath('user.role', 'SUPER_ADMIN');
        $this->withToken($token)->getJson('/api/event-requirements')->assertOk()->assertExactJson([]);
        $this->withToken($token)->postJson('/api/event-requirements', [
            'name' => 'Invalid requirement', 'allowed_extensions' => ['exe'],
        ])->assertUnprocessable();
        $this->withToken($token)->postJson('/api/event-requirements', [
            'name' => 'Non-PDF requirement', 'allowed_extensions' => ['png'],
        ])->assertUnprocessable();
        $requirement = $this->withToken($token)->postJson('/api/event-requirements', [
            'template_url' => 'https://example.edu/proposal-format',
            'name' => 'Event proposal', 'allowed_extensions' => ['pdf'],
        ])->assertCreated();
        $this->withToken($token)->putJson('/api/event-requirements/'.$requirement->json('id'), [
            'name' => 'Approved event proposal', 'allowed_extensions' => ['pdf'],
        ])->assertOk()->assertJsonPath('name', 'Approved event proposal');
        $this->withToken($token)->getJson('/api/event-requirements')->assertOk()->assertJsonCount(1);
    }

    public function test_sao_sets_file_requirements_then_admin_submits_for_sao_review(): void
    {
        Storage::fake('local');
        $organization = Organization::factory()->create();
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($director);
        $requirement = $this->postJson('/api/event-requirements', [
            'template_url' => 'https://example.edu/proposal-format',
            'name' => 'Event proposal', 'allowed_extensions' => ['pdf'],
        ])->assertCreated();

        Sanctum::actingAs($admin);
        $event = $this->postJson('/api/events', [
            'title' => 'General Assembly', 'start_time' => now()->addDays(5)->toISOString(),
            'end_time' => now()->addDays(5)->addHours(2)->toISOString(),
        ])->assertCreated();
        $eventId = $event->json('id');
        $this->assertDatabaseHas('approval_requests', ['entity_type' => 'event', 'entity_id' => $eventId, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending']);
        $this->assertDatabaseMissing('approval_requests', ['entity_type' => 'event', 'entity_id' => $eventId, 'required_role' => 'SUPER_ADMIN']);

        $this->post('/api/events/'.$eventId.'/submission', [
            'documents' => [$requirement->json('id') => UploadedFile::fake()->create('proposal.pdf', 20, 'application/pdf')],
        ])->assertOk()->assertJsonPath('approval_status', 'pending')->assertJsonCount(1, 'files');
        $fileId = $this->getJson('/api/events/'.$eventId.'/submission')->json('files.0.id');
        $this->assertDatabaseMissing('approval_requests', ['entity_type' => 'event', 'entity_id' => $eventId, 'required_role' => 'SUPER_ADMIN']);

        Sanctum::actingAs($head);
        $this->getJson('/api/events/'.$eventId.'/submission')->assertOk()->assertJsonCount(1, 'files');
        $this->get('/api/events/'.$eventId.'/submission/files/'.$fileId)->assertOk();
        $this->getJson('/api/approval-requests')->assertJsonCount(1, 'data');
        $headApproval = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'DEPARTMENT_HEAD')->firstOrFail();
        $this->patchJson('/api/approval-requests/'.$headApproval->id, ['status' => 'approved'])->assertOk();
        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'planning']);

        Sanctum::actingAs($director);
        $this->getJson('/api/approval-requests')->assertOk()->assertJsonPath('data.0.entity_type', 'event');
        $approval = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'SUPER_ADMIN')->firstOrFail();
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])->assertOk();
        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'approved']);
    }

    public function test_sao_sample_template_is_private_and_can_be_replaced_or_removed(): void
    {
        Storage::fake('local');
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $admin->organization_id]);
        $student = User::factory()->student()->create(['organization_id' => $admin->organization_id]);

        $this->get('/api/event-requirements/1/template')->assertUnauthorized();
        Sanctum::actingAs($director);
        $id = $this->postJson('/api/event-requirements', ['name' => 'Proposal', 'allowed_extensions' => ['pdf'], 'template_url' => 'https://example.edu/proposal-format'])->assertCreated()->json('id');
        $this->withHeader('Accept', 'application/json')->post("/api/event-requirements/{$id}/template", [
            'template' => UploadedFile::fake()->image('sample.png'),
        ])->assertUnprocessable()->assertJsonValidationErrors('template');

        $uploaded = $this->withHeader('Accept', 'application/json')->post("/api/event-requirements/{$id}/template", [
            'template' => UploadedFile::fake()->create('proposal-sample.pdf', 20, 'application/pdf'),
        ])->assertOk()->assertJsonPath('template_original_name', 'proposal-sample.pdf');
        $this->assertArrayNotHasKey('template_path', $uploaded->json());
        $this->getJson('/api/event-requirements')->assertOk()->assertJsonPath('0.template_original_name', 'proposal-sample.pdf')->assertDontSee('template_path');
        $this->assertCount(1, Storage::disk('local')->files("event-requirement-templates/{$id}"));

        Sanctum::actingAs($admin);
        $this->get("/api/event-requirements/{$id}/template")->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->withHeader('Accept', 'application/json')->post("/api/event-requirements/{$id}/template", [
            'template' => UploadedFile::fake()->create('hijacked.pdf', 20, 'application/pdf'),
        ])->assertForbidden();
        $this->putJson("/api/event-requirements/{$id}/template-link", ['template_url' => 'https://example.edu/sample.pdf'])->assertForbidden();
        Sanctum::actingAs($head);
        $this->get("/api/event-requirements/{$id}/template")->assertOk();
        Sanctum::actingAs($student);
        $this->get("/api/event-requirements/{$id}/template")->assertForbidden();

        Sanctum::actingAs($director);
        $this->putJson("/api/event-requirements/{$id}", ['name' => 'Proposal', 'allowed_extensions' => ['pdf'], 'is_active' => false])->assertOk();
        Sanctum::actingAs($admin);
        $this->get("/api/event-requirements/{$id}/template")->assertNotFound();
        Sanctum::actingAs($director);
        $this->putJson("/api/event-requirements/{$id}", ['name' => 'Proposal', 'allowed_extensions' => ['pdf'], 'is_active' => true])->assertOk();
        $this->withHeader('Accept', 'application/json')->post("/api/event-requirements/{$id}/template", [
            'template' => UploadedFile::fake()->create('updated-sample.pdf', 20, 'application/pdf'),
        ])->assertOk()->assertJsonPath('template_original_name', 'updated-sample.pdf');
        $this->assertCount(1, Storage::disk('local')->files("event-requirement-templates/{$id}"));
        $this->putJson("/api/event-requirements/{$id}/template-link", ['template_url' => 'javascript:alert(1)'])
            ->assertUnprocessable()->assertJsonValidationErrors('template_url');
        $this->putJson("/api/event-requirements/{$id}/template-link", ['template_url' => 'https://example.edu/sample.pdf'])
            ->assertOk()->assertJsonPath('template_url', 'https://example.edu/sample.pdf')
            ->assertJsonPath('template_original_name', null);
        $this->assertSame([], Storage::disk('local')->files("event-requirement-templates/{$id}"));
        $this->get("/api/event-requirements/{$id}/template")->assertNotFound();
        $this->withHeader('Accept', 'application/json')->post("/api/event-requirements/{$id}/template", [
            'template' => UploadedFile::fake()->create('replacement.pdf', 20, 'application/pdf'),
        ])->assertOk()->assertJsonPath('template_url', null);
        $this->deleteJson("/api/event-requirements/{$id}/template")->assertConflict();
        $this->putJson("/api/event-requirements/{$id}", ['name' => 'Proposal', 'allowed_extensions' => ['pdf'], 'is_active' => false])->assertOk();
        $this->deleteJson("/api/event-requirements/{$id}/template")->assertOk()->assertJsonPath('template_original_name', null);
        $this->assertSame([], Storage::disk('local')->files("event-requirement-templates/{$id}"));
        $this->get("/api/event-requirements/{$id}/template")->assertNotFound();
    }

    public function test_admin_can_view_and_replace_files_after_sao_rejects_an_event_proposal(): void
    {
        Storage::fake('local');
        $organization = Organization::factory()->create();
        $director = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($director);
        $requirementId = $this->postJson('/api/event-requirements', ['name' => 'Proposal', 'allowed_extensions' => ['pdf'], 'template_url' => 'https://example.edu/proposal-format'])->assertCreated()->json('id');
        $this->withHeader('Accept', 'application/json')->post("/api/event-requirements/{$requirementId}/template", [
            'template' => UploadedFile::fake()->create('sample-proposal.pdf', 20, 'application/pdf'),
        ])->assertOk();
        Sanctum::actingAs($admin);
        $eventId = $this->postJson('/api/events', [
            'title' => 'Foundation Day', 'start_time' => now()->addDays(5)->toISOString(),
            'end_time' => now()->addDays(5)->addHours(2)->toISOString(),
        ])->assertCreated()->json('id');
        $this->post("/api/events/{$eventId}/submission", ['documents' => [
            $requirementId => UploadedFile::fake()->create('wrong-format.pdf', 20, 'application/pdf'),
        ]])->assertOk();

        Sanctum::actingAs($head);
        $headRequest = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'DEPARTMENT_HEAD')->firstOrFail();
        $this->patchJson('/api/approval-requests/'.$headRequest->id, ['status' => 'approved'])->assertOk();
        Sanctum::actingAs($director);
        $saoRequest = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'SUPER_ADMIN')->firstOrFail();
        $this->patchJson('/api/approval-requests/'.$saoRequest->id, ['status' => 'rejected', 'remarks' => 'Use the sample proposal format.'])->assertOk();

        Sanctum::actingAs($admin);
        $submission = $this->getJson("/api/events/{$eventId}/submission")->assertOk()
            ->assertJsonPath('approval_status', 'rejected')
            ->assertJsonPath('approval_remarks', 'Use the sample proposal format.')
            ->assertJsonPath('requirements.0.template_original_name', 'sample-proposal.pdf')
            ->assertDontSee('template_path');
        $oldFileId = $submission->json('files.0.id');
        $this->get("/api/events/{$eventId}/submission/files/{$oldFileId}")->assertOk();
        $this->post("/api/events/{$eventId}/submission", ['documents' => [
            $requirementId => UploadedFile::fake()->create('corrected-proposal.pdf', 20, 'application/pdf'),
        ]])->assertOk()->assertJsonPath('files.0.original_name', 'corrected-proposal.pdf');
        $this->assertSame(1, EventRequirementFile::where('event_id', $eventId)->count());
        $this->assertDatabaseHas('approval_requests', ['id' => $saoRequest->id, 'status' => 'pending']);
    }

    public function test_missing_or_wrong_file_cannot_be_submitted_and_other_org_cannot_read(): void
    {
        Storage::fake('local');
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => $sao->id]));
        $requirement = $this->postJson('/api/event-requirements', [
            'name' => 'Permit', 'allowed_extensions' => ['pdf'],
            'template_url' => 'https://example.edu/permit-format',
        ])->assertCreated();
        $admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($admin);
        $event = $this->postJson('/api/events', [
            'title' => 'Workshop', 'start_time' => now()->addDays(2)->toISOString(),
            'end_time' => now()->addDays(2)->addHour()->toISOString(),
        ])->assertCreated();
        $eventId = $event->json('id');

        $this->postJson('/api/events/'.$eventId.'/submission', ['documents' => []])->assertUnprocessable();
        $this->withHeader('Accept', 'application/json')->post('/api/events/'.$eventId.'/submission', [
            'documents' => [$requirement->json('id') => UploadedFile::fake()->image('wrong.png')],
        ])->assertUnprocessable();
        $this->withHeader('Accept', 'application/json')->post('/api/events/'.$eventId.'/submission', [
            'documents' => [$requirement->json('id') => UploadedFile::fake()->create('disguised.txt', 20, 'application/pdf')],
        ])->assertUnprocessable();

        $other = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($other);
        $this->getJson('/api/events/'.$eventId.'/submission')->assertNotFound();
    }

    public function test_sao_can_order_and_remove_unused_requirements_but_submitted_files_are_preserved(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($director);
        $first = $this->postJson('/api/event-requirements', ['name' => 'Proposal', 'description' => 'Signed proposal', 'allowed_extensions' => ['pdf'], 'template_url' => 'https://example.edu/proposal-format'])->assertCreated()->json('id');
        $second = $this->postJson('/api/event-requirements', ['name' => 'Budget', 'allowed_extensions' => ['pdf'], 'template_url' => 'https://example.edu/budget-format'])->assertCreated()->json('id');

        $this->putJson('/api/event-requirements/order', ['ids' => [$second]])->assertUnprocessable();
        $this->putJson('/api/event-requirements/order', ['ids' => [$second, $first]])->assertOk()->assertJsonPath('0.id', $second);
        $this->getJson('/api/event-requirements')->assertJsonPath('0.id', $second)->assertJsonPath('1.description', 'Signed proposal');

        Sanctum::actingAs($admin);
        $this->putJson('/api/event-requirements/order', ['ids' => [$first, $second]])->assertForbidden();
        $this->deleteJson('/api/event-requirements/'.$first)->assertForbidden();
        $event = $this->postJson('/api/events', ['title' => 'Conference', 'start_time' => now()->addDays(4)->toISOString(), 'end_time' => now()->addDays(4)->addHours(2)->toISOString()])->assertCreated();
        Storage::fake('local');
        $this->post('/api/events/'.$event->json('id').'/submission', ['documents' => [
            $first => UploadedFile::fake()->create('proposal.pdf', 20, 'application/pdf'),
            $second => UploadedFile::fake()->create('budget.pdf', 20, 'application/pdf'),
        ]])->assertOk();

        Sanctum::actingAs($director);
        $this->deleteJson('/api/event-requirements/'.$first)->assertStatus(409);
        $this->assertSame(1, EventRequirementFile::where('requirement_id', $first)->count());
        $this->putJson('/api/event-requirements/'.$first, ['name' => 'Proposal', 'allowed_extensions' => ['pdf'], 'is_active' => false])->assertOk();
        $this->deleteJson('/api/event-requirements/'.$second)->assertStatus(409);
        $unused = $this->postJson('/api/event-requirements', ['name' => 'Unused', 'allowed_extensions' => ['pdf'], 'template_url' => 'https://example.edu/format'])->assertCreated()->json('id');
        $this->deleteJson('/api/event-requirements/'.$unused)->assertNoContent();
        $this->assertDatabaseMissing('event_requirements', ['id' => $unused]);
    }
}
