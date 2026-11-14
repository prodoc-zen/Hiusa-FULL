<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Election;
use App\Models\ElectionBallot;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\Grievance;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DashboardInsightAuditFixesTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false, 'services.hiusa_ai.task_max_active_tasks' => 5]);
    }

    private function insight(User $user, string $engine): ?array
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user);

        return collect($this->getJson('/api/dashboard/briefing')->assertOk()->json('insights'))->firstWhere('engine', $engine);
    }

    private function officer(Organization $organization): User
    {
        return User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Officer', 'account_status' => 'active']);
    }

    private function activeElection(Organization $organization, $finalizedAt = null): Election
    {
        return Election::factory()->create([
            'organization_id' => $organization->id,
            'status' => 'active',
            'start_time' => now()->subHours(80),
            'end_time' => now()->addHours(20),
            'finalized_at' => $finalizedAt,
        ]);
    }

    public function test_workload_insight_names_the_overloaded_officer_even_when_over_the_limit(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Officer', 'is_active' => true]);
        $overloaded = $this->officer($organization);
        $this->officer($organization);
        foreach (range(1, 9) as $n) {
            Task::factory()->create(['organization_id' => $organization->id, 'assigned_to' => $overloaded->id, 'status' => 'pending', 'deadline' => now()->addWeek()]);
        }

        $workload = $this->insight($admin, 'task_workload_balance');

        $this->assertNotNull($workload);
        $this->assertSame(trim("{$overloaded->first_name} {$overloaded->last_name}"), $workload['why']['inputs']['busiest']['name']);
        $this->assertSame(9, $workload['why']['inputs']['busiest']['active_tasks']);
        $this->assertStringContainsString('the limit is 5', $workload['body']);
        $this->assertArrayNotHasKey('workload_score', $workload['why']['inputs']['busiest']);
    }

    public function test_officer_briefing_carries_no_workload_insight_about_peers(): void
    {
        $organization = Organization::factory()->create();
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Officer', 'is_active' => true]);
        $viewer = $this->officer($organization);
        $busy = $this->officer($organization);
        $this->officer($organization);
        foreach (range(1, 4) as $n) {
            Task::factory()->create(['organization_id' => $organization->id, 'assigned_to' => $busy->id, 'status' => 'pending', 'deadline' => now()->addWeek()]);
        }

        $this->assertNull($this->insight($viewer, 'task_workload_balance'));
        $this->assertNotNull($this->insight(User::factory()->admin()->create(['organization_id' => $organization->id]), 'task_workload_balance'));
    }

    public function test_forecast_insight_uses_plain_words_and_leaves_out_missing_inputs(): void
    {
        $thisMonth = now('Asia/Manila')->startOfMonth();
        $nextMonth = $thisMonth->copy()->addMonth();
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        FinancialForecast::factory()->create([
            'organization_id' => $organization->id,
            'forecast_period' => $thisMonth->format('Y-m'),
            'confidence_note' => null,
            'model_details' => ['engine' => 'python-fastapi', 'risk' => 'overspending', 'sample_months' => 2, 'fit_quality' => 'insufficient_data', 'income' => ['r_squared' => 0.12], 'expense' => ['r_squared' => 0.3]],
        ]);

        $forecast = $this->insight($admin, 'financial_forecast');

        $this->assertSame('Spending may outpace income in '.$thisMonth->format('F Y'), $forecast['title']);
        $this->assertSame(['months_of_records', 'how_far_to_trust_it'], array_keys($forecast['why']['inputs']));
        $this->assertSame(2, $forecast['why']['inputs']['months_of_records']);
        $this->assertSame('Based on only 2 months of records, and they follow no clear trend. Treat this projection as directional only.', $forecast['why']['inputs']['how_far_to_trust_it']);
        $this->assertSame('Spending is forecast to run ahead of income in '.$thisMonth->format('F Y').'. '.$forecast['why']['inputs']['how_far_to_trust_it'], $forecast['body']);

        FinancialForecast::factory()->create([
            'organization_id' => $organization->id,
            'forecast_period' => $nextMonth->format('Y-m'),
            'confidence_note' => 'Plain note.',
            'model_details' => ['engine' => 'php-fallback', 'risk' => 'deficit'],
        ]);
        $this->travel(1)->minutes();
        $deficit = $this->insight($admin, 'financial_forecast');
        $this->assertSame('A shortfall is possible in '.$nextMonth->format('F Y'), $deficit['title']);
        $this->assertSame(['how_far_to_trust_it'], array_keys($deficit['why']['inputs']));
    }

    public function test_a_forecast_for_a_past_month_or_a_manual_row_gives_no_forecast_insight(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $thisMonth = now('Asia/Manila')->startOfMonth();
        FinancialForecast::factory()->create([
            'organization_id' => $organization->id,
            'forecast_period' => $thisMonth->copy()->subMonths(2)->format('Y-m'),
            'model_details' => ['engine' => 'python-fastapi', 'risk' => 'stable'],
        ]);
        FinancialForecast::factory()->create([
            'organization_id' => $organization->id,
            'forecast_period' => $thisMonth->format('Y-m'),
            'model_details' => ['risk' => 'stable'],
        ]);

        $this->assertNull($this->insight($admin, 'financial_forecast'));
    }

    public function test_the_event_financial_summary_ignores_a_forecast_for_a_past_month(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $event = Event::factory()->create(['organization_id' => $organization->id, 'status' => 'approved']);
        FinancialForecast::factory()->create([
            'organization_id' => $organization->id,
            'forecast_period' => now('Asia/Manila')->startOfMonth()->subMonths(2)->format('Y-m'),
            'model_details' => ['engine' => 'python-fastapi', 'risk' => 'stable'],
        ]);
        Sanctum::actingAs($admin);

        $this->getJson("/api/events/{$event->id}")->assertOk()->assertJsonPath('financial_summary.latest_forecast', null);
    }

    public function test_turnout_insight_counts_the_same_voter_roll_as_manage_voters(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->activeElection($organization);
        $otherOrganization = Organization::factory()->create();
        foreach (range(1, 2) as $n) {
            User::factory()->student()->create(['organization_id' => $organization->id]);
            $member = User::factory()->student()->create(['organization_id' => $otherOrganization->id]);
            $member->accountProfiles()->create(['organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        }
        $roll = AccountProfile::onVoterRoll(null)->where('account_profiles.organization_id', $organization->id)->count();

        $turnout = $this->insight($admin, 'election_turnout_pace');

        $this->assertNotNull($turnout);
        $this->assertSame($roll, $turnout['why']['inputs']['eligible_total']);
        $this->assertGreaterThan(2, $turnout['why']['inputs']['eligible_total']);
    }

    public function test_turnout_insight_ignores_members_who_joined_after_the_ballot_was_finalized(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $voters = collect(range(1, 4))->map(fn () => User::factory()->student()->create(['organization_id' => $organization->id]));
        $election = $this->activeElection($organization, now()->subDay());
        foreach ($voters->take(3) as $voter) {
            ElectionBallot::factory()->create(['election_id' => $election->id, 'round' => 1, 'voter_id' => $voter->school_id]);
        }
        $this->travel(1)->minutes();
        foreach (range(1, 2) as $n) {
            User::factory()->student()->create(['organization_id' => $organization->id]);
        }
        $organization->accountProfiles()->update(['created_at' => now()]);
        $organization->accountProfiles()->whereIn('user_school_id', $voters->pluck('school_id'))->update(['created_at' => now()->subDays(3)]);

        $this->assertNull($this->insight($admin, 'election_turnout_pace'), '3 of the 4 members on the roll voted, so turnout is not behind pace.');
    }

    public function test_admin_briefing_lists_open_grievances_against_the_organization_without_the_filer(): void
    {
        $organization = Organization::factory()->create();
        $other = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $make = fn (Organization $org, string $status, string $urgency, bool $anonymous = true) => Grievance::create([
            'organization_id' => $org->id, 'submitted_by' => $student->school_id, 'title' => 'Concern', 'description' => 'Details',
            'category' => 'General', 'urgency' => $urgency, 'status' => $status, 'is_anonymous' => $anonymous,
        ]);
        $make($other, 'submitted', 'Critical');
        $make($organization, 'resolved', 'Critical');
        $make($organization, 'dismissed', 'High');
        $deleted = $make($organization, 'submitted', 'High');
        $deleted->delete();
        $only = $make($organization, 'under_review', 'Low');

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($admin);
        $item = collect($this->getJson('/api/dashboard/briefing')->assertOk()->json('attention'))->firstWhere('type', 'grievances_open');

        $this->assertSame(1, $item['count']);
        $this->assertSame('medium', $item['severity']);
        $this->assertSame("/dashboard/grievances?record={$only->id}", $item['href']);
        $this->assertSame('1 grievance filed against your organization is unresolved. You review it and decide the outcome.', $item['detail']);
        $this->assertStringNotContainsString($student->first_name, json_encode($item));
        $this->assertStringNotContainsString($student->school_id, json_encode($item));

        $make($organization, 'submitted', 'Critical', false);
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($admin);
        $item = collect($this->getJson('/api/dashboard/briefing')->assertOk()->json('attention'))->firstWhere('type', 'grievances_open');
        $this->assertSame(2, $item['count']);
        $this->assertSame('high', $item['severity']);
        $this->assertSame('/dashboard/grievances', $item['href']);
        $this->assertSame('2 grievances filed against your organization are unresolved, 1 of them marked high or critical. You review each one and decide the outcome.', $item['detail']);
    }

    public function test_sao_briefing_carries_no_insights_and_never_runs_the_university_budget_query(): void
    {
        $organization = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION']);
        $sao = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SUPER_ADMIN', 'account_status' => 'active']);

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($sao);
        \DB::enableQueryLog();
        $this->assertSame([], $this->getJson('/api/dashboard/briefing')->assertOk()->json('insights'));
        $distinct = collect(\DB::getQueryLog())->filter(fn ($query) => str_contains($query['query'], 'count(distinct "organization_id")') && str_contains($query['query'], 'from "budgets"'));
        \DB::disableQueryLog();

        $this->assertCount(0, $distinct);
    }
}
