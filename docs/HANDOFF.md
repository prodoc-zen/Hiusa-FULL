# Handoff: HIUSA SAO feedback, journeys and live deploy, 2026-10-12 (Asia/Manila)

## State in one line

`main` equals `origin/main` at `4c19464`, pushed. Nothing is deployed: the live Lightsail server is still on `9f9fef7` (7 Oct), and Jade authorised the deploy (11 Oct) but it has not started. SSH access works from this machine (see the "Live server" section and the memory note `project-live-deploy-access`).

## Done and verified (real numbers from this session)

- Server on SQLite: `vendor/bin/pint --test` passed, `php artisan test` 905 passed, 6 skipped (run on commit e1f62d5, the content of main).
- Client: `npm run lint` clean, `npx vitest run` 1873 passed (169 files), `npm run build` exit 0.
- Live end-to-end on a freshly seeded SQLite stack (before the last doc-only commit): 97 passed, 0 failed across events-live, finance-live, financial-accounts, hierarchy-live, merchandise-order-depth, positions-management, route-smoke, task-workspaces, user-management-academic, venue-booking-live, visual-live and the five journey specs (student 10, officer 8, admin 10, dept-head 14, sao 10). The AI spec was skipped (AI service off).
- Full server suite on a real MariaDB 10.4 (cleanup branch, before the last merges): 903 passed, 2 failed. The 2 (ComplianceSemesterMigrationTest, PersonalAttendanceSummaryTest) fail identically on the commit before this work.
- A fresh security pass over the integrated branch came back clean. An Opus review found one HIGH (a venue time backfill migration that would corrupt rows); the migration was deleted (e1f62d5).
- Pushed 80 commits, only `Co-Authored-By: John Carlo Borgueta` trailers, no secrets, no em dashes in added lines.
- CI on GitHub for `4c19464` was still running when this was written. The two runs before it failed (the end-to-end job was red). Check `gh run list -R prodoc-zen/Hiusa-FULL --limit 3`.

## What was built this session

The SAO/dean feedback list (a Wednesday note, pasted again on 11 Oct) was audited against the code first: most of it was already built (the SAO cannot create colleges or organizations, colleges are a fixed seeded list, the Department Head registers organizations for SAO approval, archived organizations are read only, the head belongs to the college home organization). Built now:
- Delete and withdraw: forecast delete button; a Department Head can withdraw a pending or returned registration (no records); event, election, budget and venue deletes refuse with 409 where history exists; cancelling an event withdraws its venue bookings; merchandise "Delete" became "Deactivate". The rules are in `docs/UX_FLOW.md` section 10.
- One Compliance place: Track documents lists every submitted file per organization (event requirement files, semestral report, renewal, financial supporting documents, registration documents) as an expandable per-organization list with real paging, status and stage, and a View that opens the protected file. "Received reports" is now "Financial reports" with a purpose line.
- SAO venue calendar: Calendar tab is the default, day, week and month views, occupant and event named for the SAO only, strict overlap conflicts, complete windows.
- Hierarchy polish: the SAO edit form can no longer move an organization to another college or flip `is_active`; the head's profile names the college; the college page shows role counts and leadership per organization; `/api/user` returns only the organization columns the client uses.
- Journey fixes: Statement of account shows balance and clearance state; an order verified by an officer reads "Payment verified: waiting for Admin approval" until the Admin approves; Officer announcements say "Submit for approval"; new proposals open on the event; Check-in preselects the one ongoing event; `1-A` and `BS` render correctly; the PHP delegation fallback numbers its ranks; CORS preflights are cached 10 minutes; Department Head resubmit lands on Pending review.
- E2E: the live suite was repaired and five journey specs from `docs/UX_FLOW.md` section 9 were written (1440 and 390 px, click counting, end-state assertions). `docs/UX_FLOW.md` section 9 now has counting rules (the 390 px menu tap is not counted) and an Accepted deviations table for the ceilings the live run measured. Several fix rounds also added row-lock guards on delete paths with a two-connection harness (`scripts/lock-interleave`).
- Member guide `docs/MEMBER_TESTING.md` now matches a fresh seed (accounts verified by real login).

## Live server (Lightsail 13.228.227.182)

