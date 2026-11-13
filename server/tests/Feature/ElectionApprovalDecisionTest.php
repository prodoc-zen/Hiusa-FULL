<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\ElectionRuleVersion;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * What the Department Head decides on an election proposal: a final rejection that declines it for good, the rules
 * snapshot an approval records, and the whole proposal the reviewer reads before deciding.
 */
class ElectionApprovalDecisionTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $head;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        $college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->head = $this->makeCollegeHead($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
    }

    private function proposal(array $attributes = []): array
    {
        $election = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'pending_approval',
            'start_time' => now()->addDays(10),
            'end_time' => now()->addDays(11),
            'submitted_at' => now(),
            'rules' => 'One vote per position.',
            'tie_break_rule' => 'Longest membership wins.',
            ...$attributes,
        ]);

        return [$election, $this->approvalFor($election)];
    }

    private function approvalFor(Election $election): ApprovalRequest
    {
        return ApprovalRequest::create([
            'organization_id' => $this->organization->id,
            'entity_type' => 'election',
            'entity_id' => $election->id,
            'requested_by' => $this->admin->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'pending',
        ]);
    }

    private function decide(ApprovalRequest $approval, array $payload)
    {
        Sanctum::actingAs($this->head);

        return $this->patchJson('/api/approval-requests/'.$approval->id, $payload);
    }

    private function summaryOf(ApprovalRequest $approval): array
    {
        Sanctum::actingAs($this->head);

        return collect($this->getJson('/api/approval-requests')->assertOk()->json('data'))->firstWhere('id', $approval->id)['summary'];
    }

    public function test_a_final_rejection_declines_the_election_for_good_with_the_reason(): void
    {
        [$election, $approval] = $this->proposal();

        $this->decide($approval, ['status' => 'rejected', 'final' => true, 'remarks' => 'The schedule clashes with the foundation week.'])->assertOk();

        $election = $election->fresh();
        $this->assertNotNull($election->declined_at);
        $this->assertSame('pending_approval', $election->status);
        $this->assertSame('rejected', $approval->fresh()->status);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $this->admin->school_id,
            'message' => 'Your election "'.$election->title.'" was rejected: The schedule clashes with the foundation week.',
        ]);
        $audit = AuditLog::where('module', 'elections')->where('action', 'declined')->where('record_id', $election->id)->first();
        $this->assertNotNull($audit);
        $this->assertSame($this->head->school_id, $audit->user_id);
        $this->assertSame('The schedule clashes with the foundation week.', $audit->new_values['reason']);
    }

    public function test_a_final_rejection_needs_the_written_reason(): void
    {
        [$election, $approval] = $this->proposal();

        $this->decide($approval, ['status' => 'rejected', 'final' => true])->assertUnprocessable()->assertJsonValidationErrors('remarks');

        $this->assertNull($election->fresh()->declined_at);
        $this->assertSame('pending', $approval->fresh()->status);
    }

    public function test_final_is_only_valid_for_an_election_rejection(): void
    {
        [$election, $approval] = $this->proposal();
        $this->decide($approval, ['status' => 'approved', 'final' => true])->assertUnprocessable();
        $this->assertSame('pending', $approval->fresh()->status);
        $this->assertNull($election->fresh()->declined_at);

        $budget = Budget::factory()->create(['organization_id' => $this->organization->id]);
        $budgetApproval = ApprovalRequest::create([
            'organization_id' => $this->organization->id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'requested_by' => $this->admin->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'pending',
        ]);
        $this->decide($budgetApproval, ['status' => 'rejected', 'final' => true, 'remarks' => 'No.'])->assertUnprocessable();
        $this->assertSame('pending', $budgetApproval->fresh()->status);
    }

    public function test_a_plain_rejection_is_still_a_return_for_changes(): void
    {
        [$election, $approval] = $this->proposal();

        $this->decide($approval, ['status' => 'rejected', 'remarks' => 'Move the date.'])->assertOk();

        $this->assertNull($election->fresh()->declined_at);
        $this->assertSame('rejected', $approval->fresh()->status);
        $this->assertDatabaseHas('notifications', ['user_id' => $this->admin->school_id, 'message' => 'Election "'.$election->title.'" was rejected.']);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'declined', 'record_id' => $election->id]);
    }

    public function test_a_cancelled_election_cannot_be_approved(): void
    {
        [$election, $approval] = $this->proposal(['cancelled_at' => now(), 'status' => 'closed', 'phase' => 'cancelled']);

        $this->decide($approval, ['status' => 'approved'])->assertConflict();

        $this->assertSame('closed', $election->fresh()->status);
        $this->assertNull($election->fresh()->approved_at);
    }

    public function test_approval_records_the_rules_as_version_one(): void
    {
        [$election, $approval] = $this->proposal();

        $this->decide($approval, ['status' => 'approved'])->assertOk();

        $election = $election->fresh();
        $this->assertSame('upcoming', $election->status);
        $this->assertSame(1, $election->rules_version);
        $version = ElectionRuleVersion::where('election_id', $election->id)->sole();
        $this->assertSame(1, $version->version);
        $this->assertSame('One vote per position.', $version->rules);
        $this->assertSame('Longest membership wins.', $version->tie_break_rule);
        $this->assertSame($this->head->school_id, $version->approved_by);
        $this->assertNotNull($version->approved_at);
        $this->assertDatabaseHas('audit_logs', ['module' => 'elections', 'action' => 'rules_version_created', 'record_id' => $election->id, 'user_id' => $this->head->school_id]);
    }

    public function test_a_reapproval_with_the_same_rules_creates_no_new_version(): void
    {
        [$election, $approval] = $this->proposal();
        $this->decide($approval, ['status' => 'approved'])->assertOk();

        $election->update(['status' => 'pending_approval', 'approved_at' => null]);
        $second = $this->approvalFor($election);
        $this->decide($second, ['status' => 'approved'])->assertOk();

        $this->assertSame(1, $election->fresh()->rules_version);
        $this->assertSame(1, ElectionRuleVersion::where('election_id', $election->id)->count());
        $this->assertSame(1, AuditLog::where('action', 'rules_version_created')->where('record_id', $election->id)->count());
    }

    public function test_a_reapproval_with_changed_rules_or_tie_break_creates_the_next_version(): void
    {
        [$election, $approval] = $this->proposal();
        $this->decide($approval, ['status' => 'approved'])->assertOk();

        $election->update(['status' => 'pending_approval', 'approved_at' => null, 'rules' => 'Two votes per position.']);
        $this->decide($this->approvalFor($election), ['status' => 'approved'])->assertOk();
        $this->assertSame(2, $election->fresh()->rules_version);
        $this->assertSame('Two votes per position.', ElectionRuleVersion::where('election_id', $election->id)->where('version', 2)->value('rules'));

        $election->update(['status' => 'pending_approval', 'approved_at' => null, 'tie_break_rule' => 'Drawing of lots.']);
        $this->decide($this->approvalFor($election), ['status' => 'approved'])->assertOk();
        $this->assertSame(3, $election->fresh()->rules_version);
        $this->assertSame('Drawing of lots.', ElectionRuleVersion::where('election_id', $election->id)->where('version', 3)->value('tie_break_rule'));
    }

    public function test_a_legacy_election_without_rules_records_no_version(): void
    {
        [$election, $approval] = $this->proposal(['rules' => null, 'tie_break_rule' => null]);

        $this->decide($approval, ['status' => 'approved'])->assertOk();

        $this->assertSame(0, $election->fresh()->rules_version);
        $this->assertSame(0, ElectionRuleVersion::where('election_id', $election->id)->count());
        $this->assertDatabaseMissing('audit_logs', ['action' => 'rules_version_created']);
    }

    public function test_the_summary_carries_the_whole_proposal_for_the_reviewer(): void
    {
        [$election, $approval] = $this->proposal([
            'description' => 'Annual student council election.',
            'filing_starts_at' => now()->addDay(),
            'filing_ends_at' => now()->addDays(2),
            'screening_starts_at' => now()->addDays(3),
            'screening_ends_at' => now()->addDays(4),
            'campaign_starts_at' => now()->addDays(5),
            'campaign_ends_at' => now()->addDays(6),
            'results_publish_at' => now()->addDays(12),
            'min_units' => 12,
            'min_gpa' => 2.5,
        ]);
        ElectionPosition::create([
            'election_id' => $election->id, 'title' => 'President', 'max_winners' => 1, 'description' => 'Leads the council.',
            'is_executive' => true, 'vote_limit' => 1, 'eligible_year_levels' => [2, 3], 'other_qualifications' => 'Good standing.', 'is_active' => true,
        ]);
        ElectionPosition::create(['election_id' => $election->id, 'title' => 'Senator', 'max_winners' => 3, 'vote_limit' => 2, 'is_active' => false]);

        $summary = $this->summaryOf($approval);

        $this->assertSame('Annual student council election.', $summary['description']);
        $this->assertSame($this->organization->name, $summary['organization']);
        foreach (['filing_starts_at', 'filing_ends_at', 'screening_starts_at', 'screening_ends_at', 'campaign_starts_at', 'campaign_ends_at', 'results_publish_at'] as $key) {
            $this->assertNotNull($summary[$key], $key);
        }
        $this->assertSame(12, $summary['min_units']);
        $this->assertEquals(2.5, $summary['min_gpa']);
        $this->assertSame('One vote per position.', $summary['rules']);
        $this->assertSame('Longest membership wins.', $summary['tie_break_rule']);
        $this->assertSame(0, $summary['rules_version']);
        $this->assertTrue($summary['uses_filing']);
        $this->assertCount(2, $summary['positions']);
        $this->assertSame([
            'title' => 'President', 'description' => 'Leads the council.', 'is_executive' => true, 'max_winners' => 1,
            'vote_limit' => 1, 'eligible_year_levels' => [2, 3], 'other_qualifications' => 'Good standing.', 'is_active' => true,
        ], $summary['positions'][0]);
        $this->assertFalse($summary['positions'][1]['is_active']);
    }

    public function test_the_summary_of_a_legacy_election_has_no_filing_flag(): void
    {
        [, $approval] = $this->proposal(['rules' => null, 'tie_break_rule' => null]);

        $summary = $this->summaryOf($approval);

        $this->assertFalse($summary['uses_filing']);
        $this->assertSame([], $summary['positions']);
    }
}
