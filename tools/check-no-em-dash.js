#!/usr/bin/env node
// House rule: no em dash (U+2014) in anything a person reads (UI copy, errors,
// WhatsApp/email text, invoice text). Comments are exempt, so this parses each
// file with TypeScript and looks only at string literals, template text and
// JSX text. Scans backend/src, admin and storefront (app, components, lib),
// non-test files. Uses backend's `typescript` (CI installs only backend).
//
//   node tools/check-no-em-dash.js            scan
//   node tools/check-no-em-dash.js --self-test prove the scanner works
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ts = require(path.join(ROOT, 'backend', 'node_modules', 'typescript'));

const DASH = '—';

// repo-relative path -> reason this file may keep an em dash in a string.
// A stale entry (file no longer has a hit) fails the run.
const ALLOWLIST = {};

const ROOTS = [
  'backend/src',
  'admin/app', 'admin/components', 'admin/lib',
  'storefront/app', 'storefront/components', 'storefront/lib',
];

function findHits(file, src) {
  if (!src.includes(DASH) && !src.includes('\\u2014') && !/\\u\{0*2014\}/.test(src)) return [];
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const lines = [];
  const visit = (n) => {
    const isText =
      ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) ||
      ts.isJsxText(n);
    if (isText && (n.text.includes(DASH) || n.getText(sf).includes(DASH))) {
      const t = n.getText(sf);
      let i = t.indexOf(DASH);
      if (i === -1) lines.push(sf.getLineAndCharacterOfPosition(n.getStart()).line + 1); // escaped form
      for (; i !== -1; i = t.indexOf(DASH, i + 1)) {
        lines.push(sf.getLineAndCharacterOfPosition(n.getStart() + i).line + 1);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return lines;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(spec|test|e2e-spec)\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

function selfTest() {
  const cases = [
    ['string literal', 'a.ts', `const a = "x ${DASH} y";`, 1],
    ['template literal', 'a.ts', 'const a = `x ${1} ' + DASH + ' y`;', 1],
    ['no-substitution template', 'a.ts', 'const a = `x ' + DASH + ' y`;', 1],
    ['JSX text', 'a.tsx', `const a = <p>x ${DASH} y</p>;`, 1],
    ['JSX attribute', 'a.tsx', `const a = <p title="x ${DASH} y" />;`, 1],
    ['line comment ignored', 'a.ts', `// x ${DASH} y\nconst a = 1;`, 0],
    ['block comment ignored', 'a.ts', `/* x ${DASH} y */ const a = 1;`, 0],
    ['JSX comment ignored', 'a.tsx', `const a = <p>{/* x ${DASH} y */}hi</p>;`, 0],
    ['escaped literal caught', 'a.ts', 'const a = "x \\u2014 y";', 1],
  ];
  let bad = 0;
  for (const [name, file, src, want] of cases) {
    const got = findHits(file, src).length;
    if (got !== want) { console.error(`self-test FAIL: ${name} (want ${want}, got ${got})`); bad++; }
  }
  if (bad) process.exit(1);
  console.log(`self-test ok (${cases.length} cases)`);
}

if (process.argv.includes('--self-test')) { selfTest(); process.exit(0); }

const hitsByFile = {};
for (const f of ROOTS.flatMap((r) => walk(path.join(ROOT, r)))) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  const lines = findHits(f, fs.readFileSync(f, 'utf8'));
  if (lines.length) hitsByFile[rel] = lines;
}

let fail = false;
for (const [rel, lines] of Object.entries(hitsByFile)) {
  if (ALLOWLIST[rel]) continue;
  fail = true;
  console.error(`em dash in user-facing text: ${rel}:${lines.join(',')}`);
}
for (const rel of Object.keys(ALLOWLIST)) {
  if (!hitsByFile[rel]) { fail = true; console.error(`stale ALLOWLIST entry (no hit left): ${rel}`); }
}
if (fail) {
  console.error('\nUse a period, comma, colon, semicolon or parentheses instead of an em dash.');
  process.exit(1);
}
console.log('no-em-dash: ok');
