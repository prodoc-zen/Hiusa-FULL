# Handoff: HIUSA agency hierarchy, 2026-10-10 (Asia/Manila)

## State in one line

Local `main` holds the whole restructure and nothing is pushed. Server 659 passed and 6 skipped on SQLite; on MariaDB 658 passed and 1 failed (`ComplianceSemesterMigrationTest`, which also fails on the commit before this work). Client 701 passed, lint clean. Python 31 passed. Live Playwright against the real stack: route sweep 8 passed (every page of all five roles, zero uncaught errors), hierarchy scenario 15 of 15 as each role, layout checks pass (no horizontal scroll, Poppins, tap targets 42px or more on mobile).

## What was built (tasks 1 to 12 of the previous handoff)

1. Dev database backed up and migrated. Dumps are in the session scratchpad: `devdb_before_hierarchy.sql`, `devdb_before_hierarchy_migrate.sql`, `devdb_before_e2e.sql`, `devdb_with_e2e_data.sql`. The dev database is back to the clean state (no browser-test data, no active academic semester) with every migration applied.
2. Hierarchy: SAO is the agency, colleges are a fixed seeded list (`CollegeSeeder`), each college has a home organization of type COLLEGE, student organizations carry `college_id`. A Department Head belongs to the home organization and acts on every student organization in the college through `User::scopedOrganizationIds()`.
3. The SAO can no longer create, rename or delete colleges, and can no longer create organizations. Colleges are view only plus a logo.
4. A Department Head registers an organization with the ten registration PDFs of the current semester; the SAO approves or returns it with remarks; a returned one is edited and resubmitted. Review is guarded against stale state.
5. Archive and restore: archived organizations are read only and their members cannot sign in. Only the SAO restores. SAO writes are guarded by `org.writable`, and approval and venue reviews refuse archived organizations.
6. Delete buttons: events, budgets, manual transactions, tasks (edit too), academic semesters, draft SAO announcements, clearance periods, a student's own unreviewed grievance, compliance requirement types. Collections, remittances, cash advances, invoices and venue bookings keep their cancel, waive or withdraw flows.
7. One Compliance home with tabs Accreditation, Requirements, Review queue, Event requirements, Financial reports, Track documents (`?tab=`). The semestral report is the requirement "Semestral Accomplishment Report", seeded per semester next to the ten renewal items.
8. Track documents lists, per organization and semester, renewal and semestral files, event requirement files, financial reports and their supporting documents; every file opens from the list.
9. SAO Venues has a week availability calendar with details, keyboard access and an agenda below the lg breakpoint.
10. Received Reports is folded into the Compliance "Financial reports" tab.
11. Evaluation module wording reconciled in the addendum and inventory (retired; SO1 and SO4 are assessed outside the app). The unverified `docs/USER_GUIDE.md` draft was moved out of the repo to the scratchpad as `USER_GUIDE.draft.md`.
12. Independent reviews ran: security review of the hierarchy work, UI/UX review, and two reviews of the previous session's work (finance, non-finance). Their findings are fixed except the items under "Open decisions".

Also new: an agency overview page, an organization overview page (read only "inside the organization" view), a college summary on the Department Head home, and `docs/PAPER_SCOPE_ADDENDUM.md` section 2.4 plus use cases HIER-01 to HIER-11.

## Security findings that were fixed

- High: a student-organization Admin could create a Department Head (`POST /api/users` role DEPARTMENT_HEAD), which gave college-wide read and approval power. Now `scopedOrganizationIds()` widens only for COLLEGE organizations, no Admin route can assign or promote a head, and the exploit request returns 422.
- Financial report supporting documents were on a public link; they are now private behind an authorized route, and `php artisan financial-reports:secure-documents` moves old files (it moved 0 on the dev database).
- Department Heads no longer vote or buy merchandise (enforced on the server, not only in the UI).

## The very next action

Nothing is mandatory. If the work is accepted: review `git log --oneline 44c8054..HEAD`, then push. Before a production deploy run `php artisan migrate`, `php artisan financial-reports:secure-documents`, and after the SAO activates a semester `php artisan compliance:seed-semestral-report` if that semester predates the change.

## Open decisions for Jade (each with a recommendation)

1. How is a Department Head created in a real deployment? After the security fix, no route creates one: only `DepartmentHeadSeeder` (skipped in production) and the migration. Recommendation: an SAO-only endpoint `POST /system/colleges/{college}/department-head` with a button on the Colleges page; the rule is SAO actor and COLLEGE home organization only.
2. The Delete button shows on every ledger row for the Admin, and the server refuses system-generated rows with a clear 409. Recommendation: expose `is_system_generated` on transaction rows so the button can be hidden.
3. The event panel excludes cash advances from Income and Spent, while `/transactions/summary` still includes them (the audit lists this as by design). Decide whether the ledger summary should match.
4. Ledger entries inside an SAO-approved financial report can still be edited or deleted; the report keeps its snapshot. Recommendation: refuse edits to entries listed in a submitted or approved report's `source_transaction_ids`.
5. The approvals API has no server-side organization filter; the Department Head page filters in the browser. Fine at college scale, add a server filter if lists grow.
6. Two finance decisions waiting on the team from before (blocking budgets beyond ledger funds; editing financial semesters) are untouched.

