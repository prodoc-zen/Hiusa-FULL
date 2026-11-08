# Query plans for the hierarchy flow request paths (2026-11-08)

Measured on MariaDB 10.4.32 (the version production runs) with `ANALYZE FORMAT=JSON`, which runs the statement and reports real row counts and time per node. `EXPLAIN ANALYZE` does not exist in 10.4; `ANALYZE FORMAT=JSON` is its equivalent there.

## Setup

A throwaway MariaDB 10.4.32 instance on port 3407 with its own data directory under `D:\Claude\scratch`, migrated with the repo's migrations (no seeders), then loaded with synthetic rows. The 3307 and 3306 instances were not touched. The instance and its data were deleted when the run ended.

| Table | Rows |
|---|---|
| users | 20,009 (20,000 students, 8 deans, 1 SAO) |
| account_profiles | 30,008 (20,000 own-organization plus 10,000 second memberships) |
| student_registry | 20,000 (10,000 already signed up, 10,000 not) |
| organizations | 49 (8 college home organizations, 40 student organizations, the SAO) |
| colleges | 8 |
| events | 6,000 |
| announcements | 50,000 |
| venue_bookings | 20,000 |

Every number below is the warm run of a real HTTP request pushed through the Laravel HTTP kernel (route, middleware, controller), so the SQL is exactly the SQL the app builds, with the real bindings. The request's queries were captured with `DB::listen` and each `select` was then re-run under `ANALYZE FORMAT=JSON`. The scripts (`probe.php`, `load.sql`, `backfill.sql`) were kept outside the repo. Tables were `ANALYZE TABLE`d before measuring.

## Comparison with the timeout

The repo sets no database statement timeout (`config/database.php` has none, and no `max_statement_time` appears in the deploy scripts). The ceilings that apply are PHP's `max_execution_time` (30 s by default under php-fpm) and the web server's read timeout (60 s by default). The slowest single statement measured is 74 ms, about 400 times under the 30 s ceiling.

## Results

"Slowest statement" is the largest `r_total_time_ms` of any statement in the request. "Request" is the whole in-process request, warm, including auth and middleware.

| Path | Shape | Slowest statement | Request | Plan |
|---|---|---|---|---|
| `CollegePeopleController::students` page 1 | UNION ALL in `fromSub`, `ORDER BY last_name, first_name, school_id`, `LIMIT 25`, plus the paginator `COUNT(*)` over the same derived table | 31.6 ms (page), 30.9 ms (count) | 84 ms | `users` full scan (20,009 rows read, 12% kept), `account_profiles` covering index scan, `student_registry` by `college_id`, filesort of the 3,750 matching rows |
| same, one name token (`q=maria`) | adds `LOWER(first_name) LIKE '%maria%'` style conditions on both halves | 27.7 ms, 26.1 ms | 80 ms | same plan; the `LIKE` is a filter on rows already read |
| same, name plus digits (`q=santos 12`) | two tokens, `CAST(school_id AS CHAR) LIKE` on the digit token | 26.2 ms, 25.0 ms | 90 ms | same plan |
| same, digits only (`q=2024012`) | school ID search | 29.5 ms, 28.9 ms | 73 ms | same plan |
| same, page 400 | `OFFSET 9,975` | 53.1 ms (page), 31.9 ms (count) | 114 ms | same plan, the filesort reads more rows before the offset |
| `CollegePeopleController` staff and leaders tabs | joins on `account_profiles` | 0.04 ms, 0.66 ms | 15 ms, 20 ms | index lookups only |
| `PeopleSearchController::search`, dean | `whereHas` profiles in college scope, three `LIKE '%x%'` columns, `ORDER BY` name, `LIMIT 10` | 56.5 ms | 83 ms | `users` read through `users_account_status_index` (every row is `active`, so it reads all 20,009), semi-join on `account_profiles` by `organization_id` range, filesort of the matches |
| same, digits (`q=2024001`) | adds `CAST(school_id AS CHAR) LIKE` | 52.2 ms | 86 ms | same plan |
| same, SAO (`scope=all`) | no organization restriction | 67.2 ms | 90 ms | `users` as above, `account_profiles` full scan (30,009 rows, 5.4 ms) for the semi-join |
| same, organization admin, college scope | two profile rules with `OR` | 74.2 ms | 85 ms | `users` as above, profiles by `organization_id` range |
| `RecordsController::index`, dean | `organizationList` grouped counts | 0.1 ms | 23 ms | every statement an index lookup |
| same, SAO (all 40 organizations) | `events` and `elections` `GROUP BY organization_id` for the semester | 3.8 ms | 28 ms | `events_academic_semester_id_foreign` ref read, temporary table for the group |
| same, SAO with `search` | `LIKE` on 40 organization rows | 0.3 ms | 25 ms | primary key range |
| `OrgSpaceController::show` | members join, three counts, events, budgets, submissions | 4.8 ms | 40 ms | `account_profiles` by `organization_id` index, `users` by primary key |

