<?php

namespace Tests\Feature;

use App\Models\AiOutput;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AnnouncementAiWorkflowTest extends TestCase
{
    use RefreshDatabase;

    public function test_generated_draft_is_logged_and_accepted_when_the_user_saves_it(): void
    {
        config(['services.groq.key' => 'test-key']);
        Http::fake(['*' => Http::response(['id' => 'announcement-response', 'model' => 'test-model', 'output_text' => "**Assembly update**\n\n* Venue details are pending confirmation."])]);
        $admin = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN']);
        Sanctum::actingAs($admin);

        $generated = $this->postJson('/api/announcements/generate-draft', [
            'title' => 'General Assembly',
            'target_role' => 'STUDENT',
            'category' => 'events',
            'details' => 'Venue is not confirmed. Do not invent one.',
        ])->assertOk()
            ->assertJsonPath('model_name', 'test-model')
            ->assertJsonPath('output_text', "Assembly update\n\n- Venue details are pending confirmation.")
            ->assertJsonPath('quota.remaining', 19);

        $outputId = $generated->json('ai_output_id');
        $editedBody = $generated->json('output_text')."\n\nPlease wait for the official venue notice.";
        $announcement = $this->postJson('/api/announcements', [
            'title' => 'General Assembly',
            'body' => $editedBody,
            'target_role' => 'STUDENT',
            'category' => 'events',
            'is_published' => false,
            'ai_output_id' => $outputId,
        ])->assertCreated();

        $output = AiOutput::findOrFail($outputId);
        $this->assertSame('ANNOUNCEMENT_DRAFT', $output->feature_type);
        $this->assertSame('accepted', $output->decision_status);
        $this->assertSame($announcement->json('id'), (int) $output->reference_id);
        $this->assertSame('Venue is not confirmed. Do not invent one.', $output->structured_input['details']);
        $this->assertStringNotContainsString('*', $output->output_text);
        $this->assertSame($editedBody, $announcement->json('body'));
    }

    public function test_groq_failure_returns_retryable_error_without_dummy_copy(): void
    {
        config(['services.groq.key' => 'test-key']);
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $admin = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN']);
        Sanctum::actingAs($admin);

        $this->postJson('/api/announcements/generate-draft', ['title' => 'Assembly', 'target_role' => 'all'])
            ->assertServiceUnavailable()
            ->assertJsonPath('message', 'AI service is temporarily unavailable. Unable to generate the announcement draft.');
        $this->assertDatabaseHas('ai_outputs', ['feature_type' => 'ANNOUNCEMENT_DRAFT', 'status' => 'failed', 'output_text' => '']);
    }

    public function test_missing_required_context_is_rejected_before_calling_groq(): void
    {
        config(['services.groq.key' => 'test-key']);
        Http::fake();
        $admin = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN']);
        Sanctum::actingAs($admin);

        $this->postJson('/api/announcements/generate-draft', ['target_role' => 'STUDENT'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['title']);

        Http::assertNothingSent();
        $this->assertDatabaseCount('ai_outputs', 0);
    }

    public function test_officer_can_generate_edit_save_and_submit_a_draft_for_admin_approval(): void
    {
        config(['services.groq.key' => 'test-key']);
        Http::fake(['*' => Http::response(['id' => 'officer-draft', 'model' => 'test-model', 'output_text' => 'Training starts at the supplied date and venue.'])]);
        $officer = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'SBO_OFFICER']);
        Sanctum::actingAs($officer);

        $generated = $this->postJson('/api/announcements/generate-draft', [
            'title' => 'Officer Training',
            'target_role' => 'SBO_OFFICER',
            'category' => 'training',
            'details' => 'Training is September 12 at the library conference room.',
        ])->assertOk();
        $editedBody = $generated->json('output_text').' Bring your organization ID.';
        $announcement = $this->postJson('/api/announcements', [
            'title' => 'Officer Training',
            'body' => $editedBody,
            'target_role' => 'SBO_OFFICER',
            'category' => 'training',
            'is_published' => false,
            'ai_output_id' => $generated->json('ai_output_id'),
        ])->assertCreated()
            ->assertJsonPath('body', $editedBody)
            ->assertJsonPath('approval_status', 'pending');

        $this->assertDatabaseHas('approval_requests', [
            'entity_type' => 'announcement',
            'entity_id' => $announcement->json('id'),
            'requested_by' => $officer->school_id,
            'required_role' => 'ADMIN',
            'status' => 'pending',
        ]);
    }

    public function test_daily_announcement_generation_quota_is_reported_and_enforced_per_user(): void
    {
        config([
            'services.groq.key' => 'test-key',
            'services.groq.announcement_daily_limit' => 2,
        ]);
        Http::fake(['*' => Http::response(['id' => 'draft', 'model' => 'test-model', 'output_text' => 'Generated announcement.'])]);
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $otherAdmin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        Sanctum::actingAs($admin);

        $this->getJson('/api/announcements/generation-quota')
            ->assertOk()
            ->assertJsonPath('limit', 2)
            ->assertJsonPath('remaining', 2);

        foreach ([1, 0] as $remaining) {
            $this->postJson('/api/announcements/generate-draft', [
                'title' => 'Quota check',
                'target_role' => 'all',
                'details' => 'Use only supplied information.',
            ])->assertOk()->assertJsonPath('quota.remaining', $remaining);
        }

        $this->postJson('/api/announcements/generate-draft', [
            'title' => 'One too many',
            'target_role' => 'all',
        ])->assertStatus(429)->assertJsonPath('quota.remaining', 0);

        Sanctum::actingAs($otherAdmin);
        $this->getJson('/api/announcements/generation-quota')
            ->assertOk()
            ->assertJsonPath('remaining', 2);
    }
}
