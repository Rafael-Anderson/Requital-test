#!/usr/bin/env node
// Fails if production code re-introduces a hardcoded list of UAE emirates.
//
// Why: addresses are placed in a REGION (the `region` table, per country, served by
// GET /regions and GET /public/:shopSlug/regions). A hardcoded emirate list is how a
// shop in Saudi Arabia, Kuwait, Bahrain, Qatar or Oman ended up forced to pick a UAE
// emirate at checkout (audit section 6-E). Two tells are banned outside tests, SQL
// migrations and seeds: the old `EMIRATES` constant, and the literal "Umm Al Quwain"
// (the one emirate name nothing else in this codebase spells out, so its presence
// means a list is back).
//
// Scope: app source only (backend/src, admin and storefront app/components/lib,
// e2e). Tests, migrations and seed data may name emirates: asserting the seed is
// correct is exactly what a test is for. Run: node tools/check-no-emirate-list.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIRS = [
  "backend/src",
  "admin/app",
  "admin/components",
  "admin/lib",
  "storefront/app",
  "storefront/components",
  "storefront/lib",
  "e2e",
];
const SKIP_DIR = new Set(["node_modules", ".next", "dist", "test-results", "playwright-report"]);
const SKIP_FILE = /\.(spec|test)\.[cm]?[jt]sx?$|\.e2e-spec\.ts$/;
const BANNED = /\bEMIRATES\b|[Uu]mm [Aa]l[- ][Qq]uwain/;

const hits = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || SKIP_FILE.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (BANNED.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
  }
}
for (const d of DIRS) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walk(abs);
}

if (hits.length > 0) {
  console.error("check-no-emirate-list: a hardcoded emirate list is back. Use the region table instead.\n");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log("check-no-emirate-list: no violations, no hardcoded emirate list in app source.");