## Small leftovers

- The row-actions menu trigger is 40px and the menu closes on any scroll (`TableRowActions.jsx`).
- Inventory rows FIN-05, FIN-10, SAOX-09, DASH-03, DASH-05 still describe older flows; `docs/api/dashboard-briefing.md` does not list the new `type_total` key and still mentions removed `POST /system/organizations` (also `docs/api-contract-audit.md`).
- Activating a semester hides demo tasks and events that have no semester from the default "Active period" views (demo data only).
- The new SQL is not measured on MariaDB: run EXPLAIN ANALYZE on `ComplianceDocumentService` (three source queries, each ORDER BY newest LIMIT 500), the event financial summary (`transactions` by `event_id` with two NOT EXISTS), the `scopedOrganizationIds()` lookup, the agency overview aggregates and the new `audit_logs` indexes.
- Two FinancePage export tests can time out in a full parallel client run; they pass alone (`npx vitest run src/pages/modules/finance`).

## Commands to get back to green

```bash
cd client && npm install && npx eslint src && npx vitest run     # 701 passed
cd server && php artisan test                                    # 659 passed, 6 skipped
cd ai-service && ./.venv/Scripts/python.exe -m pytest -q tests   # 31 passed
# live browser specs (stack must be up: MariaDB 3307, API 8000, Vite 5173)
cd client && HIUSA_LIVE_E2E=1 npx playwright test e2e/route-smoke.spec.js --project=chromium
cd client && HIUSA_LIVE_E2E=1 npx playwright test e2e/visual-live.spec.js --project=chromium
cd client && HIUSA_E2E_SUFFIX=5 HIUSA_E2E_ADMIN_ID=910095 HIUSA_LIVE_E2E=1 npx playwright test e2e/hierarchy-live.spec.js --project=chromium
```

The hierarchy spec writes real rows to the dev database (organizations, an administrator, an academic semester); use a new suffix and admin id each run, and restore the dump afterwards.

## Decisions already made, do not relitigate

- Budget approval is single stage by the Department Head; the SAO has no ledger access.
- SBO Officers and Department Heads read finance but never write it; only the Admin writes.
- Finance dates leave the API in Manila time with an offset; the client reads the first ten characters.
- Cash advances stay in the ledger but are not income or expense in reports and forecasts.
- Task delegation weights are role 0.35, workload 0.30, performance 0.20, recency 0.15, with one keyword map (`TaskDelegationService::POSITION_RELEVANCE_MAP`) equal to the Python map.
- Department Heads oversee elections but do not vote; voters are Admin, SBO Officer and Student.
- Archived organizations are read only and the SAO can restore them.
- The Evaluation module stays removed; SO1 and SO4 are assessed outside the app.

## Gotchas found the hard way

- The Agent tool's worktrees sometimes start on an old commit. Tell builders to run `git log` and `git merge --ff-only main` before starting.
- Agents die on the spend limit (HTTP 429), mid edit. After any failure check `git status` in their worktree, resume them with SendMessage (they keep context) and tell them to re-read the half-written files first.
- SQLite hides MariaDB bugs: a migration `down()` that drops an index a foreign key relies on, SQLite-only `PRAGMA` statements in tests, and SQL text matching. Run the full suite on a throwaway MariaDB database (`DB_CONNECTION=mysql DB_PORT=3307 DB_DATABASE=<throwaway>`) after any migration change.
- Multipart `PUT` is not parsed by PHP: the client posts with `_method=PUT`.
- Never chain verification and `git commit` with `;`. Use `&&`, or the commit goes through on a red test.
- Writing Python or JS edit scripts through bash heredocs breaks on backslashes; use the Write tool for the script file, or an escape-free pattern.
- Dev database is XAMPP MariaDB on 3307; 3306 is a different server. Start services detached through WMI (`Invoke-CimMethod Win32_Process Create`) or they die with the tool call.
- The collaborator's commits have author "unknown"; mine have "Jadehaerys".

## Masterprompt for the next session

```text
You are continuing work on HIUSA (React client in client/, Laravel API in server/, FastAPI AI service in ai-service/). Opus orchestrates and talks to me; Sonnet builders (builder-lean when no browser is needed) write code; reviewers may be Opus. Answer permission prompts; never bypass them. Agents die silently on the spend limit: after any failure check git status in the worktree and resume with SendMessage.

Read first: docs/HANDOFF.md, CLAUDE.md (rules and established patterns, including College hierarchy, Organization lifecycle and Protected files), docs/PAPER_SCOPE_ADDENDUM.md section 2.4, docs/USE_CASE_INVENTORY.md (HIER-01 to HIER-11).

State: main holds the agency hierarchy work, nothing pushed, suites green (see HANDOFF "Commands to get back to green"). Open decisions are listed in HANDOFF; ask me before building any of them, starting with how a Department Head is created in a real deployment.

Never: bare git commit or git add -A (commit by exact paths); AI co-author lines (only Co-Authored-By: John Carlo Borgueta <johncarloborgueta@gmail.com>); the Artifact tool; em dashes; a done-claim without a check that can fail; touching MariaDB on port 3306.
```
