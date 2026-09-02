<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\Budget;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\Event;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Guards the demo/seeded database itself, not a single feature. A fresh
 * install must be demonstrable end to end: every headline module (elections,
 * events, finance, merchandise) must be able to operate on the seeded data
 * without hitting an approval or configuration gate first, and the screens a
 * panel is likely to open must not be empty.
 *
 * This test seeds via the real DatabaseSeeder chain and runs on SQLite
 * in-memory (see phpunit.xml), which is exactly where a lowercase role
 * literal (MySQL's collation hides it, SQLite does not) or a missing
 * approval row would surface.
 */
class DemoDataIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private const VALID_TARGET_ROLES = ['all', 'STUDENT', 'SBO_OFFICER', 'ADMIN', 'DEPARTMENT_HEAD'];

    public function test_a_freshly_seeded_database_is_actually_demonstrable(): void
    {
        $this->seed();

        $this->assertAnnouncementTargetingIsValid();
        $this->assertPublishedAnnouncementsAreApprovedAndVisibleToStudents();
        $this->assertAnEventIsApprovedWithAMatchingApprovalRequest();
        $this->assertAnElectionIsApprovedWithAMatchingApprovalRequest();
        $this->assertABudgetIsApprovedAndAcceptsARealTransactionPost();
        $this->assertAnOrganizationHasAGcashQrConfigured();
        $this->assertEverySboOfficerHasAValidPositionTitle();
        $this->assertHeadlineScreensAreNotEmpty();
        $this->assertAtLeastOneStudentHasNotVotedYet();
    }

    private function assertAnnouncementTargetingIsValid(): void
    {
        $targetRoles = Announcement::pluck('target_role');
        $this->assertNotEmpty($targetRoles, 'AnnouncementSeeder produced no rows.');

        foreach ($targetRoles as $targetRole) {
            $this->assertNotSame('adviser', $targetRole, 'An announcement still targets the retired "adviser" role.');
            $this->assertContains(
                $targetRole,
                self::VALID_TARGET_ROLES,
                "Announcement target_role '{$targetRole}' is not 'all' or a currently valid uppercase role."
            );
        }
    }

    private function assertPublishedAnnouncementsAreApprovedAndVisibleToStudents(): void
    {
        $published = Announcement::where('is_published', true)->get();
        $this->assertNotEmpty($published, 'No announcement is published.');

        foreach ($published as $announcement) {
            $this->assertSame(
                'approved',
                $announcement->approval_status,
                "Published announcement #{$announcement->id} is not approval_status 'approved'."
            );
        }

        $visibleToAll = Announcement::where('is_published', true)
            ->where('approval_status', 'approved')
            ->where('target_role', 'all')
            ->pluck('id');
        $this->assertNotEmpty($visibleToAll, 'No published+approved announcement targets "all".');

        // Must be a student in the same organization the announcements were
        // seeded into (PSITS-CCS) - AnnouncementController::index() scopes by
        // organization_id, and other seeded students belong to other orgs.
        $student = User::where('school_id', 2100142)->firstOrFail();
        Sanctum::actingAs($student);

        $visibleIds = collect($this->getJson('/api/announcements')->assertOk()->json('data'))->pluck('id');

        foreach ($visibleToAll as $id) {
            $this->assertTrue(
                $visibleIds->contains($id),
                "Announcement #{$id} should be visible to a STUDENT through AnnouncementController::index() but was not."
            );
        }
    }

    private function assertAnEventIsApprovedWithAMatchingApprovalRequest(): void
    {
        $approvedEvent = Event::whereNotNull('approved_at')->first();
        $this->assertNotNull($approvedEvent, 'No event has approved_at set.');

        $this->assertTrue(
            ApprovalRequest::where('entity_type', 'event')
                ->where('entity_id', $approvedEvent->id)
                ->where('status', 'approved')
                ->exists(),
            "Event #{$approvedEvent->id} has approved_at but no matching approved ApprovalRequest."
        );

        // At least one event must remain unapproved and pending so the
        // Department Head Approvals screen has something real to review.
        $this->assertTrue(
            Event::whereNull('approved_at')->exists(),
            'Every seeded event is approved - the approval workflow has nothing left to demonstrate.'
        );
        $this->assertTrue(
            ApprovalRequest::where('entity_type', 'event')->where('status', 'pending')->exists(),
            'No pending event ApprovalRequest exists for the Department Head to act on.'
        );
    }

    private function assertAnElectionIsApprovedWithAMatchingApprovalRequest(): void
    {
        $approvedElection = Election::whereNotNull('approved_at')->first();
        $this->assertNotNull($approvedElection, 'No election has approved_at set.');

        $this->assertTrue(
            ApprovalRequest::where('entity_type', 'election')
                ->where('entity_id', $approvedElection->id)
                ->where('status', 'approved')
                ->exists(),
            "Election #{$approvedElection->id} has approved_at but no matching approved ApprovalRequest."
        );
    }

    private function assertABudgetIsApprovedAndAcceptsARealTransactionPost(): void
    {
        // Budgets have no approved_at column of their own - TransactionController
        // gates new postings solely on the latest ApprovalRequest for the budget
        // being 'approved', so that is what proves a budget is demo-ready.
        $approvedApproval = ApprovalRequest::where('entity_type', 'budget')
            ->where('status', 'approved')
            ->first();
        $this->assertNotNull($approvedApproval, 'No budget has an approved ApprovalRequest.');

        $approvedBudget = Budget::find($approvedApproval->entity_id);
        $this->assertNotNull($approvedBudget, 'The approved budget ApprovalRequest points at a budget that no longer exists.');

        // At least one budget must remain unapproved and pending for the same
        // reason as events above.
        $this->assertTrue(
            ApprovalRequest::where('entity_type', 'budget')->where('status', 'pending')->exists(),
            'No pending budget ApprovalRequest exists for the Department Head to act on.'
        );

        // POST /api/transactions is ADMIN-only (routes/api.php), and must be an
        // admin in the same organization as the approved budget -
        // TransactionController scopes both the requester and the budget to the
        // requester's organization_id, and other seeded admins belong to other
        // orgs.
        $admin = User::where('school_id', 990001)->firstOrFail();
        Sanctum::actingAs($admin);

        $this->postJson('/api/transactions', [
            'budget_id' => $approvedBudget->id,
            'type' => 'income',
            'category' => 'Demo Integrity Check',
            'amount' => 100,
            'description' => 'Proves the approved budget actually clears TransactionController\'s approval gate.',
            'transaction_date' => now()->toDateString(),
        ])->assertCreated();
    }

    private function assertAnOrganizationHasAGcashQrConfigured(): void
    {
        $this->assertTrue(
            Organization::whereNotNull('gcash_qr_url')->where('gcash_qr_url', '!=', '')->exists(),
            'No organization has a gcash_qr_url configured - the merchandise GCash path is not demonstrable.'
        );
    }

    private function assertEverySboOfficerHasAValidPositionTitle(): void
    {
        $seededTitles = SboPosition::pluck('title')->unique();
        $this->assertNotEmpty($seededTitles, 'SboPositionSeeder produced no rows.');

        $officers = User::where('role', 'SBO_OFFICER')->get(['school_id', 'position_title']);
        $this->assertNotEmpty($officers, 'No SBO_OFFICER users were seeded.');

        foreach ($officers as $officer) {
            $this->assertNotNull(
                $officer->position_title,
                "SBO_OFFICER {$officer->school_id} has no position_title - the AI delegation engine's position-relevance score cannot discriminate for this officer."
            );
            $this->assertTrue(
                $seededTitles->contains($officer->position_title),
                "SBO_OFFICER {$officer->school_id} has position_title '{$officer->position_title}', which does not match any seeded sbo_positions title."
            );
        }

        // The spread must be genuinely discriminating, not every officer
        // sharing one title (which would collapse back to a single score).
        $this->assertGreaterThan(
            1,
            $officers->pluck('position_title')->unique()->count(),
            'All seeded SBO_OFFICER users share the same position_title - the delegation ranking would not be discriminating.'
        );
    }

    private function assertHeadlineScreensAreNotEmpty(): void
    {
        $this->assertGreaterThan(0, Vote::count(), 'votes table is empty - the elections results screen has nothing to show.');
        $this->assertGreaterThan(0, Attendance::count(), 'attendance table is empty - the event attendance screen has nothing to show.');
        $this->assertGreaterThan(0, Order::count(), 'orders table is empty - the merchandise fulfilment screen has nothing to show.');
        $this->assertGreaterThan(0, Notification::count(), 'notifications table is empty - the notification bell has nothing to show.');

        // The fulfilment pipeline must actually be visible across more than
        // one status, and at least one order must remain pending.
        $this->assertTrue(Order::where('status', 'pending')->exists(), 'No pending order exists to demonstrate officer verification.');
        $this->assertGreaterThan(
            1,
            Order::pluck('status')->unique()->count(),
            'Every seeded order shares the same status - the fulfilment pipeline is not visible.'
        );
    }

    private function assertAtLeastOneStudentHasNotVotedYet(): void
    {
        $election = Election::whereNotNull('approved_at')->firstOrFail();

        $candidateCount = Candidate::where('election_id', $election->id)->count();
        $this->assertGreaterThan(0, $candidateCount, 'The approved election has no candidates.');

        $voterIds = Vote::where('election_id', $election->id)->pluck('voter_id')->unique();
        $this->assertNotEmpty($voterIds, 'No votes were cast in the approved election.');

        $eligibleStudentIds = User::where('role', 'STUDENT')
            ->where('organization_id', $election->organization_id)
            ->pluck('school_id');

        $notYetVoted = $eligibleStudentIds->diff($voterIds);

        $this->assertNotEmpty(
            $notYetVoted,
            'Every eligible student has already voted - there is no student left to demonstrate a live cast-vote (and double-vote rejection) with.'
        );
    }
}
