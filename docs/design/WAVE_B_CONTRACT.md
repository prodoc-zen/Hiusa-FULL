# Wave B contract

Binding for every Wave B builder. It fixes routes, roles, file ownership and API shapes so builders can work in parallel without touching each other's files. Read with `docs/design/ELEVATION_SPEC.md` (the design contract), `docs/USE_CASE_INVENTORY.md` (use cases, states S-01..S-16, edge cases), `PRODUCT.md`, and the craft floor at `C:/Users/JM/.claude-alt/skills/impeccable/reference/craft-floor.md`.

## Ground rules

- Build only with the kit: `client/src/components/ui/*` (import from `components/ui`), `client/src/components/charts/*`, `client/src/lib/format.js`, `client/src/lib/pillars.js`, `client/src/lib/notify.js`. Open `/dev/ui-kit` (dev server) to see every component in every state. Do not hand-roll a button, input, badge, table, skeleton or empty state.
- Every screen ships S-01..S-16: first-run empty with a next action, animated skeleton loading (never "Loading..." text), success feedback via `notify`, inline field errors, server error with retry, permission denied, mobile 390px and desktop 1440px, keyboard-only, visible focus, reduced motion.
- Voice: controls name their action; empty states say what the thing is and what to do next; errors name the problem and the recovery; money via `peso()`; dates via `manilaDate()` / `relativeTime()`.
- No new npm dependencies. No edits to `client/src/App.jsx` (the integration step wires routes). Only the shell slice edits `client/src/components/layout/*`.
- Services: one file per domain under `client/src/services/`, using the default export of `services/api.js` (`import api from './api'`; there is NO named `api` export). Return the axios promise; pages handle errors.
- Tests: vitest + testing-library for each page and service: loading skeleton, empty, error with retry, success, and role-specific visibility. Mock services, not axios internals.
- Build output: run `npx vite build --outDir <your scratch folder>/dist` (never the shared `client/dist`) so parallel builders do not collide.
- Git: other builders share this working tree. Commit only by exact paths, retry on `index.lock`, prefix `feat(<area>):`, end every message with exactly `Co-Authored-By: John Carlo Borgueta <johncarloborgueta@gmail.com>` and no AI attribution. Do not push. No em dashes anywhere.

## Collaborator work to build on, not around (merged 2026-09-29, commit 156c7b2)

The collaborator is actively shipping. Preserve their features and structure; extend them. Never delete, rename or restructure their components, and never revert their decisions. Where a Wave B page overlaps theirs, compose their pieces into the new layout.

