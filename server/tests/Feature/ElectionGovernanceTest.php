<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\Election;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * Suspend, resume and cancel by the organization's Admin, who the reviewer and the other Admins are told, and the
 * approval history the reviewer and the Admin read.
 */
class ElectionGovernanceTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $otherAdmin;

    private User $officer;

    private User $student;

    private User $head;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        $college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->head = $this->makeCollegeHead($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->otherAdmin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->officer = User::factory()->officer()->create(['organization_id' => $this->organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
    }

    private function approved(array $attributes = []): Election
    {
        return Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'upcoming',
            'approved_at' => now()->subDay(),
            'start_time' => now()->addDays(10),
            'end_time' => now()->addDays(11),
            'phase' => 'filing',
            ...$attributes,
        ]);
    }

    public function test_the_admin_suspends_an_approved_election_with_a_reason(): void
    {
        $election = $this->approved();
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/elections/'.$election->id.'/suspend', ['reason' => 'A complaint is under review.'])->assertOk();

        $election = $election->fresh();
        $this->assertNotNull($election->suspended_at);
        $this->assertSame('A complaint is under review.', $election->halt_reason);
        $this->assertTrue($election->isHalted());
        $audit = AuditLog::where('module', 'elections')->where('action', 'suspended')->where('record_id', $election->id)->sole();
        $this->assertSame($this->admin->school_id, $audit->user_id);
        $this->assertSame($this->organization->id, $audit->organization_id);
        $this->assertSame('A complaint is under review.', $audit->new_values['reason']);
    }

    public function test_the_reviewer_and_the_other_admins_are_told_but_not_the_actor(): void
    {
        $election = $this->approved();
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/elections/'.$election->id.'/suspend', ['reason' => 'A complaint is under review.'])->assertOk();

        foreach ([$this->head, $this->otherAdmin] as $recipient) {
            $note = Notification::where('user_id', $recipient->school_id)->where('reference_type', 'election')->where('reference_id', $election->id)->sole();
            $this->assertSame('election', $note->notification_type);
            $this->assertSame('Election suspended', $note->title);
            $this->assertStringContainsString($election->title, $note->message);
            $this->assertStringContainsString('A complaint is under review.', $note->message);
        }
        $this->assertSame(0, Notification::where('user_id', $this->admin->school_id)->where('reference_id', $election->id)->count());
        $this->assertSame(0, Notification::where('user_id', $this->officer->school_id)->count());
        $this->assertSame(0, Notification::where('user_id', $this->student->school_id)->count());
    }

    public function test_a_university_wide_election_tells_the_sao_not_a_college_head(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $council = Organization::factory()->create(['is_university_wide' => true, 'college_id' => null, 'college' => null, 'parent_organization_id' => null]);
        $admin = User::factory()->admin()->create(['organization_id' => $council->id]);
        $election = Election::factory()->create([
            'organization_id' => $council->id, 'status' => 'upcoming', 'approved_at' => now()->subDay(),
            'start_time' => now()->addDays(10), 'end_time' => now()->addDays(11), 'phase' => 'filing',
        ]);
        Sanctum::actingAs($admin);

        $this->postJson('/api/elections/'.$election->id.'/cancel', ['reason' => 'The council was dissolved.'])->assertOk();

        $this->assertSame(1, Notification::where('user_id', $director->school_id)->where('reference_id', $election->id)->count());
        $this->assertSame(0, Notification::where('user_id', $this->head->school_id)->count());
    }

    public function test_a_reason_is_required_and_capped(): void
    {
        $election = $this->approved();
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/elections/'.$election->id.'/suspend', [])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->postJson('/api/elections/'.$election->id.'/suspend', ['reason' => str_repeat('a', 501)])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->postJson('/api/elections/'.$election->id.'/cancel', [])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->assertNull($election->fresh()->suspended_at);
        $this->assertNull($election->fresh()->cancelled_at);
    }

    public function test_only_an_approved_running_election_can_be_suspended(): void
    {
        Sanctum::actingAs($this->admin);
        $blocked = [
            'pending approval' => $this->approved(['status' => 'pending_approval', 'approved_at' => null, 'phase' => null]),
            'already suspended' => $this->approved(['suspended_at' => now(), 'halt_reason' => 'Earlier.']),
            'cancelled' => $this->approved(['cancelled_at' => now(), 'phase' => 'cancelled', 'status' => 'closed']),
            'completed' => $this->approved(['completed_at' => now(), 'phase' => 'completed', 'status' => 'closed']),
            'closed before this release' => $this->approved(['status' => 'closed', 'phase' => null]),
        ];

        foreach ($blocked as $label => $election) {
            $this->postJson('/api/elections/'.$election->id.'/suspend', ['reason' => 'Because.'])->assertConflict();
            $this->assertDatabaseMissing('audit_logs', ['action' => 'suspended', 'record_id' => $election->id]);
        }
    }

    public function test_resume_clears_the_suspension_and_tells_the_same_people(): void
    {
        $election = $this->approved(['suspended_at' => now()->subHour(), 'halt_reason' => 'A complaint is under review.']);
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/elections/'.$election->id.'/resume')->assertOk();

        $election = $election->fresh();
        $this->assertNull($election->suspended_at);
        $this->assertNull($election->halt_reason);
        $this->assertFalse($election->isHalted());
        $this->assertDatabaseHas('audit_logs', ['module' => 'elections', 'action' => 'resumed', 'record_id' => $election->id, 'user_id' => $this->admin->school_id]);
        foreach ([$this->head, $this->otherAdmin] as $recipient) {
            $this->assertSame(1, Notification::where('user_id', $recipient->school_id)->where('title', 'Election resumed')->where('reference_id', $election->id)->count());
        }
    }

    public function test_resume_needs_a_suspended_election(): void
    {
        $running = $this->approved();
        $cancelled = $this->approved(['suspended_at' => now(), 'cancelled_at' => now(), 'phase' => 'cancelled', 'status' => 'closed']);
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/elections/'.$running->id.'/resume')->assertConflict();
        $this->postJson('/api/elections/'.$cancelled->id.'/resume')->assertConflict();
        $this->assertNotNull($cancelled->fresh()->cancelled_at);
    }

    public function test_cancel_closes_the_election_for_good(): void
    {
        $election = $this->approved(['status' => 'active', 'finalized_at' => now()->subDay(), 'results_visible' => true, 'phase' => 'voting']);
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/elections/'.$election->id.'/cancel', ['reason' => 'The venue is unavailable.'])->assertOk();

        $election = $election->fresh();
        $this->assertNotNull($election->cancelled_at);
        $this->assertSame('The venue is unavailable.', $election->halt_reason);
        $this->assertSame('closed', $election->status);
        $this->assertFalse($election->results_visible);
        $this->assertSame('cancelled', $election->phase);
        $audit = AuditLog::where('module', 'elections')->where('action', 'cancelled')->where('record_id', $election->id)->sole();
        $this->assertSame('The venue is unavailable.', $audit->new_values['reason']);
        $this->assertSame(1, Notification::where('user_id', $this->head->school_id)->where('title', 'Election cancelled')->count());
        $this->assertSame(1, Notification::where('user_id', $this->otherAdmin->school_id)->where('title', 'Election cancelled')->count());
    }

    public function test_a_draft_or_pending_election_can_be_cancelled_but_a_finished_one_cannot(): void
    {
        $pending = $this->approved(['status' => 'pending_approval', 'approved_at' => null, 'phase' => null]);
        $cancelled = $this->approved(['cancelled_at' => now(), 'phase' => 'cancelled', 'status' => 'closed']);
        $completed = $this->approved(['completed_at' => now(), 'phase' => 'completed', 'status' => 'closed']);
        $closedBefore = $this->approved(['status' => 'closed', 'phase' => null, 'tally_version' => 1]);
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/elections/'.$pending->id.'/cancel', ['reason' => 'Not needed.'])->assertOk();
        $this->assertNotNull($pending->fresh()->cancelled_at);
        foreach ([$cancelled, $completed, $closedBefore] as $election) {
            $this->postJson('/api/elections/'.$election->id.'/cancel', ['reason' => 'Too late.'])->assertConflict();
        }
        $this->assertSame('completed', $completed->fresh()->phase);
        $this->assertNull($closedBefore->fresh()->cancelled_at);
    }

    public function test_an_officer_a_student_and_another_organization_cannot_change_the_state(): void
    {
        $election = $this->approved();
        $other = $this->makeCollegeStudentOrganization($this->makeCollege('CBE'));
        $foreignAdmin = User::factory()->admin()->create(['organization_id' => $other->id]);

        foreach ([$this->officer, $this->student] as $user) {
            Sanctum::actingAs($user);
            $this->postJson('/api/elections/'.$election->id.'/suspend', ['reason' => 'x'])->assertForbidden();
            $this->postJson('/api/elections/'.$election->id.'/resume')->assertForbidden();
            $this->postJson('/api/elections/'.$election->id.'/cancel', ['reason' => 'x'])->assertForbidden();
        }

        Sanctum::actingAs($foreignAdmin);
        $this->postJson('/api/elections/'.$election->id.'/suspend', ['reason' => 'x'])->assertNotFound();
        $this->postJson('/api/elections/'.$election->id.'/resume')->assertNotFound();
        $this->postJson('/api/elections/'.$election->id.'/cancel', ['reason' => 'x'])->assertNotFound();

        $this->assertNull($election->fresh()->suspended_at);
        $this->assertNull($election->fresh()->cancelled_at);
        $this->assertSame(0, AuditLog::where('module', 'elections')->whereIn('action', ['suspended', 'resumed', 'cancelled'])->count());
    }

    public function test_the_approval_history_reads_oldest_first_from_both_audit_trails(): void
    {
        $election = $this->approved(['status' => 'pending_approval', 'approved_at' => null, 'phase' => null, 'rules' => 'One vote per position.', 'tie_break_rule' => 'Drawing of lots.']);

        $first = ApprovalRequest::create([
            'organization_id' => $this->organization->id, 'entity_type' => 'election', 'entity_id' => $election->id,
            'requested_by' => $this->admin->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending',
        ]);
        $this->travel(1)->minutes();
        Sanctum::actingAs($this->head);
        $this->patchJson('/api/approval-requests/'.$first->id, ['status' => 'rejected', 'remarks' => 'Move the date.'])->assertOk();
        $this->travel(1)->minutes();
        $first->fresh()->resubmit();
        $this->travel(1)->minutes();
        Sanctum::actingAs($this->head);
        $this->patchJson('/api/approval-requests/'.$first->id, ['status' => 'approved'])->assertOk();
        $this->travel(1)->minutes();
        AuditLog::create([
            'organization_id' => $this->organization->id, 'user_id' => $this->admin->school_id, 'actor_role' => 'ADMIN', 'module' => 'elections',
            'action' => 'approval_reopened', 'record_type' => Election::class, 'record_id' => $election->id, 'created_at' => now(),
        ]);
        $second = ApprovalRequest::create([
            'organization_id' => $this->organization->id, 'entity_type' => 'election', 'entity_id' => $election->id,
            'requested_by' => $this->admin->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending',
        ]);
        $this->travel(1)->minutes();
        Sanctum::actingAs($this->head);
        $this->patchJson('/api/approval-requests/'.$second->id, ['status' => 'rejected', 'final' => true, 'remarks' => 'Not this term.'])->assertOk();

        // Another election's trail must not leak in.
        $elsewhere = $this->approved();
        ApprovalRequest::create([
            'organization_id' => $this->organization->id, 'entity_type' => 'election', 'entity_id' => $elsewhere->id,
            'requested_by' => $this->admin->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending',
        ]);

        foreach ([$this->admin, $this->officer, $this->head] as $viewer) {
            Sanctum::actingAs($viewer);
            $history = $this->getJson('/api/elections/'.$election->id.'/approval-history')->assertOk()->json();

            $this->assertSame(
                ['submitted', 'returned', 'resubmitted', 'approved', 'approval_reopened', 'submitted', 'declined'],
                array_column($history, 'action'),
            );
        }

        Sanctum::actingAs($this->admin);
        $history = $this->getJson('/api/elections/'.$election->id.'/approval-history')->json();
        $this->assertSame($this->admin->first_name.' '.$this->admin->last_name, $history[0]['actor_name']);
        $this->assertSame('ADMIN', $history[0]['actor_role']);
        $this->assertNull($history[0]['remarks']);
        $this->assertSame('Move the date.', $history[1]['remarks']);
        $this->assertSame($this->head->first_name.' '.$this->head->last_name, $history[1]['actor_name']);
        $this->assertSame('DEPARTMENT_HEAD', $history[1]['actor_role']);
        $this->assertSame(1, $history[3]['rules_version']);
        $this->assertNull($history[1]['rules_version']);
        $this->assertSame('Not this term.', $history[6]['remarks']);
        $this->assertNotNull($history[0]['at']);
        $times = array_column($history, 'at');
        $sorted = $times;
        sort($sorted);
        $this->assertSame($sorted, $times);
    }

    public function test_the_reviewer_cannot_read_the_history_of_a_draft_that_was_never_submitted(): void
    {
        $draft = $this->approved(['status' => 'pending_approval', 'approved_at' => null, 'phase' => null, 'submitted_at' => null]);

        Sanctum::actingAs($this->head);
        $this->getJson('/api/elections/'.$draft->id.'/approval-history')->assertNotFound();
        Sanctum::actingAs($this->admin);
        $this->getJson('/api/elections/'.$draft->id.'/approval-history')->assertOk()->assertExactJson([]);
    }

    public function test_the_approval_history_is_limited_to_the_organization_its_college_head_and_the_sao(): void
    {
        $election = $this->approved();
        $other = $this->makeCollegeStudentOrganization($this->makeCollege('CBE'));
        $foreignAdmin = User::factory()->admin()->create(['organization_id' => $other->id]);
        $foreignHead = $this->makeCollegeHead(College::where('code', 'CBE')->firstOrFail());

        Sanctum::actingAs($foreignAdmin);
        $this->getJson('/api/elections/'.$election->id.'/approval-history')->assertNotFound();
        Sanctum::actingAs($foreignHead);
        $this->getJson('/api/elections/'.$election->id.'/approval-history')->assertNotFound();
        Sanctum::actingAs($this->student);
        $this->getJson('/api/elections/'.$election->id.'/approval-history')->assertForbidden();

        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $council = Organization::factory()->create(['is_university_wide' => true, 'college_id' => null, 'college' => null, 'parent_organization_id' => null]);
        $unified = Election::factory()->create(['organization_id' => $council->id, 'status' => 'pending_approval', 'submitted_at' => now()]);
        Sanctum::actingAs($director);
        $this->getJson('/api/elections/'.$unified->id.'/approval-history')->assertOk()->assertExactJson([]);
        $this->getJson('/api/elections/'.$election->id.'/approval-history')->assertNotFound();
    }
}
