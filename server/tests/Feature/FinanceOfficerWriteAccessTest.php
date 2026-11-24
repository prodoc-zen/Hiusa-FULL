<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\CashAdvance;
use App\Models\Collection;
use App\Models\FinancialForecast;
use App\Models\FinancialReport;
use App\Models\Invoice;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\AskAiActions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The Treasurer is no longer view only in Finance: an officer whose position has "Can handle finance" records the
 * ledger, collections, remittances, student charges and payments, drafts budgets and generates reports and forecasts.
 * The Admin still verifies, approves, releases, closes, deletes budgets and submits.
 */
class FinanceOfficerWriteAccessTest extends TestCase
{
    use RefreshDatabase;

    private const SWITCH_MESSAGE = 'Your position cannot handle finance. Ask your Admin.';

    private Organization $organization;

    private Organization $other;

    private User $admin;

    private User $treasurer;

    private User $publicInfo;

    private User $student;

    private User $otherTreasurer;

    private Transaction $transaction;

    private Collection $verifiedCollection;

    private Invoice $invoice;

    private Budget $draftBudget;

    private Budget $approvedBudget;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->other = Organization::factory()->create();
        foreach ([$this->organization, $this->other] as $organization) {
            foreach (['Treasurer', 'Public Information Officer'] as $title) {
                SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => $title, 'is_active' => true]);
            }
        }

        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->treasurer = User::factory()->officer()->create(['organization_id' => $this->organization->id, 'position_title' => 'Treasurer']);
        $this->publicInfo = User::factory()->officer()->create(['organization_id' => $this->organization->id, 'position_title' => 'Public Information Officer']);
        $this->student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->otherTreasurer = User::factory()->officer()->create(['organization_id' => $this->other->id, 'position_title' => 'Treasurer']);

        $this->transaction = Transaction::create([
            'organization_id' => $this->organization->id, 'recorded_by' => $this->treasurer->id, 'type' => 'income', 'category' => 'Dues',
            'description' => 'Seed entry', 'amount' => 100, 'transaction_date' => now(),
        ]);
        $this->approvedBudget = Budget::create([
            'organization_id' => $this->organization->id, 'title' => 'Approved budget', 'allocated_amount' => 1000, 'remaining_amount' => 1000,
            'warning_threshold' => 100, 'submission_status' => 'approved',
        ]);

        Sanctum::actingAs($this->admin);
        $collectionId = $this->postJson('/api/collections', ['amount_collected' => '200.00', 'source' => 'Seed collection'])->assertCreated()->json('id');
        Collection::whereKey($collectionId)->update(['status' => 'verified']);
        $this->verifiedCollection = Collection::findOrFail($collectionId);
        Sanctum::actingAs($this->treasurer);
        $this->draftBudget = Budget::findOrFail($this->postJson('/api/budgets', ['title' => 'Draft budget', 'allocated_amount' => '1000.00', 'warning_threshold' => '100.00'])->assertCreated()->json('id'));
        Sanctum::actingAs($this->admin);
        $this->invoice = Invoice::findOrFail($this->postJson('/api/invoices', ['student_id' => $this->student->school_id, 'description' => 'Seed charge', 'amount_due' => '300.00'])->assertCreated()->json('id'));
    }

    /** @return array{0: string, 1: string, 2: array, 3: int} method, uri, body, status for an allowed writer */
    private function spec(string $key): array
    {
        $signatories = ['treasurer' => 'T', 'president' => 'P', 'adviser' => 'A', 'sbo_adviser' => 'S'];

        return match ($key) {
            'transaction.store' => ['POST', '/api/transactions', ['type' => 'income', 'amount' => '50.00', 'category' => 'Dues', 'description' => 'Booth sales', 'transaction_date' => now()->toDateString()], 201],
            'transaction.update' => ['PUT', "/api/transactions/{$this->transaction->id}", ['description' => 'Corrected entry'], 200],
            'transaction.destroy' => ['DELETE', "/api/transactions/{$this->transaction->id}", [], 200],
            'collection.store' => ['POST', '/api/collections', ['amount_collected' => '75.00', 'source' => 'Membership'], 201],
            'remittance.store' => ['POST', "/api/collections/{$this->verifiedCollection->id}/remittances", ['amount' => '50.00'], 201],
            'invoice.store' => ['POST', '/api/invoices', ['student_id' => $this->student->school_id, 'description' => 'Shirt', 'amount_due' => '150.00'], 201],
            'invoice.payment' => ['POST', "/api/invoices/{$this->invoice->id}/payments", ['amount' => '100.00'], 200],
            'budget.store' => ['POST', '/api/budgets', ['title' => 'Intramurals', 'allocated_amount' => '500.00', 'warning_threshold' => '50.00'], 201],
            'budget.update' => ['PUT', "/api/budgets/{$this->draftBudget->id}", ['title' => 'Draft budget, revised'], 200],
            'budget.advice' => ['POST', "/api/budgets/{$this->approvedBudget->id}/advice", [], 200],
            'report.generate' => ['POST', '/api/financial-reports/generate', ['report_type' => 'custom', 'period_start' => now()->startOfMonth()->toDateString(), 'period_end' => now()->endOfMonth()->toDateString(), 'signatories' => $signatories], 201],
            'forecast.generate' => ['POST', '/api/forecasts/generate', ['months' => 3], 201],
        };
    }

    public static function openedRoutes(): array
    {
        return array_map(fn (string $key) => [$key], [
            'transaction.store', 'transaction.update', 'transaction.destroy', 'collection.store', 'remittance.store', 'invoice.store',
            'invoice.payment', 'budget.store', 'budget.update', 'budget.advice', 'report.generate', 'forecast.generate',
        ]);
    }

    /** @dataProvider openedRoutes */
    public function test_a_treasurer_with_the_switch_can_use_the_route_and_the_work_is_theirs_in_their_organization(string $key): void
    {
        [$method, $uri, $body, $status] = $this->spec($key);
        Sanctum::actingAs($this->treasurer);

        $response = $this->json($method, $uri, $body);

        $response->assertStatus($status);
    }

    /** @dataProvider openedRoutes */
    public function test_an_officer_without_the_switch_is_refused_with_a_clear_message(string $key): void
    {
        [$method, $uri, $body] = $this->spec($key);
        Sanctum::actingAs($this->publicInfo);

        $this->json($method, $uri, $body)->assertForbidden()->assertJsonPath('message', self::SWITCH_MESSAGE);
    }

    /** @dataProvider openedRoutes */
    public function test_turning_the_switch_off_for_a_treasurer_closes_the_route(string $key): void
    {
        [$method, $uri, $body] = $this->spec($key);
        SboPosition::where(['organization_id' => $this->organization->id, 'title' => 'Treasurer'])->update(['can_handle_finance' => false]);
        Sanctum::actingAs($this->treasurer->fresh());

        $this->json($method, $uri, $body)->assertForbidden();
    }

    /** @dataProvider openedRoutes */
    public function test_a_student_is_refused(string $key): void
    {
        [$method, $uri, $body] = $this->spec($key);
        Sanctum::actingAs($this->student);

        $this->json($method, $uri, $body)->assertForbidden();
    }

    /** @dataProvider openedRoutes */
    public function test_an_officer_of_another_organization_cannot_write_into_this_one(string $key): void
    {
        [$method, $uri, $body] = $this->spec($key);
        $before = $this->snapshot($this->organization->id);
        Sanctum::actingAs($this->otherTreasurer);

        $this->json($method, $uri, $body);

        $this->assertSame($before, $this->snapshot($this->organization->id), "{$key} changed this organization's records");
    }

    public function test_what_an_officer_records_is_attributed_to_them_and_lands_in_their_own_organization(): void
    {
        Sanctum::actingAs($this->otherTreasurer);

        $this->postJson('/api/transactions', ['type' => 'expense', 'amount' => '20.00', 'category' => 'Supplies', 'description' => 'Paper', 'transaction_date' => now()->toDateString()])->assertCreated()
            ->assertJsonPath('organization_id', $this->other->id)->assertJsonPath('recorded_by', $this->otherTreasurer->id);
        $collectionId = $this->postJson('/api/collections', ['amount_collected' => '10.00', 'source' => 'Dues'])->assertCreated()->assertJsonPath('organization_id', $this->other->id)->json('id');
        $budgetId = $this->postJson('/api/budgets', ['title' => 'Other budget', 'allocated_amount' => '100.00', 'warning_threshold' => '10.00'])->assertCreated()
            ->assertJsonPath('organization_id', $this->other->id)->json('id');

        $this->assertSame($this->otherTreasurer->school_id, Collection::findOrFail($collectionId)->collected_by);
        $this->assertDatabaseHas('audit_logs', ['organization_id' => $this->other->id, 'module' => 'collections', 'action' => 'recorded', 'user_id' => $this->otherTreasurer->school_id, 'actor_role' => 'SBO_OFFICER']);
        $this->assertSame('draft', Budget::findOrFail($budgetId)->submission_status);
        $this->assertDatabaseMissing('approval_requests', ['entity_type' => 'budget', 'entity_id' => $budgetId]);
        $this->assertDatabaseMissing('transactions', ['organization_id' => $this->organization->id, 'description' => 'Paper']);
    }

    public function test_a_treasurer_cannot_write_into_another_organizations_records_by_id(): void
    {
        Sanctum::actingAs($this->otherTreasurer);
        $foreign = Budget::findOrFail($this->postJson('/api/budgets', ['title' => 'Foreign', 'allocated_amount' => '100.00', 'warning_threshold' => '10.00'])->assertCreated()->json('id'));
        Sanctum::actingAs($this->treasurer);

        $this->putJson("/api/budgets/{$foreign->id}", ['title' => 'Hijacked'])->assertNotFound();
        $this->assertSame('Foreign', $foreign->fresh()->title);
    }

    public function test_an_officer_may_not_edit_a_submitted_or_approved_budget(): void
    {
        Sanctum::actingAs($this->treasurer);

        $this->putJson("/api/budgets/{$this->approvedBudget->id}", ['title' => 'Changed'])->assertForbidden();
        $this->draftBudget->update(['submission_status' => 'pending_department_head']);
        $this->putJson("/api/budgets/{$this->draftBudget->id}", ['title' => 'Changed'])->assertForbidden();
        $this->draftBudget->update(['submission_status' => 'pending_sao']);
        $this->putJson("/api/budgets/{$this->draftBudget->id}", ['title' => 'Changed'])->assertForbidden();
        $this->assertSame('Approved budget', $this->approvedBudget->fresh()->title);

        Sanctum::actingAs($this->admin);
        $this->putJson("/api/budgets/{$this->approvedBudget->id}", ['title' => 'Admin change'])->assertOk();
    }

    public function test_an_officers_new_budget_is_a_draft_that_reaches_nobody_until_the_admin_submits_it(): void
    {
        Sanctum::actingAs($this->treasurer);

        $id = $this->postJson('/api/budgets', ['title' => 'Foundation week', 'allocated_amount' => '800.00', 'warning_threshold' => '80.00'])
            ->assertCreated()->assertJsonPath('submission_status', 'draft')->json('id');

        $this->assertDatabaseMissing('approval_requests', ['entity_type' => 'budget', 'entity_id' => $id]);
        $this->patchJson("/api/budgets/{$id}/submit")->assertForbidden();
        $this->assertSame('draft', Budget::findOrFail($id)->submission_status);

        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/budgets/{$id}/submit")->assertOk()->assertJsonPath('submission_status', 'pending_department_head');
        $this->assertDatabaseHas('approval_requests', ['organization_id' => $this->organization->id, 'entity_type' => 'budget', 'entity_id' => $id, 'requested_by' => $this->admin->id, 'status' => 'pending']);
    }

    public function test_the_admins_own_budget_is_still_submitted_at_once(): void
    {
        Sanctum::actingAs($this->admin);

        $id = $this->postJson('/api/budgets', ['title' => 'Admin budget', 'allocated_amount' => '800.00', 'warning_threshold' => '80.00'])
            ->assertCreated()->assertJsonPath('submission_status', 'pending_department_head')->json('id');

        $this->assertDatabaseHas('approval_requests', ['entity_type' => 'budget', 'entity_id' => $id]);
    }

    public function test_an_officer_editing_a_draft_keeps_it_a_draft(): void
    {
        Sanctum::actingAs($this->treasurer);

        $this->putJson("/api/budgets/{$this->draftBudget->id}", ['title' => 'Draft, revised'])->assertOk()->assertJsonPath('submission_status', 'draft');
        $this->assertDatabaseMissing('approval_requests', ['entity_type' => 'budget', 'entity_id' => $this->draftBudget->id]);
    }

    public function test_an_officer_fixing_a_returned_budget_saves_a_draft_and_the_admin_resubmits_it(): void
    {
        $this->draftBudget->update(['submission_status' => 'rejected']);
        $approval = ApprovalRequest::create([
            'organization_id' => $this->organization->id, 'entity_type' => 'budget', 'entity_id' => $this->draftBudget->id,
            'requested_by' => $this->admin->id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'rejected', 'decision' => 'rejected',
        ]);
        Sanctum::actingAs($this->treasurer);

        $this->putJson("/api/budgets/{$this->draftBudget->id}", ['title' => 'Fixed after return'])
            ->assertOk()->assertJsonPath('title', 'Fixed after return')->assertJsonPath('submission_status', 'draft');
        $this->assertSame('rejected', $approval->fresh()->status);
        $this->patchJson("/api/budgets/{$this->draftBudget->id}/submit")->assertForbidden();

        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/budgets/{$this->draftBudget->id}/submit")->assertOk()->assertJsonPath('submission_status', 'pending_department_head');
        $this->assertSame('pending', $approval->fresh()->status);
    }

    public function test_only_a_draft_or_returned_budget_can_be_submitted_and_only_inside_the_admins_organization(): void
    {
        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/budgets/{$this->approvedBudget->id}/submit")->assertStatus(409);
        Sanctum::actingAs($this->otherTreasurer);
        $foreign = Budget::findOrFail($this->postJson('/api/budgets', ['title' => 'Foreign', 'allocated_amount' => '100.00', 'warning_threshold' => '10.00'])->assertCreated()->json('id'));
        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/budgets/{$foreign->id}/submit")->assertNotFound();
        $this->assertSame('draft', $foreign->fresh()->submission_status);
    }

    public function test_an_officer_cannot_change_a_transaction_someone_else_recorded(): void
    {
        $entry = Transaction::create([
            'organization_id' => $this->organization->id, 'recorded_by' => $this->admin->id, 'type' => 'income', 'category' => 'Dues',
            'description' => 'Admin entry', 'amount' => 500, 'transaction_date' => now(),
        ]);
        Sanctum::actingAs($this->treasurer);

        $this->putJson("/api/transactions/{$entry->id}", ['amount' => '0.01'])
            ->assertForbidden()->assertJsonPath('message', 'You can only change transactions you recorded.');
        $this->assertSame('500.00', number_format((float) $entry->fresh()->amount, 2, '.', ''));

        Sanctum::actingAs($this->admin);
        $this->putJson("/api/transactions/{$entry->id}", ['description' => 'Admin corrected'])->assertOk();
    }

    public function test_ask_ai_offers_the_budget_action_and_the_finance_tools_only_to_an_officer_with_the_switch(): void
    {
        $actions = app(AskAiActions::class);

        $this->assertContains('Propose a budget', $actions->titlesFor($this->treasurer));
        $this->assertContains('Propose a budget', $actions->titlesFor($this->admin));
        $this->assertNotContains('Propose a budget', $actions->titlesFor($this->publicInfo));
        $this->assertNull($actions->definitionFor($this->publicInfo, 'propose_budget'));
        $this->assertNull($actions->definitionFor($this->student, 'propose_budget'));
    }

    public function test_a_treasurer_sees_every_invoice_of_the_organization_and_the_student_accounts(): void
    {
        Sanctum::actingAs($this->treasurer);

        $this->getJson('/api/invoices')->assertOk()->assertJsonCount(1)->assertJsonPath('0.id', $this->invoice->id);
        $this->getJson('/api/student-debts')->assertOk()->assertJsonPath('summary.total_students', 1);

        Sanctum::actingAs($this->publicInfo);
        $this->getJson('/api/invoices')->assertOk()->assertJsonCount(0);
        $this->getJson('/api/student-debts')->assertForbidden();
    }

    public function test_the_admin_and_the_student_keep_their_access_to_student_accounts(): void
    {
        Sanctum::actingAs($this->admin);
        $this->getJson('/api/student-debts')->assertOk();
        Sanctum::actingAs($this->student);
        $this->getJson('/api/student-debts')->assertOk();
        $this->getJson('/api/invoices')->assertOk()->assertJsonCount(1);
    }

    public static function adminOnlyRoutes(): array
    {
        return array_map(fn (string $key) => [$key], [
            'collection.verify', 'advance.store', 'advance.approve', 'advance.release', 'advance.repay', 'invoice.close', 'budget.destroy', 'budget.submit',
            'report.submit', 'report.ignore', 'forecast.store', 'forecast.update', 'forecast.destroy',
        ]);
    }

    /** @dataProvider adminOnlyRoutes */
    public function test_the_admin_only_routes_stay_closed_to_a_treasurer_with_the_switch(string $key): void
    {
        $advance = CashAdvance::create(['organization_id' => $this->organization->id, 'reference' => 'ADV-TEST', 'borrower_id' => $this->treasurer->school_id, 'amount' => 100, 'purpose' => 'Supplies', 'status' => 'approved']);
        $forecast = FinancialForecast::create(['organization_id' => $this->organization->id, 'forecast_period' => now()->format('Y-m'), 'predicted_income' => 1, 'predicted_expense' => 1]);
        $report = FinancialReport::create(['organization_id' => $this->organization->id, 'report_type' => 'monthly', 'title' => 'Report', 'submission_status' => 'draft']);
        $pending = Collection::create(['organization_id' => $this->organization->id, 'reference' => 'COL-TEST', 'amount_collected' => 10, 'expected_amount' => 0, 'source' => 'x', 'collected_by' => $this->admin->school_id, 'collected_at' => now(), 'status' => 'pending']);

        [$method, $uri, $body] = match ($key) {
            'collection.verify' => ['PATCH', "/api/collections/{$pending->id}/verify", []],
            'advance.store' => ['POST', '/api/cash-advances', ['amount' => '10.00', 'purpose' => 'Supplies']],
            'advance.approve' => ['PATCH', "/api/cash-advances/{$advance->id}/approve", []],
            'advance.release' => ['PATCH', "/api/cash-advances/{$advance->id}/release", []],
            'advance.repay' => ['POST', "/api/cash-advances/{$advance->id}/repayments", ['amount' => '10.00']],
            'invoice.close' => ['PATCH', "/api/invoices/{$this->invoice->id}/status", ['status' => 'cancelled', 'reason' => 'Wrong student']],
            'budget.destroy' => ['DELETE', "/api/budgets/{$this->draftBudget->id}", []],
            'budget.submit' => ['PATCH', "/api/budgets/{$this->draftBudget->id}/submit", []],
            'report.submit' => ['POST', "/api/financial-reports/{$report->id}/submit", []],
            'report.ignore' => ['POST', "/api/financial-reports/{$report->id}/checks/ignore", ['key' => 'k', 'reason' => 'r']],
            'forecast.store' => ['POST', '/api/forecasts', ['forecast_period' => '2030-01', 'predicted_income' => 1, 'predicted_expense' => 1]],
            'forecast.update' => ['PUT', "/api/forecasts/{$forecast->id}", ['predicted_income' => 2]],
            'forecast.destroy' => ['DELETE', "/api/forecasts/{$forecast->id}", []],
        };
        Sanctum::actingAs($this->treasurer);

        $this->json($method, $uri, $body)->assertForbidden()->assertJsonPath('message', 'Forbidden.');
    }

    public function test_the_admin_can_still_do_everything_the_officer_can(): void
    {
        Sanctum::actingAs($this->admin);

        foreach (['transaction.store', 'collection.store', 'invoice.store', 'budget.store', 'forecast.generate'] as $key) {
            [$method, $uri, $body, $status] = $this->spec($key);
            $this->json($method, $uri, $body)->assertStatus($status);
        }
    }

    private function snapshot(int $organizationId): string
    {
        $rows = [];
        foreach (['transactions', 'collections', 'invoices', 'budgets', 'financial_forecasts', 'financial_reports', 'cash_advances'] as $table) {
            $rows[$table] = DB::table($table)->where('organization_id', $organizationId)->orderBy('id')->get()->map(fn ($row) => (array) $row)->all();
        }
        $rows['remittances'] = DB::table('remittances')->whereIn('collection_id', DB::table('collections')->where('organization_id', $organizationId)->select('id'))->orderBy('id')->get()->map(fn ($row) => (array) $row)->all();
        $rows['invoice_payments'] = DB::table('invoice_payments')->whereIn('invoice_id', DB::table('invoices')->where('organization_id', $organizationId)->select('id'))->orderBy('id')->get()->map(fn ($row) => (array) $row)->all();

        return json_encode($rows, JSON_THROW_ON_ERROR);
    }
}
