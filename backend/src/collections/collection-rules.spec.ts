import { BadRequestException } from '@nestjs/common';
import {
  MAX_RULES,
  RULE_FIELDS,
  buildMembershipWhere,
  escapeLike,
  ruleToSql,
  validateRules,
} from './collection-rules';

describe('collection-rules: validation', () => {
  it('accepts every field with each of its own operators', () => {
    for (const [field, def] of Object.entries(RULE_FIELDS)) {
      for (const operator of def.operators) {
        const presence = operator === 'is_set' || operator === 'is_not_set';
        const value = presence
          ? undefined
          : def.valueKind === 'number'
            ? '12.50'
            : def.valueKind === 'integer'
              ? '7'
              : def.valueKind === 'status'
                ? 'Available'
                : 'abc';
        expect(() => validateRules([{ field, operator, value }])).not.toThrow();
      }
    }
  });

  it('rejects an unknown field, including inherited object keys', () => {
    for (const field of ['nope', '__proto__', 'constructor', 'toString', 'p.id; DROP TABLE product', '']) {
      expect(() => validateRules([{ field, operator: 'equals', value: 'x' }])).toThrow(BadRequestException);
    }
  });

  it('rejects an operator the field does not offer', () => {
    expect(() => validateRules([{ field: 'price', operator: 'contains', value: '1' }])).toThrow(/does not support/);
    expect(() => validateRules([{ field: 'title', operator: 'gt', value: '1' }])).toThrow(/does not support/);
    expect(() => validateRules([{ field: 'tag', operator: 'starts_with', value: 'a' }])).toThrow(/does not support/);
    expect(() => validateRules([{ field: 'price', operator: 'is_set' }])).toThrow(/does not support/);
    expect(() => validateRules([{ field: 'title', operator: "equals' OR '1'='1", value: 'x' }])).toThrow(BadRequestException);
  });

  it('numbers must be plain decimals (no exponent, no SQL, no hex)', () => {
    for (const bad of ['1e3', '0x10', '1; DROP TABLE product', '--1', '1.2.3', ' ', '', 'NaN', '1,5', '1234567890123']) {
      expect(() => validateRules([{ field: 'price', operator: 'gt', value: bad }])).toThrow(BadRequestException);
    }
    for (const good of ['0', '25', '25.50', '-3', '999999999999.123456']) {
      expect(() => validateRules([{ field: 'price', operator: 'gt', value: good }])).not.toThrow();
    }
  });

  it('caps the number of conditions and the value length', () => {
    const one = { field: 'title', operator: 'contains', value: 'x' };
    expect(() => validateRules(Array.from({ length: MAX_RULES }, () => one))).not.toThrow();
    expect(() => validateRules(Array.from({ length: MAX_RULES + 1 }, () => one))).toThrow(/at most 20/);
    expect(() => validateRules([{ ...one, value: 'x'.repeat(256) }])).toThrow(/too long/);
  });

  it('status must be a real status; category must be an integer id; presence takes no value', () => {
    expect(() => validateRules([{ field: 'status', operator: 'equals', value: 'Deleted' }])).toThrow(/unknown status/);
    expect(() => validateRules([{ field: 'category', operator: 'equals', value: '1 OR 1=1' }])).toThrow(BadRequestException);
    expect(() => validateRules([{ field: 'compare_at_price', operator: 'is_set', value: '5' }])).toThrow(/takes no value/);
    expect(() => validateRules([{ field: 'title', operator: 'equals' }])).toThrow(/value is required/);
  });
});

