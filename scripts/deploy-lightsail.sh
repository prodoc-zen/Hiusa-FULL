#!/usr/bin/env bash
# Runs ON the Lightsail host, fed over ssh by .github/workflows/deploy.yml:
#   ssh deploy@host 'bash -s -- <40-char commit sha>' < scripts/deploy-lightsail.sh
# Native Ubuntu layout (docs/native-lightsail-deployment.md): Nginx, PHP-FPM, systemd units, code in /var/www/hiusa.
#
# Order: guard -> backup -> fast-forward to the exact sha -> build -> migrate -> caches -> restart -> health.
# Migrations are forward only. A failure before the migrate step puts the code back on the previous commit; a
# failure after it leaves the new code in place and prints the backup to restore from.

set -Eeuo pipefail

APP_DIR="${HIUSA_APP_DIR:-/var/www/hiusa}"
BACKUP_DIR="${HIUSA_BACKUP_DIR:-/var/backups/hiusa}"
read -r -a ARTISAN <<< "${HIUSA_ARTISAN:-sudo -u www-data /usr/local/bin/hiusa-artisan}"
BACKGROUND_UNITS=(hiusa-queue hiusa-scheduler)
ALL_UNITS=(nginx mysql php8.3-fpm hiusa-ai hiusa-fingerprint hiusa-queue hiusa-scheduler)

# "Nothing goes out": the server must keep mail on the log driver and the EDP integration on its local
# driver. A deploy that finds anything else stops before it changes a file.
assert_quiet_mode() {
    local mail="$1" edp="$2"
    if [[ "$mail" != log ]]; then
        echo "Refusing to deploy: mail.default is '$mail', it must be 'log' so no email leaves the server." >&2
        return 1
    fi
    if [[ "$edp" != local ]]; then
        echo "Refusing to deploy: services.edp.driver is '$edp', it must be 'local' so no outside call is made." >&2
        return 1
    fi
}

if [[ "${HIUSA_DEPLOY_GUARD_ONLY:-}" == 1 ]]; then
    assert_quiet_mode "${GUARD_MAIL:-}" "${GUARD_EDP:-}"
    exit 0
fi

# Prints the value, or the word "missing" when the running code has no such config key.
config_value() {
    local out
    out="$(cd "$APP_DIR/server" && "${ARTISAN[@]}" config:show "$1" --no-ansi 2>&1)" || true
    if grep -q 'does not exist' <<<"$out"; then
        echo missing
        return 0
    fi
    awk 'NF { v = $NF } END { print v }' <<<"$out"
}

# Code from before the EDP integration has no services.edp key at all, so it makes no outside call: that reads as
# local. The check after the caches are rebuilt runs against the new code and covers the merged key.
check_quiet_mode() {
    local mail edp
    mail="$(config_value mail.default)"
    edp="$(config_value services.edp.driver)"
    [[ "$edp" == missing ]] && edp=local
    assert_quiet_mode "$mail" "$edp"
}

if [[ "${HIUSA_DEPLOY_CHECK_ONLY:-}" == 1 ]]; then
    check_quiet_mode
    exit 0
fi

# Plain globals on purpose: the EXIT trap reads them after main() has been left through exit.
merged=0
migrated=0
background_stopped=0
client_built=0
target=""
prev=""
db_dump=""
files_dump=""

on_exit() {
    local rc=$?
    trap - EXIT
    if [[ $rc -eq 0 ]]; then
        return 0
    fi
    set +e
    echo >&2
    echo "Deploy of ${target:-unknown} failed (exit $rc)." >&2
    if [[ $merged -eq 1 && $migrated -eq 0 ]]; then
        echo "No migration had run. Putting the code back on $prev." >&2
        (cd "$APP_DIR" && git reset --hard "$prev")
        (cd "$APP_DIR/server" && composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction)
        if [[ $client_built -eq 1 ]]; then
            (cd "$APP_DIR/client" && npm ci && npm run build)
        fi
        (cd "$APP_DIR/server" && "${ARTISAN[@]}" config:cache && "${ARTISAN[@]}" route:cache)
        sudo systemctl reload php8.3-fpm
    elif [[ $migrated -eq 1 ]]; then
        echo "Migrations already ran, so the new code stays in place. Fix forward, or restore the backup:" >&2
        echo "  sudo zcat $db_dump | sudo mysql hiusa_db" >&2
    fi
    if [[ $background_stopped -eq 1 ]]; then
        sudo systemctl start "${BACKGROUND_UNITS[@]}"
    fi
    if [[ -n "$db_dump" && -s "$db_dump" ]]; then
        echo "Backup taken before this deploy: $db_dump and $files_dump" >&2
    fi
    exit "$rc"
}

