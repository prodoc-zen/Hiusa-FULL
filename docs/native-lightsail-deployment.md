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

For this release, deterministic AI verification ran locally against an isolated SQLite database and a disposable FastAPI service. It covered forecasting, financial risk and allocation advice, task delegation, grievance classification, authentication, and PHP fallbacks. Production verification uses service health, runtime configuration equality, and endpoint availability; it does not delete real profiles or create financial records. The paid narrative provider was not called during verification.
