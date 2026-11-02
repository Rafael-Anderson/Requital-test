#!/usr/bin/env bash
# Deploys one specific commit (the PIN) of the Requital monorepo on the VPS, with
# hard gates and a backup drill before anything is changed. Runs on the VPS as
# the `deploy` user, normally via tools/deploy/ssh-entry.sh (the forced command
# of the GitHub Actions deploy key). It is also a valid manual entry point.
#
# Usage:
#   deploy.sh <40-hex PIN> [--dry-run] [--ci-verified]
#
#   --dry-run      run every read-only gate, print "WOULD DO:" for the rest, write
#                  the dry-run marker, exit 0 with "DRYRUN OK". Changes nothing
#                  but the log file and the marker.
#   --ci-verified  the caller (the workflow's gate job) has verified that the five
#                  required CI checks passed on the PIN. This host holds no GitHub
#                  token and never calls the GitHub API, so a REAL run refuses
#                  without it. A dry-run without it continues and says so.
#
# Config (env, defaults are production; see lib/common.sh): APP_DIR, LOG_DIR,
# LOCK_FILE, BACKUP_DIR, PM2_BACKEND, PM2_ADMIN, PM2_STOREFRONT, SMOKE_SHOP_SLUG,
# DEPLOY_USER_EXPECTED, DRILL_DB_NAME, MIN_FREE_KB, HEALTH_TIMEOUT, STABLE_WAIT.
#
# Mechanical guard: a real run is refused unless a successful dry-run of the SAME
# PIN wrote $LOG_DIR/dryrun-ok-<PIN> within the last 24 hours. The marker is
# consumed (deleted) when a real run starts, so each real attempt needs a fresh
# dry-run.
#
# Exit codes: 0 ok, 1 failure after the run started, 2 refused by a gate (nothing
# changed), 3 another deploy holds the lock. The last output line is
# DEPLOY_RESULT=OK | FAILED step=<n> | REFUSED (dry-run: DRYRUN OK).
#
# Steps: 1 preflight, 2 clean tree, 3 git gates, 4 CI + dry-run marker gates,
# 5 plan, [dry-run stops] 6 backup + restore drill, 7 BEFORE row hashes, 8 ff-only
# merge, 9 backend build/migrate/AFTER row hashes, 10 storefront + admin builds,
# 11 restarts + health, 12 smoke + log scan, 13 env fingerprints, 14 report.
# All builds finish before ANY restart; an unexplained change to a protected row
# stops the run before any restart (see "row hashes" below for what is tolerated).
#
# $LOG_DIR/deployed-shas (append-only, idempotent) records the commit that is running
# BEFORE the merge of step 8 ("previous") and the PIN after DEPLOY_RESULT=OK
# ("deploy"); rollback.sh only accepts commits listed there, so the rollback hint
# printed by a deploy that failed after step 8 is always usable.
#
# $LOG_DIR/run-state (append-only) records how every REAL run ended:
#   <utc> <PIN> REAL <OK|FAILED> step=<n> prev=<commit that was running before>
# It is what lets a re-run of the SAME PIN (HEAD == PIN) tell "already deployed"
# (last real run OK) from "merged but failed" (last real run FAILED). RESUME mode:
# only when that run failed at step 10 or later (the migrations ran and the data
# gates of step 9 had PASSED; what is left is builds, restarts, smoke), no migration
# is pending and backend/dist/main.js exists. A run that failed at step 9 or earlier
# is never resumed (its data gate may be the very thing that failed): deploy a newer
# commit or use rollback.sh. A resume still needs a fresh dry-run of the PIN.
#
# See docs/runbook.md ("Deploy via GitHub Actions" and "Backup").

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/validate-sha.sh
. "$SELF_DIR/lib/validate-sha.sh"

# ---- arguments (validated before anything else happens) --------------------------
PIN="$(validate_sha "${1-}")" || { echo "Usage: $0 <40-hex PIN> [--dry-run] [--ci-verified]" >&2; exit 2; }
shift
DRY_RUN=0
CI_VERIFIED=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --ci-verified) CI_VERIFIED=1 ;;
    *) echo "Error: unknown argument. Usage: $0 <40-hex PIN> [--dry-run] [--ci-verified]" >&2; exit 2 ;;
  esac
done

