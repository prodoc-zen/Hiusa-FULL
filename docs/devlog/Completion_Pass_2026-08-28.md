# Completion Pass

**Date**: 2026-08-28
**Follows**: `2e67be8` (GCash QR, financial accountability, SBO positions, Playwright) and `08294a4` (AI integration), neither of which had a devlog entry of its own.

This session split into parallel slices after a fresh environment stand-up. This entry covers the **test regression + documentation truth** slice only: the one failing test left after `2e67be8`, and bringing five project documents back in line with what the code actually does. The AI algorithms, client explainability, activity calendar, dashboard charts, and remaining backend feature work were other builders' slices running at the same time — their results are recorded in "Parallel work" at the bottom, filled in once every slice had completed and been reviewed.

## Environment repairs (session-wide, not part of this slice's work but a precondition for it)

- GD extension enabled in `C:\xampp\php\php.ini` (line 931) — fixed one of two test failures present at session start.
- XAMPP MariaDB started on port 3307.
- `hiusa_db` rebuilt via `migrate:fresh --seed` (44 migrations, 38 tables, 5 organizations, 28 users: 4 ADMIN / 5 DEPARTMENT_HEAD / 3 SBO_OFFICER / 16 STUDENT) after a `mysqldump` backup to `C:/BSIT/React/hiusa-db-backups/hiusa_db_backup_2026-08-28.sql`.
- Client dev dependencies reinstalled — `vitest`, `playwright`, `testing-library`, `jsdom` had all gone missing from `node_modules`.
- Python venv created at `ai-service/.venv` with `fastapi 0.141.1` and `pytest 9.1.1`.
- AI service confirmed running on port 8001 with API-key auth (`/health` reports `"authentication": "api-key"`).
- `php artisan storage:link` created.
- 10 missing variables added to `server/.env` from `.env.example`: `FRONTEND_ORIGIN_PATTERNS`, the five `HIUSA_AI_SERVICE_*`, `HIUSA_TASK_MAX_ACTIVE_TASKS`, and the four `GROQ_*`. `GROQ_API_KEY` is still empty, so Groq narration runs on its deterministic fallback until a key is supplied.

## Task 1 — the one remaining test failure

`php artisan test` was reporting `1 failed, 81 passed` — `RequestedWorkflowCompletionTest::test_buyer_can_submit_gcash_proof_and_payment_and_claim_checks_are_enforced` expected `200`, got `422`.

Root cause, confirmed by reading the controller: `2e67be8` added a GCash-QR precondition. `OrderController@store` gates GCash orders on it (only when `payment_method === 'gcash'`); `OrderController@submitPayment` gates it **unconditionally**, because that endpoint's whole job is submitting GCash proof. Both call `organizationHasGcashQr()`, which checks `organizations.gcash_qr_url` is non-null/non-empty, and both return 422 with "GCash payment is unavailable until an administrator uploads the official QR code." `OrganizationFactory` never set `gcash_qr_url`, so no factory-made organization could pass that gate. The failing test created its order with `payment_method: cash` (which skips the `store()` gate) and then hit the unconditional `submitPayment()` gate.

The gate itself is correct behavior and was left untouched. The fix:
- Added `OrganizationFactory::withGcashQr()` — a state that sets a fake `gcash_qr_url`, so the intent at each test's call site is readable (`Organization::factory()->withGcashQr()->create()`) instead of a magic attribute override.
- Updated only the failing test to create its buyer's organization through that state before submitting payment proof.
- Left `OrganizationFactory`'s base `definition()` untouched — `FinancialAccountabilityTest::test_gcash_order_is_rejected_until_an_official_qr_is_configured` depends on a factory-made organization having **no** QR by default, and giving it one there would have broken that test to fix this one.

**Verified**: `php artisan test --filter "FinancialAccountabilityTest|RequestedWorkflowCompletionTest"` — 13 passed, 90 assertions. Full suite: `php artisan test` — **82 passed, 0 failed, 592 assertions**.

## Task 2 — documented the undocumented GCash QR precondition

The QR requirement existed only in code. Added an explicit **Preconditions** section to both `docs/order-merchandise-claim-items-use-case.md` and `docs/manage-merchandise-orders-fulfillment-use-case.md`: an ADMIN must upload the official QR at `/dashboard/merchandise/gcash-payment` (`POST /api/merchandise/gcash-settings`) before GCash ordering or GCash payment-proof submission will work; both return 422 until then. Cash orders are unaffected. Verified the route path against `client/src/App.jsx` and the gate behavior against `OrderController.php` directly rather than assuming.