- `AdminHomePage.jsx` was rewritten on the new `AdminDashboardController` (`services/adminDashboardService.js`), with `components/users/ClassListImportPanel.jsx` (bulk class-list import) and `components/users/SectionDistributionChart.jsx`. The ADMIN briefing must keep every capability of that page (import panel, section distribution, whatever else it shows), adding the briefing parts around it.
- New pages exist: `pages/roles/super-admin/SystemCollegesPage.jsx` (`super-admin/colleges`, SUPER_ADMIN), `pages/modules/finance/FinancialCollectionsPage.jsx` (`finance/collections`, ADMIN). The shell nav must include them.
- New components to reuse where relevant: `components/events/PersonalAttendanceSummary.jsx` (a student's own attendance), `components/receipts/ReceiptDocument.jsx`, `components/users/UserIdentityCard.jsx` (user photos now exist: prefer photos over initials in Avatar where available).
- They edited `components/layout/Sidebar.jsx`, `TopBar.jsx`, `DashboardLayout.jsx`, `ConfirmModal.jsx`, `Modal.jsx` and `index.css`: read their current versions first and keep their changes.
- Merchandise claim tokens now route by role (`MerchandiseClaimTokensRoute` in App.jsx); GCash settings redirect into manage orders.

## New client routes (wired by the integration step, not by page builders)

All paths are under `/dashboard`. Page file paths are fixed so the integration step can import them.

| Path | Roles | Page file (default export) |
|---|---|---|
| `super-admin/compliance` | SUPER_ADMIN | `pages/modules/sao/SaoCompliancePage.jsx` |
| `super-admin/venues` | SUPER_ADMIN | `pages/modules/venues/SaoVenuesPage.jsx` |
| `super-admin/grievances` | SUPER_ADMIN | `pages/modules/grievances/SaoGrievancesPage.jsx` |
| `super-admin/clearances` | SUPER_ADMIN | `pages/modules/clearances/SaoClearancesPage.jsx` |
| `super-admin/evaluation` | SUPER_ADMIN | `pages/modules/evaluation/SaoEvaluationPage.jsx` |
| `compliance` | ADMIN | `pages/modules/sao/OrganizationCompliancePage.jsx` |
| `venues` | ADMIN, SBO_OFFICER | `pages/modules/venues/VenueBookingPage.jsx` |
| `grievances` | ADMIN | `pages/modules/grievances/OrganizationGrievancesPage.jsx` |
| `my-grievances` | STUDENT | `pages/modules/grievances/StudentGrievancesPage.jsx` |
| `clearances` | ADMIN, SBO_OFFICER | `pages/modules/clearances/SignatoryClearancesPage.jsx` |
| `my-clearance` | STUDENT | `pages/modules/clearances/StudentClearancePage.jsx` |
| `evaluation` | ADMIN, SBO_OFFICER, DEPARTMENT_HEAD, STUDENT | `pages/modules/evaluation/EvaluationPage.jsx` |
| `objectives` | all five roles | `pages/modules/objectives/StudyObjectivesPage.jsx` |

Role home pages keep their existing paths and files: `super-admin` (`pages/roles/super-admin/SuperAdminHomePage.jsx`), `admin` (`pages/roles/admin/AdminHomePage.jsx`), `officer` (`pages/roles/officer/DashboardPage.jsx`), `department-head` (`pages/roles/department-head/DepartmentHeadHomePage.jsx`), `student` (`pages/roles/student/StudentHomePage.jsx`).

## Sidebar sections (owned by the shell slice)

Group navigation by the six study areas plus governance, per role, using `lib/pillars.js` icons. New entries per role:

- SUPER_ADMIN: Governance group: Organizations, Colleges, Admins, Compliance, Venues, Grievances, Clearances, Evaluation, Event requirements, Financial reports, University announcements, Notifications; plus Study objectives.
- ADMIN: add Finance collections (existing route), Compliance, Venues, Grievances, Clearances, Evaluation, Study objectives.
- SBO_OFFICER: add Venues, Clearances, Evaluation, Study objectives.
- DEPARTMENT_HEAD: add Evaluation, Study objectives.
- STUDENT: add My grievances, My clearance, Evaluation, Study objectives.

## Server endpoints the pages consume

Read the controller for exact shapes before building; do not guess.

- Dashboard briefing: `GET /dashboard/briefing` (all roles). Contract: `docs/api/dashboard-briefing.md`. Hrefs may be null when the role cannot open a route; render such items without a link.
- Evaluation (`EvaluationController`): `GET /evaluation/current`; `POST /evaluation/responses` (consent required, 409 if already answered); `GET /evaluation/results?evaluation_window_id=&organization_id=&respondent_type=` (window defaults to the latest closed one; open windows return counts only; groups under the anonymity threshold, or where the viewer is one of too few respondents, return counts only with an explanatory flag); `GET /evaluation/results/export` (CSV); `GET|POST /evaluation/windows`, `PATCH /evaluation/windows/{id}` (SUPER_ADMIN; a closed window's status cannot change).
- Compliance (`ComplianceController`): `GET|POST /compliance/requirement-types`, `PUT /compliance/requirement-types/{id}`, `GET /compliance/status`, `GET /compliance/submissions`, `POST /compliance/submissions` (multipart upload), `PATCH /compliance/submissions/{id}/review`, `GET /compliance/submissions/{id}/document`.
- Venues (`VenueController`, `VenueBookingController`): `GET|POST /venues`, `PUT|DELETE /venues/{id}`, `GET /venues/{id}/availability?from=&to=`, `GET /venue-bookings?from=&to=`, `POST /venue-bookings`, `PATCH /venue-bookings/{id}/review`, `PATCH /venue-bookings/{id}/withdraw`.
- Grievances (`GrievanceController`): `GET /grievances?status=&urgency=&category=&addressed_to=`, `GET /grievances/{id}`, `POST /grievances` (STUDENT), `PATCH /grievances/{id}/status` (SUPER_ADMIN, or ADMIN for grievances addressed to its own org). Anonymous filers are never identified to an org ADMIN; the UI must never try to show an identity the API withholds.
- Clearances (`ClearanceController`): `GET|POST /clearance-periods`, `GET /clearance-periods/{id}/students?q=&page=`, `GET /clearances/mine`, `GET /clearance-signatures`, `PATCH /clearance-signatures/{id}` (sign, hold with reason, clear a hold).
- Study objectives: `GET /objectives/overview` (all roles; built in Wave B by the server slice, shape below).

## `GET /objectives/overview` shape

Organization-scoped for every role except SUPER_ADMIN (university-wide). Evidence is counted from real records only; zero is reported as zero, never padded.

```json
{
  "scope": { "type": "organization|university", "organization": { "id": 1, "name": "..." } },
  "objectives": [
    {
      "code": "GO|SO1|SO2.1|SO2.2|SO2.3|SO2.4|SO2.5|SO2.6|SO3|SO4",
      "title": "short title",
      "statement": "objective text from the paper",
      "mechanism": "the mechanism the paper names, e.g. OLS regression forecasting",
      "status": "live|partial|no_data",
      "evidence": [ { "label": "Forecasts generated", "value": 12, "unit": "count|php|percent|null", "href": "/dashboard/finance/financial-insights or null" } ],
      "last_activity_at": "ISO 8601 or null"
    }
  ]
}
```

Hrefs follow `config/client_routes.php` for the viewer's role (null when not allowed).
