#!/usr/bin/env bash
# The scheduled half of the backup story: dump the database, copy the dump off
# this VPS, prune both ends. tools/backup-db.sh still does the dump itself —
# this script only handles the scheduling concerns around it (where credentials
# come from, the off-host copy, retention, a readable log line per run).
#
# Installed on the VPS as /etc/cron.d/requital-backup, whose contents are
# mirrored in the repo at deploy/requital-backup.cron — same convention as
# deploy/Caddyfile. Safe to run by hand at any time; it is idempotent.
#
# Configuration (all overridable, nothing hardcoded):
#   /home/deploy/.requital-backup.env  BACKUP_S3_* credentials, mode 600
#   APP_DIR / BACKUP_DIR               where the app and the dumps live
#   {DAILY,WEEKLY,LOCAL}_KEEP_DAYS     retention, see docs/runbook.md
#
# See docs/runbook.md for the restore side, the retention policy in prose, and
# the RPO/RTO this actually buys.

set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/requital}"
BACKUP_DIR="${BACKUP_DIR:-/home/deploy/backups}"
ENV_FILE="${BACKUP_ENV_FILE:-/home/deploy/.requital-backup.env}"
DAILY_KEEP_DAYS="${DAILY_KEEP_DAYS:-14}"
WEEKLY_KEEP_DAYS="${WEEKLY_KEEP_DAYS:-56}"
LOCAL_KEEP_DAYS="${LOCAL_KEEP_DAYS:-7}"

# Everything below works in absolute paths, and `find` refuses to run at all if
# it cannot get back to the directory it started in — so don't inherit one.
cd /

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
die() {
  log "FAILED: $*"
  exit 1
}

# BACKUP_S3_* mirrors the shape of the app's own storage-provider vars
# (S3_ENDPOINT/S3_BUCKET/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY — see
# backend/src/storage/storage-provider.factory.ts) but under deliberately
# separate names, because this is a separate bucket with its own key: the app
# must not be able to delete the backups, and a leak on either side must not
# reach the other.
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

# The DB password is read out of the app's own env file rather than copied into
# a second one — one source of truth, nothing to drift when it is rotated.
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' "$APP_DIR/backend/.env" | cut -d= -f2- || true)
[ -n "$DATABASE_URL" ] || die "no DATABASE_URL in $APP_DIR/backend/.env"

DATABASE_URL="$DATABASE_URL" "$APP_DIR/tools/backup-db.sh" "$BACKUP_DIR" ||
  die "mysqldump failed"

# backup-db.sh names the file itself (timestamped), so pick up the newest.
DUMP=$(ls -t "$BACKUP_DIR"/*.sql.gz | head -1)
gzip -t "$DUMP" || die "$DUMP is not a valid gzip archive"

if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
  log "WARNING: no BACKUP_S3_BUCKET in $ENV_FILE — $(basename "$DUMP") exists on this VPS ONLY."
  log "WARNING: skipping the off-host copy, and skipping the local prune with it"
  log "WARNING: (a dump is never deleted from the one place it exists)."
  exit 0
fi

command -v rclone >/dev/null || die "rclone is not installed (apt-get install -y rclone)"
for var in BACKUP_S3_ENDPOINT BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
  [ -n "${!var:-}" ] || die "$var is not set in $ENV_FILE"
done

# rclone takes its whole remote definition from the environment, so there is no
# config file holding credentials and nothing secret in the argv that `ps`
# would show. The var-name suffix after RCLONE_CONFIG_ is the remote name, so
# these are the remote `offsite:` referenced below.
# No config file at all — every setting is in the environment. Without this
# rclone logs a "Config file not found - using defaults" NOTICE to stderr on
# every invocation, which is three lines of noise per night in the log.
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_OFFSITE_TYPE="${BACKUP_S3_TYPE:-s3}"
export RCLONE_CONFIG_OFFSITE_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_OFFSITE_ENDPOINT="$BACKUP_S3_ENDPOINT"
export RCLONE_CONFIG_OFFSITE_REGION="${BACKUP_S3_REGION:-auto}"
export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
# The backup key only needs Put/List/Delete on one bucket, not CreateBucket,
# which rclone would otherwise probe for on every run.
export RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true

# Copy the whole directory rather than just tonight's file: a run whose upload
# failed is caught up by the next one, and the dumps already sitting on this
# box get backfilled by the first successful run. Costs nothing — rclone skips
# what is already there.
rclone copy "$BACKUP_DIR" "offsite:$BACKUP_S3_BUCKET/daily" --include '*.sql.gz' ||
  die "off-host copy to $BACKUP_S3_BUCKET/daily failed"

# Sunday's dump doubles as that week's weekly copy. Splitting the two
# retentions by prefix means retention is two --min-age deletes below instead
# of any date arithmetic in here.
if [ "$(date -u +%u)" = 7 ]; then
  rclone copyto "$DUMP" "offsite:$BACKUP_S3_BUCKET/weekly/$(basename "$DUMP")" ||
    die "weekly copy to $BACKUP_S3_BUCKET/weekly failed"
fi

rclone delete --min-age "${DAILY_KEEP_DAYS}d" "offsite:$BACKUP_S3_BUCKET/daily" ||
  die "pruning $BACKUP_S3_BUCKET/daily failed"
rclone delete --min-age "${WEEKLY_KEEP_DAYS}d" "offsite:$BACKUP_S3_BUCKET/weekly" ||
  die "pruning $BACKUP_S3_BUCKET/weekly failed"

# Local copies are pruned only here, after the off-host copy has succeeded, so
# a dump is never deleted from the only place it exists.
find "$BACKUP_DIR" -name '*.sql.gz' -type f -mtime "+$LOCAL_KEEP_DAYS" -delete

log "OK: $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1)) -> $BACKUP_S3_BUCKET/daily"
