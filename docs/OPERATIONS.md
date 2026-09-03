# Operations Runbook

Written for whoever runs HIUSA next, not for whoever built it. If you inherited this
system and need to start it, tell whether it's actually working, find a problem, or
undo a bad change, start here.

For how to stand this up on a real server for the first time, see
[`../EC2-DEPLOYMENT.md`](../EC2-DEPLOYMENT.md) (the actual deployment procedure) and
[`docs/DEPLOYMENT.md`](DEPLOYMENT.md) (the go-live checklist and smoke test that wrap
it). This document assumes the three services are already installed somewhere (a
laptop, a lab PC, or a deployed server) and covers running and operating them day to
day — including, for the Docker Compose deployment, what changes when those "three
services" are containers instead of terminal windows (see the Docker Compose mapping
section below).

The real, measured numbers referenced below (test counts, table counts, route counts)
come from `docs/devlog/Completion_Pass_2026-08-28.md` and
`docs/use-case-compliance-audit.md` — re-check those two files if a number here looks
stale; they are the source of truth, this document is not.

---

## 1. The three services

HIUSA is three independent processes. All three must be running for the app to work
end to end; the frontend and Laravel degrade in specific, checkable ways when the
others are down (see §2 and §7).

| # | Service | What it is | Default address |
|---|---|---|---|
| 1 | **Laravel API** | PHP 8.2 / Laravel 12, the system of record | `http://127.0.0.1:8000` |
| 2 | **Python AI service** | FastAPI, deterministic OLS forecasting + budget rules + task-delegation scoring | `http://127.0.0.1:8001` |
| 3 | **Frontend** | React 19 / Vite | `http://localhost:5173` (dev) |

### Starting each service (local development)

Running this on an EC2/Docker Compose deployment instead? See "Production
(Docker Compose): mapping this runbook onto the EC2 stack" below — these three
processes are containers there, not terminal windows.

```powershell
# Terminal 1 - Laravel API
cd server
php artisan serve

# Terminal 2 - Python AI service
cd ai-service
.\.venv\Scripts\Activate.ps1
python run.py

# Terminal 3 - Frontend
cd client
npm run dev
```

Order does not matter for startup — each one waits for the others rather than
crashing when they are absent — but Laravel calling the AI service before it is up
will simply fall back (see §7).

### A queue worker is also required, not optional

Password-reset email (`PasswordResetMail`) and approval-request notification fan-out
(`NotifyApproversJob`) are both queued jobs. `QUEUE_CONNECTION=database` is the
default in `server/.env.example`, which means those jobs land in the `jobs` table and
sit there **until something processes them**. Nobody receives the password-reset
email and no approver gets notified until a worker runs:

```powershell
cd server
php artisan queue:work
```

If nobody runs this, the symptom is silent: the API call that dispatched the job
still returns success (creating the approval request, or requesting the password
reset, succeeded), but the follow-on effect never happens. Check for a stuck queue
with:

```bash
php artisan queue:monitor database:default
# or, for a quick look:
php artisan tinker --execute="echo DB::table('jobs')->count();"
```

A non-zero and growing `jobs` count with no worker running is exactly this failure
mode. Use `queue:work` for a running deployment (add `--tries=3` if you want failed
jobs retried before landing in `failed_jobs`); `queue:listen` is fine for local
development because it picks up code changes without a restart, but it is slower and
not meant for production.

### Scheduled work that must be running

`server/routes/console.php` registers two scheduled commands:

```php
Schedule::command(MarkOverdueTasks::class)->dailyAt('00:05');
Schedule::command(SendEventReminders::class)->hourly()->withoutOverlapping();
```

Nothing runs these automatically unless the Laravel scheduler itself is running.
Locally, confirm they exist and see what would fire next with:

```bash
php artisan schedule:list
```

For a real deployment, either add a single OS-level cron entry that calls Laravel's
scheduler every minute (the standard Laravel approach):

```
* * * * * cd /path-to/server && php artisan schedule:run >> /dev/null 2>&1
```

or run `php artisan schedule:work` in a persistent terminal/service for a
Windows/manual deployment without cron. If neither is running, tasks never
auto-flip to `overdue` and nobody gets an hourly event reminder — the system will
look otherwise healthy, so this is easy to miss. Verify it is actually firing by
checking `storage/logs/laravel.log` after the scheduled time, or by watching the
`tasks.status` / `notifications` tables for the expected changes.

