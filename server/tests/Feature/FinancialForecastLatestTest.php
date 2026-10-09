<?php

namespace Tests\Feature;

use App\Models\FinancialForecast;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Regenerating a forecast rewrites the row for that period in place, so it keeps
 * its original created_at. The latest forecast is the one touched last.
 */
class FinancialForecastLatestTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_a_regenerated_forecast_is_newer_than_a_manual_one_entered_after_it_was_first_generated(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($admin);

        Carbon::setTestNow('2026-10-01 09:00:00');
        $generatedId = $this->postJson('/api/forecasts/generate', ['months' => 6])->assertCreated()->json('id');

        Carbon::setTestNow('2026-10-02 09:00:00');
        $manual = FinancialForecast::factory()->create(['organization_id' => $organization->id, 'forecast_period' => '2026-12']);

        Carbon::setTestNow('2026-10-03 09:00:00');
        $this->postJson('/api/forecasts/generate', ['months' => 6])->assertCreated()->assertJsonPath('id', $generatedId);

        $this->assertSame($generatedId, FinancialForecast::latestFor($organization->id)->id);
        $this->assertNotSame($manual->id, FinancialForecast::latestFor($organization->id)->id);
    }
}
