# Use Case Compliance Audit

**Audit date:** 2026-08-28 (supersedes the 2026-08-20 pass; re-measured after commits `08294a4` AI integration and `2e67be8` GCash QR/financial accountability/SBO positions/Playwright)

## Scope and Method

This audit traces every repository use-case document to frontend routes/components, authenticated API routes, organization scoping, role middleware, validation, persistence, notifications, approval transitions, audit records, and automated tests. It also checks PHP syntax, the full Laravel suite, ESLint, and the production Vite build.

Status meanings:

- **Verified:** implementation is present and passed the applicable automated/static checks.
- **Partial:** the core workflow works, but a documented extension still needs a platform or product decision.

## Traceability Matrix

| Use case | Roles | Status | Primary evidence |
|---|---|---|---|
| Authenticate and Recover Account | All roles | Verified | Sanctum login, role/account checks, reset-token flow, `AuthRoutesTest` |
| View Role-Based Dashboard | All roles | Verified | protected router, role-filtered sidebar, four dashboard pages |
| Manage Profile | All roles | Verified | profile/password APIs and settings UI |
| Manage User Accounts and Permissions | Admin | Verified | tenant-scoped CRUD/deactivation, audit log, last-Admin protection tests |
| Manage Announcements | Admin, SBO Officer | Verified | Groq draft/fallback, approval-gated publishing, notifications/audits, compliance test |
| View Announcements and Notifications | All roles | Verified | published-only feed, details, per-user notifications, read/read-all test |
| Manage Events and Scheduling | Admin | Verified | create/edit, forced planning state, Department Head approval, bypass tests |
| View Events and Activity Calendar | All roles | Verified | approved event scope, date/search filters, detail view, role-safe payload test |
| Generate Event Plans and Workflows | Admin | Verified | Groq/fallback plan, `ai_outputs`, linked generated workflow tasks |
| Check In to Event | All roles | Verified | active-event checks, self/manager scope, duplicate prevention, confirmation UI |
| Manage Attendance | Admin, SBO Officer | Verified* | manual status/summary flows work; biometric capture/matching uses a safe integration boundary until scanner hardware is selected |
| Manage Tasks and Workflow | Admin | Verified | weighted eligibility scoring, best-fit SBO recommendation, Groq/fallback explanation test |
| View and Update Assigned Tasks | SBO Officer | Verified | assignee-scoped list, progress/completion, Admin notification |
| Manage Budget Allocation and Monitoring | Admin, SBO Officer, Department Head | Verified | reciprocal approval roles, approved-only spending, remaining/risk tracking tests |
| Manage Financial Transactions and Ledger | Admin | Verified | scoped CRUD, receipts, budget movement and exact rollback test |
| Generate Financial Forecasts and Budget Advice | Admin, SBO Officer | Verified | historical monthly aggregation, OLS model, risk/safe limit, Groq/fallback test |
| View Financial Reports and Transaction History | Admin, SBO Officer, Department Head | Verified | persisted monthly/semester/custom/event reports, Groq/fallback summary, history, Excel and print/PDF |
| View Personal Receipts | All roles | Verified | ownership-scoped receipt API and print action |
| Manage Merchandise Inventory | Admin | Verified | image/item CRUD, stock adjustment, deactivation audit |
| Order Merchandise and Claim Items | All roles | Verified | reservation, GCash image proof, personal tracking, post-approval token release test, admin-gated GCash QR precondition |
| Manage Merchandise Orders and Fulfillment | Admin, SBO Officer | Verified | officer submission, Admin approval, receipt, notifications, rejection/restock, one-use claim test |
| Submit Requests for Approval | Admin, SBO Officer | Verified | pending request persistence, approver notifications, submission/resubmission audits |
| Review and Decide Approval Requests | Admin, Department Head | Verified | required-role and self-review checks, rejection reason, transactional entity updates |
| Manage Elections | Admin | Verified | atomic election/position creation, approval-gated lifecycle, period and ballot-lock validation |
| Manage Candidates | Admin, SBO Officer | Verified | server-filtered active-student selection, position/partylist validation, image handling, voted-candidate protection |
| Manage Partylists | Admin | Verified | image CRUD, roster display, assigned-candidate deletion protection |
| Cast Vote in Election | All roles | Verified | active/time-window validation, complete official ballot validation, candidate-position integrity, duplicate prevention test |
| View Election Results | All roles | Verified | visibility rule, grouped tallies, winning candidates, position filter |

## Corrections Made During Audit

