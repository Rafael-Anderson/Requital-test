#!/usr/bin/env node
// Guardrail: the UAE Dirham symbol has ONE source of truth (an inline SVG component, see
// storefront/components/CurrencySymbol.tsx and admin/components/CurrencySymbol.tsx). The
// look-alike letters people reach for instead are wrong and must never appear in app source:
//   U+00D0 (Eth, Ð), U+0110 (D with stroke, Đ), U+0189 (African D, Ɖ)
// literally, as a \uXXXX / \u{XXXX} escape, or as an HTML entity (&ETH;, &#208;, &#x110;, ...).
// Scans admin and storefront (app, components, lib, and CSS), including tests. Plain Arabic
// text for dirham is NOT flagged (an ar-locale string is a different thing from the symbol).
//
//   node tools/check-dirham-glyph.js            scan
//   node tools/check-dirham-glyph.js --self-test prove the scanner works
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const ROOTS = [
  'admin/app', 'admin/components', 'admin/lib',
  'storefront/app', 'storefront/components', 'storefront/lib',
];
const EXT = /\.(ts|tsx|js|jsx|css|json)$/;

// repo-relative path -> reason this file may keep one. A stale entry (no hit any more) fails.
const ALLOWLIST = {};

const PATTERNS = [
  [/[ÐĐƉ]/, 'a D-with-a-bar look-alike letter (U+00D0, U+0110 or U+0189)'],
  [/\\u(?:00D0|0110|0189)/i, 'an escape for one of those letters'],
  [/\\u\{0*(?:D0|110|189)\}/i, 'an escape for one of those letters'],
  [/&(?:ETH|Dstrok);/, 'an HTML entity for one of those letters'],
  [/&#0*(?:208|272|393);/, 'a numeric entity for one of those letters'],
  [/&#x0*(?:d0|110|189);/i, 'a hex entity for one of those letters'],
];

function findHits(src) {
  const hits = [];
  src.split('\n').forEach((line, i) => {
    for (const [re, why] of PATTERNS) {
      if (re.test(line)) {
        hits.push({ line: i + 1, why });
        break;
      }
    }
  });
  return hits;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(p, out);
    } else if (EXT.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function scan() {
  const failures = [];
  const seenAllow = new Set();
  for (const r of ROOTS) {
    for (const file of walk(path.join(ROOT, r))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const hits = findHits(fs.readFileSync(file, 'utf8'));
      if (hits.length === 0) continue;
      if (Object.prototype.hasOwnProperty.call(ALLOWLIST, rel)) {
        seenAllow.add(rel);
        continue;
      }
      for (const h of hits) failures.push(`${rel}:${h.line}  ${h.why}`);
    }
  }
  for (const rel of Object.keys(ALLOWLIST)) {
    if (!seenAllow.has(rel)) failures.push(`${rel}  stale allowlist entry (no hit any more); remove it`);
  }
  return failures;
}

function selfTest() {
  const cases = [
    ['literal Eth', 'const s = "Ð 100";', true],
    ['literal stroke D', '<span>Đ</span>', true],
    ['literal african D', '// Ɖ', true],
    ['escape', 'const s = "\\u00D0";', true],
    ['brace escape', 'const s = "\\u{110}";', true],
    ['entity', '<span>&ETH;</span>', true],
    ['numeric entity', '<span>&#208;</span>', true],
    ['hex entity', '<span>&#x189;</span>', true],
    ['plain D', 'const D = "D";', false],
    ['arabic dirham text', 'const s = "د.إ";', false],
    ['ISO code', 'const s = "AED";', false],
    ['accented e', 'const s = "café";', false],
  ];
  let bad = 0;
  for (const [name, src, expected] of cases) {
    const got = findHits(src).length > 0;
    if (got !== expected) {
      console.error(`self-test FAILED: ${name} (expected ${expected}, got ${got})`);
      bad++;
    }
  }
  if (bad) process.exit(1);
  console.log(`check-dirham-glyph self-test: ${cases.length} cases ok`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const failures = scan();
  if (failures.length) {
    console.error('check-dirham-glyph: the Dirham symbol must come from CurrencySymbol, never a look-alike letter:');
    for (const f of failures) console.error('  ' + f);
    process.exit(1);
  }
  console.log('check-dirham-glyph: no look-alike dirham letters in admin/storefront source.');
}