- Access: SSH as `ubuntu` with the Lightsail key kept in `~/.ssh` (the path is in the memory note, not in this repo). Passwordless sudo. Read-only checks work. The auto mode classifier blocks bundled production writes: show each write command first and run them one by one; never route around a denial.
- State on 2026-10-11: code `9f9fef7` on `main`, clean apart from stray untracked files (`on`, `server/-`, `server/990002,`, and similar, left alone), all seven services active (nginx, mysql, php8.3-fpm, hiusa-ai, hiusa-fingerprint, hiusa-queue, hiusa-scheduler), `/up` returns 200, disk 8 percent used, PHP 8.3.6, Node 22.23, 5 organizations, 16 users, 4 venue bookings (1 pending, 1 rejected, 2 withdrawn, none approved).
- The server can `git fetch origin` (public HTTPS remote) and the update is a clean fast-forward.
- What the release brings: four new migration files since `9f9fef7` (`add_college_hierarchy`, `add_audit_log_indexes`, `add_entity_type_to_notifications`, `add_must_change_password_to_users`); the runbook says five, so read `migrate:status` on the server and reconcile before migrating. `composer.lock` changed (Laravel 12.62 to 12.69 and advisories), so `composer install` is needed. New optional env key `DB_STATEMENT_TIMEOUT` (default 30). A new scheduled job `elections:sync-statuses` runs every minute: `hiusa-scheduler` must be active after the restart.
- The pending live booking: compare its stored time with what the requester typed and fix by hand if it is 8 hours off (no migration, see `docs/UPGRADE_2026-10.md` section 6).

## In flight

Nothing half-applied in code. Not done: the deploy, the LAN member-test copy, worktree cleanup.

## The very next action

1. `gh run list -R prodoc-zen/Hiusa-FULL --limit 3`: confirm CI on `4c19464` finished green (the Playwright job includes the new journey specs; if it is red, read the job log first, it may be run-order state: see "Live run order" in `docs/UX_FLOW.md` section 9).
2. Then the deploy, in this order, one command at a time, writes shown first: (a) read-only recheck of the server (`git -C /var/www/hiusa status --short`, `rev-parse --short HEAD`, services active); (b) ask Jade to take a Lightsail snapshot in the console (only Jade can) and take a `mysqldump` to `/var/backups/hiusa` with `--single-transaction --routines --triggers` (password prompt stays on the server, never in chat), then verify the dump size; (c) follow `docs/UPGRADE_2026-10.md` sections 4 to 7 and `LIGHTSAIL_DEPLOYMENT_AND_MAINTENANCE.md` section 2 (`git pull --ff-only`, `composer install --no-dev ...`, `migrate:status`, `migrate --force`, `optimize:clear`, `optimize`, `npm ci` and `npm run build` in `client/`, restart `php8.3-fpm hiusa-queue hiusa-scheduler`, `nginx -t`, reload nginx); (d) one-off commands from runbook section 5 (`financial-reports:secure-documents`, `users:flag-default-passwords --dry-run` then the real run, `compliance:seed-semestral-report` only if a semester is already open); (e) `scripts/upgrade-checks.sql` clean, `/up` 200, smoke test as each role with real accounts.
3. Say "deployed" only after the health checks pass and Jade has seen them.

## Commands to get back to green

```bash
cd server && vendor/bin/pint --test && php artisan test                   # 905 passed, 6 skipped (SQLite)
cd client && npm ci && npm run lint && npx vitest run && npm run build   # 1873 passed
cd ai-service && ./.venv/Scripts/python.exe -m pytest -q tests            # 31 passed (not rerun this session)
# full server suite on a real MariaDB (your own throwaway instance, never hiusa_db, never 3306 or 3307)
# expected: 903 passed, 2 known failures (ComplianceSemesterMigrationTest, PersonalAttendanceSummaryTest)
# live e2e on a fresh seed: see docs/UX_FLOW.md section 9 "Live run order"; 97 passed with the AI spec off
```

## Open decisions for Jade

