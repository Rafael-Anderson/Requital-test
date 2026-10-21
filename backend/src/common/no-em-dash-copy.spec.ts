import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// House rule: no em dash (U+2014) in text a customer or merchant reads. These
// are the files whose strings reach people (emails, WhatsApp, errors the
// storefront shows). Comments are exempt, so this reads the syntax tree and
// looks at string and template text only.
const FILES = [
  'orders/order-notifications.service.ts',
  'notify-subscriptions/notify-subscriptions.service.ts',
  'abandoned-carts/abandoned-carts.service.ts',
  'customer-account/customer-account.service.ts',
  'customer-auth/customer-auth.service.ts',
  'gift-cards/gift-cards.service.ts',
  'public/public.service.ts',
  'common/nominatim.ts',
  'auth/auth.service.ts',
];

describe('customer-facing copy', () => {
  it('has no em dash in a string or template literal', () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const file = path.join(__dirname, '..', f);
      const src = fs.readFileSync(file, 'utf8');
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
            `${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`,
          );
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(hits).toEqual([]);
  });
});
