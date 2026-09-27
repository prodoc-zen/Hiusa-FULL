# HIUSA on Lightsail: setup and maintenance

Last checked: 2026-09-27. This is the **native Ubuntu, Nginx, MySQL, no Docker, static IPv4** path discussed in this conversation. The repository's [EC2-DEPLOYMENT.md](EC2-DEPLOYMENT.md) is a different Docker/Caddy deployment and its commands must not be mixed with these. The live Lightsail instance is not accessible from this repository, so inspect its actual service names, Nginx config, certificate issuer, and paths before applying any command that changes them.

This file reconstructs the deployment and support conversation as an operational guide. Some earlier assistant messages are unavailable as a verbatim transcript; this is **not** a claim that every previous command was captured word for word. It includes every topic visible in the conversation: static IP, no domain, no Docker, MySQL, HTTPS, GitHub updates, `.env`, SAO accounts, email, builds, queues, AI, fingerprints, and troubleshooting.

For certificate renewal, read [CERTBOT_RENEWAL_LIGHTSAIL.md](CERTBOT_RENEWAL_LIGHTSAIL.md).

## 0. Map the installed system before changing it

Connect through the Lightsail instance's **Connect using SSH** button. In the shell:

```bash
pwd
ls -ld /var/www/hiusa /var/www/hiusa/server /var/www/hiusa/client
cd /var/www/hiusa
git status --short
git remote -v
sudo systemctl is-active nginx mysql php8.3-fpm hiusa-ai hiusa-fingerprint hiusa-queue hiusa-scheduler
sudo nginx -t
sudo nginx -T 2>/dev/null | grep -E 'server_name|root |ssl_certificate|acme-challenge|fastcgi_pass'
```

If a unit is named differently, use its real name in later commands. If the repository has uncommitted changes on the server, review them before `git pull`; a pull may fail or overwrite an intended server-only edit. Never copy `.env` into Git or post it in an issue.

## 1. First Lightsail setup, in order

Skip this section if the current instance is already working. These are the components and checks needed to reproduce the deployment on a fresh **Ubuntu 24.04** Lightsail instance. Package names and PHP socket paths below assume PHP 8.3; verify them on another Ubuntu release.

### Phase 1: instance, IP, and firewall

1. Create an Ubuntu Lightsail instance with enough RAM for MySQL, PHP, Python, Node builds, and .NET. Attach the static IPv4 address in Lightsail **Networking**. Record it as `YOUR_STATIC_IP`.
2. In the Lightsail IPv4 firewall, permit SSH TCP 22 from your administrator IP if practical, HTTP TCP 80, and HTTPS TCP 443. Do not expose MySQL 3306, FastAPI 8001, or the matcher 9100 publicly. AWS documents the [static IP](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html) and [firewall settings](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html).
3. Connect with the browser SSH terminal. Confirm `curl -4 https://ifconfig.me` reports the intended public IP, or compare against the address in the Lightsail console. This external check can be omitted if outbound HTTP is unavailable.

### Phase 2: install the native runtimes

Install Nginx, MySQL, PHP and the PHP extensions Laravel uses, Python venv support, Git, and Composer. The project uses Laravel 12, Vite 8, FastAPI, and a .NET 9 fingerprint matcher.

```bash
sudo apt update
sudo apt install -y nginx mysql-server git unzip python3 python3-venv composer \
  php8.3-cli php8.3-fpm php8.3-mysql php8.3-mbstring php8.3-xml \
  php8.3-curl php8.3-zip php8.3-bcmath php8.3-gd
sudo systemctl enable --now nginx mysql php8.3-fpm
php -v
composer --version
python3 --version
```

