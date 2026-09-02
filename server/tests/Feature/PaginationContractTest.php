<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\FinancialReport;
use App\Models\Merchandise;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PaginationContractTest extends TestCase
{
    use RefreshDatabase;

    private function organization(): Organization
    {
        return Organization::factory()->create();
    }

    private function actor(int $organizationId, string $role): User
    {
        return User::factory()->create(['organization_id' => $organizationId, 'role' => $role]);
    }

    /**
     * Every field a client can rely on for a plain paginated list: the rows
     * on this page, and enough metadata to compute an org-wide total without
     * fetching every page.
     */
    private function assertPaginationEnvelope(TestResponse $response, int $expectedPerPage, int $expectedTotal): void
    {
        $response->assertOk()->assertJsonStructure([
            'data', 'current_page', 'last_page', 'per_page', 'total',
        ]);
        $this->assertSame($expectedPerPage, (int) $response->json('per_page'));
        $this->assertSame($expectedTotal, (int) $response->json('total'));
    }

    private function assertPagesDisjoint(array $page1Ids, array $page2Ids): void
    {
        $this->assertNotEmpty($page1Ids);
        $this->assertNotEmpty($page2Ids);
        $this->assertEmpty(array_intersect($page1Ids, $page2Ids), 'Page 2 must not repeat rows already on page 1.');
    }

    // --- 1. Announcements ---

    public function test_announcements_index_is_paginated_org_scoped_and_honors_per_page(): void
    {
        $org = $this->organization();
        $admin = $this->actor($org->id, 'ADMIN');

        Announcement::factory()->count(20)->create([
            'organization_id' => $org->id,
            'created_by' => $admin->school_id,
            'category' => 'general',
            'target_role' => 'all',
            'is_published' => true,
            'approval_status' => 'approved',
        ]);
        Announcement::factory()->count(5)->create([
            'organization_id' => $org->id,
            'created_by' => $admin->school_id,
            'category' => 'election',
            'target_role' => 'all',
            'is_published' => true,
            'approval_status' => 'approved',
        ]);

        $otherOrg = $this->organization();
        $otherAdmin = $this->actor($otherOrg->id, 'ADMIN');
        Announcement::factory()->count(3)->create([
            'organization_id' => $otherOrg->id,
            'created_by' => $otherAdmin->school_id,
        ]);

        Sanctum::actingAs($admin);

        $page1 = $this->getJson('/api/announcements');
        $this->assertPaginationEnvelope($page1, 20, 25);
        $page1->assertJsonCount(20, 'data');

        $page2 = $this->getJson('/api/announcements?page=2');
        $page2->assertJsonCount(5, 'data');
        $this->assertPagesDisjoint($page1->json('data.*.id'), $page2->json('data.*.id'));

        $filtered = $this->getJson('/api/announcements?category=election');
        $this->assertSame(5, (int) $filtered->json('total'));

        $custom = $this->getJson('/api/announcements?per_page=5');
        $this->assertSame(5, (int) $custom->json('per_page'));
        $custom->assertJsonCount(5, 'data');

        $this->getJson('/api/announcements?per_page=101')->assertStatus(422);
    }

    public function test_announcements_index_requires_authentication(): void
    {
        $this->getJson('/api/announcements')->assertUnauthorized();
    }

    // --- 2. Events ---

    public function test_events_index_is_paginated_org_scoped_and_status_filtered_for_students(): void
    {
        $org = $this->organization();
        $admin = $this->actor($org->id, 'ADMIN');
        $student = $this->actor($org->id, 'STUDENT');

        Event::factory()->count(20)->create([
            'organization_id' => $org->id,
            'created_by' => $admin->school_id,
            'status' => 'approved',
        ]);
        Event::factory()->count(5)->create([
            'organization_id' => $org->id,
            'created_by' => $admin->school_id,
            'status' => 'planning',
        ]);

        $otherOrg = $this->organization();
        $otherAdmin = $this->actor($otherOrg->id, 'ADMIN');
        Event::factory()->count(3)->create([
            'organization_id' => $otherOrg->id,
            'created_by' => $otherAdmin->school_id,
            'status' => 'approved',
        ]);

        Sanctum::actingAs($admin);

        $page1 = $this->getJson('/api/events');
        $this->assertPaginationEnvelope($page1, 20, 25);
        $page1->assertJsonCount(20, 'data');

        $page2 = $this->getJson('/api/events?page=2');
        $page2->assertJsonCount(5, 'data');
        $this->assertPagesDisjoint($page1->json('data.*.id'), $page2->json('data.*.id'));

        $custom = $this->getJson('/api/events?per_page=5');
        $this->assertSame(5, (int) $custom->json('per_page'));
        $custom->assertJsonCount(5, 'data');

        $this->getJson('/api/events?per_page=101')->assertStatus(422);

        // Students only see approved/ongoing/completed events, so the total
        // for the exact same organization must be smaller than the admin's.
        Sanctum::actingAs($student);
        $studentView = $this->getJson('/api/events');
        $this->assertSame(20, (int) $studentView->json('total'));
    }

    public function test_events_index_requires_authentication(): void
    {
        $this->getJson('/api/events')->assertUnauthorized();
    }

    // --- 3. Tasks ---

    public function test_tasks_index_is_paginated_and_status_filter_composes_with_pagination(): void
    {
        $org = $this->organization();
        $admin = $this->actor($org->id, 'ADMIN');
        $officer = $this->actor($org->id, 'SBO_OFFICER');

        Task::factory()->count(15)->create([
            'organization_id' => $org->id,
            'created_by' => $admin->school_id,
            'assigned_to' => $officer->school_id,
            'status' => 'pending',
        ]);
        Task::factory()->count(10)->create([
            'organization_id' => $org->id,
            'created_by' => $admin->school_id,
            'assigned_to' => $officer->school_id,
            'status' => 'completed',
        ]);

        $otherOrg = $this->organization();
        $otherAdmin = $this->actor($otherOrg->id, 'ADMIN');
        $otherOfficer = $this->actor($otherOrg->id, 'SBO_OFFICER');
        Task::factory()->count(2)->create([
            'organization_id' => $otherOrg->id,
            'created_by' => $otherAdmin->school_id,
            'assigned_to' => $otherOfficer->school_id,
        ]);

        Sanctum::actingAs($admin);

        $page1 = $this->getJson('/api/tasks');
        $this->assertPaginationEnvelope($page1, 20, 25);
        $page1->assertJsonCount(20, 'data');

        $page2 = $this->getJson('/api/tasks?page=2');
        $page2->assertJsonCount(5, 'data');
        $this->assertPagesDisjoint($page1->json('data.*.id'), $page2->json('data.*.id'));

        $filtered = $this->getJson('/api/tasks?status=completed');
        $this->assertSame(10, (int) $filtered->json('total'));
        $filtered->assertJsonCount(10, 'data');

        $custom = $this->getJson('/api/tasks?per_page=5');
        $this->assertSame(5, (int) $custom->json('per_page'));

        $this->getJson('/api/tasks?per_page=101')->assertStatus(422);

        Sanctum::actingAs($this->actor($org->id, 'STUDENT'));
        $this->getJson('/api/tasks')->assertForbidden();
    }

    // --- 4. Budgets ---

    public function test_budgets_index_is_paginated_org_scoped_and_honors_per_page(): void
    {
        $org = $this->organization();
        $admin = $this->actor($org->id, 'ADMIN');

        Budget::factory()->count(25)->create(['organization_id' => $org->id]);

        $otherOrg = $this->organization();
        Budget::factory()->count(3)->create(['organization_id' => $otherOrg->id]);

        Sanctum::actingAs($admin);

        $page1 = $this->getJson('/api/budgets');
        $this->assertPaginationEnvelope($page1, 20, 25);
        $page1->assertJsonCount(20, 'data');

        $page2 = $this->getJson('/api/budgets?page=2');
        $page2->assertJsonCount(5, 'data');
        $this->assertPagesDisjoint($page1->json('data.*.id'), $page2->json('data.*.id'));

        $custom = $this->getJson('/api/budgets?per_page=5');
        $this->assertSame(5, (int) $custom->json('per_page'));

        $this->getJson('/api/budgets?per_page=101')->assertStatus(422);

        Sanctum::actingAs($this->actor($org->id, 'STUDENT'));
        $this->getJson('/api/budgets')->assertForbidden();
    }

    // --- 5. Financial forecasts ---

    public function test_forecasts_index_is_paginated_org_scoped_and_honors_per_page(): void
    {
        $org = $this->organization();
        $admin = $this->actor($org->id, 'ADMIN');

        FinancialForecast::factory()->count(25)->create(['organization_id' => $org->id]);

        $otherOrg = $this->organization();
        FinancialForecast::factory()->count(3)->create(['organization_id' => $otherOrg->id]);

        Sanctum::actingAs($admin);

        $page1 = $this->getJson('/api/forecasts');
        $this->assertPaginationEnvelope($page1, 20, 25);
        $page1->assertJsonCount(20, 'data');

        $page2 = $this->getJson('/api/forecasts?page=2');
        $page2->assertJsonCount(5, 'data');
        $this->assertPagesDisjoint($page1->json('data.*.id'), $page2->json('data.*.id'));

        $custom = $this->getJson('/api/forecasts?per_page=5');
        $this->assertSame(5, (int) $custom->json('per_page'));

        $this->getJson('/api/forecasts?per_page=101')->assertStatus(422);

        Sanctum::actingAs($this->actor($org->id, 'STUDENT'));
        $this->getJson('/api/forecasts')->assertForbidden();
    }

    // --- 6. Financial reports ---

    public function test_financial_reports_index_is_paginated_org_scoped_and_honors_per_page(): void
    {
        $org = $this->organization();
        $admin = $this->actor($org->id, 'ADMIN');

        for ($i = 0; $i < 25; $i++) {
            FinancialReport::create([
                'organization_id' => $org->id,
                'report_type' => 'monthly',
                'title' => "Monthly Report {$i}",
            ]);
        }

        $otherOrg = $this->organization();
        for ($i = 0; $i < 3; $i++) {
            FinancialReport::create([
                'organization_id' => $otherOrg->id,
                'report_type' => 'monthly',
                'title' => "Other Org Report {$i}",
            ]);
        }

        Sanctum::actingAs($admin);

        $page1 = $this->getJson('/api/financial-reports');
        $this->assertPaginationEnvelope($page1, 20, 25);
        $page1->assertJsonCount(20, 'data');

        $page2 = $this->getJson('/api/financial-reports?page=2');
        $page2->assertJsonCount(5, 'data');
        $this->assertPagesDisjoint($page1->json('data.*.id'), $page2->json('data.*.id'));

        $custom = $this->getJson('/api/financial-reports?per_page=5');
        $this->assertSame(5, (int) $custom->json('per_page'));

        $this->getJson('/api/financial-reports?per_page=101')->assertStatus(422);

        Sanctum::actingAs($this->actor($org->id, 'STUDENT'));
        $this->getJson('/api/financial-reports')->assertForbidden();
    }

    // --- 7. Merchandise ---

    public function test_merchandise_index_is_paginated_org_scoped_and_hides_inactive_items_from_students(): void
    {
        $org = $this->organization();
        $admin = $this->actor($org->id, 'ADMIN');
        $student = $this->actor($org->id, 'STUDENT');

        Merchandise::factory()->count(20)->create(['organization_id' => $org->id, 'is_active' => true]);
        Merchandise::factory()->count(5)->create(['organization_id' => $org->id, 'is_active' => false]);

        $otherOrg = $this->organization();
        Merchandise::factory()->count(3)->create(['organization_id' => $otherOrg->id, 'is_active' => true]);

        Sanctum::actingAs($admin);

        $page1 = $this->getJson('/api/merchandise');
        $this->assertPaginationEnvelope($page1, 20, 25);
        $page1->assertJsonCount(20, 'data');

        $page2 = $this->getJson('/api/merchandise?page=2');
        $page2->assertJsonCount(5, 'data');
        $this->assertPagesDisjoint($page1->json('data.*.id'), $page2->json('data.*.id'));

        $custom = $this->getJson('/api/merchandise?per_page=5');
        $this->assertSame(5, (int) $custom->json('per_page'));

        $this->getJson('/api/merchandise?per_page=101')->assertStatus(422);

        Sanctum::actingAs($student);
        $studentView = $this->getJson('/api/merchandise');
        $this->assertSame(20, (int) $studentView->json('total'));
    }

    public function test_merchandise_index_requires_authentication(): void
    {
        $this->getJson('/api/merchandise')->assertUnauthorized();
    }

    // --- 8. Approval requests ---

    public function test_approval_requests_index_is_paginated_and_status_filter_composes_with_pagination(): void
    {
        $org = $this->organization();
        $admin = $this->actor($org->id, 'ADMIN');

        for ($i = 0; $i < 25; $i++) {
            ApprovalRequest::create([
                'organization_id' => $org->id,
                'entity_type' => 'budget',
                'entity_id' => $i + 1000,
                'requested_by' => $admin->school_id,
                'required_role' => 'ADMIN',
                'status' => 'pending',
            ]);
        }
        for ($i = 0; $i < 5; $i++) {
            ApprovalRequest::create([
                'organization_id' => $org->id,
                'entity_type' => 'budget',
                'entity_id' => $i + 2000,
                'requested_by' => $admin->school_id,
                'required_role' => 'ADMIN',
                'status' => 'approved',
                'reviewed_by' => $admin->school_id,
            ]);
        }

        $otherOrg = $this->organization();
        $otherAdmin = $this->actor($otherOrg->id, 'ADMIN');
        ApprovalRequest::create([
            'organization_id' => $otherOrg->id,
            'entity_type' => 'budget',
            'entity_id' => 3000,
            'requested_by' => $otherAdmin->school_id,
            'required_role' => 'ADMIN',
            'status' => 'pending',
        ]);

        Sanctum::actingAs($admin);

        // Default status filter is "pending".
        $page1 = $this->getJson('/api/approval-requests');
        $this->assertPaginationEnvelope($page1, 20, 25);
        $page1->assertJsonCount(20, 'data');

        $page2 = $this->getJson('/api/approval-requests?page=2');
        $page2->assertJsonCount(5, 'data');
        $this->assertPagesDisjoint($page1->json('data.*.id'), $page2->json('data.*.id'));

        $all = $this->getJson('/api/approval-requests?status=all');
        $this->assertSame(30, (int) $all->json('total'));

        $custom = $this->getJson('/api/approval-requests?per_page=5');
        $this->assertSame(5, (int) $custom->json('per_page'));

        $this->getJson('/api/approval-requests?per_page=101')->assertStatus(422);

        Sanctum::actingAs($this->actor($org->id, 'SBO_OFFICER'));
        $this->getJson('/api/approval-requests')->assertForbidden();
    }

    // --- 9. Notifications ---

    public function test_notifications_index_is_paginated_and_reports_unread_count_separately_from_total(): void
    {
        $org = $this->organization();
        $student = $this->actor($org->id, 'STUDENT');

        Notification::factory()->count(15)->create([
            'organization_id' => $org->id,
            'user_id' => $student->school_id,
            'is_read' => false,
        ]);
        Notification::factory()->count(10)->create([
            'organization_id' => $org->id,
            'user_id' => $student->school_id,
            'is_read' => true,
        ]);

        $otherStudent = $this->actor($org->id, 'STUDENT');
        Notification::factory()->count(3)->create([
            'organization_id' => $org->id,
            'user_id' => $otherStudent->school_id,
            'is_read' => false,
        ]);

        Sanctum::actingAs($student);

        $page1 = $this->getJson('/api/notifications');
        $this->assertPaginationEnvelope($page1, 20, 25);
        $page1->assertJsonCount(20, 'data');
        $this->assertSame(15, (int) $page1->json('unread_count'));

        $page2 = $this->getJson('/api/notifications?page=2');
        $page2->assertJsonCount(5, 'data');
        $this->assertPagesDisjoint($page1->json('data.*.id'), $page2->json('data.*.id'));

        $custom = $this->getJson('/api/notifications?per_page=5');
        $this->assertSame(5, (int) $custom->json('per_page'));

        $this->getJson('/api/notifications?per_page=101')->assertStatus(422);
    }

    public function test_notifications_index_requires_authentication(): void
    {
        $this->getJson('/api/notifications')->assertUnauthorized();
    }

    // --- 10. Users ---

    public function test_users_index_is_paginated_and_reports_role_counts_for_the_filtered_set(): void
    {
        $org = $this->organization();
        $admin = $this->actor($org->id, 'ADMIN');

        User::factory()->count(24)->create(['organization_id' => $org->id, 'role' => 'STUDENT']);

        $otherOrg = $this->organization();
        User::factory()->count(5)->create(['organization_id' => $otherOrg->id, 'role' => 'STUDENT']);

        Sanctum::actingAs($admin);

        // 24 students + the acting admin = 25 organization-scoped users.
        $page1 = $this->getJson('/api/users');
        $this->assertPaginationEnvelope($page1, 20, 25);
        $page1->assertJsonCount(20, 'data');
        $this->assertSame(24, (int) $page1->json('summary.by_role.STUDENT'));
        $this->assertSame(1, (int) $page1->json('summary.by_role.ADMIN'));

        $page2 = $this->getJson('/api/users?page=2');
        $page2->assertJsonCount(5, 'data');
        $this->assertPagesDisjoint($page1->json('data.*.school_id'), $page2->json('data.*.school_id'));

        // Filtering by role must shrink both the total and the role summary together.
        $filtered = $this->getJson('/api/users?role=STUDENT');
        $this->assertSame(24, (int) $filtered->json('total'));
        $this->assertSame(24, (int) $filtered->json('summary.by_role.STUDENT'));
        $this->assertNull($filtered->json('summary.by_role.ADMIN'));

        $custom = $this->getJson('/api/users?per_page=5');
        $this->assertSame(5, (int) $custom->json('per_page'));

        $this->getJson('/api/users?per_page=101')->assertStatus(422);

        Sanctum::actingAs($this->actor($org->id, 'STUDENT'));
        $this->getJson('/api/users')->assertForbidden();
    }

    // --- 11 & 12. Deliberately left unpaginated ---

    public function test_organizations_index_stays_a_bare_unpaginated_array(): void
    {
        Organization::factory()->count(25)->create(['is_active' => true]);

        $response = $this->getJson('/api/organizations')->assertOk();

        $body = $response->json();
        $this->assertIsArray($body);
        $this->assertArrayNotHasKey('data', $body);
        $this->assertArrayHasKey(0, $body);
        $this->assertCount(25, $body);
    }

    public function test_sbo_positions_index_stays_a_bare_unpaginated_array(): void
    {
        $org = $this->organization();
        $admin = $this->actor($org->id, 'ADMIN');

        for ($i = 0; $i < 25; $i++) {
            SboPosition::create([
                'organization_id' => $org->id,
                'title' => "Position {$i}",
                'is_active' => true,
            ]);
        }

        Sanctum::actingAs($admin);

        $response = $this->getJson('/api/sbo-positions')->assertOk();

        $body = $response->json();
        $this->assertIsArray($body);
        $this->assertArrayNotHasKey('data', $body);
        $this->assertArrayHasKey(0, $body);
        $this->assertCount(25, $body);
    }
}
