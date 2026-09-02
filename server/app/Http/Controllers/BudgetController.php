<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Services\GroqResponsesService;
use App\Services\HiusaAiService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BudgetController extends Controller
{
    public function __construct(
        private readonly HiusaAiService $aiService,
        private readonly GroqResponsesService $groq,
    ) {}

    public function index(Request $request)
    {
        $paging = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $budgets = Budget::with('event:id,title')
            ->where('organization_id', $request->user()->organization_id)
            ->withCount('transactions')
            ->withSum('transactions', 'amount')
            ->orderBy('created_at', 'desc')
            ->paginate($paging['per_page'] ?? 20);

        $this->attachApprovalInfo($budgets);

        return response()->json($budgets);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'allocated_amount' => ['required', 'numeric', 'min:0.01'],
            'warning_threshold' => ['required', 'numeric', 'min:0', 'lte:allocated_amount'],
            'event_id' => ['nullable', 'exists:events,id'],
            'advisory_note' => ['nullable', 'string'],
            'overspending_risk' => ['nullable', 'in:low,medium,high'],
        ]);

        if (! $this->eventBelongsToOrganization($request, $data['event_id'] ?? null)) {
            return response()->json(['message' => 'Selected event does not belong to this organization.'], 422);
        }

        $budget = DB::transaction(function () use ($data, $request) {
            $budget = Budget::create([
                ...$data,
                'remaining_amount' => $data['allocated_amount'],
                'organization_id' => $request->user()->organization_id,
            ]);

            ApprovalRequest::create([
                'organization_id' => $request->user()->organization_id,
                'entity_type' => 'budget',
                'entity_id' => $budget->id,
                'requested_by' => $request->user()->id,
                'required_role' => $request->user()->role === 'DEPARTMENT_HEAD' ? 'ADMIN' : 'DEPARTMENT_HEAD',
            ]);

            $this->recordBudgetAudit($request, 'created', $budget, null, $this->auditableValues($budget));

            return $budget;
        });

        return response()->json($budget->load('event:id,title'), 201);
    }

    public function update(Request $request, $id)
    {
        $budget = Budget::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $budget) {
            return response()->json(['message' => 'Budget not found.'], 404);
        }

        $oldValues = $this->auditableValues($budget);
        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'allocated_amount' => ['sometimes', 'required', 'numeric', 'min:0.01'],
            'warning_threshold' => ['sometimes', 'required', 'numeric', 'min:0'],
            'event_id' => ['nullable', 'exists:events,id'],
            'advisory_note' => ['nullable', 'string'],
            'overspending_risk' => ['nullable', 'in:low,medium,high'],
        ]);

        if (! $this->eventBelongsToOrganization($request, $data['event_id'] ?? null)) {
            return response()->json(['message' => 'Selected event does not belong to this organization.'], 422);
        }

        $allocatedAmount = (float) ($data['allocated_amount'] ?? $budget->allocated_amount);
        $warningThreshold = (float) ($data['warning_threshold'] ?? $budget->warning_threshold);

        if ($warningThreshold > $allocatedAmount) {
            return response()->json([
                'message' => 'The warning threshold cannot exceed the allocated amount.',
            ], 422);
        }

        if (array_key_exists('allocated_amount', $data)) {
            $spent = $budget->transactions()->where('type', 'expense')->sum('amount');
            $income = $budget->transactions()->where('type', 'income')->sum('amount');
            $data['remaining_amount'] = (float) $data['allocated_amount'] + (float) $income - (float) $spent;
        }

        if ($this->hasApprovedApproval($budget) && $this->hasMaterialBudgetChange($data)) {
            $this->reopenApproval($budget, $request);
        }

        $budget->update($data);
        $this->recordBudgetAudit($request, 'updated', $budget, $oldValues, $this->auditableValues($budget->fresh()));

        ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budget->id)
            ->where('status', 'rejected')
            ->where('organization_id', $budget->organization_id)
            ->get()
            ->each(fn (ApprovalRequest $approval) => $approval->resubmit());

        return response()->json($budget->fresh()->load('event:id,title'));
    }

    public function destroy(Request $request, $id)
    {
        $budget = Budget::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $budget) {
            return response()->json(['message' => 'Budget not found.'], 404);
        }

        if ($budget->transactions()->exists()) {
            return response()->json([
                'message' => 'Cannot delete a budget that has existing transactions. Remove all transactions first.',
            ], 409);
        }

        DB::transaction(function () use ($budget, $request) {
            $oldValues = $this->auditableValues($budget);
            ApprovalRequest::where('organization_id', $budget->organization_id)
                ->where('entity_type', 'budget')
                ->where('entity_id', $budget->id)
                ->delete();
            $budget->delete();
            $this->recordBudgetAudit($request, 'deleted', $budget, $oldValues, null);
        });

        return response()->json(['message' => 'Budget deleted successfully.']);
    }

    public function advice(Request $request, $id)
    {
        $budget = Budget::with('event:id,title')
            ->where('organization_id', $request->user()->organization_id)
            ->find($id);

        if (! $budget) {
            return response()->json(['message' => 'Budget not found.'], 404);
        }

        $forecast = FinancialForecast::where('organization_id', $request->user()->organization_id)
            ->orderByDesc('forecast_period')
            ->first();
        $payload = [
            'predicted_income' => (float) ($forecast?->predicted_income ?? 0),
            'predicted_expense' => (float) ($forecast?->predicted_expense ?? 0),
            'current_available_budget' => (float) ($budget->remaining_amount ?? $budget->allocated_amount),
            'committed_expenses' => 0,
            'warning_threshold' => (float) $budget->warning_threshold,
            'safety_ratio' => 0.8,
        ];
        $engine = 'python-fastapi';
        $advice = $this->completeAllocationMetrics($this->aiService->budgetAdvice($payload), $payload);

        if (! $this->validAdvice($advice)) {
            $advice = $this->localBudgetAdvice($payload);
            $engine = 'php-fallback';
        }

        $xai = $this->groq->generate(
            'Explain this computed budget-advisory result in two concise sentences for a student-organization officer. Preserve all supplied figures and risk labels. Do not recalculate or invent values.',
            json_encode([
                'budget' => $budget->title,
                'event_or_project' => $budget->event?->title,
                'computed_advice' => $advice,
            ], JSON_THROW_ON_ERROR),
            220,
            0.2,
        );

        if ($xai) {
            $advice['deterministic_advice'] = $advice['advice'];
            $advice['advice'] = $xai['text'];
            $advice['xai_model'] = $xai['model'];
        } else {
            $advice['xai_model'] = 'deterministic-fallback';
        }

        $budget->update([
            'advisory_note' => $advice['advice'],
            'overspending_risk' => $advice['overspending_risk'],
            'recommended_allocation' => $advice['recommended_allocation'],
            'safe_spending_limit' => $advice['safe_spending_limit'],
            'advice_generated_at' => now(),
        ]);
        $this->recordBudgetAudit($request, 'generated_advice', $budget, null, [
            ...$this->auditableValues($budget->fresh()),
            'advice_engine' => $engine,
            'xai_model' => $advice['xai_model'],
            'allocation_status' => $advice['allocation_status'],
        ]);

        return response()->json([
            'budget' => $budget->fresh()->load('event:id,title'),
            'forecast_id' => $forecast?->id,
            'engine' => $engine,
            'advice' => $advice,
        ]);
    }

    private function eventBelongsToOrganization(Request $request, mixed $eventId): bool
    {
        if (empty($eventId)) {
            return true;
        }

        return Event::where('organization_id', $request->user()->organization_id)
            ->where('id', $eventId)
            ->exists();
    }

    private function attachApprovalInfo($budgets): void
    {
        $approvals = ApprovalRequest::where('entity_type', 'budget')
            ->whereIn('entity_id', $budgets->pluck('id'))
            ->orderBy('id')
            ->get()
            ->keyBy('entity_id');

        foreach ($budgets as $budget) {
            $approval = $approvals->get($budget->id);
            $budget->approval_status = $approval?->status;
            $budget->approval_remarks = $approval?->remarks;
        }
    }

    private function hasApprovedApproval(Budget $budget): bool
    {
        return ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budget->id)
            ->where('organization_id', $budget->organization_id)
            ->where('status', 'approved')
            ->exists();
    }

    private function hasMaterialBudgetChange(array $data): bool
    {
        return count(array_intersect(array_keys($data), [
            'title',
            'allocated_amount',
            'warning_threshold',
            'event_id',
            'advisory_note',
            'overspending_risk',
        ])) > 0;
    }

    private function reopenApproval(Budget $budget, Request $request): void
    {
        ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budget->id)
            ->where('organization_id', $budget->organization_id)
            ->latest('id')
            ->first()
            ?->reopen(
                $request->user()->id,
                $request->user()->role === 'DEPARTMENT_HEAD' ? 'ADMIN' : 'DEPARTMENT_HEAD'
            );
    }

    private function validAdvice(?array $advice): bool
    {
        return is_array($advice)
            && in_array($advice['overspending_risk'] ?? null, ['low', 'medium', 'high'], true)
            && in_array($advice['forecast_risk'] ?? null, ['stable', 'overspending', 'deficit'], true)
            && is_numeric($advice['estimated_available_budget'] ?? null)
            && is_numeric($advice['safe_spending_limit'] ?? null)
            && is_numeric($advice['recommended_allocation'] ?? null)
            && is_numeric($advice['reserve_amount'] ?? null)
            && in_array($advice['allocation_status'] ?? null, ['within_limit', 'reduce_allocation', 'no_funds'], true)
            && is_string($advice['advice'] ?? null);
    }

    private function completeAllocationMetrics(?array $advice, array $payload): ?array
    {
        if (! is_array($advice)) {
            return null;
        }

        $safeSpendingLimit = is_numeric($advice['safe_spending_limit'] ?? null)
            ? (float) $advice['safe_spending_limit']
            : 0;
        $currentFunds = max(0, (float) $payload['current_available_budget']);
        $recommendedAllocation = round(min($currentFunds, max(0, $safeSpendingLimit)), 2);

        $advice['recommended_allocation'] ??= $recommendedAllocation;
        $advice['reserve_amount'] ??= round(max(0, $currentFunds - (float) $advice['recommended_allocation']), 2);
        // Status reflects actual financial risk, not merely whether the safety reserve
        // is being held back (holding a reserve during a stable forecast is normal).
        $advice['allocation_status'] ??= (float) $advice['recommended_allocation'] <= 0
            ? 'no_funds'
            : (in_array($advice['forecast_risk'] ?? null, ['deficit', 'overspending'], true) ? 'reduce_allocation' : 'within_limit');

        return $advice;
    }

    private function localBudgetAdvice(array $payload): array
    {
        $available = round(
            $payload['current_available_budget']
            + $payload['predicted_income']
            - $payload['predicted_expense']
            - $payload['committed_expenses'],
            2
        );
        $ratio = $payload['predicted_income'] > 0
            ? round($payload['predicted_expense'] / $payload['predicted_income'], 4)
            : null;
        $possibleDeficit = $available < 0;
        $highRisk = $payload['predicted_expense'] > $payload['predicted_income']
            || ($payload['warning_threshold'] > 0 && $available <= $payload['warning_threshold']);
        $mediumRisk = $ratio !== null && $ratio >= 0.9;
        $forecastRisk = $possibleDeficit ? 'deficit' : ($highRisk || $mediumRisk ? 'overspending' : 'stable');
        $overspendingRisk = $possibleDeficit || $highRisk ? 'high' : ($mediumRisk ? 'medium' : 'low');
        $safeSpendingLimit = round(max(0, $available) * $payload['safety_ratio'], 2);
        $currentFunds = max(0, $payload['current_available_budget']);
        $recommendedAllocation = round(min($currentFunds, $safeSpendingLimit), 2);

        // Status reflects actual financial risk, not merely whether the safety reserve
        // is being held back (holding a reserve during a stable forecast is normal).
        $allocationStatus = $recommendedAllocation <= 0
            ? 'no_funds'
            : (in_array($forecastRisk, ['deficit', 'overspending'], true) ? 'reduce_allocation' : 'within_limit');

        return [
            'estimated_available_budget' => $available,
            'safe_spending_limit' => $safeSpendingLimit,
            'recommended_allocation' => $recommendedAllocation,
            'reserve_amount' => round(max(0, $currentFunds - $recommendedAllocation), 2),
            'allocation_status' => $allocationStatus,
            'overspending_risk' => $overspendingRisk,
            'forecast_risk' => $forecastRisk,
            'possible_deficit' => $possibleDeficit,
            'expense_to_income_ratio' => $ratio,
            'advice' => $possibleDeficit
                ? 'A deficit is projected. Pause discretionary spending, review committed costs, and secure additional income before approving new expenses.'
                : ($forecastRisk === 'overspending'
                    ? 'Spending risk is elevated. Keep new commitments below the safe spending limit and reduce nonessential expenses.'
                    : 'The projection is stable. Keep new spending within the safe spending limit while preserving the safety reserve.'),
            'rules_applied' => ['Laravel deterministic fallback'],
        ];
    }

    private function auditableValues(Budget $budget): array
    {
        return $budget->only([
            'id',
            'event_id',
            'title',
            'allocated_amount',
            'remaining_amount',
            'warning_threshold',
            'overspending_risk',
            'recommended_allocation',
            'safe_spending_limit',
            'advice_generated_at',
        ]);
    }

    private function recordBudgetAudit(Request $request, string $action, Budget $budget, ?array $oldValues, ?array $newValues): void
    {
        AuditLog::create([
            'organization_id' => $request->user()->organization_id,
            'user_id' => $request->user()->school_id,
            'module' => 'budgets',
            'action' => $action,
            'record_type' => Budget::class,
            'record_id' => $budget->id,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
