#!/usr/bin/env node
// Baseline-pinned lint ratchet, one instance per app (backend/admin/storefront).
// All three have pre-existing lint debt predating this CI phase — backend's
// @typescript-eslint findings are documented in CLAUDE.md's "Known
// pre-existing lint gap" (Jest-mock-typing false positives, mostly); admin
// and storefront both fail on react-hooks/set-state-in-effect (the
// fetch-on-mount pattern CLAUDE.md's admin section already flags as a known,
// not-yet-fixed gap) plus a handful of react/no-unescaped-entities and
// exhaustive-deps findings. None of it is this CI phase's job to fix — this
// only fails the build when an app's error count goes UP from its committed
// baseline, catching new regressions without blocking on old debt.
//
// <app>/lint-baseline.txt holds that app's single committed baseline number.
// Update it (with a dated CLAUDE.md note on what changed and why) only when
// the count legitimately changes — never bump it just to silence this check.
//
// backend's lint script bakes in --fix, so this uses --fix-dry-run there —
// matching what `npm run lint` would leave behind after auto-fixing
// prettier/prettier diffs, which a plain (non-fix) run over-counts as
// errors. admin/storefront's lint script has no --fix, so a plain run
// already matches what `npm run lint` reports.
//
// Run: node tools/check-lint-baseline.js <backend|admin|storefront>

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const APPS = {
  backend: {
    dir: path.join(__dirname, "..", "backend"),
    args: ["eslint", "{src,apps,libs,test}/**/*.ts", "--fix-dry-run", "--format", "json"],
  },
  admin: {
    dir: path.join(__dirname, "..", "admin"),
    args: ["eslint", "--format", "json"],
  },
  storefront: {
    dir: path.join(__dirname, "..", "storefront"),
    args: ["eslint", "--format", "json"],
  },
};

const appName = process.argv[2];
const app = APPS[appName];
if (!app) {
  console.error(`Usage: node tools/check-lint-baseline.js <${Object.keys(APPS).join("|")}>`);
  process.exit(1);
}

const baselineFile = path.join(app.dir, "lint-baseline.txt");
const baseline = parseInt(fs.readFileSync(baselineFile, "utf8").trim(), 10);

let output;
try {
  output = execFileSync("npx", app.args, {
    cwd: app.dir,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
    shell: true,
  });
} catch (err) {
  // eslint exits 1 when it finds lint errors — expected, JSON is still on
  // stdout. Any other failure (config error, etc.) has no stdout.
  output = err.stdout;
  if (!output) {
    console.error(`check-lint-baseline(${appName}): eslint itself failed to run:`);
    console.error(err.stderr || err.message);
    process.exit(1);
  }
}

const results = JSON.parse(output);
let errorCount = 0;
for (const file of results) {
  for (const message of file.messages) {
    if (message.severity === 2) errorCount += 1;
  }
}

const delta = errorCount - baseline;
console.log(`check-lint-baseline(${appName}): baseline=${baseline} current=${errorCount} delta=${delta >= 0 ? "+" : ""}${delta}`);

if (errorCount > baseline) {
  console.log(
    `\nNew lint errors introduced in ${appName} (${delta} more than the committed baseline). Fix them, ` +
      `or if this is a legitimate baseline change, update ${appName}/lint-baseline.txt and add a ` +
      `dated note to CLAUDE.md explaining what changed.`,
  );
  process.exit(1);
}

if (errorCount < baseline) {
  console.log(
    `\nFewer errors than the baseline (${-delta} fixed) — nice. Lower ${appName}/lint-baseline.txt ` +
      `to ${errorCount} to lock in the improvement (not required, just recommended).`,
  );
}

process.exit(0);
