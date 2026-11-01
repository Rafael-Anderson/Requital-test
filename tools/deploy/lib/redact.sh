#!/usr/bin/env bash
# Log redaction filter, sourced by deploy.sh and rollback.sh. Everything these
# scripts print goes through `redact` before it reaches the log file or the SSH
# session, so a secret that leaks into a command's output (a connection string
# in an error message, a bearer header in a curl trace) is masked on the way out.
# Secrets are also never put in argv in the first place; this is the second layer.
#
# Usage:  some_command 2>&1 | redact
#
# Masks: scheme://user:password@ (keeps the user, drops the password),
# "Bearer <token>", any NAME=value / NAME: value where NAME contains PASSWORD,
# PASSWD, SECRET, TOKEN, KEY, CREDENTIAL or AUTH, and PEM private key blocks.
# Deliberately over-eager: a masked harmless value is better than a leaked one.
# 40-hex commit SHAs and DEPLOY_RESULT / PREVIOUS_SHA style lines pass through.
#
# See docs/runbook.md ("Deploy via GitHub Actions").

redact() {
  sed -u -E \
    -e 's#([A-Za-z][A-Za-z0-9+.-]*://[^:/@[:space:]]+):[^@[:space:]]+@#\1:***@#g' \
    -e 's#([Bb][Ee][Aa][Rr][Ee][Rr])[[:space:]]+[A-Za-z0-9._~+/=-]+#\1 ***#g' \
    -e 's#(-----BEGIN [A-Z ]*PRIVATE KEY-----).*#\1 [REDACTED]#' \
    -e 's#([A-Za-z0-9_]*([Pp][Aa][Ss][Ss][Ww][Oo]?[Rr]?[Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Kk][Ee][Yy]|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]|[Aa][Uu][Tt][Hh])[A-Za-z0-9_]*[[:space:]]*[=:][[:space:]]*)[^[:space:]*]+#\1***#g'
}
