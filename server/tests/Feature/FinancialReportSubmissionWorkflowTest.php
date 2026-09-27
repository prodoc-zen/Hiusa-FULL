<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\FinancialReport;
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

    public function test_financial_report_moves_from_admin_to_department_head_then_sao(): void
    {
        Storage::fake('public');
        $organization = Organization::factory()->create();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'acronym' => 'SAO']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
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
        $this->assertNull($report->fresh()->deadline_id);
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

    public function test_admin_can_generate_and_submit_a_custom_date_range_report(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        $included = $this->createTransaction($organization, $admin, 'Inside custom period');
        $included->update(['transaction_date' => '2026-08-15']);
        $excluded = $this->createTransaction($organization, $admin, 'Outside custom period');
        $excluded->update(['transaction_date' => '2026-09-01']);

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'custom',
            'period_start' => '2026-08-01',
            'period_end' => '2026-08-31',
            'signatories' => $this->signatories(),
        ])->assertCreated()
            ->assertJsonCount(1, 'transactions')
            ->assertJsonPath('transactions.0.id', $included->id);

        $report = FinancialReport::findOrFail($response->json('report.id'));
        $this->assertSame([$included->id], $report->source_transaction_ids);
        $this->assertSame('2026-08-01', $report->period_start->toDateString());
        $this->assertSame('2026-08-31', $report->period_end->toDateString());

        $this->postJson('/api/financial-reports/'.$report->id.'/submit')
            ->assertOk()
            ->assertJsonPath('submission_status', 'pending_department_head');
        $this->assertDatabaseHas('approval_requests', [
            'entity_type' => 'financial_report',
            'entity_id' => $report->id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'pending',
        ]);
    }

    public function test_income_statement_and_financial_report_are_saved_as_separate_documents(): void
    {
        Storage::fake('local');
        $organization = Organization::factory()->create(['name' => 'Computing Students Society', 'acronym' => 'CSS']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $income = $this->createTransaction($organization, $admin, 'Membership collection');
        $income->update(['transaction_date' => '2026-09-05']);
        Transaction::create([
            'organization_id' => $organization->id,
            'recorded_by' => $admin->school_id,
            'type' => 'expense',
            'category' => 'Office Supplies',
            'amount' => 250,
            'description' => 'Printer paper',
            'transaction_date' => '2026-09-06',
        ]);

        Sanctum::actingAs($admin);
        $incomeStatement = $this->post('/api/financial-reports/generate', [
            'document_type' => 'income_statement',
            'report_type' => 'custom',
            'period_start' => '2026-09-01',
            'period_end' => '2026-09-30',
            'letter_subject' => 'Submission of September Income Statement',
            'letter_body' => 'Please review the attached September income statement.',
            'letterhead' => UploadedFile::fake()->image('official-letterhead.png', 1200, 180),
            'signatories' => $this->signatories(),
        ])->assertCreated()
            ->assertJsonPath('report.document_type', 'income_statement')
            ->assertJsonPath('report.has_letterhead', true)
            ->assertJsonMissingPath('report.letterhead_path')
            ->assertJsonPath('totals.balance', 750);

        $financialReport = $this->postJson('/api/financial-reports/generate', [
            'document_type' => 'financial_report',
            'report_type' => 'custom',
            'period_start' => '2026-09-01',
            'period_end' => '2026-09-30',
            'signatories' => $this->signatories(),
        ])->assertCreated()
            ->assertJsonPath('report.document_type', 'financial_report');

        $incomeModel = FinancialReport::findOrFail($incomeStatement->json('report.id'));
        $financialModel = FinancialReport::findOrFail($financialReport->json('report.id'));
        Storage::disk('local')->assertExists($incomeModel->letterhead_path);
        $this->assertStringContainsString('Income Statement', $incomeModel->title);
        $this->assertStringContainsString('Financial Report', $financialModel->title);
        $this->assertNotSame($incomeModel->id, $financialModel->id);

        $incomePdf = $this->get('/api/financial-reports/'.$incomeModel->id.'/pdf')->assertOk();
        $financialPdf = $this->get('/api/financial-reports/'.$financialModel->id.'/pdf')->assertOk();
        $incomePdf->assertHeader('content-type', 'application/pdf');
        $financialPdf->assertHeader('content-type', 'application/pdf');
        $this->assertStringStartsWith('%PDF-', $incomePdf->getContent());
        $this->assertStringStartsWith('%PDF-', $financialPdf->getContent());
        $this->assertNotSame($incomePdf->getContent(), $financialPdf->getContent());
    }

    public function test_pdf_download_is_organization_scoped_and_letterhead_rejects_non_images(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $otherAdmin = User::factory()->admin()->create(['organization_id' => $otherOrganization->id]);
        $report = FinancialReport::create([
            'organization_id' => $organization->id,
            'document_type' => 'financial_report',
            'report_type' => 'monthly',
            'title' => 'Monthly Financial Report',
            'source_transaction_ids' => [],
            'signatories' => $this->signatories(),
            'generated_by' => $admin->school_id,
            'generated_at' => now(),
        ]);

        Sanctum::actingAs($otherAdmin);
        $this->get('/api/financial-reports/'.$report->id.'/pdf')->assertNotFound();

        Sanctum::actingAs($admin);
        $this->withHeader('Accept', 'application/json')->post('/api/financial-reports/generate', [
            'document_type' => 'income_statement',
            'report_type' => 'monthly',
            'letterhead' => UploadedFile::fake()->create('letterhead.pdf', 20, 'application/pdf'),
            'signatories' => $this->signatories(),
        ])->assertUnprocessable()->assertJsonValidationErrors('letterhead');
    }

    public function test_sao_receives_reviewed_reports_without_ledger_access(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'acronym' => 'SAO']);
        $firstOrganization = Organization::factory()->create();
        $secondOrganization = Organization::factory()->create();
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $firstAdmin = User::factory()->admin()->create(['organization_id' => $firstOrganization->id]);
        $secondAdmin = User::factory()->admin()->create(['organization_id' => $secondOrganization->id]);
        $this->createTransaction($firstOrganization, $firstAdmin, 'First organization income');
        $this->createTransaction($secondOrganization, $secondAdmin, 'Second organization income');
        FinancialReport::create([
            'organization_id' => $firstOrganization->id,
            'report_type' => 'monthly',
            'title' => 'First report',
            'source_transaction_ids' => [],
            'signatories' => $this->signatories(),
            'submission_status' => 'pending_sao',
            'generated_by' => $firstAdmin->school_id,
            'generated_at' => now(),
            'submitted_at' => now()->subHour(),
            'department_head_approved_by' => User::factory()->departmentHead()->create(['organization_id' => $firstOrganization->id])->school_id,
            'department_head_approved_at' => now(),
        ]);

        Sanctum::actingAs($superAdmin);
        $this->getJson('/api/transactions?organization_id='.$firstOrganization->id)
            ->assertForbidden();
        $this->getJson('/api/financial-reports?organization_id='.$firstOrganization->id)
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.organization.id', $firstOrganization->id);
    }

    public function test_department_head_receives_only_submitted_reports_from_their_organization(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $otherAdmin = User::factory()->admin()->create(['organization_id' => $otherOrganization->id]);
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        $draft = FinancialReport::create(['organization_id' => $organization->id, 'report_type' => 'monthly', 'title' => 'Draft report', 'source_transaction_ids' => [], 'signatories' => $this->signatories(), 'generated_by' => $admin->school_id, 'generated_at' => now()]);
        $submitted = FinancialReport::create(['organization_id' => $organization->id, 'report_type' => 'monthly', 'title' => 'Submitted report', 'source_transaction_ids' => [], 'signatories' => $this->signatories(), 'submission_status' => 'pending_department_head', 'generated_by' => $admin->school_id, 'generated_at' => now(), 'submitted_at' => now()]);
        $otherReport = FinancialReport::create(['organization_id' => $otherOrganization->id, 'report_type' => 'monthly', 'title' => 'Other report', 'source_transaction_ids' => [], 'signatories' => $this->signatories(), 'submission_status' => 'pending_department_head', 'generated_by' => $otherAdmin->school_id, 'generated_at' => now(), 'submitted_at' => now()]);

        Sanctum::actingAs($departmentHead);
        $this->getJson('/api/financial-reports')->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $submitted->id);
        $this->getJson('/api/financial-reports/'.$draft->id)->assertNotFound();
        $this->getJson('/api/financial-reports/'.$otherReport->id)->assertNotFound();
        $this->get('/api/financial-reports/'.$submitted->id.'/pdf')->assertOk()->assertHeader('content-type', 'application/pdf');
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
