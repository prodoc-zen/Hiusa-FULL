<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AiOutput;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
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
        $this->assertStringStartsWith('General Assembly: please read the details below.', $text);
        $this->assertStringNotContainsString('Category:', $text);
        $this->assertStringNotContainsString('HIUSA', $text);
        $this->assertStringNotContainsString('to be announced', $text);
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

    private function providerReturns(string $text): void
    {
        config(['services.groq.key' => 'test-key', 'services.anthropic.key' => '']);
        Http::fake(['*' => Http::response(['id' => 'x', 'model' => 'test-model', 'output_text' => $text])]);
    }

    /** @return array<string, array{string, string, string}> */
    public static function ordinaryRewordings(): array
    {
        $year = now()->year;

        return [
            'time with minutes added and a year' => ['Nov 20, 3pm, Room 204', "The meeting starts at 3:00 PM on November 20, {$year} in Room 204.", 'Assembly'],
            'time range' => ['8 to 10:30am', 'The session runs from 8:00 to 10:30 AM.', 'Workshop'],
            'weekday date with the year' => ['Friday Nov 20', "Join us on Friday, November 20, {$year}.", 'Orientation'],
            'afternoon range' => ['3 to 5pm at the gym', 'Come from 3:00 PM to 5:00 PM at the gym.', 'Sports day'],
            'numeric date from a month name' => ['November 20 at 9am', 'On 11/20 at 9:00 AM we meet.', 'Meeting'],
            'dotted meridiem' => ['Starts 2 p.m.', 'It starts at 2:00 P.M.', 'Kickoff'],
        ];
    }

    #[DataProvider('ordinaryRewordings')]
    public function test_a_draft_that_restates_the_officers_time_or_date_is_kept(string $details, string $draft, string $title): void
    {
        $this->providerReturns($draft);
        Sanctum::actingAs($this->admin());

        $this->postJson('/api/announcements/generate-draft', ['title' => $title, 'target_role' => 'all', 'details' => $details])
            ->assertOk()
            ->assertJsonPath('is_template', false)
            ->assertJsonPath('notice', null);
    }

    public function test_a_draft_with_a_different_time_or_fee_is_rejected_and_the_notice_says_why(): void
    {
        $this->providerReturns('The meeting starts at 4:00 PM on November 20.');
        Sanctum::actingAs($this->admin());

        $notice = $this->postJson('/api/announcements/generate-draft', ['title' => 'Assembly', 'target_role' => 'all', 'details' => 'Nov 20, 3pm'])
            ->assertOk()
            ->assertJsonPath('is_template', true)
            ->json('notice');

        $this->assertStringContainsString('added a date, time or number you did not give', $notice);
        $this->assertStringNotContainsString('not available', $notice);
    }

    public function test_the_notice_never_says_the_service_is_down_when_no_draft_came_back(): void
    {
        config(['services.groq.key' => '', 'services.anthropic.key' => '']);
        Http::fake();
        Sanctum::actingAs($this->admin());

        $notice = $this->postJson('/api/announcements/generate-draft', ['title' => 'Assembly', 'target_role' => 'all'])->json('notice');

        $this->assertStringNotContainsString('not available', $notice);
        $this->assertStringContainsString('did not send back a draft', $notice);
    }

    public function test_provider_drafts_that_the_checks_reject_still_count_toward_the_daily_quota(): void
    {
        config(['services.groq.announcement_daily_limit' => 2]);
        $this->providerReturns('The meeting starts at 4:45 PM.');
        Sanctum::actingAs($this->admin());
        $payload = ['title' => 'Assembly', 'target_role' => 'all', 'details' => 'Nov 20, 3pm'];

        $this->postJson('/api/announcements/generate-draft', $payload)->assertOk()->assertJsonPath('is_template', true)->assertJsonPath('quota.remaining', 1);
        $this->postJson('/api/announcements/generate-draft', $payload)->assertOk()->assertJsonPath('quota.remaining', 0);
        $this->postJson('/api/announcements/generate-draft', $payload)->assertStatus(429);

        Http::assertSentCount(2);
    }

    private function reservation(User $user, string $status, \DateTimeInterface $createdAt): AiOutput
    {
        return AiOutput::create([
            'organization_id' => $user->organization_id,
            'feature_type' => 'ANNOUNCEMENT_DRAFT',
            'reference_type' => 'announcement',
            'prompt_text' => 'p',
            'output_text' => '',
            'context_version' => 'announcement-v2',
            'status' => $status,
            'version' => 1,
            'decision_status' => 'pending',
            'requested_by' => $user->school_id,
            'created_at' => $createdAt,
        ]);
    }

    public function test_a_reservation_left_by_a_dead_request_stops_counting_and_cannot_be_attached(): void
    {
        $user = $this->admin();
        Sanctum::actingAs($user);
        $stale = $this->reservation($user, 'pending', now()->subMinutes(10));
        $fresh = $this->reservation($user, 'pending', now());

        $this->getJson('/api/announcements/generation-quota')->assertJsonPath('used', 1);

        foreach ([$stale, $fresh] as $output) {
            $this->postJson('/api/announcements', ['title' => 'A', 'body' => 'B', 'target_role' => 'all', 'ai_output_id' => $output->id])
                ->assertUnprocessable();
        }
    }

    public function test_the_template_is_written_for_the_reader_without_the_officers_ai_instructions(): void
    {
        config(['services.groq.key' => '', 'services.anthropic.key' => '']);
        Http::fake();
        Sanctum::actingAs($this->admin());

        $text = $this->postJson('/api/announcements/generate-draft', [
            'title' => 'General Assembly',
            'target_role' => 'ADMIN',
            'category' => 'events',
            'details' => 'Formal tone. Assembly is on September 30 at 2:00 PM. Bring your ID. Use a friendly tone please.',
        ])->assertOk()->json('output_text');

        $this->assertStringStartsWith('General Assembly: please read the details below.', $text);
        $this->assertStringContainsString('Assembly is on September 30 at 2:00 PM. Bring your ID.', $text);
        $this->assertStringNotContainsString('tone', $text);
        $this->assertStringNotContainsString('Category:', $text);
        $this->assertStringNotContainsString('organization officers', $text);
        $this->assertStringNotContainsString('This announcement for', $text);
    }
}
