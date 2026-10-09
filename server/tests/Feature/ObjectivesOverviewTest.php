<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\EvaluationResponse;
use App\Models\EvaluationWindow;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ObjectivesOverviewTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    private function user(string $role, int $organizationId): User
    {
        return User::factory()->create(['role' => $role, 'organization_id' => $organizationId, 'account_status' => 'active']);
    }

    private function seedActivity(Organization $org, int $forecasts): void
    {
        $admin = $this->user('ADMIN', $org->id);
        FinancialForecast::factory()->count($forecasts)->create(['organization_id' => $org->id]);
        $event = Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'status' => 'completed']);
        Attendance::factory()->create(['event_id' => $event->id, 'user_id' => $admin->school_id, 'method' => 'biometric', 'check_in_time' => now()]);
    }

    private function objective(array $payload, string $code): array
    {
        return collect($payload['objectives'])->firstWhere('code', $code);
    }

    private function evidence(array $objective, string $label): ?array
    {
        return collect($objective['evidence'])->firstWhere('label', $label);
    }

    public function test_admin_sees_evidence_counted_only_from_their_organization(): void
    {
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $this->seedActivity($orgA, 2);
        $this->seedActivity($orgB, 5);

        Sanctum::actingAs($this->user('ADMIN', $orgA->id));
        $payload = $this->getJson('/api/objectives/overview')->assertOk()->json();

        $this->assertSame('organization', $payload['scope']['type']);
        $this->assertSame($orgA->id, $payload['scope']['organization']['id']);
        $this->assertSame(10, count($payload['objectives']));
        $finance = $this->objective($payload, 'SO2.1');
        $this->assertSame(2, $this->evidence($finance, 'Expense forecasts generated (OLS regression)')['value']);
        $this->assertSame('live', $finance['status']);
        $this->assertSame(1, $this->evidence($this->objective($payload, 'SO2.2'), 'Check-ins by fingerprint')['value']);
    }

    public function test_super_admin_sees_the_university_without_ledger_rows(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $this->seedActivity($orgA, 2);
        $this->seedActivity($orgB, 5);

        Sanctum::actingAs($this->user('SUPER_ADMIN', $sao->id));
        $payload = $this->getJson('/api/objectives/overview')->assertOk()->json();

        $this->assertSame('university', $payload['scope']['type']);
        $finance = $this->objective($payload, 'SO2.1');
        $this->assertSame(7, $this->evidence($finance, 'Expense forecasts generated (OLS regression)')['value']);
        $this->assertNull($this->evidence($finance, 'Transactions recorded in the ledger'));
        $this->assertNotNull($this->evidence($finance, 'Financial reports approved'));
        $this->assertSame(2, $this->evidence($this->objective($payload, 'GO'), 'Organizations onboarded')['value']);
    }

    public function test_an_organization_with_no_activity_reports_zero_and_no_data(): void
    {
        $org = Organization::factory()->create();
        Sanctum::actingAs($this->user('ADMIN', $org->id));
        $payload = $this->getJson('/api/objectives/overview')->assertOk()->json();

        foreach (['SO2.1', 'SO2.2', 'SO2.3', 'SO2.4', 'SO2.5', 'SO2.6'] as $code) {
            $objective = $this->objective($payload, $code);
            $this->assertSame('no_data', $objective['status'], $code);
            foreach ($objective['evidence'] as $item) {
                $this->assertEquals(0, $item['value'], "{$code} {$item['label']}");
            }
        }
    }

    public function test_task_management_mechanism_names_all_four_delegation_factors(): void
    {
        $org = Organization::factory()->create();
        Sanctum::actingAs($this->user('ADMIN', $org->id));
        $mechanism = $this->objective($this->getJson('/api/objectives/overview')->assertOk()->json(), 'SO2.3')['mechanism'];

        foreach (['role relevance (0.35)', 'workload (0.30)', 'past performance (0.20', 'assignment recency (0.15)'] as $factor) {
            $this->assertStringContainsString($factor, $mechanism);
        }
    }

    public function test_hrefs_follow_the_viewers_route_allowlist(): void
    {
        $org = Organization::factory()->create();

        Sanctum::actingAs($this->user('ADMIN', $org->id));
        $admin = $this->evidence($this->objective($this->getJson('/api/objectives/overview')->json(), 'SO2.1'), 'Expense forecasts generated (OLS regression)');
        $this->assertSame('/dashboard/finance/financial-insights', $admin['href']);

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($this->user('STUDENT', $org->id));
        $student = $this->evidence($this->objective($this->getJson('/api/objectives/overview')->json(), 'SO2.1'), 'Expense forecasts generated (OLS regression)');
        $this->assertNull($student['href']);
    }

    public function test_retired_evaluation_records_are_not_exposed_in_objective_evidence(): void
    {
        $org = Organization::factory()->create();
        $window = EvaluationWindow::create(['title' => 'Acceptability survey', 'status' => 'closed', 'opens_at' => now()->subMonth(), 'closes_at' => now()->subDay()]);
        $answers = ['acceptability' => 4];
        $respond = function () use ($window, $org, $answers) {
            EvaluationResponse::create([
                'evaluation_window_id' => $window->id,
                'organization_id' => $org->id,
                'user_id' => $this->user('SBO_OFFICER', $org->id)->school_id,
                'respondent_type' => 'officer',
                'consent_given_at' => now(),
                'profile' => [],
                'answers' => $answers,
                'submitted_at' => now(),
            ]);
        };
        $viewer = $this->user('ADMIN', $org->id);
        $acceptabilityRows = function () use ($viewer) {
            Cache::flush();
            $this->app['auth']->forgetGuards();
            Sanctum::actingAs($viewer);
            $so4 = $this->objective($this->getJson('/api/objectives/overview')->assertOk()->json(), 'SO4');

            return collect($so4['evidence'])->filter(fn ($item) => str_starts_with($item['label'], 'Overall acceptability'));
        };

        $respond();
        $respond();
        $this->assertCount(0, $acceptabilityRows(), 'two responses must stay withheld');

        $respond();
        $rows = $acceptabilityRows();
        $this->assertCount(0, $rows);
        $payload = $this->getJson('/api/objectives/overview')->assertOk()->json();
        $this->assertSame([], $this->objective($payload, 'SO1')['evidence']);
        $this->assertSame([], $this->objective($payload, 'SO4')['evidence']);
    }

    public function test_query_count_does_not_grow_with_organization_size(): void
    {
        $small = Organization::factory()->create();
        $large = Organization::factory()->create();
        $this->seedActivity($small, 1);
        $this->seedActivity($large, 25);

        $count = function (Organization $org): int {
            Cache::flush();
            $this->app['auth']->forgetGuards();
            Sanctum::actingAs($this->user('ADMIN', $org->id));
            DB::enableQueryLog();
            DB::flushQueryLog();
            $this->getJson('/api/objectives/overview')->assertOk();
            $queries = count(DB::getQueryLog());
            DB::disableQueryLog();

            return $queries;
        };

        $this->assertSame($count($small), $count($large));
    }
}
