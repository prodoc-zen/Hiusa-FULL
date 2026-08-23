from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class MonthlyFinancialRecord(BaseModel):
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    income: float = Field(ge=0)
    expense: float = Field(ge=0)


class ForecastRequest(BaseModel):
    monthly_records: list[MonthlyFinancialRecord] = Field(min_length=2, max_length=120)

    @model_validator(mode="after")
    def validate_unique_periods(self) -> "ForecastRequest":
        periods = [record.period for record in self.monthly_records]
        if len(periods) != len(set(periods)):
            raise ValueError("monthly_records must contain one row per period")
        return self


class RegressionModel(BaseModel):
    slope: float
    intercept: float
    r_squared: float


class ForecastResponse(BaseModel):
    algorithm: Literal["ordinary_least_squares"]
    forecast_period: str
    sample_months: int
    predicted_income: float
    predicted_expense: float
    predicted_balance: float
    income_model: RegressionModel
    expense_model: RegressionModel


class BudgetAdviceRequest(BaseModel):
    predicted_income: float = Field(ge=0)
    predicted_expense: float = Field(ge=0)
    current_available_budget: float = 0
    committed_expenses: float = Field(default=0, ge=0)
    warning_threshold: float = Field(default=0, ge=0)
    safety_ratio: float = Field(default=0.8, gt=0, le=1)


class BudgetAdviceResponse(BaseModel):
    estimated_available_budget: float
    safe_spending_limit: float
    recommended_allocation: float
    reserve_amount: float
    allocation_status: Literal["within_limit", "reduce_allocation", "no_funds"]
    overspending_risk: Literal["low", "medium", "high"]
    forecast_risk: Literal["stable", "overspending", "deficit"]
    possible_deficit: bool
    expense_to_income_ratio: float | None
    advice: str
    rules_applied: list[str]


class OfficerCandidate(BaseModel):
    officer_id: int
    name: str
    role: str
    account_status: str
    is_available: bool = True
    policy_eligible: bool = True
    active_tasks: int = Field(default=0, ge=0)
    completed_tasks: int = Field(default=0, ge=0)
    overdue_tasks: int = Field(default=0, ge=0)


class TaskDelegationRequest(BaseModel):
    task_title: str = Field(min_length=1, max_length=255)
    officers: list[OfficerCandidate] = Field(min_length=1, max_length=500)
    max_active_tasks: int = Field(default=5, ge=1, le=100)


class OfficerRanking(BaseModel):
    officer_id: int
    name: str
    role_score: float
    workload_score: float
    performance_score: float
    final_score: float
    explanation: str


class TaskDelegationResponse(BaseModel):
    algorithm: Literal["rule_based_weighted_scoring"]
    weights: dict[str, float]
    eligibility_rules: list[str]
    recommended_officer_id: int
    rankings: list[OfficerRanking]
