from fastapi.testclient import TestClient

from app.engines.budget_advisory import advise_budget
from app.engines.financial_forecasting import forecast_finances
from app.engines.task_delegation import delegate_task, infer_task_area
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
    # Two points always fit a line perfectly - r_squared == 1 here is a
    # sample-size artifact, not a quality signal, so it must be labelled as such.
    assert result["fit_quality"] == "insufficient_data"
    assert result["is_reliable"] is False


def test_ols_forecast_flags_noisy_data_as_unreliable() -> None:
    result = forecast_finances(ForecastRequest.model_validate({
        "monthly_records": [
            {"period": "2026-01", "income": 500, "expense": 600},
            {"period": "2026-02", "income": 50, "expense": 650},
            {"period": "2026-03", "income": 480, "expense": 700},
            {"period": "2026-04", "income": 60, "expense": 750},
            {"period": "2026-05", "income": 510, "expense": 800},
            {"period": "2026-06", "income": 40, "expense": 850},
        ]
    }))

    assert result["fit_quality"] != "strong"
    assert result["is_reliable"] is False


def test_ols_forecast_exposes_raw_projection_when_clamped() -> None:
    result = forecast_finances(ForecastRequest.model_validate({
        "monthly_records": [
            {"period": "2026-01", "income": 1000, "expense": 200},
            {"period": "2026-02", "income": 700, "expense": 200},
            {"period": "2026-03", "income": 400, "expense": 200},
            {"period": "2026-04", "income": 100, "expense": 200},
        ]
    }))

    assert result["predicted_income"] == 0
    assert result["raw_predicted_income"] < 0
    assert result["income_clamped"] is True
    assert result["predicted_expense"] == 200
    assert result["expense_clamped"] is False


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


def test_budget_advice_holding_a_reserve_during_a_stable_forecast_is_within_limit() -> None:
    result = advise_budget(BudgetAdviceRequest(
        predicted_income=0,
        predicted_expense=0,
        current_available_budget=1000,
        safety_ratio=0.8,
    ))

    assert result["recommended_allocation"] == 800
    assert result["reserve_amount"] == 200
    # A held-back safety reserve during an otherwise stable, risk-free forecast
    # is normal operation, not a warning - it must not read as reduce_allocation.
    assert result["forecast_risk"] == "stable"
    assert result["allocation_status"] == "within_limit"


def test_budget_advice_flags_reduce_allocation_when_risk_is_actually_elevated() -> None:
    result = advise_budget(BudgetAdviceRequest(
        predicted_income=1000,
        predicted_expense=1100,
        current_available_budget=500,
    ))

    assert result["forecast_risk"] == "overspending"
    assert result["allocation_status"] == "reduce_allocation"


def test_infer_task_area_uses_word_boundaries_not_bare_substrings() -> None:
    # "media" must not fire merely because it appears inside "im-media-te".
    assert infer_task_area("Send immediate reminders to officers") != "publicity"
    # "fund" must not fire merely because it is a prefix of "fund-amental".
    assert infer_task_area("Draft the fundamental bylaws revision") != "finance"
    # The finance keyword itself must still be reachable through its own wording.
    assert infer_task_area("Coordinate the fundraising drive for new members") == "finance"


def test_infer_task_area_stem_prefixes_still_match_inflected_forms() -> None:
    assert infer_task_area("Prepare the financial liquidation report") == "finance"
    assert infer_task_area("Update the promotional materials for the fair") == "publicity"
    assert infer_task_area("Start coordinating the opening ceremony") == "coordination"
    assert infer_task_area("Review the logistics for the venue setup") == "logistics"
    assert infer_task_area("Finish documenting the meeting minutes") == "documentation"


