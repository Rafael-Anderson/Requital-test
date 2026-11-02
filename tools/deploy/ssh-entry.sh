#!/usr/bin/env bash
# The SSH forced command for the GitHub Actions deploy key. sshd runs this
# instead of whatever the client asked for and exposes the client's request only
# as $SSH_ORIGINAL_COMMAND. It is the whole attack surface of that key, so it is
# an allow-list: exactly one of
#
#   deploy <40-hex sha>[ --dry-run][ --ci-verified]
#   rollback <40-hex sha>
#   status
#
# Anything else (empty, a different verb, extra words, newlines, shell
# metacharacters, a wrong-length or non-hex SHA, flags in another order) is
# refused with exit 126 and nothing runs. The argv that is executed is REBUILT
# from regex captures; the raw string is never eval'd, expanded or passed to a
# shell. For deploy and rollback the sha must also be an ancestor of origin/main
# in the VPS checkout (checked here, after a fetch, before anything is extracted
# or run), so the key cannot be used to run a script from an unmerged commit.
#
# Install it OUTSIDE the git work tree, in a root-owned directory:
# /usr/local/sbin/requital-ssh-entry.sh (root:root 755), copied with `git show`
# (docs/runbook.md has the exact commands and the sha256 to compare). It is
# pinned in authorized_keys together with no-port-forwarding,no-agent-forwarding,
# no-pty,no-X11-forwarding,restrict. This constrains the holder of THIS key; it
# does not defend against a compromised `deploy` user, who owns the app and
# authorized_keys anyway. Whenever this file changes (its sha256 changes), it
# must be re-copied and the hash re-checked: deploy.sh and rollback.sh are taken
# from the commit being deployed / the checkout, only this file is bootstrapped.
#
# Runs detached (setsid) with its output captured to a file that this script
# tails, so a dropped SSH connection (SIGHUP, closed pipe) does not kill a
# half-finished deploy; the next `status` call shows how it ended.
#
# Config: none in production (paths are fixed). Tests set REQUITAL_ENTRY_TEST=1 and
# may then override APP_DIR, LOG_DIR and ENTRY_PATH.
# Exit codes: the script's own, 2 for a refused sha, 126 for a refused request.
#
# See docs/runbook.md ("Deploy via GitHub Actions").

set -euo pipefail
set +x
umask 077
# Nothing from the environment may change how bash, the dynamic loader or git
# behave (sshd passes no client environment by default; this is belt and braces).
# SHELLOPTS may be readonly when it was inherited, hence the || true.
unset SHELLOPTS BASHOPTS BASH_ENV ENV BASH_XTRACEFD PS4 LD_PRELOAD LD_LIBRARY_PATH \
  GIT_DIR GIT_WORK_TREE GIT_SSH_COMMAND GIT_EXEC_PATH 2>/dev/null || true
# Paths and PATH are FIXED. Only a test, which sets REQUITAL_ENTRY_TEST=1, may
# point APP_DIR/LOG_DIR/ENTRY_PATH elsewhere; sshd passes no client environment,
# but a stray variable in the deploy user's own environment must not be able to
# redirect a production entry script to another checkout. pm2, node and npm must
# be reachable from the fixed PATH (see the runbook; symlink them into
# /usr/local/bin if they live elsewhere).
if [ "${REQUITAL_ENTRY_TEST:-}" = 1 ]; then
  APP_DIR="${APP_DIR:-/home/deploy/requital}"
  LOG_DIR="${LOG_DIR:-/home/deploy/deploy-logs}"
  export PATH="${ENTRY_PATH:-/usr/local/bin:/usr/bin:/bin}"
else
  APP_DIR="/home/deploy/requital"
  LOG_DIR="/home/deploy/deploy-logs"
  export PATH="/usr/local/bin:/usr/bin:/bin"
fi
export LC_ALL=C