## Backfill, migration `2026_11_08_070001`

Run against the loaded tables with `academic_semester_id` reset to null. The statements are the migration's own.

| Statement | Rows | Time | Plan |
|---|---|---|---|
| `announcements` set semester from the `created_at` range | 50,000 | 1,566 ms | primary key scan, dependent subquery on `academic_semesters` (2 rows) |
| `announcements` active-semester fallback | 0 | 48 ms | scan, nothing left to fill |
| `venue_bookings` set semester from the `created_at` range | 20,000 | 471 ms | same |
| `venue_bookings` active-semester fallback | 0 | 13 ms | same |
| `venue_bookings` take the event's semester | 6,667 with an event | 23 ms | primary key scan, `events` by primary key (`eq_ref`) |

About 2.1 s of writes in total at 50,000 announcements. It runs once, inside the deploy, after the pre-migrate backup. The per-row cost is a fixed subquery over a table of a few rows, so it grows linearly with the two tables and stays well inside any timeout.

## Decisions

1. **No new index.** The full scans that show up are on `users` (7 ms of the 26 to 31 ms students query, 27 to 36 ms inside the search queries) and, for the SAO, `account_profiles` (5 ms). They exist because the predicates cannot use an index: `LIKE '%x%'` has a leading wildcard, and the students query joins its two sources with `OR EXISTS`, which stops the optimizer from splitting the work by index. A trial index `account_profiles (organization_id, user_school_id)` was created on the same data and the whole probe was re-run: the students page statement moved from 31.6 ms to 22.7 ms and the count from 30.9 ms to 31.0 ms, and the searches from 56.5, 67.2 and 74.2 ms to 44.2, 65.0 and 61.3 ms. That is noise on the count and a few milliseconds on the rest, at the price of a second index on a table written on every sign-up and membership change. It was dropped again and is not in a migration. `users_account_status_index` is not selective (every row is `active`) but is harmless: the planner reads the same rows with or without it.
2. **Cost is linear in `users`.** Every number above is for 20,000 users. Extrapolating linearly (not measured), 10 times the users puts the slowest statement near 0.75 s, still far under the 30 s ceiling. People search is throttled (`people-search` limiter) and debounced in the client. If the user table ever passes several hundred thousand rows, the next step is a `FULLTEXT` index or a stored lower-cased search column, not a B-tree index.
3. **Nothing in the new request paths needs a change.** Apart from the `users` and `account_profiles` scans named in decision 1, every statement is an index lookup (`const`, `eq_ref`, `ref` or `range`) or a scan of a table of 49 rows or fewer.

## Appendix: heaviest statements and their plans

Warm runs, tables as loaded above. Plan nodes are listed as `table | access type, key, rows estimated, rows read, share kept, time`.
### College People students, page 1 (the page statement, then the paginator count)

#### Q9  app 31.83 ms, ANALYZE r_total_time_ms 30.923

