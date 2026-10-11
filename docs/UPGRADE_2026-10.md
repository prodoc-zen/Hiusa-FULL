# Upgrading a live HIUSA server to the agency hierarchy release (October 2026)

This is the checklist for the server that already holds real data (the Lightsail instance in LIGHTSAIL_DEPLOYMENT_AND_MAINTENANCE.md). It does not repeat the general update commands; those live in section 2 of that guide ("Pull a GitHub update"). This page adds what is specific to this release: what changes in the data, what to back up, how to rehearse, which extra commands to run, how to check the result and how to go back.

Nothing deploys by itself when code is pushed to GitHub. Someone with SSH access to the server runs these steps.

## 1. What this release changes in the data

- Colleges become a fixed list. The college hierarchy migration (`2026_10_09_000001_add_college_hierarchy`) adds `organizations.college_id`, fills it from the free-text `college` name, creates one home organization of type COLLEGE for every row in `colleges`, and moves each existing Department Head (the user row and the profile) from their student organization into their college's home organization. A Department Head then oversees every student organization of that college.
- Organizations gain a lifecycle (`pending`, `returned`, `active`, `archived`). Every existing organization is set to `active`.
- Audit log indexes (`2026_10_10_000001_add_audit_log_indexes`).
- Users gain `must_change_password` (`2026_10_10_000002_add_must_change_password_to_users`), false for everyone who exists today. Accounts created by the class list import, by an administrator choosing a password, or by the SAO from now on must change their password at first sign-in.
- Financial report supporting documents move from the public disk to a private one behind a login (the command in step 5).
- Department Heads no longer vote or buy merchandise, and Admins can no longer assign the Department Head role. Only the SAO creates a Department Head, from the Colleges page.
- The SAO can no longer create colleges or organizations. A Department Head registers organizations and the SAO approves them.

The live data has hand-typed college names with different capitalization (for example "COLLEGE OF COMPUTER STUDIES" next to "College of Engineering"). MySQL compares names without regard to case, so the backfill matches them, but check the result with the script in step 6.

## 2. Before anything else

1. Back up the database with `scripts/backup-database.ps1` or `mysqldump` (see docs/OPERATIONS.md) and keep the uploaded files (`storage/app`, `storage/app/public`). Verify the dump restores; a dump that was never restored is not a backup.
2. Note the current Git revision on the server (`git rev-parse HEAD`) so you can name the last working version.
3. Rehearse on a copy. Restore the dump into a throwaway database on a machine you do not care about, point a checkout of this release at it, and run the migrations and the check script from step 6. Do this at least once. It is the only way to find a data surprise before it happens on the real server.

## 3. Do not run the demo seeders

Do not run `db:seed`, `CollegeSeeder`, `OrganizationSeeder`, `DepartmentHeadSeeder` or any other seeder on this server. An earlier migration (`2026_09_28_000003_create_colleges_table`) builds the colleges table from the college names the organizations already use, so on an up-to-date server the table holds the colleges that match the organizations. `CollegeSeeder` would add the five demo colleges next to them, and the SAO would then see colleges that have no organizations. The hierarchy migration does everything the production data needs. Check `select * from colleges` during the rehearsal: if the table is empty, that earlier migration has not run on this server yet and `php artisan migrate:status` will say so.

If a college is missing from the list after the upgrade, add it with the `colleges:sync` command. There is no screen for it by design. Put the full list of colleges in a text file on the server, one per line as `Name` or `Name,CODE` (blank lines and lines starting with `#` are ignored). In this plain form a name cannot contain a comma. After the last comma, a single word of up to 8 letters, digits or hyphens with at least one letter or digit, all capitals or all lowercase, is the code and is stored in capitals (CCS, coe and CL-2 are codes); anything else after a comma stops the run, so a long word such as `Humanities` is refused rather than taken as a code. A name that really contains a comma is written in the pipe form, `Name | CODE`, for example `College of Hospitality, Tourism and Customs Administration | CHTCA`: the last pipe separates the name from the optional code, so commas in the name are kept as they are, the code after the pipe follows the same rule as above, and nothing after the pipe means no code. More than one pipe on a line stops the run, and so does a look-alike of the pipe (a full-width or broken bar pasted from a document): retype it with the | key. Read every "with code" line of the dry run before the real run, because a short one-word tail is always taken as a code. Two lines that differ only by accents, or by case or spacing, are refused as the same college. The file must be readable by the `www-data` user, so put it in `/tmp` (an Ubuntu home folder is mode 750 and `www-data` cannot read `/home/ubuntu`). Then run it twice, first as a rehearsal and then for real:

```bash
sudo -u www-data /usr/local/bin/hiusa-artisan colleges:sync /tmp/colleges.txt --dry-run
sudo -u www-data /usr/local/bin/hiusa-artisan colleges:sync /tmp/colleges.txt
```

