#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
    cat <<'EOF'
Usage: bash scripts/setup-ec2.sh <site-address> [--seed-demo] [--insecure-demo-only]

Examples:
  bash scripts/setup-ec2.sh hiusa.example.com
  bash scripts/setup-ec2.sh http://54.206.119.20 --insecure-demo-only --seed-demo

Pass a bare domain to enable Caddy-managed HTTPS. Plain HTTP is rejected unless
the explicit demo-only override is present. Demo seeding is deliberately opt-in
because it creates known demonstration accounts and sample data.
EOF
}

if [[ $# -lt 1 || $# -gt 3 ]]; then
    usage
    exit 1
fi

raw_address="${1%/}"
seed_demo=false
insecure_demo=false
shift

for option in "$@"; do
    case "$option" in
        --seed-demo) seed_demo=true ;;
        --insecure-demo-only) insecure_demo=true ;;
        *) usage; exit 1 ;;
    esac
done

if [[ ! "$raw_address" =~ ^(https?://)?[A-Za-z0-9][A-Za-z0-9.:-]*$ ]]; then
    echo "Invalid site address: $raw_address" >&2
    exit 1
fi

case "$raw_address" in
    http://*)
        if [[ "$insecure_demo" != true ]]; then
            echo "Plain HTTP is unsafe for credentials and production data." >&2
            echo "Use a domain for automatic HTTPS, or add --insecure-demo-only for disposable demo data." >&2
            exit 1
        fi
        site_address="$raw_address"
        app_url="$raw_address"
        secure_cookie=false
        ;;
    https://*)
        site_address="$raw_address"
        app_url="$raw_address"
        secure_cookie=true
        ;;
    *)
        site_address="$raw_address"
        app_url="https://$raw_address"
        secure_cookie=true
        ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

for required_file in compose.production.yml server/Dockerfile.production client/Dockerfile.production ai-service/Dockerfile; do
    if [[ ! -f "$required_file" ]]; then
        echo "Missing required deployment file: $required_file" >&2
        exit 1
    fi
done

for command_name in docker openssl; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Required command is not installed: $command_name" >&2
        exit 1
    fi
done

if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose is not installed. Install the Docker Compose plugin first." >&2
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "Docker is not available to this user. Reconnect after adding ec2-user to the docker group." >&2
    exit 1
fi

for secret_file in .env server/.env.production ai-service/.env.production; do
    if [[ -e "$secret_file" ]]; then
        echo "$secret_file already exists; setup stopped to avoid replacing production secrets." >&2
        echo "Use bash scripts/deploy-ec2.sh for an existing installation." >&2
        exit 1
    fi
done

umask 077

mysql_password="$(openssl rand -hex 24)"
mysql_root_password="$(openssl rand -hex 32)"
app_key="base64:$(openssl rand -base64 32 | tr -d '\r\n')"
ai_service_key="$(openssl rand -hex 32)"
groq_key=""

if [[ -t 0 ]]; then
    read -r -s -p "Groq API key (optional; press Enter to use deterministic fallback): " groq_key
    echo
fi

cat > .env <<EOF
SITE_ADDRESS=$site_address
MYSQL_DATABASE=hiusa_db
MYSQL_USER=hiusa
MYSQL_PASSWORD=$mysql_password
MYSQL_ROOT_PASSWORD=$mysql_root_password
EOF

cat > server/.env.production <<EOF
APP_NAME=HIUSA
APP_ENV=production
APP_KEY=$app_key
APP_DEBUG=false
APP_URL=$app_url
APP_TIMEZONE=Asia/Manila
TRUSTED_PROXIES=172.28.0.0/24

APP_LOCALE=en
APP_FALLBACK_LOCALE=en
APP_MAINTENANCE_DRIVER=file

LOG_CHANNEL=stderr
LOG_LEVEL=info

DB_CONNECTION=mysql
DB_HOST=mysql
DB_PORT=3306
DB_DATABASE=hiusa_db
DB_USERNAME=hiusa
DB_PASSWORD=$mysql_password

FRONTEND_URL=$app_url
FRONTEND_URLS=$app_url
FRONTEND_ORIGIN_PATTERNS=

HIUSA_AI_SERVICE_ENABLED=true
HIUSA_AI_SERVICE_URL=http://ai-service:8001
HIUSA_AI_SERVICE_KEY=$ai_service_key
HIUSA_AI_SERVICE_CONNECT_TIMEOUT=2
HIUSA_AI_SERVICE_TIMEOUT=10
HIUSA_TASK_MAX_ACTIVE_TASKS=5

GROQ_API_KEY=$groq_key
GROQ_API_URL=https://api.groq.com/openai/v1/responses
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TIMEOUT=30

SESSION_DRIVER=database
SESSION_LIFETIME=120
SESSION_ENCRYPT=false
SESSION_PATH=/
SESSION_DOMAIN=null
SESSION_SECURE_COOKIE=$secure_cookie
SESSION_SAME_SITE=lax

CACHE_STORE=database
QUEUE_CONNECTION=database
FILESYSTEM_DISK=local

MAIL_MAILER=log
MAIL_FROM_ADDRESS=noreply@hiusa.local
MAIL_FROM_NAME=HIUSA
EOF

cat > ai-service/.env.production <<EOF
HIUSA_AI_SERVICE_KEY=$ai_service_key
HIUSA_AI_HOST=0.0.0.0
HIUSA_AI_PORT=8001
HIUSA_AI_RELOAD=false
EOF

chmod 600 .env server/.env.production ai-service/.env.production

compose=(docker compose -f compose.production.yml)

echo "Validating production configuration..."
"${compose[@]}" config --quiet

echo "Building production images..."
"${compose[@]}" build

echo "Starting database and AI service..."
"${compose[@]}" up -d mysql ai-service

echo "Running database migrations..."
"${compose[@]}" run --rm laravel php artisan migrate --force

if [[ "$seed_demo" == true ]]; then
    echo "Seeding explicitly requested demonstration data..."
    "${compose[@]}" run --rm laravel php artisan db:seed --force
fi

echo "Starting HIUSA..."
"${compose[@]}" up -d

echo "Optimizing Laravel..."
"${compose[@]}" exec -T laravel php artisan optimize

echo
"${compose[@]}" ps
echo
echo "HIUSA deployment completed: $app_url"

if [[ "$seed_demo" == false ]]; then
    echo "The database was migrated but not seeded. Restore a database backup or explicitly provision initial organization/admin data."
fi

if ! curl -fsS --max-time 15 "$app_url/up" >/dev/null 2>&1; then
    echo "The external health check is not reachable yet. DNS/TLS propagation may still be pending." >&2
    echo "Inspect logs with: docker compose -f compose.production.yml logs --tail=100" >&2
fi
