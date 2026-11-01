#!/usr/bin/env bash
# CODE-ONLY rollback: moves the production checkout back to an earlier commit
# (the PREVIOUS_SHA that deploy.sh printed), rebuilds all three apps and restarts
# them in order with health checks. It deliberately does NOT restore the
# database. Migrations in this repo are additive, so the previous code runs
# against the already-migrated schema; restoring a dump would also discard every
# order placed since the backup. A real database restore stays a human decision:
# see docs/runbook.md ("The real thing (restoring over production)" and
# "Migration rollback reference").
#
# Usage:
#   rollback.sh <40-hex PREVIOUS_SHA> [--dry-run]
#
# Guards: the checkout must be clean; PREVIOUS_SHA must be an ancestor of the
# current HEAD AND reachable from origin/main (so a rollback can only land on a
# commit that was once a legitimate main commit); PREVIOUS_SHA == HEAD is a no-op.
# `git reset --hard` is safe here only because the clean-tree gate ran first.
# No dry-run marker and no --ci-verified are required: a rollback is the
# emergency path and the target is a commit that was already deployed.
#
# Config (env): same knobs as deploy.sh (APP_DIR, LOG_DIR, LOCK_FILE, PM2_*, ...).
# Exit codes: 0 ok, 1 failure, 2 refused by a gate, 3 lock held.
#
# See docs/runbook.md ("Deploy via GitHub Actions").

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/validate-sha.sh
. "$SELF_DIR/lib/validate-sha.sh"

PREV="$(validate_sha "${1-}")" || { echo "Usage: $0 <40-hex PREVIOUS_SHA> [--dry-run]" >&2; exit 2; }
shift
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "Error: unknown argument. Usage: $0 <40-hex PREVIOUS_SHA> [--dry-run]" >&2; exit 2 ;;
  esac
done

# `git reset --hard` replaces this file: run from a temp copy (see deploy.sh).
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  DEPLOY_TMP_DIR="$(mktemp -d)"
  mkdir -p "$DEPLOY_TMP_DIR/lib"
  cp "$SELF_DIR/rollback.sh" "$DEPLOY_TMP_DIR/rollback.sh"
  cp "$SELF_DIR"/lib/*.sh "$DEPLOY_TMP_DIR/lib/"
  chmod 700 "$DEPLOY_TMP_DIR/rollback.sh"
  export DEPLOY_TMP_DIR DEPLOY_REEXEC=1
  reexec_args=("$PREV")
  if [ "$DRY_RUN" = 1 ]; then reexec_args+=(--dry-run); fi
  exec "$DEPLOY_TMP_DIR/rollback.sh" "${reexec_args[@]}"
fi

# shellcheck source=lib/redact.sh
. "$SELF_DIR/lib/redact.sh"
# shellcheck source=lib/common.sh
. "$SELF_DIR/lib/common.sh"

trap '' HUP
trap on_exit_common EXIT

acquire_lock
setup_logging rollback "$PREV"
umask 077

if [ "$DRY_RUN" = 1 ]; then MODE="DRY-RUN"; else MODE="REAL"; fi
echo "rollback.sh: target=$PREV mode=$MODE user=$(id -un) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"

step 1 "preflight"
check_user
require_cmds git node npm pm2 mysql gzip flock curl md5sum
check_disk
load_db_config
check_pm2_online

step 2 "working tree is clean"
check_clean_tree

step 3 "git gates"
git -C "$APP_DIR" fetch --quiet origin main
git -C "$APP_DIR" cat-file -e "${PREV}^{commit}" 2>/dev/null || refuse "target $PREV is not a commit this repository knows."
CURRENT="$(git -C "$APP_DIR" rev-parse HEAD)"
note "current HEAD: $CURRENT"
if [ "$CURRENT" = "$PREV" ]; then
  echo "Target equals the current HEAD: nothing to roll back."
  RESULT_LINE=no
  echo "ALREADY AT TARGET"
  exit 0
fi
git -C "$APP_DIR" merge-base --is-ancestor "$PREV" "$CURRENT" || refuse "target $PREV is not an ancestor of the current HEAD; a rollback only moves backwards along the deployed history."
git -C "$APP_DIR" merge-base --is-ancestor "$PREV" origin/main || refuse "target $PREV is not reachable from origin/main."
BRANCH="$(git -C "$APP_DIR" symbolic-ref --short -q HEAD || true)"
[ "$BRANCH" = "main" ] || refuse "the checkout is on '${BRANCH:-detached HEAD}', not main."

MIGS="$(git -C "$APP_DIR" diff --name-only "$PREV" "$CURRENT" -- backend/prisma/migrations | sed 's#backend/prisma/migrations/##; s#/.*##' | sort -u)"
if [ -n "$MIGS" ]; then
  echo "NOTE: migrations exist between the target and HEAD; they stay applied (code-only rollback):"
  # shellcheck disable=SC2001
  echo "$MIGS" | sed 's/^/  /'
fi
resolve_smoke_slug

if [ "$DRY_RUN" = 1 ]; then
  echo
  echo "WOULD DO: git reset --hard $PREV (from $CURRENT)"
  echo "WOULD DO: npm ci and build backend, storefront (INTERNAL_API_URL=http://127.0.0.1:$PORT_BACKEND), admin; assert backend dist/main.js and the storefront rewrite"
  echo "WOULD DO: pm2 restart backend, storefront, admin in order with health waits"
  echo "WOULD DO: redirect-map smoke and log scan"
  echo "WOULD DO: NO database restore (code-only rollback)"
  RESULT_LINE=no
  echo "DRYRUN OK"
  exit 0
fi

ROLLBACK_HINT="Rollback failed part-way. The checkout may already be at $PREV. Roll forward again by running the Deploy workflow (dry-run first) with sha=$CURRENT."

step 4 "reset to the target"
git -C "$APP_DIR" reset --hard "$PREV"
[ "$(git -C "$APP_DIR" rev-parse HEAD)" = "$PREV" ] || fail "HEAD is not the target after reset."

step 5 "build everything before any restart"
build_backend
( cd "$APP_DIR/backend" && npm run build )
assert_backend_dist
build_storefront
build_admin

step 6 "restart and health"
declare -A LOGBASE=()
for app in "$PM2_BACKEND" "$PM2_STOREFRONT" "$PM2_ADMIN"; do
  LOGBASE[$app]="$(mktemp)"
  snapshot_logs "$app" "${LOGBASE[$app]}"
done
restart_one "$PM2_BACKEND"
restart_one "$PM2_STOREFRONT"
restart_one "$PM2_ADMIN"

step 7 "smoke"
smoke_redirect_map
for app in "$PM2_BACKEND" "$PM2_STOREFRONT" "$PM2_ADMIN"; do scan_logs "$app" "${LOGBASE[$app]}"; done
rm -f "${LOGBASE[@]}"

step 8 "result"
echo "ROLLED_BACK_FROM=$CURRENT"
echo "ROLLED_BACK_TO=$PREV"
echo "HEAD=$(git -C "$APP_DIR" rev-parse HEAD)"
echo "LOG_FILE=$LOG_FILE"
echo "Database NOT restored (code-only). See docs/runbook.md before any restore."
RESULT_LINE=no
echo "DEPLOY_RESULT=OK"
