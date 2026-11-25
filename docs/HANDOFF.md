# Handoff: HIUSA, AI test + r20.4 + storyboard done, 2026-11-24 PHT (session 9)

## r23 Ask AI facts, 2026-11-25

r23 is on prod and origin/main. Prod HEAD `b5686ca2a70cf72f345d465219a9c1f0644ca57e`, `/up` and `/login` 200, `/api/health` reports sha `b5686ca2a70c`, database ok, and nginx, mysql, php8.3-fpm, hiusa-ai, hiusa-fingerprint, hiusa-queue and hiusa-scheduler are active. origin/main had not moved since r22, so main was fast-forwarded to release/r23 (f1acb23a to b5686ca2) with no merge and the suites were not re-run here; they were gated on the release branch. Deployed over ssh with `scripts/deploy-lightsail.sh` piped through `tr -d '\r'`; the script reported nothing to migrate and held stock for 0 pending orders.

### What shipped

| Sha | What |
|---|---|
| 9e659dfc | F1 and F2: a budget with ledger entries, archived ones included, says "This budget has ledger entries, archived ones included, so it stays on record."; an event with ledger entries cannot be deleted and says to cancel it instead. |
| ccea245c | Ask AI facts: upcoming events with their tasks, pending budgets with amounts, a report preparation intent, the budget working on the record search. |
| 4cf25a02, b5686ca2 | Review rounds 1 and 2: the event tasks route needs an upcoming phrase and keeps overdue, workload and own-task questions on the task list, an officer's event row counts every task, a cancelled event with ledger entries is told it is already cancelled. |
| 6d0f2803 | QA sheets use the new budget delete message. |

### Backups (host, /var/backups/hiusa)

- `predeploy-r23-20261125T005750Z.sql.gz` (210,049 bytes, 85 CREATE TABLE lines) and `predeploy-r23-20261125T005750Z-files.tar.gz` (109,231,951 bytes), `gzip -t` passed on both.
- The script's own `hiusa_db-pre-deploy-20261125T005809Z.sql.gz`.

### Ask AI eval on prod, same 6 questions, same rubric

Files in `D:/Claude/scratch/hiusa-r22/eval/`: `r23.json`, `truth-r23.json` (fresh from the database, archived rows skipped), `grading-r23.json`, `grading-r23.md`. Graded by the session against the database, not by the model that wrote the answers.

| id | Question | Baseline | r22 | r23 | Guard replaced (baseline / r22 / r23) |
|---|---|---|---|---|---|
| q01 | How is our finance? | 6 | 10 | 7 | yes / no / yes |
| q02 | Which budget is closest to running out? | 9 | 10 | 10 | no / no / no |
| q03 | What should I do before submitting the financial report? | 5 | 5 | 9 | yes / yes / no |
| q04 | What events are coming up and what tasks do they have? | 5 | 5 | 10 | no / no / no |
| q13 | Which organizations need my approval? | 10 | 9 | 10 | no / no / no |
| q14 | What budgets are waiting for me to approve and how much? | 6 | 6 | 10 | no / no / no |
| Total | | 41 | 45 | 56 | 2 / 1 / 1 |

Latency, first token then total in ms (baseline total about 3,300 on average):

| id | r22 first | r22 total | r23 first | r23 total |
|---|---|---|---|---|
| q01 | 7505 | 13821 | 10229 | 15813 |
| q02 | 5097 | 8797 | 5175 | 9590 |
| q03 | 6866 | 8994 | 7989 | 14077 |
| q04 | 7172 | 13065 | 6589 | 11925 |
| q13 | 8774 | 11270 | 6143 | 9028 |
| q14 | 8463 | 12478 | 5943 | 8857 |

Mean total 11.4 s in r22 and 11.5 s in r23, all well under the 60 s chat limit. The 6 eval conversations (ids 29 to 34) were deleted through the app, status 200, none still listed. No audit_logs row was touched and no consent field was written.

What is still wrong:

