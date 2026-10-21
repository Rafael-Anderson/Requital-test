import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// House rule: no em dash (U+2014) in anything a shopper can read. Comments are
// exempt, so this walks the syntax tree and only looks at string literals,
// template text and JSX text.
const ROOTS = ["app", "components", "lib"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("storefront copy", () => {
  it("has no em dash in a string literal or JSX text", () => {
    const hits: string[] = [];
    for (const f of ROOTS.flatMap((r) => walk(path.join(__dirname, "..", r)))) {
      const src = fs.readFileSync(f, "utf8");
      if (!src.includes("—")) continue;
      const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (n: ts.Node) => {
        const isText =
          ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n);
        if (isText && n.text.includes("—")) {
          hits.push(`${path.relative(path.join(__dirname, ".."), f)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(hits).toEqual([]);
  });
});
