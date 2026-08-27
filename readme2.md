# HIUSA Agent Coding Guide

This file is the operating guide for any coding agent working in this repository. Read it before planning or changing code. HIUSA is a working, organization-scoped student governance platform; extend the existing product instead of replacing it with a generic template.

## 1. Source-of-truth order

When documents disagree, use this order:

1. The user's current request and acceptance criteria.
2. The current implementation: routes, controllers, models, migrations, tests, React routes, and service files.
3. The use-case document for the feature in `docs/`.
4. `HIUSA_System_Flow.md` for end-to-end business flow and known schema differences.
5. `design.md` for visual rules. This is the visual source of truth.
6. `architecture.md`, `README.md`, and the service READMEs for orientation and setup.
7. `CLAUDE.md` for useful historical conventions. Its old implementation plan and any stale directory or role descriptions are not current requirements.

Do not blindly implement “planned” items from an old document. Confirm that they are part of the current request and are not already implemented differently.

## 2. What this repository contains

HIUSA is a decoupled monorepo with three runtime services:

```text
Hiusa-FULL/
├── client/                     React 19 + Vite 8 + Tailwind CSS 4
│   ├── src/assets/             Brand images, including Hiusa Logo.png
│   ├── src/components/         Shared UI and layout components
│   ├── src/pages/auth/         Login, organization selection, recovery
│   ├── src/pages/modules/      Feature pages grouped by domain
│   ├── src/pages/roles/        Role-specific home/dashboard pages
│   ├── src/services/           Axios API adapters by domain
│   ├── src/utils/              Shared client helpers
│   ├── src/App.jsx             Lazy-loaded route tree and role guards
│   └── src/index.css           Global CSS, Poppins, and Tailwind theme
├── server/                     Laravel 12 JSON API (PHP 8.2+)
│   ├── app/Http/Controllers/   Request validation and application workflows
│   ├── app/Http/Middleware/    Authentication/role enforcement helpers
│   ├── app/Models/             Eloquent models and relationships
│   ├── app/Services/           Cross-controller integrations/workflows
│   ├── app/Console/Commands/   Scheduled maintenance/reminder commands
│   ├── database/migrations/    Executable schema history
│   ├── database/seeders/       Demo and development data
│   ├── routes/api.php          API endpoints and server-side role matrix
│   └── tests/Feature/          API, workflow, authorization, and integration tests
├── ai-service/                 FastAPI decision-support service (Python 3.11+)
│   ├── app/engines/            Pure deterministic calculation engines
│   ├── app/schemas.py          Pydantic request/response contracts
│   ├── app/main.py             HTTP endpoints and service-key authentication
│   └── tests/                  Pytest engine/contract tests
├── docs/                       Current feature use cases and dev logs
├── docs2/                      Reference Word documents; not executable truth
├── scripts/setup-env.ps1       Local environment bootstrap
├── design.md                   Required visual system
├── architecture.md             Architectural overview; verify against live code
├── HIUSA_System_Flow.md        Business flows and alignment notes
└── README.md                   Human local-setup instructions
```

Do not edit generated or local-only directories such as `node_modules/`, `vendor/`, `.venv/`, `.pytest_cache/`, build output, runtime logs, or cache files.

## 3. Core domain rules

### Organization isolation

HIUSA is multi-organization. `organization_id` is a security boundary, not merely a filter.

- Scope every organization-owned read, update, and delete to the authenticated user's `organization_id`.
- Set `organization_id` from the authenticated user on create. Do not trust a client-supplied organization ID.
- Scope related-record validation too. A valid ID from another organization must not be accepted.
- Prefer a scoped lookup that returns `404` rather than revealing that another organization's record exists.
- Add a cross-organization denial test whenever a new endpoint touches organization-owned data.

### Access-control roles

The current application roles are exactly:

- `ADMIN`
- `SBO_OFFICER`
- `DEPARTMENT_HEAD`
- `STUDENT`

Organizational titles such as President or Treasurer belong in `position_title`; they are not new authorization roles. Enforce access in `server/routes/api.php` with the `role:` middleware and enforce ownership/state rules again in the controller where needed. Frontend guards improve navigation but never replace backend authorization.

When changing permissions, update all affected layers together:

- `server/routes/api.php`
- controller ownership and state checks
- `client/src/App.jsx`
- `client/src/components/layout/Sidebar.jsx`
- relevant use-case/role-matrix tests

### Authentication and identity

- Laravel Sanctum bearer tokens are stored as `auth_token` in `localStorage`.
- The stored user object uses the key `user`.
- `client/src/services/api.js` owns base-URL resolution, bearer injection, and common 401/403/422/5xx behavior.
- `users.school_id` is the primary key. The `User` model exposes it as `id`; do not assume an auto-incrementing `users.id` column exists.
- Passwords use the model's `password_hash` field and hashing cast. Never expose it in API responses.
- Keep login, reset, and other sensitive public routes rate-limited.

### Workflow integrity

Events, budgets, elections, orders, tasks, attendance, and approvals have state transitions and role-specific rules. Do not implement status changes as unrestricted field updates.