# ---- redaction (byte-identical copy of tools/deploy/lib/redact.sh; a test checks) ----
REDACT_SED="$(cat <<'REDACT_SED_EOF'
/-----BEGIN [A-Z ]*PRIVATE KEY-----.*-----END [A-Z ]*PRIVATE KEY-----/{s/-----BEGIN [A-Z ]*PRIVATE KEY-----.*-----END [A-Z ]*PRIVATE KEY-----/[REDACTED PRIVATE KEY]/;b}
/-----BEGIN [A-Z ]*PRIVATE KEY-----/,/-----END [A-Z ]*PRIVATE KEY-----/c\
[REDACTED PRIVATE KEY BLOCK]
s#([A-Za-z][A-Za-z0-9+.-]*://[^:/@[:space:]]*):[^[:space:]]*@#\1:***@#g
s#(curl[^|]*[[:space:]](-u|--user)[[:space:]=])[^[:space:]]+#\1***#I
s#(--user=)[^[:space:]]+#\1***#I
s#(authorization["']?[[:space:]]*[:=][[:space:]]*["']?)([A-Za-z]+[[:space:]]+)?[^[:space:]"']+#\1***#gI
s#(cookie[[:space:]]*:[[:space:]]*).*#\1***#I
s#(bearer)[[:space:]]+[A-Za-z0-9._~+/=-]+#\1 ***#gI
s#(token)[[:space:]]+[A-Za-z0-9._~+/=-]{10,}#\1 ***#gI
s#([A-Za-z0-9_]*(pwd|pass|secret|token|key|credential|auth)[A-Za-z0-9_]*["']?[[:space:]]*[=:][[:space:]]*)("[^"]*"|'[^']*'|[^[:space:]]+)#\1***#gI
REDACT_SED_EOF
)"
redact() {
  sed -u -E -e "$REDACT_SED"
}

deny() {
  echo "Error: command not allowed. Allowed: 'deploy <sha> [--dry-run] [--ci-verified]', 'rollback <sha>', 'status'." >&2
  exit 126
}

# Cleanup on every exit path (normal, error, SIGHUP/INT/TERM). It only removes
# what the ENTRY owns: the capture/status files, and the run directory until the
# run has started (after that the run owns and removes its own directory).
OUT=""
STATUS=""
RUN_DIR=""
RUN_DIR_OWNED=0
TAILPID=""
cleanup_entry() {
  if [ -n "$TAILPID" ]; then kill "$TAILPID" 2>/dev/null || true; fi
  if [ -n "$OUT" ]; then rm -f "$OUT"; fi
  if [ -n "$STATUS" ]; then rm -f "$STATUS" "$STATUS.tmp"; fi
  if [ "$RUN_DIR_OWNED" = 1 ] && [ -n "$RUN_DIR" ]; then rm -rf "$RUN_DIR"; fi
}
trap cleanup_entry EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

CMD="${SSH_ORIGINAL_COMMAND-}"
[ -n "$CMD" ] || deny
# Only letters, digits, space and '-' may appear at all. This alone excludes
# newlines, quotes, ';', '&', '|', '$', backticks, '(', '<', '>', '\' and NUL.
case "$CMD" in
  *[!A-Za-z0-9\ -]*) deny ;;
esac

RE_DEPLOY='^deploy ([0-9a-fA-F]{40})( --dry-run)?( --ci-verified)?$'
RE_ROLLBACK='^rollback ([0-9a-fA-F]{40})$'

# Pre-run git work: its output is redacted like everything else, and a sha that
# is not an ancestor of origin/main is refused before anything is extracted.
# git_fetch_main [soft]: a deploy must see fresh history, so a failing fetch refuses
# it. A rollback is the emergency path and often needed exactly when the network
# or GitHub is down: with "soft" it warns and carries on with the existing
# origin/main (the on-main check below still applies to what is on disk).
git_fetch_main() {
  local out
  if ! out="$(git -C "$APP_DIR" fetch --quiet origin main 2>&1)"; then
    printf '%s\n' "$out" | redact >&2
    if [ "${1:-}" = soft ]; then
      echo "Warning: git fetch failed; continuing with the existing origin/main." >&2
      return 0
    fi
    echo "Error: git fetch failed." >&2
    exit 2
  fi
}
require_on_main() {
  if ! git -C "$APP_DIR" cat-file -e "${1}^{commit}" 2>/dev/null; then
    echo "Error: commit $1 is unknown to the VPS checkout after fetch." >&2
    exit 2
  fi
  if ! git -C "$APP_DIR" merge-base --is-ancestor "$1" origin/main 2>/dev/null; then
    echo "Error: commit $1 is not an ancestor of origin/main; refusing." >&2
    exit 2
  fi
}