- Closed cross-organization user creation/update paths and protected the final active Admin.
- Fixed the shadowed `notifications/read-all` route.
- Prevented direct event/election/announcement/payment approval bypasses and self-approval.
- Made rejected-request resubmission notify reviewers and write an audit record.
- Enforced election dates and ballot uniqueness/integrity.
- Made budget overspending reversible and blocked ledger use before budget approval.
- Implemented OLS forecast generation with Groq or deterministic summaries.
- Implemented actual best-fit SBO task recommendation and generated explanations.
- Completed staged merchandise payment approval, receipt generation, stock restoration, buyer notifications, proof upload, and delayed claim-token release.
- Removed unauthorized Department Head task calls and restricted event detail payloads by role.
- Added event detail/edit/date-filter UI, transaction filters, and Excel/print-PDF report actions.
- Added persisted event/custom financial report generation, computed totals, AI summaries, and report history.
- Corrected hook ordering and brought frontend lint to zero warnings/errors.
- Corrected announcement management so Department Heads cannot read drafts or mutate announcements, while Admin/SBO management remains approval-gated.
- Scoped Department Head merchandise history to personal orders and hid inactive inventory from every non-Admin catalog.
- Enforced the event schedule for self check-in in both API validation and the UI.
- Added server-side role/status/search filters to user lookups used by candidates, attendance, and task assignment.
- Added route-level code splitting and accessible skeleton loading states, reducing the production entry bundle and removing the prior bundle-size warning.
- Added a four-role API access-matrix regression test covering representative endpoints across all modules.
- Preserved credentials when deactivating users, revoked active sessions, and prevented disabled Admin accounts from weakening final-active-Admin protection.
- Made password recovery non-enumerating, restricted public authentication to active organizations, and rate-limited every public authentication endpoint.
- Sealed vote totals for every role until an election is closed, removed voter identities from election detail payloads, and switched the results UI to aggregate-only data.
- Added database uniqueness constraints for election candidates and positions, deterministic ballot ordering, and upload cleanup for failed/replaced candidate, partylist, merchandise, and payment-proof files.
- Revalidated approval state under row locks, reopened and renotified material edits, and removed orphan approval records when their entities are deleted.
- Blocked GCash/payment-approval bypasses, future-notification read bypasses, invalid transaction pagination/filter crashes, and changes to completed or attendance-bearing events.

## Verification Results

Numbers below were re-measured on 2026-08-28 on this machine. The 2026-08-20 figures are superseded; where a prior claim could not be re-checked this pass, it is labelled as such rather than repeated.

- Laravel: **106 tests, 824 assertions passed, 0 failed** (`php artisan test`, 15 feature test files), including the four-role API access matrix, the financial-accountability suite, the GCash QR precondition tests, the new AI fallback-parity suite, the new demo-data integrity suite, and the merchandise/payment/notification/authentication/validation regressions. This includes a fix landed this pass: `RequestedWorkflowCompletionTest`'s GCash workflow test now configures an organization QR via a new `OrganizationFactory::withGcashQr()` state before submitting payment proof, so it no longer collides with the unconditional QR gate added in `2e67be8`.
- Python AI service: **15 pytest tests passing** (`ai-service/.venv`, `pytest -q`), now including coverage for position-relevance variance, weak-fit detection on noisy data, negative-trend clamping, the workload tie that used to occur at 6+ active tasks, and word-boundary keyword matching.
- Client unit tests: **vitest, 9 tests passing across 3 files** (`npm run test:unit`) — `FinancePage`, `PaginationControls`, and the new `ManageVotersPage` suite that guards the paginated-envelope regression.
- Client e2e: **5 Playwright spec files exist** under `client/e2e` (`ai-decision-support-live`, `events-live`, `example`, `finance-live`, `financial-accounts`); the "live" specs are gated behind env flags and have never been run on this machine. Not counted as passing evidence.
- Frontend: **ESLint passed with zero warnings/errors**.
- Frontend: **Vite production build passed** with route-level chunks and no bundle-size warning; the entry bundle is **275.10 kB (84.14 kB gzip)**.
- Database: **46 migration files, all 46 applied**, **39 tables** in `hiusa_db` (MariaDB, 127.0.0.1:3307), including the 2026-08-27 financial-accountability and SBO-position tables.
- Routes: **112 API routes** (`php artisan route:list --path=api`) load successfully, and `route:cache` / `route:clear` succeed without error.
- Runtime smoke test: **not re-run this pass** — the prior "63 real HTTP checks" figure from 2026-08-20 was not reproduced and should not be treated as current evidence.
- Dependency security: `npm audit` reports **0 vulnerabilities**, and `composer audit` now reports **"No security vulnerability advisories found."** The 14 advisories across 3 packages found earlier in this pass were all in transitive dependencies — `guzzlehttp/guzzle` (7, one high), `guzzlehttp/psr7` (1), `league/commonmark` (6, four high) — and were newly-disclosed advisories rather than a new dependency. They were remediated with a targeted `composer update guzzlehttp/guzzle guzzlehttp/psr7 league/commonmark` (patch/minor bumps within the same majors, no framework upgrade), and the suite still reports 106 passed / 824 assertions afterwards. Practical exposure had been low regardless: HIUSA's Guzzle usage is two fixed trusted endpoints (the local AI service and the Groq API) with no user-controlled URLs or cookies, and it does not render user-supplied Markdown. Teammates must run `composer install` after pulling, since `composer.lock` changed.
- PHP quality: all project PHP files pass syntax validation (`php -l`), and Laravel Pint (`vendor/bin/pint --test`) now reports **`"result":"passed"`, 0 files failing**. The 19-file violation set found earlier in this pass (`FinancialAccountabilityController`, `GcashSettingsController`, `SboPositionController`, the six financial-accountability models, `SboPosition`, `OrderFulfillmentService`, `EventController`, `OrderController`, `routes/api.php`, two test files, and the three 2026-08-27 migrations) was pre-existing debt introduced by commit `2e67be8`, not by this pass. It has now been auto-fixed with `vendor/bin/pint`; the changes are whitespace, brace position, import ordering and one unused import, and the full suite still reports 106 passed / 824 assertions afterwards.
- Static patch check: `git diff --check` passed.
- Live browser interaction: not attempted this pass; the 2026-08-20 note (no available browser targets in that session) is not re-confirmed either way.

