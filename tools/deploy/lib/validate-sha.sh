#!/usr/bin/env bash
# The single place a commit SHA supplied from outside (a workflow input, an SSH
# command line, a CLI argument) is validated. Sourced by deploy.sh, rollback.sh
# and ssh-entry.sh, and executed directly by the deploy workflow's gate step, so
# there is exactly one definition of "a valid SHA" and a weakening of it is
# caught by one set of tests (tools/deploy/test/validate-sha.test.js).
#
# Usage (sourced):    sha=$(validate_sha "$value") || exit 2
# Usage (executed):   tools/deploy/lib/validate-sha.sh <value>     (prints the
#                     lower-cased SHA on stdout, exits 1 and says why otherwise)
#
# Accepts exactly 40 hex digits (either case, lower-cased on output). Rejects
# the empty string, any other length (a trailing newline makes 41), anything
# containing a non-hex character (whitespace, quotes, ';', '$(', leading '-'),
# so the value is safe to pass as a git revision and as a shell word afterwards.
# The explicit digit list (not a range) keeps the check locale-independent.
#
# See docs/runbook.md ("Deploy via GitHub Actions").

validate_sha() {
  local value="${1-}"
  if [ "${#value}" -ne 40 ]; then
    echo "Error: commit SHA must be exactly 40 hex characters." >&2
    return 1
  fi
  case "$value" in
    *[!0123456789abcdefABCDEF]*)
      echo "Error: commit SHA must contain only hex characters." >&2
      return 1
      ;;
  esac
  printf '%s\n' "${value,,}"
}

# Executed directly (not sourced): behave as a small CLI.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <40-hex sha>" >&2
    exit 2
  fi
  validate_sha "$1"
fi
