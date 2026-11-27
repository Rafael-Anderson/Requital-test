import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ORDER_SOURCES,
  effectiveOrderSourceSql,
  orderSourceSortSql,
  sourceForMarketplaceChannel,
} from './order-sources';

// The admin and storefront copies are hand-mirrored (the apps share no code).
// Read them as text and compare every field of every entry, in order.
function entriesFrom(text: string) {
  const block = text.slice(
    text.indexOf('ORDER_SOURCES = ['),
    text.indexOf('] as const'),
  );
  const field = (name: string) =>
    [...block.matchAll(new RegExp(`${name}: (?:["']([^"']*)["']|(null))`, 'g'))].map(
      (m) => (m[2] === 'null' ? null : m[1]),
    );
  const keys = field('key');
  return keys.map((key, i) => ({
    key,
    label: field('label')[i],
    tag: field('tag')[i],
    tone: field('tone')[i],
    icon: field('icon')[i],
    channel: field('channel')[i],
  }));
}

describe('order source registry', () => {
  const canonical = ORDER_SOURCES.map((s) => ({ ...s }));

  it.each([
    ['admin', '../../../admin/lib/order-sources.ts'],
    ['storefront', '../../../storefront/lib/order-sources.ts'],
  ])('the %s mirror has the same entries in the same order', (_app, rel) => {
    const text = readFileSync(join(__dirname, rel), 'utf8');
    expect(entriesFrom(text)).toEqual(canonical);
  });

  it('has Website, Custom order, Talabat and Deliveroo, keys unique', () => {
    expect(ORDER_SOURCES.map((s) => s.key)).toEqual([
      'website',
      'custom',
      'talabat',
      'deliveroo',
    ]);
    expect(new Set(ORDER_SOURCES.map((s) => s.key)).size).toBe(ORDER_SOURCES.length);
  });

  it('maps a marketplace channel to its source, and nothing else', () => {
    expect(sourceForMarketplaceChannel('talabat')).toBe('talabat');
    expect(sourceForMarketplaceChannel('deliveroo')).toBe('deliveroo');
    expect(sourceForMarketplaceChannel('stub_marketplace')).toBeNull();
    expect(sourceForMarketplaceChannel('storefront')).toBeNull();
  });

  it('prefers the stored column and checks the marketplace link, in SQL', () => {
    const sql = effectiveOrderSourceSql('o');
    expect(sql.startsWith('COALESCE(o.source,')).toBe(true);
    expect(sql).toContain(
      "WHEN o.channel = 'talabat' AND EXISTS (SELECT 1 FROM channelorder co WHERE co.orderId = o.id AND co.shopId = o.shopId) THEN 'talabat'",
    );
    expect(sql).toContain("ELSE 'website' END)");
    expect(() => effectiveOrderSourceSql('o; DROP')).toThrow();
  });

  it('sorts in registry order, then newest first, then id', () => {
    expect(orderSourceSortSql('o')).toMatch(
      /^FIELD\(COALESCE\(o\.source,[\s\S]*\), 'website', 'custom', 'talabat', 'deliveroo'\) ASC, o\.createdAt DESC, o\.id DESC$/,
    );
  });
});
