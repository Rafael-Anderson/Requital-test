#!/usr/bin/env node
// Static heuristic for the two *mechanically checkable* causes of a form
// section leaving dead space on the right: a hardcoded non-responsive
// `grid-cols-N` (N>=2), and a text-entry element with a fixed Tailwind
// width instead of `w-full`. Grep-based, not an AST parse — same "good
// enough for this repo's size" tradeoff as check-page-width.js, and the
// same honesty about it: this catches code-level antipatterns, NOT whether
// a PageShell variant is too narrow for its content (that's a rendered-
// width measurement, a design judgment a static regex can't make — see
// tools/screenshot/measure.js for the runtime check that actually caught
// the ProductForm.tsx `variant="form"` bug this script would have missed,
// since that file used `w-full` inputs and responsive grids throughout;
// the bug was which PageShell variant wrapped them, not any pattern below).
//
// Run: node tools/check-form-width.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SCAN_DIRS = ["admin/app", "admin/components", "storefront/app", "storefront/components"];

const BREAKPOINT_PREFIX = /(?:^|\s)(?:sm|md|lg|xl|2xl):grid-cols-/;
const BARE_GRID_COLS = /(?:^|\s)grid-cols-([2-9]|1[0-9])\b/;

// Input types that are legitimately fixed-size, never full-width.
const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "range", "color", "file", "hidden", "button", "submit"]);
const FIXED_WIDTH_CLASS = /(?:^|\s)w-(\d+|\[[^\]]+\])(?!\S)/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

function findClassNameStrings(src) {
  // className="..." or className={`...`} — only the literal/template parts;
  // a fully dynamic className (e.g. built entirely from a variable) isn't
  // visible to a grep-based check and is out of scope, same limitation
  // check-page-width.js accepts for raw max-w- detection.
  const strings = [];
  const re = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
  let m;
  while ((m = re.exec(src))) strings.push({ text: m[1] ?? m[2] ?? m[3], index: m.index });
  return strings;
}

function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}

function checkNonResponsiveGrid(file, src, violations) {
  for (const { text, index } of findClassNameStrings(src)) {
    if (!BARE_GRID_COLS.test(text)) continue;
    if (BREAKPOINT_PREFIX.test(text)) continue; // has a responsive override somewhere — fine
    violations.push({
      file,
      line: lineOf(src, index),
      kind: "non-responsive-grid-cols",
      detail: text.trim(),
    });
  }
}

function checkFixedWidthInputs(file, src, violations) {
  // Matches <input ...>, <textarea ...>, <select ...> — including
  // self-closing and multi-line attribute lists (JSX rarely puts a bare
  // `>` inside an attribute value in this codebase's style).
  const tagRe = /<(input|textarea|select)\b([^>]*)>/gis;
  let m;
  while ((m = tagRe.exec(src))) {
    const [, tag, attrs] = m;
    const typeMatch = attrs.match(/\btype\s*=\s*["']([a-z]+)["']/i);
    if (typeMatch && NON_TEXT_INPUT_TYPES.has(typeMatch[1].toLowerCase())) continue;

    const classMatch = attrs.match(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/);
    if (!classMatch) continue; // no literal class to check — e.g. relies on a shared wrapper component
    const cls = classMatch[1] ?? classMatch[2] ?? classMatch[3];
    if (/(?:^|\s)w-full\b/.test(cls)) continue;
    if (!FIXED_WIDTH_CLASS.test(cls)) continue;

    violations.push({
      file,
      line: lineOf(src, m.index),
      kind: "fixed-width-input",
      detail: `<${tag}> class="${cls.trim()}"`,
    });
  }
}

const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const violations = [];
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  checkNonResponsiveGrid(file, src, violations);
  checkFixedWidthInputs(file, src, violations);
}

if (violations.length === 0) {
  console.log("check-form-width: no violations — no bare multi-column grid-cols- or fixed-width text inputs found.");
  process.exit(0);
}

console.log(`check-form-width: ${violations.length} possible violation(s):\n`);
for (const v of violations) {
  console.log(`${path.relative(ROOT, v.file).replace(/\\/g, "/")}:${v.line}  [${v.kind}]  ${v.detail}`);
}
process.exit(1);
