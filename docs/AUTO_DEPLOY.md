# Automatic deploy

A push to `main` goes live without anyone logging in to the server. Branches other than `main` never deploy.

## What happens

1. The Tests workflow runs on the push (Laravel, client, AI service, MySQL migrations, end-to-end).
2. Only if every job is green, the Deploy workflow (`.github/workflows/deploy.yml`) starts for that exact commit.
3. It opens an ssh session to the Lightsail host with a dedicated deploy key and runs `scripts/deploy-lightsail.sh <commit>` there:
   1. Stops if the server checkout has local edits, or if the effective config is not `mail.default=log` and `services.edp.driver=local`. Code from before the EDP setting existed has no `services.edp` key and counts as local; the check runs again after the merge, against the new code.
   2. Backs up the database and uploads to `/var/backups/hiusa` (`hiusa_db-pre-deploy-<time>.sql.gz`, checked with `gzip -t`; the newest 14 are kept).
   3. Fast-forwards the checkout to the commit (never a merge commit).
   4. `composer install --no-dev`; `npm ci && npm run build` when `client/` changed; Python requirements when they changed.
   5. Stops `hiusa-queue` and `hiusa-scheduler`, runs `migrate --force`, caches config and routes through `hiusa-artisan`, checks the mail and EDP settings again, restarts what changed, starts the two units again.
   6. Waits for `/up`, checks every unit is active, and appends a line to `/var/backups/hiusa/deploy-history.log`.
4. If a repository variable `DEPLOY_SITE_URL` is set, the workflow also checks `/up` from outside.

If it fails before the migrate step, the code goes back to the previous commit by itself. If it fails after, the new code stays (the migrations cannot be undone) and the log prints the backup to restore from. Fix forward with a new commit; that deploys again.

## Nothing goes out

The workflow uses no notification, chat, email or webhook step. Its only outside traffic is ssh to your server and a `GET /up` on your site. On the server, `MAIL_MAILER=log` and `EDP_DRIVER=local` stay as they are; the script reads them through Laravel (`config:show`) and refuses to deploy if either is different, so a changed `.env` stops the deploy instead of sending anything.

## One-time setup (needs your hand)

Do not reuse `hiusa-lightsail.pem`. Make a key that can only be used for deploys and can be revoked alone.

1. On your PC: `ssh-keygen -t ed25519 -f hiusa-deploy -C github-deploy -N ""`
2. On the server, add `hiusa-deploy.pub` to `/home/ubuntu/.ssh/authorized_keys` (the `ubuntu` user already has passwordless sudo, which the script uses). Then delete the local `hiusa-deploy.pub`.
3. Get the host key and check its fingerprint against the one in the Lightsail console before trusting it: `ssh-keyscan -t ed25519 13.228.227.182`
4. In GitHub, Settings, Environments, create `production`. Optional: add yourself as a required reviewer if you want a click before each deploy.
5. In that environment add the secrets `DEPLOY_HOST` (`13.228.227.182`), `DEPLOY_USER` (`ubuntu`), `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` (the line from step 3). Optional variable: `DEPLOY_SITE_URL` (for example `https://13.228.227.182`).
6. Set the key from the file, never by pasting it: `gh secret set DEPLOY_SSH_KEY --env production -R prodoc-zen/Hiusa-FULL < hiusa-deploy`. A pasted key often picks up carriage returns or loses its last line, and ssh then rejects it. The workflow strips carriage returns and runs `ssh-keygen -y -f` on the key before using it, so a bad secret fails with an error naming `DEPLOY_SSH_KEY`.
7. Delete the local private key file after setting the secret. Never commit it.

Before the first automatic deploy, the live server must already report `mail.default=log`. A read-only check on 2026-11-08 found it on `smtp`, so the guard would refuse. On the server, set `MAIL_MAILER=log` in `/var/www/hiusa/server/.env`, run `sudo -u www-data hiusa-artisan config:cache`, and confirm `sudo -u www-data hiusa-artisan config:show mail.default` prints `log`.

Until the four secrets exist, the Deploy workflow runs, prints a warning that it was skipped, and changes nothing.

To run a deploy by hand: GitHub, Actions, Deploy, Run workflow (it deploys the commit it runs from, which must be on `main`). A manual run also needs a successful Tests run on that exact commit; without one it stops before touching the server.

## When a deploy stops

| Message | Meaning | What to do |
|---|---|---|
| `mail.default is '...'` or `services.edp.driver is '...'` | The server config changed | Put `MAIL_MAILER=log` / `EDP_DRIVER=local` back in `/etc/hiusa/laravel-native.env` or `server/.env`, then run the workflow again |
| `The server checkout has local edits` | Someone edited tracked files on the server | `git status --short` on the server, keep what matters, then run again |
| `Another deploy is already running` | A second run started | Wait; the lock clears when the first one ends |
| `Migrations already ran` | The failure came after the database changed | Fix forward with a new commit, or restore the printed backup |
| `/up health endpoint did not answer` | The site is down after restart | `sudo journalctl -u php8.3-fpm -u nginx -n 50` on the server; fix forward or restore |

To stop automatic deploys: disable the Deploy workflow in GitHub Actions, or delete `DEPLOY_SSH_KEY`.
