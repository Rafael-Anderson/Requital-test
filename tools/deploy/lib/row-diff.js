#!/usr/bin/env node
// Row-level comparison for deploy.sh's BEFORE/AFTER data-integrity gate.
//
// deploy.sh dumps, for each protected table, one line per row to a private temp
// file BEFORE the migrations and again AFTER:
//     id <TAB> md5-of-the-explicit-columns [<TAB> updatedAt] [<TAB> parentOrderId]
// A migration that only ADDS things must leave every one of those rows exactly
// as it was. But the shop keeps trading during a deploy that takes minutes, so
// some rows legitimately change in the window. A changed (or vanished) row is
// TOLERATED only when there is positive evidence of a normal application edit:
//   - the table has an updatedAt and the row's updatedAt moved since BEFORE, or
//   - the row belongs to an order (parent) that was itself edited in the window
//     (an order edit replaces its orderitem rows wholesale).
// Anything else is FATAL: a row whose content changed with no sign that the
// application touched it is what a damaging migration looks like. (Comparing
// updatedAt before/after, instead of against a wall-clock T0, avoids any
// time-zone or clock-skew question between the DB and this host.)
//
//   node row-diff.js touched <before.tsv> <after.tsv>
//        prints the ids whose row changed or vanished (the "edited orders")
//   node row-diff.js compare <before.tsv> <after.tsv> [--updated] [--parent] [--touched <ids-file>]
//        prints "checked=N changed=N tolerated=N fatal=N" and the first fatal
//        ids; exit 1 if any row is fatal
//   node row-diff.js --self-test
'use strict';
const fs = require('fs');

function parse(text, { updated = false, parent = false } = {}) {
  const rows = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    let i = 2;
    rows.set(f[0], {
      hash: f[1],
      updated: updated ? f[i++] : undefined,
      parent: parent ? f[i++] : undefined,
    });
  }
  return rows;
}

function touchedIds(beforeText, afterText) {
  const before = parse(beforeText);
  const after = parse(afterText);
  const out = [];
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a || a.hash !== b.hash) out.push(id);
  }
  return out;
}

function compare(beforeText, afterText, opts = {}) {
  const { updated = false, parent = false, touched = new Set() } = opts;
  const before = parse(beforeText, { updated, parent });
  const after = parse(afterText, { updated, parent });
  let changed = 0;
  let tolerated = 0;
  const fatal = [];
  for (const [id, b] of before) {
    const a = after.get(id);
    if (a && a.hash === b.hash) continue;
    changed++;
    const touchedByApp =
      (updated && a && a.updated !== b.updated) ||
      (parent && touched.has(b.parent));
    if (touchedByApp) tolerated++;
    else fatal.push(id);
  }
  return { checked: before.size, changed, tolerated, fatal };
}

function selfTest() {
  const B = '1\th1\tU1\t10\n2\th2\tU2\t10\n3\th3\tU3\t11\n';
  const P = '1\th1\t10\n2\th2\t10\n3\th3\t11\n';
  const cases = [
    ['identical', () => compare(B, B, { updated: true }).fatal.length === 0],
    ['changed with newer updatedAt is tolerated', () => {
      const r = compare(B, '1\tX\tU9\t10\n2\th2\tU2\t10\n3\th3\tU3\t11\n', { updated: true });
      return r.changed === 1 && r.tolerated === 1 && r.fatal.length === 0;
    }],
    ['changed with the same updatedAt is fatal', () => {
      const r = compare(B, '1\tX\tU1\t10\n2\th2\tU2\t10\n3\th3\tU3\t11\n', { updated: true });
      return r.fatal.join() === '1';
    }],
    ['vanished row is fatal without a touched parent', () => compare(P, '2\th2\t10\n3\th3\t11\n', { parent: true }).fatal.join() === '1'],
    ['vanished row of a touched parent is tolerated', () => compare(P, '2\th2\t10\n3\th3\t11\n', { parent: true, touched: new Set(['10']) }).fatal.length === 0],
    ['touched ids', () => touchedIds('1\ta\n2\tb\n', '1\ta\n2\tc\n').join() === '2'],
    ['new rows after BEFORE are ignored', () => compare(B, B + '4\th4\tU4\t12\n', { updated: true }).checked === 3],
  ];
  let bad = 0;
  for (const [label, fn] of cases) if (!fn()) { bad++; console.error(`self-test FAIL: ${label}`); }
  if (bad) process.exit(1);
  console.log(`row-diff self-test passed (${cases.length} cases)`);
}

if (require.main === module) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === '--self-test') {
    selfTest();
  } else if (mode === 'touched' && rest.length === 2) {
    const ids = touchedIds(fs.readFileSync(rest[0], 'utf8'), fs.readFileSync(rest[1], 'utf8'));
    process.stdout.write(ids.map((i) => `${i}\n`).join(''));
  } else if (mode === 'compare' && rest.length >= 2) {
    const flags = rest.slice(2);
    const ti = flags.indexOf('--touched');
    const touched = new Set(
      ti >= 0 ? fs.readFileSync(flags[ti + 1], 'utf8').split('\n').filter(Boolean) : [],
    );
    const r = compare(fs.readFileSync(rest[0], 'utf8'), fs.readFileSync(rest[1], 'utf8'), {
      updated: flags.includes('--updated'),
      parent: flags.includes('--parent'),
      touched,
    });
    console.log(`checked=${r.checked} changed=${r.changed} tolerated=${r.tolerated} fatal=${r.fatal.length}`);
    if (r.fatal.length) {
      console.log(`fatal ids (first 5): ${r.fatal.slice(0, 5).join(',')}`);
      process.exit(1);
    }
  } else {
    console.error('Usage: row-diff.js touched <before> <after> | compare <before> <after> [--updated] [--parent] [--touched <file>] | --self-test');
    process.exit(2);
  }
}

module.exports = { parse, touchedIds, compare };