Install a supported **Node.js 24 LTS** release from the [official Node.js installation instructions](https://nodejs.org/en/download), then verify `node -v` and `npm -v`. Vite 8 requires Node 20.19+ or 22.12+, but Node 20 is already end of life as of this guide's date. Install the .NET 9 SDK using [Microsoft's Ubuntu instructions](https://learn.microsoft.com/en-us/dotnet/core/install/linux-ubuntu), then verify `dotnet --version`. Use the instructions for the actual Ubuntu release instead of guessing a package repository.

### Phase 3: clone the code

Use your own GitHub repository URL. If `/var/www/hiusa` already exists, inspect it rather than cloning over it.

```bash
sudo mkdir -p /var/www/hiusa
sudo chown "$USER":"$USER" /var/www/hiusa
git clone YOUR_GITHUB_REPOSITORY_URL /var/www/hiusa
cd /var/www/hiusa
git status --short
```

Keep the production `.env` files on the server. GitHub contains code, not the production database, uploaded files, keys, or certificates.
For a private GitHub repository, configure SSH access or a GitHub deploy key before cloning; avoid putting a personal access token in a command or remote URL that may be recorded in shell history.

### Phase 4: create MySQL database and user

```bash
sudo systemctl enable --now mysql
sudo mysql
```

At the `mysql>` prompt, replace the example password with a new long secret:

```sql
CREATE DATABASE hiusa_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'hiusa'@'localhost' IDENTIFIED BY 'REPLACE_WITH_LONG_RANDOM_PASSWORD';
GRANT ALL PRIVILEGES ON hiusa_db.* TO 'hiusa'@'localhost';
EXIT;
```

The password must match `DB_PASSWORD` in `server/.env`. MySQL remains bound locally. On an existing installation, **do not rerun `CREATE DATABASE`, import demo SQL, or run `migrate:fresh`**.

### Phase 5: configure Laravel and create the schema

```bash
cd /var/www/hiusa/server
cp .env.example .env
nano .env
```

Set at least the following values, using the actual IP and the MySQL password. Generate private keys with `openssl rand -hex 32` and put the **same** service key on both sides of each private connection.

```dotenv
APP_ENV=production
APP_DEBUG=false
APP_URL=https://YOUR_STATIC_IP
FRONTEND_URL=https://YOUR_STATIC_IP
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=hiusa_db
DB_USERNAME=hiusa
DB_PASSWORD=YOUR_MYSQL_PASSWORD
QUEUE_CONNECTION=database
HIUSA_AI_SERVICE_ENABLED=true
HIUSA_AI_SERVICE_URL=http://127.0.0.1:8001
HIUSA_AI_SERVICE_KEY=YOUR_PRIVATE_AI_KEY
FINGERPRINT_MATCHER_DRIVER=http
FINGERPRINT_MATCHER_URL=http://127.0.0.1:9100
FINGERPRINT_MATCHER_KEY=YOUR_PRIVATE_MATCHER_KEY
FINGERPRINT_MATCHER_TEMPLATE_FORMAT=fscanner-sourceafis-dotnet-3.14.0-png-v1
MAIL_MAILER=log
```

`MAIL_MAILER=log` is only a temporary first-run setting. It writes reset messages to logs and does not deliver email. Configure a real SMTP provider before people depend on account recovery. Set `GROQ_API_KEY` only if the optional narrative AI features are needed. Do not generate a new `APP_KEY` on an existing deployment because that can invalidate encrypted data and sessions. Ensure the account running PHP-FPM and the service units can read `server/.env` and write `server/storage` and `server/bootstrap/cache` without giving public web access to the `.env` file.

On a **new** installation only:

```bash
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
php artisan key:generate
php artisan migrate --force
php artisan storage:link
php artisan optimize
sudo chown "$USER":www-data .env
sudo chmod 640 .env
sudo chown -R "$USER":www-data storage bootstrap/cache
sudo find storage bootstrap/cache -type d -exec chmod 2775 {} +
sudo find storage bootstrap/cache -type f -exec chmod 664 {} +
```

Do not seed demo accounts on a live site. The repository's seeders contain fixed demonstration passwords. If Composer fails, save the **first actual error line**; common causes include a missing PHP extension, PHP version mismatch, memory pressure, or a dependency lock conflict. Repeating the command without its error text cannot identify the cause.

### Phase 6: configure the private services

FastAPI:

```bash
cd /var/www/hiusa/ai-service
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
nano .env
```

Set `HIUSA_AI_SERVICE_KEY` to the exact key in Laravel, `HIUSA_AI_HOST=127.0.0.1`, `HIUSA_AI_PORT=8001`, and `HIUSA_AI_RELOAD=false`. The entry point is `ai-service/run.py`. Protect the AI `.env` with `sudo chown "$USER":www-data .env` and `sudo chmod 640 .env` after saving it.

Fingerprint matcher:

```bash
cd /var/www/hiusa/fingerprint-matcher
dotnet restore
dotnet publish -c Release -o publish
cp .env.example .env
nano .env
```

Set `MATCHER_API_KEY` to Laravel's `FINGERPRINT_MATCHER_KEY` and `ASPNETCORE_URLS=http://127.0.0.1:9100`. Protect the matcher `.env` with `sudo chown "$USER":www-data .env` and `sudo chmod 640 .env` after saving it. The .NET process reads environment variables from its service manager, so the matcher systemd unit needs `EnvironmentFile=/var/www/hiusa/fingerprint-matcher/.env`. FastAPI's `run.py` loads its own `.env`.

On an existing Lightsail instance, inspect the already installed units before changing them:

```bash
sudo systemctl cat hiusa-ai hiusa-fingerprint hiusa-queue hiusa-scheduler
```

If the units do not exist on a fresh instance, create these four files under `/etc/systemd/system/` with `sudo nano`. They run as `www-data`, which can read the `.env` files and write Laravel's runtime directories after the permissions above. Verify the `php` and `dotnet` paths with `command -v php` and `command -v dotnet`.

`hiusa-ai.service`:

```ini
[Unit]
Description=HIUSA Python decision service
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/hiusa/ai-service
ExecStart=/var/www/hiusa/ai-service/.venv/bin/python /var/www/hiusa/ai-service/run.py
Restart=always

[Install]
WantedBy=multi-user.target
```

`hiusa-fingerprint.service`:

```ini
[Unit]
Description=HIUSA private fingerprint matcher
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/hiusa/fingerprint-matcher
EnvironmentFile=/var/www/hiusa/fingerprint-matcher/.env
ExecStart=/usr/bin/dotnet /var/www/hiusa/fingerprint-matcher/publish/SourceAfisMatcher.dll
Restart=always

[Install]
WantedBy=multi-user.target
```

`hiusa-queue.service`:

```ini
[Unit]
Description=HIUSA Laravel queue worker
After=mysql.service network.target

[Service]
User=www-data
WorkingDirectory=/var/www/hiusa/server
ExecStart=/usr/bin/php artisan queue:work database --sleep=3 --tries=3 --timeout=120
Restart=always

[Install]
WantedBy=multi-user.target
```

`hiusa-scheduler.service`:

```ini
[Unit]
Description=HIUSA Laravel scheduler
After=mysql.service network.target

[Service]
User=www-data
WorkingDirectory=/var/www/hiusa/server
ExecStart=/usr/bin/php artisan schedule:work
Restart=always

[Install]
WantedBy=multi-user.target
```

Then start and verify them:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hiusa-ai hiusa-fingerprint hiusa-queue hiusa-scheduler
sudo systemctl is-active hiusa-ai hiusa-fingerprint hiusa-queue hiusa-scheduler
curl -fsS http://127.0.0.1:8001/health
curl -fsS http://127.0.0.1:9100/health
```

Avoid running both this scheduler service and a separate cron scheduler unless you intend duplicate schedule checks.

### Phase 7: build React and serve it through Nginx

```bash
cd /var/www/hiusa/client
printf 'VITE_API_URL=/api\n' > .env.production
npm ci
npm run build
```

`VITE_API_URL` is baked into the build. The frontend must request `/api` from the same `https://YOUR_STATIC_IP` origin. Confirm the Nginx config serves `client/dist` for the SPA, routes `/api` and `/up` to Laravel's `server/public/index.php` through PHP-FPM, and serves Laravel's public uploads where required. Nginx must not expose `.env`, private storage, MySQL, FastAPI, or the matcher.

For a **fresh** server with no Nginx site yet, create `/etc/nginx/sites-available/hiusa` with `sudo nano`. First use this port-80 block to make the ACME webroot reachable:

```nginx
server {
    listen 80 default_server;
    server_name _;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
```

Enable the site only after checking what is already enabled. On a fresh Nginx install, the default site's symlink can conflict with this `default_server`. Leave `/etc/nginx/sites-available/default` intact, but remove its symlink from `sites-enabled` if present:

```bash
ls -l /etc/nginx/sites-enabled/
[ ! -L /etc/nginx/sites-enabled/default ] || sudo unlink /etc/nginx/sites-enabled/default
sudo ln -s /etc/nginx/sites-available/hiusa /etc/nginx/sites-enabled/hiusa
sudo install -d -m 755 /var/www/letsencrypt/.well-known/acme-challenge
sudo nginx -t
sudo systemctl reload nginx
```

Only do this on the **fresh** instance; inspect the live site's existing links instead of unlinking them. Then follow [CERTBOT_RENEWAL_LIGHTSAIL.md](CERTBOT_RENEWAL_LIGHTSAIL.md), step 7, to obtain the IP certificate. Only after Certbot prints the real certificate paths, add this second block to the same Nginx file, replacing `YOUR_STATIC_IP` with the actual certificate directory name shown by Certbot:

```nginx
server {
    listen 443 ssl default_server;
    server_name _;
    root /var/www/hiusa/client/dist;
    index index.html;

    ssl_certificate /etc/letsencrypt/live/YOUR_STATIC_IP/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/YOUR_STATIC_IP/privkey.pem;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ^~ /api/ {
        try_files $uri @laravel;
    }
    location = /up {
        try_files $uri @laravel;
    }
    location @laravel {
        rewrite ^ /index.php last;
    }
    location = /index.php {
        internal;
        root /var/www/hiusa/server/public;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME /var/www/hiusa/server/public/index.php;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    }

    location /storage/ {
        alias /var/www/hiusa/server/public/storage/;
    }
    location /uploads/ {
        alias /var/www/hiusa/server/public/uploads/;
    }
    location ~ /\. {
        deny all;
    }
}
```

The `/storage/` location requires `php artisan storage:link`; the `/uploads/` directory may be absent on an empty installation. Confirm the PHP-FPM socket path with `ls /run/php/` and correct it if needed. The Laravel `index.php` block is `internal` so direct PHP script requests are unavailable. Test before reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

An Nginx configuration already running on your Lightsail instance is the best starting point. Its exact server block is **not present in this repository**. Use `sudo nginx -T` to inspect and preserve it; the fresh-install example above is not an instruction to overwrite a working site.

### Phase 8: create the first SAO account

Do this only when the target account does not exist. `SUPER_ADMIN` is the SAO role; `ADMIN` is an organization administrator. Use a unique numeric `school_id`, an email belonging to the SAO user, and a strong password. The SAO organization should already exist after the migrations; check first:

```bash
cd /var/www/hiusa/server
php artisan tinker --execute='echo App\Models\Organization::where("slug", "student-affairs-office")->value("id") ?? "MISSING";'
```

The full duplicate-safe creation steps for another SAO account are in the section **Accounts** below. Do not run production seeders to create one.

### Phase 9: smoke test every runtime

```bash
sudo systemctl is-active nginx mysql php8.3-fpm hiusa-ai hiusa-fingerprint hiusa-queue hiusa-scheduler
curl -fsS https://YOUR_STATIC_IP/up
curl -fsS https://YOUR_STATIC_IP/api/organizations
curl -fsS http://127.0.0.1:8001/health
curl -fsS http://127.0.0.1:9100/health
```

From a workstation with a supported DigitalPersona reader, its driver, and HID Authentication Device Client, log in, enroll four captures of the same finger, identify with a fresh scan, confirm attendance, and check that a duplicate is rejected. The server-side matcher alone cannot capture a finger from a user's PC.

## 2. Daily operations and updates

### Pull a GitHub update

Push the code changes from your PC to GitHub first. On Lightsail:

```bash
cd /var/www/hiusa
git status --short
git branch --show-current
git pull --ff-only
```

If `git status --short` shows edits on Lightsail, inspect and preserve them first. The `--ff-only` flag stops instead of silently creating a merge. `git pull` updates tracked source files; it does **not** replace production `.env`, MySQL data, uploads, or the deployed React build.

Use the existing [UPDATE_MAINTENANCE.md](UPDATE_MAINTENANCE.md) as a short command checklist after reading it. For a release touching all services, run the stages below in order and stop at the first failure:

```bash
cd /var/www/hiusa/server
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
php artisan migrate:status
php artisan migrate --force
php artisan optimize:clear
php artisan optimize
```

```bash
cd /var/www/hiusa/client
npm ci
npm run build
```

```bash
cd /var/www/hiusa/ai-service
.venv/bin/python -m pip install -r requirements.txt
```

```bash
cd /var/www/hiusa/fingerprint-matcher
dotnet restore
dotnet publish -c Release -o publish
```

```bash
sudo systemctl restart php8.3-fpm hiusa-ai hiusa-fingerprint hiusa-queue hiusa-scheduler
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl is-active nginx mysql php8.3-fpm hiusa-ai hiusa-fingerprint hiusa-queue hiusa-scheduler
curl -fsS https://YOUR_STATIC_IP/up
```

For a backend-only fix, skip the React build, Python install, and .NET publish. For a frontend-only fix, rebuild React and refresh the page. Run `php artisan migrate --force` only for a release containing new migrations, with a backup first. A code rollback does not undo a migration automatically.

If an update fails, keep the pre-update database dump and uploaded files. Inspect `git log -5 --oneline` to identify the last working source revision, then deploy a forward fix or a reviewed Git revert from your development machine. Do not run `git reset --hard`, `migrate:fresh`, or an untested restore on the live database. A schema-changing release may need a compatible forward migration; reverting source alone cannot reliably restore its old schema.

### Change production `.env`

Edit `/var/www/hiusa/server/.env` on Lightsail. Laravel often caches configuration, so a change will **not necessarily take effect immediately**. After saving:

```bash
cd /var/www/hiusa/server
php artisan optimize:clear
php artisan optimize
sudo systemctl restart php8.3-fpm hiusa-queue hiusa-scheduler
```

For Python or fingerprint settings, edit their own `.env` files and restart only their respective units. For `VITE_*` values, edit `client/.env.production` and rerun `npm run build`; restarting PHP cannot change already built JavaScript. Never paste passwords or keys into diagnostic output.

### Watch health and logs

```bash
sudo systemctl is-active nginx mysql php8.3-fpm hiusa-ai hiusa-fingerprint hiusa-queue hiusa-scheduler
sudo journalctl -u hiusa-ai -u hiusa-fingerprint -u hiusa-queue -u hiusa-scheduler -n 100 --no-pager
sudo tail -n 100 /var/log/nginx/error.log
cd /var/www/hiusa/server
php artisan queue:failed
php artisan schedule:list
```

Laravel may log to `server/storage/logs/laravel.log`, stderr, or another configured channel. Check `LOG_CHANNEL` and `LOG_STACK` in the active config. Failed queue jobs and provider errors should be investigated before replaying anything that might send email or notifications twice.

### Back up the live data

Enable automatic Lightsail instance snapshots in the console. AWS keeps the latest seven automatic instance snapshots; also take a manual snapshot before high-risk upgrades. A snapshot is useful for whole-instance recovery, but keep an **off-instance** MySQL dump and uploaded-file backup as well. See [AWS's snapshot guide](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-snapshots.html).

For a manual MySQL dump, use your deployment's actual database name and account. This command prompts for the password and writes a file in your current directory; move it to secured backup storage after checking its size:

```bash
sudo install -d -m 700 -o "$USER" -g "$USER" /var/backups/hiusa
hiusa_backup_path="/var/backups/hiusa/hiusa_db_$(date +%F_%H%M%S).sql"
mysqldump --single-transaction --routines --triggers -u hiusa -p hiusa_db > "$hiusa_backup_path"
ls -lh "$hiusa_backup_path"
```

Also back up `server/storage/app`, `server/public/uploads` if present, and production `.env` files to restricted off-instance storage. Avoid leaving dumps in a web-served directory or in Git. Practice restore on a separate database or test instance before trusting a backup. Do not restore into the live database merely to test it.

## 3. Accounts

### Create another SAO / Super Admin on Lightsail

The SAO UI creates `ADMIN` accounts for student organizations. It does not create another `SUPER_ADMIN`. To create an SAO account, use Tinker with a unique school ID and email. This command validates before writing; it creates one account and does not alter existing accounts.

```bash
cd /var/www/hiusa/server
export NEW_SAO_SCHOOL_ID='990010'
export NEW_SAO_FIRST_NAME='Maria'
export NEW_SAO_LAST_NAME='Santos'
export NEW_SAO_EMAIL='maria.santos@example.edu'
export NEW_SAO_POSITION='SAO Officer'
read -rsp 'New SAO password: ' NEW_SAO_PASSWORD
echo
export NEW_SAO_PASSWORD
```

Replace the example identity with the real person's details. Keep the password out of command history. Then run:

```bash
php artisan tinker --execute='
$data = validator([
    "school_id" => getenv("NEW_SAO_SCHOOL_ID"),
    "first_name" => getenv("NEW_SAO_FIRST_NAME"),
    "last_name" => getenv("NEW_SAO_LAST_NAME"),
    "email" => getenv("NEW_SAO_EMAIL"),
    "position_title" => getenv("NEW_SAO_POSITION"),
    "password" => getenv("NEW_SAO_PASSWORD"),
], [
    "school_id" => ["required", "integer", "min:1", "max:99999999", "unique:users,school_id"],
    "first_name" => ["required", "string", "max:60"],
    "last_name" => ["required", "string", "max:60"],
    "email" => ["required", "email", "max:100", "unique:users,email"],
    "position_title" => ["required", "string", "max:100"],
    "password" => ["required", "string", "min:8"],
])->validate();
$org = App\Models\Organization::where("slug", "student-affairs-office")
    ->where("is_active", true)->firstOrFail();
$user = App\Models\User::create([
    "organization_id" => $org->id,
    "school_id" => (int) $data["school_id"],
    "first_name" => $data["first_name"],
    "last_name" => $data["last_name"],
    "email" => $data["email"],
    "password_hash" => $data["password"],
    "role" => "SUPER_ADMIN",
    "position_title" => $data["position_title"],
    "account_status" => "active",
    "is_member" => true,
]);
echo "Created SAO account {$user->school_id}\n";
'
unset NEW_SAO_SCHOOL_ID NEW_SAO_FIRST_NAME NEW_SAO_LAST_NAME NEW_SAO_EMAIL NEW_SAO_POSITION NEW_SAO_PASSWORD
```

The `User` model hashes `password_hash` through its cast. Log in by selecting **Student Affairs Office**, then enter that school ID and password. To create an SBO administrator instead, log in as SAO and use **SAO Administration > Administrators**; set the initial password in that form.

### Forgot password only reaches some emails

The recovery flow changed during this conversation. The earlier deployed version required the **selected organization and email**. The current local source asks for **school ID and email**; the backend still accepts organization and email for compatibility. Both versions send mail only for an active account in an active organization and deliberately return a generic response when there is no match. The frontend can therefore show a confirmation even when no message was sent. Check which code version is deployed, then verify the requested ID or organization, email, and account status.

For delivery problems, check the active mailer and queue configuration without printing secrets:

```bash
cd /var/www/hiusa/server
php artisan tinker --execute='echo "Mailer: ".config("mail.default")."\nQueue: ".config("queue.default")."\nFrontend: ".config("app.frontend_url")."\n";'
php artisan tinker --execute='echo "Pending: ".DB::table("jobs")->count()." Failed: ".DB::table("failed_jobs")->count()."\n";'
sudo systemctl status hiusa-queue --no-pager
php artisan queue:failed
```

`MAIL_MAILER=log` never delivers an email. A database queue with a stopped worker holds jobs. A real SMTP provider can also reject recipients, restrict sending to verified recipients, or accept then filter the message. Once the cause is fixed, request a **fresh** reset email; old queued messages may contain an expired or replaced token. The reset link points to `FRONTEND_URL` or `APP_URL` through Laravel's cached `app.frontend_url` setting.

To enable delivery, get an SMTP host, port, username, password, and permitted sender address from your mail provider. Edit `/var/www/hiusa/server/.env`:

```dotenv
MAIL_MAILER=smtp
MAIL_HOST=YOUR_SMTP_HOST
MAIL_PORT=587
MAIL_USERNAME=YOUR_SMTP_USERNAME
MAIL_PASSWORD=YOUR_SMTP_PASSWORD
MAIL_FROM_ADDRESS=YOUR_VERIFIED_SENDER_ADDRESS
MAIL_FROM_NAME=HIUSA
```

The exact port and TLS setting depend on the provider; do not use `MAIL_SCHEME=null` if the provider requires an explicit scheme. Save the file, run the `.env` cache and service restart steps above, request a reset for a known active account, and confirm the link arrives and opens `https://YOUR_STATIC_IP/reset-password`. Check the provider's delivery logs if Laravel accepted the send but the inbox did not receive it. Never test by emailing strangers or pasting SMTP credentials into commands or logs.

## 4. Known problems from this conversation

### Vite cannot remove `dist/.well-known/acme-challenge`

The ACME challenge directory was put inside Vite's build output and became inaccessible to the build user. Keep Certbot's webroot outside `client/dist`, for example `/var/www/letsencrypt`; configure Nginx to serve that path on port 80. See the certificate guide. Do not recursively delete `dist` or the challenge files while renewal is running. After moving the challenge location and fixing ownership of the existing `dist` tree, run `npm run build` again. Verify the exact owner and Nginx path before changing permissions.

### `composer install` fails

Read the first error, then check `php -v`, `php -m`, `composer diagnose`, available disk space, and the current `composer.lock`. A missing PHP extension, incompatible PHP version, permissions, or memory exhaustion requires a different fix. `composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction` is the production command; do not replace it with `composer update` just to make an error disappear.

### Manage Users cannot load users

A prior bug was a MySQL `ONLY_FULL_GROUP_BY` error in `/api/users`: its role-count query selected `users.*` and fingerprint data while grouping by `role`. The local source was fixed and tested against MySQL in the earlier conversation. If the live deployment still shows the error, confirm the server has pulled that commit and look for the SQL 1055 message in Laravel logs. A backend-only deployment of that fix needs no React rebuild or migration.

### Docker key paste produced curl errors

The malformed Docker PGP-key command is irrelevant to this native deployment. Do not install Docker merely to repair it. This Lightsail path uses Nginx, PHP-FPM, MySQL, Python, and .NET services directly.

### HTTPS and access

HTTPS encrypts traffic and authenticates the endpoint if the certificate is trusted; it does not decide who may use the app. Anyone who can reach the public IP and ports 80/443 can load the public pages. Laravel authentication and role checks protect private actions. A Lightsail firewall can limit incoming traffic, but if you restrict 80, HTTP-01 certificate renewal can fail. An IP certificate must contain the **IP address**, not merely a domain name. Verify HTTPS and automatic renewal using the companion certificate guide.

### Fingerprint scan fails while the website loads

Check `hiusa-fingerprint`, local health on `127.0.0.1:9100`, `MATCHER_API_KEY` versus Laravel's `FINGERPRINT_MATCHER_KEY`, and the matching template format. On each scanning workstation, check the supported DigitalPersona device, driver, and HID Authentication Device Client. Browser access over a trusted HTTPS origin is needed for web hardware APIs. Enrollment requires multiple captures; attendance uses a fresh capture and operator confirmation. Never publish matcher port 9100.

## 5. What to check after each change

1. `sudo nginx -t` passes and `curl -fsS https://YOUR_STATIC_IP/up` succeeds.
2. `sudo systemctl is-active ...` shows all required units active.
3. Log in as SAO and as an organization Admin; open Manage Users.
4. If a release changed mail, request a reset for one **active** account in the correctly selected organization and verify delivery.
5. If a release changed AI, test one decision-support action and inspect `hiusa-ai` logs.
6. If a release changed fingerprint code, scan on a real workstation and confirm attendance.
7. If a release changed schema, verify `php artisan migrate:status` and a fresh off-instance backup.

## References

- [HIUSA operations guide](docs/OPERATIONS.md), [current EC2 Docker procedure](EC2-DEPLOYMENT.md), [existing native update checklist](UPDATE_MAINTENANCE.md)
- [AWS Lightsail static IP](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html), [firewall](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html), [snapshots](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-snapshots.html)
- [Vite 8 Node requirements](https://v8.vite.dev/blog/announcing-vite8), [Node.js release status](https://nodejs.org/en/about/previous-releases)
- [Let's Encrypt IP certificates](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)