1. The college page: the dean's note says an organization consists of Admin, SBO Officer and Students created from the college side. Today the head registers the organization and the SAO provisions the first Admin after approval (a standing decision). Change it?
2. A GHL-style "organization context" for the SAO (stay inside one organization while moving between its events, finance and members, read only). Not built; Agency overview is a drill-in page only.
3. Live totals while an election is open are shown by default (the Admin form always stores results visible). Add a "hide results until close" switch, or keep?
4. Backfill `notifications.entity_type` for older approval notices (one-off update from `approval_requests`)? Without it older SAO notices use the fallback link.
5. Menu wording card sort with 5 student leaders (`docs/MEMBER_TESTING.md`), and the temporary password handout (Admin downloads a one-time CSV) versus an emailed reset link.
6. Two finance items still untouched: blocking budgets beyond ledger funds, and editing or removing financial semesters.
7. Local dev database (XAMPP, port 3307) is still broken (crashed `mysql.db`). Jade chose a fresh seeded throwaway database for the member test instead of repairing it; `scripts/serve-lan.ps1` still starts the XAMPP database, so it needs a small change (database name and credentials from env, start a throwaway instance) before members can test from the laptop.
8. The Lightsail key is a shared default key: rotate it or create a dedicated key pair after this release.

## Known gaps (none blocks release)

- The server has no single-record endpoints for venue bookings, compliance submissions, clearance signatures and clearance periods, so `?record=` there scans pages. The clearance roster payload lacks `remarks` per held signature.
- Students cannot list upcoming elections (the server hides them), so the "Upcoming" chip rarely shows. The elections list has no `has_voted`, so the Vote page fetches each election.
- `waiting_on` on briefing items is supported by the client but never sent. Fingerprint office hours are not in any payload.
- The Admin reaches the voters turnout through `manage-elections?record=ID&view=voters` because the `manage-voters` route is Officer only.
- New SQL is unmeasured on a real database (run EXPLAIN ANALYZE; `ComplianceDocumentService` is measured, see the next section): approval row summaries (`MAX(id) GROUP BY entity_id`), budget `spent_amount` with two NOT EXISTS, event financial summary, the clearance aggregate, `scopedOrganizationIds()`, election status sync, the audit log indexes.
- The Department Head with no college assigned has no Department Head account until the SAO creates one; seeders are skipped in production.
- Withdrawing a registration deletes the organization, so its earlier `audit_logs` rows lose their `organization_id` (the foreign key nulls them). The rows stay and keep their record id, action and actor; they just no longer filter under that organization. Accepted.
- The SAO may set a parent organization that belongs to another college. The rule (active, student organization, itself not a child) predates this branch and the SAO works across colleges, so it was left as is.

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

## Decisions already made, do not relitigate

- The SAO is the agency; colleges are a fixed list; a Department Head belongs to a college home organization and acts on its organizations; only the SAO creates heads. Organization lifecycle pending, returned, active, archived; archived is read only and the SAO restores it.
- Department Heads approve first (events, budgets, elections, financial reports); the SAO clears events that need SAO requirements. Heads do not vote or buy merchandise.
- Budget approval is single stage by the Department Head; SBO Officers and Department Heads read finance and never write; cash advances are not income or expense in reports.
- Task delegation weights role 0.35, workload 0.30, performance 0.20, recency 0.15, one keyword map equal to the Python map.
- Menu: "Finance" for managers, "My payments" for students; the groups follow the process order in `docs/UX_FLOW.md` section 3.
- The Evaluation module stays removed. No automatic data migration for old venue booking times (hand check of the live rows).
- Journey ceilings: the 390 px menu tap is not counted; the accepted deviations table in `docs/UX_FLOW.md` section 9 lists the rest. End-state assertions are never weakened to get green.

## Gotchas found the hard way

