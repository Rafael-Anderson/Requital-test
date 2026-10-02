#!/usr/bin/env node
// Nested-pool-connection guardrail (CLAUDE.md "Nested-pool-connection rule").
//
// Nothing inside a `this.db.transaction(async (conn) => ...)` callback may
// touch the pool: it asks for a SECOND connection while holding one, and with
// DB_POOL_SIZE (default 5) concurrent requests all waiting, the whole API
// hangs. Use the transaction's `conn`, or read before opening the transaction.
//
// Heuristic (comment/string-blanking lexer + brace matching, not a real
// parser, same philosophy as check-outlet-scoping.js). For every backend/src
// non-spec .ts file it finds each `this.db.transaction(` call and flags, inside
// its callback:
//   1. a direct pool use: `this.db.query/execute/transaction(`, `this.db.pool`,
//      `this.pool.`;
//   2. a call `this.[svc.]helper(...)` to a method that (transitively) uses the
//      pool and takes no connection parameter, unless the call passes
//      `conn`/`tx`/`exec` as an argument.
// A helper name counts as pool-using only when EVERY method of that name in the
// codebase is (so a common name like `findOne` can't produce a false positive;
// the cost is a possible miss, which the review rule still covers).
// Known blind spots: SQL template-literal `${...}` interpolations are blanked,
// and calls through a local alias/closure are not followed.
//
// Genuinely safe cases go in ALLOWLIST as { key: "path/under/backend/src:method", reason }. Run: node tools/check-nested-pool.js   (self-test: --self-test)

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "backend", "src");

const ALLOWLIST = [
  // { key: "orders/orders.service.ts:someMethod", reason: "why this cannot hang the pool" },
];

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "function", "return", "constructor", "super"]);
const CONN_PARAM = /\b(conn|tx|trx|exec|connection)\b|PoolConnection/;
const POOL_RE = /\bthis\.db\.(?:query|execute|transaction|pool)\b|\bthis\.pool\b/;

// Blank comments and string/template contents (keeps length and newlines, so
// indexes and line numbers still match the original).
function blank(src) {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && n === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
      out += "  "; i += 2;
    } else if (c === "'" || c === '"' || c === "`") {
      out += c; i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") { out += "  "; i += 2; continue; }
        out += src[i] === "\n" ? "\n" : " "; i++;
      }
      out += c; i++;
    } else { out += c; i++; }
  }
  return out;
}

// index of the bracket matching the opener at `i`, or -1
function match(s, i) {
  const open = s[i], close = { "(": ")", "{": "}" }[open];
  let d = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === open) d++;
    else if (s[k] === close && --d === 0) return k;
  }
  return -1;
}

const lineOf = (s, i) => s.slice(0, i).split("\n").length;

function methodsOf(file, s) {
  const out = [];
  const re = /(?:^|\n)[ \t]*(?:(?:private|public|protected|static|async|readonly)\s+)*([A-Za-z_]\w*)\s*(?:<[^(){}]*>)?\(/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[1];
    if (KEYWORDS.has(name)) continue;
    const po = m.index + m[0].length - 1;
    const pc = match(s, po);
    if (pc < 0) continue;
    const bo = s.indexOf("{", pc);
    const between = s.slice(pc + 1, bo);
    if (bo < 0 || /[;=]/.test(between.replace(/=>/g, ""))) continue; // a call or declaration, not a definition
    const bc = match(s, bo);
    if (bc < 0) continue;
    out.push({ file, name, params: s.slice(po + 1, pc), bodyStart: bo, bodyEnd: bc, start: m.index });
  }
  return out;
}

