<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\FinancialReport;
use App\Models\Notification;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class FinancialReportResendClearsReviewNotificationTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    public function test_a_resent_report_reads_the_superseded_requests_review_notifications_and_asks_again_on_the_new_one(): void
    {
        $college = $this->makeCollege('CCS');
        $organization = $this->makeCollegeStudentOrganization($college);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->makeCollegeHead($college);
        Transaction::create([
            'organization_id' => $organization->id,
            'recorded_by' => $admin->school_id,
            'type' => 'income',
            'category' => 'membership',
            'amount' => 1000,
            'description' => 'Dues',
            'transaction_date' => now(),
        ]);

        Sanctum::actingAs($admin);
        $id = $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'monthly',
            'signatories' => ['treasurer' => 'T', 'president' => 'P', 'adviser' => 'A', 'sbo_adviser' => 'S'],
        ])->assertCreated()->json('report.id');
        $this->postJson("/api/financial-reports/{$id}/submit")->assertOk();

        $old = ApprovalRequest::where('entity_type', 'financial_report')->where('entity_id', $id)->where('status', 'pending')->firstOrFail();
        $this->assertGreaterThan(0, $this->reviewNotifications($old)->count());
        $this->assertTrue($this->reviewNotifications($old)->every(fn (Notification $notification) => $notification->is_read === false));

        // The report is open to sending again while its earlier request is still pending.
        FinancialReport::whereKey($id)->update(['submission_status' => 'rejected']);
        $this->postJson("/api/financial-reports/{$id}/submit")->assertOk();

        $this->assertSame('rejected', $old->fresh()->status);
        $this->assertTrue($this->reviewNotifications($old)->every(fn (Notification $notification) => $notification->is_read === true), 'the superseded request stops asking for review');

        $new = ApprovalRequest::where('entity_type', 'financial_report')->where('entity_id', $id)->where('status', 'pending')->firstOrFail();
        $this->assertNotSame($old->id, $new->id);
        $this->assertGreaterThan(0, $this->reviewNotifications($new)->count());
        $this->assertTrue($this->reviewNotifications($new)->every(fn (Notification $notification) => $notification->is_read === false), 'the new request asks for review');
    }

    private function reviewNotifications(ApprovalRequest $approval)
    {
        return Notification::where('reference_type', 'approval_request')->where('reference_id', $approval->id)->get();
    }
}