## Task 3 — fixed the click-through script's false promise

`docs/feature-compliance-and-click-through.md` step 6.6 told a presenter to validate a claim token and "confirm the order becomes claimed and stock decreases." Reading `OrderController@store`, stock is decremented **at order creation** (`$item->decrement('stock_quantity', ...)`), not at claim; `claimByToken` only sets `status`, `claimed_at`, and the verifier. Following the script live would produce a visible "that didn't happen" moment on stage. Corrected the step to say stock was already decremented in the ordering step, not at claim.

Also added a new **Section 0** prerequisite at the top of the script: configure the GCash QR code as Admin before running Section 6, with the same 422 behavior noted in the use-case docs, so the e-wallet order step in Section 6 doesn't fail live for a reason nobody documented.

Read the whole script end to end and spot-checked the claims most likely to have drifted: `events:send-reminders` artisan command exists and matches its description; event approval requires `DEPARTMENT_HEAD` per `ApprovalRequest`; the AI-delegation weights (Role 40% / Workload 35% / Performance 25%) match `ai-service/app/engines/task_delegation.py` exactly (`WEIGHTS = {"role": 0.40, "workload": 0.35, "performance": 0.25}`); the double-vote message ("You have already voted...") matches `ElectionController.php`; biometric attendance still returns 501. No other step contradicted the code.

## Task 4 — re-measured the compliance audit

`docs/use-case-compliance-audit.md` was dated 2026-08-20 and claimed "52 tests, 387 assertions" and "35 migrations applied" — both stale by two commits (`08294a4`, `2e67be8`). Re-dated to 2026-08-28 and replaced every number with what this session actually measured on this machine:

- Laravel: **82 tests, 592 assertions, 0 failed**.
- Python AI service: **6 pytest tests passing**.
- Client: **vitest, 3 tests passing across 2 files**; **5 Playwright spec files** exist under `client/e2e` but the "live" specs are gated behind env flags and have never been run on this machine — called out as not-yet-evidence rather than counted as passing.
- Database: **44 migration files, all 44 applied, 38 tables** in `hiusa_db`.
- Routes: **111 API routes** load (`route:list --path=api`); `route:cache`/`route:clear` succeed.
- Re-ran the other checks the old doc claimed rather than assuming them: `npm audit` is still clean (0), but **`composer audit` now reports 14 advisories across 3 packages** (`league/commonmark` among them) and **Laravel Pint now fails on 19 files** — both are honest regressions from the prior "zero known vulnerabilities" / "no outstanding formatting violations" claims, left unfixed since remediating them would touch files outside this slice. ESLint is still clean, the Vite production build still passes with no bundle-size warning (entry bundle now 275.03 kB / 84.10 kB gzip), and `git diff --check` still passes. The prior "63 real HTTP checks" runtime smoke-test figure and the prior browser-interaction note were not reproduced this pass and are labelled as such rather than repeated as current fact.
- Attendance biometric 501 labelling left exactly as-is — still true, still deliberate.

## Task 5 — rewrote architecture.md

The file described SQLite as the database, said nothing about `ai-service/`, still used the retired Officer/Adviser role model, and every deep link was a `file:///c:/Users/John%20Carlo/...` absolute path from a teammate's machine.

- Database section now correctly says MySQL/MariaDB (`hiusa_db`, local dev on `127.0.0.1:3307`), with SQLite scoped to the test suite only (`phpunit.xml` pins `:memory:`).
- Added an "AI Microservice" section describing `ai-service/` (FastAPI, OLS forecasting + budget rules + task-delegation scoring), how `HiusaAiService`/`GroqResponsesService` call it and Groq respectively, and where `AiOutput` persists both.
- Replaced the Officer/Adviser description with the real role model (`ADMIN`, `SBO_OFFICER`, `DEPARTMENT_HEAD`, `STUDENT`) and linked `Role_Model_Correction_2026-07-11.md`.
- Rebuilt the model table by enumerating `server/app/Models/` directly (28 models) rather than trusting the old list — added `ApprovalRequest`, `AiOutput`, `FinancialReport`, `AuditLog`, `SboPosition`, `TaskProgressUpdate`, `Partylist`, `CashAdvance`, `CashAdvanceRepayment`, `Collection`, `Remittance`, `Invoice`, `InvoicePayment`. Every table name was checked against `SHOW TABLES` on the live `hiusa_db`, not assumed from the model name.
- Replaced every `file:///c:/Users/John%20Carlo/...` link with a repo-relative path and confirmed each target file actually exists at that path.

