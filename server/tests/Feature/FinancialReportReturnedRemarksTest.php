<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FinancialReportReturnedRemarksTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $departmentHead;

    private FinancialReport $report;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        Transaction::create([
            'organization_id' => $organization->id,
            'recorded_by' => $this->admin->school_id,
            'type' => 'income',
            'category' => 'membership',
            'amount' => 1000,
            'description' => 'Dues',
            'transaction_date' => now(),
        ]);

        Sanctum::actingAs($this->admin);
        $id = $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'monthly',
            'signatories' => ['treasurer' => 'T', 'president' => 'P', 'adviser' => 'A', 'sbo_adviser' => 'S'],
        ])->assertCreated()->json('report.id');
        $this->postJson("/api/financial-reports/{$id}/submit")->assertOk();
        $this->report = FinancialReport::findOrFail($id);
    }

    private function returnWithRemark(string $remark): void
    {
        $approval = ApprovalRequest::where('entity_type', 'financial_report')->where('entity_id', $this->report->id)->where('status', 'pending')->firstOrFail();
        Sanctum::actingAs($this->departmentHead);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'rejected', 'remarks' => $remark])->assertOk();
        Sanctum::actingAs($this->admin);
    }

    public function test_the_admin_reads_the_reviewers_remark_on_a_returned_report(): void
    {
        $this->returnWithRemark('Fix the totals');

        $listed = collect($this->getJson('/api/financial-reports')->assertOk()->json('data'))->firstWhere('id', $this->report->id);
        $this->assertSame('Fix the totals', $listed['approval_remarks']);

        $this->getJson("/api/financial-reports/{$this->report->id}")
            ->assertOk()
            ->assertJsonPath('report.approval_remarks', 'Fix the totals');
    }

    public function test_a_resubmitted_report_no_longer_carries_the_old_remark(): void
    {
        $this->returnWithRemark('Fix the totals');
        $this->postJson("/api/financial-reports/{$this->report->id}/submit")->assertOk();

        $this->getJson("/api/financial-reports/{$this->report->id}")
            ->assertOk()
            ->assertJsonPath('report.approval_remarks', null);
    }

    public function test_a_report_never_returned_has_no_remark(): void
    {
        $this->getJson("/api/financial-reports/{$this->report->id}")
            ->assertOk()
            ->assertJsonPath('report.approval_remarks', null);
    }
}