---

## Production (Docker Compose): mapping this runbook onto the EC2 stack

Everything above in §1 (three terminals, `php artisan serve`, `npm run dev`, a
manual `queue:work`, an OS cron entry) is the **local-development** path. The
production path is [`../EC2-DEPLOYMENT.md`](../EC2-DEPLOYMENT.md)'s single
Docker Compose stack, defined in `compose.production.yml`. This section
translates the rest of this runbook onto that stack using its real service
names — read it alongside §1 rather than instead of it.

### The three services, as containers

| Local process (§1) | Compose service | Notes |
|---|---|---|
| `php artisan serve` (Laravel API) | `laravel` | PHP-Apache; depends on `mysql` and `ai-service` reporting healthy before it starts |
| `python run.py` (AI service) | `ai-service` | FastAPI on Uvicorn; never public — only containers on the private `application` network can reach it |
| `npm run dev` (frontend) | `frontend` | Not a Vite dev server — this container serves the React build (compiled at image-build time) through Caddy, which is also the stack's only public container (ports 80/443) |

Two more containers exist with no local single-command equivalent, because
locally they're manual workflows rather than standing processes:

| Compose service | Command it runs | Local equivalent (§1) |
|---|---|---|
| `queue-worker` | `php artisan queue:work --sleep=3 --tries=3 --timeout=120` | the manual `php artisan queue:work` |
| `scheduler` | `php artisan schedule:work` | the OS cron entry (or `schedule:work`) described in §1 — this stack never needs a separate cron job; the container's only command is the persistent `schedule:work` process |

`mysql` (image `mysql:8.4`) has no row above because locally you're pointed at
XAMPP MariaDB instead (see `server/.env.example`). It has no `ports:` mapping
in `compose.production.yml` — it's reachable only from other containers on the
`application` network, not from the host at all.

### Logs

Local: `server/storage/logs/laravel.log`, plus each process's own terminal.
In Compose, every container's stdout goes through Docker's log driver:

```bash
docker compose -f compose.production.yml logs -f laravel        # Laravel app log
docker compose -f compose.production.yml logs -f queue-worker   # job failures
docker compose -f compose.production.yml logs -f scheduler      # scheduled command runs
docker compose -f compose.production.yml logs -f ai-service     # FastAPI/uvicorn
docker compose -f compose.production.yml logs -f frontend       # Caddy access/error log
docker compose -f compose.production.yml logs -f mysql
```

`storage/logs/laravel.log` still exists inside the `laravel`, `scheduler`, and
`queue-worker` containers (they share the `laravel_storage` volume), so the
greps in §4 below still apply — run them with `docker compose exec`:

```bash
docker compose -f compose.production.yml exec laravel \
  grep "HIUSA AI service is unavailable" storage/logs/laravel.log
```

### The queue worker is its own container — confirm it, don't assume it

```bash
docker compose -f compose.production.yml ps queue-worker
```

It must show `Up`, not `Restarting` or missing entirely. If it's down, the
failure is exactly §1's local one: jobs pile up silently in the `jobs` table
with nothing else visibly wrong.

```bash
docker compose -f compose.production.yml exec laravel \
  php artisan tinker --execute="echo DB::table('jobs')->count();"
```

A non-zero, growing count with `queue-worker` not `Up` is this failure mode.
`docker compose -f compose.production.yml restart queue-worker` brings it back
(`scripts/deploy-ec2.sh` recreates it on every deploy, so this is really only a
between-deploys concern).

### The scheduler is also its own container

```bash
docker compose -f compose.production.yml ps scheduler
```

Same consequence as §1's local warning — overdue-task marking and hourly event
reminders silently stop firing — but there is no cron entry to check here: the
`scheduler` container's command already is `php artisan schedule:work`, so
"is cron calling schedule:run" doesn't apply to this stack at all. If the
container isn't `Up`, restart it the same way as `queue-worker` above.

### Health checks, translated

