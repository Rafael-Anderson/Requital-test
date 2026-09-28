#!/usr/bin/env node
// Guardrail: STOREFRONT_URL must be read in exactly ONE place.
//
// Why this exists. Eight services each declared their own
// `process.env.STOREFRONT_URL ?? 'http://localhost:3002'` and built
// `${STOREFRONT_URL}/${shopSlug}/...` by hand. In production that env var was
// set to the apex, whose only job in deploy/Caddyfile is a 301 to
// admin.requital.io — so every gateway return URL and every customer email link
// sent customers to the merchant admin login. The path shape was unreachable on
// any host besides, because storefront/proxy.ts prepends the resolved shop slug
// itself, doubling it.
//
// A shop's public address is a HOST, resolved per shop from its verified custom
// domain or its own subdomain. That lives in
// backend/src/common/storefront-url.ts and nowhere else. This check makes a
// regression loud instead of silent, because the failure mode is invisible in
// dev — there STOREFRONT_URL genuinely is a local host and the old shape works.
//
// Run: node tools/check-storefront-url.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "backend", "src");
const ALLOWED = path.join("common", "storefront-url.ts");

const violations = [];

function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function check(file) {
  const rel = path.relative(ROOT, file);
  if (rel === ALLOWED) return;
  // Spec files legitimately set/delete the var to exercise the helper's dev
  // branch, and env-validation's own spec asserts it stays optional.
  if (rel.endsWith(".spec.ts")) return;

  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.includes("STOREFRONT_URL")) return;
    if (isCommentLine(line)) return;
    // env-validation.ts lists the var's NAME in its table of optional vars.
    // That is a declaration that it may exist, not a read that builds a URL.
    if (line.includes("name: 'STOREFRONT_URL'")) return;
    if (line.includes('name: "STOREFRONT_URL"')) return;
    violations.push(
      `${path.join("backend", "src", rel)}:${i + 1}  ${line.trim()}`,
    );
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
    "check-storefront-url: no violations — STOREFRONT_URL is read only in common/storefront-url.ts.",
  );
  process.exit(0);
}

console.log(
  `check-storefront-url: ${violations.length} violation(s) — build customer-facing URLs with storefrontUrl(shop, path) from common/storefront-url.ts instead:\n`,
);
for (const v of violations) console.log(`  ${v}`);
console.log(
  "\nA shop's public address is a host (its verified custom domain, else <subdomain>.<root>), not a path prefix on a shared base URL.",
);
process.exit(1);