# ---- self-protection: run from a temp copy ---------------------------------------
# bash reads a script incrementally and `git merge` below replaces this very
# file, so the running copy must not be the one in the work tree.
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  DEPLOY_TMP_DIR="$(mktemp -d)"
  mkdir -p "$DEPLOY_TMP_DIR/lib"
  cp "$SELF_DIR/deploy.sh" "$DEPLOY_TMP_DIR/deploy.sh"
  cp "$SELF_DIR"/lib/* "$DEPLOY_TMP_DIR/lib/"
  chmod 700 "$DEPLOY_TMP_DIR/deploy.sh"
  export DEPLOY_TMP_DIR DEPLOY_REEXEC=1
  reexec_args=("$PIN")
  if [ "$DRY_RUN" = 1 ]; then reexec_args+=(--dry-run); fi
  if [ "$CI_VERIFIED" = 1 ]; then reexec_args+=(--ci-verified); fi
  exec "$DEPLOY_TMP_DIR/deploy.sh" "${reexec_args[@]}"
fi

# shellcheck source=lib/redact.sh
. "$SELF_DIR/lib/redact.sh"
# shellcheck source=lib/common.sh
. "$SELF_DIR/lib/common.sh"

trap '' HUP
trap on_exit_common EXIT

make_workdir
acquire_lock
setup_logging deploy "$PIN"
DEPLOYED_FILE="$LOG_DIR/deployed-shas"
STATE_FILE="$LOG_DIR/run-state"
# record_run_state <OK|FAILED>: one line per REAL run, private mode, never fatal.
record_run_state() {
  (
    umask 077
    mkdir -p "$LOG_DIR"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $PIN REAL $1 step=$CURRENT_STEP prev=${STATE_PREV:-$PROD}" >> "$STATE_FILE"
  ) || echo "WARNING: could not append to $STATE_FILE." >&2
}
# last_real_state: the last REAL-run line for this PIN, or nothing.
last_real_state() {
  [ -f "$STATE_FILE" ] || return 0
  awk -v pin="$PIN" '$2 == pin && $3 == "REAL" { line = $0 } END { if (line != "") print line }' "$STATE_FILE"
}
RUN_FINISHED_OK=0
# Runs on every exit of a REAL run (after the dry-run marker was consumed): removes
# the temporary matrix script and records a run that did not reach DEPLOY_RESULT=OK.
real_run_exit() {
  cleanup_matrix
  if [ "$RUN_FINISHED_OK" != 1 ]; then record_run_state FAILED; fi
}
# record_deployed <sha> <how>: append-only and idempotent (no duplicate lines),
# private mode. Returns non-zero when the file cannot be written.
record_deployed() {
  (
    umask 077
    mkdir -p "$LOG_DIR"
    if [ -f "$DEPLOYED_FILE" ] && grep -q "^$1 " "$DEPLOYED_FILE"; then exit 0; fi
    echo "$1 $(date -u +%Y-%m-%dT%H:%M:%SZ) $2" >> "$DEPLOYED_FILE"
  )
}
# Files created by builds and the merge keep the normal 022 mask; only the log
# and the marker are written under 077 (see setup_logging and the marker code).
umask 022

if [ "$DRY_RUN" = 1 ]; then MODE="DRY-RUN"; else MODE="REAL"; fi
echo "deploy.sh: PIN=$PIN mode=$MODE ci_verified=$CI_VERIFIED user=$(id -un) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ---- the protected-row sets (step 7 / 9) -----------------------------------------------
# name|bound column|columns hashed|flags. A migration that only adds things must
# leave these rows as they were. Flags: "u" = the table has a REAL updatedAt that
# the application bumps on every update; "p:<col>" = the row belongs to an order
# through <col>; "c" = a small number of legitimate changes or deletions is
# normal (customer merges), tolerated up to the same cap as edited orders.
# Columns are ones that cannot change after creation, or whose changes leave a
# trace. Columns that a merchant or a customer merge may legitimately rewrite
# without any trace are in CAPPED_SETS below. Columns come from
# backend/src/db/types.ts; workflow.test.js keeps them honest.
STRICT_SETS=(
  'order|id|id,shopId,shopOrderNumber,outletId,orderType,currency,exchangeRate,regionId|'
  'orderitem|id|id,orderId,productId,productName,variantId,priceAtPurchase,autoDiscountAmount|p:orderId'
  'paymenttransaction|id|id,orderId,gateway,gatewayReference,amount,currency|'
  'shop|id|id,subdomain|'
  'customer|id|id,shopId,createdAt|c'
  'giftcard|id|id,shopId,code,initialValue,purchaseOrderId|u'
  'stockmovement|id|id,shopId,productId,variantId,ingredientId,type,delta,outletId,toOutletId|'
  'orderstockconsumption|id|id,shopId,orderId,productId,variantId,ingredientId|p:orderId'
)
# The order money columns ARE protected, through a cap: an order whose money
# columns changed in the window was edited by the shop (updateItems /
# updateDeliveryFee), and that is what makes its replaced orderitem and
# orderstockconsumption rows legitimate. More than max(10, ~1% of the orders)
# edited in one window is not a shop trading: it is fatal (see lib/row-diff.js).
ORDER_MONEY_SET='order|id|id,total,taxAmount,deliveryFee,discountAmount,giftCardAmount,storeCreditAmount|'
# Columns a merchant (or a customer merge) can rewrite without leaving any trace:
# name|bound|columns|capMin,capPct%. A few changed rows are normal; more than
# max(capMin, capPct% of the rows) is not a shop trading, it is fatal. Shops change
# their currency/timezone/domain/country rarely (cap 2); a customer merge rewrites
# every order and gift card of the merged customer (cap max(100, 5%)).
CAPPED_SETS=(
  'shop|id|id,currency,timezone,domainType,countryCode|2,0'
  'order|id|id,customerId|100,5'
  'giftcard|id|id,purchasedByCustomerId|100,5'
)
# Printed for the operator (count + XOR of per-row MD5) before and after, never fatal.
INFO_SETS=(
  'order|id|id,status,paymentStatus'
  'giftcard|id|id,remainingBalance,status'
  'outletingredientstock||outletId,ingredientId,stockQuantity'
)

# DUMP_SPECS: "<file name>|<table>|<bound>|<columns>|<flags>", one per per-row dump.
DUMP_SPECS=()
for spec in "${STRICT_SETS[@]}"; do
  IFS='|' read -r t_ b_ c_ f_ <<< "$spec"
  DUMP_SPECS+=("$t_|$t_|$b_|$c_|$f_")
done
IFS='|' read -r t_ b_ c_ f_ <<< "$ORDER_MONEY_SET"
DUMP_SPECS+=("ordermoney|$t_|$b_|$c_|$f_")
capped_i=0
for spec in "${CAPPED_SETS[@]}"; do
  IFS='|' read -r t_ b_ c_ _ <<< "$spec"
  DUMP_SPECS+=("capped-$capped_i|$t_|$b_|$c_|")
  capped_i=$((capped_i + 1))
done

declare -A MAXID=()
declare -A TOTAL_COUNT=()

# cols_expr <comma separated columns> -> the IFNULL(CAST(..)) list for CONCAT_WS
cols_expr() {
  local cols="$1" expr="" c
  local -a arr
  IFS=',' read -r -a arr <<< "$cols"
  for c in "${arr[@]}"; do
    expr="${expr:+$expr, }IFNULL(CAST(\`$c\` AS CHAR), '~NULL~')"
  done
  printf '%s' "$expr"
}

checksum_sql() {
  # checksum_sql <table> <bound col> <cols> <maxId>
  local table="$1" bound="$2" cols="$3" max="$4" where=""
  if [ -n "$bound" ]; then where=" WHERE \`$bound\` <= $max"; fi
  echo "SELECT COUNT(*), IFNULL(BIT_XOR(CAST(CONV(SUBSTRING(MD5(CONCAT_WS('|', $(cols_expr "$cols"))), 1, 16), 16, 10) AS UNSIGNED)), 0) FROM \`$table\`$where"
}

row_sql() {
  # row_sql <table> <bound col> <cols> <flags> <maxId> [limit]
  local table="$1" bound="$2" cols="$3" flags="$4" max="$5" limit="${6:-}" extra=""
  case ",$flags," in *,u,*) extra="$extra, CAST(\`updatedAt\` AS CHAR)" ;; esac
  case ",$flags," in *,p:*) extra="$extra, \`${flags#*p:}\`" ;; esac
  echo "SELECT \`$bound\`, MD5(CONCAT_WS('|', $(cols_expr "$cols")))$extra FROM \`$table\` WHERE \`$bound\` <= $max ORDER BY \`$bound\`${limit:+ LIMIT $limit}"
}

capture_max_ids() {
  local spec table bound m
  for spec in "${STRICT_SETS[@]}" "$ORDER_MONEY_SET" "${CAPPED_SETS[@]}" "${INFO_SETS[@]}"; do
    IFS='|' read -r table bound _ <<< "$spec"
    [ -n "$bound" ] || continue
    [ -z "${MAXID[$table]:-}" ] || continue
    m="$(db_query "SELECT IFNULL(MAX(\`$bound\`), 0) FROM \`$table\`")"
    case "$m" in ''|*[!0-9]*) fail "could not read MAX($bound) of $table." ;; esac
    MAXID[$table]="$m"
  done
}

# run_totals <strict|info> <label>: COUNT + BIT_XOR lines, informational.
run_totals() {
  local kind="$1" label="$2" spec table bound cols out
  local -a specs
  if [ "$kind" = strict ]; then specs=("${STRICT_SETS[@]}"); else specs=("${INFO_SETS[@]}"); fi
  for spec in "${specs[@]}"; do
    IFS='|' read -r table bound cols _ <<< "$spec"
    out="$(db_query "$(checksum_sql "$table" "$bound" "$cols" "${MAXID[$table]:-0}")")"
    [ -n "$out" ] || fail "empty checksum result for $table."
    echo "  $label $table: ${out//$'\t'/ }"
    if [ "$kind" = strict ] && [ "$label" = before ]; then TOTAL_COUNT[$table]="${out%%$'\t'*}"; fi
  done
}

# dump_rows <before|after>: one tsv per protected table in $WORK_DIR. At BEFORE,
# each dump must hold exactly as many rows as the bounded COUNT(*) printed by
# run_totals, and never zero rows for a table whose MAX(id) is above zero (a dump
# that silently came back empty would make the comparison vacuously "equal").
dump_rows() {
  local phase="$1" ds name table bound cols flags rows expected
  for ds in "${DUMP_SPECS[@]}"; do
    IFS='|' read -r name table bound cols flags <<< "$ds"
    db_query "$(row_sql "$table" "$bound" "$cols" "$flags" "${MAXID[$table]:-0}")" > "$WORK_DIR/rows-$name-$phase.tsv" \
      || fail "could not read the protected rows of $table."
    if [ "$phase" = before ]; then
      rows="$(grep -c '' "$WORK_DIR/rows-$name-$phase.tsv" || true)"
      expected="${TOTAL_COUNT[$table]:-}"
      if [ "${MAXID[$table]:-0}" -gt 0 ] && [ "$rows" -eq 0 ]; then
        fail "the protected-row dump of $table ($name) is empty although MAX($bound) is ${MAXID[$table]} (refusing a vacuous comparison)."
      fi
      if [ -n "$expected" ] && [ "$rows" != "$expected" ]; then
        fail "the protected-row dump of $table ($name) has $rows row(s) but COUNT(*) says $expected (the table changed under us or the dump is truncated)."
      fi
    fi
  done
}

# Dry-run only: every protected-row query once with LIMIT 1, read-only, so a bad
# column name fails the dry-run instead of the real run's step 7.
validate_row_queries() {
  local ds name table bound cols flags
  capture_max_ids
  for ds in "${DUMP_SPECS[@]}"; do
    IFS='|' read -r name table bound cols flags <<< "$ds"
    db_query "$(row_sql "$table" "$bound" "$cols" "$flags" "${MAXID[$table]:-0}" 1)" > /dev/null \
      || fail "the protected-row query for $table ($name) is invalid against this database (a column may be missing); fix deploy.sh or the schema before a real run."
  done
  note "protected-row queries: valid (${#STRICT_SETS[@]} strict tables, the order money columns, ${#CAPPED_SETS[@]} capped sets)"
}

# compare_rows: fatal for changes with no sign of a normal application edit, and
# for more edited orders than a shop trading could produce.
compare_rows() {
  local spec table flags args out bad=0 tolerated_total=0 t
  local summary changed cap
  if node "$SELF_DIR/lib/row-diff.js" touched "$WORK_DIR/rows-ordermoney-before.tsv" "$WORK_DIR/rows-ordermoney-after.tsv" > "$WORK_DIR/touched-orders.txt" 2> "$WORK_DIR/touched.err"; then
    :
  else
    echo "ORDER EDIT CAP EXCEEDED: $(cat "$WORK_DIR/touched.err") (a damaging migration touches many orders, a shop a handful)" >&2
    bad=1
  fi
  summary="$(cat "$WORK_DIR/touched.err")"
  changed="${summary#*changed=}"; changed="${changed%% *}"
  cap="${summary#*cap=}"
  echo "  orders edited during the window (money columns changed): $changed (cap $cap)"
  for spec in "${STRICT_SETS[@]}"; do
    IFS='|' read -r table _ _ flags <<< "$spec"
    args=()
    case ",$flags," in *,u,*) args+=(--updated) ;; esac
    case ",$flags," in *,c,*) args+=(--capped) ;; esac
    case ",$flags," in *,p:*) args+=(--parent --touched "$WORK_DIR/touched-orders.txt") ;; esac
    if out="$(node "$SELF_DIR/lib/row-diff.js" compare "$WORK_DIR/rows-$table-before.tsv" "$WORK_DIR/rows-$table-after.tsv" "${args[@]}")"; then
      echo "  rows $table: $out"
    else
      echo "ROW CHECK FAILED $table: ${out//$'\n'/ }" >&2
      bad=1
    fi
    t="${out#*tolerated=}"; t="${t%% *}"
    case "$t" in ''|*[!0-9]*) ;; *) tolerated_total=$((tolerated_total + t)) ;; esac
  done
  local i=0 cap capmin cappct
  for spec in "${CAPPED_SETS[@]}"; do
    IFS='|' read -r table _ _ cap <<< "$spec"
    capmin="${cap%%,*}"; cappct="${cap##*,}"
    if out="$(node "$SELF_DIR/lib/row-diff.js" compare "$WORK_DIR/rows-capped-$i-before.tsv" "$WORK_DIR/rows-capped-$i-after.tsv" --capped --cap-min "$capmin" --cap-pct "$cappct")"; then
      echo "  rows $table (capped set $i, cap max($capmin, ${cappct}%)): $out"
    else
      echo "ROW CHECK FAILED $table (capped set $i, cap max($capmin, ${cappct}%)): ${out//$'\n'/ }" >&2
      bad=1
    fi
    t="${out#*tolerated=}"; t="${t%% *}"
    case "$t" in ''|*[!0-9]*) ;; *) tolerated_total=$((tolerated_total + t)) ;; esac
    i=$((i + 1))
  done
  echo "  tolerated (normal application edits during the window): $tolerated_total row(s)"
  return "$bad"
}

# ---- billing flag matrix (PIN's own copy, run from an untracked temp name) -----------
MATRIX_TMP=""
MATRIX_BEFORE=""
cleanup_matrix() { [ -z "$MATRIX_TMP" ] || rm -f "$MATRIX_TMP"; }

run_matrix() {
  ( cd "$APP_DIR/backend" && npx --no-install ts-node -r tsconfig-paths/register "scripts/$(basename "$MATRIX_TMP")" )
}

# print the strict subset of the matrix JSON (.matrix .shop .shopfeatureoverride
# .shopSuspension). lib/matrix-diff.js compares two of these (per-shop key
# INTERSECTION, new keys must be false), never the whole document: BEFORE runs the
# old FeaturesService and AFTER the new one, so a PIN that adds a feature key
# changes the document's shape by design.
matrix_strict_view() {
  node -e '
    const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
    console.log(JSON.stringify({ matrix: j.matrix, shop: j.shop, shopfeatureoverride: j.shopfeatureoverride, shopSuspension: j.shopSuspension === undefined ? null : j.shopSuspension }));'
}

# compare_matrix: BEFORE (in $MATRIX_BEFORE) against AFTER (in $MATRIX_AFTER). On any
# problem BOTH documents are written to the log directory (private mode) and the exact
# differences (shop id, key, before, after) are printed BEFORE the run stops.
compare_matrix() {
  local stamp base
  printf '%s\n' "$MATRIX_BEFORE" > "$WORK_DIR/matrix-before.json"
  printf '%s\n' "$MATRIX_AFTER" > "$WORK_DIR/matrix-after.json"
  if node "$SELF_DIR/lib/matrix-diff.js" "$WORK_DIR/matrix-before.json" "$WORK_DIR/matrix-after.json" > "$WORK_DIR/matrix-diff.out"; then
    cat "$WORK_DIR/matrix-diff.out"
    return 0
  fi
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  base="$LOG_DIR/matrix-$stamp-${PIN:0:7}"
  ( umask 077; cp "$WORK_DIR/matrix-before.json" "$base-before.json"; cp "$WORK_DIR/matrix-after.json" "$base-after.json" )
  cat "$WORK_DIR/matrix-diff.out"
  echo "both matrices were written to $base-before.json and $base-after.json" >&2
  return 1
}

# ===========================================================================================
step 1 "preflight"
check_user
require_cmds git node npm pm2 mysql mysqldump gzip flock curl md5sum
check_disk
load_db_config
check_pm2_online
[ "$(db_query 'SELECT 1')" = "1" ] || fail "database not reachable."
note "database: reachable (read-only SELECT 1)"

step 2 "working tree is clean"
check_clean_tree

step 3 "git gates"
git -C "$APP_DIR" fetch --quiet origin main
git -C "$APP_DIR" cat-file -e "${PIN}^{commit}" 2>/dev/null || refuse "PIN $PIN is not a commit this repository knows (after fetch)."
git -C "$APP_DIR" merge-base --is-ancestor "$PIN" origin/main || refuse "PIN $PIN is not an ancestor of origin/main. Only commits on main can be deployed."
BRANCH="$(git -C "$APP_DIR" symbolic-ref --short -q HEAD || true)"
[ "$BRANCH" = "main" ] || refuse "the checkout is on '${BRANCH:-detached HEAD}', not main."
PROD="$(git -C "$APP_DIR" rev-parse HEAD)"
note "production HEAD: $PROD"
RESUME=0
STATE_PREV=""
if [ "$PROD" = "$PIN" ]; then
  last_state="$(last_real_state)"
  case "$last_state" in
    *" REAL FAILED "*)
      failed_step="$(echo "$last_state" | sed -n 's/.* step=\([0-9][0-9]*\) .*/\1/p')"
      STATE_PREV="$(echo "$last_state" | sed -n 's/.* prev=\([0-9a-f]\{40\}\)$/\1/p')"
      echo "HEAD already equals the PIN, but the last real run for it FAILED at step ${failed_step:-?}: $last_state"
      if [ -z "$failed_step" ] || [ "$failed_step" -lt 10 ] || [ -z "$STATE_PREV" ]; then
        refuse "HEAD == PIN after a run that failed at step ${failed_step:-?} (before or inside the data gates): it is not resumed, because the gate that stopped it may be what failed. Fix forward with a NEWER commit (the gates re-run against the already-migrated database), or run rollback.sh to the previous commit (${STATE_PREV:-unknown}). Nothing was changed."
      fi
      git -C "$APP_DIR" merge-base --is-ancestor "$STATE_PREV" "$PIN" || refuse "recorded previous commit $STATE_PREV is not an ancestor of the PIN; not resuming."
      RESUME=1
      PROD="$STATE_PREV"
      note "RESUME mode: migrations and data gates passed in the failed run; this run rebuilds, restarts and smoke-tests. previous commit: $PROD"
      ;;
    *)
      # the last real run for this PIN was OK, or nothing is recorded (a manual deploy)
      echo "PIN equals the commit already deployed: nothing to do."
      echo "ALREADY DEPLOYED"
      RESULT_LINE=no
      exit 0
      ;;
  esac
