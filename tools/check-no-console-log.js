#!/usr/bin/env node
// Flags any raw console.log/warn/error/debug/info call in backend/src —
// Phase 4 (ops foundations) replaced 18 of 20 such call sites with the
// structured JSON logger (common/logging/logger.ts's createLogger),
// registered app-wide via app.useLogger() so every log line carries a
// request id, shopId (where known), and goes through redact() before ever
// hitting stdout. A raw console.* call bypasses all of that — no request
// context, no redaction, plain text instead of the JSON the ops pipeline
// expects to parse.
//
// Heuristic (grep, not a real parser — same philosophy as
// check-outlet-scoping.js/check-page-width.js): match the call syntax
// itself (`console.log(`, not just the substring "console.log", so a
// comment that merely mentions console.log by name doesn't trip this),
// skipping lines that are themselves `//` comments.
//
// Run: node tools/check-no-console-log.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "backend", "src");

// Whole-file exceptions, each with a one-line reason — same ALLOWLIST
// convention as check-outlet-scoping.js. Both are dev-visibility stub
// functions (sendEmailStub/sendWhatsAppStub), not operational error/warning
// logs: dozens of existing e2e specs (order-notifications, survey) plus
// email.spec.ts spy on console.log specifically to verify stub behavior.
// Converting them to the structured logger would mean spying on
// process.stdout.write instead, which risks swallowing Jest's own reporter
// output — not worth the churn for a purely cosmetic format change on a
// placeholder that's meant to be eyeballed in a terminal, not parsed by an
// ops pipeline.
const ALLOWLIST_FILES = new Set([
  "common/email.ts",
  "common/whatsapp.ts",
]);

const CONSOLE_CALL_PATTERN = /\bconsole\.(log|warn|error|debug|info)\s*\(/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
}

const files = [];
walk(ROOT, files);

const flagged = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  if (ALLOWLIST_FILES.has(rel)) continue;

  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (CONSOLE_CALL_PATTERN.test(lines[i])) {
      flagged.push({ rel, line: i + 1, text: trimmed });
    }
  }
}

if (flagged.length === 0) {
  console.log("check-no-console-log: no violations — every log call in backend/src goes through the structured logger.");
  process.exit(0);
}

console.log(`check-no-console-log: ${flagged.length} raw console.* call(s) found in backend/src:\n`);
for (const { rel, line, text } of flagged) {
  console.log(`  ${rel}:${line} — ${text}`);
}
console.log("\nUse createLogger('SomeContext') from common/logging/logger.ts instead (logger.info/warn/error/debug(message, meta?)), or add a one-line-reasoned entry to ALLOWLIST_FILES in tools/check-no-console-log.js if this is a genuine, deliberate exception.");
process.exit(1);