describe('collection-rules: SQL building', () => {
  const HOSTILE = [
    "'; DROP TABLE product; --",
    "' OR '1'='1",
    '%',
    '_',
    '!%',
    '\\',
    '`; SELECT SLEEP(5); -- ',
    '$(touch /tmp/x)',
  ];

  it('never puts a value into the SQL text: it is a bound parameter', () => {
    for (const value of HOSTILE) {
      for (const operator of ['equals', 'not_equals', 'starts_with', 'ends_with', 'contains', 'not_contains']) {
        for (const field of ['title', 'product_type', 'brand', 'variant_title']) {
          const f = ruleToSql({ field, operator, value });
          if (value.length > 2) expect(f.sql).not.toContain(value);
          expect(f.sql).not.toMatch(/DROP|SLEEP|touch/);
          expect(f.params).toHaveLength(1);
          expect(String(f.params[0])).toContain(value.replace(/[!%_]/g, ''));
        }
      }
      for (const field of ['tag']) {
        const f = ruleToSql({ field, operator: 'equals', value });
        if (value.length > 2) expect(f.sql).not.toContain(value);
        expect(f.params).toEqual([value]);
      }
    }
  });

  it('LIKE patterns escape %, _ and the escape character, so a value of "%" is a literal percent', () => {
    expect(escapeLike('50%_off!')).toBe('50!%!_off!!');
    const f = ruleToSql({ field: 'title', operator: 'contains', value: '%' });
    expect(f.params).toEqual(['%!%%']);
    expect(f.sql).toContain("ESCAPE '!'");
    expect(ruleToSql({ field: 'title', operator: 'starts_with', value: '_' }).params).toEqual(['!_%']);
    expect(ruleToSql({ field: 'title', operator: 'ends_with', value: 'a%b' }).params).toEqual(['%a!%b']);
  });

  it('numbers are compared as DECIMAL, never as floats', () => {
    const f = ruleToSql({ field: 'price', operator: 'gt', value: '19.99' });
    expect(f.sql).toBe('(p.price IS NOT NULL AND p.price > CAST(? AS DECIMAL(24,6)))');
    expect(f.params).toEqual(['19.99']);
  });

  it('NULL is unknown: every comparison is guarded by IS NOT NULL (not even "is not equal to" matches NULL)', () => {
    for (const [field, operator, value] of [
      ['compare_at_price', 'not_equals', '5'],
      ['compare_at_price', 'lt', '5'],
      ['brand', 'not_equals', 'x'],
      ['brand', 'not_contains', 'x'],
      ['weight', 'not_equals', '1'],
      ['stock', 'lt', '5'],
      ['product_type', 'not_contains', 'x'],
    ] as const) {
      expect(ruleToSql({ field, operator, value }).sql).toMatch(/IS NOT NULL AND/);
    }
  });

  it('is set / is not set is the only way to ask about absence', () => {
    expect(ruleToSql({ field: 'compare_at_price', operator: 'is_set' })).toEqual({ sql: 'p.compareAtPrice IS NOT NULL', params: [] });
    expect(ruleToSql({ field: 'compare_at_price', operator: 'is_not_set' })).toEqual({ sql: 'p.compareAtPrice IS NULL', params: [] });
  });

  it('every sub-select that crosses a table repeats the shop (a rule cannot reach another shop)', () => {
    expect(ruleToSql({ field: 'tag', operator: 'equals', value: 'x' }).sql).toContain('t.shopId = p.shopId');
    expect(ruleToSql({ field: 'category', operator: 'equals', value: '3' }).sql).toContain('c.shopId = p.shopId');
    expect(ruleToSql({ field: 'brand', operator: 'equals', value: 'x' }).sql).toContain('b.shopId = p.shopId');
    expect(ruleToSql({ field: 'stock', operator: 'gt', value: '1' }).sql).toContain('ing.shopId = p.shopId');
  });

  it('the WHERE is scoped to the shop first, joins conditions with AND / OR, and no conditions matches nothing', () => {
    const rules = [
      { field: 'title', operator: 'contains', value: 'rose' },
      { field: 'price', operator: 'lt', value: '100' },
    ];
    const all = buildMembershipWhere(7, { matchMode: 'all', rules }, { onlyAvailable: true });
    expect(all.sql.startsWith('p.shopId = ? AND p.status = \'Available\' AND (')).toBe(true);
    expect(all.sql).toContain(' AND (p.price');
    expect(all.params).toEqual([7, '%rose%', '100']);
    const any = buildMembershipWhere(7, { matchMode: 'any', rules }, { onlyAvailable: false });
    expect(any.sql).toContain(' OR ');
    expect(any.sql).not.toContain("'Available'");
    const none = buildMembershipWhere(7, { matchMode: 'all', rules: [] }, { onlyAvailable: true });
    expect(none.sql).toContain('1 = 0');
    expect(() => buildMembershipWhere(7, { matchMode: 'whatever', rules }, { onlyAvailable: true })).toThrow(BadRequestException);
  });
});