fi
git -C "$APP_DIR" merge-base --is-ancestor "$PROD" "$PIN" || refuse "production HEAD $PROD is not an ancestor of PIN (diverged or a rollback target). Use rollback.sh for going backwards."
ROLLBACK_HINT="Rollback (code only, no database restore): run the Deploy workflow with mode=rollback and sha=$PROD, or on the VPS: $APP_DIR/tools/deploy/rollback.sh $PROD"

step 4 "CI gate and dry-run marker"
if [ "$CI_VERIFIED" = 1 ]; then
  echo "CI gate: verified by the deploy workflow (--ci-verified); not re-checked on this host."
elif [ "$DRY_RUN" = 1 ]; then
  echo "CI gate: NOT VERIFIED here (a real run would refuse)"
else
  refuse "CI gate not verified: a real deploy requires --ci-verified (set by the workflow's gate job). This host holds no GitHub token."
fi
MARKER="$LOG_DIR/dryrun-ok-$PIN"
if [ "$DRY_RUN" = 1 ]; then
  echo "dry-run marker: will be written to $MARKER on success."
else
  if [ ! -f "$MARKER" ] || [ -L "$MARKER" ]; then refuse "no dry-run marker for this PIN. Run mode=dry-run for $PIN first (a real deploy needs a successful dry-run of the same commit within 24h)."; fi
  stamp="$(cat "$MARKER")"
  case "$stamp" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z) ;;
    *) refuse "dry-run marker is malformed; run the dry-run again." ;;
  esac
  marker_epoch="$(date -u -d "$stamp" +%s)" || refuse "dry-run marker timestamp is unreadable."
  age=$(( $(date -u +%s) - marker_epoch ))
  if [ "$age" -gt 86400 ] || [ "$age" -lt -300 ]; then
    refuse "dry-run marker is stale or from the future (age ${age}s, limit 86400s); run the dry-run again."
  fi
  note "dry-run marker: OK (age ${age}s)"