## Task 6 — repo hygiene

Root `.gitignore` was 105 bytes with no `*.log`, `*.sql`, or `~$*` patterns. Added those plus a scoped pattern for `server/public/uploads/*` that keeps the four subdirectories (`gcash`, `merchandise`, `partylists`, `payments`) versioned via a `.gitkeep` in each while ignoring their contents — the app writes into these at runtime and serves `/uploads/...` from them, so the directories have to survive a fresh clone even though the files inside shouldn't be tracked.

Untracked with `git rm --cached` (never plain `rm`, nothing deleted from disk, nothing committed):
- `vite-dev.log` — not even a real Vite log; a captured PowerShell failure from a different machine full of `C:\Users\John Carlo\...` paths.
- `~$usa_Data_Dictionary_UPDATED.docx` — a Word owner-lock temp file.
- `hiusa_db_original_plus_minimal_patch.sql` (66 KB) — a DB dump now stale against the 44 migrations that are the real schema source of truth.
- 7 files under `server/public/uploads/` (6.1 MB total, including 2 GCash payment-proof/QR PNGs) — user financial artifacts don't belong in version control.

**Verified**: `git ls-files vite-dev.log` returns nothing; all ten untracked files independently confirmed still present on disk (`ls`/`test -f` per file, not assumed from the `git rm --cached` exit code).

## Verified (this slice)

- `php artisan test` — 82 passed, 0 failed, 592 assertions.
- `php artisan test --filter "FinancialAccountabilityTest|RequestedWorkflowCompletionTest"` — 13 passed, both target tests green.
- `ai-service/.venv/Scripts/python.exe -m pytest -q` — 6 passed.
- `npx vitest run` (client) — 3 passed across 2 files.
- `npx eslint .` (client) — zero warnings/errors.
- `npx vite build` (client) — clean, no bundle-size warning.
- `vendor/bin/pint --test` — 19 files with formatting violations (reported honestly in the audit doc, not fixed — out of this slice's file set).
- `composer audit` — 14 advisories / 3 packages (reported honestly, not remediated).
- `npm audit` (client) — 0 vulnerabilities.
- `git diff --check` — clean.
- `git status --short` / `git ls-files vite-dev.log` — confirm the untracking took effect.
- Every migration/table/model/route claim above was checked against `SHOW TABLES` on the live `hiusa_db`, `php artisan route:list --path=api`, and `ls server/app/Models/`, not carried over from the stale doc.

## Still open

- Laravel Pint formatting violations (19 files) were surfaced by this slice but sat outside its file set; they were fixed later in the same session with `vendor/bin/pint` and Pint now reports `passed`. The **14 Composer advisories across 3 packages** were also cleared later in the same session with a targeted `composer update guzzlehttp/guzzle guzzlehttp/psr7 league/commonmark`; `composer audit` now reports none. Note `composer.lock` changed, so teammates need `composer install` after pulling.
- Playwright's "live" specs under `client/e2e` remain unrun on this machine; they need the env flags they're gated behind before they can count as evidence.
- The prior audit's "63 real HTTP checks" runtime smoke test and live-browser verification were not reproduced this pass.

## Parallel work — what the other slices landed

Filled in after all slices completed and were reviewed. Every figure below was re-measured after the last change.

### AI algorithms (`ai-service/` engines + their PHP mirrors)

Six defects closed, and the fix matters because these two algorithms *are* the paper's novel contribution.

- **40% of the delegation score was a dead constant.** `task_delegation.py` set `role_score = 100.0` for every candidate while weighting "role" at 0.40, so the paper's "position relevance" term had zero discriminating power. Replaced with a real relevance model: a module-level `POSITION_RELEVANCE_MAP` over five SBO functional areas (finance, publicity, documentation, logistics, coordination), keyword inference of the task's area, and tiered scoring (primary 100 / related 70 / unrelated 40 / unknown 55). The weight key was renamed `role` → `position`. Verified live: the same two officers with identical workload and history now swap places by task — Treasurer wins "Prepare the financial liquidation report" 93 to 69, PRO wins "Design the social media campaign poster" 93 to 69.
- **Keyword matching was a bare substring test.** `"media"` matched inside `"immediate"` and `"fund"` inside `"fundamental"`, so the engine confidently named the wrong area. Fixed with a start-of-word regex in both mirrors, plus keyword precision: a start-anchor alone does not help `fundamental`, because `fund` genuinely is a word-start prefix of it, so `fund` became `funds`/`funding`/`fundraising`.
- **The workload term went blind.** `max(20, 100 - active*15)` floored at 6 active tasks, so officers with 6 and 60 tied exactly. Now scaled against `max_active_tasks`.
- **The forecaster emitted confident numbers off worthless fits.** Added `fit_quality`, `is_reliable` and a human `confidence_note`; n=2 is now `insufficient_data` regardless of r², since with two points OLS always fits perfectly. Verified live: a noisy six-month series returns `weak` / `is_reliable: false` at r² 0.000088.
- **The zero-clamp erased collapses.** `max(0.0, ...)` turned a projected −200 into 0. Now `raw_predicted_income`/`raw_predicted_expense` and an `income_clamped` flag expose it. Verified live.
- **`allocation_status` was misleading**, reporting `reduce_allocation` merely because the configured safety reserve was held back during entirely normal operation. It now derives from actual forecast risk.

The PHP mirrors were brought back into sync, including pre-existing drift where `FinancialForecastController::localBudgetAdvice()` ignored `committed_expenses` and hardcoded the 0.8 safety ratio while `BudgetController`'s copy honoured both. Also fixed: `TaskController::store()` did not check `account_status` on an explicitly named assignee (so a disabled officer could be assigned, contradicting the engine's own eligibility rule), and a single-officer delegation payload was writing spurious warnings into the Laravel log during normal operation.

