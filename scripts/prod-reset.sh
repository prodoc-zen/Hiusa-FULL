#!/usr/bin/env bash
# Wipes the HIUSA database and rebuilds it for a clean start, keeping the SAO's own password.
#
#   prod-reset.sh first-time   SAO 990001 + five colleges with their home organizations; no academic year,
#                              no student organizations, no other users (the dean demo starting state)
#   prod-reset.sh seeded       the full DatabaseSeeder demo data (what scripts/reseed-staging.ps1 produces)
#
# Run it ON THE SERVER as the ubuntu user, from a checkout that has scripts/prod-reset-seed.php next to it:
#   ssh ubuntu@13.228.227.182 'sudo mkdir -p /etc/hiusa; echo "reseed-production $(date -u +%F)" | sudo tee /etc/hiusa/ALLOW_RESEED'
#   tr -d '\r' < scripts/prod-reset.sh | ssh ubuntu@13.228.227.182 "cat > /tmp/prod-reset.sh"; scp scripts/prod-reset-seed.php ubuntu@13.228.227.182:/tmp/
#   ssh -t ubuntu@13.228.227.182 'bash /tmp/prod-reset.sh first-time'
# (the .php file is looked up next to this script, or in /tmp)
#
# It does NOT check for active elections: wiping them is the point. The election count is printed before the wipe.
# Never prints the SAO hash. Files under storage/app (photos, submitted documents) are NOT deleted and become orphans;
# the files tar in /var/backups/hiusa has them.
set -euo pipefail

MODE="${1:-}"
case "$MODE" in first-time|seeded) ;; *) echo "usage: prod-reset.sh first-time|seeded" >&2; exit 2 ;; esac

DB=hiusa_db
B=/var/backups/hiusa
MARKER=/etc/hiusa/ALLOW_RESEED
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PHP_SRC="$HERE/prod-reset-seed.php"
[ -f "$PHP_SRC" ] || PHP_SRC=/tmp/prod-reset-seed.php
[ -f "$PHP_SRC" ] || { echo "REFUSED: prod-reset-seed.php not found next to the script or in /tmp" >&2; exit 2; }
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TODAY="$(date -u +%F)"

step() { echo; echo "== $*"; }
artisan() { sudo -u www-data env APP_ENV=staging APP_DEBUG=false hiusa-artisan "$@"; }

# 1. Marker: exactly "reseed-production YYYY-MM-DD" with today's UTC date.
step "1 marker"
if [ ! -f "$MARKER" ]; then echo "REFUSED: $MARKER does not exist" >&2; exit 2; fi
if [ "$(sudo cat "$MARKER" | tr -d '\r\n')" != "reseed-production $TODAY" ]; then
  echo "REFUSED: $MARKER must hold exactly: reseed-production $TODAY" >&2; exit 2
fi
echo "marker ok for $TODAY"

STARTED_WIPE=0
HASHFILE=""
SEEDFILE=""
cleanup() {
  rc=$?
  [ -n "$HASHFILE" ] && sudo shred -u "$HASHFILE" 2>/dev/null || true
  [ -n "$SEEDFILE" ] && sudo rm -f "$SEEDFILE" || true
  sudo rm -f "$MARKER" && echo "marker removed"
  if [ $rc -ne 0 ]; then
    echo
    echo "FAILED (exit $rc). Wipe started: $STARTED_WIPE. Backup: $B/predeploy-reset-$STAMP.sql.gz and $B/predeploy-reset-$STAMP-files.tar.gz"
    echo "Restore: sudo sh -c \"zcat $B/predeploy-reset-$STAMP.sql.gz | mysql $DB\"   then   sudo systemctl start hiusa-queue hiusa-scheduler"
    echo "Or fix the cause, create the marker again and re-run this script (the database is rebuilt from scratch each run)."
  fi
}
trap cleanup EXIT

# 2. What is about to be lost.
step "2 before the wipe"
sudo mysql -N -e "select 'users', count(*) from $DB.users union all select 'organizations', count(*) from $DB.organizations union all select 'elections', count(*) from $DB.elections union all select 'academic_years', count(*) from $DB.academic_years" | tr '\t' ' '
echo "elections by status:"; sudo mysql -N -e "select status, count(*) from $DB.elections group by status" | tr '\t' ' '
echo "files under storage/app: $(sudo find /var/www/hiusa/server/storage/app -type f 2>/dev/null | wc -l)"