- q01 hit the guard again and the user saw the fixed summary: no verdict, no next step. The log line is `unexpected_value -2.0`, the same value the baseline guard logged. Likely the model mentions the two archived 2.00 rows from the r21 live check, which are not in its facts (a guess, not verified). Look at `GuardsGeneratedText` and the facts for finance_health.
- q03 no longer uses the fixed summary but omits the two overdue tasks (Follow up unpaid organizational fee list, Update official member roster for 2024-2025).
- q13 sends the Returned accreditation to the Organization applications screen, which is the new-organization pipeline, so that link only half fits. The Returned accreditation itself is true.
- q02 and q03 treat the two unlinked order income entries as something the Treasurer should link; arguably they are auto-created and need no action.

### Live check F1 and F2 (PSITS President 900001)

Neither new message could be shown live without writing to the ledger, so both are covered by `BudgetDeleteGuardTest` and `EventDeleteGuardTest` only.

- F1: a ledger entry can only be linked to an approved budget (`TransactionController`, "must belong to this organization and be approved"), and an approved budget is refused earlier with "Cannot delete an approved budget". A throwaway draft budget therefore cannot hold archived entries, and the only entries that are archived (17 and 18, 2.00 each) have no budget. The new text is reachable only for a legacy unapproved budget that still has entries. No budget was created.
- F2: read-only `GET /api/events` as 900001 returns `delete_blocked_reason` for each event: Leadership Seminar "it is ongoing", Sports Fest 2024 "it has already been reviewed in the approval workflow", General Assembly "it is completed", Induction and Recognition Ceremony null. Every event that has ledger entries is shadowed by an earlier blocker, so the ledger message cannot appear on current data. Showing it live needs a ledger entry on event 4 (the only deletable event), which would also leave event 4 undeletable for good. Not done; no DELETE was sent and no event was touched.

### Open items

- The Treasurer (900004) live check and the 8 other eval questions (q05 to q12) stay blocked by the Data Privacy Notice gate; nobody consented for those accounts and none was written.
- The items under "What is still wrong" above.
- Worktrees hiusa-r23, hiusa-r23-askai and hiusa-r23-fin were removed with `wt-remove.mjs`; the branches release/r23, feat/r23-askai-facts and fix/r23-finance-followups are kept.

## r21 finance fixes + r22 smarter AI, 2026-11-25

Both releases are on prod and origin/main. Prod HEAD 1c89c462d406e4945cefc4003e8961b52db49adc, `/api/health` reports sha 1c89c462d406.

### What shipped, with shas

| Release | Sha | What |
|---|---|---|
| r21 | 4f1239be | Finance fixes: transactions get an archive and edit trail, the per-event ledgers, Budgets ledger net balance read through `LedgerScope`, repair migration for unapproved budget links. |
| r22 (branch tip before the merge) | 7b32f5b4 | Smarter AI: Claude Opus 5.5 for one-shot and chat, Groq gpt-oss-120b, numeric guard takes derived figures, finance facts count unlinked ledger rows, event plan deadline 45 s. |
| r22 merge of origin/main | 023c54e1 | Clean merge, no conflicts. |
| r22 merge fix, deployed | 1c89c462 | Ask AI finance facts (`AskAiService::ledgerPicture`) now read through `App\Support\LedgerScope`, so archived rows are left out and the net equals the Ledger summary net. The duplicate archived guard in the knowledge corpus was removed. New test `AskAiSmarterAnswersTest::test_the_finance_facts_net_equals_the_ledger_summary_net_with_an_archived_entry_present`, watched red against an unscoped read and green after. |

Gate before the push: server suite 3755 tests green (run alone; a first run beside the client suite failed 6 file-storage tests that pass alone), client vitest 311 files and 4389 tests green with `--maxWorkers=4`, AiFallbackParityTest live tests ran against the local engine on 8001 (none skipped), `pint --test` clean on the changed files. Note: the main checkout's `client/node_modules` lacks `rehype-sanitize`; the worktree needed its own `npm ci`.

### Backups (host, /var/backups/hiusa)

- r21: `predeploy-r21-20261124T232328Z.sql.gz` (107 KB, 85 tables) and `predeploy-r21-20261124T232328Z-files.tar.gz` (109 MB), plus the script's own `hiusa_db-pre-deploy-20261124T232359Z.sql.gz`.
- r22: `predeploy-r22-20261124T234737Z.sql.gz` (182 KB, 85 CREATE TABLE lines) and `predeploy-r22-20261124T234737Z-files.tar.gz` (109 MB), `gzip -t` passed on both; the script's own `hiusa_db-pre-deploy-20261124T234809Z.sql.gz`.
- Env copies before the r22 edit: `/var/backups/hiusa/env-pre-r22-20261124T234737Z/` (`laravel-native.env`, `server.env`, directory mode 700, files 600). Never copy these off the host.

