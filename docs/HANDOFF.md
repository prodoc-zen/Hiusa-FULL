# Handoff, HIUSA, 2026-10-20 (work moves to Antigravity)

## Update 2026-10-21 (current progress)
The working branch integrate/2026-10-20 incorporates origin/main (latest f31fac6) and ports the 62885ef improvements (5 s cache TTL, useRefetchOnReturn, Agency overview into Colleges). The 10-item Semestral and Financial Report checklist is implemented in ComplianceRequirementType::SEMESTRAL_REPORT_NAMES, AcademicSemesterController, and SeedSemestralReportRequirement, covered by unit and feature tests. A comprehensive Standard Operating Procedures and User Journeys manual covering all 5 roles and 6 lifecycles is published in docs/SOP_AND_USER_JOURNEYS.md. Next tasks: live role smoke test on Lightsail, member testing via scripts/serve-lan.ps1, and venue booking 3 time-shift approval.

## Update 2026-10-20 (supersedes the push notes below)
origin/main is now 29 commits ahead of local main (latest f31fac6 "fix: restore blue UI theme", 2026-10-20) and the two differ in 382 files. Local main holds one unpushed commit, 62885ef. Upstream already ships every event, election and renewal requirement John listed: AcademicSemesterController EVENT_REQUIREMENTS (3 inside, 15 off campus), the election informative letter (ElectionPickerPage), and RegistrationRequirementCatalog::NAMES (10 renewal items). The one gap is the Semestral and Financial Report checklist: upstream has a single requirement, ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT, not John's 10 items. Plan: integrate in a separate worktree from origin/main, port only what 62885ef fixes that upstream lacks, then build the semestral checklist. The masterprompt for Antigravity is in the chat reply of 2026-10-20.


## State in one line
Work is COMMITTED locally as 62885ef on main and fully verified, but the PUSH WAS REJECTED: origin/main has 22 commits I do not have (all dated 2026-10-15, author shown as unknown: Parts 3 to 7 SAO/college work, "perf: harden API caching and streamline organization loading", Department Head profiles, timed sessions). A dry-run merge shows 21 conflicts in the same SAO files (App.jsx, navigation.js, SystemCollegesPage, SystemOrganizationsPage, SuperAdminHomePage, SystemAdministrationController, systemAdministrationService, UX_FLOW and more; SaoAgencyPage is modified upstream and deleted by me). Nothing pushed, nothing deployed. Do not force push.

## Verified before the commit
Gates green (pint, phpunit 966, lint, vitest, build). Live e2e on a fresh seed: all 52 journeys pass (officer 390px O1 to O4 passed after reseed, the earlier reds were used-up seed data), freshness 3/3, hierarchy-live 15/15, route-smoke 8/8, visual-live 3/3. Layout probe: Colleges page no sideways scroll and 0 console errors at 1366 and 390. Manage orders row height was not measured (table rows not found by the probe); O2 passes.

## The very next action
Ask the user who made the 22 upstream commits (branches feat/overall-feedback-20261013 and feat/part-7-feedback-20261015 also exist on origin) and decide: merge origin/main into my work, or rebase mine on theirs. Do it on a new branch first (git switch -c integrate-origin from 62885ef, then merge origin/main), resolve conflicts keeping both intents (their Part 3 to 7 features, my profile-based admin lists, 5 s cache plus useRefetchOnReturn, Agency merged into Colleges), then rerun all gates and the e2e run, and only then push and deploy. Check their cache change (6f072ab) against my 5 s TTL and cache:false reads.

## Still true
Deploy to staging 13.228.227.182 is authorised by the user (backup to /var/backups/hiusa first, git pull --ff-only, build with VITE_API_CACHE_TTL_MS=5000, config:cache, route:cache, reload php8.3-fpm, restart queue and scheduler). Excluded from commits: .claude/settings.json, commit_all_phases.ps1, docs/HANDOFF.md, docs/parked-enable-mail.patch, .vscode, Plant_Talks_Presentation, paper files, docs/diagrams, embed-logo.js, node_modules, scripts/fix.js, scripts/fix_layout.py, test-results, test_write.tmp.
## Decisions already made
Agency overview merged into Colleges (user approved). Mail is parked. Demo of 2026-10-14 was cancelled. Meeting with CCS Dean Janette Q. Tanquis is Friday 2026-10-16. SOP release work waits for the user's go. Never leave Admin@123456 on a public host.

## Gotchas
PowerShell hook blocks cd/Set-Location text in compound commands; write .ps1 files and launch with Start-Process. Piping serve-lan.ps1 output hangs. Run vitest as env -C /c/BSIT/React/Hiusa-FULL/client npx vitest run. Foreground sleep is blocked in Bash. Never touch MariaDB on 3306, 3307, 3399 or hiusa_db. Never read env files. Review leftover notes (non-blocking): members_count can exceed the role-count sum; default-expanded college card is computed once per mount.

## Open items for the user
Real dean names for the colleges without a head; college codes; SOP release go-ahead; whether to reseed staging clean (wipes group test data).

## Masterprompt for the next session
Opus 5.5 plans, Sonnet builder-lean agents build, Opus reviewer judges, permission prompts are answered not bypassed. Read docs/HANDOFF.md first. HIUSA is a personal capstone, no Prime conventions. Objective: finish verifying and ship the uncommitted organization-freshness and Agency-into-Colleges work before the 2026-10-16 meeting. Tasks in order: 1 reseed local stack and rerun officer 390px journeys; 2 run freshness, hierarchy-live, route-smoke, visual-live specs and the 1366/390 layout check; 3 fix anything red; 4 re-run lint and commit by path (list in the handoff); 5 push; 6 deploy to staging with backup first; 7 demo-smoke and a live look at the SAO Colleges page. Never: bare git commit, git stash, git add -A, em or en dashes, a done-claim without a check that can fail.