| Check | Local (§2) | Production |
|---|---|---|
| Laravel | `curl http://127.0.0.1:8000/up` | `curl https://DOMAIN/up` — `client/Caddyfile.production` proxies `/up` straight to `laravel:80`, so this is reachable at the real public domain |
| AI service | `curl http://127.0.0.1:8001/health` | **not reachable through Caddy at all** — `client/Caddyfile.production` only proxies `/api/*`, `/storage/*`, `/uploads/*`, and `/up`; `/health` is deliberately not public, matching `EC2-DEPLOYMENT.md`'s runtime layout (the AI service is never exposed to the internet). Check it with `docker compose -f compose.production.yml ps ai-service` (its healthcheck already probes `/health` internally every 15s), or read the actual response with `docker compose -f compose.production.yml exec ai-service python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8001/health').read())"` |
| Frontend | load `http://localhost:5173` | load `https://DOMAIN` — served by the `frontend` container's Caddy, not a Vite dev server |

Everything else below (§3's engine field, §4's log greps, §5's failure modes)
applies exactly as written — only *how you run the command* changes, to
`docker compose exec`/`logs`/`ps` against `compose.production.yml`. §6's
rollback procedure does **not** carry over unchanged on this stack — its
steps assume a bare-metal checkout (`composer install`, `npm ci`, a rebuilt
`dist/` you redeploy by hand) and PowerShell tooling that doesn't exist on
Amazon Linux. Use the Compose-specific version below instead.

### Rolling back the Compose stack

§6's steps 3 and 5 have no equivalent here — dependency installation and the
frontend build both happen at *image-build* time inside the Dockerfile, not
against a running container, and `npm` isn't even present in the `laravel`
container. §6's step 2 (`git checkout` to an older commit) also conflicts
with `scripts/deploy-ec2.sh:26`, which does `git pull --ff-only` on the next
deploy — a plain `checkout` leaves the working tree detached and the next
`deploy-ec2.sh` run will fail. Do this instead:

1. **Stop nothing manually** — rebuilding replaces containers in place.
2. **Roll back the code**: `git checkout <previous-tag-or-commit>` on the EC2
   instance, in `~/Hiusa-FULL`. If you plan to deploy forward again later,
   note this leaves the repo in a detached-HEAD-like state that
   `scripts/deploy-ec2.sh`'s `git pull --ff-only` won't tolerate — reset the
   branch pointer (`git checkout main && git reset --hard <tag>`, understood
   as a deliberate history rewrite on this one instance) before the next
   `deploy-ec2.sh` run.
3. **Rebuild and redeploy**:
   ```bash
   docker compose -f compose.production.yml build
   docker compose -f compose.production.yml up -d
   ```
4. **Only if the bad change included a migration**, restore the database from
   a `scripts/backup-ec2.sh` archive (§7 below) —
   `scripts/restore-database.ps1` does not apply here: it's PowerShell
   defaulting to `127.0.0.1:3307`, Amazon Linux 2023 has no PowerShell, and
   `compose.production.yml` gives `mysql` no host port mapping to connect to
   even if it did. Restore into the container instead:
   ```bash
   docker compose -f compose.production.yml exec -T mysql \
     mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" < backup.sql
   ```
5. **Re-run the health checks** in this section and the smoke test in
   `docs/DEPLOYMENT.md` before declaring the rollback complete.

---

## 2. Health checks — proving each service is actually up

Don't assume a service is healthy because its terminal didn't print an error. Check:

| Service | Check | What "healthy" looks like |
|---|---|---|
| Laravel | `GET /up` (e.g. `curl http://127.0.0.1:8000/up`) | `200 OK` — this is Laravel's built-in health route, registered in `server/bootstrap/app.php` (`health: '/up'`) |
| Python AI service | `GET /health` (e.g. `curl http://127.0.0.1:8001/health`) | `200 OK` with JSON body; **read the body, not just the status code** — see below |
| Frontend | Load `http://localhost:5173` (dev) or the built site | Page renders and can reach the API — a blank page or "Failed to fetch" toast means Laravel is unreachable, not that the frontend itself is broken |

### Reading the AI service's `/health` response, not just its status code

`/health` returns `200` even when authentication is effectively off. The field that
matters is `authentication`:

```json
{ "authentication": "api-key" }   // healthy: HIUSA_AI_SERVICE_KEY is set and enforced
{ "authentication": "disabled" }  // the service accepts ANY request with no key check
```

`"disabled"` means `HIUSA_AI_SERVICE_KEY` is blank in `ai-service/.env` — the service
**fails open**, not closed. That is an acceptable state only when the service is
bound to `127.0.0.1` with no other host able to reach it. On anything reachable by
more than the operator's own machine, treat `"disabled"` as a live finding, not a
passive fact — set a real key in both `ai-service/.env` and `server/.env`
(`HIUSA_AI_SERVICE_KEY` must match exactly in both files).

---

## 3. Which engine actually served an AI result

Every AI-backed response (financial forecasts, budget advice, task-delegation
scoring) carries an `engine` field:

- `"python-fastapi"` — the Python service answered.
- `"php-fallback"` — the Python service did not answer (down, timed out, rejected the
  request, or `HIUSA_AI_SERVICE_ENABLED=false`), and Laravel computed the same
  calculation itself, locally, in PHP.

**This is the most likely production surprise**: the app keeps working either way,
the numbers are the same algorithm re-implemented in both languages (verified
identical by `AiFallbackParityTest`), and nothing in the UI shouts "the Python
service is down." A demo or a real session can run entirely on `php-fallback` and
look completely normal. If you need to know which engine is actually running,
inspect the `engine` field in the API response (visible in the client's "How this
was calculated" disclosure on forecast/task-delegation views), or check the log —
every fallback logs a specific line (§4).

Groq narration for announcements/event-plan generation degrades independently the
same way: if `GROQ_API_KEY` is blank or the Groq call fails, Laravel returns a
deterministic local summary instead of AI-generated prose. Neither fallback is an
error state — both are designed behavior — but an operator should know which one is
actually in effect rather than assume the AI service is doing the work.

### Why the Groq call is synchronous, not queued

`GroqResponsesService::generate()` (`server/app/Services/GroqResponsesService.php`)
makes its `Http::post()` call inline, inside the request/response cycle, not through
a queued job. That is why announcement drafting and event-plan generation take
visibly longer than a normal API call (`GROQ_TIMEOUT` bounds it: the code default is 25s and the shipped `.env` sets 30s; a
blank value is clamped to 25s rather than becoming an unbounded wait) — the
caller is waiting on the HTTP round trip to Groq before the response returns.

This is deliberate for now because the feature is synchronous-shaped: the user asked
for a *draft* right on that screen and is waiting to see and edit it immediately —
there is nothing useful to show before the text comes back, so queuing it would only
add a second round trip (submit job, then poll or get notified, then fetch the
result) for no gain. The load profile does not call for it either: only
low-frequency officer and admin actions (announcement drafting, event planning,
budget advice, forecasting) call Groq, and no high-concurrency student path (voting,
feeds, merchandise) touches it at all. It would need to change if Groq calls started blocking request
throughput under real concurrent load, or if the UI moved to a "generate in the
background, notify me when ready" pattern — neither is true today.

---

## 4. Where logs are, and what to grep for

Default log location (per `server/.env.example`, `LOG_CHANNEL=stack` /
`LOG_STACK=single`):

```
server/storage/logs/laravel.log
```

Useful greps:

| Symptom | Grep |
|---|---|
| AI service degraded to fallback | `grep "HIUSA AI service is unavailable" server/storage/logs/laravel.log` |
| AI service reachable but rejected a request (bad payload, wrong key) | `grep "HIUSA AI service rejected a request" server/storage/logs/laravel.log` |
| Groq unreachable or timed out | `grep "Groq Responses API is unavailable" server/storage/logs/laravel.log` |
| Groq reachable but returned an error or empty text | `grep "Groq Responses API request failed\|Groq Responses API returned no output text" server/storage/logs/laravel.log` |
| Queued job failures | check the `failed_jobs` table: `php artisan queue:failed` |

The Python AI service logs to its own process's stdout (uvicorn's access/error log);
when running it as a background service, redirect that to a file, e.g.
`python run.py >> ai-service.log 2>&1`, so it survives after the terminal closes.

---

## 5. Common failure modes seen in this project

These are recorded, not hypothetical — each was hit during actual development
sessions on this codebase.

| Symptom | Cause | Fix |
|---|---|---|
| Laravel can't connect to the database; migrations fail with a connection error | MariaDB/MySQL is listening on a different port than `DB_PORT`. On this project's primary dev machine, a standalone MySQL 8 install occupies port 3306, so XAMPP's MariaDB was moved to 3307 — `DB_PORT=3306` in the tracked `.env.example` is a sane *default*, not this machine's actual value. | Check what port the running MySQL/MariaDB actually listens on (XAMPP Control Panel → MySQL → Config → `my.ini`, or `netstat -ano \| findstr 3306` / `3307`) and set `DB_PORT` to match. Don't assume the example file's value is correct on a new machine. |
| `FinancialAccountabilityTest` (or any GCash QR / candidate photo upload) fails, or image uploads silently fail | The `gd` PHP extension is disabled. | Enable it in `php.ini` (`extension=gd`, uncomment/add the line) and restart PHP/the dev server. Confirm with `php -m \| findstr gd`. |
| AI-backed features (forecasts, task delegation, announcement drafts) quietly use the local/fallback calculation with no visible error | One or more of the AI-related env vars is missing or wrong: `HIUSA_AI_SERVICE_ENABLED`, `HIUSA_AI_SERVICE_URL`, `HIUSA_AI_SERVICE_KEY` (must match `ai-service/.env` exactly), or `GROQ_API_KEY`. This degrades silently by design (see §3) rather than erroring, which makes a misconfigured install look correct. | Confirm `/health` on the Python service reports `"authentication": "api-key"`, confirm `server/.env` has all five `HIUSA_AI_SERVICE_*` vars and the four `GROQ_*` vars set, and grep the log per §4 to see which fallback is firing. |
| Candidate photos, partylist images, merchandise images, or GCash QR images return 404 even though the upload appeared to succeed | The `storage` symlink is missing — Laravel serves `public/storage` as a symlink into `storage/app/public`, and a fresh clone or a fresh deployment does not create it automatically. | `cd server && php artisan storage:link` |
| Password reset / approval-notification changes don't appear to have any effect | No queue worker is running (§1). Jobs sit in the `jobs` table until one runs. | Start `php artisan queue:work` (or verify whatever process supervisor is meant to be running it, actually is). |
| Client dev dependencies (`vitest`, `playwright`, testing-library, `jsdom`) appear missing after a clone or a `node_modules` change | These are devDependencies in `client/package.json`; a partial/interrupted `npm install` or a stale `node_modules` can leave them out. | `cd client && npm install` (or `npm ci` for a clean, lockfile-exact install). |
| CORS errors in the browser console | `FRONTEND_URL` / `FRONTEND_URLS` in `server/.env` don't include the origin the browser is actually loading from. | Add the exact origin (scheme + host + port) to `FRONTEND_URLS`, restart `php artisan serve`. See `docs/DEPLOYMENT.md` for the production-origin version of this. |
| A migration passes every test locally, then aborts partway on MySQL/MariaDB with error 1553, leaving tables created but the migration unrecorded — a retry then fails with "table already exists" | `server/phpunit.xml` pins the test suite to SQLite (`DB_CONNECTION=sqlite`, `DB_DATABASE=:memory:`), which allows a migration that MySQL/InnoDB refuses. **Found and fixed on 2026-09-03 (commit 5a786bf):** `server/database/migrations/2026_08_31_000004_make_positions_role_aware.php` dropped the unique index on `sbo_positions` that an InnoDB foreign key depends on before creating its replacement — SQLite permits this, MySQL does not. | Fixed by reordering: the replacement unique index is created first, then the one the foreign key relied on is dropped, so a covering index always exists. CI now has a `migrations-mysql` job that runs `migrate:fresh --seed` plus a rollback against both `mysql:8.4` (what `compose.production.yml` deploys) and `mariadb:10.4` (the XAMPP dev database), so a green SQLite run alone no longer decides whether a migration is safe. |

---

## 6. Rollback procedure

`scripts/deploy-ec2.sh` is HIUSA's deploy pipeline, but it is forward-only — it
applies migrations and redeploys code, and never rolls either back
(`EC2-DEPLOYMENT.md` §5). Rollback is therefore a manual, ordered procedure. Do
the steps in this order — code first, database last, and only if the database
actually needs it:

1. **Stop the running services** (Laravel, the AI service, and the queue
   worker/scheduler if applicable) so nothing writes to the database mid-rollback.
2. **Roll back the code.** `git checkout` (or redeploy) the previous known-good
   commit/tag for all three of `server/`, `client/`, `ai-service/` together — they
   are versioned in one repo, but don't assume a partial rollback of just one service
   is safe if the change spanned more than one.
3. **Reinstall dependencies for the rolled-back code**, since `composer.lock` /
   `package-lock.json` / `requirements*.txt` may differ from what's currently
   installed:
   ```bash
   cd server && composer install
   cd client && npm ci
   cd ai-service && pip install -r requirements.txt
   ```
4. **Only if the bad change included a migration**, restore the database from the
   verified backup taken *before* that migration ran (see `scripts/restore-database.ps1`,
   §7 below, and the backup bullet in `docs/DEPLOYMENT.md`'s go-live checklist,
   lines 85-90, which also covers `scripts/backup-ec2.sh` for the Compose stack).
   Do **not** restore the database if the rollback is code-only — that would also
   discard every real row written since the backup for no reason.
5. **Rebuild the frontend** if `client/` changed: `cd client && npm run build`, and
   redeploy the new `dist/` output to wherever it's served from.
6. **Restart all services**, then re-run the health checks in §2 and the smoke test
   in `docs/DEPLOYMENT.md` before declaring the rollback complete.
7. **Re-run the queue worker and scheduler** (§1) — a rollback that stops and
   restarts services can leave a queue worker not restarted, which reproduces the
   "silent no notifications" failure mode from §5 for an unrelated reason.

---

## 7. Backup and restore

Two backup paths exist depending on which database you're pointed at, plus a
restore-verification step neither script can do for you — a script that reads
a dump file back can't know whether the schema it produced actually matches
what the application expects.

### Local dev / Windows (MariaDB on `127.0.0.1:3307`)

```powershell
.\scripts\backup-database.ps1
```

Writes a timestamped `mysqldump` under `backups\` (run with `-?` for every
parameter — host, port, user, password, output directory). Restore one with:

```powershell
.\scripts\restore-database.ps1 -Database hiusa_db -BackupFile <path-to-dump> -Force
```

`-Force` is required on purpose — omitting it prints what would happen and
changes nothing. `restore-database.ps1` does not create the target database;
it must already exist.

### Production (Docker Compose / EC2)

```bash
bash scripts/backup-ec2.sh
```

Dumps the `mysql` container's database to a timestamped file on the EC2
instance. `scripts/deploy-ec2.sh` already runs this automatically before every
migration it applies (`EC2-DEPLOYMENT.md` §5); run it manually before any
change that doesn't go through that script, and copy the resulting file off
the instance — a backup that lives only on the box it's backing up is not a
backup.

### Verifying a dump is actually restorable

A file that exists and is non-empty (both scripts already check this before
they'll call it a success) is not the same as a file that restores correctly.
Before trusting a backup for a real rollback:

1. Create a scratch database and restore into it — never the live one:
   ```powershell
   mysql -u root -h 127.0.0.1 -P 3307 -e "CREATE DATABASE hiusa_restore_check;"
   .\scripts\restore-database.ps1 -Database hiusa_restore_check -BackupFile <path> -Force
   ```
2. Compare table and row counts against the source database, one query
   against each:
   ```sql
   SELECT table_name, table_rows FROM information_schema.tables
   WHERE table_schema = 'hiusa_restore_check'
   ORDER BY table_name;
   ```
   run again with `table_schema = 'hiusa_db'` and diff the two result sets. A
   missing table or a row-count mismatch means the dump is incomplete or the
   restore failed partway — don't trust it for a real rollback.
3. Drop the scratch database once the counts match:
   `mysql -u root -h 127.0.0.1 -P 3307 -e "DROP DATABASE hiusa_restore_check;"`

This is the check `backup-database.ps1` and `restore-database.ps1` point back
to this document for, and it's what §6's rollback step 4 and the go-live
checklist in `docs/DEPLOYMENT.md` (lines 85-90) both assume has already been
done before a backup is trusted.
