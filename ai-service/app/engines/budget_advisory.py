from __future__ import annotations

from app.schemas import BudgetAdviceRequest


def advise_budget(request: BudgetAdviceRequest) -> dict:
    projected = round(
        request.current_available_budget
        + request.predicted_income
        - request.predicted_expense
        - request.committed_expenses,
        2,
    )
    safe_limit = round(max(0.0, projected) * request.safety_ratio, 2)
    current_funds = max(0.0, request.current_available_budget)
    recommended_allocation = round(min(current_funds, safe_limit), 2)
    reserve_amount = round(max(0.0, current_funds - recommended_allocation), 2)
    ratio = (
        round(request.predicted_expense / request.predicted_income, 4)
        if request.predicted_income > 0
        else None
    )
    possible_deficit = projected < 0

    if recommended_allocation <= 0:
        allocation_status = "no_funds"
    elif recommended_allocation < current_funds:
        allocation_status = "reduce_allocation"
    else:
        allocation_status = "within_limit"

    if possible_deficit:
        risk = "high"
        forecast_risk = "deficit"
        advice = (
            "A deficit is projected. Pause discretionary spending, review committed costs, "
            "and secure additional income before approving new expenses."
        )
    elif request.predicted_expense > request.predicted_income or (
        request.warning_threshold > 0 and projected <= request.warning_threshold
    ):
        risk = "high"
        forecast_risk = "overspending"
        advice = (
            "Overspending risk is high. Keep new commitments below the safe spending limit "
            "and reduce nonessential expenses."
        )
    elif ratio is not None and ratio >= 0.9:
        risk = "medium"
        forecast_risk = "overspending"
        advice = (
            "Expenses are close to forecast income. Use the safe spending limit as the cap "
            "for new commitments and monitor the ledger frequently."
        )
    else:
        risk = "low"
        forecast_risk = "stable"
        advice = (
            "The projection is stable. New spending should remain at or below the safe "
            "spending limit while preserving the configured safety reserve."
        )

    return {
        "estimated_available_budget": projected,
        "safe_spending_limit": safe_limit,
        "recommended_allocation": recommended_allocation,
        "reserve_amount": reserve_amount,
        "allocation_status": allocation_status,
        "overspending_risk": risk,
        "forecast_risk": forecast_risk,
        "possible_deficit": possible_deficit,
        "expense_to_income_ratio": ratio,
        "advice": advice,
        "rules_applied": [
            "available = current + forecast income - forecast expense - commitments",
            f"safe spending = max(available, 0) x {request.safety_ratio}",
            "recommended allocation = min(current available funds, safe spending limit)",
            "deficit when available is below zero",
            "overspending when expenses exceed income, reach 90% of income, or available funds reach the warning threshold",
        ],
    }
