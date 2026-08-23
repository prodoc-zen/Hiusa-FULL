from __future__ import annotations

import hmac
import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Response, Security
from fastapi.security import APIKeyHeader
from dotenv import load_dotenv

from app.engines.budget_advisory import advise_budget
from app.engines.financial_forecasting import forecast_finances
from app.engines.task_delegation import delegate_task
from app.schemas import (
    BudgetAdviceRequest,
    BudgetAdviceResponse,
    ForecastRequest,
    ForecastResponse,
    TaskDelegationRequest,
    TaskDelegationResponse,
)


load_dotenv(Path(__file__).resolve().parents[1] / ".env")

app = FastAPI(
    title="HIUSA AI Service",
    version="1.0.0",
    description="Deterministic financial forecasting, budget advice, and task delegation APIs.",
)
service_key_header = APIKeyHeader(
    name="X-AI-Service-Key",
    scheme_name="HIUSA AI service key",
    description="Must match HIUSA_AI_SERVICE_KEY on the Python and Laravel servers.",
    auto_error=False,
)


def require_service_key(x_ai_service_key: str | None = Security(service_key_header)) -> None:
    expected = os.getenv("HIUSA_AI_SERVICE_KEY", "").strip()
    if expected and (not x_ai_service_key or not hmac.compare_digest(x_ai_service_key, expected)):
        raise HTTPException(status_code=401, detail="Invalid AI service key")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "hiusa-ai",
        "version": app.version,
        "authentication": "api-key" if os.getenv("HIUSA_AI_SERVICE_KEY", "").strip() else "disabled",
    }


@app.get("/favicon.ico", include_in_schema=False, status_code=204)
def favicon() -> Response:
    return Response(status_code=204)


@app.post(
    "/api/v1/financial-forecast",
    response_model=ForecastResponse,
    dependencies=[Depends(require_service_key)],
)
def financial_forecast(request: ForecastRequest) -> dict:
    return forecast_finances(request)


@app.post(
    "/api/v1/budget-advice",
    response_model=BudgetAdviceResponse,
    dependencies=[Depends(require_service_key)],
)
def budget_advice(request: BudgetAdviceRequest) -> dict:
    return advise_budget(request)


@app.post(
    "/api/v1/task-delegation",
    response_model=TaskDelegationResponse,
    dependencies=[Depends(require_service_key)],
)
def task_delegation(request: TaskDelegationRequest) -> dict:
    try:
        return delegate_task(request)
    except ValueError as exception:
        raise HTTPException(status_code=422, detail=str(exception)) from exception
