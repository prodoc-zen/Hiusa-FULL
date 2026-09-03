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
        Http::fake(['*' => Http::response(['id' => 'announcement-response', 'model' => 'test-model', 'output_text' => 'Assembly details are pending venue confirmation.'])]);
        $admin = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN']);
        Sanctum::actingAs($admin);

        $generated = $this->postJson('/api/announcements/generate-draft', [
            'title' => 'General Assembly',
            'target_role' => 'STUDENT',
            'category' => 'events',
            'details' => 'Venue is not confirmed. Do not invent one.',
        ])->assertOk()->assertJsonPath('model_name', 'test-model');

        $outputId = $generated->json('ai_output_id');
        $announcement = $this->postJson('/api/announcements', [
            'title' => 'General Assembly',
            'body' => $generated->json('output_text'),
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
}
