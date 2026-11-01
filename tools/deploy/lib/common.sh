#!/usr/bin/env bash
# Shared helpers for deploy.sh and rollback.sh (sourced, never executed). Keeps
# the lock, the redacted log, the build steps, the pm2 restart and the health
# checks in ONE place so a deploy and a rollback cannot drift apart.
#
# Everything is parameterised by environment variables (defaults are the
# production VPS layout from CLAUDE.md "VPS deploy"); the tests point them at
# temp directories and put fake binaries (npm, pm2, mysql, curl, ...) first on
# PATH. Credentials are never put in argv: the DB password travels only in the
# MYSQL_PWD environment of a single command.
#
# See docs/runbook.md ("Deploy via GitHub Actions").

APP_DIR="${APP_DIR:-/home/deploy/requital}"
LOG_DIR="${LOG_DIR:-/home/deploy/deploy-logs}"
LOCK_FILE="${LOCK_FILE:-/home/deploy/.requital-deploy.lock}"
BACKUP_DIR="${BACKUP_DIR:-/home/deploy/backups}"
PM2_BACKEND="${PM2_BACKEND:-requital-backend}"
PM2_ADMIN="${PM2_ADMIN:-requital-admin}"
PM2_STOREFRONT="${PM2_STOREFRONT:-requital-storefront}"
PORT_BACKEND="${PORT_BACKEND:-3000}"
PORT_ADMIN="${PORT_ADMIN:-3001}"
PORT_STOREFRONT="${PORT_STOREFRONT:-3002}"
DEPLOY_USER_EXPECTED="${DEPLOY_USER_EXPECTED:-deploy}"
MIN_FREE_KB="${MIN_FREE_KB:-2097152}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
POLL_INTERVAL="${POLL_INTERVAL:-2}"
STABLE_WAIT="${STABLE_WAIT:-15}"

CURRENT_STEP="0"

# Printed in the failure trap; set by the caller once it knows the old SHA.
ROLLBACK_HINT=""

step() {
  CURRENT_STEP="$1"
  echo
  echo "=== step $1: $2 ==="
}

note() { echo "$*"; }

# Gate refusal: nothing has been changed yet. Exit 2 (distinct from a failure).
refuse() {
  echo "REFUSED: $*" >&2
  exit 2
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

# Every external program that could leave a long-lived child (a pm2 daemon, a
# build tool's background worker, ...) runs with the lock descriptor (fd 9)
# closed, so a lingering child can never keep the deploy lock held after this
# script has exited. Plain shell functions shadowing the commands keeps every
# call site unchanged (and greppable by the test fakes, which sit on PATH).
pm2() { command pm2 "$@" 9>&-; }
git() { command git "$@" 9>&-; }
node() { command node "$@" 9>&-; }
npm() { command npm "$@" 9>&-; }
npx() { command npx "$@" 9>&-; }
mysql() { command mysql "$@" 9>&-; }
curl() { command curl "$@" 9>&-; }

# One private scratch directory per run (TMPDIR-relative), removed on EVERY exit
# path by on_exit_common. All temporary files live in it.
WORK_DIR=""
make_workdir() {
  WORK_DIR="$(mktemp -d)"
}

# ---- lock + log -------------------------------------------------------------

acquire_lock() {
  mkdir -p "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "Error: another deploy is running (lock $LOCK_FILE is held)." >&2
    exit 3
  fi
}

# setup_logging <prefix> <sha>: from here on stdout and stderr go through the
# redaction filter into a 0600 log file AND to the caller (the SSH session).
setup_logging() {
  mkdir -p "$LOG_DIR"
  chmod 700 "$LOG_DIR" 2>/dev/null || true
  LOG_FILE="$LOG_DIR/$1-$(date -u +%Y%m%dT%H%M%SZ)-${2:0:7}.log"
  ( umask 077; : > "$LOG_FILE" )
  # The logging subshell closes fd 9 first: it outlives this script by a moment
  # and must never hold the deploy lock.
  exec > >(exec 9>&-; redact | tee -a "$LOG_FILE") 2>&1
  echo "log: $LOG_FILE"
}

on_exit_common() {
  local rc=$?
  trap - EXIT
  # Optional caller cleanup (deploy.sh removes its temporary matrix script).
  if [ -n "${EXIT_HOOK:-}" ]; then "$EXIT_HOOK" || true; fi
  if [ -n "${DEPLOY_TMP_DIR:-}" ] && [ -d "$DEPLOY_TMP_DIR" ]; then
    rm -rf "$DEPLOY_TMP_DIR"
  fi
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
  if [ "$rc" -ne 0 ] && [ "${RESULT_LINE:-yes}" = "yes" ]; then
    if [ "$rc" -eq 2 ]; then
      echo "DEPLOY_RESULT=REFUSED"
    elif [ "$rc" -eq 3 ]; then
      echo "DEPLOY_RESULT=BUSY"
    else
      echo "DEPLOY_RESULT=FAILED step=$CURRENT_STEP"
    fi
    [ -z "$ROLLBACK_HINT" ] || echo "$ROLLBACK_HINT"
  fi
  exit "$rc"
}

# ---- environment / preflight --------------------------------------------------

require_cmds() {
  local c missing=""
  for c in "$@"; do
    # type -P: real executables only (command -v would also find our pm2() wrapper).
    type -P "$c" >/dev/null 2>&1 || missing="$missing $c"
  done
  [ -z "$missing" ] || fail "required command(s) missing:$missing"
}

check_user() {
  local who
  who="$(id -un)"
  [ "$who" = "$DEPLOY_USER_EXPECTED" ] || refuse "must run as '$DEPLOY_USER_EXPECTED' (running as '$who')."
}

check_disk() {
  local free
  free="$(df -Pk "$APP_DIR" | awk 'NR==2 {print $4}')"
  case "$free" in ''|*[!0-9]*) fail "cannot read free disk space for $APP_DIR." ;; esac
  [ "$free" -ge "$MIN_FREE_KB" ] || refuse "free disk ${free} KB is below the ${MIN_FREE_KB} KB minimum."
  note "disk: ${free} KB free"
}