fi

step 5 "plan"
# The changed-file list can be huge (a vendor drop, a mass rename). Read it NUL
# separated into a file and walk it with a plain loop: no pipelines whose early
# exit (grep -q, head) could kill the writer under pipefail and silently report
# "app unchanged" (that bug class produced a false OK once, see deploy tests).
git -C "$APP_DIR" -c core.quotepath=off diff --name-only --no-renames -z "$PROD" "$PIN" > "$WORK_DIR/changed.z" \
  || fail "git diff failed."
BACKEND_CHANGED=0; ADMIN_CHANGED=0; STOREFRONT_CHANGED=0
CHANGED_COUNT=0
while IFS= read -r -d '' changed_path; do
  CHANGED_COUNT=$((CHANGED_COUNT + 1))
  case "$changed_path" in
    backend/*) BACKEND_CHANGED=1 ;;
    admin/*) ADMIN_CHANGED=1 ;;
    storefront/*) STOREFRONT_CHANGED=1 ;;
  esac
done < "$WORK_DIR/changed.z"
echo "files changed PROD..PIN: $CHANGED_COUNT"

APPLIED="$(db_query 'SELECT name FROM _migrations ORDER BY name' | sort)"
ON_DISK="$(git -C "$APP_DIR" ls-tree -d --name-only "$PIN" backend/prisma/migrations/ | sed 's#.*/##' | sort)"
PENDING="$(comm -23 <(echo "$ON_DISK") <(echo "$APPLIED") | grep . || true)"
LAST_APPLIED="$(echo "$APPLIED" | tail -1)"
if [ -n "$PENDING" ]; then
  BACKEND_CHANGED=1
  echo "pending migrations:"
  # shellcheck disable=SC2001
  echo "$PENDING" | sed 's/^/  /'
  while read -r m; do
    if [ -n "$LAST_APPLIED" ] && [[ "$m" < "$LAST_APPLIED" ]]; then
      echo "WARNING: pending migration $m sorts before the last applied ($LAST_APPLIED); the runner applies it anyway, by name."
    fi
  done <<< "$PENDING"