- Read the matching file in `docs/` before changing a feature.
- Preserve approval requirements and legal state transitions.
- Validate dates, enum/status values, quantities, stock, balances, duplicate votes, and ownership on the server.
- Use database transactions for multi-record operations that must succeed or fail together.
- Add database constraints or indexes through a new migration when integrity depends on them.
- Never rewrite an old migration that may already have run. Create a new forward migration with a working `down()` method.
- Treat `hiusa_db_original_plus_minimal_patch.sql` as a reference artifact, not the migration source of truth.

## 4. Frontend conventions

### Placement and data flow

- Put route-level views under `client/src/pages/auth`, `pages/roles`, or the matching `pages/modules/<domain>` folder.
- Put reusable shell UI in `components/layout`, election-specific shared UI in `components/elections`, and truly reusable controls in `components` (or a focused subfolder when multiple related components justify it).
- Register pages with lazy imports in `client/src/App.jsx` and apply the correct `ProtectedRoute allowedRoles` guard.
- Update `Sidebar.jsx` when a user-visible route is added or renamed.
- Put network calls in `client/src/services/<domain>Service.js`; pages should not create ad hoc Axios instances or duplicate token logic.
- Use helpers from `client/src/utils` for API errors, asset URLs, and date/time formatting before creating alternatives.
- Follow the existing API response shape. Handle Laravel pagination objects when an endpoint is paginated.

### Page behavior

Every data-backed screen must deliberately handle:

- initial loading
- successful content
- empty results
- validation errors (`422`)
- forbidden actions (`403`)
- server/network failures
- destructive-action confirmation where appropriate
- success or failure feedback after mutations

Do not ship mock data or placeholder UI for a feature that has a real API. Avoid sequential independent requests when `Promise.all()` is suitable. Prevent duplicate submissions and keep button disabled/loading states understandable.

### React style

- Use functional components and hooks.
- Match the existing JavaScript/JSX style; do not introduce TypeScript as part of an unrelated change.
- Keep state close to where it is used and derive values instead of duplicating them in state.
- Extract a component when it is reused or when doing so makes a large page materially clearer; do not create abstraction layers for one trivial use.
- Use stable identifiers for React keys, not array indexes when records have IDs.
- Keep comments for non-obvious reasons, browser quirks, or business constraints—not narration of the code.

## 5. Required visual system

Before UI work, read `design.md` and inspect nearby implemented pages/components. Preserve the current visual language.

### Fixed tokens

| Token | Value | Main use |
|---|---:|---|
| Primary Blue | `#0B8ED0` | Primary actions, links, active navigation |
| Primary Hover | `#0878B7` | Primary hover state |
| Electric Cyan | `#16C7F3` | Focus rings and small accents |
| Deep Navy | `#0B1831` | Sidebar and primary dark structure |
| Dashboard Navy | `#0F2F62` | Secondary dark panels |
| Page Background | `#EEF6FB` | Main application background |
| Surface | `#FFFFFF` | Forms, tables, cards, modals |
| Border | `#DDE7EF` | Inputs, cards, dividers |
| Strong Text | `#0F172A` | Titles and primary values |
| Muted Text | `#64748B` | Descriptions and metadata |
| Soft Text | `#94A3B8` | Placeholders and low-emphasis text |
| Success | `#16A34A` | Approved/completed states |
| Warning | `#F59E0B` | Pending/review states |
| Danger | `#DC2626` | Destructive/failed states |

Use Poppins everywhere. Use `lucide-react` for interface icons and the real `client/src/assets/Hiusa Logo.png` for branding. Do not recreate or alter the logo.

### Layout and component rules

- Use the 8px spacing rhythm: 4, 8, 12, 16, 20, 24, and 32px.
- Desktop content padding is 24px; tablet 16px; mobile 14–16px.
- Inputs and primary buttons are about 44px high; mobile touch targets must be at least 42px.
- Inputs/buttons use 6–8px radii; cards/panels use 8px; badges may be pills.
- Prefer subtle borders and no shadow or `shadow-sm`.
- Keep one visually dominant primary action per form or page header.
- Data tables should be dense, readable, and responsive through stacked rows or intentional horizontal scrolling.
- Mobile pages must not create page-level horizontal overflow.
- Use visible labels, focus styles, text plus color for statuses, real buttons, and `aria-label` on icon-only controls.

Do not add decorative stripes, excessive gradients, glow effects, huge marketing text, nested cards, random blue shades, excessive cyan, playful decoration, or generic dashboard templates. Do not use Inter, Roboto, or another substitute font.

## 6. Laravel API conventions

