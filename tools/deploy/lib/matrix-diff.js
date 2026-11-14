#!/usr/bin/env node
// Comparison for deploy.sh's billing-flag-matrix gate (BEFORE vs AFTER the migrations).
//
//   node matrix-diff.js <before.json> <after.json>
//
// Inputs are the "strict view" deploy.sh keeps of backend/scripts/billing-flag-matrix.ts:
//   { matrix: { <shopId>: { <featureKey>: boolean } }, shop, shopfeatureoverride, shopSuspension }
//
// Why this is not a plain JSON equality (it was, and it failed deterministically for
// any PIN that adds a feature key): BEFORE runs the OLD FeaturesService (N keys) and
// AFTER the NEW one (N+k keys), so the two documents can never be equal. What the
// gate has to prove is that the migrations changed no merchant's EFFECTIVE flags:
//   - every key present on BOTH sides has the same value for every shop (fail closed);
//   - a key present only AFTER (a new feature) resolves FALSE for every shop (a new
//     key must not switch anything on by itself); the set is printed;
//   - a key present only BEFORE (a removed key) is a mismatch, never silently ignored;
//   - the set of shops is the same on both sides;
//   - the shop and shopfeatureoverride checksums are identical (count + BIT_XOR);
//   - shopSuspension (the suspensionReason column, which the billing seed UPDATEs):
//     both sides present => identical; absent BEFORE (the migration adds the column)
//     => AFTER must show no suspended shop without a reason.
//
// Output (the word "key=" is avoided on purpose: the log redactor masks values after key=): one line per problem ("MISMATCH ..."), then a summary. Exit 0 = ok,
// 1 = mismatch, 2 = unreadable input. Never throws on a well-formed document.
'use strict';
const fs = require('node:fs');

function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    process.stderr.write(`cannot read ${file}: ${e.message}\n`);
    process.exit(2);
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Effective-flag changes the owner has explicitly authorised for ONE deploy. Each entry
// allows exactly one key to go from `before` to `after` for any shop and nothing else;
// every other difference still fails. Allowed flips are counted and printed, never
// silent. THE LIST IS EMPTY BY DEFAULT and must be empty on main: add an entry only in
// the PR of the one authorised deploy, and remove it in a follow-up PR right after that
// deploy (a stale entry would let the same flip through unnoticed on a later deploy).
// Shape: { feature: '<registry key>', before: false, after: true }.
// See docs/runbook.md, "Authorised flag changes".
const AUTHORISED_FLIPS = [];

const scalar = (v) => typeof v === 'string' || typeof v === 'number';
function sameChecksum(a, b) {
  return isObj(a) && isObj(b) && scalar(a.count) && scalar(a.bitXor) && scalar(b.count) && scalar(b.bitXor)
    && String(a.count) === String(b.count) && String(a.bitXor) === String(b.bitXor);
}

/** @returns {{ ok: boolean, problems: string[], newKeys: string[], sharedValues: number }} */
function compareMatrix(before, after, flips = AUTHORISED_FLIPS) {
  const problems = [];
  const flipped = {};
  const newKeys = new Set();
  let sharedValues = 0;
  const bm = isObj(before) && isObj(before.matrix) ? before.matrix : null;
  const am = isObj(after) && isObj(after.matrix) ? after.matrix : null;
  if (!bm || !am) {
    return { ok: false, problems: ['MISMATCH matrix missing from the BEFORE or AFTER document'], newKeys: [], sharedValues: 0 };
  }

  const shopIds = [...new Set([...Object.keys(bm), ...Object.keys(am)])].sort((x, y) => Number(x) - Number(y) || x.localeCompare(y));
  for (const id of shopIds) {
    if (!Object.hasOwn(bm, id)) { problems.push(`MISMATCH shop=${id} exists only AFTER`); continue; }
    if (!Object.hasOwn(am, id)) { problems.push(`MISMATCH shop=${id} exists only BEFORE`); continue; }
    const b = bm[id];
    const a = am[id];
    if (!isObj(b) || !isObj(a)) { problems.push(`MISMATCH shop=${id} has a malformed flag map`); continue; }
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
    for (const k of keys) {
      const inB = Object.prototype.hasOwnProperty.call(b, k);
      const inA = Object.prototype.hasOwnProperty.call(a, k);
      if (inB && inA) {
        sharedValues += 1;
        if (b[k] !== a[k] && flips.some((f) => f.feature === k && f.before === b[k] && f.after === a[k])) {
          flipped[k] = (flipped[k] || 0) + 1;
        } else if (b[k] !== a[k]) problems.push(`MISMATCH shop=${id} feature=${k} before=${JSON.stringify(b[k])} after=${JSON.stringify(a[k])}`);
      } else if (inA) {
        newKeys.add(k);
        if (a[k] !== false) problems.push(`MISMATCH shop=${id} feature=${k} is new (absent BEFORE) and resolves ${JSON.stringify(a[k])} AFTER; a new key must be false for every shop`);
      } else {
        problems.push(`MISMATCH shop=${id} feature=${k} existed BEFORE (${JSON.stringify(b[k])}) and is gone AFTER`);
      }
    }
  }
  // Not vacuous: with shops there must be flags to compare, and an empty matrix is only
  // believable for a database whose shop table is empty on both sides.
  if (shopIds.length > 0 && sharedValues === 0) problems.push('MISMATCH no shop/feature value is present on both sides, so nothing was compared');
  if (shopIds.length === 0) {
    const empty = (d) => isObj(d && d.shop) && String(d.shop.count) === '0';
    if (!(empty(before) && empty(after))) problems.push('MISMATCH the matrix is empty but the shop checksum says there are shops');
  }
  return { ok: problems.length === 0, problems, newKeys: [...newKeys].sort(), sharedValues, flipped };
}

