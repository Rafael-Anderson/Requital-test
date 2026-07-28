#!/usr/bin/env node
// Flags app/**/page.tsx files that hand-roll a raw `max-w-*` wrapper instead
// of routing page-level width through PageShell (admin) / StorefrontPageShell
// (storefront) — the two components that own that decision (see each app's
// own component for the variant list). This is the actual recurring bug
// behind the project's narrow-page fixes: a page.tsx that never imports the
// shared shell at all, so nothing enforces a consistent, deliberately-chosen
// width — it just inherits whatever max-w a raw wrapper div happened to use
// at write time, on wide byte or narrow.
//
// Heuristic (grep-based, not an AST parse — good enough for this repo's
// size): a page.tsx containing `max-w-` that does NOT import PageShell /
// StorefrontPageShell is flagged. False positives are pre-auth pages with no
// dashboard/storefront chrome at all (login, signup, etc.) and the bio page
// (deliberately phone-width by design) — listed in ALLOWLIST below rather
// than silently special-cased in the matching logic.
//
// Run: node tools/check-page-width.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const ALLOWLIST = [
  // Pre-auth pages: no PageShell/dashboard chrome exists to route through —
  // these render before a session exists, same reason RequireAuth doesn't
  // gate them either.
  "admin/app/login/page.tsx",
  "admin/app/signup/page.tsx",
  "admin/app/forgot-password/page.tsx",
  "admin/app/reset-password/page.tsx",
  "admin/app/accept-invite/page.tsx",
  "admin/app/verify-email/page.tsx",
  // Deliberately phone-width regardless of viewport — a "link in bio" page
  // is meant to look like a stacked mobile card even on desktop, the same
  // convention every bio-link tool uses. Not a page-content-width bug.
  "storefront/app/[shop]/bio/page.tsx",
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
}

const files = [];
walk(path.join(ROOT, "admin", "app"), files);
walk(path.join(ROOT, "storefront", "app"), files);

const flagged = [];
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  if (!/max-w-/.test(src)) continue;
  if (/from ["']@\/components\/(ui\/)?(PageShell|StorefrontPageShell)["']/.test(src)) continue;

  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  if (ALLOWLIST.some((a) => rel.endsWith(a) || a.endsWith(rel))) continue;

  const lines = src
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line.includes("max-w-"));
  flagged.push({ rel, lines });
}

if (flagged.length === 0) {
  console.log("check-page-width: no violations — every page.tsx with a max-w- either routes through the shared shell or is allowlisted.");
  process.exit(0);
}

console.log(`check-page-width: ${flagged.length} page(s) use a raw max-w- without importing PageShell/StorefrontPageShell:\n`);
for (const { rel, lines } of flagged) {
  console.log(rel);
  for (const { line, n } of lines) console.log(`  ${n}: ${line}`);
  console.log("");
}
process.exit(1);
