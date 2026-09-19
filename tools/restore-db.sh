#!/usr/bin/env bash
# Restores a tools/backup-db.sh dump into a scratch database and then proves the
# restore by counting rows in it — the drill half of the backup story. A backup
# nobody has restored is a hypothesis, not a backup.
#
# Usage:
#   RESTORE_DATABASE_URL="mysql://user:pass@host:port/scratch_db" \
#     tools/restore-db.sh /home/deploy/backups/requital-<db>-<timestamp>.sql.gz
#
# The target database is created if it does not exist. The restore is
# destructive to THAT database — every table the dump contains is dropped and
# recreated — so it refuses to run when the target name matches the database
# the app is actually configured to use. The real disaster-recovery path (that
# IS restoring over production) is the same script with
# ALLOW_PRODUCTION_RESTORE=yes, deliberately a different keystroke from a
# drill. See docs/runbook.md.

set -euo pipefail

FILE="${1:-}"
APP_DIR="${APP_DIR:-/home/deploy/requital}"

if [ -z "$FILE" ] || [ -z "${RESTORE_DATABASE_URL:-}" ]; then
  echo "Usage: RESTORE_DATABASE_URL=\"mysql://user:pass@host:port/scratch_db\" $0 <dump.sql.gz>" >&2
  exit 1
fi
[ -f "$FILE" ] || {
  echo "Error: $FILE does not exist." >&2
  exit 1
}
gzip -t "$FILE" || {
  echo "Error: $FILE is not a valid gzip archive — restoring it would half-write the target." >&2
  exit 1
}

# ponytail: the same connection-string parse as backup-db.sh, copied rather
# than factored into a shared sourced file. Two callers, fifteen lines, and
# backup-db.sh is the one script here that has run against production for
# months — not worth touching it to save a duplicate.
urldecode() {
  local encoded="${1//+/ }"
  printf '%b' "${encoded//%/\\x}"
}
url="${RESTORE_DATABASE_URL#mysql://}"
credentials="${url%%@*}"
rest="${url#*@}"
DB_USER=$(urldecode "${credentials%%:*}")
DB_PASSWORD=$(urldecode "${credentials#*:}")
hostport="${rest%%/*}"
DB_NAME="${rest#*/}"
DB_HOST="${hostport%%:*}"
DB_PORT="${hostport#*:}"
if [ "$DB_PORT" = "$DB_HOST" ]; then
  DB_PORT=3306
fi

# Which database is production? DATABASE_URL if it is in the environment,
# otherwise the app's own env file if this is running on the app host.
APP_DB=""
if [ -n "${DATABASE_URL:-}" ]; then
  APP_DB="${DATABASE_URL##*/}"
elif [ -r "$APP_DIR/backend/.env" ]; then
  app_url=$(grep -m1 '^DATABASE_URL=' "$APP_DIR/backend/.env" | cut -d= -f2- || true)
  APP_DB="${app_url##*/}"
fi
if [ -n "$APP_DB" ] && [ "$APP_DB" = "$DB_NAME" ] && [ "${ALLOW_PRODUCTION_RESTORE:-no}" != "yes" ]; then
  echo "Refusing: '$DB_NAME' is the database the app itself uses." >&2
  echo "For a drill, point RESTORE_DATABASE_URL at a scratch database name." >&2
  echo "To genuinely restore over it, re-run with ALLOW_PRODUCTION_RESTORE=yes." >&2
  exit 1
fi

echo "Restoring $FILE into '$DB_NAME' on $DB_HOST:$DB_PORT ..."
mysql() { MYSQL_PWD="$DB_PASSWORD" command mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" "$@"; }

mysql -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

started=$(date +%s)
gunzip -c "$FILE" | mysql "$DB_NAME"
elapsed=$(($(date +%s) - started))

# Counts, not a "success" message: a restore that produced an empty schema also
# exits 0. `order` is a reserved word, hence the backticks.
echo "Restored in ${elapsed}s. Contents of '$DB_NAME':"
mysql --table "$DB_NAME" -e "
  SELECT
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()) AS tables,
    (SELECT COUNT(*) FROM \`_migrations\`) AS migrations,
    (SELECT COUNT(*) FROM \`shop\`) AS shops,
    (SELECT COUNT(*) FROM \`outlet\`) AS outlets,
    (SELECT COUNT(*) FROM \`order\`) AS orders,
    (SELECT COUNT(*) FROM \`customer\`) AS customers,
    (SELECT COUNT(*) FROM \`product\`) AS products;
  SELECT name AS newest_migration, applied_at FROM \`_migrations\` ORDER BY applied_at DESC LIMIT 1;"

echo
echo "Compare those against production before calling the drill passed."
echo "Drop the scratch database when you are done:"
echo "  MYSQL_PWD=... mysql --host=$DB_HOST --user=$DB_USER -e 'DROP DATABASE \`$DB_NAME\`'"
