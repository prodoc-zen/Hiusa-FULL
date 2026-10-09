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

An `href` may carry a query so it lands on a tab or a record, for example
`/dashboard/super-admin/compliance?tab=review`. `hrefFor` checks the path
before the first `?` against the role's allowlist and returns the whole string
with the query intact. The query is only kept when every parameter is one of
`tab`, `status`, `view`, `record`, `review`, `event`, `organization`, `create`,
`new` and every value matches `[A-Za-z0-9_-]{1,64}`; anything else, including a
forbidden path, makes the whole `href` `null`.

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
      "accreditation_status": "pending_review", // not_applicable | incomplete | returned | pending_review | accredited - AccreditationStatusService, same computation ComplianceController::status() uses
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
- **DEPARTMENT_HEAD**: approval requests awaiting my decision (event, election, financial_report - first-stage requests), ordered oldest first so age is implicit in position/severity. Also, scoped to the head's college only: one item per organization whose registration the SAO returned (`type: registration_returned`, title `Registration returned: <organization name>`, detail is the SAO's remarks, link `/dashboard/department-head/organizations?status=returned`), and one per active organization that has no active administrator yet (`type: organization_awaiting_admin`, title `Organization approved: waiting for an administrator`, link `/dashboard/department-head/organizations?status=active`).
- **STUDENT**: the active election I have not voted in yet, my orders ready to claim, my tasks overdue or due within 3 days, today's events.
- **SUPER_ADMIN**: approval requests requiring SUPER_ADMIN action (budget, financial_report - second-stage requests; a `financial_report` request links `/dashboard/super-admin/compliance?tab=financial` and an `event` request `?tab=events`, others the compliance home), organizations that have not submitted a financial report against the current SAO-wide deadline (`/dashboard/super-admin/compliance?tab=financial`), plus SAO queue counts: student organization registrations awaiting review (`type: registrations_pending`, `lifecycle_status = pending`, link `/dashboard/super-admin/organizations?status=pending`), pending venue bookings (`type: venue_bookings_pending`), compliance submissions awaiting review (`compliance_submissions_pending`, link `/dashboard/super-admin/compliance?tab=review`), unresolved high/critical urgency grievances by count only, never identity (`grievances_urgent`), and pending SAO clearance signature lines (`clearance_sao_pending`).

## Setup checklist

`setup` is `null` or `{ "completed": 1, "total": 3, "steps": [...] }`. Each step
is checked from real records, never from clicks:

```jsonc
{
  "key": "register",
  "label": "Register your first student organization",
  "detail": "Each organization you register goes to the Student Affairs Office for review.",
  "done": false,
  "href": null, // gated like every other href; always null once done
  "blocked": true, // optional, present only while the step cannot be acted on
  "note": "Waiting for the SAO to open the semester" // present with blocked; who the step waits for
}
```

A blocked step never has an `href`. `blocked` and `note` are absent on every
step that is not blocked.

| Role | Step keys |
|---|---|
| SUPER_ADMIN | `academic-year`, `college-heads` (every active college has an active Department Head; links `/dashboard/super-admin/colleges`), `admins`, `requirements`, `venues`, `announcement` |
| ADMIN | `positions`, `members`, `academic`, `compliance` (only once the SAO has published requirements), `budget`, `event` |
| DEPARTMENT_HEAD | `register` (done when the college has any student organization; blocked while no semester is active), `follow` (done when none is pending or returned and at least one is active; links `?status=returned` or `?status=pending` on the head's organizations page while one is), `review` (done once the head has reviewed any approval request) |
| STUDENT, SBO_OFFICER | `contact`, `fingerprint`, and for students `event` |

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
- No "pending organization/admin request" queue exists - `SUPER_ADMIN` creates organizations and admin accounts directly (`SystemAdministrationController::storeOrganization` / `storeAdmin`), so that sub-item from the brief has no backing data and is omitted.
