<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\EventRequirement;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\OrganizationApplicantGrant;
use App\Models\OrganizationApplication;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Transaction;
use App\Models\User;
use App\Services\ChangesSinceReturn;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * What a reviewer is told changed after they returned something: computed per flow from the audit log,
 * shown to the people who decide, never to the organization that made the changes.
 */
class ChangesSinceReturnTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private function decide(User $reviewer, ApprovalRequest $approval, string $status, array $extra = [])
    {
        Sanctum::actingAs($reviewer);

        return $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => $status, 'remarks' => $status === 'rejected' ? 'Please fix this.' : null, ...$extra]);
    }

    /** The row the reviewer reads in the approvals list. */
    private function listed(User $viewer, int $entityId, string $type, string $role, string $scope = 'awaiting'): array
    {
        Sanctum::actingAs($viewer);

        return collect($this->getJson('/api/approval-requests?status=pending&per_page=50&scope='.$scope)->assertOk()->json('data'))
            ->first(fn (array $row) => $row['entity_type'] === $type && $row['entity_id'] === $entityId && $row['required_role'] === $role);
    }

    private function labels(array $changes): array
    {
        return array_column($changes, 'label');
    }

    private function change(array $changes, string $field): array
    {
        return collect($changes)->firstWhere('field', $field) ?? $this->fail("No change named {$field} in ".json_encode($changes));
    }

    public function test_an_event_resent_after_the_head_returned_it_lists_the_details_and_the_replaced_file(): void
    {
        Storage::fake('local');
        config(['performance.api_cache.enabled' => false]);
        $college = $this->makeCollege('CCS');
        $organization = $this->makeCollegeStudentOrganization($college);
        $head = $this->makeCollegeHead($college);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $proposal = EventRequirement::create(['name' => 'Event proposal', 'allowed_extensions' => ['pdf'], 'is_active' => true, 'is_optional' => false, 'venue_type' => 'all', 'sort_order' => 1]);

        Sanctum::actingAs($admin);
        $eventId = $this->postJson('/api/events', [
            'title' => 'General Assembly',
            'description' => 'Yearly meeting.',
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
        ])->assertCreated()->json('id');
        $this->post('/api/events/'.$eventId.'/submission', ['documents' => [$proposal->id => UploadedFile::fake()->create('proposal-v1.pdf', 20, 'application/pdf')]], ['Accept' => 'application/json'])->assertOk();

        $headRow = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'DEPARTMENT_HEAD')->firstOrFail();
        $this->assertSame([], $this->listed($head, $eventId, 'event', 'DEPARTMENT_HEAD')['changes_since_return'], 'Nothing was returned yet.');

        $this->decide($head, $headRow, 'rejected')->assertOk();
        Sanctum::actingAs($admin);
        $this->putJson('/api/events/'.$eventId, ['title' => 'General Assembly 2026', 'description' => str_repeat('A long description. ', 12)])->assertOk();
        $this->post('/api/events/'.$eventId.'/submission', ['documents' => [$proposal->id => UploadedFile::fake()->create('proposal-v2.pdf', 20, 'application/pdf')]], ['Accept' => 'application/json'])->assertOk();

        $changes = $this->listed($head, $eventId, 'event', 'DEPARTMENT_HEAD')['changes_since_return'];
        $this->assertCount(3, $changes);
        $this->assertSame(['field' => 'title', 'label' => 'Title', 'before' => 'General Assembly', 'after' => 'General Assembly 2026'], $this->change($changes, 'title'));
        $this->assertSame(['field' => 'description', 'label' => 'Description'], $this->change($changes, 'description'), 'A value over 80 characters is named without before and after.');
        $this->assertSame('proposal-v2.pdf replaced proposal-v1.pdf', $this->change($changes, 'file:Event proposal')['label']);

        Sanctum::actingAs($head);
        $this->getJson('/api/approval-requests/'.$headRow->id)->assertOk()->assertJsonPath('changes_since_return.0.label', 'Title');

        $this->assertSame([], $this->listed($admin, $eventId, 'event', 'DEPARTMENT_HEAD', 'submitted')['changes_since_return'], 'The organization is not shown the list.');
    }

    private function submittedEventHeldByTheHead(): array
    {
        Storage::fake('local');
        config(['performance.api_cache.enabled' => false]);
        $college = $this->makeCollege('CCS');
        $organization = $this->makeCollegeStudentOrganization($college);
        $head = $this->makeCollegeHead($college);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $proposal = EventRequirement::create(['name' => 'Event proposal', 'allowed_extensions' => ['pdf'], 'is_active' => true, 'is_optional' => false, 'venue_type' => 'all', 'sort_order' => 1]);

        Sanctum::actingAs($admin);
        $eventId = $this->postJson('/api/events', [
            'title' => 'Leadership Camp',
            'start_time' => now()->addWeek()->setTime(9, 0)->toDateTimeString(),
            'end_time' => now()->addWeek()->setTime(11, 0)->toDateTimeString(),
        ])->assertCreated()->json('id');
        $this->post('/api/events/'.$eventId.'/submission', ['documents' => [$proposal->id => UploadedFile::fake()->create('proposal-v1.pdf', 20, 'application/pdf')]], ['Accept' => 'application/json'])->assertOk();

        return [$head, $admin, $eventId, ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'DEPARTMENT_HEAD')->firstOrFail()];
    }

    public function test_an_event_the_head_approved_and_the_admin_then_rescheduled_lists_what_changed_since_the_approval(): void
    {
        [$head, $admin, $eventId, $headRow] = $this->submittedEventHeldByTheHead();
        $fileId = $this->listed($head, $eventId, 'event', 'DEPARTMENT_HEAD')['summary']['requirement_files'][0]['id'];
        $this->decide($head, $headRow, 'approved', ['files' => [['id' => $fileId, 'status' => 'ok']]])->assertOk();

        Sanctum::actingAs($admin);
        $this->putJson('/api/events/'.$eventId, ['start_time' => now()->addWeeks(2)->setTime(9, 0)->toDateTimeString(), 'end_time' => now()->addWeeks(2)->setTime(11, 0)->toDateTimeString()])->assertOk();
        $this->assertSame('pending', $headRow->fresh()->status, 'The material edit took the event back to the head.');

        $row = $this->listed($head, $eventId, 'event', 'DEPARTMENT_HEAD');
        $this->assertSame('approved', $row['changes_since']);
        $this->assertSame(['Start', 'End'], $this->labels($row['changes_since_return']));
        $this->assertSame(now()->addWeek()->setTime(9, 0)->format('M j, Y g:i A'), $this->change($row['changes_since_return'], 'start_time')['before']);

        Sanctum::actingAs($head);
        $this->getJson('/api/approval-requests/'.$headRow->id)->assertOk()->assertJsonPath('changes_since', 'approved')->assertJsonPath('changes_since_return.0.label', 'Start');

        $own = $this->listed($admin, $eventId, 'event', 'DEPARTMENT_HEAD', 'submitted');
        $this->assertSame([], $own['changes_since_return'], 'The organization is not shown the list.');
        $this->assertNull($own['changes_since']);
    }

    public function test_an_event_returned_then_resent_keeps_the_returned_anchor_even_if_it_was_approved_before(): void
    {
        [$head, $admin, $eventId, $headRow] = $this->submittedEventHeldByTheHead();
        $fileId = $this->listed($head, $eventId, 'event', 'DEPARTMENT_HEAD')['summary']['requirement_files'][0]['id'];
        $this->decide($head, $headRow, 'approved', ['files' => [['id' => $fileId, 'status' => 'ok']]])->assertOk();
        Sanctum::actingAs($admin);
        $this->putJson('/api/events/'.$eventId, ['location' => 'Gym'])->assertOk();
        $this->decide($head, $headRow->fresh(), 'rejected')->assertOk();

        Sanctum::actingAs($admin);
        $this->putJson('/api/events/'.$eventId, ['title' => 'Leadership Camp 2026'])->assertOk();

        $row = $this->listed($head, $eventId, 'event', 'DEPARTMENT_HEAD');
        $this->assertSame('returned', $row['changes_since']);
        $this->assertSame(['Title'], $this->labels($row['changes_since_return']), 'Only what changed since the return, not since the earlier approval.');
    }

    public function test_an_event_never_approved_or_returned_shows_no_change_list(): void
    {
        [$head, $admin, $eventId] = $this->submittedEventHeldByTheHead();
        $this->putJson('/api/events/'.$eventId, ['title' => 'Leadership Camp 2026'])->assertOk();

        $row = $this->listed($head, $eventId, 'event', 'DEPARTMENT_HEAD');
        $this->assertSame([], $row['changes_since_return']);
        $this->assertNull($row['changes_since']);
    }

    public function test_an_election_that_changed_after_the_reviewer_approved_it_lists_the_changes_since_that_approval(): void
    {
        $organization = Organization::factory()->create();
        $election = Election::factory()->create(['organization_id' => $organization->id]);
        $requester = User::factory()->admin()->create(['organization_id' => $organization->id])->school_id;
        $row = fn (string $status) => ApprovalRequest::create([
            'organization_id' => $organization->id, 'entity_type' => 'election', 'entity_id' => $election->id,
            'requested_by' => $requester, 'required_role' => 'SUPER_ADMIN', 'status' => $status,
        ]);
        $log = fn (string $module, string $action, string $type, int $id, ?array $old, ?array $new) => AuditLog::create([
            'organization_id' => $organization->id, 'module' => $module, 'action' => $action, 'record_type' => $type, 'record_id' => $id,
            'old_values' => $old, 'new_values' => $new, 'created_at' => now(),
        ]);
        $approved = $row('approved');
        $log('elections', 'updated', Election::class, $election->id, ['title' => 'Before'], ['title' => 'Draft']);
        $log('approvals', 'reviewed_approved', ApprovalRequest::class, $approved->id, null, ['status' => 'approved']);
        $log('elections', 'updated', Election::class, $election->id, ['start_time' => '2026-12-01T01:00:00.000000Z'], ['start_time' => '2026-12-02T01:00:00.000000Z']);
        $reopened = $row('pending');

        $described = app(ChangesSinceReturn::class)->describeApprovals(collect([$reopened]))[$reopened->id];

        $this->assertSame('approved', $described['since']);
        $this->assertSame(['Voting opens'], $this->labels($described['changes']), 'The title edit came before the approval.');
    }

    public function test_the_sao_sees_only_what_changed_since_its_own_return(): void
    {
        Storage::fake('local');
        config(['performance.api_cache.enabled' => false]);
        $college = $this->makeCollege('CCS');
        $organization = $this->makeCollegeStudentOrganization($college);
        $head = $this->makeCollegeHead($college);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $director = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        $proposal = EventRequirement::create(['name' => 'Event proposal', 'allowed_extensions' => ['pdf'], 'is_active' => true, 'is_optional' => false, 'venue_type' => 'all', 'sort_order' => 1]);

        Sanctum::actingAs($admin);
        $eventId = $this->postJson('/api/events', [
            'title' => 'Leadership Camp',
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
        ])->assertCreated()->json('id');
        $this->post('/api/events/'.$eventId.'/submission', ['documents' => [$proposal->id => UploadedFile::fake()->create('proposal-v1.pdf', 20, 'application/pdf')]], ['Accept' => 'application/json'])->assertOk();
        $fileId = $this->listed($head, $eventId, 'event', 'DEPARTMENT_HEAD')['summary']['requirement_files'][0]['id'];

        $this->decide($head, ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'DEPARTMENT_HEAD')->firstOrFail(), 'approved', ['files' => [['id' => $fileId, 'status' => 'ok']]])->assertOk();
        Sanctum::actingAs($admin);
        $this->post('/api/events/'.$eventId.'/submission', [], ['Accept' => 'application/json'])->assertOk();
        $saoRow = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'SUPER_ADMIN')->firstOrFail();
        $this->decide($director, $saoRow, 'rejected')->assertOk();

        Sanctum::actingAs($admin);
        $this->putJson('/api/events/'.$eventId, ['location' => 'Gym'])->assertOk();
        // A material edit takes the event back to the Head, who approves again before the Admin resends it.
        $this->decide($head, ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'DEPARTMENT_HEAD')->firstOrFail(), 'approved', ['files' => [['id' => $fileId, 'status' => 'ok']]])->assertOk();
        Sanctum::actingAs($admin);
        $this->post('/api/events/'.$eventId.'/submission', [], ['Accept' => 'application/json'])->assertOk();

        $this->assertSame(['Location'], $this->labels($this->listed($director, $eventId, 'event', 'SUPER_ADMIN')['changes_since_return']));
    }

    public function test_the_event_reviews_list_carries_the_change_for_the_sao_after_a_return_and_resend_but_not_for_the_organization(): void
    {
        Storage::fake('local');
        config(['performance.api_cache.enabled' => false]);
        $college = $this->makeCollege('CCS');
        $organization = $this->makeCollegeStudentOrganization($college);
        $head = $this->makeCollegeHead($college);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $director = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        $proposal = EventRequirement::create(['name' => 'Event proposal', 'allowed_extensions' => ['pdf'], 'is_active' => true, 'is_optional' => false, 'venue_type' => 'all', 'sort_order' => 1]);

        Sanctum::actingAs($admin);
        $eventId = $this->postJson('/api/events', [
            'title' => 'Leadership Camp',
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
        ])->assertCreated()->json('id');
        $this->post('/api/events/'.$eventId.'/submission', ['documents' => [$proposal->id => UploadedFile::fake()->create('proposal-v1.pdf', 20, 'application/pdf')]], ['Accept' => 'application/json'])->assertOk();
        $fileId = $this->listed($head, $eventId, 'event', 'DEPARTMENT_HEAD')['summary']['requirement_files'][0]['id'];
        $this->decide($head, ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'DEPARTMENT_HEAD')->firstOrFail(), 'approved', ['files' => [['id' => $fileId, 'status' => 'ok']]])->assertOk();
        Sanctum::actingAs($admin);
        $this->post('/api/events/'.$eventId.'/submission', [], ['Accept' => 'application/json'])->assertOk();
        $this->decide($director, ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'SUPER_ADMIN')->firstOrFail(), 'rejected')->assertOk();

        Sanctum::actingAs($admin);
        $this->putJson('/api/events/'.$eventId, ['location' => 'Gym'])->assertOk();
        $this->decide($head, ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'DEPARTMENT_HEAD')->firstOrFail(), 'approved', ['files' => [['id' => $fileId, 'status' => 'ok']]])->assertOk();
        Sanctum::actingAs($admin);
        $this->post('/api/events/'.$eventId.'/submission', [], ['Accept' => 'application/json'])->assertOk();

        // The request the Event reviews tab makes: pending event rows, all pages.
        Sanctum::actingAs($director);
        $rows = collect($this->getJson('/api/approval-requests?entity_type=event&status=pending&page=1&per_page=100')->assertOk()->json('data'));
        $this->assertSame(['Location'], $this->labels($rows->firstWhere('entity_id', $eventId)['changes_since_return']));

        Sanctum::actingAs($admin);
        $own = collect($this->getJson('/api/approval-requests?entity_type=event&status=all&scope=submitted&per_page=100')->assertOk()->json('data'))->where('entity_id', $eventId);
        $this->assertNotEmpty($own);
        $this->assertSame([], $own->pluck('changes_since_return')->flatten(1)->all(), 'The organization is never shown the list.');
    }

    public function test_a_budget_resent_after_a_return_lists_the_changed_fields(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($admin);
        $budgetId = $this->postJson('/api/budgets', ['title' => 'Recognition Night', 'allocated_amount' => 800, 'warning_threshold' => 150])->assertCreated()->json('id');
        $approval = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budgetId)->firstOrFail();
        $this->decide($head, $approval, 'rejected')->assertOk();

        Sanctum::actingAs($admin);
        $this->putJson('/api/budgets/'.$budgetId, ['allocated_amount' => 900])->assertOk();

        $changes = $this->listed($head, $budgetId, 'budget', 'DEPARTMENT_HEAD')['changes_since_return'];
        $this->assertSame([['field' => 'allocated_amount', 'label' => 'Allocated amount', 'before' => '800.00', 'after' => '900.00']], $changes);
    }

    public function test_an_announcement_resent_after_a_return_lists_the_changed_message(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $reviewer = User::factory()->admin()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($officer);
        $id = $this->postJson('/api/announcements', ['title' => 'Officer notice', 'body' => 'Meet at noon.', 'target_role' => 'all'])->assertCreated()->json('id');
        $approval = ApprovalRequest::where('entity_type', 'announcement')->where('entity_id', $id)->firstOrFail();
        $this->decide($reviewer, $approval, 'rejected')->assertOk();

        Sanctum::actingAs($officer);
        $this->putJson("/api/announcements/{$id}", ['body' => 'Meet at one.'])->assertOk();

        $changes = $this->listed($reviewer, $id, 'announcement', 'ADMIN')['changes_since_return'];
        $this->assertSame([['field' => 'body', 'label' => 'Message', 'before' => 'Meet at noon.', 'after' => 'Meet at one.']], $changes);
    }

    public function test_an_election_lists_its_changed_dates_and_a_field_put_back_is_not_a_change(): void
    {
        $organization = Organization::factory()->create();
        $election = Election::factory()->create(['organization_id' => $organization->id]);
        $approval = ApprovalRequest::create([
            'organization_id' => $organization->id, 'entity_type' => 'election', 'entity_id' => $election->id,
            'requested_by' => User::factory()->admin()->create(['organization_id' => $organization->id])->school_id, 'required_role' => 'SUPER_ADMIN', 'status' => 'pending',
        ]);
        $log = fn (string $module, string $action, string $type, int $id, ?array $old, ?array $new) => AuditLog::create([
            'organization_id' => $organization->id, 'module' => $module, 'action' => $action, 'record_type' => $type, 'record_id' => $id,
            'old_values' => $old, 'new_values' => $new, 'created_at' => now(),
        ]);
        $log('approvals', 'reviewed_rejected', ApprovalRequest::class, $approval->id, null, ['status' => 'rejected']);
        $log('elections', 'updated', Election::class, $election->id, ['title' => 'Old', 'room' => 'A', 'start_time' => '2026-12-01T01:00:00.000000Z'], ['title' => 'New', 'room' => 'B', 'start_time' => '2026-12-02T01:00:00.000000Z']);
        $log('elections', 'updated', Election::class, $election->id, ['room' => 'B'], ['room' => 'A']);

        $changes = app(ChangesSinceReturn::class)->forApprovals(collect([$approval]))[$approval->id];

        $this->assertSame(['Title', 'Voting opens'], $this->labels($changes), 'The room went back to what it was.');
        $this->assertSame(['Old', 'New'], [$changes[0]['before'], $changes[0]['after']]);
        $this->assertArrayHasKey('after', $this->change($changes, 'start_time'));
    }

    public function test_a_decision_after_a_return_clears_the_list_until_the_next_return(): void
    {
        $organization = Organization::factory()->create();
        $approval = ApprovalRequest::create([
            'organization_id' => $organization->id, 'entity_type' => 'budget', 'entity_id' => 1,
            'requested_by' => User::factory()->admin()->create(['organization_id' => $organization->id])->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending',
        ]);
        $log = fn (string $module, string $action, string $type, int $id, ?array $old = null, ?array $new = null) => AuditLog::create([
            'organization_id' => $organization->id, 'module' => $module, 'action' => $action, 'record_type' => $type, 'record_id' => $id,
            'old_values' => $old, 'new_values' => $new, 'created_at' => now(),
        ]);
        $service = app(ChangesSinceReturn::class);

        $this->assertSame([], $service->forApprovals(collect([$approval])), 'Never returned.');

        $log('budgets', 'updated', 'App\Models\Budget', 1, ['title' => 'A'], ['title' => 'B']);
        $log('approvals', 'reviewed_approved', ApprovalRequest::class, $approval->id);
        $log('budgets', 'updated', 'App\Models\Budget', 1, ['title' => 'B'], ['title' => 'C']);
        $changes = $service->describeApprovals(collect([$approval]))[$approval->id];
        $this->assertSame('approved', $changes['since'], 'The last decision was an approval an edit took back, so the list is measured from it.');
        $this->assertSame([['field' => 'title', 'label' => 'Title', 'before' => 'B', 'after' => 'C']], $changes['changes']);

        $log('approvals', 'reviewed_rejected', ApprovalRequest::class, $approval->id);
        $log('budgets', 'updated', 'App\Models\Budget', 1, ['title' => 'C', 'allocated_amount' => '5.00'], ['title' => 'D', 'allocated_amount' => '5.00']);
        $changes = $service->forApprovals(collect([$approval]))[$approval->id];
        $this->assertSame([['field' => 'title', 'label' => 'Title', 'before' => 'C', 'after' => 'D']], $changes, 'Only the edit after the latest return counts, and a field that did not change is left out.');
    }

    public function test_before_and_after_are_shown_only_when_both_are_eighty_characters_or_fewer(): void
    {
        $organization = Organization::factory()->create();
        $approval = ApprovalRequest::create([
            'organization_id' => $organization->id, 'entity_type' => 'budget', 'entity_id' => 1,
            'requested_by' => User::factory()->admin()->create(['organization_id' => $organization->id])->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending',
        ]);
        $log = fn (string $module, string $action, string $type, int $id, ?array $old = null, ?array $new = null) => AuditLog::create([
            'organization_id' => $organization->id, 'module' => $module, 'action' => $action, 'record_type' => $type, 'record_id' => $id,
            'old_values' => $old, 'new_values' => $new, 'created_at' => now(),
        ]);
        $service = app(ChangesSinceReturn::class);
        $log('approvals', 'reviewed_rejected', ApprovalRequest::class, $approval->id);

        $log('budgets', 'updated', 'App\Models\Budget', 1, ['title' => 'Short'], ['title' => str_repeat('x', 80)]);
        $this->assertSame([['field' => 'title', 'label' => 'Title', 'before' => 'Short', 'after' => str_repeat('x', 80)]], $service->forApprovals(collect([$approval]))[$approval->id]);

        $log('budgets', 'updated', 'App\Models\Budget', 1, ['title' => str_repeat('x', 80)], ['title' => str_repeat('x', 81)]);
        $this->assertSame([['field' => 'title', 'label' => 'Title']], $service->forApprovals(collect([$approval]))[$approval->id]);
    }

    public function test_a_financial_report_resent_with_more_supporting_files_lists_the_added_files(): void
    {
        Storage::fake('local');
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        Transaction::create(['organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'category' => 'membership', 'amount' => 1000, 'description' => 'Dues', 'transaction_date' => now()]);

        Sanctum::actingAs($admin);
        $id = $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'monthly',
            'signatories' => ['treasurer' => 'T', 'president' => 'P', 'adviser' => 'A', 'sbo_adviser' => 'S'],
        ])->assertCreated()->json('report.id');
        $this->post("/api/financial-reports/{$id}/submit", ['supporting_documents' => [UploadedFile::fake()->create('receipts.pdf', 20, 'application/pdf')]], ['Accept' => 'application/json'])->assertOk();
        $first = ApprovalRequest::where('entity_type', 'financial_report')->where('entity_id', $id)->where('status', 'pending')->firstOrFail();
        $this->assertSame([], $this->listed($head, $id, 'financial_report', 'DEPARTMENT_HEAD')['changes_since_return']);
        $this->decide($head, $first, 'rejected')->assertOk();

        Sanctum::actingAs($admin);
        $this->post("/api/financial-reports/{$id}/submit", ['supporting_documents' => [UploadedFile::fake()->create('bank-statement.pdf', 20, 'application/pdf')]], ['Accept' => 'application/json'])->assertOk();

        $changes = $this->listed($head, $id, 'financial_report', 'DEPARTMENT_HEAD')['changes_since_return'];
        $this->assertSame([['field' => 'file:bank-statement.pdf', 'label' => 'bank-statement.pdf added']], $changes);
        $this->assertSame([], $this->listed($admin, $id, 'financial_report', 'DEPARTMENT_HEAD', 'submitted')['changes_since_return']);
        $this->assertTrue(FinancialReport::whereKey($id)->exists());
    }

    public function test_an_application_sent_again_lists_the_changed_fields_and_files_for_the_reviewers_only(): void
    {
        Storage::fake('local');
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $sao = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        $requirement = ComplianceRequirementType::create(['academic_year' => $year->label, 'academic_semester_id' => $semester->id, 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $sao->school_id]);
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $home = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE']);
        $dean = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $student = User::factory()->student()->create(['organization_id' => $home->id]);
        $grant = OrganizationApplicantGrant::create(['college_id' => $college->id, 'user_school_id' => $student->school_id, 'granted_by' => $sao->school_id]);
        $application = OrganizationApplication::create([
            'college_id' => $college->id, 'name' => 'Computing Council', 'acronym' => 'CC', 'school_id' => $student->school_id, 'first_name' => $student->first_name,
            'last_name' => $student->last_name, 'email' => $student->email, 'position_title' => 'President', 'status' => 'pending_dean', 'round' => 1, 'submitted_at' => now(),
            'requires_documents' => true, 'required_documents_count' => 1,
        ]);
        Storage::disk('local')->put("organization-applications/{$application->id}/constitution.pdf", '%PDF-1.4');
        $application->documents()->create(['requirement_type_id' => $requirement->id, 'file_path' => "organization-applications/{$application->id}/constitution.pdf", 'file_original_name' => 'constitution.pdf', 'mime_type' => 'application/pdf', 'file_size' => 8]);
        $grant->update(['used_application_id' => $application->id]);

        Sanctum::actingAs($dean);
        $this->patchJson("/api/organization-applications/{$application->id}/review", [
            'action' => 'return', 'remarks' => 'Please fix it.', 'requirements' => [['requirement_type_id' => $requirement->id, 'status' => 'needs_changes', 'note' => 'Sign it.']],
        ])->assertOk()->assertJsonPath('changes_since_return', []);

        Sanctum::actingAs($student);
        $this->post("/api/my/organization-applications/{$application->id}/resubmit", [
            'name' => 'Computing Council', 'acronym' => 'CC', 'position_title' => 'Chairperson',
            'description' => 'We build things.', 'files' => [$requirement->id => UploadedFile::fake()->create('constitution-v2.pdf', 10, 'application/pdf')],
        ], ['Accept' => 'application/json'])->assertOk()->assertJsonMissingPath('changes_since_return');

        Sanctum::actingAs($dean);
        $changes = $this->getJson("/api/organization-applications/{$application->id}")->assertOk()->json('changes_since_return');
        $this->assertSame(['Description', 'Position title', 'constitution-v2.pdf replaced constitution.pdf'], $this->labels($changes));
        $this->assertSame(['field' => 'position_title', 'label' => 'Position title', 'before' => 'President', 'after' => 'Chairperson'], $this->change($changes, 'position_title'));
    }

    public function test_a_compliance_file_sent_again_lists_the_replaced_file_for_the_reviewer_only(): void
    {
        Storage::fake('local');
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $sao = User::factory()->superAdmin()->create(['organization_id' => Organization::factory()]);
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $type = ComplianceRequirementType::create(['academic_year' => '2026-2027', 'name' => 'Financial Statement', 'deadline_at' => now()->addMonth(), 'created_by' => $sao->school_id]);

        Sanctum::actingAs($admin);
        $id = $this->postJson('/api/compliance/submissions', ['requirement_type_id' => $type->id, 'document' => UploadedFile::fake()->create('statement.pdf', 200, 'application/pdf')])->assertCreated()->json('id');
        $this->assertSame([], $this->getJson('/api/compliance/submissions')->assertOk()->json('data.0.changes_since_return'));

        Sanctum::actingAs($sao);
        $submittedAt = OrganizationComplianceSubmission::findOrFail($id)->submitted_at->toIso8601String();
        $this->patchJson("/api/compliance/submissions/{$id}/review", ['status' => 'returned', 'remarks' => 'Missing signature page.', 'submitted_at' => $submittedAt])->assertOk();

        Sanctum::actingAs($admin);
        $this->postJson('/api/compliance/submissions', ['requirement_type_id' => $type->id, 'document' => UploadedFile::fake()->create('statement-v2.pdf', 200, 'application/pdf')])->assertOk();
        $this->assertSame([], $this->getJson('/api/compliance/submissions')->assertOk()->json('data.0.changes_since_return'), 'The organization is not shown the list.');

        Sanctum::actingAs($sao);
        $this->assertSame(
            [['field' => 'file:statement-v2.pdf', 'label' => 'statement-v2.pdf replaced statement.pdf']],
            $this->getJson('/api/compliance/submissions')->assertOk()->json('data.0.changes_since_return'),
        );

        $breakdown = collect($this->getJson('/api/compliance/status')->assertOk()->json('organizations'))->firstWhere('organization_id', $organization->id)['requirements'];
        $this->assertSame(['statement-v2.pdf replaced statement.pdf'], $this->labels(collect($breakdown)->firstWhere('submission_id', $id)['changes_since_return']), 'The per-requirement view carries the same list.');

        Sanctum::actingAs($admin);
        $own = collect($this->getJson('/api/compliance/status')->assertOk()->json('organizations.requirements'))->firstWhere('submission_id', $id);
        $this->assertSame([], $own['changes_since_return'], 'The organization is not shown the list there either.');

        $replacedAt = OrganizationComplianceSubmission::findOrFail($id)->submitted_at->toIso8601String();
        $this->post("/api/compliance/submissions/{$id}/document", ['document' => UploadedFile::fake()->create('statement-v3.pdf', 200, 'application/pdf'), 'submitted_at' => $replacedAt], ['Accept' => 'application/json'])->assertOk();
        Sanctum::actingAs($sao);
        $this->assertSame(
            ['statement-v3.pdf replaced statement.pdf'],
            $this->labels($this->getJson('/api/compliance/submissions')->assertOk()->json('data.0.changes_since_return')),
            'Two replacements since the return are one change, from the file the reviewer saw to the file now.',
        );
    }

    /** @return list<array<string, string>> */
    private function eventDiff(array $old, array $new): array
    {
        $diff = new \ReflectionMethod(ChangesSinceReturn::class, 'diff');
        $labels = (new \ReflectionClassConstant(ChangesSinceReturn::class, 'LABELS'))->getValue()['event'];
        $row = new AuditLog(['old_values' => $old, 'new_values' => $new]);

        return $diff->invoke(new ChangesSinceReturn, collect([$row]), $labels);
    }

    public function test_saving_the_event_form_over_an_old_record_does_not_list_its_defaults_as_edits(): void
    {
        $changes = $this->eventDiff(
            ['description' => 'Yearly meeting.', 'planning_details' => ['event_type' => 'Assembly']],
            ['description' => 'Yearly meeting, moved.', 'planning_details' => ['event_type' => 'Assembly', 'venue_type' => 'off_campus', 'budget_warning_threshold' => 0, 'proposed_budget_amount' => null]],
        );

        $this->assertSame(['description'], array_column($changes, 'field'), 'Only the description was edited.');
    }

    public function test_a_real_venue_or_budget_change_is_listed_with_the_label_the_screen_uses(): void
    {
        $changes = $this->eventDiff(
            ['planning_details' => ['venue_type' => 'on_campus', 'budget_warning_threshold' => 0]],
            ['planning_details' => ['venue_type' => 'off_campus', 'budget_warning_threshold' => 500]],
        );

        $this->assertSame(['On campus', 'Off campus'], [$this->change($changes, 'planning_details.venue_type')['before'], $this->change($changes, 'planning_details.venue_type')['after']]);
        $this->assertSame(['0', '500'], [$this->change($changes, 'planning_details.budget_warning_threshold')['before'], $this->change($changes, 'planning_details.budget_warning_threshold')['after']]);

        $fromBlank = $this->eventDiff(['planning_details' => []], ['planning_details' => ['venue_type' => 'on_campus']]);
        $this->assertSame('On campus', $this->change($fromBlank, 'planning_details.venue_type')['after']);
    }
}