main() {
    target="${1:-}"
    if [[ ! "$target" =~ ^[0-9a-f]{40}$ ]]; then
        echo "Usage: deploy-lightsail.sh <40-char commit sha>" >&2
        exit 2
    fi

    exec 9>/tmp/hiusa-deploy.lock
    flock -n 9 || { echo "Another deploy is already running." >&2; exit 1; }
    trap on_exit EXIT

    cd "$APP_DIR"
    local stamp changed table_count
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    prev="$(git rev-parse HEAD)"
    db_dump="$BACKUP_DIR/hiusa_db-pre-deploy-$stamp.sql.gz"
    files_dump="$BACKUP_DIR/hiusa_files-pre-deploy-$stamp.tar.gz"

    echo "== 1. Guard"
    if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
        echo "The server checkout has local edits. Preserve them first, then run the deploy again." >&2
        git status --short --untracked-files=no >&2
        exit 1
    fi
    check_quiet_mode

    git fetch --quiet origin main
    git cat-file -e "$target^{commit}" || { echo "Commit $target is not on the server after fetch." >&2; exit 1; }
    if ! git merge-base --is-ancestor "$target" origin/main; then
        echo "Commit $target is not on origin/main. Only main is deployed." >&2
        exit 1
    fi
    if git merge-base --is-ancestor "$target" "$prev"; then
        echo "Server is on ${prev:0:9}, which already contains ${target:0:9}. Nothing to do."
        return 0
    fi
    changed="$(git diff --name-only "$prev" "$target")"
    echo "Deploying ${prev:0:9} -> ${target:0:9}"

    echo "== 2. Backup"
    sudo mkdir -p "$BACKUP_DIR"
    sudo mysqldump --single-transaction --routines --triggers hiusa_db | gzip | sudo tee "$db_dump" > /dev/null
    local paths=()
    [[ -d "$APP_DIR/server/storage/app" ]] && paths+=(storage/app)
    [[ -d "$APP_DIR/server/public/uploads" ]] && paths+=(public/uploads)
    sudo tar -czf "$files_dump" -C "$APP_DIR/server" "${paths[@]}"
    sudo gzip -t "$db_dump"
    sudo gzip -t "$files_dump"
    table_count="$(sudo zcat "$db_dump" | grep -c '^CREATE TABLE' || true)"
    if [[ "$table_count" -lt 1 ]]; then
        echo "The database dump holds no CREATE TABLE lines. Stopping before any change." >&2
        exit 1
    fi
    { sudo ls -1t "$BACKUP_DIR"/hiusa_db-pre-deploy-*.sql.gz 2>/dev/null || true; } | tail -n +15 | xargs -r sudo rm -f
    { sudo ls -1t "$BACKUP_DIR"/hiusa_files-pre-deploy-*.tar.gz 2>/dev/null || true; } | tail -n +15 | xargs -r sudo rm -f

    echo "== 3. Code"
    git merge --ff-only "$target"
    merged=1

    echo "== 4. Build"
    (cd "$APP_DIR/server" && composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction)
    if grep -q '^client/' <<<"$changed" || [[ ! -d "$APP_DIR/client/dist" ]]; then
        client_built=1
        (cd "$APP_DIR/client" && npm ci && npm run build)
    fi
    if grep -q '^ai-service/requirements.*\.txt$' <<<"$changed"; then
        (cd "$APP_DIR/ai-service" && .venv/bin/python -m pip install --quiet -r requirements.txt)
    fi

    echo "== 5. Migrate"
    sudo systemctl stop "${BACKGROUND_UNITS[@]}"
    background_stopped=1
    migrated=1
    (cd "$APP_DIR/server" && "${ARTISAN[@]}" migrate --force)

    echo "== 6. Caches and restart"
    (cd "$APP_DIR/server" && "${ARTISAN[@]}" config:cache && "${ARTISAN[@]}" route:cache)
    check_quiet_mode
    if grep -q '^fingerprint-matcher/' <<<"$changed"; then
        sudo systemctl stop hiusa-fingerprint
        (cd "$APP_DIR/fingerprint-matcher" && dotnet restore && dotnet publish -c Release -o publish)
        sudo systemctl start hiusa-fingerprint
    fi
    if grep -q '^ai-service/' <<<"$changed"; then
        sudo systemctl restart hiusa-ai
    fi
    sudo systemctl reload php8.3-fpm
    sudo systemctl start "${BACKGROUND_UNITS[@]}"
    background_stopped=0
    sudo nginx -t
    sudo systemctl reload nginx

    echo "== 7. Health"
    local healthy=0 i
    for i in $(seq 1 12); do
        if curl -fsSk --max-time 10 https://127.0.0.1/up > /dev/null 2>&1 || curl -fsS --max-time 10 http://127.0.0.1/up > /dev/null 2>&1; then
            healthy=1
            break
        fi
        sleep 5
    done
    if [[ $healthy -ne 1 ]]; then
        echo "The /up health endpoint did not answer after the restart." >&2
        exit 1
    fi
    sudo systemctl is-active "${ALL_UNITS[@]}"

    printf '%s deployed %s (was %s)\n' "$stamp" "$target" "$prev" | sudo tee -a "$BACKUP_DIR/deploy-history.log" > /dev/null
    echo "Deployed $target. Backup: $db_dump"
}

main "$@" < /dev/null
