<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EventRequirementSubmissionTest extends TestCase
{
    use RefreshDatabase;

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
            'name' => 'Event proposal', 'allowed_extensions' => ['pdf'],
        ])->assertCreated();

        Sanctum::actingAs($admin);
        $event = $this->postJson('/api/events', [
            'title' => 'General Assembly', 'start_time' => now()->addDays(5)->toISOString(),
            'end_time' => now()->addDays(5)->addHours(2)->toISOString(),
        ])->assertCreated();
        $eventId = $event->json('id');
        $this->assertDatabaseMissing('approval_requests', ['entity_type' => 'event', 'entity_id' => $eventId]);

        $this->post('/api/events/'.$eventId.'/submission', [
            'documents' => [$requirement->json('id') => UploadedFile::fake()->create('proposal.pdf', 20, 'application/pdf')],
        ])->assertOk()->assertJsonPath('approval_status', 'pending')->assertJsonCount(1, 'files');
        $fileId = $this->getJson('/api/events/'.$eventId.'/submission')->json('files.0.id');

        Sanctum::actingAs($head);
        $this->getJson('/api/events/'.$eventId.'/submission')->assertOk()->assertJsonCount(1, 'files');
        $this->get('/api/events/'.$eventId.'/submission/files/'.$fileId)->assertOk();
        $this->getJson('/api/approval-requests')->assertJsonCount(0, 'data');

        Sanctum::actingAs($director);
        $this->getJson('/api/approval-requests')->assertOk()->assertJsonPath('data.0.entity_type', 'event');
        $approval = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->firstOrFail();
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])->assertOk();
        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'approved']);
    }

    public function test_missing_or_wrong_file_cannot_be_submitted_and_other_org_cannot_read(): void
    {
        Storage::fake('local');
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => $sao->id]));
        $requirement = $this->postJson('/api/event-requirements', [
            'name' => 'Permit', 'allowed_extensions' => ['pdf'],
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

        $other = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($other);
        $this->getJson('/api/events/'.$eventId.'/submission')->assertNotFound();
    }
}
