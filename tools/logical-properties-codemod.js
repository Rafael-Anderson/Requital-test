#!/usr/bin/env node
/*
 * Logical-properties codemod (audit §6-C step 1). Rewrites physical (left/right)
 * Tailwind utilities, inline-style props and hand-written CSS declarations to
 * their logical (start/end) equivalents. A no-op in LTR; it is the prerequisite
 * for RTL. Idempotent: a second run changes nothing.
 *
 *   node tools/logical-properties-codemod.js --dry-run          list every change
 *   node tools/logical-properties-codemod.js                    apply
 *   node tools/logical-properties-codemod.js --verify           (with either) compile every
 *                                                               target class with the installed Tailwind and fail if one emits no CSS
 *   node tools/logical-properties-codemod.js --exceptions       list every physical class left on purpose
 *   node tools/logical-properties-codemod.js --check            guardrail: exit 1 (and list) if any physical utility has crept back in
 *
 * Scope: admin/ and storefront/ app, components and lib (.ts .tsx .css). Test files are
 * included only because a test may assert a class string; the patterns only match
 * class-shaped tokens, so nothing else in them changes.
 *
 * Deliberately NOT swapped (see docs/handoff/wc.md for the reasoning):
 *   - left-*  / right-*  in a class string that also carries a translate-x utility
 *     (centring `left-1/2 -translate-x-1/2`, slide-in drawers): the physical edge is the
 *     design, and the translate is RTL step 2.
 *   - CSS declarations in a rule that also rotates/translates (diagonal corner ribbons, centring).
 *   - origin-left / object-left / bg-left / translate-x / transform-origin (no logical form).
 *   - `left:` / `right:` keys in measured-rect style objects (tooltips, sliders, charts).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['admin', 'storefront'].flatMap((a) => ['app', 'components', 'lib'].map((d) => path.join(ROOT, a, d)));
const args = new Set(process.argv.slice(2));
const LIST_EXC = args.has('--exceptions');
const CHECK = args.has('--check');
const DRY = args.has('--dry-run') || LIST_EXC || CHECK;
const VERIFY = args.has('--verify');

// ---------------------------------------------------------------- class tokens
const SP = String.raw`(?:\d+(?:\.\d+)?(?:/\d+)?|px|auto|full|\[[^\s\]]*\]|\([^\s)]*\))`;
const RADIUS = String.raw`(?:-(?:none|xs|sm|md|lg|xl|2xl|3xl|4xl|full|\[[^\s\]]*\]|\([^\s)]*\)))?`;
const BORDER = String.raw`(?:-[\w./\[\]()#%,-]+)?`;
// [source for the physical utility, physical -> logical rewrite]
const RULES = [
  [String.raw`(?:ml|mr|pl|pr|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-${SP}`, (u) => u.replace(/^(scroll-)?([mp])([lr])/, (_, s, mp, lr) => `${s || ''}${mp}${lr === 'l' ? 's' : 'e'}`)],
  [String.raw`(?:left|right)-${SP}`, (u) => (u.startsWith('left') ? 'start' : 'end') + u.slice(u.indexOf('-')), 'position'],
  [String.raw`(?:text-left|text-right|float-left|float-right|clear-left|clear-right)`, (u) => u.replace(/left$/, 'start').replace(/right$/, 'end')],
  [String.raw`rounded-(?:l|r)${RADIUS}`, (u) => u.replace(/^rounded-l/, 'rounded-s').replace(/^rounded-r/, 'rounded-e')],
  [String.raw`rounded-(?:tl|tr|bl|br)${RADIUS}`, (u) => u.replace(/^rounded-tl/, 'rounded-ss').replace(/^rounded-tr/, 'rounded-se').replace(/^rounded-bl/, 'rounded-es').replace(/^rounded-br/, 'rounded-ee')],
  [String.raw`border-(?:l|r)${BORDER}`, (u) => u.replace(/^border-l/, 'border-s').replace(/^border-r/, 'border-e')],
];
const RULE_RES = RULES.map(([src, fn, kind]) => ({ re: new RegExp(`^${src}$`), fn, kind }));
// Candidate token: a run of non-space, non-quote characters that starts after whitespace, a quote or a backtick.
const TOKEN_RE = /(?<=^|[\s"'`])[^\s"'`]+/g;

function splitVariants(tok) {
  let depth = 0, cut = -1;
  for (let i = 0; i < tok.length; i++) {
    const c = tok[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ':' && depth === 0) cut = i;
  }
  return [tok.slice(0, cut + 1), tok.slice(cut + 1)];
}
function swapToken(tok) {
  // `.left-5` inside a querySelector string (tests assert class strings this way)
  if (tok[0] === '.') { const r = swapToken(tok.slice(1)); return r && { ...r, out: '.' + r.out }; }
  const [variants, rest] = splitVariants(tok);
  const [, b1, neg, util, b2] = /^(!?)(-?)(.*?)(!?)$/.exec(rest);
  for (const { re, fn, kind } of RULE_RES) if (re.test(util)) return { kind, out: `${variants}${b1}${neg}${fn(util)}${b2}` };
  return null;
}

// Physical edges kept on purpose where the string-level translate-x heuristic cannot see why
// (the translate lives in another literal / line). `line` is a substring of the source line.
const KEEP_PHYSICAL = [
  { file: 'storefront/components/CartDrawer.tsx', line: 'absolute top-0 right-0 h-full', reason: 'cart drawer slides in from the physical right edge (translate-x-full when closed)' },
  { file: 'storefront/components/MobileNav.tsx', line: 'inset-y-0 left-0 w-[82vw]', reason: 'mobile nav drawer slides in from the physical left edge (-translate-x-full when closed)' },
  { file: 'admin/components/ui/Toggle.tsx', line: 'absolute top-0.5 left-0.5 size-5', reason: 'switch thumb is anchored left and moved by translate-x-5; mirrors with the translate in RTL step 2' },
  { file: 'admin/components/auth/AuthCard.tsx', line: '-top-16 -right-12', reason: 'decorative blurred glow anchored to the physical top-right corner' },
  { file: 'storefront/lib/product-badge.ts', line: '', reason: 'merchant-named physical badge corners (top_left/top_right...) coupled to the rotated ribbon CSS (.theme-badge-ribbon--*)' },
  { file: 'storefront/lib/product-badge.test.ts', line: '', reason: 'asserts the physical badge corner classes above' },
  { file: 'storefront/components/WishlistButton.tsx', line: 'absolute top-2 left-2', reason: 'top-left heart is placed against the physical badge corners (badges avoid it by construction)' },
  { file: 'storefront/components/ProductCard.tsx', line: 'absolute top-2 right-2', reason: 'legacy "Out of stock" pill shares the physical top-right badge corner' },
];
function keepPhysical(file, src, offset) {
  const ls = src.lastIndexOf('\n', offset) + 1;
  let le = src.indexOf('\n', offset);
  if (le < 0) le = src.length;
  const line = src.slice(ls, le);
  return KEEP_PHYSICAL.find((k) => k.file === file && line.includes(k.line));
}

function stringBounds(src, idx) {
  // nearest quote/backtick on the same line on each side: an approximation of "the class string"
  const ls = src.lastIndexOf('\n', idx) + 1;
  let le = src.indexOf('\n', idx);
  if (le < 0) le = src.length;
  const line = src.slice(ls, le);
  const rel = idx - ls;
  const q = /["'`]/g;
  let m, lo = ls, hi = le;
  const marks = [];
  while ((m = q.exec(line))) marks.push(m.index);
  for (const p of marks) { if (p < rel) lo = ls + p; else { hi = ls + p; break; } }
  return src.slice(lo, hi);
}

function transformClasses(src, file, changes, exceptions) {
  return src.replace(TOKEN_RE, (full, offset) => {
    const r = swapToken(full);
    if (!r) return full;
    const keep = keepPhysical(file, src, offset);
    if (keep) {
      exceptions.push({ file, text: full, reason: keep.reason });
      return full;
    }
    if (r.kind === 'position' && /translate-x/.test(stringBounds(src, offset))) {
      exceptions.push({ file, text: full, reason: 'positioning coupled to translate-x (centring or slide-in drawer)' });
      return full;
    }
    changes.push({ file, from: full, to: r.out, cls: true });
    return r.out;
  });
}

// ------------------------------------------------------------ inline-style props
const STYLE_PROPS = {
  marginLeft: 'marginInlineStart', marginRight: 'marginInlineEnd',
  paddingLeft: 'paddingInlineStart', paddingRight: 'paddingInlineEnd',
  borderLeft: 'borderInlineStart', borderRight: 'borderInlineEnd',
  borderLeftWidth: 'borderInlineStartWidth', borderRightWidth: 'borderInlineEndWidth',
  borderLeftColor: 'borderInlineStartColor', borderRightColor: 'borderInlineEndColor',
  borderTopLeftRadius: 'borderStartStartRadius', borderTopRightRadius: 'borderStartEndRadius',
  borderBottomLeftRadius: 'borderEndStartRadius', borderBottomRightRadius: 'borderEndEndRadius',
};
function transformStyleProps(src, file, changes) {
  // property keys / assignments only: `paddingLeft:` or `style.paddingLeft =`
  const re = new RegExp(String.raw`(?<![\w$])(${Object.keys(STYLE_PROPS).join('|')})(?=\s*:|\s*=[^=])`, 'g');
  src = src.replace(re, (m, p, offset) => {
    // `.paddingLeft` on a read (e.g. spacing.left) is not an assignment target we own
    if (src[offset - 1] === '.' && !/style\s*$/.test(src.slice(Math.max(0, offset - 8), offset - 1))) return m;
    changes.push({ file, from: m, to: STYLE_PROPS[p] });
    return STYLE_PROPS[p];
  });
  // reads/writes through an object literally named `style` (`expect(style.paddingLeft)`, `style.paddingLeft = ...`)
  src = src.replace(new RegExp(String.raw`(\bstyle\.)(${Object.keys(STYLE_PROPS).join('|')})\b`, 'g'), (m, pre, p) => {
    changes.push({ file, from: m, to: pre + STYLE_PROPS[p] });
    return pre + STYLE_PROPS[p];
  });
  return src;
}

// ------------------------------------------------------------------------- CSS
const CSS_PROPS = [
  [/margin-left/g, 'margin-inline-start'], [/margin-right/g, 'margin-inline-end'],
  [/padding-left/g, 'padding-inline-start'], [/padding-right/g, 'padding-inline-end'],
  [/border-left/g, 'border-inline-start'], [/border-right/g, 'border-inline-end'],
  [/border-top-left-radius/g, 'border-start-start-radius'], [/border-top-right-radius/g, 'border-start-end-radius'],
  [/border-bottom-left-radius/g, 'border-end-start-radius'], [/border-bottom-right-radius/g, 'border-end-end-radius'],
];
function transformCssPositionsAndAlign(src, file, changes, exceptions) {
  return src.replace(/\{([^{}]*)\}/g, (blk, body) => {
    // theme-wishlist-ring centres via `left:50%` + a keyframe translate(-50%,-50%) the block itself cannot show
    const coupled = /rotate\(|translate|animation:[^;]*theme-wishlist-ring/.test(body);
    const out = body
      .replace(/(^|[;\s])(left|right)(\s*:)/g, (m, pre, p, colon) => {
        if (coupled) { exceptions.push({ file, text: `${p}${colon}`, reason: 'CSS positioning in a rule that also rotates/translates' }); return m; }
        const to = p === 'left' ? 'inset-inline-start' : 'inset-inline-end';
        changes.push({ file, from: p, to });
        return `${pre}${to}${colon}`;
      })
      .replace(/(^|[;\s])(text-align|float|clear)(\s*:\s*)(left|right)\b/g, (m, pre, p, colon, v) => {
        const to = p === 'text-align' ? (v === 'left' ? 'start' : 'end') : v === 'left' ? 'inline-start' : 'inline-end';
        changes.push({ file, from: `${p}: ${v}`, to: `${p}: ${to}` });
        return `${pre}${p}${colon}${to}`;
      });
    return `{${out}}`;
  });
}
function cssPass(src, file, changes, exceptions) {
  // simple property renames (value untouched)
  src = src.replace(/\{([^{}]*)\}/g, (blk, body) => {
    let out = body;
    for (const [re, to] of CSS_PROPS) {
      out = out.replace(new RegExp(String.raw`(^|[;\s])${re.source}(?=\s*:)`, 'g'), (m, pre) => {
        changes.push({ file, from: m.trim(), to });
        return `${pre}${to}`;
      });
    }
    return `{${out}}`;
  });
  return transformCssPositionsAndAlign(src, file, changes, exceptions);
}

// ------------------------------------------------------------------------ main
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const changes = [];
const exceptions = [];
let filesChanged = 0;
for (const f of DIRS.flatMap((d) => walk(d))) {
  const rel = path.relative(ROOT, f);
  const before = fs.readFileSync(f, 'utf8');
  let after = before;
  if (f.endsWith('.css')) after = cssPass(after, rel, changes, exceptions);
  else {
    after = transformClasses(after, rel, changes, exceptions);
    after = transformStyleProps(after, rel, changes);
  }
  if (after !== before) {
    filesChanged++;
    if (!DRY) fs.writeFileSync(f, after);
  }
}

if (CHECK && changes.length) {
  for (const c of changes) console.error(`${c.file}: ${c.from} -> ${c.to}`);
  console.error(`\nlogical-properties check FAILED: ${changes.length} physical utilities/properties. Run: node tools/logical-properties-codemod.js`);
  process.exit(1);
}
if (LIST_EXC) for (const e of exceptions) console.log(`EXCEPTION ${e.file}: ${e.text}  (${e.reason})`);
else if (DRY) for (const c of changes) console.log(`${c.file}: ${c.from} -> ${c.to}`);

const classTargets = [...new Set(changes.filter((c) => c.cls).map((c) => c.to))];
console.error(`\n${DRY ? '[dry-run] ' : ''}${filesChanged} files, ${changes.length} swaps, ${exceptions.length} exceptions left physical`);

if (VERIFY) {
  (async () => {
    const { compile } = await import(require.resolve('@tailwindcss/node', { paths: [path.join(ROOT, 'storefront')] }));
    const compiler = await compile('@import "tailwindcss";', { base: path.join(ROOT, 'storefront'), onDependency() {} });
    const bare = classTargets.map((t) => t.replace(/^.*:/, '').replace(/^!|!$/g, ''));
    const css = compiler.build([...new Set(bare)]);
    const missing = [...new Set(bare)].filter((c) => !css.includes(CSS_ESC(c)));
    if (missing.length) { console.error('VERIFY FAILED: no CSS emitted for', missing.join(' ')); process.exit(1); }
    console.error(`verify ok: ${new Set(bare).size} distinct target utilities all emit CSS`);
  })();
}
function CSS_ESC(c) {
  return '.' + c.replace(/[^\w-]/g, (ch) => '\\' + ch);
}