### r21 live result (prod)

- Admin live check green at 1440 and 390 px. The Treasurer (900004) check did not run: the account is on the privacy consent gate and nobody accepted it for them.
- Migrations `2026_11_25_000001_add_archive_and_edit_trail_to_transactions` and `2026_11_25_000002_repair_unapproved_budget_links_and_remaining` are in the `migrations` table.

| Check | Before | After |
|---|---|---|
| Transactions linked to an unapproved budget | 1 | 0 |
| `budget_unlinked` audit rows | 0 | 1 (entry 8, reason "Budget not approved", moved to event 3) |
| Sports Fest 2024 Budget (id 2, pending_department_head, allocated 25,000) remaining | 21,200 | 25,000 |

Relink, applied through the app as PSITS President 900001 with the reason "Linked to its event after the per-event ledger release" (updated audit rows 29 to 32). Plan: `D:/Claude/scratch/hiusa-r21/relink-plan.json`.

| Entry | Event | Why |
|---|---|---|
| 3, sponsorship from TechPH (income 10,000) | Sports Fest 2024 | Description names Sports Fest, the only such event |
| 5, AVR rental (5,000) | HIUSA General Assembly | Description names General Assembly |
| 6, snacks and drinks (80 pax) | HIUSA General Assembly | Description names General Assembly |
| 10, van rental round trip | Leadership Seminar 2024 | Description names Leadership Seminar |

Left unlinked on purpose (ambiguous or org-wide): entries 1, 2, 4, 7, 9, 11, 12, 15.

### r22 models, effort and env

Defaults now in force on prod (read back with tinker after `config:cache`, values only): Anthropic model and chat model `claude-opus-5-5`, effort `medium`, chat effort `high`, timeout 25 s, chat timeout 60 s; Groq model `openai/gpt-oss-120b`, reasoning effort `medium`; plan deadline 45 s; provider `anthropic`.

Env names changed: only `GROQ_MODEL` (the pinned `openai/gpt-oss-20b` line was removed from the host `server/.env`). `ANTHROPIC_MODEL`, `ANTHROPIC_CHAT_MODEL`, `ANTHROPIC_EFFORT`, `ANTHROPIC_CHAT_EFFORT`, `ANTHROPIC_TIMEOUT`, `GROQ_REASONING_EFFORT` and `AI_PLAN_DEADLINE_SECONDS` were not pinned anywhere, so nothing to remove. `/etc/hiusa/laravel-native.env` holds only the AI service URL and key and was not touched. Left as is and not in the brief: `GROQ_TIMEOUT=30` (code default is 12), `AI_PROVIDER=anthropic`.

### Live AI proof (prod, as PSITS President 900001, role ADMIN, 25 Nov 2026 PHT)

| Call | Log line | Model | stop_reason | Latency | Output tokens | Limit | Result |
|---|---|---|---|---|---|---|---|
| Budget advice, General Operations Fund | `AI text served.` operation generate | claude-opus-5-5 | end_turn | 4.8 s (HTTP 5.1 s) | 444 | 25 s | pass |
| Event plan, Induction and Recognition Ceremony | operation generateStructured | claude-opus-5-5 | end_turn | 18.0 s (HTTP 18.4 s) | 1852 | 45 s | pass |
| Ask AI chat turn (q02) | operation converse | claude-opus-5-5 | end_turn | 8.9 s | not logged for chat turns | 60 s | pass |

The plan call left one pending draft (`ai_outputs` id 45, event 4, decision_status pending, version 1, no tasks created); it is left in place. The chat conversation was deleted through the app.

### Ask AI eval, baseline vs after (same 6 questions; 8 others blocked by the privacy notice)

Files in `D:/Claude/scratch/hiusa-r22/eval/`: `grading-baseline.md`, `grading-after.md`, `after.json`, `truth-after.json`.

