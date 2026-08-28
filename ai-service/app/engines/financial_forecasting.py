from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.schemas import ForecastRequest


@dataclass(frozen=True)
class OlsModel:
    slope: float
    intercept: float
    r_squared: float


# Below this many months, R-squared is a sample-size artifact rather than a
# quality signal (two points always fit a line perfectly). n=2 is explicitly
# treated as insufficient_data regardless of its r_squared value.
MIN_SAMPLE_MONTHS_FOR_FIT_ASSESSMENT = 4
STRONG_FIT_R_SQUARED = 0.7
MODERATE_FIT_R_SQUARED = 0.4


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


def _assess_fit_quality(sample_months: int, income_r_squared: float, expense_r_squared: float) -> dict:
    if sample_months < MIN_SAMPLE_MONTHS_FOR_FIT_ASSESSMENT:
        return {
            "fit_quality": "insufficient_data",
            "is_reliable": False,
            "confidence_note": (
                f"Only {sample_months} month(s) of history were used. At least "
                f"{MIN_SAMPLE_MONTHS_FOR_FIT_ASSESSMENT} months are needed before R² is a "
                "meaningful signal, so treat this forecast as a rough estimate."
            ),
        }

    weakest_fit = min(income_r_squared, expense_r_squared)
    fit_summary = (
        f"Based on {sample_months} months of history with income R² {income_r_squared:.3f} "
        f"and expense R² {expense_r_squared:.3f}"
    )

    if weakest_fit >= STRONG_FIT_R_SQUARED:
        return {
            "fit_quality": "strong",
            "is_reliable": True,
            "confidence_note": f"{fit_summary}, the linear trend fits the data well.",
        }

    if weakest_fit >= MODERATE_FIT_R_SQUARED:
        return {
            "fit_quality": "moderate",
            "is_reliable": True,
            "confidence_note": f"{fit_summary}, the trend is a fair but not tight fit; treat the projection as a general direction.",
        }

    return {
        "fit_quality": "weak",
        "is_reliable": False,
        "confidence_note": f"{fit_summary}, actual figures vary widely from the linear trend; treat this projection with caution.",
    }


def forecast_finances(request: ForecastRequest) -> dict:
    records = sorted(request.monthly_records, key=lambda record: record.period)
    first_month = _month_number(records[0].period)
    x_values = [float(_month_number(record.period) - first_month) for record in records]
    income_model = _ols(x_values, [record.income for record in records])
    expense_model = _ols(x_values, [record.expense for record in records])
    next_month_number = _month_number(records[-1].period) + 1
    next_x = float(next_month_number - first_month)
    raw_predicted_income = round(income_model.intercept + income_model.slope * next_x, 2)
    raw_predicted_expense = round(expense_model.intercept + expense_model.slope * next_x, 2)
    predicted_income = max(0.0, raw_predicted_income)
    predicted_expense = max(0.0, raw_predicted_expense)
    fit_assessment = _assess_fit_quality(len(records), income_model.r_squared, expense_model.r_squared)

    return {
        "algorithm": "ordinary_least_squares",
        "forecast_period": _period_from_number(next_month_number),
        "sample_months": len(records),
        "predicted_income": predicted_income,
        "predicted_expense": predicted_expense,
        "predicted_balance": round(predicted_income - predicted_expense, 2),
        "raw_predicted_income": raw_predicted_income,
        "raw_predicted_expense": raw_predicted_expense,
        "income_clamped": raw_predicted_income < 0,
        "expense_clamped": raw_predicted_expense < 0,
        "income_model": income_model.__dict__,
        "expense_model": expense_model.__dict__,
        **fit_assessment,
    }
