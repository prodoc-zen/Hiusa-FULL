# HIUSA — Local Setup Guide

This guide is for team members cloning the project to run it locally for the demo. Follow every step in order. Do not skip steps.

> **Deploying this somewhere real, or operating an already-running instance?** This
> guide is for local development only. See [`EC2-DEPLOYMENT.md`](EC2-DEPLOYMENT.md)
> for the actual deployment procedure (the Docker Compose stack on EC2, and the
> setup/deploy/backup scripts), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the
> go-live checklist and post-deploy smoke test that wrap it, and
> [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for running and troubleshooting a
> live instance day to day (health checks, logs, the queue worker, common failures).

---

## What You Need Before Starting

Install these if you don't have them. Check by running the version commands in a terminal.

| Tool | Minimum Version | Check | Download |
|---|---|---|---|
| Git | Any recent | `git --version` | https://git-scm.com |
| PHP | 8.2 or higher | `php --version` | https://www.php.net/downloads |
| Composer | 2.x | `composer --version` | https://getcomposer.org |
| Node.js | 18 or higher | `node --version` | https://nodejs.org (LTS) |
| npm | 9 or higher | `npm --version` | Comes with Node |
| MySQL | 5.7 / 8.0 | `mysql --version` | Via XAMPP or MySQL Installer |
| Python | 3.11 or higher | `python --version` | https://www.python.org/downloads/ |

> **PHP on Windows:** The easiest way is to install [XAMPP](https://www.apachefriends.org). It gives you PHP, MySQL, and phpMyAdmin in one installer. After installing, add `C:\xampp\php` to your system PATH.

> **Composer on Windows:** Download and run the [Composer-Setup.exe](https://getcomposer.org/Composer-Setup.exe) installer. It will find your PHP automatically.

---

## Step 1 — Clone the Repository

Open a terminal (PowerShell or Git Bash) and run:

```bash
git clone https://github.com/prodoc-zen/Hiusa-FULL.git
cd Hiusa-FULL
```

---

## Step 2 — Set Up the Backend (Laravel)

### Fast environment setup on Windows

From the project root, this creates all three local environment files, generates one matching Laravel/Python service key, and generates the Laravel application key:

```powershell
.\scripts\setup-env.ps1
```

For access from other PCs on the same trusted network, pass the host PC's current IPv4 address once:

```powershell
.\scripts\setup-env.ps1 -HostAddress 192.168.1.50 -PromptForGroqKey
```

The script preserves existing `.env` files by default. Use `-Force` only on a new installation or when you intentionally want to replace all local environment files. `-PromptForGroqKey` accepts the Groq key through hidden input so it does not appear in terminal history. After it finishes, configure the chosen database.

All commands in this section run from the `server/` folder.

```bash
cd server
```

### 2A — Install PHP dependencies

```bash
composer install
```

This reads `composer.json` and downloads all Laravel packages into `vendor/`. It will take a minute.

### 2B — Create your environment file

```bash
copy .env.example .env
```

On Mac/Linux:
```bash
cp .env.example .env
```

### 2C — Generate the application key

```bash
php artisan key:generate
```

This writes a random key into `APP_KEY` in your `.env`. Laravel uses this to sign tokens and encrypt data. The app will not start without it.

### 2D — Configure the database

Open `server/.env` in any text editor and set the database block. **Choose one of the two options below.**

---

#### Option A — MySQL (recommended if you have XAMPP)

1. Open phpMyAdmin at `http://localhost/phpmyadmin`
2. Click **New** in the left sidebar
3. Create a database named `hiusa_db` — collation: `utf8mb4_unicode_ci`
4. Set these values in `server/.env`:

```env
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=hiusa_db
DB_USERNAME=root
DB_PASSWORD=
```

> XAMPP's default MySQL port is `3306` and has no password. If yours is different, adjust accordingly.

---

#### Option B — SQLite (no MySQL needed, simplest option)

SQLite is built into PHP — no server to install.

1. Create the database file:

```bash
# In the server/ folder
php -r "touch('database/database.sqlite');"
```

2. Set these values in `server/.env`:

```env
DB_CONNECTION=sqlite
DB_DATABASE=/absolute/path/to/server/database/database.sqlite
```

Replace `/absolute/path/to/server/` with the actual full path. Example on Windows:
```env
DB_DATABASE=C:\Users\YourName\Documents\Hiusa-FULL\server\database\database.sqlite
```

Example on Mac:
```env
DB_DATABASE=/Users/yourname/Documents/Hiusa-FULL/server/database/database.sqlite
```

---

### 2E — Also set this in `.env` (both options)

```env
FRONTEND_URL=http://localhost:5173
```

This allows the React dev server to make API calls without CORS errors.

### 2F — Run database migrations

```bash
php artisan migrate
```

This creates all the tables. You should see each migration listed as it runs.

### 2G — Seed the database with demo data

```bash
php artisan db:seed
```

This creates the admin account, demo officers, advisers, students, sample events, tasks, merchandise, and an active election.

> **To reset and re-seed at any time:**
> ```bash
> php artisan migrate:fresh --seed
> ```

---

## Step 3 — Set Up the Frontend (React)

Open a **new terminal window** and go to the `client/` folder.

```bash
cd client
```

### 3A — Install JavaScript dependencies

```bash
npm install
```

This reads `package.json` and downloads all React packages into `node_modules/`. It will take a minute.

### 3B — Create the environment file

Copy the portable frontend template:

```powershell
Copy-Item .env.example .env
```

The resulting `client/.env` contains:

```env
VITE_API_URL=http://localhost:8000/api
```

The localhost value also works when another PC opens HIUSA through the host PC's LAN address because the frontend automatically substitutes the browser's current hostname.

---

## Step 4 — Set Up the Python AI Service

Open a new terminal from the project root:

```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Set the same HIUSA_AI_SERVICE_KEY in ai-service/.env and server/.env.
python run.py
```

Keep this terminal open. The health check is `http://127.0.0.1:8001/health` and interactive API documentation is at `http://127.0.0.1:8001/docs`.

Make sure the matching values exist in `server/.env`:

```env
HIUSA_AI_SERVICE_ENABLED=true
HIUSA_AI_SERVICE_URL=http://127.0.0.1:8001
HIUSA_AI_SERVICE_KEY=the-same-long-random-key-used-by-python
```

Groq belongs only in `server/.env`:

```env
GROQ_API_KEY=your-groq-key
GROQ_API_URL=https://api.groq.com/openai/v1/responses
GROQ_MODEL=openai/gpt-oss-20b
```

## Step 5 — Run the Laravel and Frontend Servers

You need **three terminal windows open at the same time** — Python AI, Laravel, and the frontend.

### Terminal 2 — Backend (Laravel)

```bash
cd server
php artisan serve
```

You should see:
```
INFO  Server running on [http://127.0.0.1:8000].
```

Keep this window open. Do not close it.

### Terminal 3 — Frontend (React + Vite)

```bash
cd client
npm run dev
```

You should see:
```
  VITE v8.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
```

Keep this window open. Do not close it.

### Open the app

Go to **http://localhost:5173** in your browser.

---

## Demo Accounts

> ⚠️ **Development only. Never seed these into a real installation.** These
> credentials are created by `php artisan db:seed` and are published here, in
> version control, in plain text. That is fine for a local demo database only you
> and your team can reach. It is a real security hole on any installation other
> people can actually use — see the seeder-trap section of
> [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) before running seeders anywhere but a
> disposable local database. On the real EC2 deployment path
> ([`EC2-DEPLOYMENT.md`](EC2-DEPLOYMENT.md)), this is enforced by
> `scripts/setup-ec2.sh`'s opt-in `--seed-demo` flag rather than left to memory.

All passwords are shown below. The **Login** field differs by role.

### Admin
| Field | Value |
|---|---|
| Login field | Email |
| Email | `admin@hiusa.local` |
| Password | `Admin@123456` |

### Officers
| Name | Email | Password |
|---|---|---|
| Marco Dela Cruz | `officer1@hiusa.local` | `Demo@12345` |
| Angela Santos | `officer2@hiusa.local` | `Demo@12345` |

### Advisers
| Name | Email | Password |
|---|---|---|
| Ricardo Lim | `adviser1@hiusa.local` | `Demo@12345` |
| Maria Reyes | `adviser2@hiusa.local` | `Demo@12345` |

### Students — login with **School ID**, not email
| Name | School ID | Password |
|---|---|---|
| Juan Dela Vega | `2021-00142` | `Demo@12345` |
| Sofia Bautista | `2021-00217` | `Demo@12345` |
| Carlo Mendoza | `2021-00389` | `Demo@12345` |
| Pia Torres | `2022-00055` | `Demo@12345` |
| Luis Ramos | `2022-00134` | `Demo@12345` |
| Gabrielle Villanueva | `2022-00298` | `Demo@12345` |
| Rafael Aquino | `2022-00451` | `Demo@12345` |
| Camille Garcia | `2023-00078` | `Demo@12345` |
| Andrei Navarro | `2023-00163` | `Demo@12345` |
| Beatrice Castillo | `2023-00247` | `Demo@12345` |
| Miguel Pascual | `2023-00312` | `Demo@12345` |
| Trisha Herrera | `2024-00019` | `Demo@12345` |
| Jerome Evangelista | `2024-00067` | `Demo@12345` |
| Alyssa Domingo | `2024-00093` | `Demo@12345` |

---

## Troubleshooting

### "php: command not found" / "php is not recognized"
PHP is not on your PATH. If you installed XAMPP, add `C:\xampp\php` to your Windows PATH:
- Search → "Edit the system environment variables" → Environment Variables → Path → New → `C:\xampp\php`
- Restart your terminal.

### "composer: command not found"
Composer is not on your PATH. Re-run the Composer-Setup.exe installer and let it add itself to PATH, then restart your terminal.

### "npm: command not found"
Node.js is not installed or not on PATH. Download from https://nodejs.org, install, and restart your terminal.

### CORS error in browser console
Make sure `FRONTEND_URL=http://localhost:5173` is in `server/.env`. Restart the Laravel server after changing `.env`.

### "Class not found" or 500 errors from Laravel
Run:
```bash
cd server
composer install
php artisan config:clear
php artisan cache:clear
```

### "Cannot connect to database" (MySQL)
- Make sure MySQL is running (start XAMPP → click Start next to MySQL)
- Make sure the `hiusa_db` database exists in phpMyAdmin
- Make sure `DB_PORT` matches your MySQL port (XAMPP default is 3306)

### "SQLSTATE[HY000]: unable to open database file" (SQLite)
The path in `DB_DATABASE` is wrong. Make sure it is an absolute path and the file exists:
```bash
ls server/database/database.sqlite
```
If missing, run: `php -r "touch('database/database.sqlite');"`

### Vite shows blank page / "Failed to fetch"
The Laravel server is not running. Open Terminal 1 and run `php artisan serve` from the `server/` folder.

### Migration error: "Table already exists"
Run a fresh migration:
```bash
cd server
php artisan migrate:fresh --seed
```

> ⚠️ This **deletes all data** and re-seeds from scratch. Only run this if you want to reset.

### Port 8000 already in use
Another process is using port 8000. Either stop it, or run Laravel on a different port:
```bash
php artisan serve --port=8002
```
Then update `client/.env` to `VITE_API_URL=http://localhost:8002/api` and restart the Vite dev server. Port 8001 is reserved for the Python AI service.

### Port 5173 already in use
Vite will automatically try 5174, 5175, etc. Check the terminal output for the actual URL and use that in the browser.

---

## Project Structure

```
Hiusa-FULL/
├── client/          React 19 + Vite frontend
│   ├── src/
│   │   ├── pages/   All page components by role/module
│   │   ├── services/ API service functions
│   │   └── components/ Reusable UI components
│   └── .env         Frontend environment (VITE_API_URL)
└── server/          Laravel 12 backend
    ├── app/         Controllers, Models
    ├── database/    Migrations, Seeders
    ├── routes/api.php  All API routes
    └── .env         Backend environment (DB, keys)
```

---

## Quick Reference — Daily Workflow

Every time you sit down to work or demo:

```bash
# Terminal 1
cd server
php artisan serve

# Terminal 2
cd client
npm run dev

# Open browser
http://localhost:5173
```

If you pulled new changes from git:
```bash
cd server && composer install && php artisan migrate
cd client && npm install
```
