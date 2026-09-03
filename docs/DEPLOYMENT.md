# Go-Live Checklist & Smoke Test

[`EC2-DEPLOYMENT.md`](../EC2-DEPLOYMENT.md) is the deployment procedure: the
single-instance Docker Compose stack (Caddy, the frontend build, Laravel, the AI
service, MySQL, a scheduler container, and a queue-worker container), plus
`scripts/setup-ec2.sh` and `scripts/deploy-ec2.sh`. This document does not repeat
that procedure. It is the checklist to work through before calling a deployment
live, the smoke test to run immediately after, and the one trap — seeding real
data — that a fresh clone makes easy to fall into. For day-to-day operation once
it's live, see [`docs/OPERATIONS.md`](OPERATIONS.md).

---

## The seeder trap

`scripts/setup-ec2.sh` already enforces the right default: run without
`--seed-demo`, first-run setup creates the schema with **zero rows** — no demo
accounts. `--seed-demo` is opt-in, and the script refuses plain HTTP unless
`--insecure-demo-only` is also passed, which only makes sense for a disposable
demo on a bare Elastic IP (`EC2-DEPLOYMENT.md` §3).

That flag is opt-in for a specific reason: the demo seeders
(`AdministratorSeeder`, `UserSeeder`, `DepartmentHeadSeeder`, and the rest called
from `DatabaseSeeder`) create a full set of accounts with fixed passwords —
`Admin@123456` for the one System Administrator account, `Demo@12345` for
every officer, adviser, department head, and student account — and those
passwords are not a secret held anywhere: they are literal strings in the
seeder source files themselves, in plain text, in version control. Most of
them are also republished in this repository's `README.md`'s demo-accounts
section, in plain text.

Anyone who has ever cloned this repo to work on it has read those credentials.
Running `--seed-demo` against anything other than a genuinely disposable
install means anyone who has read the README can log in as Admin. Never use it
on a domain with real users, and never combine it with a database that already
has real data. If a real installation was accidentally seeded, treat every
credential above as compromised — disable or delete those accounts and create
real replacements; don't just change passwords on the demo accounts and keep
using them.

---

## Go-live checklist

Each item points at the concrete EC2 step or script that satisfies it.

- [ ] `APP_ENV=production`, `APP_DEBUG=false` in `server/.env.production` (this
      is what `setup-ec2.sh` writes) — verified by hitting a deliberately-broken
      URL post-deploy and confirming a generic error page, not a stack trace.
- [ ] DNS for the real domain already resolves to the instance's Elastic IP
      **before** running `bash scripts/setup-ec2.sh hiusa.example.com` — Caddy
      requests the certificate on first boot and needs live DNS to do it
      (`EC2-DEPLOYMENT.md` §3).
- [ ] `--insecure-demo-only` was **not** used for this install, unless this is
      genuinely a disposable demo — a real domain gets HTTPS from Caddy
      automatically, with no manual certificate handling.
- [ ] A real `MAIL_MAILER` configured in `server/.env.production` (the default
      template logs email instead of sending it) — verify by actually
      triggering a password-reset email and receiving it. `setup-ec2.sh` does
      not configure a mail provider for you; see `EC2-DEPLOYMENT.md`'s
      "Production follow-ups".
- [ ] `HIUSA_AI_SERVICE_KEY` set — `setup-ec2.sh` generates this itself and
      writes the same value into both `server/.env.production` and
      `ai-service/.env.production`. Confirm it's enforced, not just present:
      ```bash
      docker compose -f compose.production.yml exec ai-service \
        python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8001/health').read())"
      ```
      should print `"authentication": "api-key"`, not `"disabled"`.
- [ ] `GROQ_API_KEY` set if AI-generated narration (announcement drafts, event
      plans, financial summaries) is wanted — `setup-ec2.sh` prompts for it via
      hidden input. Otherwise the deterministic fallback is fine, but should be
      a known choice, not an oversight.
- [ ] Migrations run with zero demo rows — `setup-ec2.sh` does this on first
      run. Confirm `--seed-demo` was **not** passed unless this is a
      disposable install (see "The seeder trap" above).
- [ ] A real first Admin account created manually through the running
      application or `tinker`, never from the demo seeders.
- [ ] All six containers running/healthy:
      `docker compose -f compose.production.yml ps` — `mysql`, `ai-service`,
      and `laravel` carry health checks; anything stuck restarting or
      `unhealthy` here means something upstream of this checklist failed. See
      `docs/OPERATIONS.md`'s Docker mapping section for what each service is
      and how to read its logs.
- [ ] A verified backup exists before this deployment's first production
      migration. `scripts/deploy-ec2.sh` takes a timestamped backup
      automatically before every update it applies; for a first `setup-ec2.sh`
      run that's restoring an existing production backup rather than starting
      from empty, take a backup with `scripts/backup-ec2.sh` first and copy it
      off-instance before touching anything.
- [ ] The smoke test below, run once, post-deploy, against the real `https://`
      domain.

---

## Post-deploy smoke test

Run this immediately after `setup-ec2.sh` or `deploy-ec2.sh` completes,
exercising one real path per module rather than trusting that "it built" means
"it works." Replace `DOMAIN` with the real deployed domain — Caddy is the only
public entry point, so every path below goes through it on port 443.

1. **Health** — `curl -I https://DOMAIN` returns `200`; `curl https://DOMAIN/up`
   returns `200` (Laravel, proxied by Caddy). The AI service itself is never
   public (`EC2-DEPLOYMENT.md`'s runtime layout) — confirm it's healthy via
   `docker compose -f compose.production.yml ps` instead.
2. **Auth** — log in as the real Admin account created in the checklist above
   (not a seeded demo account — there shouldn't be one). Confirm the dashboard
   loads over `https://DOMAIN`.
3. **Announcements** — create one announcement, publish it, confirm it appears
   on a non-admin account's announcement feed.
4. **Events** — create one event, submit it through the approval flow, have
   the Department Head account approve it, confirm it shows in the events
   calendar.
5. **Tasks** — create one task, assign it (accept the AI-recommended assignee
   or assign manually), confirm the assignee sees it and can update its
   status.
6. **Finance** — create one budget, submit and approve it, record one
   transaction against it, confirm the remaining balance updates correctly.
7. **Merchandise** — create one item, place one cash order as a student
   account, approve/fulfill it as an officer, confirm the claim token flow
   completes.
8. **Elections** — create one election with at least one position and
   candidate, approve it, cast one vote as a student, confirm the double-vote
   guard rejects a second attempt with a clear message (not a 500).
9. **Notifications** — confirm the approver from step 4 (or 6) actually
   received a notification. This exercises the `queue-worker` compose service
   end to end, not just "the container is running" — see
   `docs/OPERATIONS.md`'s Docker mapping section for how to confirm it's
   actually processing jobs.
10. **Password reset** — trigger "Forgot password" for one account, confirm
    the email actually arrives at a real inbox — the `MAIL_MAILER` check from
    the go-live checklist, verified end to end.
11. **API smoke** — `curl https://DOMAIN/api/organizations` returns `200` with
    JSON, confirming Caddy's `/api` proxy rule and Laravel are wired together
    end to end, not just individually healthy.

If any step fails, check `docs/OPERATIONS.md`'s failure-modes section before
assuming it's a new bug.
