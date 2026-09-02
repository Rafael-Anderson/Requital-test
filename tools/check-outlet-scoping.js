#!/usr/bin/env node
// Flags backend service methods that accept an `outletId` parameter without
// an adjacent ownership check verifying that outlet actually belongs to the
// caller's shop. This bug class has now appeared twice for real
// (ingredients.service.ts confirmImportIngredients, products.service.ts
// confirmImportProducts — both fixed in the same session this guardrail was
// added) — a client-supplied outletId used directly in a write (stock
// upsert, stockmovement create) without first checking
// `outlet.findFirst({ id: outletId, shopId: ctx.shopId })` lets an admin from
// one shop write into another shop's outlet by guessing/knowing its id.
//
// Heuristic (grep + brace-counting, not a real parser — good enough for this
// repo's size, same philosophy as check-page-width.js): find every method in
// every backend/src/**/*.service.ts file whose parameter list references
// `outletId`, then check whether that method's own body contains one of the
// known ownership-check markers. If not, and it isn't allowlisted, flag it.
//
// This will have false positives — a method can be safe without matching a
// marker (e.g. a private helper only ever called with an already-verified
// outletId from its caller, or a read-only query where a foreign outletId
// can only ever match zero rows). Those are the ALLOWLIST entries below,
// each with a one-line reason — same convention as check-page-width.js.
//
// Run: node tools/check-outlet-scoping.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "backend", "src");

const OWNERSHIP_MARKERS = [
  "outlet.findFirst",
  // Post-mysql2-migration equivalent of the Prisma `outlet.findFirst({ id,
  // shopId })` check above — every converted call site uses this same raw
  // SQL shape (see products/ingredients/scan/auth/draft-orders services),
  // so one substring covers all of them, including scan.service.ts's
  // `id IN (...)` batch variant.
  "FROM outlet WHERE",
  "assertOutletBelongsToShop",
  "assertOutletAccessible",
  "assertZoneBelongsToOutlet",
  "resolveOutletFilter",
  "ctx.role === 'branch'",
  'ctx.role === "branch"',
];

const ALLOWLIST = [
  // Private helpers only ever called with an outletId already verified by
  // their caller earlier in the same request (order.outletId from a
  // shop/outlet-scoped findOne, or a batch already checked up front) — not a
  // new entry point, so no independent check belongs here.
  "orders/orders.service.ts:findNegativeIngredientStock",
  "orders/orders.service.ts:adjustStockForOrder",
  "products/products.service.ts:consumeForOrderItems",
  "products/products.service.ts:applyImportStock",
  "dashboard/dashboard.service.ts:revenueAndCount",
  // Read-only batch-loader queries (post-mysql2-migration replacement for
  // the Prisma include/select builders these entries used to name) —
  // outletId only narrows a LEFT JOIN's own ON/WHERE clause for a stock
  // lookup, scoped underneath a product/ingredient id set already resolved
  // via its own shopId check. A foreign outletId here can only ever match
  // zero rows in that join (the id list also requires the exact
  // product/variant ids already fetched), never leak another shop's data.
  "ingredients/ingredients.service.ts:loadIngredientRows",
  "products/products.service.ts:loadProductsWithRelations",
  "products/products.service.ts:loadVariantsWithRelations",
  "products/products.service.ts:loadIngredientLinks",
  "public/public.service.ts:loadPublicProductsWithRelations",
  // Thin public wrapper over loadPublicProductsWithRelations (above) —
  // read-only, takes an explicit shopId that scopes its product query, and
  // only forwards outletId into that same allowlisted loader's stock join.
  "public/public.service.ts:getProductsByIds",
  // Read-only report/dashboard aggregates — outletId is always AND-ed
  // alongside shopId in the same where clause, so a foreign outletId
  // narrows to zero rows rather than leaking a different shop's rows.
  "reports/reports.service.ts:listGeneralOrders",
  "reports/reports.service.ts:listProductSales",
  // resolveEffectivePermissions/assertPermission look up a
  // useroutletrole row keyed on (ctx.userId, outletId) — scoped to the
  // caller's own identity, not an arbitrary lookup. A foreign-shop outletId
  // simply matches no row (returns null / falls through to base role
  // logic), it can't grant or reveal anything.
  "branch-roles/branch-roles.service.ts:resolveEffectivePermissions",
  "branch-roles/branch-roles.service.ts:assertPermission",
  // unassign checks ownership via a relation filter
  // (`user: { shopId: ctx.shopId }`) rather than a direct outlet.findFirst —
  // a real check, just a different marker shape than the others.
  "branch-roles/branch-roles.service.ts:unassign",
  // Storefront public product reads — outletId only narrows a nested stock
  // relation's own `where` underneath a product already resolved via
  // shopSlug -> shop.id, same reasoning as the products.service.ts include
  // builders above. A foreign outletId yields an empty nested stock read,
  // never another shop's product data.
  "public/public.service.ts:getTemplate",
  "public/public.service.ts:getCollectionBySlug",
  "public/public.service.ts:getHomepageTemplates",
  "public/public.service.ts:listProducts",
  "public/public.service.ts:getProduct",
  "public/public.service.ts:getProductBySlug",
  "public/public.service.ts:getRelatedProducts",
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".service.ts") && !entry.name.endsWith(".spec.ts")) out.push(full);
  }
}