```sql
select count(*) as aggregate from ((select `users`.`school_id`, `users`.`first_name`, `users`.`last_name`, `users`.`email`, `users`.`program`, `users`.`year_level`, `users`.`account_status`, 'account' as source from `users` where `users`.`role` = 'STUDENT' and (`users`.`organization_id` in (2, 10, 18, 26, 34, 42) or exists (select 1 from `account_profiles` where `account_profiles`.`user_school_id` = `users`.`school_id` and `account_profiles`.`organization_id` in (2, 10, 18, 26, 34, 42)))) union all (select `student_registry`.`school_id`, `student_registry`.`first_name`, `student_registry`.`last_name`, NULL as email, `student_registry`.`program`, `student_registry`.`year_level`, 'not_signed_up' as account_status, 'registry' as source from `student_registry` where `student_registry`.`college_id` = 1 and `student_registry`.`claimed_at` is null and not exists (select 1 from `users` where `users`.`school_id` = `student_registry`.`school_id`))) as `people`
```
Nodes:
```
table <derived2> | access=ALL key=- rows=22099 r_rows=3750 filtered=100 r_filtered=100 r_total_time_ms=2.992
union_result
table users | access=ALL key=- rows=19599 r_rows=20009 filtered=100 r_filtered=12.494 r_total_time_ms=7.076
table account_profiles | access=index key=account_profiles_user_school_id_organization_id_unique rows=30008 r_rows=30008 filtered=12.5 r_filtered=12.5 r_total_time_ms=4.403 using_index
table student_registry | access=ref key=student_registry_college_id_index rows=2500 r_rows=2500 filtered=100 r_filtered=50 r_total_time_ms=2.59
table users | access=unique_subquery key=PRIMARY rows=1 r_rows=- filtered=100 r_filtered=- r_total_time_ms=1.764 using_index
```

#### Q10  app 36.64 ms, ANALYZE r_total_time_ms 31.61

```sql
select * from ((select `users`.`school_id`, `users`.`first_name`, `users`.`last_name`, `users`.`email`, `users`.`program`, `users`.`year_level`, `users`.`account_status`, 'account' as source from `users` where `users`.`role` = 'STUDENT' and (`users`.`organization_id` in (2, 10, 18, 26, 34, 42) or exists (select 1 from `account_profiles` where `account_profiles`.`user_school_id` = `users`.`school_id` and `account_profiles`.`organization_id` in (2, 10, 18, 26, 34, 42)))) union all (select `student_registry`.`school_id`, `student_registry`.`first_name`, `student_registry`.`last_name`, NULL as email, `student_registry`.`program`, `student_registry`.`year_level`, 'not_signed_up' as account_status, 'registry' as source from `student_registry` where `student_registry`.`college_id` = 1 and `student_registry`.`claimed_at` is null and not exists (select 1 from `users` where `users`.`school_id` = `student_registry`.`school_id`))) as `people` order by `last_name` asc, `first_name` asc, `school_id` asc limit 25 offset 0
```
Nodes:
```
filesort r_total_time_ms=2.716 loops=1
table <derived2> | access=ALL key=- rows=22099 r_rows=3750 filtered=100 r_filtered=100 r_total_time_ms=2.808
union_result
table users | access=ALL key=- rows=19599 r_rows=20009 filtered=100 r_filtered=12.494 r_total_time_ms=6.779
table account_profiles | access=index key=account_profiles_user_school_id_organization_id_unique rows=30008 r_rows=30008 filtered=12.5 r_filtered=12.5 r_total_time_ms=4.221 using_index
table student_registry | access=ref key=student_registry_college_id_index rows=2500 r_rows=2500 filtered=100 r_filtered=50 r_total_time_ms=3.039
table users | access=unique_subquery key=PRIMARY rows=1 r_rows=- filtered=100 r_filtered=- r_total_time_ms=1.943 using_index
```


### People search, dean, name

#### Q10  app 61.69 ms, ANALYZE r_total_time_ms 56.483

