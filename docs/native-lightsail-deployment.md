# Native Lightsail deployment

The instance at `13.228.227.182` runs Nginx, PHP 8.3 FPM, and a systemd-managed FastAPI process from `/var/www/hiusa`. Its AI service listens on `127.0.0.1:8001`. The Docker hostname `ai-service` does not resolve in this deployment.

Native Laravel runtime overrides live in `/etc/hiusa/laravel-native.env`, owned by root and readable by the `www-data` group. They set the local AI URL and reuse the running AI service's key. Neither repository `.env` file is replaced. Systemd drop-ins load these overrides for FPM, the queue, and the scheduler; FPM pool overrides expose the AI settings to PHP workers.

Use the installed wrapper when rebuilding Laravel caches so the native overrides are retained:

```bash
cd /var/www/hiusa
git pull --ff-only origin main
cd client
npm ci
npm run build
sudo -u www-data /usr/local/bin/hiusa-artisan config:cache
sudo -u www-data /usr/local/bin/hiusa-artisan route:cache
sudo systemctl reload php8.3-fpm
sudo systemctl restart hiusa-queue hiusa-scheduler
sudo nginx -t
```

Upload limits must match what the forms promise: each PDF may be up to 10 MB and the organization registration form takes ten of them in one request. The server therefore sets `client_max_body_size 110M;` and `client_body_timeout 300s;` inside the `/api` location of `/etc/nginx/sites-available/hiusa` (the static part of the site stays at 8M), and `upload_max_filesize=12M`, `post_max_size=110M`, `max_input_time=300`, `max_file_uploads=30` in `/etc/php/8.3/fpm/conf.d/20-hiusa.ini`. With the old values (8M and 6M) the registration form failed with a generic error because nginx answered 413 before the app ran. Check with a 15 MB multipart POST and no name to `/api/college/organizations`: 422 means the limits are right, 413 means nginx rejected it. Reload nginx and PHP-FPM after any change.

Restart `hiusa-ai` when Python application files change. Handle dependency or schema changes separately; back up the database before applying migrations. Preserve production environment files and generated uploads.

## Browser caching after deployment

The HTTPS server block in `/etc/nginx/sites-available/hiusa` must revalidate the SPA entry document. Keep the existing one-year expiry for fingerprinted `/assets/` files, and add this exact-match location alongside the SPA fallback:

```nginx
location = /index.html {
    expires -1;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

`expires -1` emits `Cache-Control: no-cache` for the entry document, including internal fallbacks from dashboard routes. It preserves the server block's inherited security headers. Back up the configuration, run `sudo nginx -t`, and reload Nginx. Verify `/`, `/index.html`, and a dashboard URL return 200 with `Cache-Control: no-cache`, while hashed assets retain their year-long expiry. Compare served asset hashes with `client/dist` after the client build.

For this release, deterministic AI verification ran locally against an isolated SQLite database and a disposable FastAPI service. It covered forecasting, financial risk and allocation advice, task delegation, grievance classification, authentication, and PHP fallbacks. Production verification uses service health, runtime configuration equality, and endpoint availability; it does not delete real profiles or create financial records. The paid narrative provider was not called during verification.

## Resetting the demo site

`scripts/reseed-staging.ps1` puts the staging server back to a clean demo state in one command. Run it from a Windows PowerShell on a machine that holds the SSH key (`HIUSA_SSH_KEY`, default `%USERPROFILE%\.ssh\hiusa-lightsail.pem`):

```powershell
.\scripts\reseed-staging.ps1                 # dry run: prints the plan, connects to nothing
.\scripts\reseed-staging.ps1 -Execute        # real run: type RESET at the prompt
.\scripts\reseed-staging.ps1 -DemoPrepOnly -Execute   # only step 10 (demo data), no wipe
```

`-Execute -Force` skips the prompt. The script refuses any host other than `13.228.227.182` unless `-AllowOtherHost` is given. `-BaseUrl` is checked too: it must be https and on the same host as `-HostName`, or the run is refused; `-AllowOtherHost` waives only the https rule, with a warning. The verification and demo prep requests go to `https://<host>` with normal certificate validation (TLS 1.2, 1.3 when available): the site answers 301 on plain http and Windows PowerShell 5.1 turns a redirected POST into a GET, so an http base address would make every login fail with 405.

