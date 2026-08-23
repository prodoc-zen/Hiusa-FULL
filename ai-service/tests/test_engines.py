from fastapi.testclient import TestClient

from app.engines.budget_advisory import advise_budget
from app.engines.financial_forecasting import forecast_finances
from app.engines.task_delegation import delegate_task
from app.main import app
from app.schemas import BudgetAdviceRequest, ForecastRequest, TaskDelegationRequest


def test_ols_forecast_matches_linear_monthly_history() -> None:
    result = forecast_finances(ForecastRequest.model_validate({
        "monthly_records": [
            {"period": "2026-01", "income": 1000, "expense": 600},
            {"period": "2026-02", "income": 1200, "expense": 700},
        ]
    }))

    assert result["forecast_period"] == "2026-03"
    assert result["predicted_income"] == 1400
    assert result["predicted_expense"] == 800
    assert result["predicted_balance"] == 600
    assert result["income_model"]["r_squared"] == 1


def test_budget_advice_detects_deficit_and_never_suggests_negative_spending() -> None:
    result = advise_budget(BudgetAdviceRequest(
        predicted_income=500,
        predicted_expense=900,
        current_available_budget=100,
    ))

    assert result["possible_deficit"] is True
    assert result["forecast_risk"] == "deficit"
    assert result["overspending_risk"] == "high"
    assert result["safe_spending_limit"] == 0
    assert result["recommended_allocation"] == 0
    assert result["allocation_status"] == "no_funds"


def test_budget_advice_recommends_allocation_and_preserves_a_reserve() -> None:
    result = advise_budget(BudgetAdviceRequest(
        predicted_income=0,
        predicted_expense=0,
        current_available_budget=1000,
        safety_ratio=0.8,
    ))

    assert result["recommended_allocation"] == 800
    assert result["reserve_amount"] == 200
    assert result["allocation_status"] == "reduce_allocation"


def test_task_delegation_filters_ineligible_users_and_prefers_lower_workload() -> None:
    result = delegate_task(TaskDelegationRequest.model_validate({
        "task_title": "Prepare event logistics",
        "officers": [
            {"officer_id": 10, "name": "Busy", "role": "SBO_OFFICER", "account_status": "active", "active_tasks": 3},
            {"officer_id": 20, "name": "Available", "role": "SBO_OFFICER", "account_status": "active", "active_tasks": 0},
            {"officer_id": 30, "name": "Student", "role": "STUDENT", "account_status": "active", "active_tasks": 0},
        ],
    }))

    assert result["recommended_officer_id"] == 20
    assert [ranking["officer_id"] for ranking in result["rankings"]] == [20, 10]


def test_task_delegation_applies_availability_and_policy_rules_before_scoring() -> None:
    result = delegate_task(TaskDelegationRequest.model_validate({
        "task_title": "Policy-aware assignment",
        "max_active_tasks": 5,
        "officers": [
            {"officer_id": 1, "name": "At Capacity", "role": "SBO_OFFICER", "account_status": "active", "active_tasks": 5},
            {"officer_id": 2, "name": "Unavailable", "role": "SBO_OFFICER", "account_status": "active", "is_available": False},
            {"officer_id": 3, "name": "Policy Blocked", "role": "SBO_OFFICER", "account_status": "active", "policy_eligible": False},
            {"officer_id": 4, "name": "Eligible", "role": "SBO_OFFICER", "account_status": "active", "active_tasks": 2},
        ],
    }))

    assert result["recommended_officer_id"] == 4
    assert [ranking["officer_id"] for ranking in result["rankings"]] == [4]
    assert result["weights"] == {"role": 0.40, "workload": 0.35, "performance": 0.25}


def test_http_api_exposes_health_and_versioned_endpoints(monkeypatch) -> None:
    monkeypatch.setenv("HIUSA_AI_SERVICE_KEY", "test-key")
    client = TestClient(app)

    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/favicon.ico").status_code == 204
    assert client.post("/api/v1/budget-advice", json={
        "predicted_income": 1000,
        "predicted_expense": 500,
    }).status_code == 401
    response = client.post(
        "/api/v1/budget-advice",
        headers={"X-AI-Service-Key": "test-key"},
        json={"predicted_income": 1000, "predicted_expense": 500},
    )
    assert response.status_code == 200
    assert response.json()["forecast_risk"] == "stable"
    openapi = client.get("/openapi.json").json()
    assert "HIUSA AI service key" in openapi["components"]["securitySchemes"]