# run_detached <label> <cmd...>: run the command in its own session, output to a
# capture file we tail; the exit code travels through a status file.
run_detached() {
  local label="$1"; shift
  mkdir -p "$LOG_DIR"
  chmod 700 "$LOG_DIR" 2>/dev/null || true
  OUT="$(mktemp "$LOG_DIR/.entry-$label-XXXXXX.out")"
  STATUS="$OUT.status"
  # A new session (setsid -w stays the parent of the run) plus an ignored SIGHUP:
  # closing the SSH connection must not stop the run. stdin is /dev/null. The
  # child gets a scrubbed environment. It writes its status only while the
  # capture file still exists, so an entry that died early leaves no litter.
  RUN_DIR_OWNED=0   # from the launch on, the run owns its directory
  # shellcheck disable=SC2016  # the single-quoted program is meant to expand in the child shell
  env -u SHELLOPTS -u BASHOPTS -u BASH_ENV -u ENV -u BASH_XTRACEFD -u PS4 -u LD_PRELOAD -u LD_LIBRARY_PATH \
    OUT_FILE="$OUT" STATUS_FILE="$STATUS" \
    setsid -w bash -c 'trap "" HUP; rc=0; "$@" || rc=$?; if [ -e "$OUT_FILE" ]; then echo "$rc" > "$STATUS_FILE.tmp" && mv "$STATUS_FILE.tmp" "$STATUS_FILE"; fi' _ "$@" \
    > "$OUT" 2>&1 < /dev/null &
  local runpid=$!
  # tail follows until the run's process is gone, then makes a final pass: a
  # proper flush, not a fixed sleep.
  tail -n +1 -F -s 0.2 --pid="$runpid" "$OUT" 2>/dev/null &
  TAILPID=$!
  wait "$runpid" || true
  wait "$TAILPID" 2>/dev/null || true
  TAILPID=""
  if [ ! -e "$STATUS" ]; then
    echo "Error: the run ended without reporting a status." >&2
    # it never took over its directory properly: do not leave it behind
    if [ -n "$RUN_DIR" ]; then rm -rf "$RUN_DIR"; fi
    exit 1
  fi
  local rc
  rc="$(cat "$STATUS")"
  exit "$rc"
}

if [[ "$CMD" =~ $RE_DEPLOY ]]; then
  PIN="${BASH_REMATCH[1],,}"
  ARGS=("$PIN")
  [ -z "${BASH_REMATCH[2]}" ] || ARGS+=(--dry-run)
  [ -z "${BASH_REMATCH[3]}" ] || ARGS+=(--ci-verified)

  git_fetch_main
  require_on_main "$PIN"
  # The PIN's OWN tools/deploy (script + libs), extracted outside the work tree.
  mkdir -p "$LOG_DIR"
  chmod 700 "$LOG_DIR" 2>/dev/null || true
  RUN_DIR="$(mktemp -d "$LOG_DIR/.run-XXXXXX")"
  RUN_DIR_OWNED=1
  git -C "$APP_DIR" archive "$PIN" tools/deploy | tar -x -C "$RUN_DIR" --exclude='tools/deploy/test'
  if [ ! -f "$RUN_DIR/tools/deploy/deploy.sh" ]; then
    echo "Error: commit $PIN has no tools/deploy/deploy.sh." >&2
    exit 2
  fi
  chmod 700 "$RUN_DIR/tools/deploy/deploy.sh"
  # deploy.sh removes this directory on exit (DEPLOY_TMP_DIR) and skips its own
  # re-exec because it is already running from a copy.
  export DEPLOY_TMP_DIR="$RUN_DIR" DEPLOY_REEXEC=1
  run_detached deploy "$RUN_DIR/tools/deploy/deploy.sh" "${ARGS[@]}"
elif [[ "$CMD" =~ $RE_ROLLBACK ]]; then
  PREV="${BASH_REMATCH[1],,}"
  if [ ! -x "$APP_DIR/tools/deploy/rollback.sh" ]; then
    echo "Error: $APP_DIR/tools/deploy/rollback.sh is missing." >&2
    exit 2
  fi
  git_fetch_main soft
  require_on_main "$PREV"
  run_detached rollback "$APP_DIR/tools/deploy/rollback.sh" "$PREV"
elif [ "$CMD" = "status" ]; then
  latest="$( { find "$LOG_DIR" -maxdepth 1 -type f \( -name 'deploy-*.log' -o -name 'rollback-*.log' \) -printf '%T@ %p\n' 2>/dev/null || true; } | sort -nr | sed -n '1p' | cut -d' ' -f2-)"
  if [ -z "$latest" ]; then
    echo "STATUS: no deploy or rollback log found in $LOG_DIR."
    echo "LAST_DEPLOY_RESULT=none"
    exit 0
  fi
  echo "STATUS: newest log is $latest"
  echo "----- last 40 lines -----"
  tail -n 40 "$latest"
  echo "----- end -----"
  result="$(grep -h '^DEPLOY_RESULT=' "$latest" | tail -1 || true)"
  echo "LAST_DEPLOY_RESULT=${result#DEPLOY_RESULT=}"
else
  deny
fi
