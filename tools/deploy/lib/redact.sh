#!/usr/bin/env bash
# Log redaction filter, sourced by deploy.sh and rollback.sh. Everything these
# scripts print goes through `redact` before it reaches the log file or the SSH
# session, so a secret that leaks into a command's output (a connection string
# in an error message, a bearer header in a curl trace) is masked on the way out.
# Secrets are also never put in argv in the first place; this is the second layer.
#
# Usage:  some_command 2>&1 | redact
#
# Masks (case-insensitive):
#   - PEM private key blocks: from the BEGIN line to the END line, body included
#     (a block whose END never arrives masks the rest of the stream: fail closed)
#   - scheme://user:password@host, up to the LAST '@' before the host, so a raw
#     '@' inside a password does not leak its tail
#   - Authorization: <scheme> <credential> (Basic, Bearer, Token, ...) and Cookie
#   - "Bearer <token>" anywhere
#   - NAME=value, NAME: value and JSON "name":"value" where NAME contains PWD,
#     PASS, SECRET, TOKEN, KEY, CREDENTIAL or AUTH (MYSQL_PWD, DB_PASS,
#     DB_PASSWORD, "apiKey", "secret", ...); the value may be unquoted, "double
#     quoted" or 'single quoted', including spaces inside the quotes
# Deliberately over-eager: a masked harmless value is better than a leaked one.
# 40-hex commit SHAs and DEPLOY_RESULT / PREVIOUS_SHA style lines pass through.
#
# tools/deploy/ssh-entry.sh embeds a byte-identical copy of this sed program
# (it is installed outside the work tree and cannot source this file);
# tools/deploy/test/redact.test.js fails if the two copies differ.
#
# See docs/runbook.md ("Deploy via GitHub Actions").

REDACT_SED="$(cat <<'REDACT_SED_EOF'
/-----BEGIN [A-Z ]*PRIVATE KEY-----.*-----END [A-Z ]*PRIVATE KEY-----/{s/-----BEGIN [A-Z ]*PRIVATE KEY-----.*-----END [A-Z ]*PRIVATE KEY-----/[REDACTED PRIVATE KEY]/;b}
/-----BEGIN [A-Z ]*PRIVATE KEY-----/,/-----END [A-Z ]*PRIVATE KEY-----/c\
[REDACTED PRIVATE KEY BLOCK]
s#([A-Za-z][A-Za-z0-9+.-]*://[^:/@[:space:]]*):[^/[:space:]]*@#\1:***@#g
s#(authorization["']?[[:space:]]*[:=][[:space:]]*["']?)([A-Za-z]+[[:space:]]+)?[^[:space:]"']+#\1***#gI
s#(cookie[[:space:]]*:[[:space:]]*).*#\1***#I
s#(bearer)[[:space:]]+[A-Za-z0-9._~+/=-]+#\1 ***#gI
s#([A-Za-z0-9_]*(pwd|pass|secret|token|key|credential|auth)[A-Za-z0-9_]*["']?[[:space:]]*[=:][[:space:]]*)("[^"]*"|'[^']*'|[^[:space:]]+)#\1***#gI
REDACT_SED_EOF
)"

redact() {
  sed -u -E -e "$REDACT_SED"
}
