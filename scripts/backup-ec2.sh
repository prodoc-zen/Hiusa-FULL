#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ ! -f .env ]]; then
    echo "Missing .env; this does not appear to be a configured EC2 deployment." >&2
    exit 1
fi

backup_root="${1:-$HOME/hiusa-backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$backup_root/$timestamp"

mkdir -p "$backup_dir"
chmod 700 "$backup_root" "$backup_dir"

compose=(docker compose -f compose.production.yml)

echo "Backing up MySQL..."
"${compose[@]}" exec -T mysql sh -c \
    'exec mysqldump --single-transaction --routines --triggers -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
    > "$backup_dir/database.sql"

echo "Backing up Laravel storage and public uploads..."
docker run --rm \
    -v hiusa_laravel_storage:/source:ro \
    -v "$backup_dir:/backup" \
    alpine:3.22 tar -C /source -czf /backup/laravel-storage.tar.gz .

docker run --rm \
    -v hiusa_laravel_uploads:/source:ro \
    -v "$backup_dir:/backup" \
    alpine:3.22 tar -C /source -czf /backup/public-uploads.tar.gz .

sha256sum "$backup_dir"/* > "$backup_dir/SHA256SUMS"
chmod 600 "$backup_dir"/*

echo "Backup completed: $backup_dir"
echo "Copy this directory off the EC2 instance or protect it with an EBS snapshot/remote backup."
