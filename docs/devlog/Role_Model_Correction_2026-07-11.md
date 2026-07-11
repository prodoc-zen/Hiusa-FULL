# HIUSA Role Model Correction — Department Head Introduced, Adviser Retired
**Date**: 2026-07-11
**Related**: `hiusa_minimal_append_patch.sql`, `hiusa_db_original_plus_minimal_patch.sql` (reference files supplied by a teammate, not applied directly — see note below)

This session corrected the 4-role access model after a teammate's SQL patch proposed renaming roles but mapped `adviser → DEPARTMENT_HEAD`, which conflicts with how the roles actually work. Cross-checked with the user directly: **Admin** is the SBO's own exec board (President, VP, Secretary, Treasurer, and Adviser — all position titles under one access tier with full financial/account authority), **SBO Officer** is general members barred from financial and account matters, **Department Head** is a brand-new top-level approver ("the one who has the last say") with nobody previously seeded into it, and **Student** is unchanged.

## What Changed

### Role mapping (corrected from the SQL patch's version)
| Old value | New value | Note |
|---|---|---|
| `student` | `STUDENT` | unchanged meaning |
| `officer` | `SBO_OFFICER` | unchanged meaning |
| `admin` | `ADMIN` | unchanged meaning |
| `adviser` | `ADMIN` + `position_title: 'Adviser'` | **not** `DEPARTMENT_HEAD` — the SQL patch had this wrong |
| *(none)* | `DEPARTMENT_HEAD` | new role, seeded fresh, one per organization |

### Backend
- New migration `2026_07_11_000001_correct_role_model.php` — renames `users.role` and `announcements.target_role` with the mapping above, adds `users.position_title`. Uses plain string columns (not a DB enum) so it ports between MySQL (dev) and SQLite (test suite) without driver-specific `ALTER MODIFY` statements.
- All ~40 `role:` middleware strings in `server/routes/api.php` renamed. Budget, transaction, and merchandise-stock writes changed from `officer`-only to `ADMIN`-only (SBO officers don't handle financial matters — this is a real permission change, not just a rename).
- Inline role checks renamed across `UserController`, `AnnouncementController`, `EventController`, `TaskController`, `TransactionController`, `MerchandiseController`, `OrderController`, `ElectionController`, `NotificationController`.
- Fixed a genuine bug found while auditing: `UserController::update()`'s last-admin guard counted admins globally instead of per-organization, so under multi-org it could incorrectly allow or block demoting an org's only admin depending on whether some other org happened to have one.
- `UserFactory`, `AuthRoutesTest` updated for the new values; `DepartmentHeadSeeder` (new) seeds one Department Head per organization; `UserSeeder`/`AdministratorSeeder` updated with the corrected mapping.

### Frontend
- `LoginPage.jsx`: Adviser tab replaced with Department Head; role keys/redirects now uppercase to match backend.
- `App.jsx`, `Sidebar.jsx`, `TopBar.jsx`: every hardcoded role string renamed. Routes that used to list `["officer", "adviser"]` become `["SBO_OFFICER", "ADMIN"]`, which correctly carries former-advisers' access into the merged ADMIN role without a separate branch. ADMIN added to finance/inventory routes whose write actions are now ADMIN-only.
- New `DepartmentHeadHomePage.jsx` (adapted from the now-deleted `AdviserHomePage.jsx`) — same read-only oversight layout (elections, events, tasks, announcements), new `/dashboard/department-head` route.
- Remaining role strings fixed in `AdminUsersPage`, `AdminHomePage` (role-count pills), `EventsPage`, `TasksPage`, `MerchandisePage`, `ManageCandidatesPage`, `ElectionPickerPage`, `ElectionsHub`, `CreateAnnouncementPage`, `AnnouncementsPage`.

### Bug found and fixed mid-implementation
The migration's `dropColumn('target_role')` failed on SQLite ("no such column: target_role after drop column") because of the existing `announcements_published_role_index` composite index on `(is_published, target_role)`. Fixed by dropping the index before the column swap and recreating it after, in both `up()` and `down()`. Only surfaced once the test suite ran — this is why the "run the tests" verification step matters.

## Verified
- Full PHPUnit suite: 6/6 passing (SQLite in-memory).
- `php -l` clean on every touched PHP file.
- `npm run build` clean, no errors.

## Not Verified Yet (needs your machine)
- `php artisan migrate:fresh --seed` against the real dev database — MySQL wasn't running locally when this session ended. Needs to be run once MySQL/XAMPP is up, to confirm the migration behaves the same on MySQL as it did on SQLite (it should — the migration is deliberately driver-agnostic — but MySQL hasn't actually executed it yet).
- Manual login check: log in as a former-adviser account (should land on the Admin dashboard, not 403), and as a new Department Head seed account (should reach `/dashboard/department-head` without a 404).

## Deliberately Out of Scope This Session
These come from the same SQL patch / feature brief but depend on the role model above being correct first, and are large enough to be their own sessions:

1. `approval_requests` table + actual controller logic wiring Department Head approval into event creation, budget allocation, election creation, and announcement publishing. The SQL patch defines the table; no application logic uses it yet, and it hasn't been created in this codebase at all.
2. `ai_outputs` + `financial_reports` tables, plus the real OLS regression / weighted-scoring computation and Groq narration layer (see the OLS/Groq architecture discussion elsewhere in this devlog history) — Finance and Tasks controllers are still pure CRUD with no computation.
3. `audit_logs` table + write-through logging from the controllers above.
4. Event-scoped receipt numbering (`transactions.receipt_number` restarting per event), digital receipt generation.
5. Order payment flow: GCash + cash-on-claim, `payment_proof_url`, dual officer/admin review status on orders.
6. DigitalPersona U.are.U 4500 biometric hardware integration (repo already identified by the team) — wiring the existing `method: 'biometric'` attendance path to real hardware.
7. Cloudflare R2 for merchandise/candidate image storage (currently local `image_url` paths under `public/uploads/`).
8. Task delegation scoring fields (`role_score`, `workload_score`, `performance_score`, `final_score`) — columns don't exist yet, and no computation surfaces them in the Tasks AI tab.

## Also Known But Not Fixed
- `position_title` has no UI yet — `AdminUsersPage`'s create/edit forms don't expose an input for it. Only the three migrated adviser accounts have it set (via the seeder), and there's no way to set it for anyone else through the app yet.
- The announcement audience selector doesn't offer a "Department Head" targeting option (only All / Officers / Students / Admins). Department Heads still receive "All Members" announcements.
