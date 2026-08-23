from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.schemas import ForecastRequest


@dataclass(frozen=True)
class OlsModel:
    slope: float
    intercept: float
    r_squared: float


def _month_number(period: str) -> int:
    year, month = (int(value) for value in period.split("-"))
    return year * 12 + month - 1


def _period_from_number(value: int) -> str:
    year, month_index = divmod(value, 12)
    return date(year, month_index + 1, 1).strftime("%Y-%m")


def _ols(x_values: list[float], y_values: list[float]) -> OlsModel:
    count = len(x_values)
    mean_x = sum(x_values) / count
    mean_y = sum(y_values) / count
    denominator = sum((x_value - mean_x) ** 2 for x_value in x_values)
    numerator = sum(
        (x_value - mean_x) * (y_values[index] - mean_y)
        for index, x_value in enumerate(x_values)
    )
    slope = numerator / denominator if denominator else 0.0
    intercept = mean_y - slope * mean_x
    residual_sum = sum(
        (y_values[index] - (intercept + slope * x_value)) ** 2
        for index, x_value in enumerate(x_values)
    )
    total_sum = sum((y_value - mean_y) ** 2 for y_value in y_values)
    r_squared = 1.0 if total_sum == 0 and residual_sum == 0 else (1 - residual_sum / total_sum if total_sum else 0.0)

    return OlsModel(
        slope=round(slope, 6),
        intercept=round(intercept, 6),
        r_squared=round(max(0.0, min(1.0, r_squared)), 6),
    )


def forecast_finances(request: ForecastRequest) -> dict:
    records = sorted(request.monthly_records, key=lambda record: record.period)
    first_month = _month_number(records[0].period)
    x_values = [float(_month_number(record.period) - first_month) for record in records]
    income_model = _ols(x_values, [record.income for record in records])
    expense_model = _ols(x_values, [record.expense for record in records])
    next_month_number = _month_number(records[-1].period) + 1
    next_x = float(next_month_number - first_month)
    predicted_income = round(max(0.0, income_model.intercept + income_model.slope * next_x), 2)
    predicted_expense = round(max(0.0, expense_model.intercept + expense_model.slope * next_x), 2)

    return {
        "algorithm": "ordinary_least_squares",
        "forecast_period": _period_from_number(next_month_number),
        "sample_months": len(records),
        "predicted_income": predicted_income,
        "predicted_expense": predicted_expense,
        "predicted_balance": round(predicted_income - predicted_expense, 2),
        "income_model": income_model.__dict__,
        "expense_model": expense_model.__dict__,
    }
