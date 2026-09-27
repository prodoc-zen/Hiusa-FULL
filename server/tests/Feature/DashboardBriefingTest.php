<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Election;
use App\Models\Event;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DashboardBriefingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // These tests mutate data between two GETs of the same route for the
        // same user and expect the second response to reflect that mutation.
        // CacheApiResponse's short-lived per-identity cache would otherwise
        // hand back the first (now stale) response, since nothing in these
        // tests goes through the real write endpoints that bump the
        // organization's cache version.
        config(['performance.api_cache.enabled' => false]);
    }

    public function test_admin_briefing_shape_and_seeded_attention_conditions(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $requester = User::factory()->officer()->create(['organization_id' => $organization->id]);

        // Pending approval requiring ADMIN action.
        ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'announcement',
            'entity_id' => Announcement::factory()->create(['organization_id' => $organization->id, 'created_by' => $requester->id])->id,
            'requested_by' => $requester->id,
            'required_role' => 'ADMIN',
            'status' => 'pending',
            'requested_at' => now()->subHours(50), // ages into "high" severity
        ]);

        // Election closing within 72h (well within 24h -> high severity).
        Election::factory()->create([
            'organization_id' => $organization->id,
            'title' => 'Closing Soon Election',
            'status' => 'active',
            'start_time' => now()->subDay(),
            'end_time' => now()->addHours(20),
        ]);

        // Budget at 85% utilization.
        Budget::factory()->create([
            'organization_id' => $organization->id,
            'title' => 'Foundation Week Budget',
            'allocated_amount' => 1000,
            'remaining_amount' => 150,
        ]);

        // Overdue task.
        Task::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->id,
            'assigned_to' => $requester->id,
            'status' => 'overdue',
            'deadline' => now()->subDay(),
        ]);

        Sanctum::actingAs($admin);
        $response = $this->getJson('/api/dashboard/briefing')->assertOk();

        $response->assertJsonStructure([
            'user' => ['first_name', 'role', 'organization'],
            'summary' => ['attention_count', 'headline'],
            'attention',
            'pillars' => ['finance', 'events', 'tasks', 'elections', 'merchandise', 'communication'],
            'insights',
            'agenda',
            'activity',
        ]);
        $response->assertJsonMissingPath('organizations');
        $response->assertJsonPath('user.role', 'ADMIN');
        $response->assertJsonPath('user.organization.abbreviation', $organization->acronym);

        $types = collect($response->json('attention'))->pluck('type');
        $this->assertContains('approval', $types->all());
        $this->assertContains('election_closing', $types->all());
        $this->assertContains('budget_utilization', $types->all());
        $this->assertContains('task_overdue', $types->all());

        $closingElection = collect($response->json('attention'))->firstWhere('type', 'election_closing');
        $this->assertSame('high', $closingElection['severity']);

        $budgetItem = collect($response->json('attention'))->firstWhere('type', 'budget_utilization');
        $this->assertSame('medium', $budgetItem['severity']);

        $this->assertSame(count($response->json('attention')), $response->json('summary.attention_count'));
        $this->assertStringContainsString('need you today.', $response->json('summary.headline'));
        $this->assertLessThanOrEqual(8, count($response->json('attention')));
        $this->assertLessThanOrEqual(3, count($response->json('insights')));
    }

    public function test_super_admin_briefing_shape_and_organizations_overview(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'acronym' => 'SAO']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);

        $orgA = Organization::factory()->create(['name' => 'Org Alpha', 'acronym' => 'ALPHA']);
        $orgB = Organization::factory()->create(['name' => 'Org Beta', 'acronym' => 'BETA']);
        Budget::factory()->create(['organization_id' => $orgA->id, 'allocated_amount' => 1000, 'remaining_amount' => 200]);
        Election::factory()->create(['organization_id' => $orgB->id, 'status' => 'active', 'start_time' => now()->subDay(), 'end_time' => now()->addDay()]);

        Sanctum::actingAs($director);
        $response = $this->getJson('/api/dashboard/briefing')->assertOk();

        $response->assertJsonStructure([
            'user', 'summary', 'attention', 'pillars' => ['finance', 'elections', 'events', 'communication'], 'insights', 'agenda', 'activity', 'organizations',
        ]);

        $organizations = collect($response->json('organizations'));
        $this->assertSame(2, $organizations->count());
        $this->assertFalse($organizations->contains('id', $sao->id));

        $alpha = $organizations->firstWhere('id', $orgA->id);
        $this->assertSame('ALPHA', $alpha['abbreviation']);
        $this->assertEqualsWithDelta(80.0, $alpha['budget_utilization_percent'], 0.01);
        $this->assertNull($alpha['accreditation_status']);

        $beta = $organizations->firstWhere('id', $orgB->id);
        $this->assertSame(1, $beta['open_elections']);
    }

    public function test_sbo_officer_briefing_shape(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $item = Merchandise::factory()->create();

        Order::factory()->create([
            'organization_id' => $organization->id,
            'student_id' => $student->id,
            'merchandise_id' => $item->id,
            'status' => 'pending',
            'officer_review_status' => 'pending',
            'admin_review_status' => 'pending',
            'payment_proof_url' => '/uploads/proof.jpg',
        ]);

        Task::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $officer->id,
            'assigned_to' => $officer->id,
            'status' => 'pending',
            'deadline' => now()->addHours(6),
        ]);

        Sanctum::actingAs($officer);
        $response = $this->getJson('/api/dashboard/briefing')->assertOk();

        $response->assertJsonStructure([
            'pillars' => ['events', 'tasks', 'merchandise', 'communication', 'finance'],
        ]);
        $response->assertJsonMissingPath('organizations');

        $types = collect($response->json('attention'))->pluck('type');
        $this->assertContains('order_verification', $types->all());
        $this->assertContains('task_due_soon', $types->all());
    }

    public function test_department_head_briefing_shape(): void
    {
        $organization = Organization::factory()->create();
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'event',
            'entity_id' => Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id])->id,
            'requested_by' => $admin->id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'pending',
            'requested_at' => now()->subHour(),
        ]);

        Sanctum::actingAs($departmentHead);
        $response = $this->getJson('/api/dashboard/briefing')->assertOk();

        $response->assertJsonStructure(['pillars' => ['finance', 'events', 'elections', 'communication']]);
        $types = collect($response->json('attention'))->pluck('type');
        $this->assertContains('approval', $types->all());
    }

    public function test_student_briefing_open_election_attention_clears_after_voting(): void
    {
        $organization = Organization::factory()->create();
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $election = Election::factory()->create([
            'organization_id' => $organization->id,
            'title' => 'Student Council Election',
            'status' => 'active',
            'start_time' => now()->subDay(),
            'end_time' => now()->addDays(3),
        ]);

        Sanctum::actingAs($student);
        $before = $this->getJson('/api/dashboard/briefing')->assertOk();
        $typesBefore = collect($before->json('attention'))->pluck('type');
        $this->assertContains('election_open', $typesBefore->all());

        Vote::factory()->create([
            'election_id' => $election->id,
            'voter_id' => $student->id,
        ]);

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($student);
        $after = $this->getJson('/api/dashboard/briefing')->assertOk();
        $typesAfter = collect($after->json('attention'))->pluck('type');
        $this->assertNotContains('election_open', $typesAfter->all());
    }

    public function test_cross_organization_isolation(): void
    {
        $organizationA = Organization::factory()->create();
        $organizationB = Organization::factory()->create();
        $adminA = User::factory()->admin()->create(['organization_id' => $organizationA->id]);

        Budget::factory()->create(['organization_id' => $organizationB->id, 'title' => 'Org B Budget', 'allocated_amount' => 5000, 'remaining_amount' => 100]);
        Task::factory()->create(['organization_id' => $organizationB->id, 'status' => 'overdue', 'deadline' => now()->subDay()]);
        Event::factory()->create(['organization_id' => $organizationB->id, 'status' => 'approved', 'start_time' => now()->addDay(), 'end_time' => now()->addDay()->addHours(2)]);

        Sanctum::actingAs($adminA);
        $response = $this->getJson('/api/dashboard/briefing')->assertOk();

        $this->assertSame(0, $response->json('summary.attention_count'));
        $this->assertSame("You're all caught up.", $response->json('summary.headline'));
        $this->assertEquals(0, $response->json('pillars.finance.value'));
        $this->assertSame([], $response->json('agenda'));

        $detailStrings = collect($response->json('attention'))->pluck('detail')->implode(' ');
        $this->assertStringNotContainsString('Org B Budget', $detailStrings);
    }

    public function test_headline_reflects_zero_and_nonzero_attention_counts(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($admin);
        $empty = $this->getJson('/api/dashboard/briefing')->assertOk();
        $this->assertSame(0, $empty->json('summary.attention_count'));
        $this->assertSame("You're all caught up.", $empty->json('summary.headline'));

        Task::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->id,
            'status' => 'overdue',
            'deadline' => now()->subDay(),
        ]);

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($admin);
        $nonEmpty = $this->getJson('/api/dashboard/briefing')->assertOk();
        $this->assertSame(1, $nonEmpty->json('summary.attention_count'));
        $this->assertStringContainsString('One overdue task needs you today.', $nonEmpty->json('summary.headline'));
    }

    public function test_briefing_query_count_stays_bounded_as_organization_history_grows(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $officers = User::factory()->officer()->count(3)->create(['organization_id' => $organization->id]);

        $this->seedOrganizationVolume($organization->id, $admin->id, $officers, count: 15);

        Sanctum::actingAs($admin);
        DB::enableQueryLog();
        $this->getJson('/api/dashboard/briefing')->assertOk();
        $firstCount = count(DB::getQueryLog());
        DB::flushQueryLog();
        DB::disableQueryLog();

        $this->seedOrganizationVolume($organization->id, $admin->id, $officers, count: 60);

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($admin);
        DB::enableQueryLog();
        $this->getJson('/api/dashboard/briefing')->assertOk();
        $secondCount = count(DB::getQueryLog());
        DB::disableQueryLog();

        // Not a strict equality: Sanctum::actingAs() reuses the same
        // in-memory $admin object for both requests, so the organization
        // relation lazily caches on whichever call touches it first and is
        // reused (no query) on the other - a one-query, direction-agnostic
        // artifact of that reuse, not of the 4x larger seeded volume. What
        // actually matters is that the second call, against far more
        // records, issues no *more* queries than the first.
        $this->assertLessThanOrEqual($firstCount, $secondCount, 'Query count must not grow with total record volume.');
        $this->assertLessThan(60, $secondCount, 'The briefing must aggregate, not fan out per row.');
    }

    private function seedOrganizationVolume(int $organizationId, int $adminId, $officers, int $count): void
    {
        for ($i = 0; $i < $count; $i++) {
            $officer = $officers[$i % $officers->count()];
            Budget::factory()->create(['organization_id' => $organizationId, 'allocated_amount' => 1000, 'remaining_amount' => 500]);
            Task::factory()->create(['organization_id' => $organizationId, 'created_by' => $adminId, 'assigned_to' => $officer->id, 'status' => 'pending', 'deadline' => now()->addWeek()]);
            Event::factory()->create(['organization_id' => $organizationId, 'created_by' => $adminId, 'status' => 'approved', 'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(2)]);
            // Transaction::create() directly, not Transaction::factory(): the
            // factory's definition() unconditionally evaluates
            // fake()->optional()->unique()->bothify(...) for receipt_reference,
            // and Faker's optional() proxy can resolve that whole chain to
            // null before bothify() runs - independent of any attribute
            // override - fataling under repeated factory calls in this loop.
            Transaction::create([
                'organization_id' => $organizationId,
                'recorded_by' => $adminId,
                'type' => 'income',
                'category' => 'membership',
                'amount' => 100,
                'description' => 'Seeded volume transaction',
                'transaction_date' => now(),
            ]);
            Announcement::factory()->create(['organization_id' => $organizationId, 'created_by' => $adminId, 'is_published' => true, 'published_at' => now(), 'target_role' => 'all']);
        }
    }
}
