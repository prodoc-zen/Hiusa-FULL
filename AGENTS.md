# HIUSA Repository Instructions

These instructions apply to every agent working in this repository. Read `readme2.md` for the detailed architecture and coding guide, `design.md` before UI work, and the matching `docs/*-use-case.md` before changing a business workflow.

## Temporary execution policy

- Do not spawn or invoke any tester, Browser QA, security-reviewer, reviewer, explorer, worker, or other subagent. The primary Codex agent performs work and validation directly.
- Do not run Playwright, browser E2E, Playwright discovery, or live browser automation.
- This temporary policy overrides the specialist-agent and Browser QA triggers below until the user explicitly re-enables them.

## Development ownership

The primary Codex agent owns production implementation. For meaningful coding requests:

1. Understand the requested behavior and inspect the relevant vertical slice.
2. Identify affected React, Laravel, database, and FastAPI layers.
3. Implement the smallest complete solution using existing conventions.
4. Add or update tests when behavior changes.
5. Run targeted deterministic validation.
6. Use the tester agent for meaningful behavior changes.
7. Use Browser QA, security review, or final review only when the triggers below apply.
8. Fix relevant failures, retest, and report evidence.

Never claim a test passed unless it was actually executed. Never say everything works without evidence.

## Preserve the existing project

- Inspect `git status` before editing and preserve unrelated/uncommitted user work.
- Follow existing architecture and patterns; do not redesign working systems merely because another design is possible.
- Avoid unrelated refactors, dependency upgrades, generated files, and abstractions the task does not need.
- Preserve API compatibility unless an intentional contract change is part of the request.
- Never overwrite `.env`, production credentials, or real data.
- Never run destructive Git commands or destructive database commands without explicit authorization and a verified safe target.
- Do not auto-commit. Commit only when the user asks.

## Current architecture and invariants

- `client/`: React 19, Vite 8, Tailwind CSS 4, React Router, Axios.
- `server/`: Laravel 12 JSON API, Sanctum, PHPUnit, isolated SQLite-in-memory tests.
- `ai-service/`: FastAPI deterministic decision-support engines with pytest.
- Current access roles are `ADMIN`, `SBO_OFFICER`, `DEPARTMENT_HEAD`, and `STUDENT`.
- `organization_id` is a security boundary. Scope every organization-owned query and related-record validation to the authenticated user's organization.
- `users.school_id` is the user primary key. Do not assume `users.id` exists.
- Frontend route guards do not replace backend `auth:sanctum`, `role:` middleware, ownership checks, and state-transition enforcement.
- For UI, follow `design.md`: Poppins, the exact HIUSA palette, subtle borders, compact admin layouts, accessible controls, and responsive mobile behavior.

## Cost control

- Prefer deterministic tools and targeted tests over additional model reasoning.
- Prefer focused searches over rereading the whole repository.
- Normally use no more than one specialist agent at a time; configured spawned concurrency is at most two.
- Parallel agents are for genuinely independent, read-heavy work. Never use multiple write-heavy agents on the same files.
- Do not use Browser QA when browser behavior did not change.
- Do not run security review for cosmetic changes or final review for tiny changes.
- Do not run full E2E after every trivial edit and do not enable Fast mode automatically.

## Specialist-agent triggers

### Tester

Use `.codex/agents/tester.toml` after meaningful API, CRUD, calculation, business-logic, form, authentication, workflow, or database-backed behavior changes. Give it a focused summary and relevant files/tests. Do not use it for comments, README-only edits, trivial wording, or formatting-only changes.

### Browser QA

Use deterministic Playwright checks after meaningful user-facing changes to login, recovery, forms, modals, navigation, approvals, ordering, dashboards, uploads, role-based interfaces, or other API-connected workflows. Do not use live interactive browser control by default; use it only when the user explicitly requests a live browser session or deterministic checks cannot validate the issue. Do not use Browser QA for backend-only refactoring. Browser QA validates and reports; it does not fix production code.

### Security reviewer

Use `.codex/agents/security_reviewer.toml` for changes involving authentication, authorization, roles, sessions/tokens, passwords, admin actions, permissions, financial data, transactions, receipts, uploads, sensitive data, elections/voting, ownership, organization isolation, or security middleware. It is read-only; the primary agent fixes findings.

### Final reviewer

Use `.codex/agents/reviewer.toml` for large, cross-module, release-critical, database, major API, authentication/authorization, financial-workflow, or significant refactoring changes. Do not invoke it for trivial edits. It is read-only.

## Deterministic validation commands

Prefer a focused test first. Broaden validation when the change is cross-cutting or release-critical.

```powershell
# Frontend unit tests
Set-Location client
npm run test:unit

# Frontend focused unit test
npm run test:unit -- src/path/to/file.test.jsx

# Frontend lint/build
npm run lint
npm run build

# Browser E2E (Chromium)
npm run test:e2e

# Laravel focused/full tests
Set-Location server
php artisan test --filter=RelevantTest
php artisan test --stop-on-failure

# FastAPI tests
Set-Location ai-service
.\.venv\Scripts\python.exe -m pytest
```

Tests must never use production services or cause real email, payment, notification, transaction, order, vote, or other external side effects.

## API contract policy

Whenever an API contract changes:

1. Find all frontend consumers.
2. Confirm HTTP method, route, authentication, and authorization.
3. Confirm request fields, response fields, status codes, and Laravel `422` validation shape.
4. Update frontend service/page and backend route/controller intentionally together.
5. Add tests for the affected contract and important role boundaries.

Do not change backend JSON fields without checking React consumers. Do not change frontend assumptions without checking Laravel.

## Database and authorization policy

Before schema changes, inspect migrations, models, relationships, foreign keys, and existing data assumptions. Add a new forward migration with a viable rollback; do not rewrite migration history. Preserve data unless explicitly instructed otherwise and test only in an isolated environment.

For every role-sensitive feature, test server-side authorization. Hiding a React control is not authorization. Meaningful tests should cover the successful case, validation failure, unauthorized/forbidden case, organization or ownership boundary, and important state/edge case where applicable.

## Completion and reporting

A meaningful request is complete only when requested behavior is implemented, relevant checks were executed, failures are fixed or explicitly disclosed, error handling and authorization were considered, database integrity and API alignment remain intact, and no debug or unrelated production changes remain.

Final responses for meaningful coding work must use:

```text
IMPLEMENTED:
- ...

TESTS ACTUALLY EXECUTED:
- exact command -> PASS/FAIL

BROWSER QA:
- performed / not applicable / blocked

SECURITY REVIEW:
- performed / not applicable

REVIEW:
- performed / not necessary

REMAINING LIMITATIONS:
- none / ...
```

The Stop hook in `.codex/hooks/qa-gate.mjs` provides a final lightweight deterministic gate. On failure it permits one automatic repair continuation only; a second failure stops the loop and reports the evidence.