else
  echo "pending migrations: none"
fi
if [ "$RESUME" = 1 ]; then
  [ -z "$PENDING" ] || refuse "RESUME mode needs a fully migrated database, but migrations are pending (listed above). Not resuming; nothing was changed."
  [ -f "$APP_DIR/backend/dist/main.js" ] || refuse "RESUME mode needs backend/dist/main.js and it is missing. Not resuming; nothing was changed."
fi
MATRIX_REQUIRED=0
case $'\n'"$PENDING"$'\n' in *$'\n20261124100000_billing_plt1_tables\n'*) MATRIX_REQUIRED=1 ;; esac
MATRIX_AVAILABLE=0
git -C "$APP_DIR" cat-file -e "$PIN:backend/scripts/billing-flag-matrix.ts" 2>/dev/null && MATRIX_AVAILABLE=1
if [ "$MATRIX_REQUIRED" = 1 ] && [ "$MATRIX_AVAILABLE" = 0 ]; then
  refuse "billing migration is pending but the PIN has no backend/scripts/billing-flag-matrix.ts to prove it."
fi
echo "apps to rebuild: backend=$BACKEND_CHANGED storefront=$STOREFRONT_CHANGED admin=$ADMIN_CHANGED"
echo "billing flag matrix: required=$MATRIX_REQUIRED available=$MATRIX_AVAILABLE"
echo "env fingerprints (md5, 8 hex) BEFORE:"
ENV_BEFORE="$(env_fingerprints)"
# shellcheck disable=SC2001
echo "$ENV_BEFORE" | sed 's/^/  /'
resolve_smoke_slug
echo "smoke shop slug: $SMOKE_SLUG"

