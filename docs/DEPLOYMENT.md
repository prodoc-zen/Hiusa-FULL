# Deployment Guide

How to stand HIUSA up for real use, on infrastructure of your own choosing. No
specific paid host is prescribed here — none has been chosen for this project — this
document covers what is true regardless of where it runs: a VPS, a school's own
server, or any PaaS that can run PHP, Node, and Python processes.

Read `docs/OPERATIONS.md` first if you haven't — this document is about the one-time
path to going live; that one is about running the thing day to day afterward.

> **Existing partial deploy config found in the repo:** `server/Procfile` and
> `server/nixpacks.toml` already exist from an earlier deployment attempt (Railway/
> Heroku-style buildpacks). They currently provision **SQLite** (`touch
> database/database.sqlite`), which contradicts the MySQL/MariaDB-for-concurrent-users
> guidance below and in the project's `CLAUDE.md`. They are left as-is here — updating
> them is outside this document's file set — but do not assume they are the correct
> production path without reconciling that mismatch first.

---

## 1. Build steps per service

### Laravel API (`server/`)

```bash
cd server
composer install --no-dev --optimize-autoloader
cp .env.example .env          # then edit .env - see the PRODUCTION OVERRIDES
                               # section at the bottom of .env.example
php artisan key:generate
php artisan config:cache
php artisan route:cache
php artisan storage:link      # without this, every uploaded image 404s - see OPERATIONS.md §5
```

Serve `server/public/` behind a real web server (Apache/nginx) or a process manager
running `php artisan serve --host=0.0.0.0 --port=<port>` behind a reverse proxy (see
§3). `--no-dev` matters: it excludes `laravel/pail`, `laravel/sail`, and the test
tooling from the production install.

### Frontend (`client/`)

```bash
cd client
npm ci
# VITE_API_URL must already be set to the real API URL in client/.env
# BEFORE this build - Vite env vars are compiled in, not read at runtime.
npm run build
```

`npm run build` produces static files in `client/dist/`. Serve that directory from
any static file host or from the same reverse proxy that fronts the API (§3) — there
is no Node server required at runtime for the built frontend itself.

### Python AI service (`ai-service/`)

```bash
cd ai-service
python -m venv .venv
source .venv/bin/activate     # or .\.venv\Scripts\Activate.ps1 on Windows
pip install -r requirements.txt
cp .env.example .env          # set HIUSA_AI_SERVICE_KEY - see PRODUCTION OVERRIDES
                               # in ai-service/.env.example
```

Run it with a production ASGI setup rather than the dev `python run.py` reload
server, e.g.:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 2
```

Bind to `127.0.0.1`, not `0.0.0.0`, unless another host on the network genuinely
needs direct access to it — Laravel is the only intended caller in the normal
architecture (see `docs/OPERATIONS.md` §2-3).

---

## 2. Migration and seeding — the seeder trap

Run migrations on the real database exactly once, before first use:

```bash
cd server
php artisan migrate --force
```

**Do NOT run `php artisan db:seed` (or `migrate:fresh --seed`) against a real
installation.** The demo seeders (`AdministratorSeeder`, `UserSeeder`,
`DepartmentHeadSeeder`, and the rest called from `DatabaseSeeder`) create a full set
of demo accounts — Admin, officers, department heads, and students — **with fixed,
published passwords**. Those exact credentials are printed in this project's
`README.md` for local-demo convenience. Seeding a real installation creates:

- `admin@hiusa.local` / `Admin@123456`
- Several `*@hiusa.local` officer/department-head accounts on `Demo@12345`
- A block of student accounts, all on `Demo@12345`

on a database that other people will actually use — with credentials that are
public, in version control, in this very repository. This is a genuine security
trap, not a hypothetical one: anyone who has read the README (which is everyone who
cloned the repo to work on it) can log in as Admin on a seeded real deployment.

For a real deployment:

1. Run `php artisan migrate --force` only — this creates the schema with zero rows.
2. Create the first real Admin account through whatever path is appropriate (a
   one-off `php artisan tinker` insert with a freshly generated password, or a
   dedicated first-run admin-creation step if one exists) — never through the demo
   seeders.
3. Every other account (officers, department heads, students) should be created
   through the running application by that real Admin, with real credentials chosen
   by their actual owners — not seeded.

If a real installation was accidentally seeded with demo data, treat every one of the
credentials above as compromised: disable or delete those accounts and re-create real
ones, don't just change passwords on the demo accounts and keep using them.

---

## 3. Reverse proxy and HTTPS

Nothing in Laravel or FastAPI terminates TLS on its own. The standard shape:

```
                          ┌─────────────────────────┐
