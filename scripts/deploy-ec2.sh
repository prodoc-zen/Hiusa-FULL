#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

for secret_file in .env server/.env.production ai-service/.env.production; do
    if [[ ! -f "$secret_file" ]]; then
        echo "Missing $secret_file. Run bash scripts/setup-ec2.sh first." >&2
        exit 1
    fi
done

if ! docker info >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    echo "Docker and Docker Compose must be available to the current user." >&2
    exit 1
fi

compose=(docker compose -f compose.production.yml)

echo "Creating a pre-deployment data backup..."
bash scripts/backup-ec2.sh

echo "Updating tracked source files..."
git pull --ff-only

set_env_value() {
    local file="$1"
    local name="$2"
    local value="$3"
    if grep -q "^${name}=" "$file"; then
        sed -i "s|^${name}=.*|${name}=${value}|" "$file"
    else
        printf '%s=%s\n' "$name" "$value" >> "$file"
    fi
}

# Upgrade installations created before the fingerprint matcher was added.
# Keep one private key on both sides of the internal Docker connection.
fingerprint_matcher_key="$(sed -n 's/^FINGERPRINT_MATCHER_KEY=//p' .env | tail -n 1)"
if [[ -z "$fingerprint_matcher_key" || "$fingerprint_matcher_key" == CHANGE_ME_* ]]; then
    fingerprint_matcher_key="$(openssl rand -hex 32)"
fi
set_env_value .env FINGERPRINT_MATCHER_KEY "$fingerprint_matcher_key"
set_env_value server/.env.production FINGERPRINT_MATCHER_DRIVER http
set_env_value server/.env.production FINGERPRINT_MATCHER_URL http://fingerprint-matcher:9100
set_env_value server/.env.production FINGERPRINT_MATCHER_KEY "$fingerprint_matcher_key"
set_env_value server/.env.production FINGERPRINT_MATCHER_TIMEOUT 15
set_env_value server/.env.production FINGERPRINT_MATCHER_TEMPLATE_FORMAT fscanner-sourceafis-dotnet-3.14.0-png-v1
echo "Fingerprint matcher configuration is present and synchronized."

echo "Validating production configuration..."
"${compose[@]}" config --quiet

echo "Building updated images..."
"${compose[@]}" build

echo "Ensuring dependency services are available..."
"${compose[@]}" up -d mysql ai-service

echo "Applying forward-only migrations..."
"${compose[@]}" run --rm laravel php artisan migrate --force

echo "Recreating application services..."
"${compose[@]}" up -d --remove-orphans

echo "Refreshing Laravel caches..."
"${compose[@]}" exec -T laravel php artisan optimize:clear
"${compose[@]}" exec -T laravel php artisan optimize

site_address="$(sed -n 's/^SITE_ADDRESS=//p' .env | tail -n 1)"
if [[ -z "$site_address" ]]; then
    echo "SITE_ADDRESS is missing from .env." >&2
    exit 1
fi

echo "Waiting for the public health endpoint..."
healthy=false
for _ in {1..12}; do
    if curl -fsS --max-time 10 "$site_address/up" >/dev/null 2>&1; then
        healthy=true
        break
    fi
    sleep 5
done

if [[ "$healthy" != true ]]; then
    echo "Deployment completed but the public health endpoint is unavailable: $site_address/up" >&2
    echo "Review logs immediately; restore the pre-deployment backup if the release is not recoverable." >&2
    exit 1
fi

echo
"${compose[@]}" ps
echo
echo "Deployment finished. Review recent logs with:"
echo "docker compose -f compose.production.yml logs --tail=100"
