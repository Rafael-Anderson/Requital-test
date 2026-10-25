import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// House rule: no em dash (U+2014) in text a person reads (errors staff see,
// WhatsApp/email text, invoice text). Comments are exempt, so this reads the
// syntax tree and looks at string and template text only. It walks EVERY
// non-spec file in backend/src; tools/check-no-em-dash.js is the CI twin that
// also covers admin and storefront.
const SRC = path.join(__dirname, '..');
// relative path -> why a string there may keep an em dash (logger/startup only).
const ALLOWLIST: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e.name) && !/\.(spec|e2e-spec)\.ts$/.test(e.name))
      out.push(p);
  }
  return out;
}

describe('user-facing copy', () => {
  it('has no em dash in a string or template literal anywhere in backend/src', () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (ALLOWLIST[rel]) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes('—')) continue;
      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
      const visit = (n: ts.Node) => {
        if (
          (ts.isStringLiteral(n) ||
            ts.isNoSubstitutionTemplateLiteral(n) ||
            ts.isTemplateHead(n) ||
            ts.isTemplateMiddle(n) ||
            ts.isTemplateTail(n)) &&
          n.text.includes('—')
        ) {
          hits.push(
            `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`,
          );
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(hits).toEqual([]);
  });
});