Internet ── HTTPS:443 ──▶│  Reverse proxy            │
                          │  (nginx / Caddy / your    │
                          │   platform's own LB)      │
                          └───────────┬───────────────┘
                                      │ plain HTTP, localhost only
                        ┌─────────────┼──────────────┐
                        ▼             ▼              ▼
                 Laravel :8000   Frontend        AI service
                 (php-fpm or     static files    :8001
                  artisan serve)  (client/dist)   (127.0.0.1 only -
                                                   never exposed directly)
```

- The reverse proxy holds the TLS certificate (Let's Encrypt via Caddy is the least
  ceremony; nginx + certbot is the traditional route) and forwards to the Laravel
  process over plain HTTP on `127.0.0.1`.
- Route the frontend's static build and the API through the same public domain on
  different paths (e.g. `/` → `client/dist`, `/api/*` → Laravel) if you want one
  origin and no CORS configuration at all in production. If you instead serve them
  from two different domains/subdomains, CORS must be configured correctly (see
  `FRONTEND_URL` / `FRONTEND_URLS` production guidance in `server/.env.example`).
- The Python AI service should not be reachable from the public internet at all in
  the normal architecture — only Laravel calls it, over loopback or an internal
  network segment.
- Once HTTPS is live, set `APP_URL` to the `https://` URL, `SESSION_SECURE_COOKIE=true`,
  and `VITE_API_URL` to the `https://` API URL before building the frontend — see the
  PRODUCTION OVERRIDES sections added to both `.env.example` files.

---

## 4. Go-live checklist

Work through this before calling a deployment live. Every item traces to something
covered in more detail elsewhere in this document, `docs/OPERATIONS.md`, or the
`.env.example` files.

- [ ] `server/.env`: `APP_ENV=production`, `APP_DEBUG=false` (verified — hit a
      deliberately-broken URL and confirm you get a generic error page, not a stack
      trace)
- [ ] `APP_URL` set to the real `https://` domain
- [ ] `SESSION_SECURE_COOKIE=true` (only after HTTPS is actually serving the app)
- [ ] `FRONTEND_URL` / `FRONTEND_URLS` set to the exact real frontend origin(s);
      the LAN-pattern `FRONTEND_ORIGIN_PATTERNS` removed
- [ ] A real `MAIL_MAILER` configured (not `log`) — verify by actually triggering a
      password-reset email and receiving it
- [ ] `HIUSA_AI_SERVICE_KEY` set to a real value, identical in `server/.env` and
      `ai-service/.env` — confirm `GET /health` on the AI service reports
      `"authentication": "api-key"`, not `"disabled"`
- [ ] `GROQ_API_KEY` set if AI-generated narration (announcement drafts, event
      plans, financial summaries) is wanted; otherwise the deterministic fallback is
      fine but should be a known choice, not an oversight
- [ ] `client/.env` `VITE_API_URL` set to the real API URL, **and the frontend
      rebuilt** after setting it (Vite bakes it in at build time)
- [ ] Migrations run (`php artisan migrate --force`); demo seeders **not** run (§2)
- [ ] A real first Admin account created manually, not from the seeders
- [ ] `php artisan storage:link` run — otherwise every uploaded image 404s
- [ ] A queue worker running (`php artisan queue:work` or a supervised equivalent) —
      otherwise password-reset emails and approval notifications silently never send
- [ ] The scheduler running (cron calling `schedule:run` every minute, or
      `schedule:work` as a persistent process) — otherwise overdue-task marking and
      event reminders never fire
- [ ] Reverse proxy terminating HTTPS in front of both the frontend and the API
- [ ] A verified backup taken (see `scripts/backup-database.ps1` and the procedure
      in `docs/OPERATIONS.md`) before the first production migration and before any
      migration after that
- [ ] The smoke test below run once, post-deploy, against the real URL

---

## 5. Post-deploy smoke test

Run this immediately after any deployment, exercising one real path per module
rather than trusting that "it built" means "it works." All paths are relative to the
real deployed frontend/API origin.

1. **Health** — `GET /up` on the API returns `200`; `GET /health` on the AI service
   returns `200` with `"authentication": "api-key"`.
2. **Auth** — log in as the real Admin account created in §2 (not a seeded demo
   account, because there shouldn't be one). Confirm the dashboard loads.
3. **Announcements** — create one announcement, publish it, confirm it appears on a
   non-admin account's announcement feed.
4. **Events** — create one event, submit it through the approval flow, have the
   Department Head account approve it, confirm it shows in the events calendar.
5. **Tasks** — create one task, assign it (accept the AI-recommended assignee or
   assign manually), confirm the assignee sees it and can update its status.
6. **Finance** — create one budget, submit and approve it, record one transaction
   against it, confirm the remaining balance updates correctly.
7. **Merchandise** — create one item, place one cash order as a student account,
   approve/fulfill it as an officer, confirm the claim token flow completes.
8. **Elections** — create one election with at least one position and candidate,
   approve it, cast one vote as a student, confirm the double-vote guard rejects a
   second attempt with a clear message (not a 500).
9. **Notifications** — confirm the approver from step 4 (or 6) actually received a
   notification — this is the queue-worker check from the go-live list, verified
   end to end rather than just "a worker process is running."
10. **Password reset** — trigger "Forgot password" for one account and confirm the
    email actually arrives at a real inbox — this is the `MAIL_MAILER` check,
    verified end to end.

If any step fails, check `docs/OPERATIONS.md` §5 (common failure modes) before
assuming it's a new bug — most first-deploy failures on this project have been one
of: wrong DB port, missing `storage:link`, a queue worker that isn't running, or an
AI/mail env var that didn't make it into the real `.env`.