# 3. Backup (same steps as the pre-deploy backup): dump + files tar, gzip -t, table count.
step "3 backup"
sudo mkdir -p "$B"
SQL="$B/predeploy-reset-$STAMP.sql.gz"
FILES="$B/predeploy-reset-$STAMP-files.tar.gz"
sudo sh -c "mysqldump --single-transaction --routines $DB | gzip > $SQL"
sudo tar czf "$FILES" -C /var/www/hiusa/server storage/app
for f in "$SQL" "$FILES"; do
  sudo gzip -t "$f" || { echo "ABORT: backup $f failed gzip -t" >&2; exit 1; }
  echo "ok $f $(sudo stat -c%s "$f") bytes"
done
LIVE_TABLES="$(sudo mysql -N -e "select count(*) from information_schema.tables where table_schema='$DB' and table_type='BASE TABLE'")"
DUMP_TABLES="$(sudo zcat "$SQL" | grep -c 'CREATE TABLE' || true)"
echo "tables live=$LIVE_TABLES dump=$DUMP_TABLES"
[ "$LIVE_TABLES" = "$DUMP_TABLES" ] && [ "$DUMP_TABLES" -gt 0 ] || { echo "ABORT: dump table count does not match the live database" >&2; exit 1; }

# 4. Save the SAO password hash and email to a 600 file owned by www-data. Never printed.
step "4 save the SAO hash"
HASHFILE="$(sudo mktemp /tmp/hiusa-sao-hash.XXXXXXXX)"
sudo chmod 600 "$HASHFILE"
# Write while root still owns the file: fs.protected_regular stops root writing into another user's file in /tmp.
sudo sh -c "mysql -N -B -e \"select password_hash from $DB.users where school_id=990001; select email from $DB.users where school_id=990001\" > $HASHFILE"
sudo chown www-data:www-data "$HASHFILE"
[ "$(sudo cat "$HASHFILE" | wc -l)" -eq 2 ] || { echo "ABORT: SAO 990001 not found in $DB, nothing wiped" >&2; exit 1; }
sudo head -c 4 "$HASHFILE" | grep -qE '^\$2[aby]\$|^\$arg' || { echo "ABORT: saved SAO value does not look like a password hash" >&2; exit 1; }
echo "saved (hash length $(sudo head -1 "$HASHFILE" | tr -d '\n' | wc -c))"

SEEDFILE=/tmp/prod-reset-seed.$STAMP.php
sudo install -m 644 -o www-data -g www-data "$PHP_SRC" "$SEEDFILE"

# 5. Stop workers, clear config.
step "5 stop units, config:clear"
STARTED_WIPE=1
sudo systemctl stop hiusa-queue hiusa-scheduler
artisan config:clear

# 6. Rebuild.
step "6 migrate:fresh ($MODE)"
if [ "$MODE" = seeded ]; then artisan migrate:fresh --seed --force; else artisan migrate:fresh --force; fi

# 7. Mode seeding and hash restore, as www-data (tinker cannot write /var/www/.config/psysh).
step "7 seed and restore the SAO password"
OUT="$(sudo -u www-data env APP_ENV=staging APP_DEBUG=false HOME=/tmp XDG_CONFIG_HOME=/tmp \
  HIUSA_RESET_MODE="$MODE" HIUSA_RESET_HASH_FILE="$HASHFILE" \
  hiusa-artisan tinker --execute="require '$SEEDFILE';" 2>&1 </dev/null || true)"
VERIFY="$(printf '%s\n' "$OUT" | grep '^VERIFY ' || true)"
[ -n "$VERIFY" ] || { echo "ABORT: the seed step printed no VERIFY line (never trust empty output). Output follows:" >&2; printf '%s\n' "$OUT" | sed -E 's/\$2[aby]\$[^ ]*/[hash]/g' | head -30 >&2; exit 1; }
case "$VERIFY" in *sao_hash_equals_saved=true*) ;; *) echo "ABORT: SAO hash was not restored: $VERIFY" >&2; exit 1 ;; esac

# 8. Cache config, start the units.
step "8 config:cache, start units"
artisan config:cache
sudo systemctl start hiusa-queue hiusa-scheduler
sleep 2
systemctl is-active hiusa-queue hiusa-scheduler

echo
echo "$VERIFY"
echo "files under storage/app left on disk (orphans, not deleted): $(sudo find /var/www/hiusa/server/storage/app -type f 2>/dev/null | wc -l)"
echo "Backup: $SQL and $FILES"
echo "DONE ($MODE). Sign in as SAO 990001 with your own password."
