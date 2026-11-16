<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/** A person's data reaches the language model only after they agreed to the current Data Privacy Notice. */
class PrivacyConsentGateTest extends TestCase
{
    use RefreshDatabase;

    private const GATED = [
        ['POST', '/api/ai/review-notes/draft'],
        ['POST', '/api/officer-handovers/draft-note'],
        ['POST', '/api/announcements/generate-draft'],
        ['POST', '/api/compliance/semester-narrative'],
        ['POST', '/api/ai/assistant/ask'],
        ['POST', '/api/ai/assistant/chat'],
        ['GET', '/api/ai/assistant'],
    ];

    private function admin(array $overrides = []): User
    {
        return User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id, ...$overrides]);
    }

    private function assertRefused($response): void
    {
        $response->assertForbidden()->assertExactJson([
            'success' => false,
            'code' => 'privacy_consent_required',
            'message' => 'Please accept the privacy notice first.',
        ]);
    }

    public function test_every_ai_route_is_behind_the_consent_gate_and_the_account_routes_are_not(): void
    {
        $gated = collect(Route::getRoutes()->getRoutes())->filter(fn ($route) => in_array('privacy.consent', $route->gatherMiddleware(), true))
            ->map(fn ($route) => $route->uri())->all();

        foreach (['api/ai/outputs/{aiOutput}/outcome', 'api/ai/review-notes/draft', 'api/compliance/semester-narrative', 'api/officer-handovers/draft-note',
            'api/financial-reports/{financialReport}/checks', 'api/financial-reports/{financialReport}/checks/explain', 'api/announcements/generate-draft',
            'api/ai/assistant', 'api/ai/assistant/ask', 'api/ai/assistant/chat', 'api/ai/assistant/messages/{message}/action/confirm'] as $uri) {
            $this->assertContains($uri, $gated, $uri);
        }
        foreach (['api/user', 'api/user/privacy-consent', 'api/logout'] as $uri) {
            $this->assertNotContains($uri, $gated, $uri);
        }
    }

    public function test_no_agreement_on_record_is_refused(): void
    {
        $user = $this->admin(['privacy_accepted_at' => null, 'privacy_notice_version' => null]);

        foreach (self::GATED as [$method, $uri]) {
            $this->assertRefused($this->actingAs($user)->json($method, $uri));
        }
    }

    public function test_an_agreement_to_an_older_version_is_refused(): void
    {
        $user = $this->admin(['privacy_accepted_at' => now()->subMonth(), 'privacy_notice_version' => '2026-01']);

        foreach (self::GATED as [$method, $uri]) {
            $this->assertRefused($this->actingAs($user)->json($method, $uri));
        }
    }

    public function test_an_agreement_to_the_current_version_passes_the_gate(): void
    {
        $user = $this->admin();

        foreach (self::GATED as [$method, $uri]) {
            $this->assertNotSame('privacy_consent_required', $this->actingAs($user)->json($method, $uri)->json('code'), $uri);
        }
    }

    public function test_agreeing_again_to_a_newer_version_reopens_the_gate_and_records_the_new_time(): void
    {
        $user = $this->admin(['privacy_accepted_at' => now()->subMonth(), 'privacy_notice_version' => '2026-01']);
        $this->assertRefused($this->actingAs($user)->postJson('/api/ai/review-notes/draft', []));

        $this->actingAs($user)->postJson('/api/user/privacy-consent', ['privacy_accepted' => true])
            ->assertOk()->assertJsonPath('data.privacy_notice_version', config('hiusa.privacy_notice_version'));

        $this->assertSame(config('hiusa.privacy_notice_version'), $user->fresh()->privacy_notice_version);
        $this->assertTrue($user->fresh()->privacy_accepted_at->isToday());
        $this->assertSame(1, AuditLog::where('action', 'privacy_consent_given')->count());
        $this->assertNotSame('privacy_consent_required', $this->actingAs($user->fresh())->postJson('/api/ai/review-notes/draft', [])->json('code'));
    }

    public function test_the_account_routes_answer_whatever_the_agreement(): void
    {
        $user = $this->admin(['privacy_accepted_at' => null, 'privacy_notice_version' => null]);

        $this->actingAs($user)->getJson('/api/user')->assertOk()->assertJsonPath('privacy_accepted_at', null);
        $this->actingAs($user)->postJson('/api/user/privacy-consent', ['privacy_accepted' => false])->assertUnprocessable();
    }
}
