# Codex Autonomous Development Setup

## Detected stack

- Frontend: React 19, Vite 8, Tailwind CSS 4, npm, ESLint, Vitest, React Testing Library.
- Backend: Laravel 12 on PHP 8.2+, Composer, Sanctum, PHPUnit.
- Database: MySQL or SQLite for development; isolated SQLite `:memory:` in `server/phpunit.xml` for tests.
- Decision support: FastAPI/Pydantic on Python 3.11+, pytest.
- Browser QA: Playwright Test, Chromium only by default.
- CI: no active repository-root workflow was changed by this setup.

## Agent architecture

```text
Primary Codex
  -> targeted deterministic tests
  -> Tester for meaningful behavior
  -> Browser QA for meaningful UI workflows
  -> Security reviewer for sensitive changes
  -> Final reviewer for large/risky changes
```

Cost controls and trigger rules live in `AGENTS.md`. Specialist profiles live under `.codex/agents/`.

## Files created or configured

- `AGENTS.md`
- `.codex/config.toml`
- `.codex/hooks.json`
- `.codex/hooks/qa-gate.mjs`
- `.codex/agents/tester.toml`
- `.codex/agents/browser_qa.toml`
- `.codex/agents/security_reviewer.toml`
- `.codex/agents/reviewer.toml`
- `client/vitest.config.js`
- `client/src/test/setup.js`
- `client/src/components/PaginationControls.test.jsx`
- `client/playwright.config.js`
- `client/e2e/example.spec.js`
- `.vscode/tasks.json`

## Primary commands

```powershell
# Frontend
Set-Location client
npm run test:unit
npm run test:unit:watch
npm run lint
npm run build
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:ui

# Laravel
Set-Location server
php artisan test --filter=RelevantTest
php artisan test --stop-on-failure

# FastAPI
Set-Location ai-service
.\.venv\Scripts\python.exe -m pytest
```

There is no TypeScript compiler step because the frontend is JavaScript/JSX.

## How future development works

Normal prompts can be concise, such as `Add an admin feature for approving orders.` Codex loads `AGENTS.md`, implements the complete vertical slice, runs focused deterministic checks, and invokes only the specialist agents justified by the change.

To request a specialist manually, ask Codex to use the named project agent, for example:

- `Use the tester agent to validate the order approval change.`
- `Use browser_qa to test the changed login workflow.`
- `Use security_reviewer to inspect this authorization diff.`
- `Use reviewer for a final read-only review of this release change.`

## QA Stop hook

The project Stop hook reads changed and untracked paths from Git and selects lightweight checks:

- React/config changes: Vitest, ESLint, and production build as applicable.
- Playwright/config changes: Playwright test discovery only; full E2E stays with Browser QA.
- Laravel production changes: PHPUnit with `--stop-on-failure` using the isolated in-memory database.
- Laravel test-only changes: targeted changed test files.
- FastAPI changes: pytest.
- Documentation, `.codex/`, and `.vscode/`-only changes: no automatic test run.

Checks have bounded timeouts. The first failure asks Codex to repair and retry. If `stop_hook_active` is already true and a check still fails, the hook returns `continue: false`, ending the automatic repair cycle after one retry.

Project hooks must be reviewed/trusted by the user through Codex's `/hooks` interface after creation or modification. Restart Codex after setup so it reloads `AGENTS.md`, `.codex/config.toml`, custom agents, and hooks.

## Known limitations

- The committed-safe Playwright smoke test mocks the public organization-list API so it cannot alter development data. Full authenticated browser workflows still require the three local services and seeded non-production demo data.
- The QA hook intentionally lists E2E tests instead of running browsers on every completion; Browser QA runs affected workflows when warranted.
- A pre-existing untracked workflow under `client/.github/` is outside GitHub's repository-root workflow location and was not modified or deleted.