if [ "$DRY_RUN" = 1 ] && [ "$RESUME" = 1 ]; then
  echo
  echo "WOULD DO (RESUME): skip steps 6 to 9 (no backup, no merge, no migration, no data gates: the failed run passed them); step 10 rebuild storefront/admin as needed, step 11 restart in order, step 12 smoke, step 13 env fingerprints, step 14 report"
  mkdir -p "$LOG_DIR"
  ( umask 077; date -u +%Y-%m-%dT%H:%M:%SZ > "$MARKER" )
  echo "dry-run marker written: $MARKER (valid 24h)"
  RESULT_LINE=no
  echo "DRYRUN OK"
  exit 0
fi
if [ "$DRY_RUN" = 1 ]; then
  validate_row_queries
  echo
  echo "WOULD DO: step 6 backup via tools/backup-db.sh into $BACKUP_DIR, gzip -t, restore into a scratch database, require before <= restored <= after row counts"
  echo "WOULD DO: step 7 record BEFORE checksums (${#STRICT_SETS[@]} tables, COUNT + BIT_XOR of per-row MD5, bounded by captured max id)$([ "$MATRIX_AVAILABLE" = 1 ] && echo ' and the billing flag matrix')"
  echo "WOULD DO: step 8 git merge --ff-only $PIN (from $PROD)"
  [ "$BACKEND_CHANGED" = 0 ] || echo "WOULD DO: step 9 backend: npm ci, npm run db:migrate, npm run build, assert dist/main.js, AFTER checksums must equal BEFORE"
  [ "$STOREFRONT_CHANGED" = 0 ] || echo "WOULD DO: step 10 storefront: npm ci, INTERNAL_API_URL=http://127.0.0.1:$PORT_BACKEND npm run build, assert routes-manifest rewrite"
  [ "$ADMIN_CHANGED" = 0 ] || echo "WOULD DO: step 10 admin: npm ci, npm run build"
  echo "WOULD DO: step 11 pm2 restart (only rebuilt apps) in order backend, storefront, admin, with health waits"
  echo "WOULD DO: step 12 redirect-map smoke, pm2 log scan, backup.log check"
  echo "WOULD DO: step 13 compare .env fingerprints"
  echo "WOULD DO: step 14 print PREVIOUS_SHA=$PROD NEW_SHA=$PIN BACKUP_FILE DEPLOY_RESULT=OK"
  mkdir -p "$LOG_DIR"
  ( umask 077; date -u +%Y-%m-%dT%H:%M:%SZ > "$MARKER" )
  echo "dry-run marker written: $MARKER (valid 24h)"
  RESULT_LINE=no
  echo "DRYRUN OK"
  exit 0
