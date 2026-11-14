<?php

namespace Tests\Feature;

use App\Models\FinancialForecast;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DashboardForecastWordsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);
    }

    public function test_the_forecast_suggestion_never_shows_the_statistics_note_to_an_officer(): void
    {
        $thisMonth = now('Asia/Manila')->startOfMonth();
        $organization = Organization::factory()->create();
        $officer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Officer', 'account_status' => 'active']);
        FinancialForecast::factory()->create([
            'organization_id' => $organization->id,
            'forecast_period' => $thisMonth->format('Y-m'),
            'confidence_note' => 'Only 3 month(s) of history were used. At least 6 months are needed before R'."\u{b2}".' is a meaningful signal, so treat this forecast as a rough estimate.',
            'model_details' => ['engine' => 'php-fallback', 'risk' => 'overspending', 'sample_months' => 3, 'income' => ['r_squared' => 0.1], 'expense' => ['r_squared' => 0.2]],
        ]);

        Sanctum::actingAs($officer);
        $insights = $this->getJson('/api/dashboard/briefing')->assertOk()->json('insights');
        $forecast = collect($insights)->firstWhere('engine', 'financial_forecast');

        $this->assertNotNull($forecast);
        $this->assertStringNotContainsString("\u{b2}", $forecast['body']);
        $this->assertStringNotContainsString('month(s)', $forecast['body']);
        $this->assertStringContainsString('Spending is forecast to run ahead of income', $forecast['body']);
        $this->assertStringContainsString('follow no clear trend', $forecast['body']);
    }
}