const files = [];
walk(ROOT, files);

const CONTROL_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "function", "return",
]);

const METHOD_START = /^\s*(private\s+|public\s+|protected\s+)?(static\s+)?(async\s+)?([a-zA-Z_$][\w$]*)\s*\(/;

function findMatchingBraceEnd(lines, startLine) {
  let depth = 0;
  let seenOpen = false;
  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        seenOpen = true;
      } else if (ch === "}") {
        depth--;
        if (seenOpen && depth === 0) return i;
      }
    }
  }
  return lines.length - 1;
}

// A call-statement/array-element sitting alone on its own line (very common
// now that raw SQL params are one-per-line, e.g. `generateOpaqueToken(),`)
// closes its own parens and is immediately followed by `,`/`;` and nothing
// else — a real method declaration never does that (it either continues
// the signature onto more lines, or closes with `{` right there).
const CALL_STATEMENT_END = /\)\s*[,;]?\s*$/;

const flagged = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");

  // Tracks whether line i *starts* inside a multi-line template literal
  // (backtick string) — SQL text spanning several lines (e.g. `VALUES (?,
  // ?, ?)` on its own continuation line) reads as plain text, not JS, and
  // must never be scanned for a method declaration. Approximate on purpose
  // (naive backtick parity, no ${...} awareness) — good enough given this
  // file's own "heuristic, not a real parser" philosophy.
  const startsInTemplate = new Array(lines.length).fill(false);
  let inTemplate = false;
  for (let i = 0; i < lines.length; i++) {
    startsInTemplate[i] = inTemplate;
    const backticks = (lines[i].match(/`/g) || []).length;
    if (backticks % 2 === 1) inTemplate = !inTemplate;
  }

  for (let i = 0; i < lines.length; i++) {
    if (startsInTemplate[i]) continue;
    if (CALL_STATEMENT_END.test(lines[i].trim()) && !lines[i].includes("{")) continue;
    const m = lines[i].match(METHOD_START);
    if (!m) continue;
    const methodName = m[4];
    if (CONTROL_KEYWORDS.has(methodName)) continue;
    if (ALLOWLIST.includes(`${rel}:${methodName}`)) continue;

    // Scan from the signature line to the opening `{` to find the parameter
    // list (may span multiple lines), then to the matching closing brace.
    let sigEnd = i;
    while (sigEnd < lines.length && !lines[sigEnd].includes("{")) sigEnd++;
    const signature = lines.slice(i, sigEnd + 1).join("\n");
    if (!/\boutletId\b/.test(signature)) continue;

    const bodyEnd = findMatchingBraceEnd(lines, sigEnd);
    const body = lines.slice(i, bodyEnd + 1).join("\n");
    if (OWNERSHIP_MARKERS.some((marker) => body.includes(marker))) continue;

    flagged.push({ rel, methodName, line: i + 1 });
  }
}

if (flagged.length === 0) {
  console.log("check-outlet-scoping: no violations — every method taking outletId has an adjacent ownership check or is allowlisted.");
  process.exit(0);
}

console.log(`check-outlet-scoping: ${flagged.length} method(s) accept outletId with no adjacent ownership check:\n`);
for (const { rel, methodName, line } of flagged) {
  console.log(`  ${rel}:${line} — ${methodName}()`);
}
console.log("\nEither add `await this.prisma.outlet.findFirst({ where: { id: outletId, shopId: ctx.shopId } })` (or equivalent) before using outletId in a write, or add an ALLOWLIST entry in tools/check-outlet-scoping.js with a one-line reason if this is a false positive.");
process.exit(1);