# pm2_table: "name status uptimeSeconds restarts" per process, reduced from
# `pm2 jlist` so no env, args or paths ever reach the log.
pm2_table() {
  pm2 jlist | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const i = s.indexOf("[");
      const list = JSON.parse(i >= 0 ? s.slice(i) : "[]");
      for (const p of list) {
        const e = p.pm2_env || {};
        const up = e.pm_uptime ? Math.max(0, Math.floor((Date.now() - e.pm_uptime) / 1000)) : 0;
        console.log([p.name, e.status, up, e.restart_time || 0].join(" "));
      }
    });'
}

pm2_status_of() { pm2_table | awk -v n="$1" '$1==n {print $2}'; }
pm2_restarts_of() { pm2_table | awk -v n="$1" '$1==n {print $4}'; }

check_pm2_online() {
  local table n line state
  table="$(pm2_table)" || fail "pm2 jlist failed."
  for n in "$PM2_BACKEND" "$PM2_STOREFRONT" "$PM2_ADMIN"; do
    line="$(awk -v n="$n" '$1==n {print "pm2: " $1 " " $2 " uptime=" $3 "s restarts=" $4}' <<< "$table")"
    [ -n "$line" ] || fail "pm2 process '$n' not found."
    echo "$line"
    state="$(awk -v n="$n" '$1==n {print $2}' <<< "$table")"
    [ "$state" = "online" ] || refuse "pm2 process '$n' is not online; fix that before deploying."
  done
}

# ---- database -------------------------------------------------------------------

# Percent-decoding only. A '+' stays a '+' (this is a password, not a form
# field), and existing backslashes are escaped first so printf %b cannot
# interpret them.
urldecode() {
  local encoded="${1//\\/\\\\}"
  printf '%b' "${encoded//%/\\x}"
}

# Reads ONLY the DATABASE_URL line of backend/.env straight into variables; the
# file is never echoed and the value never printed. Parsing is deliberately
# robust: the query string is dropped first (it may contain '/'), the userinfo
# is everything up to the LAST '@' (a raw '@' in a password stays in it), the
# database name is the first path segment. Passwords should still be
# percent-encoded per CLAUDE.md.
load_db_config() {
  local envfile="$APP_DIR/backend/.env" line url userinfo rest hostport
  [ -f "$envfile" ] || fail "$envfile not found."
  line="$(grep -m1 '^DATABASE_URL=' "$envfile" || true)"
  [ -n "$line" ] || fail "DATABASE_URL not set in $envfile."
  url="${line#DATABASE_URL=}"
  url="${url%\"}"; url="${url#\"}"; url="${url%\'}"; url="${url#\'}"
  url="${url#mysql://}"
  url="${url%%\?*}"
  case "$url" in *@*) ;; *) fail "DATABASE_URL has no credentials (user:password@host)." ;; esac
  userinfo="${url%@*}"
  rest="${url##*@}"
  case "$rest" in */*) ;; *) fail "DATABASE_URL has no database name." ;; esac
  hostport="${rest%%/*}"
  DB_NAME="${rest#*/}"
  DB_NAME="${DB_NAME%%/*}"
  DB_USER="$(urldecode "${userinfo%%:*}")"
  DB_PASSWORD="$(urldecode "${userinfo#*:}")"
  DB_HOST="${hostport%%:*}"
  DB_PORT="${hostport#*:}"
  [ "$DB_PORT" != "$DB_HOST" ] || DB_PORT=3306
  if [ -z "$DB_USER" ] || [ -z "$DB_HOST" ] || [ -z "$DB_NAME" ]; then fail "DATABASE_URL could not be parsed."; fi
  # Normalised (query-free) URL for the child scripts that parse a URL themselves.
  # shellcheck disable=SC2034  # read by deploy.sh
  DB_URL_BASE="mysql://${userinfo}@${hostport}"
  # shellcheck disable=SC2034  # read by deploy.sh
  DATABASE_URL_VALUE="${DB_URL_BASE}/${DB_NAME}"
}

