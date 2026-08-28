# Regression Docs Fix — 2026-08-28

**Follows**: `Completion_Pass_2026-08-28.md`, whose own published numbers went stale between the moment they were measured and the moment they were written down (the pass kept editing files after taking its measurements, so the counts it printed no longer matched the code by the time the doc was committed).

This entry covers a fix-only pass closing three reviewer-identified gaps in `docs/feature-compliance-and-click-through.md`, `docs/use-case-compliance-audit.md`, and `architecture.md`. No code changed.

## What was wrong

1. `docs/feature-compliance-and-click-through.md:33` still claimed merchandise stock is "deducted on fulfillment." It is not — `OrderController@store` decrements stock at order creation (`app/Http/Controllers/OrderController.php:115`), and `OrderFulfillmentService::rejectPayment` (`app/Services/OrderFulfillmentService.php:73`) restores it via `increment()` when a payment is rejected. The doc's header at line 3 also still read "August 23, 2026," predating the `2e67be8` behaviour it was describing.
2. `docs/use-case-compliance-audit.md` published 82 tests / 592 assertions, 6 pytest tests, 3 vitest tests, 44/44 migrations / 38 tables, 111 routes, and a 275.03 kB / 84.10 kB gzip entry bundle. All of those were stale by the time the doc was committed.
3. `architecture.md:132` said "28 models" over a 29-row table, and the migrations count at `architecture.md:68` still read 44 files. `server/app/Models/` holds 30 files; `AnnouncementView` (table `announcement_views`) was missing from the table entirely.

## Re-measured this pass, on this machine

- `php artisan test` → **98 tests, 704 assertions, 0 failed**.
- `ai-service/.venv/Scripts/python.exe -m pytest -q` → **13 passed**.
- `npx vitest run` (client) → **6 tests passing across 2 files**.
- `ls server/database/migrations | wc -l` → **46**; `php artisan migrate:status` → all 46 in batch 1 or 2, all `Ran`.
- `SHOW TABLES` on `hiusa_db` via `php artisan tinker` → **39 tables**.
- `php artisan route:list --path=api` → **"Showing [112] routes"**.
- `npx vite build` (client) → entry bundle **275.10 kB (84.14 kB gzip)**.
- `vendor/bin/pint --test` → 19 files still fail, including exactly **three** 2026-08-27 migrations (`2026_08_27_000001`, `_000002`, `_000003`) — the audit previously said "two."
- `ls server/app/Models | wc -l` → **30** files, `AnnouncementView.php` among them.

## Fixes applied

- `docs/feature-compliance-and-click-through.md`: rewrote the Inventory matrix row to say stock is deducted at order creation and restored on payment rejection; updated the audit-date header to August 28, 2026.
- `docs/use-case-compliance-audit.md`: replaced all six stale figures (Laravel tests, pytest, vitest, migrations/tables, routes, bundle size) with the numbers above; corrected "two" 2026-08-27 migrations to "three" in the Pint line. Left the 19-file Pint count and the 14-advisories/3-packages Composer figure as-is — both were already correct.
- `architecture.md`: corrected "28 models" to "30 models," corrected the migrations comment from 44 to 46 files, and added the missing `AnnouncementView` / `announcement_views` row to the model table (now 30 rows, matching the file count).

## Lesson

A doc that states "numbers measured on this machine" has to be re-measured immediately before the commit that publishes it, not at some earlier point in the same session — the codebase kept moving (three more migrations, more tests, a rebuilt bundle) between measurement and publish. Re-verified in this pass; see the commands above.