## Demo Readiness of the Seeded Database

A use case being implemented and a use case being demonstrable are different claims. Verified on 2026-08-28 against `hiusa_db`: before this pass, `approval_requests` held **0 rows**, which meant three headline use cases refused to run on a freshly seeded install even though their code was correct:

| Use case | Was blocked by | Gate |
|---|---|---|
| Cast Vote | election `approved_at` NULL | `ElectionController.php:211` — 422 "Election must be approved before it can be opened." |
| Manage Events and Scheduling | all events `approved_at` NULL | `EventController.php:312,316` — 422 "Only approved events can be started or completed." |
| Manage Financial Transactions | no approved `ApprovalRequest` for any budget | `TransactionController.php:258-266` — 422 "The selected budget must belong to this organization and be approved." |
| View Announcements | all rows `approval_status='draft'`, and `target_role` seeded lowercase (`student`, `officer`, `adviser`) against an uppercase `users.role` | `AnnouncementController.php:93-104` — a STUDENT saw **zero** announcements |
| Order Merchandise | all organizations `gcash_qr_url` NULL | `OrderController.php:90,166` — 422 until an admin uploads the official QR |

The seeders now produce a demonstrable state, measured after `migrate:fresh --seed`: **8 approval requests**, 3 approved events, 1 approved election, 1 organization with a GCash QR, 8 officers carrying distinct `position_title` values, 18 votes, 9 attendance rows, 5 unread notifications. No announcement targets the retired `adviser` value. `DemoDataIntegrityTest` now asserts all of this, and because the suite runs on SQLite it also guards the case-sensitivity bug that MySQL's collation was masking in `ElectionSeeder`.

Records left deliberately unapproved or incomplete, so the approval and voting workflows have something real to demonstrate rather than an all-green database:

- Event "Induction and Recognition Ceremony" — `planning`, approval request pending.
- Budget "Sports Fest 2024 Budget" — approval request pending.
- Order #1 (Rafael Aquino, 2 shirts) — pending payment, for the officer verification flow.
- Student Alyssa Domingo (`2400093`) — has not voted, for the live cast-vote and double-vote rejection demos.

Budget `remaining_amount` is also now populated by the seeder using the server's own definition (`allocated + income - expense`). It was previously NULL, because `Budget::create()` bypasses `BudgetController`, which is the only code that maintains it; every running-balance reader then fell back to `allocated_amount`, and the officer dashboard consequently reported roughly half the transacted total as spend. Post-fix its derived spend matches recorded expense exactly (₱13,500 / ₱3,800 / ₱12,500).

## Remaining Decisions

1. The physical biometric scanner still needs a chosen device/WebAuthn design and secure template-matching service. The API intentionally returns `501 Not Implemented` for biometric matching until that trusted adapter is connected; it never accepts a client-supplied biometric label as proof.
2. Browser verification should cover all four role dashboards at desktop and mobile widths whenever the in-app browser is available.