```sql
select * from `users` where `users`.`account_status` = 'active' and exists (select * from `account_profiles` where `users`.`school_id` = `account_profiles`.`user_school_id` and `account_profiles`.`account_status` = 'active' and ((`account_profiles`.`organization_id` in (2, 10, 18, 26, 34, 42)))) and ((LOWER(users.first_name) LIKE '%mar%' ESCAPE '!' or LOWER(users.last_name) LIKE '%mar%' ESCAPE '!' or LOWER(users.email) LIKE '%mar%' ESCAPE '!')) order by `users`.`last_name` asc, `users`.`first_name` asc, `users`.`school_id` asc limit 10
```
Nodes:
```
table <subquery2> | access=eq_ref key=distinct_key rows=1 r_rows=0.2703 filtered=100 r_filtered=100 r_total_time_ms=0.726
filesort r_total_time_ms=48.99 loops=1
table users | access=ref key=users_account_status_index rows=9799 r_rows=20009 filtered=100 r_filtered=9.9955 r_total_time_ms=27.173
table account_profiles | access=range key=account_profiles_organization_id_role_index rows=3751 r_rows=3751 filtered=100 r_filtered=100 r_total_time_ms=5.648
```


### People search, SAO

#### Q6  app 67.75 ms, ANALYZE r_total_time_ms 67.239

```sql
select * from `users` where `users`.`account_status` = 'active' and exists (select * from `account_profiles` where `users`.`school_id` = `account_profiles`.`user_school_id` and `account_profiles`.`account_status` = 'active') and ((LOWER(users.first_name) LIKE '%san%' ESCAPE '!' or LOWER(users.last_name) LIKE '%san%' ESCAPE '!' or LOWER(users.email) LIKE '%san%' ESCAPE '!')) order by `users`.`last_name` asc, `users`.`first_name` asc, `users`.`school_id` asc limit 10
```
Nodes:
```
table <subquery2> | access=eq_ref key=distinct_key rows=1 r_rows=1 filtered=100 r_filtered=100 r_total_time_ms=4.22
filesort r_total_time_ms=53.759 loops=1
table users | access=ref key=users_account_status_index rows=9799 r_rows=20009 filtered=100 r_filtered=14.279 r_total_time_ms=27.814
table account_profiles | access=ALL key=- rows=30009 r_rows=30009 filtered=100 r_filtered=100 r_total_time_ms=5.377
```


### Records, SAO, grouped event counts

#### Q13  app 5.31 ms, ANALYZE r_total_time_ms 3.829

```sql
select organization_id, count(*) as total from `events` where `academic_semester_id` = 2 and `organization_id` in (10, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 11, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 12, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 13, 49, 14, 15, 16, 17, 18) group by `organization_id`
```
Nodes:
```
filesort r_total_time_ms=0.02 loops=1
temporary_table
table events | access=ref key=events_academic_semester_id_foreign rows=3000 r_rows=3000 filtered=50.842 r_filtered=100 r_total_time_ms=3.051
```


### Organization space, members join

#### Q9  app 5.87 ms, ANALYZE r_total_time_ms 4.765

```sql
select `account_profiles`.`id` as `profile_id`, `account_profiles`.`role`, `account_profiles`.`position_title`, `users`.`school_id`, `users`.`first_name`, `users`.`last_name`, `users`.`email` from `account_profiles` inner join `users` on `users`.`school_id` = `account_profiles`.`user_school_id` where `account_profiles`.`organization_id` = 10 and `account_profiles`.`account_status` = 'active' and `users`.`account_status` = 'active' order by case account_profiles.role when 'ADMIN' then 0 when 'SBO_OFFICER' then 1 else 2 end, `users`.`last_name` asc, `users`.`first_name` asc limit 300
```
Nodes:
```
filesort r_total_time_ms=0.895 loops=1
temporary_table
table users | access=eq_ref key=PRIMARY rows=1 r_rows=1 filtered=49.997 r_filtered=100 r_total_time_ms=1.483
```

