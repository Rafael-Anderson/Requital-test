import 'reflect-metadata';
import {
  buildCollectionPredicate,
  normalizeRule,
  RULE_FIELDS,
} from './collection-rules';

describe('collection rules', () => {
  it('no value ever reaches the SQL text', () => {
    const evil = "x'; DROP TABLE product; --";
    const { sql, params } = buildCollectionPredicate('all', [
      normalizeRule({ field: 'title', operator: 'contains', value: evil }),
      normalizeRule({ field: 'tag', operator: 'eq', value: evil }),
      normalizeRule({ field: 'variant_title', operator: 'neq', value: evil }),
    ]);
    expect(sql).not.toContain('DROP');
    expect(sql).not.toContain(evil);
    expect(params).toContain(`%${evil}%`);
    expect(params.filter((p) => p === evil).length).toBe(2);
  });

  it('a NULL side never matches, also under negative operators', () => {
    const { sql } = buildCollectionPredicate('any', [
      normalizeRule({ field: 'vendor', operator: 'neq', value: 'Acme' }),
      normalizeRule({ field: 'compare_at_price', operator: 'neq', value: '1' }),
    ]);
    expect(sql.match(/IS TRUE/g)?.length).toBe(2);
  });

  it('an empty rule list matches nothing', () => {
    expect(buildCollectionPredicate('all', []).sql).toBe('1 = 0');
  });

  it('money compares as exact decimal', () => {
    const { sql } = buildCollectionPredicate('all', [
      normalizeRule({ field: 'price', operator: 'gt', value: '10.505' }),
    ]);
    expect(sql).toContain('CAST(? AS DECIMAL(40, 6))');
  });

  it('rejects unknown fields, wrong operators and bad values', () => {
    expect(() => normalizeRule({ field: 'id', operator: 'eq', value: '1' })).toThrow();
    expect(() => normalizeRule({ field: 'title', operator: 'gt', value: '1' })).toThrow();
    expect(() => normalizeRule({ field: 'price', operator: 'gt', value: '1e3' })).toThrow();
    expect(() => normalizeRule({ field: 'stock', operator: 'lt', value: '1.5' })).toThrow();
    expect(() => normalizeRule({ field: 'title', operator: 'eq', value: '  ' })).toThrow();
    expect(() => normalizeRule({ field: '__proto__', operator: 'eq', value: 'a' })).toThrow();
  });

  it('exposes exactly the supported attributes', () => {
    expect(Object.keys(RULE_FIELDS).sort()).toEqual(
      [
        'category', 'compare_at_price', 'price', 'product_type', 'status',
        'stock', 'tag', 'title', 'variant_title', 'vendor', 'weight',
      ].sort(),
    );
  });
});