# db_query_in <database> <sql>: read-only helper (callers only pass SELECT or the
# scratch-database DDL). Password via MYSQL_PWD, never argv.
db_query_in() {
  MYSQL_PWD="$DB_PASSWORD" mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
    --batch --skip-column-names "$1" -e "$2"
}
db_query() { db_query_in "$DB_NAME" "$1"; }

# ---- git ----------------------------------------------------------------------------

check_clean_tree() {
  local dirty
  dirty="$(git -C "$APP_DIR" status --porcelain)"
  if [ -n "$dirty" ]; then
    printf '%s\n' "$dirty" | sed -n '1,20p' >&2
    refuse "working tree at $APP_DIR is not clean (uncommitted or untracked files, see above). Hotfixes and merchant uploads have been found here before: resolve them by hand."
  fi
  note "working tree: clean"
}

# ---- builds -----------------------------------------------------------------------------

build_backend() {
  ( cd "$APP_DIR/backend" && npm ci )
}

assert_backend_dist() {
  if [ ! -f "$APP_DIR/backend/dist/main.js" ]; then
    echo "backend/dist/main.js missing after build; wiping dist and rebuilding once (CLAUDE.md stale-cache gotcha)."
    rm -rf "$APP_DIR/backend/dist"
    ( cd "$APP_DIR/backend" && npm run build )
  fi
  [ -f "$APP_DIR/backend/dist/main.js" ] || fail "backend/dist/main.js still missing after rebuild."
  note "backend dist/main.js: present"
}

assert_storefront_rewrite() {
  local manifest="$APP_DIR/storefront/.next/routes-manifest.json" want="http://127.0.0.1:$PORT_BACKEND/:path*"
  [ -f "$manifest" ] || fail "$manifest missing after storefront build."
  WANT="$want" node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const hit = (v) => typeof v === "string" ? v === process.env.WANT
      : v && typeof v === "object" ? Object.values(v).some(hit) : false;
    process.exit(hit(m.rewrites) ? 0 : 1);' "$manifest" \
    || fail "storefront routes-manifest does not rewrite /api to $want (INTERNAL_API_URL not baked in)."
  note "storefront routes-manifest rewrite: $want"
}

build_storefront() {
  ( cd "$APP_DIR/storefront" && npm ci && INTERNAL_API_URL="http://127.0.0.1:$PORT_BACKEND" npm run build )
  assert_storefront_rewrite
}

build_admin() {
  ( cd "$APP_DIR/admin" && npm ci && npm run build )
}

# ---- restart + health -------------------------------------------------------------------------

http_code() {
  # http_code <url> [curl args...]; prints 000 on transport failure.
  local url="$1"; shift
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" "$url" 2>/dev/null || true
}

wait_online() {
  local name="$1" waited=0 st
  while :; do
    st="$(pm2_status_of "$name")"
    [ "$st" = "online" ] && break
    waited=$((waited + POLL_INTERVAL))
    [ "$waited" -le "$HEALTH_TIMEOUT" ] || fail "$name did not come online within ${HEALTH_TIMEOUT}s (status '${st:-unknown}')."
    sleep "$POLL_INTERVAL"
  done
  # Stable: the restart counter must not climb while we wait (crash loop).
  local r1 r2
  r1="$(pm2_restarts_of "$name")"
  sleep "$STABLE_WAIT"
  r2="$(pm2_restarts_of "$name")"
  [ "$r1" = "$r2" ] || fail "$name is crash-looping (restart count $r1 -> $r2)."
  note "$name: online, restart count stable at $r2"
}

