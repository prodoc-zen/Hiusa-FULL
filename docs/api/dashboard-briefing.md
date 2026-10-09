# GET /api/dashboard/briefing

Role-aware briefing endpoint. Every role's home screen (Section 6 of
`docs/design/ELEVATION_SPEC.md`) is fed by this single endpoint instead of
building its own bespoke set of calls.

- Middleware: `auth:sanctum`, `throttle:api-read`, `role:SUPER_ADMIN,ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT`
- Controller: `App\Http\Controllers\DashboardBriefingController`
- Assembly: `App\Services\Dashboard\DashboardBriefingService`
- Insights: `App\Services\Dashboard\DashboardInsightEngine`
- Href gating: `App\Services\Dashboard\ClientRouteAccess` against `config/client_routes.php`
- Accreditation: `App\Services\Compliance\AccreditationStatusService`

Strictly organization-scoped for every role except `SUPER_ADMIN`, who is the
one university-wide "SAO Director" account and sees every non-SAO
organization. Money is returned as plain numbers (never formatted strings);
timestamps are ISO 8601.

Every `href` in this response is resolved through `ClientRouteAccess::hrefFor(
$role, $path)` against `config/client_routes.php`, the single source of which
client route paths each role may open, built to match `client/src/App.jsx`'s
`<ProtectedRoute allowedRoles=[...]>` declarations exactly (`ClientRouteAllowlistTest`
fails the suite the moment the two disagree). A role that cannot open a page
gets `href: null` for that item instead of a link into a 403. The config file
also carries a `pending_client` list of finance pages decided for
SBO_OFFICER/DEPARTMENT_HEAD ahead of the client route guards catching up, but
those paths are never resolvable through `hrefFor` - they come back `null`
for every role until the matching route lands in App.jsx and moves out of
`pending_client` into that role's live list.

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
      "href": "/dashboard/approvals",
      "type_total": 23 // optional, see below
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
      "accreditation_status": "pending_review", // not_applicable | incomplete | returned | pending_review | accredited - AccreditationStatusService, same computation ComplianceController::status() uses
      "budget_utilization_percent": 63.7,
      "financial_reports_pending": 1,
      "open_elections": 1,
      "last_activity_at": "2026-09-20T08:00:00+00:00" // or null
    }
  ]
}
```

## Attention item `type_total`

Each attention builder lists at most 8 rows, so a long queue would otherwise be
under-reported. When a builder fills its 8 rows, the real size of that queue is
counted once with a separate query and carried on every item of that `type` as
`type_total` (an integer, at least 8). The key is absent on the items of a
queue that is not full, because then the number of items already is the total.
Items that stand for several records at once carry a `count` instead, and
`summary.headline` weighs each type as the larger of the sum of its `count`
values (1 for an item without one) and its `type_total`. A client that shows a
queue size should read `type_total` when present, else the number of items of
that `type` in `attention`. After the final sort and cut to 8 items, `attention`
may hold fewer items of a type than `type_total`; the headline uses the full
figure, while `summary.attention_count` is only the number of items returned.

## Attention items per role

- **ADMIN**: pending approvals requiring ADMIN action (announcement, payment), elections closing within 72h, budgets at/above 80% utilization, overdue tasks, financial reports returned or due against the SAO-wide submission deadline.
- **SBO_OFFICER**: orders with a submitted payment proof still awaiting officer review, my tasks overdue or due within 3 days, today's events (attendance still to record).
- **DEPARTMENT_HEAD**: approval requests awaiting my decision (event, election, financial_report - first-stage requests), ordered oldest first so age is implicit in position/severity.
- **STUDENT**: the active election I have not voted in yet, my orders ready to claim, my tasks overdue or due within 3 days, today's events.
- **SUPER_ADMIN**: approval requests requiring SUPER_ADMIN action (budget, financial_report - second-stage requests), organizations that have not submitted a financial report against the current SAO-wide deadline, plus SAO queue counts: pending venue bookings (`type: venue_bookings_pending`), compliance submissions awaiting review (`compliance_submissions_pending`), unresolved high/critical urgency grievances by count only, never identity (`grievances_urgent`), and pending SAO clearance signature lines (`clearance_sao_pending`).

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
- `task_workload_balance` - groups each eligible SBO officer's active task count in a single query (`DashboardInsightEngine::taskWorkloadBalance`) and flags a 40+ point workload-score gap between the busiest and freest officer. Does not call `TaskDelegationService::recommend()` - that runs a full position-fit/workload/performance scoring pass per officer meant for delegation suggestions, not this imbalance check, and doing so here cost 2 + 3×officers queries.
- `election_turnout_pace` - reuses the turnout formula from `ElectionController::voters` (`voted_count / eligible_total`) and compares it against how much of the voting window has elapsed; flagged once 20%+ of the window has passed and turnout trails elapsed time by 15+ points.

Every insight's `href` is also gated per role (see above), so e.g. an
SBO_OFFICER's `task_workload_balance` insight - whose natural link is the
ADMIN-only `/dashboard/tasks/task-board` - comes back with `href: null`
rather than a link they cannot open.

STUDENT never sees insights (these are operational/advisory tools for people who manage the organization). SUPER_ADMIN sees only an aggregated `budget_advisory` insight (count of organizations with a high-risk budget), to keep the university-wide query bounded.

## Activity feed

`activity` is never a blanket audit dump. Only `ADMIN` (their own
organization) and `SUPER_ADMIN` (university-wide, no organization filter) get
the org-level `audit_logs` stream, and even then the `grievances` module is
excluded for everyone except `SUPER_ADMIN` - a grievance filer's identity
must never reach this feed, matching the same rule `GET /audit-logs`
enforces. `SBO_OFFICER`, `DEPARTMENT_HEAD` and `STUDENT` instead get only
their own recent actions (`audit_logs.user_id = me`, `grievances` excluded
even from their own actions) merged with safe public items: recently
published announcements and recently approved events. An earlier version of
this endpoint handed SBO_OFFICER and DEPARTMENT_HEAD the org's full audit
stream, including grievance filings; this scoping replaced that.

## Known schema gaps (not implemented, no table exists)

- No event RSVP/registration table exists, so "today's events I registered for" (STUDENT) is implemented as "today's events in my organization" instead.
- No "pending admin request" queue exists - `SUPER_ADMIN` creates organization Admin accounts directly (`SystemAdministrationController::storeAdmin`), so that sub-item from the brief has no backing data and is omitted. Organizations are no longer created by the SAO: a Department Head registers one (`POST /api/college/organizations`) and the SAO reviews it (`PATCH /api/system/organizations/{organization}/review`).
