import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

PAYLOAD = {"predicted_income": 100, "predicted_expense": 50}


@pytest.fixture(autouse=True)
def _clean_auth_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HIUSA_AI_SERVICE_KEY", raising=False)
    monkeypatch.delenv("HIUSA_AI_SERVICE_AUTH_DISABLED", raising=False)


def test_missing_key_without_opt_out_is_rejected() -> None:
    response = client.post("/api/v1/budget-advice", json=PAYLOAD)

    assert response.status_code == 401


def test_opt_out_flag_allows_requests_with_no_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIUSA_AI_SERVICE_AUTH_DISABLED", "true")

    response = client.post("/api/v1/budget-advice", json=PAYLOAD)

    assert response.status_code == 200


def test_wrong_key_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIUSA_AI_SERVICE_KEY", "the-real-key")

    response = client.post(
        "/api/v1/budget-advice",
        json=PAYLOAD,
        headers={"X-AI-Service-Key": "not-the-real-key"},
    )

    assert response.status_code == 401


def test_correct_key_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIUSA_AI_SERVICE_KEY", "the-real-key")

    response = client.post(
        "/api/v1/budget-advice",
        json=PAYLOAD,
        headers={"X-AI-Service-Key": "the-real-key"},
    )

    assert response.status_code == 200


def test_health_endpoint_stays_open_regardless_of_key_state() -> None:
    assert client.get("/health").status_code == 200

    response = client.get("/health")
    assert response.json()["authentication"] == "locked (no key configured)"
