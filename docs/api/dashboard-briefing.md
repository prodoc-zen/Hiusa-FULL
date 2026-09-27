# GET /api/dashboard/briefing

Role-aware briefing endpoint. Every role's home screen (Section 6 of
`docs/design/ELEVATION_SPEC.md`) is fed by this single endpoint instead of
building its own bespoke set of calls.

- Middleware: `auth:sanctum`, `throttle:api-read`, `role:SUPER_ADMIN,ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT`
- Controller: `App\Http\Controllers\DashboardBriefingController`
- Assembly: `App\Services\Dashboard\DashboardBriefingService`
- Insights: `App\Services\Dashboard\DashboardInsightEngine`

Strictly organization-scoped for every role except `SUPER_ADMIN`, who is the
one university-wide "SAO Director" account and sees every non-SAO
organization. Money is returned as plain numbers (never formatted strings);
timestamps are ISO 8601.

## Response shape

```jsonc
{
  "user": {
    "first_name": "Maria",
    "role": "ADMIN",
    "organization": { "id": 3, "name": "Computer Science Society", "abbreviation": "CSS", "logo_url": null } // or null
  },
  "summary": {
    "attention_count": 3,
    "headline": "Two approvals and one closing election need you today."
  },
  "attention": [
    {
      "id": "approval-42",
      "type": "approval",
      "severity": "high", // high | medium | low
      "title": "Foundation Week 2026",
      "detail": "Event requested by Juan Dela Cruz 2 days ago",
      "due_at": null,
      "href": "/dashboard/approvals"
    }
    // ... max 8, sorted by severity then due_at
  ],
  "pillars": {
    // only the areas relevant to the caller's role - see "Pillars per role" below
    "finance": {
      "value": 38200.00,
      "unit": "currency",
      "label": "Remaining budget",
      "context": "₱38,200.00 left of ₱60,000.00 allocated (36.3% used)",
      "delta": { "value": 1250.50, "period": "vs last 30 days", "direction": "up" }, // optional
      "meter": { "value": 21800.00, "limit": 60000.00 } // optional
    }
  },
  "insights": [
    {
      "engine": "budget_advisory", // budget_advisory | financial_forecast | task_workload_balance | election_turnout_pace
      "title": "\"Foundation Week\" is at high overspending risk",
      "body": "Spending risk is elevated. Keep new commitments below the safe spending limit...",
      "why": {
        "method": "Deterministic budget-advisory engine (BudgetController::advice)",
        "inputs": { "allocated_amount": 60000, "remaining_amount": 8000, "warning_threshold": 5000 },
        "formula": "available = current_available_budget + predicted_income - predicted_expense - committed_expenses; ..."
      },
      "generated_at": "2026-09-20T08:00:00+00:00",
      "href": "/dashboard/finance/budget-allocation"
    }
    // 0-3 items, advisory wording only ("may", "consider"); never acts automatically
  ],
  "agenda": [
    { "id": "event-9", "title": "General Assembly", "starts_at": "2026-10-01T09:00:00+00:00", "location": "Gym", "href": "/dashboard/events/manage-events" }
    // max 5, soonest first
  ],
  "activity": [
    { "id": "audit-101", "actor": "Juan Dela Cruz", "action": "Created", "subject": "SAO registered a student organization.", "at": "2026-09-20T08:00:00+00:00", "href": null }
    // max 8, most recent first
  ],
  "organizations": [
    // SUPER_ADMIN only
    {
      "id": 3, "name": "Computer Science Society", "abbreviation": "CSS",
      "accreditation_status": null, // not tracked in the schema yet - always null
      "budget_utilization_percent": 63.7,
      "financial_reports_pending": 1,
      "open_elections": 1,
      "last_activity_at": "2026-09-20T08:00:00+00:00" // or null
    }
  ]
}
```

## Attention items per role

- **ADMIN**: pending approvals requiring ADMIN action (announcement, payment), elections closing within 72h, budgets at/above 80% utilization, overdue tasks, financial reports returned or due against the SAO-wide submission deadline.
- **SBO_OFFICER**: orders with a submitted payment proof still awaiting officer review, my tasks overdue or due within 3 days, today's events (attendance still to record).
- **DEPARTMENT_HEAD**: approval requests awaiting my decision (event, election, financial_report - first-stage requests), ordered oldest first so age is implicit in position/severity.
- **STUDENT**: the active election I have not voted in yet, my orders ready to claim, my tasks overdue or due within 3 days, today's events.
- **SUPER_ADMIN**: approval requests requiring SUPER_ADMIN action (budget, financial_report - second-stage requests), organizations that have not submitted a financial report against the current SAO-wide deadline.

## Pillars per role

| Role | Pillars |
|---|---|
| ADMIN | finance, events, tasks, elections, merchandise, communication |
| SBO_OFFICER | events, tasks (mine), merchandise, communication, finance (read-only) |
| DEPARTMENT_HEAD | finance, events, elections, communication (all read-only) |
| STUDENT | elections, events, merchandise (mine), tasks (mine), communication |
| SUPER_ADMIN | finance, elections, events, communication - all aggregated university-wide |

## Insights

Insights only ever read what an existing deterministic engine already
computed or persisted; this endpoint never triggers or recomputes them:

- `budget_advisory` - reads the organization's most recent `Budget.overspending_risk` / `advisory_note` already generated by `BudgetController::advice`.
- `financial_forecast` - reads the organization's latest `FinancialForecast` row (OLS trend) already generated by `FinancialForecastController::generate`.
- `task_workload_balance` - calls `TaskDelegationService::recommend()` (the same rule-based weighted scoring used for task assignment) and flags a 40+ point workload-score gap between the busiest and freest eligible officer.
- `election_turnout_pace` - reuses the turnout formula from `ElectionController::voters` (`voted_count / eligible_total`) and compares it against how much of the voting window has elapsed; flagged once 20%+ of the window has passed and turnout trails elapsed time by 15+ points.

STUDENT never sees insights (these are operational/advisory tools for people who manage the organization). SUPER_ADMIN sees only an aggregated `budget_advisory` insight (count of organizations with a high-risk budget), to keep the university-wide query bounded.

## Known schema gaps (not implemented, no table exists)

- No event RSVP/registration table exists, so "today's events I registered for" (STUDENT) is implemented as "today's events in my organization" instead.
- No `accreditation_status` / compliance column exists on `organizations`; the field is always `null` per the spec's own fallback.
- No "pending organization/admin request" queue exists - `SUPER_ADMIN` creates organizations and admin accounts directly (`SystemAdministrationController::storeOrganization` / `storeAdmin`), so that sub-item from the brief has no backing data and is omitted.
