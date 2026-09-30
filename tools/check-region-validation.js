#!/usr/bin/env node
// Flags a backend method that WRITES a `regionId` without calling
// RegionsService.resolveForShop (or resolveManyForShop, for a zone's region set)
// in the same method.
//
// Why a guardrail: a region is valid for a shop only if it belongs to that
// shop's own country, which a DTO validator cannot know. So the check lives in
// one service call that every write path must remember, and "a guard accepting
// N call paths eventually has one forget it" is a bug class this repo has hit
// repeatedly (payment-provider toggle bypass, outlet ownership). A path that
// forgot would let a Saudi shop store a UAE emirate, or one tenant store a
// region that is not theirs.
//
// Heuristic, same philosophy as check-outlet-scoping.js (grep + method
// splitting, not a parser): split each backend/src/**/*.ts file into class
// methods at 2-space-indented declarations; a method that mentions `regionId`
// AND contains a SQL write (INSERT INTO / UPDATE / buildSetClause) must also
// contain `resolveForShop(`. The regions module itself and the db types are
// exempt. Run: node tools/check-region-validation.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "backend", "src");
const EXEMPT_DIRS = ["regions" + path.sep, "db" + path.sep];
const METHOD_START = /^ {2}(?:private |public |protected )?(?:async )?[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\(/;
// `replaceZoneRegions(` is the zone region-set writer: its callers carry the SQL-free
// side of the write, so they must be checked too.
const WRITE = /INSERT INTO|\bUPDATE\b|buildSetClause|replaceZoneRegions\(/;

// Private writers only ever called with ids their caller has just validated; every
// caller (create / update / setMapping in the same file) is itself checked above,
// because it mentions regionIds next to a SQL write and so must resolve them.
const ALLOWLIST = new Set(["delivery-zones/delivery-zones.service.ts:replaceZoneRegions"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".spec.ts")) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (EXEMPT_DIRS.some((d) => rel.startsWith(d))) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let start = -1; // only chunks that begin at a method declaration count
  const flush = (end) => {
    if (start < 0) return;
    // Comments mention "UPDATE" and "regionId" in prose; only code counts.
    const body = lines
      .slice(start, end)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    const method = (lines[start].match(/([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/) || [])[1];
    if (ALLOWLIST.has(`${rel.split(path.sep).join("/")}:${method}`)) return;
    if (/\bregionIds?\b/.test(body) && WRITE.test(body) && !/resolve(?:Many)?ForShop\(/.test(body)) {
      violations.push(`${rel}:${start + 1}  ${lines[start].trim().slice(0, 70)}`);
    }
  };
  for (let i = 0; i < lines.length; i++) {
    if (METHOD_START.test(lines[i])) {
      flush(i);
      start = i;
    }
  }
  flush(lines.length);
}

if (violations.length) {
  console.error(
    "check-region-validation: these methods write a regionId without RegionsService.resolveForShop:\n  " +
      violations.join("\n  "),
  );
  process.exit(1);
}
console.log("check-region-validation: no violations — every method that writes a regionId resolves it through RegionsService.");
