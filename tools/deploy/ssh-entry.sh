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
# shell.
#
# It is installed OUTSIDE the git work tree (default /home/deploy/bin/
# requital-ssh-entry.sh, copied with `git show`) so a `git merge` cannot change
# what sshd executes, and is pinned in authorized_keys together with
# no-port-forwarding,no-agent-forwarding,no-pty,no-X11-forwarding,restrict.
# deploy.sh itself is the PIN commit's own copy (git show), rollback.sh the
# checked-out one; only this file needs the manual bootstrap.
#
# Runs detached (setsid) with its output captured to a file that this script
# tails, so a dropped SSH connection (SIGHUP, closed pipe) does not kill a
# half-finished deploy; the next `status` call shows how it ended.
#
# Config (env, defaults are production): APP_DIR, LOG_DIR.
# Exit codes: the script's own, or 126 for a refused request.
#
# See docs/runbook.md ("Deploy via GitHub Actions").

set -euo pipefail
umask 077
export PATH="/usr/local/bin:/usr/bin:/bin"
export LC_ALL=C

APP_DIR="${APP_DIR:-/home/deploy/requital}"
LOG_DIR="${LOG_DIR:-/home/deploy/deploy-logs}"

deny() {
  echo "Error: command not allowed. Allowed: 'deploy <sha> [--dry-run] [--ci-verified]', 'rollback <sha>', 'status'." >&2
  exit 126
}

CMD="${SSH_ORIGINAL_COMMAND-}"
[ -n "$CMD" ] || deny
# Only letters, digits, space and '-' may appear at all. This alone excludes
# newlines, quotes, ';', '&', '|', '$', backticks, '(', '<', '>', '\' and NUL.
case "$CMD" in
  *[!A-Za-z0-9\ -]*) deny ;;
esac

RE_DEPLOY='^deploy ([0-9a-fA-F]{40})( --dry-run)?( --ci-verified)?$'
RE_ROLLBACK='^rollback ([0-9a-fA-F]{40})$'

# run_detached <label> <cmd...>: run the command in its own session, output to a
# capture file we tail; the exit code travels through a status file.
run_detached() {
  local label="$1"; shift
  mkdir -p "$LOG_DIR"
  chmod 700 "$LOG_DIR" 2>/dev/null || true
  local out status
  out="$(mktemp "$LOG_DIR/.entry-$label-XXXXXX.out")"
  status="$out.status"
  # A new session (setsid -w: stays the parent of the run) plus an ignored
  # SIGHUP: closing the SSH connection must not stop the run. stdin is /dev/null.
  # shellcheck disable=SC2016  # the single-quoted program is meant to expand in the child shell
  STATUS_FILE="$status" setsid -w bash -c 'trap "" HUP; rc=0; "$@" || rc=$?; echo "$rc" > "$STATUS_FILE.tmp"; mv "$STATUS_FILE.tmp" "$STATUS_FILE"' _ "$@" > "$out" 2>&1 < /dev/null &
  local runpid=$!
  tail -n +1 -F "$out" 2>/dev/null &
  local tailpid=$!
  trap 'kill "$tailpid" 2>/dev/null || true' EXIT
  while [ ! -e "$status" ]; do
    if ! kill -0 "$runpid" 2>/dev/null; then
      sleep 0.5
      [ -e "$status" ] || { kill "$tailpid" 2>/dev/null || true; echo "Error: the run ended without reporting a status." >&2; exit 1; }
      break
    fi
    sleep 0.2
  done
  sleep 0.5
  kill "$tailpid" 2>/dev/null || true
  wait "$tailpid" 2>/dev/null || true
  local rc
  rc="$(cat "$status")"
  rm -f "$out" "$status"
  exit "$rc"
}

if [[ "$CMD" =~ $RE_DEPLOY ]]; then
  PIN="${BASH_REMATCH[1],,}"
  ARGS=("$PIN")
  [ -z "${BASH_REMATCH[2]}" ] || ARGS+=(--dry-run)
  [ -z "${BASH_REMATCH[3]}" ] || ARGS+=(--ci-verified)

  git -C "$APP_DIR" fetch --quiet origin main
  git -C "$APP_DIR" cat-file -e "${PIN}^{commit}" 2>/dev/null || { echo "Error: commit $PIN is unknown to the VPS checkout after fetch." >&2; exit 2; }
  # The PIN's OWN tools/deploy (script + libs), extracted outside the work tree.
  mkdir -p "$LOG_DIR"
  chmod 700 "$LOG_DIR" 2>/dev/null || true
  RUN_DIR="$(mktemp -d "$LOG_DIR/.run-XXXXXX")"
  git -C "$APP_DIR" archive "$PIN" tools/deploy | tar -x -C "$RUN_DIR" --exclude='tools/deploy/test'
  [ -f "$RUN_DIR/tools/deploy/deploy.sh" ] || { echo "Error: commit $PIN has no tools/deploy/deploy.sh." >&2; rm -rf "$RUN_DIR"; exit 2; }
  chmod 700 "$RUN_DIR/tools/deploy/deploy.sh"
  # deploy.sh removes this directory on exit (DEPLOY_TMP_DIR) and skips its own
  # re-exec because it is already running from a copy.
  export DEPLOY_TMP_DIR="$RUN_DIR" DEPLOY_REEXEC=1
  run_detached deploy "$RUN_DIR/tools/deploy/deploy.sh" "${ARGS[@]}"
elif [[ "$CMD" =~ $RE_ROLLBACK ]]; then
  PREV="${BASH_REMATCH[1],,}"
  [ -x "$APP_DIR/tools/deploy/rollback.sh" ] || { echo "Error: $APP_DIR/tools/deploy/rollback.sh is missing." >&2; exit 2; }
  run_detached rollback "$APP_DIR/tools/deploy/rollback.sh" "$PREV"
elif [ "$CMD" = "status" ]; then
  latest="$( { find "$LOG_DIR" -maxdepth 1 -type f \( -name 'deploy-*.log' -o -name 'rollback-*.log' \) -printf '%T@ %p\n' 2>/dev/null || true; } | sort -nr | head -1 | cut -d' ' -f2-)"
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
