<?php

namespace App\Http\Controllers;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AiOutput;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Services\Ai\AiInstructions;
use App\Services\BudgetAdviceRules;
use App\Services\HiusaAiService;
use App\Support\LedgerScope;
use App\Support\SemesterScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class BudgetController extends Controller
{
    private const BUDGET_GONE = 'budget_gone';

    /** The statuses an officer may still edit: a draft, and a budget the reviewer returned. Either way it stays a draft until the Admin submits it. */
    private const OFFICER_EDITABLE_STATUSES = ['draft', 'rejected'];

    /** The statuses the Admin may send for approval. */
    private const SUBMITTABLE_STATUSES = ['draft', 'rejected'];

    public function __construct(
        private readonly HiusaAiService $aiService,
        private readonly TextGenerator $ai,
    ) {}

    public function index(Request $request)
    {
        $paging = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $organizationIds = $this->readableOrganizationIds($request);

        $budgets = Budget::with(['event:id,title', 'financialSemester:id,name,starts_on,ends_on'])
            ->whereIn('organization_id', $organizationIds)
            ->tap(fn ($query) => SemesterScope::budgets($query, AcademicSemester::selected($request)))
            ->withCount(['transactions' => fn ($transactions) => $transactions->whereNull('transactions.archived_at')])
            ->orderBy('created_at', 'desc')
            ->orderBy('id')
            ->paginate($paging['per_page'] ?? 20);

        $this->attachApprovalInfo($budgets);
        $this->attachSpentAmount($budgets->items());
        $this->attachAdviceDetails($budgets->items());

        // The ledger net balance printed beside the budgets is the Ledger summary itself, never a second sum.
        return response()->json([
            ...$budgets->toArray(),
            'ledger_summary' => LedgerScope::totals(LedgerScope::query($request, $organizationIds)),
        ]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'allocated_amount' => ['required', 'numeric', 'min:0.01'],
            'warning_threshold' => ['required', 'numeric', 'min:0', 'lte:allocated_amount'],
            'event_id' => ['nullable', 'exists:events,id'],
            'financial_semester_id' => ['nullable', 'integer', Rule::exists('financial_semesters', 'id')->where('organization_id', $request->user()->organization_id)],
        ]);

        if (! $this->eventBelongsToOrganization($request, $data['event_id'] ?? null)) {
            return response()->json(['message' => 'Selected event does not belong to this organization.'], 422);
        }

        $isDraft = $request->user()->role === 'SBO_OFFICER';

        $budget = DB::transaction(function () use ($data, $request, $isDraft) {
            $budget = Budget::create([
                ...$data,
                'remaining_amount' => $data['allocated_amount'],
                'overspending_risk' => Budget::overspendingRiskFor((float) $data['allocated_amount'], (float) $data['warning_threshold']),
                'submission_status' => $isDraft ? 'draft' : $this->submittedStatus($request),
                'organization_id' => $request->user()->organization_id,
            ]);

            if (! $isDraft) {
                ApprovalRequest::create([
                    'organization_id' => $request->user()->organization_id,
                    'entity_type' => 'budget',
                    'entity_id' => $budget->id,
                    'requested_by' => $request->user()->id,
                    'required_role' => $request->user()->organization->approvalRole(config('approvals.routes.budget')),
                ]);
            }

            $this->recordBudgetAudit($request, 'created', $budget, null, $this->auditableValues($budget));

            return $budget;
        });

        $budget->load(['event:id,title', 'financialSemester:id,name,starts_on,ends_on']);
        $this->attachSpentAmount([$budget]);

        return response()->json($budget, 201);
    }

    public function update(Request $request, $id)
    {
        $budget = Budget::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $budget) {
            return response()->json(['message' => 'Budget not found.'], 404);
        }

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'allocated_amount' => ['sometimes', 'required', 'numeric', 'min:0.01'],
            'warning_threshold' => ['sometimes', 'required', 'numeric', 'min:0'],
            'event_id' => ['nullable', 'exists:events,id'],
            'financial_semester_id' => ['nullable', 'integer', Rule::exists('financial_semesters', 'id')->where('organization_id', $request->user()->organization_id)],
        ]);

        if (! $this->eventBelongsToOrganization($request, $data['event_id'] ?? null)) {
            return response()->json(['message' => 'Selected event does not belong to this organization.'], 422);
        }

        return DB::transaction(function () use ($request, $budget, $data) {
            $budget = Budget::whereKey($budget->id)->lockForUpdate()->firstOrFail();
            $byOfficer = $request->user()->role === 'SBO_OFFICER';
            // An officer prepares a budget the organization has not sent on: one that is submitted or approved is the Admin's to change.
            if ($byOfficer && ! in_array($budget->submission_status, self::OFFICER_EDITABLE_STATUSES, true)) {
                return response()->json(['message' => 'This budget has been submitted. Only your Admin can change it.'], 403);
            }
            if ($byOfficer) {
                $data['submission_status'] = 'draft';
            }
            $oldValues = $this->auditableValues($budget);

            if (array_key_exists('event_id', $data)
                && (int) ($data['event_id'] ?? 0) !== (int) ($budget->event_id ?? 0)
                && $budget->transactions()->exists()) {
                return response()->json([
                    'message' => 'This budget already has ledger entries, so it can no longer be moved to a different event.',
                ], 409);
            }

            $allocatedAmount = (float) ($data['allocated_amount'] ?? $budget->allocated_amount);
            $warningThreshold = (float) ($data['warning_threshold'] ?? $budget->warning_threshold);

            if ($warningThreshold > $allocatedAmount) {
                return response()->json([
                    'message' => 'The warning threshold cannot exceed the allocated amount.',
                ], 422);
            }

            if (array_key_exists('allocated_amount', $data)) {
                $spent = $budget->transactions()->whereNull('transactions.archived_at')->where('type', 'expense')->sum('amount');
                $income = $budget->transactions()->whereNull('transactions.archived_at')->where('type', 'income')->sum('amount');
                $data['remaining_amount'] = (float) $data['allocated_amount'] + (float) $income - (float) $spent;
            }

            if (array_key_exists('allocated_amount', $data) || array_key_exists('warning_threshold', $data)) {
                $data['overspending_risk'] = Budget::overspendingRiskFor((float) ($data['remaining_amount'] ?? $budget->remaining_amount), $warningThreshold);
            }

            if ($this->isAwaitingSaoOrApproved($budget) && $this->hasMaterialBudgetChange($data)) {
                $this->restartApprovalAtDepartmentHead($budget, $request);
            }

            $budget->update($data);
            $this->recordBudgetAudit($request, 'updated', $budget, $oldValues, $this->auditableValues($budget->fresh()));

            if (! $byOfficer && $this->hasRejectedApproval($budget)) {
                $this->restartApprovalAtDepartmentHead($budget, $request);
            }

            $fresh = $budget->fresh()->load(['event:id,title', 'financialSemester:id,name,starts_on,ends_on']);
            $this->attachSpentAmount([$fresh]);

            return response()->json($fresh);
        });
    }

    public function submit(Request $request, $id)
    {
        $budget = Budget::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $budget) {
            return response()->json(['message' => 'Budget not found.'], 404);
        }

        return DB::transaction(function () use ($request, $budget) {
            $budget = Budget::whereKey($budget->id)->lockForUpdate()->firstOrFail();
            if (! in_array($budget->submission_status, self::SUBMITTABLE_STATUSES, true)) {
                return response()->json(['message' => 'Only a draft or a returned budget can be submitted.'], 409);
            }
            $oldValues = $this->auditableValues($budget);

            if (ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budget->id)->where('organization_id', $budget->organization_id)->exists()) {
                $this->restartApprovalAtDepartmentHead($budget, $request);
            } else {
                $budget->update(['submission_status' => $this->submittedStatus($request)]);
                ApprovalRequest::create([
                    'organization_id' => $budget->organization_id,
                    'entity_type' => 'budget',
                    'entity_id' => $budget->id,
                    'requested_by' => $request->user()->id,
                    'required_role' => $request->user()->organization->approvalRole(config('approvals.routes.budget')),
                ]);
            }
            $this->recordBudgetAudit($request, 'submitted', $budget, $oldValues, $this->auditableValues($budget->fresh()));

            $fresh = $budget->fresh()->load(['event:id,title', 'financialSemester:id,name,starts_on,ends_on']);
            $this->attachSpentAmount([$fresh]);

            return response()->json($fresh);
        });
    }

    public function destroy(Request $request, $id)
    {
        $budget = Budget::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $budget) {
            return response()->json(['message' => 'Budget not found.'], 404);
        }

        // The checks run on the locked row. A ledger entry takes a shared lock on its budget through the foreign
        // key and an approval updates the row, so each either lands before the checks and blocks the delete, or waits for it.
        // The approval rows are locked first because a review locks its approval row before the budget row, and the
        // opposite order deadlocks the two.
        $blocked = DB::transaction(function () use ($budget, $request) {
            ApprovalRequest::where('organization_id', $budget->organization_id)
                ->where('entity_type', 'budget')
                ->where('entity_id', $budget->id)
                ->lockForUpdate()
                ->get();
            $locked = Budget::whereKey($budget->id)->lockForUpdate()->first();
            if (! $locked) {
                return self::BUDGET_GONE;
            }
            if ($locked->submission_status === 'approved') {
                return 'Cannot delete an approved budget. It stays on record as the allocation that was approved.';
            }
            if ($locked->transactions()->exists()) {
                return 'Cannot delete a budget that has existing transactions. Remove all transactions first.';
            }

            $oldValues = $this->auditableValues($locked);
            ApprovalRequest::deleteForEntity($locked->organization_id, 'budget', $locked->id);
            $locked->delete();
            $this->recordBudgetAudit($request, 'deleted', $locked, $oldValues, null);

            return null;
        });
        if ($blocked === self::BUDGET_GONE) {
            return response()->json(['message' => 'Budget not found.'], 404);
        }
        if ($blocked) {
            return response()->json(['message' => $blocked], 409);
        }

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

        if ($budget->submission_status !== 'approved') {
            return response()->json(['message' => 'Advice is available once the budget is approved.'], 409);
        }

        $forecast = FinancialForecast::currentFor($budget->organization_id);
        $share = $forecast ? $this->allocationShare($budget) : 0.0;
        $forecastStatus = ! $forecast ? 'missing' : ($share > 0 ? 'used' : 'not_applied');
        $payload = [
            'predicted_income' => round((float) ($forecast?->predicted_income ?? 0) * $share, 2),
            'predicted_expense' => round((float) ($forecast?->predicted_expense ?? 0) * $share, 2),
            'current_available_budget' => $budget->recomputedRemaining(),
            'committed_expenses' => 0,
            'warning_threshold' => (float) $budget->warning_threshold,
            'safety_ratio' => 0.8,
        ];
        $inputs = [
            ...$payload,
            'forecast_status' => $forecastStatus,
            'forecast_period' => $forecast?->forecast_period,
            'budget_share' => round($share, 4),
        ];
        $engine = 'python-fastapi';
        $advice = $this->completeAllocationMetrics($this->aiService->budgetAdvice($payload), $payload);

        if (! $this->validAdvice($advice)) {
            $advice = BudgetAdviceRules::evaluate($payload);
            $engine = 'php-fallback';
        }
        if ($forecastStatus === 'missing') {
            $advice['advice'] = 'No current forecast was available, so this advice uses the budget balance only. '.$advice['advice'];
        } elseif ($forecastStatus === 'not_applied') {
            $advice['advice'] = 'This budget is outside the current semester, so the advice uses its balance only. '.$advice['advice'];
        }
        $advice['inputs'] = $inputs;

        $xaiFacts = [
            'budget' => $budget->title,
            'event_or_project' => $budget->event?->title,
            // The forecast and balance the rules used, so the explanation can name the figures behind the risk.
            'inputs' => $inputs,
            'computed_advice' => $advice,
        ];
        $xai = $this->ai->generate(
            AiInstructions::budgetAdvice(),
            json_encode($xaiFacts, JSON_THROW_ON_ERROR),
            220,
            0.2,
        );
        if ($xai && (! $this->ai->preservesNumericFacts($xai['text'], $xaiFacts) || str_contains($xai['text'], '$') || stripos($xai['text'], 'USD') !== false || stripos($xai['text'], 'dollar') !== false)) {
            $xai = null;
        }

        if ($xai) {
            $advice['deterministic_advice'] = $advice['advice'];
            $advice['advice'] = $xai['text'];
            $advice['xai_model'] = $xai['model'];
            $advice['xai_status'] = 'generated';
        } else {
            $advice['xai_model'] = null;
            $advice['xai_status'] = 'unavailable';
        }

        $budget->update([
            'advisory_note' => $advice['advice'],
            'overspending_risk' => $advice['overspending_risk'],
            'recommended_allocation' => $advice['recommended_allocation'],
            'safe_spending_limit' => $advice['safe_spending_limit'],
            'advice_generated_at' => now(),
        ]);
        AiOutput::create([
            'organization_id' => $budget->organization_id,
            'feature_type' => 'BUDGET_EXPLANATION',
            'reference_type' => Budget::class,
            'reference_id' => $budget->id,
            'prompt_text' => 'Explain the calculated budget-advisory facts without changing any value.',
            'output_text' => $xai ? $advice['advice'] : '',
            'model_name' => $advice['xai_model'],
            'context_version' => 'budget-advice-v2',
            'structured_input' => $inputs,
            'structured_output' => ['engine' => $engine, 'computed_advice' => $advice],
            'status' => $xai ? 'completed' : 'failed',
            'error_message' => $xai ? null : 'The AI explanation was unavailable; deterministic budget advice was still calculated.',
            'decision_status' => $xai ? 'accepted' : 'rejected',
            'requested_by' => $request->user()->school_id,
            'decided_by' => $xai ? $request->user()->school_id : null,
            'decided_at' => $xai ? now() : null,
            'created_at' => now(),
        ]);
        $this->recordBudgetAudit($request, 'generated_advice', $budget, null, [
            ...$this->auditableValues($budget->fresh()),
            'advice_engine' => $engine,
            'xai_model' => $advice['xai_model'],
            'allocation_status' => $advice['allocation_status'],
        ]);

        $freshBudget = $budget->fresh()->load(['event:id,title', 'financialSemester:id,name,starts_on,ends_on']);
        $this->attachApprovalInfo(collect([$freshBudget]));
        $this->attachSpentAmount([$freshBudget]);
        $this->attachAdviceDetails([$freshBudget]);

        return response()->json([
            'budget' => $freshBudget,
            'forecast_id' => $forecast?->id,
            'forecast_period' => $forecast?->forecast_period,
            'forecast_status' => $forecastStatus,
            'engine' => $engine,
            'advice' => $advice,
        ]);
    }

    /** The organization forecast covers every approved budget, so a single budget carries only its share of it. */
    private function allocationShare(Budget $budget): float
    {
        $allocated = (float) $budget->allocated_amount;
        if ($allocated <= 0) {
            return 0.0;
        }

        $semester = AcademicSemester::active();
        if (! SemesterScope::budgets(Budget::whereKey($budget->id), $semester)->exists()) {
            return 0.0;
        }

        $approved = (float) SemesterScope::budgets(Budget::where('organization_id', $budget->organization_id)
            ->where('submission_status', 'approved'), $semester)->sum('allocated_amount');

        return $allocated / max($approved, $allocated);
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

    /** Puts the four figures on each budget: allocated, spent, income and remaining, with whether the budget is released. */
    private function attachSpentAmount(iterable $budgets): void
    {
        $figures = Budget::figuresFor($budgets);

        foreach ($budgets as $budget) {
            $budget->spent_amount = $figures[$budget->id]['spent_amount'];
            $budget->income_amount = $figures[$budget->id]['income_amount'];
            $budget->remaining_amount = $figures[$budget->id]['remaining_amount'];
            $budget->is_released = $figures[$budget->id]['is_released'];
        }
    }

    /** @param  iterable<Budget>  $budgets */
    private function attachAdviceDetails(iterable $budgets): void
    {
        $ids = collect($budgets)->pluck('id')->all();
        if (empty($ids)) {
            return;
        }
        $outputs = AiOutput::where('feature_type', 'BUDGET_EXPLANATION')
            ->where('reference_type', Budget::class)
            ->whereIn('reference_id', $ids)
            ->orderBy('id')
            ->get()
            ->keyBy('reference_id');

        foreach ($budgets as $budget) {
            $output = $outputs->get($budget->id);
            $structured = is_array($output?->structured_output) ? $output->structured_output : null;
            $budget->advice_details = $structured && isset($structured['computed_advice'])
                ? [
                    'engine' => $structured['engine'] ?? 'php-fallback',
                    'advice' => $structured['computed_advice'],
                ]
                : null;
            $input = is_array($output?->structured_input) ? $output->structured_input : [];
            $budget->advice_stale = $budget->advice_generated_at !== null
                && BudgetAdviceRules::isStale($input, (float) ($budget->remaining_amount ?? $budget->allocated_amount), (float) $budget->warning_threshold);
        }
    }

    private function isAwaitingSaoOrApproved(Budget $budget): bool
    {
        return in_array($budget->submission_status, ['pending_sao', 'approved'], true);
    }

    private function hasRejectedApproval(Budget $budget): bool
    {
        return $budget->submission_status === 'rejected';
    }

    private function hasMaterialBudgetChange(array $data): bool
    {
        return count(array_intersect(array_keys($data), [
            'title',
            'allocated_amount',
            'warning_threshold',
            'event_id',
            'financial_semester_id',
            'advisory_note',
            'overspending_risk',
        ])) > 0;
    }

    private function submittedStatus(Request $request): string
    {
        return $request->user()->organization->is_university_wide ? 'pending_sao' : 'pending_department_head';
    }

    private function restartApprovalAtDepartmentHead(Budget $budget, Request $request): void
    {
        ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budget->id)
            ->where('organization_id', $budget->organization_id)
            ->latest('id')
            ->first()
            ?->reopen(
                $request->user()->id,
                $request->user()->organization->approvalRole(config('approvals.routes.budget'))
            );

        $budget->update([
            'submission_status' => $this->submittedStatus($request),
            'department_head_approved_by' => null,
            'department_head_approved_at' => null,
        ]);
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

    private function auditableValues(Budget $budget): array
    {
        return $budget->only([
            'id',
            'event_id',
            'financial_semester_id',
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
