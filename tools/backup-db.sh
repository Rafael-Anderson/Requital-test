#!/usr/bin/env bash
# Dumps the database DATABASE_URL points at via mysqldump. Parameterized
# entirely by env vars — no hardcoded credentials anywhere in this file, and
# the password is passed via MYSQL_PWD (an env var mysqldump itself reads)
# rather than a command-line flag, so it never shows up in `ps`/shell
# history.
#
# Usage:
#   DATABASE_URL="mysql://user:pass@host:port/db" tools/backup-db.sh [output-dir]
#
# output-dir defaults to ./backups. Requires mysqldump on PATH (ships with
# any MySQL client install, and with the mysql:8.0 image CI already uses).
#
# See docs/runbook.md for the matching restore procedure and the
# migration-by-migration rollback reference.

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL is not set." >&2
  exit 1
fi

OUTPUT_DIR="${1:-./backups}"
mkdir -p "$OUTPUT_DIR"

# Parse mysql://user:pass@host:port/db — same connection-string shape
# common/env-validation.ts already validates at boot. CLAUDE.md's own
# convention is to percent-encode special characters in the password (e.g.
# `#` -> `%23`), so it must be decoded back here or mysqldump gets the
# literal encoded string instead of the real password.
urldecode() {
  local encoded="${1//+/ }"
  printf '%b' "${encoded//%/\\x}"
}

url="${DATABASE_URL#mysql://}"
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

TIMESTAMP=$(date +%Y%m%d%H%M%S)
OUTPUT_FILE="$OUTPUT_DIR/requital-${DB_NAME}-${TIMESTAMP}.sql.gz"

echo "Backing up database '$DB_NAME' from $DB_HOST:$DB_PORT to $OUTPUT_FILE ..."

# --single-transaction: consistent snapshot without locking tables (every
# table in this schema is InnoDB, the Prisma/MySQL default).
# --set-gtid-purged=OFF: avoids a GTID mismatch error restoring into a
# server with replication/GTIDs configured differently than the source.
MYSQL_PWD="$DB_PASSWORD" mysqldump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --user="$DB_USER" \
  --single-transaction \
  --routines \
  --triggers \
  --set-gtid-purged=OFF \
  "$DB_NAME" | gzip > "$OUTPUT_FILE"

echo "Backup written to $OUTPUT_FILE"
