<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\FinancialReport;
use App\Models\Invoice;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\AskAiService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class AskAiBuildersAuditFixesTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private function org(array $overrides = []): Organization
    {
        return Organization::factory()->create([
            'organization_type' => 'STUDENT_ORGANIZATION',
            'lifecycle_status' => 'active',
            'is_active' => true,
            ...$overrides,
        ]);
    }

    private function sao(): User
    {
        $home = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);

        return User::factory()->superAdmin()->create(['organization_id' => $home->id]);
    }

    private function answer(User $user, string $intent): array
    {
        return $this->app->make(AskAiService::class)->deterministicAnswer($user, 'Give me the status please', $intent);
    }

    private function highlight(array $payload, string $label): ?string
    {
        return collect($payload['highlights'])->firstWhere('label', $label)['value'] ?? null;
    }

    private function section(array $payload, string $id): array
    {
        return collect($payload['sections'])->firstWhere('id', $id);
    }

    private function approval(Organization $org, User $requester, string $requiredRole, string $entityType = 'event', array $overrides = []): ApprovalRequest
    {
        static $entityId = 5000;
        $entityId++;

        return ApprovalRequest::create([
            'organization_id' => $org->id,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'required_role' => $requiredRole,
            'requested_by' => $requester->school_id,
            'status' => 'pending',
            'requested_at' => now()->subDay(),
            ...$overrides,
        ]);
    }

    private function semester(): AcademicSemester
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);

        return AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
    }

    private function assertNoPluralPlaceholders(array $payload): void
    {
        $text = ($payload['answer'] ?? '').json_encode(collect($payload['sections'])->pluck('description')->all());
        $this->assertDoesNotMatchRegularExpression('/\w\(s\)/', $text);
    }

    public function test_an_org_admin_only_counts_requests_that_wait_on_the_admin(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $otherApprover = User::factory()->admin()->create(['organization_id' => $org->id]);
        $this->approval($org, $student, 'ADMIN');
        $this->approval($org, $student, 'DEPARTMENT_HEAD');
        $this->approval($org, $student, 'ADMIN', 'event', ['assigned_approver' => $otherApprover->school_id]);

        $payload = $this->answer($admin, 'pending_approvals');

        $this->assertSame('1', $this->highlight($payload, 'Pending approvals'));
        $this->assertCount(1, $this->section($payload, 'pending-approvals-list')['rows']);
        $this->assertStringContainsString('1 approval request is waiting', $payload['answer']);
        $this->assertNoPluralPlaceholders($payload);
    }

    public function test_an_officer_has_no_review_queue_and_sees_no_requests(): void
    {
        $org = $this->org();
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id, 'first_name' => 'Quenby', 'last_name' => 'Zarathustra']);
        $this->approval($org, $student, 'ADMIN');

        $payload = $this->answer($officer, 'pending_approvals');

        $this->assertSame([], $payload['sections']);
        $this->assertStringNotContainsString('Zarathustra', json_encode($payload));
        $this->assertStringContainsString('no review queue', $payload['answer']);
    }

    public function test_the_dean_counts_only_requests_for_the_dean_and_the_sao_review_link_opens_the_approvals_page(): void
    {
        $college = $this->makeCollege('ENG');
        $home = $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $this->approval($org, $student, 'DEPARTMENT_HEAD');
        $this->approval($org, $student, 'SUPER_ADMIN');

        $this->assertSame('1', $this->highlight($this->answer($head, 'pending_approvals'), 'Pending approvals'));

        $sao = $this->sao();
        $this->approval($org, $student, 'SUPER_ADMIN', 'announcement');
        $payload = $this->answer($sao, 'pending_approvals');

        $this->assertSame('1', $this->highlight($payload, 'Pending approvals'));
        $this->assertSame('/dashboard/super-admin/organization-approvals', $this->section($payload, 'pending-approvals-list')['rows'][0]['href']);
    }

    public function test_the_sao_missing_submissions_counts_only_active_organizations_and_every_late_report(): void
    {
        $this->semester();
        $sao = $this->sao();
        ComplianceRequirementType::create(['academic_year' => '2026-2027', 'category' => 'organization', 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $sao->school_id]);
        ComplianceRequirementType::create(['academic_year' => '2026-2027', 'category' => 'renewal', 'name' => 'Renewal form', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $sao->school_id]);
        foreach (range(1, 14) as $i) {
            $this->org();
        }
        $this->org(['lifecycle_status' => 'archived', 'is_active' => false]);
        $this->org(['lifecycle_status' => 'pending', 'is_active' => false]);
        DB::table('financial_report_deadlines')->insert(['deadline_at' => now()->subDay(), 'created_at' => now(), 'updated_at' => now()]);

        $payload = $this->answer($sao, 'missing_submissions');

        $this->assertSame('14', $this->highlight($payload, 'Orgs missing compliance'));
        $this->assertSame('1', $this->highlight($payload, 'Active requirements'));
        $this->assertSame('14', $this->highlight($payload, 'Missing financial reports'));
        $this->assertStringContainsString('14 of 14 active student organizations', $payload['answer']);
        $this->assertCount(12, $this->section($payload, 'orgs-missing-financial-reports')['rows']);
        $this->assertSame('Showing the first 12 of 14.', $this->section($payload, 'orgs-missing-financial-reports')['description']);
        $this->assertNoPluralPlaceholders($payload);
    }

    public function test_an_org_admin_is_told_about_planning_event_files_and_an_overdue_financial_report(): void
    {
        $semester = $this->semester();
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        EventRequirement::create(['name' => 'Activity proposal', 'allowed_extensions' => ['pdf'], 'is_active' => true, 'is_optional' => false, 'venue_type' => 'all']);
        Event::factory()->create(['organization_id' => $org->id, 'status' => 'planning', 'academic_semester_id' => $semester->id, 'title' => 'Planning Event', 'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(2), 'created_by' => $admin->school_id]);
        Event::factory()->create(['organization_id' => $org->id, 'status' => 'approved', 'academic_semester_id' => $semester->id, 'title' => 'Finished Event', 'start_time' => now()->subWeek(), 'end_time' => now()->subWeek()->addHours(2), 'created_by' => $admin->school_id]);
        DB::table('financial_report_deadlines')->insert(['deadline_at' => now()->subDay(), 'created_at' => now(), 'updated_at' => now()]);

        $payload = $this->answer($admin, 'missing_submissions');

        $events = $this->section($payload, 'org-missing-event-files')['rows'];
        $this->assertSame(['Planning Event'], array_column($events, 'primary'));
        $report = $this->section($payload, 'org-missing-financial-report')['rows'];
        $this->assertCount(1, $report);
        $this->assertSame('Overdue', $report[0]['status']);
        $this->assertSame('/dashboard/finance/financial-ledger?tab=reports', $report[0]['href']);
        $this->assertSame('Not submitted', $this->highlight($payload, 'Financial report'));
        $this->assertNoPluralPlaceholders($payload);
    }

    public function test_an_officer_is_not_sent_to_the_compliance_page_they_cannot_open(): void
    {
        $this->semester();
        $sao = $this->sao();
        $org = $this->org();
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);
        ComplianceRequirementType::create(['academic_year' => '2026-2027', 'category' => 'organization', 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $sao->school_id]);

        $rows = $this->section($this->answer($officer, 'missing_submissions'), 'org-missing-compliance-list')['rows'];

        $this->assertCount(1, $rows);
        $this->assertNull($rows[0]['href']);

        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $this->assertSame('/dashboard/compliance', $this->section($this->answer($admin, 'missing_submissions'), 'org-missing-compliance-list')['rows'][0]['href']);
    }

    public function test_clearance_queues_only_count_the_signature_lines_of_the_asking_role(): void
    {
        $college = $this->makeCollege('ENG');
        $home = $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $sao = $this->sao();
        $periodId = DB::table('clearance_periods')->insertGetId([
            'academic_year' => '2026-2027', 'title' => 'First Semester Clearance', 'required_roles' => json_encode(['sao', 'department_head', 'organization']),
            'created_by' => $sao->school_id, 'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach (['sao', 'department_head', 'organization'] as $role) {
            DB::table('clearance_signatures')->insert([
                'clearance_period_id' => $periodId, 'student_id' => $student->school_id, 'organization_id' => $org->id,
                'required_role' => $role, 'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        foreach ([$head, $admin, $sao] as $asker) {
            $payload = $this->answer($asker, 'clearances_status');
            $this->assertSame('1', $this->highlight($payload, 'Pending signatures'));
            $this->assertCount(1, $this->section($payload, 'clearance-queue-rows')['rows']);
        }
    }

    public function test_a_student_only_hears_about_finalized_elections_in_the_organizations_they_vote_in(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $make = fn (array $attributes) => Election::factory()->create([
            'organization_id' => $org->id, 'status' => 'upcoming', 'title' => 'Election', 'start_time' => now()->addDay(), 'end_time' => now()->addDays(2), ...$attributes,
        ]);
        $make(['title' => 'Finalized upcoming', 'finalized_at' => now()]);
        $make(['title' => 'Approved but not finalized']);
        $make(['title' => 'Finalized active', 'status' => 'active', 'finalized_at' => now(), 'start_time' => now()->subDay()]);
        $make(['title' => 'Finalized cancelled', 'finalized_at' => now(), 'cancelled_at' => now()]);

        $payload = $this->answer($student, 'elections_status');

        $titles = collect($this->section($payload, 'elections-status-list')['rows'])->pluck('primary')->implode('|');
        $this->assertStringContainsString('Finalized upcoming', $titles);
        $this->assertStringContainsString('Finalized active', $titles);
        $this->assertStringNotContainsString('not finalized', $titles);
        $this->assertStringNotContainsString('cancelled', $titles);
        $this->assertSame('1', $this->highlight($payload, 'Active elections'));
        $this->assertSame('1', $this->highlight($payload, 'Upcoming elections'));
        $hrefs = collect($this->section($payload, 'elections-status-list')['rows'])->pluck('href', 'status');
        $this->assertSame('/dashboard/elections/cast-vote', $hrefs['Active']);
        $this->assertSame('/dashboard/elections/election-info', $hrefs['Upcoming']);
    }

    public function test_the_grievance_queue_counts_every_open_case_and_skips_deleted_ones(): void
    {
        $sao = $this->sao();
        $student = User::factory()->student()->create();
        foreach (range(1, 14) as $i) {
            DB::table('grievances')->insert(['submitted_by' => $student->school_id, 'title' => "Case {$i}", 'description' => 'Details', 'urgency' => $i <= 13 ? 'High' : 'Low', 'status' => 'submitted', 'created_at' => now(), 'updated_at' => now()]);
        }
        DB::table('grievances')->insert(['submitted_by' => $student->school_id, 'title' => 'Withdrawn', 'description' => 'Details', 'urgency' => 'Critical', 'status' => 'submitted', 'deleted_at' => now(), 'created_at' => now(), 'updated_at' => now()]);

        $payload = $this->answer($sao, 'grievances_status');

        $this->assertSame('14', $this->highlight($payload, 'Unresolved grievances'));
        $this->assertSame('13', $this->highlight($payload, 'High / critical urgency'));
        $this->assertStringContainsString('14 grievances are unresolved, and 13 of them are high or critical urgency.', $payload['answer']);
        $this->assertCount(12, $this->section($payload, 'sao-grievances-list')['rows']);
        $this->assertStringContainsString('Showing the first 12 of 14', $this->section($payload, 'sao-grievances-list')['description']);
        $this->assertStringNotContainsString('Withdrawn', json_encode($payload));
    }

    public function test_the_finance_answer_flags_spending_even_when_income_lifts_the_remaining_amount(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $budget = Budget::create(['organization_id' => $org->id, 'title' => 'Foundation Week', 'allocated_amount' => 1000, 'remaining_amount' => 1100, 'warning_threshold' => 100, 'submission_status' => 'approved']);
        Transaction::factory()->create(['budget_id' => $budget->id, 'type' => 'expense', 'amount' => 900]);
        Transaction::factory()->create(['budget_id' => $budget->id, 'type' => 'income', 'amount' => 1000]);
        Budget::create(['organization_id' => $org->id, 'title' => 'Not yet approved', 'allocated_amount' => 5000, 'remaining_amount' => 5000, 'warning_threshold' => 100, 'submission_status' => 'pending']);
        foreach (['unpaid' => 'INV-1', 'cancelled' => 'INV-2', 'waived' => 'INV-3', 'paid' => 'INV-4'] as $status => $reference) {
            Invoice::create(['organization_id' => $org->id, 'reference' => $reference, 'student_id' => $student->school_id, 'description' => 'Membership', 'amount_due' => 100, 'status' => $status]);
        }

        $payload = $this->answer($admin, 'finance_health');

        $rows = $this->section($payload, 'approved-budgets-list')['rows'];
        $this->assertCount(1, $rows);
        $this->assertSame('danger', $rows[0]['status_tone']);
        $this->assertSame('90% spent', $rows[0]['status']);
        $this->assertStringContainsString('Spent: ₱900.00', $rows[0]['secondary']);
        $this->assertSame('1', $this->highlight($payload, 'Open student invoices'));
        $this->assertStringContainsString('1 student invoice is unpaid', $payload['answer']);

        $studentPayload = $this->answer($student, 'finance_health');
        $tones = collect($this->section($studentPayload, 'student-invoices')['rows'])->pluck('status_tone', 'status');
        $this->assertSame('warning', $tones['Unpaid']);
        $this->assertSame('neutral', $tones['Cancelled']);
        $this->assertSame('neutral', $tones['Waived']);
        $this->assertSame('success', $tones['Paid']);
    }

    public function test_merchandise_separates_orders_awaiting_verification_from_orders_awaiting_payment(): void
    {
        $org = $this->org();
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);
        $buyer = User::factory()->student()->create(['organization_id' => $org->id]);
        $item = Merchandise::factory()->create(['organization_id' => $org->id]);
        $make = fn (array $attributes) => Order::factory()->create([
            'organization_id' => $org->id, 'student_id' => $buyer->school_id, 'merchandise_id' => $item->id,
            'status' => 'pending', 'payment_method' => 'gcash', 'officer_review_status' => 'pending', 'payment_proof_url' => null,
            'processed_by' => null, 'approved_by' => null, 'claimed_at' => null, ...$attributes,
        ]);
        $make([]);
        $make(['payment_proof_url' => 'proof.png']);
        $make(['status' => 'paid', 'payment_proof_url' => 'proof.png', 'officer_review_status' => 'approved']);

        $payload = $this->answer($officer, 'merchandise_orders');

        $this->assertSame('1', $this->highlight($payload, 'Awaiting verification'));
        $this->assertSame('1', $this->highlight($payload, 'Awaiting payment'));
        $this->assertSame('1', $this->highlight($payload, 'Ready to claim'));
        $statuses = collect($this->section($payload, 'orders-active-list')['rows'])->pluck('status')->sort()->values()->all();
        $this->assertSame(['Awaiting payment', 'Awaiting verification', 'Ready to claim'], $statuses);
        $this->assertNoPluralPlaceholders($payload);
    }

    public function test_the_sao_and_the_dean_are_not_given_an_order_count_for_their_own_office(): void
    {
        $college = $this->makeCollege('ENG');
        $head = $this->makeCollegeHead($college);

        foreach ([$this->sao(), $head] as $asker) {
            $payload = $this->answer($asker, 'merchandise_orders');
            $this->assertSame([], $payload['highlights']);
            $this->assertSame([], $payload['sections']);
            $this->assertStringContainsString('no order queue', $payload['answer']);
        }
    }

    public function test_the_events_answer_counts_every_upcoming_event_in_the_selected_semester(): void
    {
        $semester = $this->semester();
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        foreach (range(1, 14) as $i) {
            Event::factory()->create(['organization_id' => $org->id, 'status' => 'approved', 'academic_semester_id' => $semester->id, 'start_time' => now()->addDays($i), 'end_time' => now()->addDays($i)->addHours(2), 'created_by' => $admin->school_id]);
        }
        Event::factory()->create(['organization_id' => $org->id, 'status' => 'approved', 'academic_semester_id' => null, 'start_time' => now()->addDays(20), 'end_time' => now()->addDays(20)->addHours(2), 'created_by' => $admin->school_id]);

        $payload = $this->answer($admin, 'events_attendance');

        $this->assertSame('14', $this->highlight($payload, 'Upcoming / ongoing'));
        $this->assertCount(12, $this->section($payload, 'upcoming-events-list')['rows']);
        $this->assertStringContainsString('Showing the first 12 of 14', $this->section($payload, 'upcoming-events-list')['description']);
        $this->assertStringContainsString('14 events are upcoming or ongoing', $payload['answer']);
    }

    public function test_the_tasks_answer_stays_in_the_active_semester_and_reads_like_a_sentence(): void
    {
        $semester = $this->semester();
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $make = fn (array $attributes) => Task::factory()->create([
            'organization_id' => $org->id, 'event_id' => null, 'created_by' => $admin->school_id, 'assigned_to' => $admin->school_id,
            'status' => 'overdue', 'deadline' => now()->subDay(), ...$attributes,
        ]);
        $make(['academic_semester_id' => $semester->id]);
        $earlier = AcademicSemester::create(['academic_year_id' => $semester->academic_year_id, 'number' => 2, 'starts_on' => '2026-01-01', 'ends_on' => '2026-07-31', 'status' => 'completed']);
        $make(['academic_semester_id' => $earlier->id]);

        $payload = $this->answer($admin, 'tasks_workload');

        $this->assertSame('1', $this->highlight($payload, 'Overdue tasks'));
        $this->assertStringContainsString('1 task is overdue, and 0 tasks are still pending or in progress.', $payload['answer']);
        $this->assertNoPluralPlaceholders($payload);
    }

    public function test_submitted_documents_count_every_report_by_outcome_and_link_the_deans_office_to_pages_it_can_open(): void
    {
        $this->semester();
        $college = $this->makeCollege('ENG');
        $home = $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $staff = User::factory()->admin()->create(['organization_id' => $home->id]);
        $type = ComplianceRequirementType::create(['academic_year' => '2026-2027', 'category' => 'organization', 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $admin->school_id]);
        OrganizationComplianceSubmission::create(['organization_id' => $org->id, 'requirement_type_id' => $type->id, 'status' => 'submitted', 'file_path' => 'x.pdf', 'file_original_name' => 'x.pdf', 'mime_type' => 'application/pdf', 'file_size' => 1, 'submitted_by' => $admin->school_id, 'submitted_at' => now()]);
        foreach (array_merge(array_fill(0, 13, 'pending_sao'), ['rejected', 'approved']) as $index => $status) {
            FinancialReport::create([
                'organization_id' => $org->id, 'report_type' => 'monthly', 'title' => "Report {$index}", 'source_transaction_ids' => [], 'signatories' => [],
                'submission_status' => $status, 'generated_by' => $admin->school_id, 'generated_at' => now(), 'submitted_at' => now(),
                'opening_balance_snapshot' => 0, 'transactions_snapshot' => [],
            ]);
        }
        $staff = User::find($staff->id);
        $staff->activateProfile($staff->accountProfiles()->firstOrFail(), signedInRequest: true);
        $this->assertSame('DEPARTMENT_HEAD', $staff->role);

        $payload = $this->answer($staff, 'submitted_documents');

        $this->assertSame('13', $this->highlight($payload, 'Reports awaiting review'));
        $this->assertSame('1', $this->highlight($payload, 'Reports returned'));
        $this->assertSame('1', $this->highlight($payload, 'Reports approved'));
        $this->assertStringContainsString('1 compliance file is waiting for review', $payload['answer']);
        $this->assertStringContainsString('13 are awaiting review, 1 is approved and 1 is returned', $payload['answer']);
        $this->assertCount(12, $this->section($payload, 'submitted-financial-reports')['rows']);
        $this->assertStringContainsString('Showing the first 12 of 15', $this->section($payload, 'submitted-financial-reports')['description']);
        foreach ($payload['sections'] as $section) {
            foreach ($section['rows'] as $row) {
                $this->assertNotNull($row['href']);
                $this->assertContains(strtok($row['href'], '?'), config('client_routes.ADMIN'));
            }
        }
    }
}