| id | Question | Baseline | After | Guard before / after | First token before / after | Total before / after |
|---|---|---|---|---|---|---|
| q01 | How is our finance? (President) | 6 | 10 | yes / no | 1.3 s / 7.5 s | 3.3 s / 13.8 s |
| q02 | Which budget is closest to running out? | 9 | 10 | no / no | 1.4 s / 5.1 s | 3.6 s / 8.8 s |
| q03 | What should I do before submitting the financial report? | 5 | 5 | yes / yes | 1.7 s / 6.9 s | 3.1 s / 9.0 s |
| q04 | What events are coming up and what tasks do they have? | 5 | 5 | no / no | 1.6 s / 7.2 s | 4.0 s / 13.1 s |
| q13 | Which organizations need my approval? (Dept Head) | 10 | 9 | no / no | 1.2 s / 8.8 s | 2.4 s / 11.3 s |
| q14 | What budgets are waiting for me to approve and how much? | 6 | 6 | no / no | 1.1 s / 8.5 s | 3.1 s / 12.5 s |
| Total | | 41 / 60 | 45 / 60 | 2 of 6 / 1 of 6 | | |

Said plainly: score up 4 points, but q13 got worse (a true budget figure is presented as a defect to the Department Head), q03, q04 and q14 did not improve, and every answer is about three times slower (first token 5 to 9 s, total 9 to 14 s, all inside the 60 s limit). Reasoning now streams (500 to 1,000 characters per answer; none arrived before).

### Open items

- Ledger item 21 is fixed: q01 no longer answers 0.00, states the unlinked rows and the ledger net 2,705, which equals LedgerScope and the Ledger page (archived rows left out).
- 8 eval questions (q05 to q12: Treasurer 900004, PIO 900006, VP Internal 900002, student 2100142) stay blocked by the privacy notice; each person has to accept it themselves.
- Not fixed by r22, still failing in the eval: q03 (misrouted to ai_tools, then the guard replaces the answer), q04 (says no upcoming events exist), q14 (says the budget amounts are not visible), and the new q13 warning about budget figures that "do not add up".
- `GROQ_TIMEOUT=30` is still pinned on the host; the r22 code expects 12 for Groq.
- The Treasurer (900004) r21 live check has not run (consent gate).
- `truth-after.json` counts two archived 2.00 rows left by the r21 live check (its expense total reads 49,804 against 49,800 on the Ledger page); fix `eval/truth/admin.php` to skip archived rows before the next eval.
- Chat turns log no output token count (`Claude answered a conversation turn.`); only one-shot calls do.
- The main checkout still has an uncommitted `client/src/components/ui/StatusToggleSwitch.jsx` from before this work.

## State in one line
Prod and origin/main at dee87264 (r20.4), reseeded with demo data 11-24; the finance switch, Ask AI position, voice and receipt-attach builds died on a subagent login failure with partial uncommitted work in five worktrees (see STOPPED below); docs for John, the team and Mary Jasmin are ready to send. This project keeps no docs/TASKS.md: the numbered list below is the ledger.

## Task ledger (numbered, the ledger of this project)
- 7 [Jade] Send John the v6 testing docx, pdf and zip (v6 supersedes v5). The zip holds the seeded demo passwords: teammates only.
- 8 [Jade] Grammarly pass over the whole testing document.
- 9 [Jade] Five prod accounts never accepted the privacy notice (all but SAO 990001); each person accepts on first sign-in before the defense.
- 10 [Blocked on Jade] Devices: fingerprint enroll, scan and check-in, real phone walk, reset mail to a test student, receipt Print on iPhone.
- 11 [Blocked on Jade] Manuscript data: alpha scores, Table 87 respondents, Finding 5 survey.
- 13 [Waiting on John] TOC and table ordering in John's merged manuscript (needs his latest merged docx).
- 16 [Jade] Send Mary Jasmin the updated Table 28.
- 18 [Jade] Send John "C:/Users/JM/Downloads/HIUSA - Overall Context.md" (for ChatGPT; no secrets, no IP, verified by grep).
- 19 [Jade] Send the team "HIUSA - AI Features Test Guide" docx/pdf (ERD folder, 57 pages, 35 result rows).
- 20 [Jade] Send Mary Jasmin "C:/Users/JM/Downloads/HIUSA - Storyboard (2026-11-23)/HIUSA - Storyboard (SIZE column, 12 modules).docx" and .pdf (89 boards, 189 pages). Tell her: figures now run 68 to 156, so every figure after the storyboard in the manuscript shifts by 32; DATETIME size 25 is our convention (her sample shows DATE 15 only); Student Sign-up stays board 2 (not duplicated).
- 21 [Fixed 2026-11-25, r22] Ask AI as Admin "How is our finance?" no longer answers 0.00 when ledger rows are not linked to a budget: the finance facts read through LedgerScope, state the unlinked rows, and the ledger net equals the Ledger page (eval q01 6 to 10 of 10). Update the AI guide entry.
- 22 [Optional] Handover remarks and the report explainer as dean/SAO were never exercised live (need a finalized election / an irreversible approval).