What it wipes: the whole `hiusa_db` database (`migrate:fresh --seed` under `APP_ENV=staging`), so every account, organization, document and booking entered since the last reseed is gone. The uploaded files under `storage/app` and `public/uploads` are archived but not deleted. It then adds four colleges (Criminal Justice Education, Hospitality, Tourism and Customs Administration, Maritime Education, Nursing), the Department Head accounts 940006 to 940009 (password `Demo@12345`) and a random 24 character password for SAO 990001. That password is generated on the server and handed to PHP on stdin, so it never appears in a command line, the auth log, `ps` or a file; it is printed once at the very end of the run, so copy it then.

Before it wipes anything it writes `hiusa_db-pre-demo-reseed-<UTC stamp>.sql.gz` and `hiusa_files-pre-demo-reseed-<UTC stamp>.tar.gz` to `/var/backups/hiusa` and checks that the dump holds as many `CREATE TABLE` lines as the live database has tables. The run stops on the first failing step. It finishes with HTTP checks (page, `/up`, nine logins, old SAO password refused) and server counts (39 users, 9 Department Heads, 1 SUPER_ADMIN, 9 colleges), and exits non-zero if any check is red. The login checks share a per-IP throttle of ten a minute, so the last ones may wait up to a minute. A whole run takes roughly five minutes.

Step 10 then makes the site demo-ready over the public API with the demo accounts only (never the SAO): Admin 900001 proposes "Demo Student Council Election" (open now, closing in three days), Department Head 940001 approves it, and the Admin adds a party list and a candidate and finalizes it so students can vote; it then creates the task "Prepare the registration desk" for Officer 900004 and, best effort, an "Org membership fee" invoice of 150.00 for Student 2100142. It reuses anything already in place, fails the run if the election or task cannot be created, and is left out with `-SkipDemoPrep`. A finalized "Demo Student Council Election" in any status except closed counts as already in place (an upcoming one just opens at its start time). `-DemoPrepOnly` runs only this step against the live site: no ssh, no backup, no wipe and no RESET prompt, because it writes only demo data; it is a dry run unless `-Execute` is given and it refuses any host other than `13.228.227.182`.

However a live run ends (success, a failed step, Ctrl+C) it prints how it ended: whether the wipe step had started, the backup file names (only if the backup was verified), the restore commands, retry advice for the step that ended the run, the recovery command below, and the state of the SAO account 990001. Ctrl+C also stops the local ssh process. The SAO line is one of: the new password; the password marked UNVERIFIED (it was read from the server but step 7 did not finish its check, so test it); "probably changed and unknown" (step 7 started but reported nothing: run the script again with `-Execute`); or "still on the public default Admin@123456" (the wipe completed but step 7 never ran: run the script again with `-Execute`, or set a password with the tinker procedure in CLAUDE.md, "Tinker on the server"). Never leave the site on the default.

Retry by step: a failure in steps 1 to 3 wiped nothing, so fix the cause and run again; a failure in steps 5 to 9 means run the script again with `-Execute`; if only step 10 failed the site is reset, so retry with `.\scripts\reseed-staging.ps1 -DemoPrepOnly -Execute` (no wipe).

If the wipe step (4) was interrupted or failed, assume nothing about the data. Keep that run's backup files: they are the last good copy, because the backup a rerun takes holds the half-built database. Run the script again with `-Execute`; step 2 accepts a `hiusa_db` that exists but has no tables (it prints a WARN and skips the table count check, since there is nothing to lose). If the rerun still stops at step 2 (for example the database no longer exists), restore the first run's backup with the commands below, then run the script again.

Restore (printed at the end of every run, never run by the script):

```bash
sudo zcat /var/backups/hiusa/hiusa_db-pre-demo-reseed-<stamp>.sql.gz | sudo mysql hiusa_db
sudo tar -xzpf /var/backups/hiusa/hiusa_files-pre-demo-reseed-<stamp>.tar.gz -C /var/www/hiusa/server
sudo mysql hiusa_db -e "SELECT COUNT(*) FROM users"
```

The dump is owned by root with mode 600, so `zcat` needs `sudo` as well: without it `zcat` fails, `mysql` reads empty input and exits 0 having restored nothing. The last command must print a non-zero count.

If a run stops after step 3, the queue and scheduler may still be stopped and the config cache may be missing: `sudo -u www-data /usr/local/bin/hiusa-artisan config:cache && sudo systemctl start hiusa-queue hiusa-scheduler` after fixing the cause, or run the script again.