fi

# ===== from here on this run changes things ======================================================
rm -f "$MARKER"   # consumed: one dry-run authorises one real attempt
EXIT_HOOK=real_run_exit

BACKUP_FILE="(none: resumed run)"
if [ "$RESUME" = 0 ]; then   # steps 6 to 9 are skipped in RESUME mode (not re-indented on purpose)

step 6 "backup and restore drill"
DRILL_DB="${DRILL_DB_NAME:-${DB_NAME}_drill}"
case "$DRILL_DB" in "$DB_NAME"|''|*[!A-Za-z0-9_]*) fail "unsafe drill database name '$DRILL_DB'." ;; esac
count_row() {
  # count_row <database> -> "shops orders products customers tables"
  db_query_in "$1" "SELECT (SELECT COUNT(*) FROM shop), (SELECT COUNT(*) FROM \`order\`), (SELECT COUNT(*) FROM product), (SELECT COUNT(*) FROM customer), (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE())" | tr '\t' ' '
}
mkdir -p "$BACKUP_DIR"
BEFORE_COUNTS="$(count_row "$DB_NAME")"
echo "live counts before dump (shop order product customer tables): $BEFORE_COUNTS"
backup_out="$(umask 077; DATABASE_URL="$DATABASE_URL_VALUE" "$APP_DIR/tools/backup-db.sh" "$BACKUP_DIR")"
BACKUP_FILE="$(echo "$backup_out" | sed -n 's/^Backup written to //p' | tail -1)"
if [ -z "$BACKUP_FILE" ] || [ ! -s "$BACKUP_FILE" ]; then fail "backup produced no file."; fi
gzip -t "$BACKUP_FILE" || fail "backup file failed gzip -t."
echo "backup: $BACKUP_FILE ($(wc -c < "$BACKUP_FILE") bytes), gzip -t OK"
db_query_in "$DB_NAME" "DROP DATABASE IF EXISTS \`$DRILL_DB\`"
RESTORE_DATABASE_URL="${DB_URL_BASE}/$DRILL_DB" "$APP_DIR/tools/restore-db.sh" "$BACKUP_FILE" > /dev/null
RESTORED_COUNTS="$(count_row "$DRILL_DB")"
AFTER_COUNTS="$(count_row "$DB_NAME")"
mig_live="$(db_query_in "$DB_NAME" 'SELECT name FROM _migrations ORDER BY name' | md5sum | cut -c1-8)"
mig_drill="$(db_query_in "$DRILL_DB" 'SELECT name FROM _migrations ORDER BY name' | md5sum | cut -c1-8)"
db_query_in "$DB_NAME" "DROP DATABASE IF EXISTS \`$DRILL_DB\`"
echo "drill counts: before=[$BEFORE_COUNTS] restored=[$RESTORED_COUNTS] after=[$AFTER_COUNTS]"
read -r b1 b2 b3 b4 b5 <<< "$BEFORE_COUNTS"
read -r r1 r2 r3 r4 r5 <<< "$RESTORED_COUNTS"
read -r a1 a2 a3 a4 _ <<< "$AFTER_COUNTS"
for pair in "$b1 $r1 $a1" "$b2 $r2 $a2" "$b3 $r3 $a3" "$b4 $r4 $a4"; do
  read -r lo mid hi <<< "$pair"
  if [ "$lo" -gt "$mid" ] || [ "$mid" -gt "$hi" ]; then
    fail "restore drill failed: row counts do not satisfy before <= restored <= after ($pair)."
  fi
done
[ "$b5" = "$r5" ] || fail "restore drill failed: table count differs (live $b5, restored $r5)."
[ "$mig_live" = "$mig_drill" ] || fail "restore drill failed: _migrations differ (live $mig_live, restored $mig_drill)."
echo "restore drill: OK"