function callsOf(s, a, b, names) {
  const out = [];
  const re = /\bthis\.(?:\w+\.)?(\w+)\s*\(/g;
  re.lastIndex = a;
  let m;
  while ((m = re.exec(s)) && m.index < b) {
    if (!names.has(m[1])) continue;
    const po = m.index + m[0].length - 1;
    const pc = match(s, po);
    if (pc >= 0 && CONN_PARAM.test(s.slice(po, pc))) continue; // passes the connection
    out.push({ name: m[1], index: m.index });
  }
  return out;
}

// files: [{ name: "path/under/src.ts", src }] -> [{ key, file, line, what }]
function analyze(files) {
  const parsed = files.map((f) => ({ name: f.name, s: blank(f.src) }));
  const methods = parsed.flatMap((f) => methodsOf(f.name, f.s).map((m) => ({ ...m, s: f.s })));
  const byName = new Map();
  for (const m of methods) (byName.get(m.name) ?? byName.set(m.name, []).get(m.name)).push(m);

  // fixpoint: names where every definition uses the pool (directly or via another such name) and takes no conn
  const poolNames = new Set();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, defs] of byName) {
      if (poolNames.has(name)) continue;
      const all = defs.every((d) => {
        if (CONN_PARAM.test(d.params)) return false;
        const body = d.s.slice(d.bodyStart, d.bodyEnd);
        return POOL_RE.test(body) || callsOf(d.s, d.bodyStart, d.bodyEnd, poolNames).length > 0;
      });
      if (all) { poolNames.add(name); changed = true; }
    }
  }

  const findings = [];
  for (const f of parsed) {
    const re = /\bthis\.db\.transaction\s*\(/g;
    let m;
    while ((m = re.exec(f.s))) {
      const po = m.index + m[0].length - 1;
      const pc = match(f.s, po);
      if (pc < 0) continue;
      const enclosing = methods.filter((x) => x.file === f.name && x.bodyStart < m.index && m.index < x.bodyEnd).pop();
      const key = `${f.name}:${enclosing ? enclosing.name : "?"}`;
      const body = f.s.slice(po, pc);
      const hits = [];
      const direct = /\bthis\.db\.(?:query|execute|transaction|pool)\b|\bthis\.pool\b/g;
      let d;
      while ((d = direct.exec(body))) hits.push({ i: po + d.index, what: d[0] });
      for (const c of callsOf(f.s, po, pc, poolNames)) hits.push({ i: c.index, what: `this...${c.name}() (uses the pool, no conn passed)` });
      for (const h of hits) findings.push({ key, file: f.name, line: lineOf(f.s, h.i), what: h.what });
    }
  }
  return findings;
}

function selfTest() {
  const bad = `class A { async go() { return this.db.transaction(async (conn) => {
      await conn.query('x');
      const t = await this.helper();
      await this.db.query('SELECT 1');
    }); }
    private async helper() { return this.db.query('SELECT 2'); } }`;
  const good = `class B { async go() { const t = await this.helper();
    return this.db.transaction(async (conn) => {
      await this.helperTx(conn);
      // this.db.query('in a comment')
      await conn.query('this.db.query(in a string)');
    }); }
    private async helper() { return this.db.query('SELECT 2'); }
    private async helperTx(conn) { return conn.query('SELECT 3'); } }`;
  const bf = analyze([{ name: "bad.ts", src: bad }]);
  const gf = analyze([{ name: "good.ts", src: good }]);
  const ok = bf.length === 2 && bf.some((f) => f.what.includes("helper")) && bf.some((f) => f.what === "this.db.query") && gf.length === 0;
  if (!ok) { console.error("check-nested-pool self-test FAILED", JSON.stringify({ bf, gf })); process.exit(1); }
  console.log("check-nested-pool self-test OK");
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".ts") && !e.name.endsWith(".spec.ts") ? [p] : [];
  });
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const files = walk(ROOT).map((p) => ({ name: path.relative(ROOT, p).split(path.sep).join("/"), src: fs.readFileSync(p, "utf8") }));
  const findings = analyze(files).filter((f) => !ALLOWLIST.some((a) => a.key === f.key));
  if (findings.length) {
    console.error("Nested pool use inside db.transaction (use `conn`, or read before the transaction):");
    for (const f of findings) console.error(`  backend/src/${f.file}:${f.line} (${f.key}) ${f.what}`);
    process.exit(1);
  }
  console.log(`check-nested-pool: ${files.length} files scanned, no nested pool use.`);
}