- Long workflows die when Windows restarts. Resume with `Workflow({scriptPath, resumeFromRunId})`; finished agents replay from cache. Results of a finished workflow sit in `~/.claude/projects/<project>/subagents/workflows/<run>/journal.jsonl`.
- The automatic permission classifier blocks bundled production writes and `sudo mysql` writes. Run read-only checks freely, show writes first, one command per call.
- Parallel live stacks must not share the file cache: set `CACHE_STORE=database` per stack, and relax only `RATE_LIMIT_*_PER_MINUTE` by env. PHP on Windows is about ten times faster with opcache enabled for the CLI (`PHP_INI_SCAN_DIR` with an ini holding `zend_extension=opcache`, `opcache.enable=1`, `opcache.enable_cli=1`).
- Journey specs share state: run them in the order recorded in `docs/UX_FLOW.md` section 9 (student, officer, admin, dept-head, sao) on a fresh seed; the Department Head and SAO specs open a new semester, which hides seeded events from the earlier ones.
- A fix loop left unbounded drifts into machinery (lock ordering, deadlock retries). Cap it at three rounds, then defer with a written reason.
- Worktrees sprawl: 35 registered, about 38 directories under `.claude/worktrees` (agent-*, integrate, jfix-*, sao-s*) with branches `worktree-agent-*`, `fix/sao-*`, `jfix/*`, `integrate/sao`, all merged into `main`. Clean up with `git branch --merged main`, then `git worktree remove --force <path>` per worktree and `git branch -d`. Not done yet.
- SQLite hides MariaDB bugs (quoting in SQL text matched by tests, `ONLY_FULL_GROUP_BY`, locks). `*.sql` is gitignored. Pint is a CI gate: run `vendor/bin/pint --test` before every push.
- Windows: long-lived processes need `Invoke-CimMethod Win32_Process Create`; a `cd` inside a compound bash command is blocked by a local hook (use absolute paths or `git -C`); LF in the repo and CRLF in the working copy is normal.
- One SAO grievance list load failure ("Failed to load grievances") was seen once at 390 px and not reproduced. Budget rows do not print their next step at desktop widths (same gap the financial report rows had, `FinancePage.jsx` near line 1349); no journey needs it.
- The default read rate limit is 120 per minute per user; a page fires about 10 reads. CORS preflights are cached now (`max_age` 600).
- Never touch MariaDB on port 3306 (a different server) or the local `hiusa_db`. Commits carry only `Co-Authored-By: John Carlo Borgueta <johncarloborgueta@gmail.com>`.

## Masterprompt for the next session

```text
You are continuing HIUSA, a school organization management system (React client in client/, Laravel API in server/, FastAPI AI service in ai-service/). This is a personal project: never mention work or any employer anywhere. The main model orchestrates and talks to me; Sonnet builder-lean agents write code and run suites; the Opus reviewer judges; no model override on subagents. Answer permission prompts, never bypass them. Plain prose, no em dashes, never the Artifact tool.

Read first, in this order: docs/HANDOFF.md (state, deploy plan, gotchas), CLAUDE.md (rules and established patterns), docs/UPGRADE_2026-10.md (the live upgrade runbook), then memory project-live-deploy-access for how SSH to the live server works.

Objective: ship the release to the live Lightsail server and get members testing. main equals origin/main at 4c19464; nothing is deployed; the live server is on 9f9fef7 with real data (5 organizations, 16 users).

Tasks, in order:
1. [Pending verification] CI on 4c19464: gh run list -R prodoc-zen/Hiusa-FULL --limit 3; read the job log of any red job first.
2. [Planned] Live deploy, authorised by me on 2026-10-11, you run it over SSH: read-only recheck, ask me to take the Lightsail snapshot, mysqldump to /var/backups/hiusa, then docs/UPGRADE_2026-10.md sections 4 to 7 one command at a time, showing every write first. Reconcile migrate:status (four new migration files) before migrating. Compare the one pending live venue booking by hand. Say deployed only after /up, scripts/upgrade-checks.sql and a smoke test as each role pass, and show me the output.
3. [Planned] Members test: make scripts/serve-lan.ps1 work with a fresh seeded throwaway database (the XAMPP 3307 database is broken, I chose a fresh seeded copy), verify it from a second device, hand me the address and docs/MEMBER_TESTING.md.
4. [Planned] Clean up merged worktrees and branches (list first, then remove with git worktree remove and git branch -d after git branch --merged main).
5. [Waiting on me] The open decisions in HANDOFF.md (college page creating Admin and students, SAO organization context, live totals while voting, entity_type backfill, finance items, rotating the Lightsail key).

Out of scope unless I say so: re-adding the Evaluation module, blocking budgets beyond ledger funds, editing financial semesters, changing anything under "Decisions already made".

Gates before any push: vendor/bin/pint --test, php artisan test, npm run lint, npx vitest run, npm run build; after migration or query changes also the full suite on your own throwaway MariaDB. Tokens: read files with line ranges, brief subagents with the answer, read workflow results from journal.jsonl with a filter.

Done means: the release is live and healthy with the checks shown to me, members can test, CI is green.

Never: bare git commit, git add -A, git stash; AI co-author lines (only Co-Authored-By: John Carlo Borgueta <johncarloborgueta@gmail.com>); touching MariaDB on 3306 or the local hiusa_db; printing or copying the SSH key; a done-claim without a check that can fail.
```