## Update 2026-11-24: production reseeded (Jade: "I mean production please you can clear all of them then create the seeded ones")
- Prod now holds only seeded data: 35 accounts, PSITS (org 2) has 12 ledger rows, 3 budgets, 8 tasks, 4 events; one seeded election is ACTIVE (blocks the next reseed until closed). must_change_password false for all; SAO 990001 has a random password in the session scratchpad file sao990001.txt (copy it somewhere durable); others use seeder defaults.
- Backups: /var/backups/hiusa/prereseed-20261124T084541Z.sql.gz and .files.tar.gz (gzip -t OK). Marker removed. No mail sent.
- Docs: ERD folder "HIUSA - Demo Accounts (production).docx/.md" (teammates only, SAO row "Given by Jade in person"); AI guide rebuilt with an example account per section. Opus CLEAN.
- Ledger items 9 (privacy notice for old accounts) and the ai17 cleanup notes are moot: those accounts no longer exist. Item 21 (Ask AI finance 0.00) still stands.

## DONE 2026-11-24 night: r20.6 (c1c5c3fa) and r20.7 (6b61b273) deployed and live-checked; prod /api/health sha 6b61b2737e70
- r20.6: per-position "Can handle finance" (Treasurer, Auditor, Business Manager, Secretary ON), Ask AI knows the position. r20.7: Ask AI voice input and receipt attach (Claude reads it, Record expense card, owner-only file, conversation delete removes files), privacy notice version 2026-11-24 (every account re-accepts once).
- Backups predeploy-r20.6-20261124T121106Z and predeploy-r20.7-20261124T130926Z (gzip -t OK). All r20.x worktrees removed; branches kept.
- Flagged: cleanup deleted 4 audit_logs rows (ids 8-11) and restored two consent timestamps on the seeded demo DB because the brief said delete every row; memory feedback_test_cleanup_keeps_audit now forbids it.
- Next: update the AI guide and Demo Accounts sheet (Treasurer 900004 can run forecast and budget advice; voice and attach exist); tell Mary Jasmin Table 28 finance/AI marks changed; item 21 (Ask AI finance 0.00) still open.

## (history) wf_9f5682f5-6ea (script workflows/scripts/hiusa-r20-6-ship-and-r20-7-*.js). r20.6 = finance switch (+Secretary) + Ask AI position, Opus CLEAN on release/r20-6 round 3, reassembled without voice/attach as release/r20-6a, equivalence check, deploy, live check. r20.7 = finish attach server (was never committed), integrate with voice/attach client on release/r20-7, privacy notice version bump, one review, deploy after r20.6, live check with the real key. If it stops, read its journal and resume with resumeFromRunId.

## RESTARTED 2026-11-24 evening (finished: review GAPS only on attach server; see LATEST): combined r20.6 workflow wf_a8cbf86e-1de (script workflows/scripts/hiusa-r20-6-wf_a8cbf86e-1de.js) continues the five worktrees, integrates on release/r20-6, one Opus review, deploys with dump, live check. If it stops, read its journal.jsonl and resume with resumeFromRunId.

