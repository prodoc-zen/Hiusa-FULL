<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AiOutput;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AnnouncementDraftAuditFixesTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN']);
    }

    public function test_template_drafts_do_not_use_up_the_daily_quota(): void
    {
        config(['services.groq.key' => '', 'services.anthropic.key' => '', 'services.groq.announcement_daily_limit' => 2]);
        Http::fake();
        Sanctum::actingAs($this->admin());

        foreach ([1, 2, 3] as $attempt) {
            $this->postJson('/api/announcements/generate-draft', ['title' => 'Assembly', 'target_role' => 'all'])
                ->assertOk()
                ->assertJsonPath('is_template', true)
                ->assertJsonPath('quota.remaining', 2);
        }
        $this->getJson('/api/announcements/generation-quota')->assertJsonPath('used', 0);
    }

    public function test_template_uses_the_officers_details_audience_and_category_without_repeating_the_title(): void
    {
        config(['services.groq.key' => '', 'services.anthropic.key' => '']);
        Http::fake();
        Sanctum::actingAs($this->admin());

        $response = $this->postJson('/api/announcements/generate-draft', [
            'title' => 'General Assembly',
            'target_role' => 'STUDENT',
            'category' => 'events',
            'details' => 'Assembly is on September 30 at 2:00 PM. Bring your ID.',
        ])->assertOk();

        $text = $response->json('output_text');
        $this->assertStringContainsString('Assembly is on September 30 at 2:00 PM. Bring your ID.', $text);
        $this->assertStringContainsString('Students', $text);
        $this->assertStringContainsString('Category: Events.', $text);
        $this->assertStringNotContainsString('HIUSA', $text);
        $this->assertStringNotContainsString('to be announced', $text);
        $this->assertStringStartsNotWith('General Assembly', $text);
        $this->assertStringContainsString('inserted as written', $response->json('notice'));
    }

    public function test_template_without_details_marks_date_and_venue_as_not_announced(): void
    {
        config(['services.groq.key' => '', 'services.anthropic.key' => '']);
        Http::fake();
        Sanctum::actingAs($this->admin());

        $text = $this->postJson('/api/announcements/generate-draft', ['title' => 'Assembly', 'target_role' => 'all'])
            ->assertOk()->json('output_text');

        $this->assertStringContainsString('Date and venue: to be announced.', $text);
    }

    public function test_a_draft_with_an_invented_number_is_replaced_by_the_template(): void
    {
        config(['services.groq.key' => 'test-key', 'services.anthropic.key' => '']);
        Http::fake(['*' => Http::response(['id' => 'x', 'model' => 'test-model', 'output_text' => 'The assembly is on October 12 at 3:00 PM.'])]);
        Sanctum::actingAs($this->admin());

        $this->postJson('/api/announcements/generate-draft', [
            'title' => 'General Assembly',
            'target_role' => 'all',
            'details' => 'Date to follow.',
        ])->assertOk()
            ->assertJsonPath('is_template', true)
            ->assertJsonPath('model_name', 'template-draft');
    }

    public function test_numbers_taken_from_the_officers_details_are_kept(): void
    {
        config(['services.groq.key' => 'test-key', 'services.anthropic.key' => '']);
        Http::fake(['*' => Http::response(['id' => 'x', 'model' => 'test-model', 'output_text' => 'The assembly is on September 30.'])]);
        Sanctum::actingAs($this->admin());

        $this->postJson('/api/announcements/generate-draft', [
            'title' => 'General Assembly',
            'target_role' => 'all',
            'details' => 'Assembly is on September 30.',
        ])->assertOk()->assertJsonPath('is_template', false);
    }

    public function test_details_longer_than_2000_characters_are_rejected_before_any_provider_call(): void
    {
        config(['services.groq.key' => 'test-key']);
        Http::fake();
        Sanctum::actingAs($this->admin());

        $this->postJson('/api/announcements/generate-draft', [
            'title' => 'Assembly',
            'target_role' => 'all',
            'details' => str_repeat('a', 2001),
        ])->assertUnprocessable()->assertJsonValidationErrors(['details']);

        Http::assertNothingSent();
        $this->assertDatabaseCount('ai_outputs', 0);

        $this->postJson('/api/announcements/generate-draft', [
            'title' => 'Assembly',
            'target_role' => 'all',
            'details' => str_repeat('a', 2000),
        ])->assertOk();
    }

    public function test_a_slot_is_reserved_before_the_provider_is_called(): void
    {
        config(['services.groq.key' => 'test-key', 'services.anthropic.key' => '', 'services.groq.announcement_daily_limit' => 1]);
        $user = $this->admin();
        Sanctum::actingAs($user);
        $seen = [];
        Http::fake(function () use ($user, &$seen) {
            $seen = AiOutput::where('requested_by', $user->school_id)->pluck('status')->all();

            return Http::response(['id' => 'x', 'model' => 'test-model', 'output_text' => 'Generated announcement.']);
        });

        $this->postJson('/api/announcements/generate-draft', ['title' => 'Assembly', 'target_role' => 'all'])
            ->assertOk()->assertJsonPath('quota.remaining', 0);

        $this->assertSame(['pending'], $seen);
        $this->assertSame('completed', AiOutput::firstOrFail()->status);
    }

    public function test_a_failed_provider_call_releases_the_reserved_slot(): void
    {
        config(['services.groq.key' => 'test-key', 'services.anthropic.key' => '']);
        Sanctum::actingAs($this->admin());
        $this->mock(TextGenerator::class)
            ->shouldReceive('generate')->andThrow(new \RuntimeException('boom'));
        $this->withoutExceptionHandling();

        try {
            $this->postJson('/api/announcements/generate-draft', ['title' => 'Assembly', 'target_role' => 'all']);
            $this->fail('Expected the provider error to surface.');
        } catch (\RuntimeException) {
        }

        $this->assertDatabaseCount('ai_outputs', 0);
    }
}