wait_http() {
  # wait_http <label> <url> <ok-predicate: ready200|ok200to399> [curl args...]
  local label="$1" url="$2" mode="$3"; shift 3
  local waited=0 code
  while :; do
    code="$(http_code "$url" "$@")"
    case "$mode" in
      ready200) [ "$code" = "200" ] && break ;;
      ok200to399) case "$code" in 2[0-9][0-9]|3[0-9][0-9]) break ;; esac ;;
    esac
    waited=$((waited + POLL_INTERVAL))
    [ "$waited" -le "$HEALTH_TIMEOUT" ] || fail "$label health check failed (last HTTP $code) after ${HEALTH_TIMEOUT}s."
    sleep "$POLL_INTERVAL"
  done
  note "$label: HTTP $code"
}

restart_one() {
  local name="$1"
  note "pm2 restart $name"
  pm2 restart "$name"
  wait_online "$name"
  case "$name" in
    "$PM2_BACKEND") wait_http backend "http://127.0.0.1:$PORT_BACKEND/health/ready" ready200 ;;
    "$PM2_STOREFRONT") wait_http storefront "http://127.0.0.1:$PORT_STOREFRONT/" ok200to399 -H "Host: ${SMOKE_SLUG}.requital.io" ;;
    "$PM2_ADMIN") wait_http admin "http://127.0.0.1:$PORT_ADMIN/" ok200to399 ;;
  esac
}

resolve_smoke_slug() {
  SMOKE_SLUG="${SMOKE_SHOP_SLUG:-}"
  if [ -z "$SMOKE_SLUG" ]; then
    SMOKE_SLUG="$(db_query 'SELECT subdomain FROM shop WHERE id=1' | sed -n '1p')"
  fi
  case "$SMOKE_SLUG" in
    ''|*[!a-z0-9-]*)
      fail "cannot pick a shop for the smoke test (got '${SMOKE_SLUG}'). By default shop id 1 is used; if it was deleted, renamed to something unusual or is suspended, set SMOKE_SHOP_SLUG=<subdomain of a live, published shop> in the environment of this run (for the workflow path: export it in /home/deploy/.profile or the deploy user's environment) and run again." ;;
  esac
}

smoke_redirect_map() {
  local headers
  headers="$(curl -s -D - -o /dev/null --max-time 10 "http://127.0.0.1:$PORT_BACKEND/public/$SMOKE_SLUG/redirects/map" || true)"
  # No pipelines here: an early-exiting reader under pipefail would turn a
  # large header block into a spurious failure (SIGPIPE, status 141).
  local first="${headers%%$'\n'*}"
  case "$first" in *" 200"*) ;; *) fail "redirect-map smoke: expected HTTP 200 for /public/$SMOKE_SLUG/redirects/map." ;; esac
  grep -qi '^etag:' <<< "$headers" || fail "redirect-map smoke: no ETag header."
  note "redirect map: 200 with ETag"
}

# snapshot_logs <name> <file> / scan_logs <name> <baseline-file>
snapshot_logs() { pm2 logs "$1" --nostream --lines 50 > "$2" 2>&1 || true; }
scan_logs() {
  local name="$1" baseline="$2" now fresh errs
  now="$WORK_DIR/logs-now-$name"
  pm2 logs "$name" --nostream --lines 50 > "$now" 2>&1 || true
  # Only lines that were not already in the pre-restart snapshot count: the log
  # holds a benign stale "Cannot find module" entry from before dist/ existed.
  fresh="$(grep -vxFf "$baseline" "$now" || true)"
  rm -f "$now"
  if grep -q 'Cannot find module' <<< "$fresh"; then
    fail "$name log shows 'Cannot find module' after restart."
  fi
  errs="$(grep -ci 'error' <<< "$fresh" || true)"
  note "$name: $errs new log line(s) mentioning 'error' (content not printed)"
}

check_backup_log() {
  local tailtext=""
  [ ! -f "$BACKUP_DIR/backup.log" ] || tailtext="$(tail -n 20 "$BACKUP_DIR/backup.log")"
  case "$tailtext" in
    *FAILED:*) echo "WARNING: backup.log tail contains FAILED: (not caused by this deploy; investigate separately)." ;;
    *) note "backup.log: no recent FAILED:" ;;
  esac
}

# ---- env fingerprints ----------------------------------------------------------------------------------

ENV_FILES=("backend/.env" "admin/.env.local" "storefront/.env.local")
env_fingerprints() {
  local f
  for f in "${ENV_FILES[@]}"; do
    if [ -f "$APP_DIR/$f" ]; then
      echo "$f $(md5sum < "$APP_DIR/$f" | cut -c1-8)"
    else
      echo "$f absent"
    fi
  done
}
