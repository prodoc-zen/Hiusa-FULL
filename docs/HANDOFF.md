# Handoff: HIUSA UX logic flow release, 2026-10-10 (Asia/Manila)

## Read this first

1. The forced password change is merged, but the fix that makes it safe is NOT on main yet. A security review found that imported students still get the guessable password `<last 4 digits of school_id>-uclm`, so anyone who knows a school ID can sign in first, choose a new password and lock the student out. The fix (random temporary passwords shown once to the Admin, a command that flags accounts still on defaults, plus eight smaller fixes) is in a builder worktree, branch `worktree-agent-aa0da06cf3b8b528f`. Do not deploy this release until that branch is merged and its tests pass.
2. Three builders were still running when this handoff was written. If their session is gone, finish their work from the worktrees (see "In flight").
3. The local XAMPP MariaDB on port 3307 does not start (a crashed system table after an unclean shutdown). See "Local environment".

## State in one line

`main` equals `origin/main` at `c90d7e4`. Server 815 passed, 6 skipped on SQLite. Full server suite on a real MariaDB: 794 passed, 2 failed, and those 2 (ComplianceSemesterMigrationTest, PersonalAttendanceSummaryTest) fail identically on the commit before this work. Client 1725 passed, lint clean, build clean. Python 31 passed (not rerun this session). CI on GitHub: every job green except the end-to-end job, which is being repaired.

## What was done this session

CI was red before this work and the server tests never ran in CI: the Pint style gate failed first. Fixed Pint, cleared three dependency advisories (Laravel 12.62 to 12.69, league/commonmark, league/flysystem), and the CI jobs now pass: Laravel (style, audit, tests), Client, AI service, and the migrations on MySQL 8.4 and MariaDB 10.4. The end-to-end job (Playwright against a live stack) was already red and is being repaired.

The dean's main complaint was that the UX logic flow is not there. The diagnosis and the design are in `docs/UX_FLOW.md` (35 logic breaks with evidence, target menus per role, ten lifecycle steppers, page anatomy, journeys with click ceilings). It is implemented:
- Shared components: `FlowStepper`, `NextStep`, an upgraded `PageHeader`, `lib/lifecycle.js` (eleven lifecycles verified against the server code), `lib/useRecordParam.js`, `lib/pageMeta.js`.
- Menus rebuilt per role in process order with plain labels; every page has one header, a purpose line and a breadcrumb; old routes redirect.
- Every process shows where you are and what is next: events, budgets, financial reports, elections, merchandise orders, tasks, announcements, approvals, organization registration, compliance renewal, grievances, venue booking, clearance. Rows, details and notifications deep link to the exact record (`?record=`).
- Each role's first screen shows the next three setup steps; the SAO has a review inbox.
- Event approval chain decided and built: the Department Head always approves the proposal, then the SAO clears it when SAO requirements apply (paper addendum decision j).
- Elections: a rejected election shows the reason and can be resubmitted; voting opens automatically at the start time (`elections:sync-statuses`, every minute).
- The open decisions from the previous handoff, taken on recommendation: the SAO creates Department Heads on the Colleges page; ledger rows say if they are system generated or locked by a submitted report; the approvals list filters on the server; the Admin can no longer edit entries inside a submitted report.

Security: three review rounds and fixes (Department Head escalation, archived organizations read only, login throttle and timing, report snapshot drift, CSV formula injection, notification enumeration, financial documents moved to a private disk). Forced password change added (see warning above).

For testing and deployment:
- `docs/MEMBER_TESTING.md`: accounts, scripted journeys per role with click limits, what to report.
- `scripts/serve-lan.ps1`: serves a copy from this laptop to people on the same network (hardened: subnet-only firewall rule, database bound to localhost, debug off, stops only its own processes).
- `docs/UPGRADE_2026-10.md` and `scripts/upgrade-checks.sql`: the runbook and read-only checks for upgrading the live Lightsail server. Rehearsed on a MariaDB copy of real-shaped data: all five migrations apply, the checks come back clean, rollback and re-apply work.

## In flight at handoff time

