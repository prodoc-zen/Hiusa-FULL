# Handoff: HIUSA SAO and Department Head restructure, 2026-10-09 (Asia/Manila)

## State in one line

main equals origin/main at 9f9fef7 (the collaborator's latest commit, merged; nothing unpushed). Client 479 tests pass, server 526 pass with 6 skipped (live AI parity tests skip while the AI service is down), lint clean. The dev database is behind: the collaborator's newest migrations (for example 2026_10_06_000009_add_organization_color_and_college_logo and 2026_10_06_000010_add_category_to_tasks) have not been run on it. The new dean-feedback task set below has not been started. Code graphs for client, server and ai-service were refreshed today.

## Done and verified

- Everything in docs/PAPER_SCOPE_ADDENDUM.md "Built" list and docs/FINANCE_AUDIT_2026-10-06.md "Fixed and pushed" table is merged and pushed. Proof: `cd server && php artisan test` printed 526 passed, 6 skipped; `cd client && npx vitest run` printed 479 passed (both on 2026-10-09 after the last merge).
- The 23-page browser sweep across all five roles was clean on 2026-10-06 after the merge of the collaborator's academic-period work. It has not been rerun since the nine newest collaborator commits.
- AI parity: the PHP fallback matches the live Python engine (AiFallbackParityTest, 17 passed with the AI service running on 8001, on 2026-10-06).

## In flight

- The independent reviews of this session's shipped work (one for finance, one for everything else) never ran. Every attempt died on the weekly spend limit before reading a file. Treat the shipped work as tested but not independently reviewed.
- docs/USER_GUIDE.md is an untracked 689-line draft left by an agent that died mid-task. It was never checked against the code and mentions Evaluation 20 times, but the collaborator has since removed the Evaluation module. Do not commit it as is.
- The collaborator removed the whole Evaluation module (commit 46790dd) and edited the addendum and Study Objectives code. The addendum section 2.2, docs/USE_CASE_INVENTORY.md and the objectives wording for SO1 and SO4 still describe it. Not yet reconciled.
- Two finance decisions are waiting on the team: block budgets and cash advances beyond funds in the ledger, and editing or removing financial semesters (see "Still open" in docs/FINANCE_AUDIT_2026-10-06.md).
- Smaller leftovers: the dashboard monthly trend and the admin chart still count cash advances as spending, and the shared Modal gives every dialog the same label id, so a dialog opened over another is announced with the first one's name.

## The very next action

Start MariaDB, back up, then bring the dev database up to date, and read what the collaborator already built that overlaps the new tasks before designing anything:

```bash
git log --no-merges --format='%h %s' 8334829^..HEAD | head -20
git show 78ba61e --stat | head -30      # allow SAO to assign Admin organization profiles
git show c83f6a9 --stat | head -30      # college-scoped organization membership search
git show 441fc44 --stat | head -30      # organization profile deletion
```

Then write a one-page design for the agency, college, organization hierarchy (task 2 below) and put open question 1 to Jade with a recommendation before any code.

## Tasks, in the order they run

Source of tasks 2 to 12 is Jade's message of 2026-10-09 after the dean's feedback. The model for the hierarchy is a GoHighLevel agency with sub-accounts: the SAO is the agency, each college is a sub-account it already holds, and each organization is a sub-account inside a college.

1. Planned. Read the collaborator's overlapping commits (command above) and run `php artisan migrate` on the dev database after a backup. Moves: this session. Not done yet because MariaDB is down.
2. Planned. Design the hierarchy: colleges exist in the SAO already and are never added by hand; a Department Head belongs to a college and not to an organization (today DepartmentHeadSeeder puts each head inside an organization such as PSITS-CCS, and Organization stores its college as a name string). Needs open question 1 answered.
3. Planned. Remove the SAO's ability to create colleges and organizations (SystemCollegesPage, SystemOrganizationsPage, and the POST routes under /system/colleges and /system/organizations). Colleges become a fixed seeded list the SAO can view.
4. Planned. The college's main page user (the Department Head) creates an organization and submits it with its requirements to the SAO for approval. The SAO approves or returns it. Inside an approved organization live the roles Admin, SBO Officer and Student. Reuse the approval-request machinery (ApprovalRequestController, config/approvals.php). Authorization sensitive: needs the security review gate.
5. Planned. Archive organizations that are no longer in use: still visible to the SAO, read-only, nothing can be changed. Organizations already have an is_active column; archiving needs a clear state, write blocking, and a visible archived list.
6. Planned. Find the screens that have create and edit but no delete button and add delete where it is allowed. Needs open question 3 answered, or a systematic sweep of every module page.
7. Planned. One Compliance home for every report that needs file submission: event requirements submitted with an event proposal, the semestral report, and the organization renewal every semester. Today these are separate (SaoCompliancePage, SaoEventRequirementsPage, EventSubmissionPanel, ComplianceController).
8. Planned. In Compliance, a "track documents" view: per organization a dropdown list of what it has already submitted, with the ability to open each file.
9. Planned. SAO Venues gets the same availability calendar the Admin sees, in a Google Calendar style: who occupies the venue and when. VenueAvailabilityTimeline already exists and is used by VenueBookingPage; SaoVenuesPage does not use it.
10. Planned. Decide what "Received Reports" is for (SuperAdminFinancialReportsPage, the SAO financial report final approval) now that Compliance exists. Needs open question 2 answered.
11. Planned. Reconcile the removed Evaluation module across docs/PAPER_SCOPE_ADDENDUM.md, docs/USE_CASE_INVENTORY.md and the Study Objectives wording, then fix or discard the docs/USER_GUIDE.md draft.
12. Planned. Rerun the independent review of the shipped work once the spend limit allows, then the 23-page browser sweep.

## Commands to get back to green

```bash
cd client && npm install && npx eslint src && npx vitest run     # 479 passed
cd server && php artisan test                                   # 526 passed, 6 skipped with the AI service down
cd ai-service && ./.venv/Scripts/python.exe -m pytest -q tests  # 31 passed (last run 2026-10-06)
```

If one or two FinancePage export tests fail in a full client run, rerun that folder alone: `npx vitest run src/pages/modules/finance` prints 26 passed. They load exceljs for the first time under 20 parallel workers.

## Decisions already made, do not relitigate

- Budget approval is single stage by the Department Head; the SAO has no ledger access (config/approvals.php, addendum decision (i)).
- SBO Officers and Department Heads read finance but never write it; only the Admin writes.
- Finance dates leave the API in Manila time with an offset. The client reads the first ten characters as the calendar day, so do not return them to UTC.
- Cash advances stay in the ledger but are not income or expense in reports and forecasts.
- Task delegation uses four factors (role 0.35, workload 0.30, performance 0.20, recency 0.15) and lives in three places that must change together.
- Demo account note: on this dev database the SAO director is School ID 930027 with the officers' password tier; README lists 990001 for fresh seeds.

## Open questions for Jade

1. Where does a Department Head live in the data? Recommendation: make each college a first-class record (a COLLEGE organization type) that the Department Head account belongs to, with organizations pointing at their college by id instead of by name string. The alternative is a college_id on the user with no organization.
2. Is "Received Reports" the financial report final approval only? Recommendation: fold it into Compliance as a "Financial reports" document type and keep the approval action there, so the SAO has one place.
3. Which screens are missing delete? A list from Jade is faster than a sweep.
4. Which part of the GoHighLevel agency and sub-account setup should we mirror: the agency overview of all sub-accounts, the sub-account creation and approval flow, role scoping inside a sub-account, or switching into a sub-account? No GHL details have been verified yet.
5. Confirm the Evaluation module removal is intended for the paper's SO1 and SO4 evidence, since the Study Objectives page shows evidence from it.

## Gotchas found the hard way

- Run both suites before pushing a merge, not after. The collaborator's last pushes needed `npm install` (exceljs) and carried an unused variable that broke lint; I found both only after pushing.
- After every pull from the collaborator: `npm install` in client, backup then `php artisan migrate` on the dev database, restart the AI service with `HIUSA_AI_RELOAD=false`.
- Dev database is XAMPP MariaDB on 3307. Port 3306 is a different server; never touch it. Backups from this session sit in the session scratchpad as devdb_before_*.sql; take a fresh one before any migrate.
- Background shells die after about 10 minutes (MariaDB, API, Vite, AI service). Restart them before any browser check. An old Vite may survive on 5173.
- Sub-agents die silently on the spend limit (HTTP 429): three reviewers, the user guide writer and the finance audit all died. Builders ran fine when the limit was clear. Check `git status` for half-written files and stray scratch tests after any failed agent (the finance audit left three Scratch test files, since deleted).
- Writing Python edit scripts: escapes inside bash heredocs break on backslashes and quotes. Write the script file with the Write tool, with raw strings, and run it.
- A PHP test helper named setup() collides with PHPUnit's setUp (names are case insensitive).
- Factories randomize fields. Pin status, budget_id, event_id, payer_id and receipt_reference in tests.
- The shared Drawer portals through AccessibleOverlay; a backdrop left in the app tree covers its own panel.
- Seeders run without model events, so DatabaseSeeder backfills account_profiles and tasks.assigned_at itself.
- The collaborator's commits have author "unknown" and mine have "Jadehaerys". Use `--author` to separate them.
- Read the collaborator's commits before building anything in their area. They removed the Evaluation module and extended academic years while I was building on both.

## Files touched

Too many to list. Use `git log --no-merges --author=Jadehaerys --format='%h %s' 6b94a92..HEAD` for the whole session. Main areas: server/app/Services/Dashboard (briefing, setup checklist), server/app/Http/Controllers (finance, SAO administration, users import, notifications, academic years), client/src/components (dashboard kit, ui kit, finance, profile, users), docs (addendum, inventory, finance audit, this file).

## Masterprompt for the next session

```text
You are continuing work on HIUSA, a school organization management system (React client in client/, Laravel API in server/, FastAPI AI service in ai-service/). Routing: Opus orchestrates and talks to me; Sonnet builder agents (builder-lean when no browser is needed) write code and run the suites; the reviewer may be Opus. Answer permission prompts; never bypass them. Sub-agents die silently on the spend limit, so after any agent failure check git status for half-written files.

Read first, in this order: docs/HANDOFF.md (state, tasks, gotchas), CLAUDE.md (rules and established patterns), docs/USE_CASE_INVENTORY.md section 9 (decisions), docs/PAPER_SCOPE_ADDENDUM.md, docs/FINANCE_AUDIT_2026-10-06.md. No signed scope exists; my message after the dean's feedback is the spec.

Objective: the Student Affairs Office (SAO), college Department Heads and organizations should follow a clear hierarchy that the dean accepts: the SAO is the agency, colleges already exist inside it, and each college's Department Head creates organizations and sends them with their requirements to the SAO for approval. Within an approved organization live Admin, SBO Officer and Student. Model it on a GoHighLevel agency with sub-accounts.

In scope, in this order (full detail in HANDOFF.md "Tasks"):
1. Read the collaborator's overlapping commits (78ba61e, c83f6a9, 441fc44, 9f9fef7) and migrate the dev database after a backup.
2. Design the agency, college, organization hierarchy and the Department Head's place in it. Put open question 1 to me with a recommendation before coding.
3. Remove the SAO's ability to create colleges and organizations; colleges become a fixed seeded list.
4. Department Head creates an organization and submits it with requirements to the SAO for approval.
5. Archive unused organizations: visible to the SAO, read-only.
6. Add delete where it is missing (I will list the screens, or sweep every module page).
7. One Compliance home for all file-submission reports: event requirements, semestral report, semester renewal.
8. A track-documents view in Compliance: per organization, what it submitted, with files openable.
9. SAO Venues gets the availability calendar the Admin already has (VenueAvailabilityTimeline).
10. Decide what Received Reports is for now that Compliance exists.
11. Reconcile the removed Evaluation module across the addendum, inventory and Study Objectives wording; fix or discard the docs/USER_GUIDE.md draft.
12. Rerun the independent review of the shipped work and the 23-page browser sweep.

Out of scope: the two finance decisions waiting on the team (blocking budgets beyond ledger funds, editing financial semesters), re-adding the Evaluation module, and restyling pages the collaborator is actively restyling.

State: main equals origin/main at 9f9fef7, nothing unpushed. Dev database is behind on the collaborator's newest migrations. MariaDB, API, Vite and the AI service are not running.

Phases: recon inline with exact greps and `python -m graphify query` before reading trees. Plan mode for the hierarchy design (it touches authorization and data model). Build in slices on disjoint files, Sonnet builders, each with a test that fails before and passes after; worktrees need their own composer install and a sqlite :memory: .env. Gates before merge: run the suites, browser check of every changed screen as the affected roles (SAO 930027, Department Head, Admin, Student), security review on anything touching authorization or approval, UI review on UI changes. Migrations are expand-only with a mysqldump first.

Graphify, before and after every build and merge: `python -m graphify update client`, `python -m graphify update server`, `python -m graphify update ai-service` (run from the repo root, once as the baseline now).

Tokens: read files with line ranges (sed -n, grep -n, cut -c1-160), brief subagents with the answer, read agent results from their final report only.

Green: `cd client && npm install && npx eslint src && npx vitest run` prints 479 passed; `cd server && php artisan test` prints 526 passed (6 skipped with the AI service down); `cd ai-service && ./.venv/Scripts/python.exe -m pytest -q tests` prints 31 passed.

Done means: the SAO can no longer create colleges or organizations; a Department Head can create an organization and the SAO can approve it; archived organizations are read-only; Compliance shows and opens every submitted file; the SAO sees venue occupancy on a calendar; the hierarchy is demonstrable end to end in the browser as each role.

Never: bare git commit or git add -A (commit by exact paths); AI co-author lines (CLAUDE.md requires only Co-Authored-By: John Carlo Borgueta <johncarloborgueta@gmail.com>); the Artifact tool; em dashes; a done-claim without a check that can fail; touching MariaDB on port 3306.
```