function compareChecksums(before, after) {
  const problems = [];
  for (const name of ['shop', 'shopfeatureoverride']) {
    if (!sameChecksum(before && before[name], after && after[name])) {
      const show = (v) => (isObj(v) ? `count=${v.count} bitXor=${v.bitXor}` : 'missing');
      problems.push(`MISMATCH ${name} checksum before=[${show(before && before[name])}] after=[${show(after && after[name])}]`);
    }
  }
  const bs = before ? before.shopSuspension : undefined;
  const as = after ? after.shopSuspension : undefined;
  const has = (v) => isObj(v);
  if (has(bs) && has(as)) {
    if (!(sameChecksum(bs, as) && String(bs.suspendedWithoutReason) === String(as.suspendedWithoutReason))) {
      problems.push(`MISMATCH shop.suspensionReason checksum before=[count=${bs.count} bitXor=${bs.bitXor} withoutReason=${bs.suspendedWithoutReason}] after=[count=${as.count} bitXor=${as.bitXor} withoutReason=${as.suspendedWithoutReason}]`);
    }
  } else if (!has(bs) && has(as)) {
    // the migration adds the column and backfills it for suspended shops
    if (String(as.suspendedWithoutReason) !== '0') {
      problems.push(`MISMATCH shop.suspensionReason: ${as.suspendedWithoutReason} suspended shop(s) have no reason AFTER the backfill`);
    }
  } else if (has(bs) && !has(as)) {
    problems.push('MISMATCH shop.suspensionReason column existed BEFORE and is gone AFTER');
  }
  return problems;
}

function compare(before, after, flips = AUTHORISED_FLIPS) {
  const m = compareMatrix(before, after, flips);
  const problems = [...m.problems, ...compareChecksums(before, after)];
  return { ok: problems.length === 0, problems, newKeys: m.newKeys, sharedValues: m.sharedValues, flipped: m.flipped };
}

module.exports = { compare, compareMatrix, compareChecksums, AUTHORISED_FLIPS };

if (require.main === module) {
  const [bf, af] = process.argv.slice(2);
  if (!bf || !af) {
    process.stderr.write('usage: matrix-diff.js <before.json> <after.json>\n');
    process.exit(2);
  }
  const r = compare(load(bf), load(af));
  for (const p of r.problems) process.stdout.write(`${p}\n`);
  if (r.ok) {
    const fl = Object.entries(r.flipped);
    for (const [k, n] of fl) {
      const f = AUTHORISED_FLIPS.find((x) => x.feature === k);
      process.stdout.write(`billing flag matrix: AUTHORISED FLIP ${k} ${f.before}->${f.after} for ${n} shop(s)\n`);
    }
    process.stdout.write(`billing flag matrix: ${r.sharedValues - fl.reduce((t, [, n]) => t + n, 0)} shared shop/key value(s) identical\n`);
    process.stdout.write(`billing flag matrix: new keys (false for every shop): ${r.newKeys.length ? r.newKeys.join(', ') : 'none'}\n`);
    process.exit(0);
  }
  process.stdout.write(`billing flag matrix: ${r.problems.length} problem(s)\n`);
  process.exit(1);
}
