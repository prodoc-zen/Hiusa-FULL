<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\FinancialReport;
use App\Models\FinancialReportDeadline;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FinancialReportSubmissionWorkflowTest extends TestCase
{
    use RefreshDatabase;

    public function test_sao_deadline_publishes_an_announcement_and_notifies_each_active_admin(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'acronym' => 'SAO']);
        $firstOrganization = Organization::factory()->create();
        $secondOrganization = Organization::factory()->create();
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $firstAdmin = User::factory()->admin()->create(['organization_id' => $firstOrganization->id]);
        $secondAdmin = User::factory()->admin()->create(['organization_id' => $secondOrganization->id]);
        User::factory()->admin()->create(['organization_id' => $secondOrganization->id, 'account_status' => 'disabled']);

        Sanctum::actingAs($superAdmin);
        $response = $this->postJson('/api/financial-reports/deadline', [
            'deadline_at' => now()->addWeek()->toISOString(),
            'instructions' => 'Attach receipts and signed supporting documents.',
        ]);

        $response->assertCreated()->assertJsonPath('instructions', 'Attach receipts and signed supporting documents.');
        $announcement = Announcement::where('announcement_source', 'SAO')->firstOrFail();
        $this->assertTrue($announcement->is_published);
        $this->assertSame(['ADMIN'], $announcement->target_roles);
        $this->assertDatabaseHas('announcement_recipients', ['announcement_id' => $announcement->id, 'user_id' => $firstAdmin->school_id]);
        $this->assertDatabaseHas('announcement_recipients', ['announcement_id' => $announcement->id, 'user_id' => $secondAdmin->school_id]);
        $this->assertSame(2, Notification::where('reference_type', 'financial_report_deadline')->count());
    }

    public function test_financial_report_moves_from_admin_to_department_head_then_sao(): void
    {
        Storage::fake('public');
        $organization = Organization::factory()->create();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'acronym' => 'SAO']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $deadline = FinancialReportDeadline::create(['deadline_at' => now()->addWeek(), 'set_by' => $superAdmin->school_id]);
        $report = FinancialReport::create([
            'organization_id' => $organization->id,
            'report_type' => 'monthly',
            'title' => 'Monthly Financial Report',
            'summary_text' => 'Calculated report summary.',
            'source_transaction_ids' => [],
            'signatories' => $this->signatories(),
            'submission_status' => 'draft',
            'generated_by' => $admin->school_id,
            'generated_at' => now(),
        ]);

        Sanctum::actingAs($admin);
        $this->post('/api/financial-reports/'.$report->id.'/submit', [
            'supporting_documents' => [UploadedFile::fake()->create('receipts.pdf', 100, 'application/pdf')],
        ])->assertOk()->assertJsonPath('submission_status', 'pending_department_head');

        $departmentApproval = ApprovalRequest::where('entity_type', 'financial_report')
            ->where('required_role', 'DEPARTMENT_HEAD')->firstOrFail();
        $this->assertSame($deadline->id, $report->fresh()->deadline_id);
        $this->assertCount(1, $report->fresh()->supporting_documents);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $departmentHead->school_id,
            'reference_type' => 'approval_request',
            'reference_id' => $departmentApproval->id,
        ]);
        $this->assertSame(1, Notification::where('reference_type', 'approval_request')->where('reference_id', $departmentApproval->id)->count());

        Sanctum::actingAs($departmentHead);
        $this->patchJson('/api/approval-requests/'.$departmentApproval->id, ['status' => 'approved'])
            ->assertOk();
        $this->assertSame('pending_sao', $report->fresh()->submission_status);
        $this->assertSame($departmentHead->school_id, $report->fresh()->department_head_approved_by);

        $saoApproval = ApprovalRequest::where('entity_type', 'financial_report')
            ->where('required_role', 'SUPER_ADMIN')->where('status', 'pending')->firstOrFail();
        $this->assertDatabaseHas('notifications', [
            'user_id' => $superAdmin->school_id,
            'reference_type' => 'approval_request',
            'reference_id' => $saoApproval->id,
        ]);
        $this->assertSame(1, Notification::where('reference_type', 'approval_request')->where('reference_id', $saoApproval->id)->count());
        Sanctum::actingAs($superAdmin);
        $this->patchJson('/api/approval-requests/'.$saoApproval->id, ['status' => 'approved'])
            ->assertOk();

        $this->assertSame('approved', $report->fresh()->submission_status);
        $this->assertSame($superAdmin->school_id, $report->fresh()->sao_approved_by);
        $this->assertDatabaseHas('audit_logs', ['module' => 'approvals', 'action' => 'reviewed_approved', 'record_id' => $saoApproval->id]);
    }

    public function test_generation_is_admin_only_and_requires_all_signatories(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($officer);
        $this->postJson('/api/financial-reports/generate', ['report_type' => 'monthly', 'signatories' => $this->signatories()])
            ->assertForbidden();

        Sanctum::actingAs($admin);
        $this->postJson('/api/financial-reports/generate', ['report_type' => 'monthly', 'signatories' => ['treasurer' => 'T']])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['signatories.president', 'signatories.adviser', 'signatories.sbo_adviser']);
    }

    public function test_sao_can_filter_cross_organization_transactions_and_reports(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'acronym' => 'SAO']);
        $firstOrganization = Organization::factory()->create();
        $secondOrganization = Organization::factory()->create();
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $firstAdmin = User::factory()->admin()->create(['organization_id' => $firstOrganization->id]);
        $secondAdmin = User::factory()->admin()->create(['organization_id' => $secondOrganization->id]);
        $this->createTransaction($firstOrganization, $firstAdmin, 'First organization income');
        $this->createTransaction($secondOrganization, $secondAdmin, 'Second organization income');
        FinancialReport::create(['organization_id' => $firstOrganization->id, 'report_type' => 'monthly', 'title' => 'First report', 'source_transaction_ids' => [], 'signatories' => $this->signatories(), 'generated_by' => $firstAdmin->school_id, 'generated_at' => now()]);

        Sanctum::actingAs($superAdmin);
        $this->getJson('/api/transactions?organization_id='.$firstOrganization->id)
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.organization_id', $firstOrganization->id);
        $this->getJson('/api/financial-reports?organization_id='.$firstOrganization->id)
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.organization.id', $firstOrganization->id);
    }

    private function signatories(): array
    {
        return ['treasurer' => 'Taylor Treasurer', 'president' => 'Pat President', 'adviser' => 'Alex Adviser', 'sbo_adviser' => 'Sam SBO Adviser'];
    }

    private function createTransaction(Organization $organization, User $recorder, string $description): Transaction
    {
        return Transaction::create([
            'organization_id' => $organization->id,
            'recorded_by' => $recorder->school_id,
            'type' => 'income',
            'category' => 'membership',
            'amount' => 1000,
            'description' => $description,
            'transaction_date' => now(),
        ]);
    }
}