## STOPPED 2026-11-24 ~18:25 PHT: all three workflows died, nothing committed (read this before "In flight")
- Cause: every builder subagent got "Not logged in · Please run /login" (error authentication_failed, agent-aabeb62e584b4fd0a.jsonl at 10:25:37Z). The CLI login expired for subagents. Run /login (or check `claude auth status`) before dispatching anything.
- Every branch is still at dee87264 (no commits). Partial, UNVERIFIED, uncommitted work sits in five worktrees; the next builders continue from it and must re-run red/green themselves:
  - D:/Claude/worktrees/hiusa-r205-server (feat/r20-5-finance-server): EnsureFinanceWriter middleware, migration 2026_11_24_000001_add_can_handle_finance_to_sbo_positions, SboPosition/User/SboPositionController/Seeder, BudgetController, FinancialAccountabilityController, routes/api.php, bootstrap/app.php alias, tests FinanceOfficerWriteAccessTest + FinancePositionSwitchTest.
  - D:/Claude/worktrees/hiusa-r205-client (feat/r20-5-finance-client): App.jsx, ProtectedRoute, navigation, Sidebar, CommandPalette, useWorkspaces, pageMeta, FinancePage and tests (14 modified, 4 new).
  - D:/Claude/worktrees/hiusa-askai-pos (fix/askai-position): AiInstructions, AskAiChatService, AskAiService, AskAiPositionTest.
  - D:/Claude/worktrees/hiusa-aiin-client (feat/askai-voice-attach-client): useSpeechInput.js, aiAttachment.js, askAiService.js, PrivacyNoticePage, tests.
  - D:/Claude/worktrees/hiusa-aiin-server (feat/askai-attach-server): barely started (only PrivacyNoticePage touched, which is client; discard it, the client slice owns that file).
- Restart with the saved scripts (resumeFromRunId will NOT help, the failed calls rerun): ~/.claude/projects/C--BSIT-React-hiusa-FULL/143781f5-f852-42d9-9bab-367d7058bc06/workflows/scripts/hiusa-r20-5-finance-switch-wf_77c6a1ec-6a9.js, hiusa-askai-position-wf_4fbabcbd-75c.js, hiusa-askai-voice-attach-wf_d235c44b-e43.js. Edit each builder prompt first: "the worktree already exists with partial uncommitted work from a run that died on auth; read git status and the diff, continue, do not re-create the worktree".
- Better shape for the restart (fewer handoffs, one review): ONE workflow for r20.6 = finance switch (Treasurer, Auditor, Business Manager AND Secretary defaults, Jade 11-24) + Ask AI position + voice + receipt attach; builders per slice in parallel, one integrate with rendered check, ONE Opus review over the combined diff, deploy with dump, live check with the real key. Freeze 25 Nov, defense 28/29 Nov: Jade said "we do this before the defense".

## In flight 2026-11-24 evening (superseded by STOPPED above; kept for the scope details)
- r20.5 "Can handle finance" per-position switch (Jade: Treasurer view-only is wrong). Scope: ledger entries; collections, remittances, invoice payments; budget and financial report drafts; forecast and budget advice. Admin keeps verify, approve/release cash advances, close invoice, delete/submit budget, submit report. Defaults ON: Treasurer, Auditor, Business Manager. Workflow wf_77c6a1ec-6a9 (script under ~/.claude/projects/C--BSIT-React-hiusa-FULL/.../workflows/scripts/hiusa-r20-5-finance-switch-*.js): build server+client, integrate with rendered check, one Opus review, deploy with dump, live check as Treasurer 900004. Branch feat/r20-5-finance. If it stopped, resume with resumeFromRunId.
- r20.6 pending: branch fix/askai-position (workflow wf_4fbabcbd-75c, build + review only, NOT merged or deployed). Ask AI never got the user's position title (AskAiService.php ~300-306 context, AskAiChatService.php ~857-861 facts). After r20.5 is deployed: add 'Secretary' to SboPosition::financeDefaultFor plus a migration setting can_handle_finance true for existing Secretary rows (Jade 11-24 "secretary as well"), merge fix/askai-position, one review over both, deploy with dump, live check (Ask AI as 900004 says Treasurer; Secretary 900003? check seeded titles; 900003 is ADMIN Secretary in UserSeeder, so check an SBO Secretary exists or the switch on positions screen).
- Ask AI voice input + receipt attachment (Jade 11-24: "Voice + receipt attach now", "we do this before the defense"): workflow wf_d235c44b-e43, branch feat/askai-voice-attach (worktree D:/Claude/worktrees/hiusa-aiin), build + rendered check + review, NOT deployed. Release order: r20.5 -> merge fix/askai-position + Secretary default + feat/askai-voice-attach as r20.6 -> one review over the combined diff -> deploy with dump -> live check with the real Claude key (receipt photo to Record expense card as Treasurer 900004, voice on a phone). Must land before the 28/29 Nov defense.
- After deploy: the AI guide and the Demo Accounts sheet say forecast/budget advice are Admin only; update their account rows (Treasurer 900004 can now run them). Table 28 marks for Generate Budget Advice / AI Financial Summary (Admin only) also change: tell Mary Jasmin.

