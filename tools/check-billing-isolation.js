#!/usr/bin/env node
// Guardrail (PLT-1): billing stays out of the order path.
//
// The order soft ceiling is messaging only (docs/plans/phase3-billing.md section
// 8.3): nothing may block, slow or add a write to order creation because of a
// plan. Checkout is the hottest path and runs inside a db.transaction, so a billing
// read there is also a nested-pool hazard. This check keeps the billing tables and
// the billing module out of every file except the ones that own them.
//
// A non-comment line under backend/src fails if it imports a `billing/` module or
// runs SQL (FROM / JOIN / INTO / UPDATE) against plan, planfeature, planprice,
// shopsubscription or subscriptionevent, unless the file is in billing/ (the
// module), features/ (the entitlement adapter), platform-admin/ (the staff-only
// billing view), app.module.ts or db/types.ts. Specs are exempt.
//
// Run: node tools/check-billing-isolation.js [--self-test]
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "backend", "src");
const ALLOWED_DIRS = ["billing", "features", "platform-admin"];
const ALLOWED_FILES = ["app.module.ts", path.join("db", "types.ts")];
const IMPORT = /from\s+['"][^'"]*\/billing\/[^'"]*['"]/;
const SQL =
  /\b(FROM|JOIN|INTO|UPDATE)\s+`?(plan|planfeature|planprice|shopsubscription|subscriptionevent)\b/i;

const isComment = (l) => {
  const t = l.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
};
const flags = (line) => !isComment(line) && (IMPORT.test(line) || SQL.test(line));

if (process.argv.includes("--self-test")) {
  const bad = [
    "import { BillingService } from '../billing/billing.service';",
    "`SELECT 1 FROM shopsubscription WHERE shopId = ?`",
    "  JOIN `planfeature` pf ON pf.planId = 1",
    "INSERT INTO subscriptionevent (shopId) VALUES (1)",
    "UPDATE plan SET name = 'x'",
  ];
  const good = [
    "// FROM shopsubscription is only read by the adapter",
    "SELECT * FROM shop WHERE id = ?",
    "SELECT * FROM planet WHERE id = ?",
    "import { FeaturesService } from '../features/features.service';",
  ];
  const wrong = [...bad.filter((l) => !flags(l)), ...good.filter(flags)];
  if (wrong.length) {
    console.log("check-billing-isolation self-test FAILED on:", wrong);
    process.exit(1);
  }
  console.log("check-billing-isolation self-test ok");
  process.exit(0);
}

const violations = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".spec.ts")) check(f);
  }
}
function check(file) {
  const rel = path.relative(ROOT, file);
  if (ALLOWED_DIRS.includes(rel.split(path.sep)[0]) || ALLOWED_FILES.includes(rel)) return;
  fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (flags(line)) violations.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
}
walk(ROOT);

if (violations.length) {
  console.log("Billing is referenced outside its own module (keep it out of the order path):");
  for (const v of violations) console.log("  " + v);
  process.exit(1);
}
console.log("check-billing-isolation: ok");
