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