New `AiFallbackParityTest` covers the failure path nothing tested before: with the Python service faked to fail three different ways, the controllers still succeed and report `php-fallback`, and one test calls the live Python service and the PHP fallback with the same input and asserts numeric equality.

### Client AI explainability

The backend was already returning `engine`, `rules_applied`, `r_squared`, `sample_months`, `eligibility_rules` and per-officer `explanation` strings, and the client discarded all of it. It now renders them, with a "How this was calculated" disclosure, a weak-fit confidence warning, and the full delegation ranking rather than only the winner.

Two statements in the UI were simply false and are now driven by the response: `TasksPage` claimed "Python-powered weighted officer recommendations" as static copy even when PHP had computed the scores, and it stated "Weights role eligibility at 40%", which described a constant. Weights and eligibility rules are now read from the payload so the UI cannot disagree with the algorithm again.

This slice was initially dead code: `TaskController` never forwarded `task_area`, `position_tier`, `rankings`, `weights` or `eligibility_rules` to the API response. That was fixed in the AI slice, and the field names were matched against the client exactly.

### Activity calendar and dashboard charts

The full-month grid promised by `view-events-calendar-use-case.md` and the master diagram, open since the 2026-06-27 gap analysis, now exists: weekday-aligned month matrix, prev/next/Today controls, status badges carrying text labels, a "+N more" affordance, and an agenda view below 640px instead of a horizontally scrolling grid. Multi-day events index across every day they span, not just their start date. No charting dependency was added; the existing hand-rolled SVG approach was extended.

One notable correctness fix: the officer dashboard computed spend as `allocated - remaining`, but the server defines `remaining = allocated + income - expense`, so the figure shown as "spent" was actually `expense - income` and clamped to zero for any budget carrying income.

### Remaining backend features

Voter eligibility (`GET /elections/{id}/voters`, paginated, with a turnout summary), an announcement view counter with per-user uniqueness enforced by a DB constraint rather than a race-prone check, `DEPARTMENT_HEAD` as a valid `target_role` end to end, and an `SboPositionSeeder` for a table that was empty after a full seed. `is_member` was investigated and found genuinely dead, superseded by the `organization_id` scoping every controller now does — recorded as such rather than given invented machinery.

### Cross-slice items closed by review

- `ManageVotersPage` rendered zero voters for every election: making the endpoint paginated changed its response from a bare array to a paginator envelope, and the page still tested `Array.isArray`. Headline counts also came from the loaded page rather than the server summary, which under-reports as soon as voters paginate. Both fixed, pagination controls wired in, a React key that was `undefined` on every row corrected, and a regression test added that was confirmed to fail when the bug is reintroduced.
- Pint's 19-file violation set has been fixed (see Verification Results in the compliance audit); it was pre-existing debt from `2e67be8`, not from this pass.
- The seeded database could not pass the application's own approval gates — see the Demo Readiness section of `docs/use-case-compliance-audit.md`. That was the single biggest risk to a live defense and is now closed and test-guarded.

### Final measured state

Laravel **106 passed / 824 assertions**, Python **15 passed**, client **9 passed across 3 files**, ESLint clean, Vite build clean, Pint clean, 46 migrations applied, 39 tables.