## Done and verified this session
- 17 AI test: 29 live checks on prod (24 PASS, 3 FALLBACK, 2 BLOCKED), OLS and four-factor recomputed independently; evidence D:/Claude/scratch/hiusa-ai17/. Guide check_guide.py green (red on plant). Opus CLEAN round 3. Synthetic accounts ai17-* (99170001..8) inactive, 0 tokens (my own tinker read-back, column is account_status).
- r20.4 (dee87264): event plan gets a 30 s AI deadline (services.ai.plan_deadline_seconds, Claude 0.75 share, HTTP ceiling lifted for that call only); report check explainer accepts two sentences per finding. Full suite 3496 passed. Opus CLEAN round 1. Deployed over ssh with predeploy-r20.4-20261123T132732Z dump/tar (gzip -t OK). Live re-test 3/3 Claude for both. Prod .env duplicate HIUSA_AI_SERVICE_* block removed (backup env-pre-r20.4-*), effective config identical before/after.
- Storyboard: 57 boards edited in place (SIZE replaces SAMPLE DATA, SQL data types, REQUIRED? Yes/No everywhere), 32 new boards (Grievances and Clearance 12, Approvals 5, Organization Governance 15 incl. the split Add a Student Record / Upload School Records), screenshots from a local seeded stack. `python D:/Claude/scratch/hiusa-sb/build/check_all.py` -> OK 89 boards (red on 12 plants). Opus CLEAN round 3. Board 41 "Assign to" stays Yes: TaskController.php:155-157 returns 422 when empty, even though the column is nullable.

## Decisions already made, do not relitigate
- Production is a capstone host: Jade's standing permission covers prod data writes and server commands. Dump first; synthetic accounts disabled afterwards with a tinker read-back.
- Storyboard: standalone docx, SQL-style DATA TYPE, SIZE numbers from validation max or column length, N/A when no size.
- The Ask AI finance 0.00 bug is not fixed before the defense (Jade 11-23).

## Gotchas found the hard way
- Prod env: HIUSA_AI_SERVICE_URL and _KEY come from /etc/hiusa/laravel-native.env (sourced by hiusa-artisan and php-fpm) and beat server/.env.
- users table key is user_id and the disable column is account_status (both users and account_profiles).
- Workflow guard: every builder agent() needs a literal `model: 'sonnet'`, the reviewer gets agentType 'reviewer' with no model, handle a null review as 'NOT-REVIEWED'. A usage-limit cut leaves the review null: resume the run with resumeFromRunId.
- Windows Python wants D:/ paths; the Bash hook refuses cd in compound commands; raw `git worktree remove` is blocked, use wt-remove.mjs. Worktree D:/Claude/worktrees/hiusa-r204 may still exist; remove it with wt-remove.mjs.

## Files touched
- App code: r20.4 commit dee87264 (FallbackTextGenerator, ClaudeMessagesService, GroqResponsesService, EventController, ReportCheckExplainer, config/services.php, tests).
- Downloads: HIUSA - Overall Context.md; ERD folder AI Features Test Guide docx/pdf; HIUSA - Storyboard (2026-11-23)/.
- Scratch: D:/Claude/scratch/hiusa-ai17/ (setup, finance, tasks-events, askai, reviews, cleanup, guide, r204), D:/Claude/scratch/hiusa-sb/ (prep JSON, shots, build, checks).

## The very next action
Nothing is building. Jade sends items 18, 19, 20; then the freeze on 25 Nov.
