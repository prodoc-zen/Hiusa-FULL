<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\Budget;
use App\Models\Candidate;
use App\Models\Collection;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\FinancialReport;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class DepartmentHeadCollegeScopeTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    /** Two organizations in the head's college, one in another college. */
    private function world(): array
    {
        $computing = $this->makeCollege('CCS');
        $business = $this->makeCollege('CBE');
        $first = $this->makeCollegeStudentOrganization($computing);
        $second = $this->makeCollegeStudentOrganization($computing);
        $other = $this->makeCollegeStudentOrganization($business);

        return [
            'head' => $this->makeCollegeHead($computing),
            'otherHead' => $this->makeCollegeHead($business),
            'first' => $first,
            'second' => $second,
            'other' => $other,
            'firstAdmin' => User::factory()->admin()->create(['organization_id' => $first->id]),
            'secondAdmin' => User::factory()->admin()->create(['organization_id' => $second->id]),
            'otherAdmin' => User::factory()->admin()->create(['organization_id' => $other->id]),
        ];
    }

    private function pendingApproval(Organization $organization, string $type, int $entityId, User $requester): ApprovalRequest
    {
        return ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => $type,
            'entity_id' => $entityId,
            'requested_by' => $requester->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'pending',
            'requested_at' => now()->subHour(),
        ]);
    }

    private function approvedEvent(Organization $organization, User $creator): Event
    {
        return Event::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $creator->id,
            'status' => 'approved',
            'approved_at' => now(),
            'start_time' => now()->addWeek(),
            'end_time' => now()->addWeek()->addHours(2),
        ]);
    }

    private function budgetFor(Organization $organization, array $overrides = []): Budget
    {
        return Budget::factory()->create([
            'organization_id' => $organization->id,
            'allocated_amount' => 1000,
            'remaining_amount' => 1000,
            'warning_threshold' => 100,
            'submission_status' => 'pending_department_head',
            ...$overrides,
        ]);
    }

    private function reportFor(Organization $organization, User $generator, array $overrides = []): FinancialReport
    {
        return FinancialReport::create([
            'organization_id' => $organization->id,
            'report_type' => 'monthly',
            'title' => 'Monthly Financial Report',
            'summary_text' => 'Calculated report summary.',
            'source_transaction_ids' => [],
            'signatories' => [],
            'submission_status' => 'pending_department_head',
            'generated_by' => $generator->school_id,
            'generated_at' => now(),
            'submitted_at' => now(),
            ...$overrides,
        ]);
    }

    private function ledgerEntry(Organization $organization, User $recorder, string $type, float $amount): Transaction
    {
        return Transaction::factory()->create([
            'organization_id' => $organization->id,
            'budget_id' => null,
            'recorded_by' => $recorder->school_id,
            'type' => $type,
            'amount' => $amount,
        ]);
    }

    private function actingAsFresh(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user);
    }

    public function test_head_sees_and_approves_every_college_organization_request_and_none_from_another_college(): void
    {
        ['head' => $head, 'otherHead' => $otherHead, 'first' => $first, 'second' => $second, 'other' => $other,
            'firstAdmin' => $firstAdmin, 'secondAdmin' => $secondAdmin, 'otherAdmin' => $otherAdmin] = $this->world();
        $budget = $this->budgetFor($first);
        $event = Event::factory()->create(['organization_id' => $second->id, 'created_by' => $secondAdmin->id, 'status' => 'planning']);
        $report = $this->reportFor($first, $firstAdmin);
        $election = Election::factory()->create(['organization_id' => $second->id, 'status' => 'pending_approval']);
        $approvals = [
            'budget' => $this->pendingApproval($first, 'budget', $budget->id, $firstAdmin),
            'event' => $this->pendingApproval($second, 'event', $event->id, $secondAdmin),
            'financial_report' => $this->pendingApproval($first, 'financial_report', $report->id, $firstAdmin),
            'election' => $this->pendingApproval($second, 'election', $election->id, $secondAdmin),
        ];
        $foreignBudget = $this->budgetFor($other);
        $foreign = $this->pendingApproval($other, 'budget', $foreignBudget->id, $otherAdmin);

        Sanctum::actingAs($head);
        $listed = collect($this->getJson('/api/approval-requests')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertEqualsCanonicalizing(collect($approvals)->pluck('id')->all(), $listed);
        $this->assertNotContains($foreign->id, $listed);

        foreach ($approvals as $approval) {
            $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])->assertOk();
        }
        $this->assertSame('approved', $budget->fresh()->submission_status);
        $this->assertSame('approved', $event->fresh()->status);
        $this->assertSame('pending_sao', $report->fresh()->submission_status);
        $this->assertSame('upcoming', $election->fresh()->status);
        $this->patchJson('/api/approval-requests/'.$foreign->id, ['status' => 'approved'])->assertNotFound();
        $this->assertSame('pending_department_head', $foreignBudget->fresh()->submission_status);

        $this->actingAsFresh($otherHead);
        $this->assertSame([$foreign->id], collect($this->getJson('/api/approval-requests')->assertOk()->json('data'))->pluck('id')->all());
    }

    public function test_head_lists_cover_every_college_organization_while_admin_and_officer_lists_stay_single_organization(): void
    {
        ['head' => $head, 'first' => $first, 'second' => $second, 'other' => $other,
            'firstAdmin' => $firstAdmin, 'secondAdmin' => $secondAdmin, 'otherAdmin' => $otherAdmin] = $this->world();
        $officer = User::factory()->officer()->create(['organization_id' => $first->id]);
        $events = [$this->approvedEvent($first, $firstAdmin), $this->approvedEvent($second, $secondAdmin)];
        $this->approvedEvent($other, $otherAdmin);
        $budgets = [$this->budgetFor($first), $this->budgetFor($second)];
        $this->budgetFor($other);
        $elections = [
            Election::factory()->create(['organization_id' => $first->id, 'status' => 'upcoming']),
            Election::factory()->create(['organization_id' => $second->id, 'status' => 'upcoming']),
        ];
        Election::factory()->create(['organization_id' => $other->id, 'status' => 'upcoming']);
        $reports = [$this->reportFor($first, $firstAdmin), $this->reportFor($second, $secondAdmin)];
        $this->reportFor($other, $otherAdmin);
        $entries = [$this->ledgerEntry($first, $firstAdmin, 'income', 100), $this->ledgerEntry($second, $secondAdmin, 'income', 200)];
        $this->ledgerEntry($other, $otherAdmin, 'income', 400);
        $ids = fn (array $models) => collect($models)->pluck('id')->all();

        Sanctum::actingAs($head);
        $this->assertEqualsCanonicalizing($ids($events), collect($this->getJson('/api/events')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertEqualsCanonicalizing($ids($budgets), collect($this->getJson('/api/budgets')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertEqualsCanonicalizing($ids($elections), collect($this->getJson('/api/elections')->assertOk()->json())->pluck('id')->all());
        $this->assertEqualsCanonicalizing($ids($reports), collect($this->getJson('/api/financial-reports')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertEqualsCanonicalizing($ids($entries), collect($this->getJson('/api/transactions')->assertOk()->json('data'))->pluck('id')->all());
        $this->getJson('/api/transactions/summary')->assertOk()->assertJsonPath('total_income', 300);
        $this->getJson('/api/financial-dashboard')->assertOk()->assertJsonPath('available_funds', 300);

        $this->actingAsFresh($firstAdmin);
        $this->assertSame([$events[0]->id], collect($this->getJson('/api/events')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertSame([$budgets[0]->id], collect($this->getJson('/api/budgets')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertSame([$elections[0]->id], collect($this->getJson('/api/elections')->assertOk()->json())->pluck('id')->all());
        $this->assertSame([$reports[0]->id], collect($this->getJson('/api/financial-reports')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertSame([$entries[0]->id], collect($this->getJson('/api/transactions')->assertOk()->json('data'))->pluck('id')->all());
        $this->getJson('/api/financial-dashboard')->assertOk()->assertJsonPath('available_funds', 100);

        $this->actingAsFresh($officer);
        $this->assertSame([$events[0]->id], collect($this->getJson('/api/events')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertSame([$budgets[0]->id], collect($this->getJson('/api/budgets')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertSame([$entries[0]->id], collect($this->getJson('/api/transactions')->assertOk()->json('data'))->pluck('id')->all());
    }

    public function test_head_can_narrow_finance_reads_to_one_college_organization_but_not_a_foreign_one(): void
    {
        ['head' => $head, 'first' => $first, 'second' => $second, 'other' => $other,
            'firstAdmin' => $firstAdmin, 'secondAdmin' => $secondAdmin, 'otherAdmin' => $otherAdmin] = $this->world();
        $secondReport = $this->reportFor($second, $secondAdmin);
        $this->reportFor($first, $firstAdmin);
        $this->reportFor($other, $otherAdmin);
        $secondEntry = $this->ledgerEntry($second, $secondAdmin, 'expense', 50);
        $this->ledgerEntry($first, $firstAdmin, 'expense', 70);
        $secondForecast = FinancialForecast::factory()->create(['organization_id' => $second->id]);
        FinancialForecast::factory()->create(['organization_id' => $first->id]);
        FinancialForecast::factory()->create(['organization_id' => $other->id]);
        $secondCollection = Collection::create([
            'organization_id' => $second->id, 'reference' => 'COL-SECOND', 'amount_collected' => 90, 'source' => 'Dues',
            'collected_by' => $secondAdmin->school_id, 'collected_at' => now(), 'status' => 'verified',
        ]);
        Collection::create([
            'organization_id' => $first->id, 'reference' => 'COL-FIRST', 'amount_collected' => 10, 'source' => 'Dues',
            'collected_by' => $firstAdmin->school_id, 'collected_at' => now(), 'status' => 'verified',
        ]);

        Sanctum::actingAs($head);
        $this->assertCount(2, $this->getJson('/api/forecasts')->assertOk()->json('data') ?: []);
        $this->assertSame([$secondForecast->id], collect($this->getJson('/api/forecasts?organization_id='.$second->id)->assertOk()->json('data'))->pluck('id')->all());
        $this->assertSame([$secondReport->id], collect($this->getJson('/api/financial-reports?organization_id='.$second->id)->assertOk()->json('data'))->pluck('id')->all());
        $this->assertSame([$secondEntry->id], collect($this->getJson('/api/transactions?organization_id='.$second->id)->assertOk()->json('data'))->pluck('id')->all());
        $this->getJson('/api/transactions/summary?organization_id='.$second->id)->assertOk()->assertJsonPath('total_expense', 50);
        $this->getJson('/api/financial-dashboard?organization_id='.$second->id)->assertOk()->assertJsonPath('total_collections', 90);
        $this->assertSame([$secondCollection->id], collect($this->getJson('/api/collections?organization_id='.$second->id)->assertOk()->json())->pluck('id')->all());
        $this->assertCount(2, $this->getJson('/api/collections')->assertOk()->json());

        foreach (['/api/forecasts', '/api/financial-reports', '/api/transactions', '/api/transactions/summary', '/api/financial-dashboard', '/api/collections', '/api/cash-advances'] as $uri) {
            $this->getJson($uri.'?organization_id='.$other->id)->assertUnprocessable()->assertJsonValidationErrors('organization_id');
        }
    }

    public function test_head_reads_sibling_organization_events_but_not_another_colleges(): void
    {
        ['head' => $head, 'otherHead' => $otherHead, 'second' => $second, 'secondAdmin' => $secondAdmin] = $this->world();
        $event = $this->approvedEvent($second, $secondAdmin);
        Attendance::factory()->create(['event_id' => $event->id, 'user_id' => $secondAdmin->school_id, 'method' => 'manual', 'status' => 'present', 'check_in_time' => now()]);
        $planning = Event::factory()->create(['organization_id' => $second->id, 'created_by' => $secondAdmin->id, 'status' => 'planning']);
        $this->pendingApproval($second, 'event', $planning->id, $secondAdmin);

        Sanctum::actingAs($head);
        $this->getJson('/api/events/'.$event->id)->assertOk()->assertJsonPath('id', $event->id);
        $this->getJson('/api/events/'.$planning->id)->assertOk();
        $this->getJson('/api/events/'.$event->id.'/attendance')->assertOk()->assertJsonPath('event.id', $event->id);
        $this->getJson('/api/events/'.$planning->id.'/submission')->assertOk()->assertJsonPath('event.id', $planning->id);

        $this->actingAsFresh($otherHead);
        $this->getJson('/api/events/'.$event->id)->assertNotFound();
        $this->getJson('/api/events/'.$event->id.'/attendance')->assertNotFound();
        $this->getJson('/api/events/'.$planning->id.'/submission')->assertNotFound();
    }

    public function test_head_reads_sibling_organization_elections_candidates_and_results(): void
    {
        ['head' => $head, 'otherHead' => $otherHead, 'second' => $second] = $this->world();
        $election = Election::factory()->create([
            'organization_id' => $second->id, 'status' => 'closed', 'approved_at' => now()->subDay(), 'finalized_at' => now()->subDay(),
            'results_visible' => true,
        ]);
        $position = ElectionPosition::create(['election_id' => $election->id, 'title' => 'President', 'max_winners' => 1]);
        $candidate = Candidate::create([
            'election_id' => $election->id, 'position_id' => $position->id,
            'user_id' => User::factory()->student()->create(['organization_id' => $second->id])->school_id,
        ]);

        Sanctum::actingAs($head);
        $this->getJson('/api/elections/'.$election->id)->assertOk()->assertJsonPath('id', $election->id);
        $this->assertSame([$candidate->id], collect($this->getJson('/api/elections/'.$election->id.'/candidates')->assertOk()->json())->pluck('id')->all());
        $this->getJson('/api/elections/'.$election->id.'/results')->assertOk();

        $this->actingAsFresh($otherHead);
        $this->getJson('/api/elections/'.$election->id)->assertNotFound();
        $this->getJson('/api/elections/'.$election->id.'/candidates')->assertNotFound();
        $this->getJson('/api/elections/'.$election->id.'/results')->assertNotFound();
    }

    public function test_approval_for_a_sibling_organization_notifies_the_colleges_head_and_no_other_head(): void
    {
        ['head' => $head, 'otherHead' => $otherHead, 'second' => $second, 'secondAdmin' => $secondAdmin] = $this->world();
        $event = Event::factory()->create(['organization_id' => $second->id, 'created_by' => $secondAdmin->id, 'status' => 'planning']);

        $approval = $this->pendingApproval($second, 'event', $event->id, $secondAdmin);

        $this->assertDatabaseHas('notifications', [
            'organization_id' => $head->organization_id,
            'user_id' => $head->school_id,
            'reference_type' => 'approval_request',
            'reference_id' => $approval->id,
        ]);
        $this->assertDatabaseMissing('notifications', ['user_id' => $otherHead->school_id]);
        $this->assertSame(1, Notification::where('reference_id', $approval->id)->count());

        Sanctum::actingAs($head);
        $this->getJson('/api/notifications')->assertOk()->assertJsonPath('unread_count', 1)->assertJsonPath('data.0.reference_id', $approval->id);
    }

    public function test_head_briefing_counts_college_wide_approvals_and_nothing_from_other_colleges(): void
    {
        ['head' => $head, 'first' => $first, 'second' => $second, 'other' => $other,
            'firstAdmin' => $firstAdmin, 'secondAdmin' => $secondAdmin, 'otherAdmin' => $otherAdmin] = $this->world();
        $firstApproval = $this->pendingApproval($first, 'budget', $this->budgetFor($first)->id, $firstAdmin);
        $secondApproval = $this->pendingApproval($second, 'budget', $this->budgetFor($second)->id, $secondAdmin);
        $foreignApproval = $this->pendingApproval($other, 'budget', $this->budgetFor($other)->id, $otherAdmin);
        $this->approvedEvent($first, $firstAdmin);
        $this->approvedEvent($second, $secondAdmin);
        $this->approvedEvent($other, $otherAdmin)->update(['title' => 'Foreign Fest']);

        Sanctum::actingAs($head);
        $response = $this->getJson('/api/dashboard/briefing')->assertOk();

        $attention = collect($response->json('attention'))->where('type', 'approval')->pluck('id')->all();
        $this->assertEqualsCanonicalizing(['approval-'.$firstApproval->id, 'approval-'.$secondApproval->id], $attention);
        $this->assertNotContains('approval-'.$foreignApproval->id, $attention);
        $this->assertSame(2, $response->json('pillars.events.value'));
        $this->assertSame('Upcoming events college-wide', $response->json('pillars.events.label'));
        $this->assertNotContains('Foreign Fest', collect($response->json('agenda'))->pluck('title')->all());
        $this->assertCount(2, $response->json('agenda'));
    }

    public function test_head_cannot_cast_a_vote_and_is_not_counted_as_an_eligible_voter(): void
    {
        ['head' => $head, 'first' => $first, 'firstAdmin' => $firstAdmin] = $this->world();
        $student = User::factory()->student()->create(['organization_id' => $first->id]);
        $legacyHead = User::factory()->departmentHead()->create(['organization_id' => $first->id, 'account_status' => 'active']);
        $election = Election::factory()->create([
            'organization_id' => $first->id, 'status' => 'active', 'start_time' => now()->subHour(), 'end_time' => now()->addHour(),
            'approved_at' => now()->subDay(), 'finalized_at' => now()->subDay(),
        ]);
        $position = ElectionPosition::create(['election_id' => $election->id, 'title' => 'President', 'max_winners' => 1]);
        $candidate = Candidate::create(['election_id' => $election->id, 'position_id' => $position->id, 'user_id' => $student->school_id]);

        Sanctum::actingAs($head);
        $this->postJson('/api/elections/'.$election->id.'/vote', [
            'votes' => [['position_id' => $position->id, 'candidate_id' => $candidate->id]],
        ])->assertForbidden();
        $this->assertDatabaseCount('votes', 0);

        $this->actingAsFresh($firstAdmin);
        $this->getJson('/api/elections/'.$election->id.'/voters')->assertOk()
            ->assertJsonPath('summary.eligible_total', 2)
            ->assertJsonMissing(['school_id' => $legacyHead->school_id]);
        $this->assertSame(2, $this->getJson('/api/dashboard/briefing')->assertOk()->json('pillars.elections.meter.limit'));
    }

    public function test_head_announcement_feed_covers_the_college_and_the_saos_notices_but_no_other_college(): void
    {
        ['head' => $head, 'first' => $first, 'second' => $second, 'other' => $other,
            'firstAdmin' => $firstAdmin, 'secondAdmin' => $secondAdmin, 'otherAdmin' => $otherAdmin] = $this->world();
        $published = fn (Organization $organization, User $author, array $overrides = []) => Announcement::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $author->id, 'target_role' => 'all', 'is_published' => true,
            'approval_status' => 'approved', 'published_at' => now(), ...$overrides,
        ]);
        $own = [$published($first, $firstAdmin), $published($second, $secondAdmin)];
        $foreign = $published($other, $otherAdmin);
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $official = $published($sao, User::factory()->superAdmin()->create(['organization_id' => $sao->id]), ['announcement_source' => 'SAO']);
        DB::table('announcement_recipients')->insert([
            'announcement_id' => $official->id, 'user_id' => $head->school_id, 'organization_id' => $head->organization_id,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($head);
        $listed = collect($this->getJson('/api/announcements?published_only=1')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertEqualsCanonicalizing([...collect($own)->pluck('id')->all(), $official->id], $listed);
        $this->assertNotContains($foreign->id, $listed);
        $this->putJson('/api/announcements/'.$own[1]->id.'/reaction')->assertOk();
        $this->putJson('/api/announcements/'.$foreign->id.'/reaction')->assertNotFound();
    }

    public function test_head_objectives_evidence_is_college_wide(): void
    {
        ['head' => $head, 'first' => $first, 'second' => $second, 'other' => $other] = $this->world();
        FinancialForecast::factory()->count(2)->create(['organization_id' => $first->id]);
        FinancialForecast::factory()->count(3)->create(['organization_id' => $second->id]);
        FinancialForecast::factory()->count(7)->create(['organization_id' => $other->id]);

        Sanctum::actingAs($head);
        $payload = $this->getJson('/api/objectives/overview')->assertOk()->json();

        $finance = collect($payload['objectives'])->firstWhere('code', 'SO2.1');
        $this->assertSame(5, collect($finance['evidence'])->firstWhere('label', 'Expense forecasts generated (OLS regression)')['value']);
    }

    public function test_head_cached_lists_refresh_after_a_sibling_organization_writes(): void
    {
        config(['performance.api_cache.enabled' => true, 'performance.api_cache.ttl_seconds' => 20]);
        ['head' => $head, 'second' => $second, 'secondAdmin' => $secondAdmin] = $this->world();
        $this->budgetFor($second);

        Sanctum::actingAs($head);
        $this->assertCount(1, $this->getJson('/api/budgets')->assertOk()->json('data'));

        $this->actingAsFresh($secondAdmin);
        $this->postJson('/api/budgets', ['title' => 'Late Budget', 'allocated_amount' => 500, 'warning_threshold' => 50])->assertCreated();

        $this->actingAsFresh($head);
        $this->assertCount(2, $this->getJson('/api/budgets')->assertOk()->json('data'));
    }
}