The dry run prints what would happen and writes nothing. The real run creates each college that is missing and also creates its home organization. A raw row in `colleges` is not enough on its own: without a home organization, assigning a Department Head to that college fails with "This college has no home organization yet." The command matches names ignoring case and extra spaces, so the colleges already in the database are recognised and not duplicated. It fills in a missing code (and the home organization's acronym when that is blank) but never overwrites a code that is already set (it reports the difference instead), and it never renames, deactivates or deletes a college that is not in the file (those are listed as not in the list). For every college in the file, whether it already existed or was just created, it also links the existing student organizations that have no college yet (empty `college_id`) and whose free-text college name matches the college, ignoring case and extra spaces. Without that link the college's Department Head does not see those organizations, and sections 3 and 10 of the check script keep listing them. It never moves an organization from one college to another: an organization that already has a college is left as it is, even if its free-text name matches a different college in the file. The dry run says how many organizations would be linked to each college, and the real run says how many were. If an organization's free-text college name is misspelled, fix the name and run the command again. Running it again with the same file changes nothing. Any error in the file stops the whole run before anything is written. After it finishes, rerun the check script.

## 4. Deploy

Follow section 2 of the Lightsail guide: `git pull --ff-only`, `composer install --no-dev ...`, `php artisan migrate:status`, then `php artisan migrate --force`, `optimize:clear`, `optimize`, `npm ci` and `npm run build` in `client/`, restart `php8.3-fpm`, the queue worker and the scheduler. The Python AI service and the fingerprint matcher did not change in this release, so skip their steps.

The scheduler matters in this release: a new job runs every minute and opens elections at their start time (`elections:sync-statuses`). Confirm `hiusa-scheduler` is active after the restart.

## 5. Commands for this release (run once, after the migration)

```bash
cd /var/www/hiusa/server
sudo -u www-data /usr/local/bin/hiusa-artisan financial-reports:secure-documents
```

This moves existing financial report supporting documents from the public disk to the private one and removes the public link. It is safe to repeat. It prints how many documents it moved and how many listed files were missing; a missing file is a document that was already gone.

Accounts that existed before this release keep `must_change_password = false`, including class-list students still on the old `<last four digits of the school ID>-uclm` password and demo accounts on `Demo@12345` or `Admin@123456`. Take a database backup first, then run:

```bash
sudo -u www-data /usr/local/bin/hiusa-artisan users:flag-default-passwords --dry-run
sudo -u www-data /usr/local/bin/hiusa-artisan users:flag-default-passwords
```

The command checks each account that is not yet flagged against those known defaults and requires a password change at the next sign-in where one matches. It prints how many accounts it checked and flagged, never a password or hash. `--dry-run` writes nothing. `--never-signed-in` also flags every account that has no sign-in token at all; a token is removed on sign-out, so this can also flag someone who signed in and out before. It is a command and not a migration because every check is a bcrypt comparison: budget about half a second per account (about 15 minutes for 2,000 accounts), run it in a maintenance window, and rerun it safely if it is interrupted, since flagged accounts are skipped.

When the SAO opens the next academic semester in the app, the semestral report requirement is created with it. For a semester that is already open, run once:

```bash
sudo -u www-data /usr/local/bin/hiusa-artisan compliance:seed-semestral-report
```

## 6. Check the result

Run the read-only script and read every section. The "must be empty" sections must return no rows.

```bash
mysql -u <user> -p <database> < scripts/upgrade-checks.sql
```

Things to look at by eye: the list of colleges (are they the colleges you expect), how many active Department Heads each college has (more than one means two people share the role, which is allowed but unusual), and any organization whose free-text college name did not match a college row (section 10 of the script: fix the name, or add the college with `colleges:sync` as described in section 3).

Venue bookings saved before this release may hold times that were sent in UTC and read back as Manila time, so they show hours off. The live server held 4 bookings on 2026-10-12 (1 pending, 1 rejected, 2 withdrawn, none approved). Run `select count(*) from venue_bookings;` to see whether that has changed. Compare the pending one with what the requester typed and correct it by hand if it is 8 hours off. There is no data migration for this; a guess would move real reservations.

## 7. Smoke test as each role

Use real accounts, not demo ones. Sign in as: the SAO (agency overview loads, Compliance tabs load, the Colleges page lists each college with its Department Head or "No Department Head yet"), a Department Head (Organizations page shows the college's organizations, Approvals lists items from every organization in the college), an organization Admin (home shows the Getting started card, Approvals has two tabs), an officer and a student. Then the specific checks for this release: a student cannot open Cast Vote as a Department Head; an Admin cannot create a user with the Department Head role (the server refuses it with a validation error); open a financial report with supporting documents and confirm the file opens only when signed in (try the same link in a private window: it must ask you to sign in).

If a college has no Department Head account yet, the SAO creates one on the Colleges page (Assign Department Head). Until then nobody can register organizations or approve for that college.

## 8. Go back

- Code: deploy the last working revision with a reviewed forward fix or a Git revert from a development machine (the Lightsail guide says not to `git reset --hard` on the server).
- Data: restore the pre-upgrade dump. Rolling the migrations back (`php artisan migrate:rollback`) works, but it is lossy: organization lifecycle states other than active and the college home organizations are dropped, and Department Heads are moved back to the first student organization of their college. Prefer the dump.
- The private documents moved in step 5 stay private after a code rollback; restore the uploaded-files backup if you need the old public links back.

## 9. Who should test before real users do

Run docs/MEMBER_TESTING.md with a few members on a copy first (a laptop on the local network is enough). Do not give testers demo passwords on the live server.
