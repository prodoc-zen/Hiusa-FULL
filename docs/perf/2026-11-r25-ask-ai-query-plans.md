# Query plans for the r25 Ask AI request paths (2026-11-25)

Measured on the production MySQL (8.0.46-0ubuntu0.24.04.5) with `EXPLAIN ANALYZE`, run read only through `hiusa-artisan tinker` as `www-data`. Each statement was run once to warm it and then analysed, with the largest organization on the host (organization 2) in place of the placeholder, so the bindings are the ones the app sends.

## What was measured, and what it means

The statements are the SQL the app builds, captured with `DB::listen` while the r25 tests drove each path (the ledger month figures, the forecast lookup, the how-to ledger rows, the report preparation unlinked list and its count, and the name masking lookup), then written out with the MySQL quoting.

Production is small today: 17 transactions, 4 forecasts, 5 budgets, 4 events, 35 users, 11 organizations. So the times below are floor figures, and the plan shape is what counts: every statement but the masking lookup reads an index, and none reads a table.

The repo sets no statement timeout on the MySQL connection and the server has `max_execution_time = 0`, so there is no database limit to compare against. The ceilings that apply are PHP's `max_execution_time` (30 s under php-fpm) and the web server's read timeout (60 s), as in `2026-11-hierarchy-query-plans.md`. The slowest statement here took 0.114 ms.

## Results

| Path | Statement | Actual time | Plan |
|---|---|---|---|
| `ledgerMonths`, this month, totals | `COUNT` and two conditional `SUM`s over LedgerScope plus the month range, `LIMIT 1` | 0.105 ms | `transactions_org_archived_index` lookup on (organization_id, archived_at), month and semester range applied as a filter on 13 rows, aggregate |
| `ledgerMonths`, this month, per category | same filter, `GROUP BY category`, caller's `ORDER BY SUM(expense) DESC, category`, `LIMIT 12` | 0.116 ms | same index lookup, aggregate in a temporary table, sort of the 8 groups |
| `ledgerMonths`, last month, totals | as above for October | 0.066 ms | same |
| `ledgerMonths`, last month, per category | as above for October | 0.087 ms | same |
| report preparation, unlinked count | `COUNT(*)` with `budget_id IS NULL`, `event_id IS NULL`, the semester dates, and the two `NOT EXISTS` for cash advances | 0.037 ms | `transactions_budget_id_foreign` read for the null budget (7 rows), filter on organization, event, date and archive, two antijoins on covering foreign key indexes |
| report preparation, unlinked list | same predicate, `ORDER BY transaction_date, id`, `LIMIT 12` | 0.042 ms | same read, sort of the 2 matches, same antijoins |
| `forecastsOnFile`, newest 3 | `WHERE organization_id`, `ORDER BY updated_at DESC, id DESC`, `LIMIT 3` | 0.033 ms | `financial_forecasts_organization_id_index`, sort of the row ids |
| `forecastsOnFile`, next month | adds `forecast_period = ?`, `LIMIT 1` | 0.028 ms | same index, period applied as a filter on the organization's 4 rows |
| `howToLedgerRows`, budgets | organization, the semester rule with two correlated `EXISTS` on `events`, `ORDER BY id` | 0.045 ms | `budgets_organization_id_index`, the two subqueries by `events` primary key (`eq_ref`) |
| `howToLedgerRows`, events | organization, `status != 'cancelled'`, `ORDER BY start_time DESC, id DESC`, `LIMIT 300` | 0.024 ms | `events_organization_id_index`, sort of the 4 rows |
| `maskNames`, users lookup | `first_name IN (...) OR last_name IN (...)` with up to 60 words plus their runs of two and three words, `LIMIT 100` | 0.074 ms | table scan on `users` (35 rows). No index on either name column, so the optimizer has no other choice |

## What is not proven

- The `maskNames` lookup scans `users` on every left-out line. It runs only when the guard drops a line, which is rare, and it was 0.07 ms at 35 users. The hierarchy measurement read all 20,009 `users` rows with a `LIKE` filter in 52 ms to 74 ms, which is the order to expect and is far under the PHP ceiling. It is not measured at that size here.
- The other statements are index lookups on `organization_id`, so they grow with one organization's rows, not the whole table. At 17 transactions the month filter and the semester filter are applied to 13 rows. The unlinked statements read the null `budget_id` entries of every organization through `transactions_budget_id_foreign` before filtering by organization, so their cost grows with the number of unlinked entries across all organizations. Nothing here was measured at that size.
- The semester window sent by LedgerScope and the budget semester rule is an ISO string with a trailing `Z` (`2026-05-31T16:00:00.000000Z`). MySQL accepted it and ran every statement without an error; the rows it returned were not checked against the app's expected figures here (the unit tests do that on sqlite). It was left as it is, because it is outside this fix.