def test_task_delegation_filters_ineligible_users_and_prefers_lower_workload() -> None:
    result = delegate_task(TaskDelegationRequest.model_validate({
        "task_title": "Prepare event logistics",
        "officers": [
            {"officer_id": 10, "name": "Busy", "role": "SBO_OFFICER", "position_title": "Business Manager", "account_status": "active", "active_tasks": 3},
            {"officer_id": 20, "name": "Available", "role": "SBO_OFFICER", "position_title": "Business Manager", "account_status": "active", "active_tasks": 0},
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
            {"officer_id": 1, "name": "At Capacity", "role": "SBO_OFFICER", "position_title": "President", "account_status": "active", "active_tasks": 5},
            {"officer_id": 2, "name": "Unavailable", "role": "SBO_OFFICER", "position_title": "President", "account_status": "active", "is_available": False},
            {"officer_id": 3, "name": "Policy Blocked", "role": "SBO_OFFICER", "position_title": "President", "account_status": "active", "policy_eligible": False},
            {"officer_id": 4, "name": "Eligible", "role": "SBO_OFFICER", "position_title": "President", "account_status": "active", "active_tasks": 2},
        ],
    }))

    assert result["recommended_officer_id"] == 4
    assert [ranking["officer_id"] for ranking in result["rankings"]] == [4]
    assert result["weights"] == {"position": 0.40, "workload": 0.35, "performance": 0.25}


def test_task_delegation_position_relevance_varies_by_position_title() -> None:
    result = delegate_task(TaskDelegationRequest.model_validate({
        "task_title": "Prepare the liquidation report for the budget audit",
        "officers": [
            {"officer_id": 1, "name": "Treasurer", "role": "SBO_OFFICER", "account_status": "active", "position_title": "Treasurer"},
            {"officer_id": 2, "name": "PR Officer", "role": "SBO_OFFICER", "account_status": "active", "position_title": "Public Relations Officer"},
        ],
    }))

    assert result["task_area"] == "finance"
    scores = {ranking["officer_id"]: ranking["role_score"] for ranking in result["rankings"]}
    assert scores[1] != scores[2]
    assert scores[1] == 100.0
    assert scores[2] == 40.0
    assert result["recommended_officer_id"] == 1


def test_task_delegation_workload_scales_across_the_whole_eligible_range() -> None:
    result = delegate_task(TaskDelegationRequest.model_validate({
        "task_title": "General coordination task",
        "max_active_tasks": 100,
        "officers": [
            {"officer_id": 1, "name": "Lightly Loaded", "role": "SBO_OFFICER", "position_title": "President", "account_status": "active", "active_tasks": 6},
            {"officer_id": 2, "name": "Heavily Loaded", "role": "SBO_OFFICER", "position_title": "President", "account_status": "active", "active_tasks": 60},
        ],
    }))

    scores = {ranking["officer_id"]: ranking["final_score"] for ranking in result["rankings"]}
    assert scores[1] != scores[2]
    assert scores[1] > scores[2]


def test_task_delegation_with_no_eligible_officer_raises() -> None:
    try:
        delegate_task(TaskDelegationRequest.model_validate({
            "task_title": "Unassignable task",
            "officers": [
                {"officer_id": 1, "name": "Student", "role": "STUDENT", "account_status": "active"},
            ],
        }))
        assert False, "expected ValueError for no eligible officer"
    except ValueError:
        pass


def test_task_delegation_rejects_officers_without_an_assigned_position() -> None:
    try:
        delegate_task(TaskDelegationRequest.model_validate({
            "task_title": "Prepare the event plan",
            "officers": [
                {"officer_id": 1, "name": "Unconfigured Officer", "role": "SBO_OFFICER", "account_status": "active"},
            ],
        }))
        assert False, "expected ValueError when the officer has no assigned position"
    except ValueError:
        pass


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


def test_http_api_returns_422_when_no_officer_is_eligible(monkeypatch) -> None:
    monkeypatch.setenv("HIUSA_AI_SERVICE_KEY", "test-key")
    client = TestClient(app)

    response = client.post(
        "/api/v1/task-delegation",
        headers={"X-AI-Service-Key": "test-key"},
        json={
            "task_title": "Prepare budget report",
            "officers": [
                {"officer_id": 1, "name": "Not Eligible", "role": "STUDENT", "account_status": "active"},
            ],
        },
    )

    assert response.status_code == 422