1. Client polish builder, worktree `.claude/worktrees/agent-a7af6e6c38126ccaf`, branch `worktree-agent-a7af6e6c38126ccaf` (4 commits, 2 files uncommitted). Scope: student home shows the owed balance and clearance state; notification links use the new `entity_type`; announcement review link opens the exact approval; order and approval `?record=` use the new single-record endpoints; cancelled and other negative terminal states no longer read "Complete" in the stepper; Settings keeps the session after a password change.
2. Security round 3, worktree `.claude/worktrees/agent-aa0da06cf3b8b528f`, branch `worktree-agent-aa0da06cf3b8b528f` (1 commit, 6 files uncommitted). Scope: random temporary passwords per imported student returned once with a CSV download (the HIGH fix); `users:flag-default-passwords` command (run it after the migration, add to the upgrade runbook section 5); login throttle keyed on the integer school ID; failure counter on the current password; a small password denylist; sign-out on the forced change page; cache cleared after reset; election sync no longer writes on every read; and an approval chain integrity fix (an Admin editing an event after the head approved it must reopen the head's approval).
3. End-to-end repair and journey specs, an agent editing `client/e2e/*` DIRECTLY IN THE MAIN WORKING TREE (uncommitted: ai-decision-support-live, events-live, finance-live, financial-accounts, route-smoke and more, plus new `client/e2e/journeys/*`). It runs a throwaway SQLite stack on ports 8000 and 5173 (database under the session scratchpad `e2e/`). Do not run `git checkout .` or `git stash` in the main tree while it works. If the session is gone, check `git status client/e2e`, run the suite against a fresh seeded stack (replicate the CI job in `.github/workflows/tests.yml`), fix what fails, commit by exact paths.

For each worktree: `git -C <worktree> log --oneline main..HEAD`, read `git -C <worktree> status`, confirm each file is complete (agents die mid-edit on rate limits), run the CI gates there, then merge with `git merge --no-ff` and push.

## Local environment

- Local XAMPP MariaDB (port 3307) will not start: `mysql.db` is marked crashed after an unclean shutdown. I removed the stale Aria log files (a full copy of the data folder is in the previous session scratchpad as `xampp_mysql_data_backup_20261010`) and the next error was the crashed system table. The repair is `aria_chk -r` on `C:\xampp\mysql\data\mysql\*.MAI` with mysqld stopped. The automatic permission check blocked me from running it, so Jade decides: run it by hand, or restore the data folder from the backup and start fresh from a dump (`devdb_before_e2e.sql`, then `php artisan migrate`). The HIUSA data itself is also in the dumps in the scratchpad (`devdb_before_e2e.sql`, `devdb_with_e2e_data.sql`).
- A throwaway MariaDB is running on port 3399 (data folder `scratchpad/maria_rehearsal/data`, databases `rehearsal` and `suite_check`, user root, password root). It was used to rehearse the upgrade and to run the full suite on a real MariaDB. Stop it when done (Task Manager, `mysqld.exe` listening on 3399). Port 3306 is a different server; never touch it.
- The dev database could not be restored by me; the Department Head, SAO and demo accounts live in it. Fresh seeds use different SAO and Admin logins (see README demo accounts).

## Open decisions for Jade

1. Menu wording: run the card sort in `docs/MEMBER_TESTING.md` with 5 student leaders before freezing labels ("Records", "Events and tasks", "Store", "Updates").
2. Backfill `notifications.entity_type` for older approval notices? A one-off update from `approval_requests`; new notices already carry it. Without it older SAO notices use the fallback link.
3. Imported students: confirm the temporary password handout (Admin downloads a one-time CSV and gives each student theirs) is acceptable; the alternative is an emailed reset link, which needs mail configured.
4. Whether and when to deploy to the live Lightsail server, and who runs it (needs SSH). The live server has real data (four organizations) and runs an older version.
5. Two finance items from before are untouched: blocking budgets beyond ledger funds, and editing or removing financial semesters.

## Known gaps (none blocks release)

- The server has no single-record endpoints for venue bookings, compliance submissions, clearance signatures and clearance periods, so `?record=` there scans pages. The clearance roster payload lacks `remarks` per held signature.
- Students cannot list upcoming elections (the server hides them), so the "Upcoming" chip rarely shows. The elections list has no `has_voted`, so the Vote page fetches each election.
- `waiting_on` on briefing items is supported by the client but never sent. Fingerprint office hours are not in any payload.
- The Admin reaches the voters turnout through `manage-elections?record=ID&view=voters` because the `manage-voters` route is Officer only.
- New SQL is unmeasured on a real database (run EXPLAIN ANALYZE; `ComplianceDocumentService` is measured, see the next section): approval row summaries (`MAX(id) GROUP BY entity_id`), budget `spent_amount` with two NOT EXISTS, event financial summary, the clearance aggregate, `scopedOrganizationIds()`, election status sync, the audit log indexes.
- The Department Head with no college assigned has no Department Head account until the SAO creates one; seeders are skipped in production.

## Measured on a real MariaDB (fix round on integrate/sao)

Throwaway MariaDB 10.4.32 started for this round (not 3306, 3307, 3399), `sql_mode` including `ONLY_FULL_GROUP_BY` and `STRICT_TRANS_TABLES`, `max_statement_time` 60 s in the measuring session (no query came near it).

Documents list, `ComplianceDocumentService` (`GET /api/compliance/documents`). Data: 300 organizations (10 percent pending), 102,000 compliance submissions, 60,000 events (half per semester), 60,000 event requirement files, 30,000 SAO approval rows, 60,000 submitted reports with two supporting documents each. Wall time of the service call and slowest single query, SAO (all 300 organizations) and Department Head (40 organizations), measured with `ANALYZE` plans on every query over 150 ms:

| Shape | SAO page 1 (20) | SAO page 20 (100) | Department Head page 20 (100) |
| --- | --- | --- | --- |
| no filter | 1.26 s / 342 ms | 1.72 s / 271 ms | 1.16 s / 54 ms |
| semester filter | 1.14 s / 276 ms | 1.76 s / 292 ms | 1.07 s / 52 ms |
| family=registration | 0.45 s / 272 ms | 0.58 s / 269 ms | 0.19 s / 46 ms |
| source=financial_supporting_document | 0.31 s / 181 ms | 0.57 s / 166 ms | 0.33 s / 31 ms |
| source=event_requirement + semester | 0.26 s / 150 ms | 0.73 s / 167 ms | 0.46 s / 22 ms |
| group=organization (SAO) | 0.67 s / 293 ms | | |
| group=organization + semester (SAO) | 0.77 s / 396 ms | | |

Every query ran under `ONLY_FULL_GROUP_BY` without error. The plans are linear scans or index lookups: the grouped compliance count and the compliance row query read the 102,000 submissions once (about 250 to 300 ms), the financial count uses `financial_reports_submission_index` (range, about 30,000 rows with the semester subselect), event files join `events` on its primary key and `event_requirement_files` on its `event_id` index. No index was added.

The finding's quadratic plan (loose scan on `approval_requests` joined to `events` through a block nested loop, 53 s at 20,000 files) did NOT reproduce here, on the same engine version, with six data shapes (semester share 10 to 50 percent, 6,000 to 60,000 files, 30,000 or 90,000 approval rows). It depends on the optimizer statistics of the machine it was seen on. `eventFiles()` was rewritten anyway so no plan can pair two unindexed sides: the two `IN` subselects became an inner join on `events` (semester) and an inner join on a distinct derived table of SAO review ids, every join on an indexed key. On this data the old and new forms cost the same (event shape: 0.32 s old, 0.26 s new at 30,000 files in the semester). The improvement is by construction, not measured. Still to do if the SAO page is slow in production: `ANALYZE` the real tables, and re-run `EXPLAIN ANALYZE` on the shape `source=event_requirement&academic_semester_id=...` as the SAO. Web requests now carry a statement timeout (`App\Support\DatabaseStatementTimeout`, set in `AppServiceProvider`, `DB_STATEMENT_TIMEOUT` seconds, default 30, 0 turns it off): MariaDB `max_statement_time` on every statement, MySQL `max_execution_time` on SELECT statements only. Checked on the throwaway MariaDB 10.4: `select sleep(40)` is stopped at 30.0 s with error 1969, and `sleep(5)` at a 1 s setting after 1.04 s. Console commands (migrations, queue workers, imports) are not capped. A bad plan on production statistics now fails in 30 s instead of pinning a connection; the plan itself is still unmeasured on production data.

Delete guards, two real connections (`scripts/lock-interleave/interleave.php`, see its header for how to run; the four-second hold and a 1.2 s head start are in the script). Each pair runs in both orders and every check passed:

- Event delete against a venue booking for the event: delete first, the booking waits and gets 422; booking first, the delete waits and gets 409.
- Venue delete against a booking for the venue: booking first, the delete waits and gets 409. Delete first, the booking waited and then answered a 500 (foreign key violation). Fixed: `VenueBookingController::store` now answers 422 when the venue is gone at the lock.
- Budget delete against a ledger entry and against an approval: `BudgetController::destroy` now checks status and ledger entries on the locked row inside one transaction. Before the fix the same harness showed both reported losses (a delete returned 200 and left the ledger entry with `budget_id` NULL; a budget approved in the gap was deleted). After: 409, the entry and the approved budget stay; a ledger entry inserted after the delete took the lock is refused by the foreign key.
- Election delete against an election that opens meanwhile: same lock in `ElectionController::destroy`; the open election stays (409), and an open that arrives during the delete changes no row. Votes cast in the gap were not driven through the harness; they take the same shared lock on the election row through their foreign key as bookings do on the event.

- Review against delete (added in the second fix round): the first version of the budget and election delete locked the budget or election row and then deleted the approval rows, while a review locks the approval row, then the organization, then the budget row. The harness reproduced the inversion as MariaDB error 1213 (deadlock) and a 500 for the delete, for the budget and for the election. Both deletes now lock the approval rows first. Control on the previous code: FAIL with the 500; now: budget delete after a review gets 409 and the approved budget stays, election delete waits and gets 200, a review arriving during a delete gets 404. `BudgetController::update` still locks the budget row before it reopens the approval row, the reverse of a review; it was not changed in this round and has not been driven through the harness.
- Position or candidate added to an election that is deleted meanwhile: `positionsStore` and `candidatesStore` now lock the election row and answer 404 when it is gone (the control answered 500, a foreign key violation); the ballot lock is re-checked on the locked row.

SQLite cannot show any of this: `DeleteGuardLockTest`, `BudgetDeleteGuardTest` and `ElectionDeleteGuardTest` pin the shape only (the lock order is pinned by the order of the queries).

## Commands to get back to green

```bash
cd server && vendor/bin/pint --test && php artisan test          # 815 passed, 6 skipped (SQLite)
cd client && npm ci && npm run lint && npx vitest run && npm run build   # 1725 passed
cd ai-service && ./.venv/Scripts/python.exe -m pytest -q tests   # 31 passed
# full server suite on a real MariaDB (throwaway database, never hiusa_db)
DB_CONNECTION=mysql DB_HOST=127.0.0.1 DB_PORT=3399 DB_DATABASE=suite_check DB_USERNAME=root DB_PASSWORD=root php artisan test
```

CI gates (all must pass): `vendor/bin/pint --test`, `composer audit`, `php artisan test`, `npm run lint` (eslint over the whole client), `npm run test:unit`, `npm run build`, `bash -n` on the deploy scripts plus `node --test scripts/check-membership-routes.test.mjs`, the migration jobs, pytest, and the Playwright live-stack job.

## Decisions already made, do not relitigate

- The SAO is the agency; colleges are a fixed list; a Department Head belongs to a college home organization and acts on its organizations; only the SAO creates heads. Organization lifecycle pending, returned, active, archived; archived is read only and the SAO restores it.
- Department Heads approve first (events, budgets, elections, financial reports); the SAO clears events that need SAO requirements. Heads do not vote or buy merchandise.
- Budget approval is single stage by the Department Head; SBO Officers and Department Heads read finance and never write; cash advances are not income or expense in reports.
- Task delegation weights role 0.35, workload 0.30, performance 0.20, recency 0.15, one keyword map equal to the Python map.
- Menu: "Finance" for managers, "My payments" for students; the groups follow the process order in `docs/UX_FLOW.md` section 3.
- The Evaluation module stays removed; SO1 and SO4 are assessed outside the app.

## Gotchas found the hard way

- Rate limits hit in bursts and kill every running agent mid-edit. After any failure check `git status` in each worktree, resume with SendMessage (they keep their context), and tell them to re-read half-written files first. The limit sometimes clears long before the time it states: probe with a one-word agent before assuming.
- The Agent tool's worktrees sometimes start on an old commit: tell builders to `git merge --ff-only main` first. `git merge --no-ff -q -m` with exact paths only; never `git add -A`.
- `*.sql` is gitignored (database dumps stay out); `scripts/upgrade-checks.sql` has an explicit exception. A `git add` that includes an ignored path aborts the whole add.
- SQLite hides MariaDB bugs (index and foreign-key ordering, `PRAGMA` in tests, quoting in SQL text matched by tests). Run the full suite on a real MariaDB after migration or query changes.
- Pint is a CI gate and failed silently for weeks: run `vendor/bin/pint --test` before every push.
- Windows: long-lived processes must be started with `Invoke-CimMethod Win32_Process Create` (or they die with the tool call); heredocs with backslashes break (use the Write tool for script files); `;` chains run the next command even when a test failed (use `&&` before a commit); the `.gitattributes` setting makes LF in the repo and CRLF in the working copy, so "LF will be replaced by CRLF" warnings are normal.
- Never use `/tmp`; use the session scratchpad. The automatic permission classifier blocks in-place repairs of the local database; do not try to route around it.
- Commits carry only `Co-Authored-By: John Carlo Borgueta <johncarloborgueta@gmail.com>` (CLAUDE.md overrides the harness trailer).
- The collaborator's commits have author "unknown", Jade's "Jadehaerys".

## Masterprompt for the next session

```text
You are continuing work on HIUSA, a school organization management system (React client in client/, Laravel API in server/, FastAPI AI service in ai-service/). Opus orchestrates and talks to me; Sonnet builder agents (builder-lean when no browser is needed) write code and run the suites; reviewers may be Opus. Answer permission prompts; never bypass them. Agents die silently on rate limits: after any failure check git status in the agent's worktree and resume it with SendMessage.

Read first, in this order: docs/HANDOFF.md (state, in-flight work, warnings), CLAUDE.md (rules and established patterns), docs/UX_FLOW.md (the UX design that was implemented), docs/PAPER_SCOPE_ADDENDUM.md section 2.4 and decision (j), docs/UPGRADE_2026-10.md, docs/MEMBER_TESTING.md.

Objective: finish and ship the UX logic flow release. The dean's main complaint was that the UX logic flow is not there; it has been redesigned and built (menus per role in process order, a stepper and next step on every process, deep links, first-use setup cards). What is left is merging the last work, proving it in a browser, and getting it in front of members.

In scope, in this order:
1. Pick up the three in-flight builders from docs/HANDOFF.md "In flight": security round 3 (branch worktree-agent-aa0da06cf3b8b528f, merge FIRST: it fixes the HIGH default-password takeover, do not deploy without it), client polish (worktree-agent-a7af6e6c38126ccaf), and the end-to-end repair (edits client/e2e in the main working tree, do not discard those changes). Verify each is complete, run the gates, merge, push.
2. Make CI fully green on GitHub, including the Playwright live-stack job, with the new journey specs in client/e2e/journeys.
3. Run the journeys at 1440 and 390 pixels against a freshly seeded stack, fix what a person would get lost on, and record findings.
4. Add the temporary-password step and users:flag-default-passwords to docs/UPGRADE_2026-10.md, then run the upgrade rehearsal again on a MariaDB copy (throwaway instance on port 3399, never hiusa_db or port 3306).
5. Local XAMPP MariaDB (port 3307) is broken (crashed mysql.db): ask me before repairing it (aria_chk -r on C:\xampp\mysql\data\mysql\*.MAI with mysqld stopped) or restoring from the backup in the scratchpad.
6. Help me get members testing: scripts/serve-lan.ps1 for the local network, docs/MEMBER_TESTING.md for the script, and a deployment plan for the live Lightsail server (I run the SSH steps; I decide when).

Out of scope unless I say so: blocking budgets beyond ledger funds and editing financial semesters (two finance decisions waiting on the team), re-adding the Evaluation module, and any change to the decisions listed in HANDOFF.md "Decisions already made".

State: main equals origin/main at c90d7e4. Server 815 passed (SQLite), 794 plus 2 known failures on MariaDB; client 1725 passed; CI green except the end-to-end job.

Phases: recon inline with exact greps before reading trees. Plan mode for anything that touches authorization or the data model. Build in slices on disjoint files with Sonnet builders, each with a test that fails before and passes after; each worktree needs its own composer install and npm install, a sqlite :memory: .env, and `git merge --ff-only main` first. Gates before every merge and push: vendor/bin/pint --test, php artisan test, npm run lint, npx vitest run, npm run build, ClientRouteAllowlistTest; after migration or query changes also the full suite on a real MariaDB. Security review (security-architect agent) on anything touching authentication, approvals or data scoping; UI review on UI changes; browser check as each role.

Tokens: read files with line ranges, brief subagents with the answer, read agent results from their final report only.

Done means: all in-flight work merged and pushed; CI green on GitHub including Playwright; every journey in docs/UX_FLOW.md section 9 passes within its click ceiling at both widths, or its failure is a recorded finding; the upgrade runbook includes and has rehearsed the new commands; members can test (local network or a hosted copy) with the guide.

Never: bare git commit or git add -A (commit by exact paths); AI co-author lines (CLAUDE.md requires only Co-Authored-By: John Carlo Borgueta <johncarloborgueta@gmail.com>); the Artifact tool; em dashes; a done-claim without a check that can fail; touching MariaDB on port 3306 or the local hiusa_db without my say-so; deploying to the live server.
```
