#!/usr/bin/env node
// Guardrail: a registry-backed shop column is read in exactly ONE place.
//
// Why this exists. PLT-11 put every per-shop feature behind
// FeaturesService.isEnabled/getFlags, which applies the platform override row
// BEFORE the shop's own column. A read site that selects the column directly
// silently ignores the override: Requital staff turn a feature off for a shop
// and that one code path keeps running. This is the same bug class as the
// payment-provider toggle bypass (an outer check repeated by some callers and
// forgotten by others), so it is a CI check rather than a code-review habit.
//
// The registry is backend/src/features/feature-keys.ts. Any `column: '<name>'`
// in it is protected. A mention of that name anywhere else under backend/src is
// a violation unless it is:
//   - inside backend/src/features/ (the adapter itself) or db/types.ts
//   - in a dto/ folder or a *.spec.ts (declarations and tests)
//   - a comment line
//   - a WRITE: the `col: dto.col,` mapping in shop.service, or `UPDATE shop SET`
//   - a response field filled FROM the resolver: `col: flags.<key>,` (the public
//     shop payload keeps its historical field names)
//
// Run: node tools/check-feature-flags.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "backend", "src");
const REGISTRY = path.join(ROOT, "features", "feature-keys.ts");

const registrySrc = fs.readFileSync(REGISTRY, "utf8");
const columns = [...registrySrc.matchAll(/column:\s*'(\w+)'/g)].map((m) => m[1]);
if (columns.length === 0) {
  console.log("check-feature-flags: found no registry columns, refusing to pass vacuously.");
  process.exit(1);
}
const patterns = columns.map((c) => ({ c, re: new RegExp(`\\b${c}\\b`) }));

const violations = [];

function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function isWrite(line, col) {
  if (new RegExp(`^\\s*${col}:\\s*dto\\.${col},?\\s*$`).test(line)) return true;
  if (new RegExp(`^\\s*${col}:\\s*flags\\.\\w+,?\\s*$`).test(line)) return true;
  return /UPDATE\s+shop\s+SET/i.test(line);
}

function check(file) {
  const rel = path.relative(ROOT, file);
  const parts = rel.split(path.sep);
  if (parts[0] === "features") return;
  if (rel === path.join("db", "types.ts")) return;
  if (parts.includes("dto")) return;
  if (rel.endsWith(".spec.ts")) return;

  fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (isCommentLine(line)) return;
      for (const { c, re } of patterns) {
        if (!re.test(line)) continue;
        if (isWrite(line, c)) continue;
        violations.push(`${path.join("backend", "src", rel)}:${i + 1}  [${c}]  ${line.trim()}`);
      }
    });
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".ts")) check(full);
  }
}

walk(ROOT);

if (violations.length === 0) {
  console.log(
    `check-feature-flags: no violations, ${columns.length} registry-backed shop columns are read only through FeaturesService.`,
  );
  process.exit(0);
}

console.log(
  `check-feature-flags: ${violations.length} violation(s). Read the flag with FeaturesService.isEnabled/getFlags/enabledShopIds so a platform override applies:\n`,
);
for (const v of violations) console.log(`  ${v}`);
process.exit(1);