- Keep endpoint declarations in `server/routes/api.php`; protected business routes belong inside `auth:sanctum`.
- Use the narrowest correct `role:` middleware list.
- Validate every create/update payload with Laravel validation before persistence.
- Keep REST behavior consistent: `GET` read, `POST` create/action, `PUT` replace/update, `PATCH` focused state change, and `DELETE` remove.
- Return meaningful status codes: `201` create, `401` unauthenticated, `403` forbidden, `404` scoped record absent, `409` state conflict, and `422` invalid input/business transition.
- Keep client-facing error messages actionable without exposing stack traces, SQL, secrets, or cross-organization data.
- Use Eloquent relationships and eager loading to avoid N+1 queries.
- Add pagination for lists that can grow, and keep the frontend contract synchronized.
- Put reusable cross-controller integrations/workflows in `app/Services`; keep simple request-specific orchestration in controllers.
- Follow existing PHP formatting and run Laravel Pint on changed PHP files when appropriate.

When adding a domain capability, update the complete vertical slice: migration/model relationship, controller, API route and middleware, frontend service, page/route/navigation, and tests.

## 7. FastAPI decision-support conventions

The Python service is for deterministic calculation/decision-support logic. Laravel remains the system of record and the browser should communicate with Laravel, not call FastAPI directly.

- Define request/response contracts in `ai-service/app/schemas.py` with explicit Pydantic bounds.
- Put calculation logic in pure functions under `ai-service/app/engines/` so it can be tested without HTTP.
- Expose endpoints in `ai-service/app/main.py` under `/api/v1`.
- Protect non-health endpoints with `X-AI-Service-Key` when a key is configured.
- Keep `HIUSA_AI_SERVICE_KEY` identical in Laravel and Python environments; never commit its real value.
- Update Laravel's `HiusaAiService` adapter and its integration tests whenever a Python contract changes.
- Preserve Laravel's safe deterministic fallback unless the requested architecture explicitly changes it.
- Keep Groq credentials and Groq calls in Laravel's server-side integration. Never expose provider keys to React.
- Avoid nondeterministic output for calculations that must be auditable.

## 8. Security checklist for every feature

Before declaring work complete, verify:

- authentication is required where appropriate
- the route has the correct server-side roles
- organization-owned queries are scoped
- record ownership and state transitions are enforced
- client input is validated server-side
- mass-assignment fields are intentional
- secrets and sensitive fields are not returned or logged
- uploaded/linked assets and rendered text cannot introduce unsafe content
- duplicate requests cannot violate votes, stock, approvals, balances, or attendance integrity
- error messages do not reveal another organization's data

Never commit `.env` files, tokens, API keys, database files containing private data, or local logs.

## 9. Testing and verification

Use the smallest focused checks while developing, then run the relevant service suite for a completed cross-cutting change.

### Frontend

```powershell
Set-Location client
npm run lint
npm run build
```

If Playwright tests are available and the change affects a user flow, run the relevant spec with the local services configured:

```powershell
Set-Location client
npx playwright test e2e/<relevant-spec>.spec.js
```

### Laravel

```powershell
Set-Location server
php artisan test --filter=<RelevantTest>
```

For a completed backend or cross-cutting change:

```powershell
Set-Location server
php artisan test
```

Tests use an isolated test database. Never point tests or destructive migration commands at production or at a database whose data must be preserved.

### FastAPI

```powershell
Set-Location ai-service
python -m pytest
```

For full-stack UI changes, also perform a browser click-through at mobile and desktop sizes. Confirm the correct role can use the flow and at least one disallowed role cannot. Report exact commands and outcomes; do not claim a test passed unless it was run successfully.

## 10. Agent workflow

### Before editing

1. Read this file, `design.md` for UI work, and the matching `docs/*-use-case.md`.
2. Inspect `git status` and preserve unrelated user changes.
3. Trace the existing vertical slice: React route/page/service → Laravel route/controller/model → migration/tests → Python adapter/contract if applicable.
4. State assumptions only when the code and docs cannot resolve them.

### While editing

1. Make the smallest coherent change that completes the request.
2. Reuse established patterns and utilities before adding new ones.
3. Keep frontend and backend contracts synchronized.
4. Add or update focused tests with the production change.
5. Avoid unrelated formatting, dependency upgrades, and refactors.

### Before handing off

1. Review the diff for secrets, debug code, mock data, generated files, and unrelated changes.
2. Run the relevant lint/build/tests.
3. Verify organization scoping, permissions, responsive layout, empty/error states, and accessibility.
4. Summarize changed files, behavior, test evidence, and any genuine remaining risk.

Do not reset, overwrite, or delete another contributor's uncommitted work. Do not run `migrate:fresh`, delete databases, or perform destructive Git operations unless the user explicitly asks and the exact target is verified.

## 11. Definition of done

A feature is done only when:

- the requested behavior works end to end
- permissions and organization isolation are correct
- server validation and workflow rules are enforced
- loading, empty, success, validation, forbidden, and failure states are covered where relevant
- the UI follows `design.md` and works on mobile and desktop
- client/server/Python contracts agree
- focused regression tests exist and relevant checks pass
- no secrets, logs, generated output, or unrelated edits were introduced
- documentation is updated when setup, contracts, roles, or business behavior changed

## 12. Git conventions

Do not commit unless the user asks. If asked, use a concise conventional prefix such as `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, or `chore:`. Do not add an AI model as a co-author. Before committing, inspect the staged diff and include only files belonging to the requested change.