step 7 "BEFORE row hashes"
capture_max_ids
echo "totals (count + XOR of per-row MD5, informational):"
run_totals strict before
echo "informational (mutable) sets:"
run_totals info before
dump_rows before
echo "per-row hashes recorded for ${#STRICT_SETS[@]} tables plus the order money columns"
if [ "$MATRIX_AVAILABLE" = 1 ]; then
  MATRIX_TMP="$APP_DIR/backend/scripts/zz-deploy-matrix-$$.ts"
  git -C "$APP_DIR" show "$PIN:backend/scripts/billing-flag-matrix.ts" > "$MATRIX_TMP"
  if MATRIX_BEFORE="$(run_matrix | matrix_strict_view)"; then
    echo "billing flag matrix BEFORE: recorded"
  elif [ "$MATRIX_REQUIRED" = 1 ]; then
    fail "billing flag matrix BEFORE failed and is required."
  else
    echo "WARNING: billing flag matrix BEFORE failed (not required); skipping the AFTER comparison."
    MATRIX_BEFORE=""
  fi
fi

step 8 "fast-forward merge"
# From the merge on, a failure prints a rollback hint to $PROD, and rollback.sh only
# accepts recorded commits: record it BEFORE anything changes (idempotent).
record_deployed "$PROD" previous || fail "cannot record the commit that is running now in $DEPLOYED_FILE, so a rollback would be refused. Fix that and run again (nothing has been merged yet)."
git -C "$APP_DIR" merge --ff-only "$PIN"
[ "$(git -C "$APP_DIR" rev-parse HEAD)" = "$PIN" ] || fail "HEAD is not the PIN after merge."
note "HEAD is now $PIN"

step 9 "backend: install, migrate, build, verify"
if [ "$BACKEND_CHANGED" = 1 ]; then
  build_backend
  mig_log="$WORK_DIR/migrate.log"
  ( cd "$APP_DIR/backend" && npm run db:migrate ) 2>&1 | tee "$mig_log"
  if grep -Eq 'Migration .* failed' "$mig_log"; then fail "a migration reported failure."; fi
  ( cd "$APP_DIR/backend" && npm run build )
  assert_backend_dist
else
  note "backend unchanged and no pending migrations: skipped"
fi
echo "totals AFTER (informational; rows may legitimately change while the shop trades):"
run_totals strict after
dump_rows after
run_totals info after
echo "row-level comparison:"
if ! compare_rows; then
  echo "STOP: protected rows changed with no sign of a normal application edit. NO process was restarted: the old code is still serving." >&2
  echo "The new code is merged on disk and the schema is migrated (additive); do not restart. Investigate, then use the rollback hint below if needed." >&2
  exit 1
fi
if [ -n "$MATRIX_BEFORE" ]; then
  MATRIX_AFTER="$(run_matrix | matrix_strict_view)" || fail "billing flag matrix AFTER failed."
  compare_matrix || { echo "STOP: billing flag matrix differs before/after the migrations. No restart performed." >&2; exit 1; }
  echo "billing flag matrix: identical before/after (shared keys; new keys all false)"
fi

fi   # end of the steps skipped in RESUME mode

step 10 "storefront and admin builds (all builds finish before any restart)"
[ "$STOREFRONT_CHANGED" = 0 ] || build_storefront
[ "$ADMIN_CHANGED" = 0 ] || build_admin
[ "$STOREFRONT_CHANGED" = 1 ] || note "storefront unchanged: skipped"
[ "$ADMIN_CHANGED" = 1 ] || note "admin unchanged: skipped"

step 11 "restart and health"
declare -A LOGBASE=()
for app in "$PM2_BACKEND" "$PM2_STOREFRONT" "$PM2_ADMIN"; do
  LOGBASE[$app]="$WORK_DIR/logbase-$app"
  snapshot_logs "$app" "${LOGBASE[$app]}"
done
RESTARTED=()
if [ "$BACKEND_CHANGED" = 1 ]; then restart_one "$PM2_BACKEND"; RESTARTED+=("$PM2_BACKEND"); fi
if [ "$STOREFRONT_CHANGED" = 1 ]; then restart_one "$PM2_STOREFRONT"; RESTARTED+=("$PM2_STOREFRONT"); fi
if [ "$ADMIN_CHANGED" = 1 ]; then restart_one "$PM2_ADMIN"; RESTARTED+=("$PM2_ADMIN"); fi

step 12 "smoke"
smoke_redirect_map
for app in "${RESTARTED[@]}"; do scan_logs "$app" "${LOGBASE[$app]}"; done
check_backup_log

step 13 ".env fingerprints"
ENV_AFTER="$(env_fingerprints)"
[ "$ENV_BEFORE" = "$ENV_AFTER" ] || fail ".env fingerprints changed during the deploy."
note "env fingerprints: unchanged"

step 14 "result"
# Record what is now running; rollback.sh accepts only recorded commits.
if ! { record_deployed "$PROD" previous && record_deployed "$PIN" deploy; }; then
  echo "WARNING: could not append to $DEPLOYED_FILE; rollback.sh will refuse these commits until they are recorded by hand."
fi
echo "PREVIOUS_SHA=$PROD"
echo "NEW_SHA=$PIN"
echo "BACKUP_FILE=$BACKUP_FILE"
echo "LOG_FILE=$LOG_FILE"
echo "$ROLLBACK_HINT"
echo "NOT automated: the authenticated testadmin smoke needs a temporary staff user on production; do it by hand with the owner's approval."
RESULT_LINE=no
CURRENT_STEP=14
record_run_state OK
RUN_FINISHED_OK=1
echo "DEPLOY_RESULT=OK"
