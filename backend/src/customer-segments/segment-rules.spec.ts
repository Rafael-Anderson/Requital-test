import { BadRequestException } from '@nestjs/common';
import {
  MAX_DEPTH,
  MAX_GROUP_RULES,
  MAX_NODES,
  compileRules,
  parseRules,
} from './segment-rules';

const compile = (input: unknown) => compileRules(parseRules(input));

describe('segment rules: validation', () => {
  it('accepts every field and compiles to parameterised SQL', () => {
    const out = compile({
      op: 'and',
      rules: [
        { field: 'orderCount', cmp: 'gte', value: 3 },
        { field: 'lifetimeSpend', cmp: 'gt', value: '100.5', currency: 'KWD' },
        { field: 'lastOrderDate', cmp: 'before', value: '2026-01-31' },
        { field: 'lastOrderDaysAgo', cmp: 'gt', value: 90 },
        {
          op: 'or',
          rules: [
            { field: 'tag', cmp: 'has', value: 4 },
            { field: 'region', cmp: 'notHas', value: 7 },
            { field: 'consent', cmp: 'is', channel: 'email', value: 'unknown' },
            { field: 'consent', cmp: 'is', channel: 'sms', value: 'granted' },
            { field: 'newsletterSubscriber', cmp: 'is', value: false },
          ],
        },
      ],
    });
    expect(out.params).toEqual([3, 'KWD', '100.5', '2026-01-31 00:00:00', 90, 4, 7, 'email', 'sms', 'granted']);
    // one placeholder per param
    expect(out.sql.match(/\?/g)).toHaveLength(out.params.length);
    expect(out.sql).toContain('NOT EXISTS');
  });

  it('every subquery is re-scoped to the customer shop', () => {
    const out = compile({
      op: 'and',
      rules: [
        { field: 'orderCount', cmp: 'eq', value: 0 },
        { field: 'tag', cmp: 'has', value: 1 },
        { field: 'consent', cmp: 'is', channel: 'email', value: 'granted' },
        { field: 'newsletterSubscriber', cmp: 'is', value: true },
      ],
    });
    const subqueries = out.sql.split('SELECT').slice(1);
    expect(subqueries).toHaveLength(4);
    for (const q of subqueries) expect(q).toMatch(/\.shopId = c\.shopId/);
  });

  it.each([
    ['unknown field', { field: 'passwordHash', cmp: 'eq', value: 'x' }],
    ['unknown key on a leaf', { field: 'orderCount', cmp: 'eq', value: 1, sql: '1=1' }],
    ['unknown key on a group', { op: 'and', rules: [{ field: 'orderCount', cmp: 'eq', value: 1 }], where: '1' }],
    ['bad operator', { field: 'orderCount', cmp: '= 1 OR 1=1 --', value: 1 }],
    ['sql in a number', { field: 'orderCount', cmp: 'eq', value: '1; DROP TABLE customer' }],
    ['sql in a tag id', { field: 'tag', cmp: 'has', value: '1 OR 1=1' }],
    ['float for an integer', { field: 'orderCount', cmp: 'eq', value: 1.5 }],
    ['negative', { field: 'orderCount', cmp: 'eq', value: -1 }],
    ['sql in a currency', { field: 'lifetimeSpend', cmp: 'gt', value: '1', currency: "AED' OR '1'='1" }],
    ['unsupported currency', { field: 'lifetimeSpend', cmp: 'gt', value: '1', currency: 'XXX' }],
    ['missing currency', { field: 'lifetimeSpend', cmp: 'gt', value: '1' }],
    ['sql in an amount', { field: 'lifetimeSpend', cmp: 'gt', value: '1) OR (1=1', currency: 'AED' }],
    ['too many decimals', { field: 'lifetimeSpend', cmp: 'gt', value: '1.2345', currency: 'AED' }],
    ['sql in a date', { field: 'lastOrderDate', cmp: 'before', value: "2026-01-01' OR '1'='1" }],
    ['impossible date', { field: 'lastOrderDate', cmp: 'before', value: '2026-02-31' }],
    ['sql in a channel', { field: 'consent', cmp: 'is', channel: "email' OR '1", value: 'granted' }],
    ['sql in a consent value', { field: 'consent', cmp: 'is', channel: 'email', value: "granted' --" }],
    ['string boolean', { field: 'newsletterSubscriber', cmp: 'is', value: 'true' }],
    ['empty group', { op: 'and', rules: [] }],
    ['non-list rules', { op: 'and', rules: 'x' }],
    ['array root', [{ field: 'orderCount' }]],
    ['null root', null],
    ['string root', "1' OR '1'='1"],
    ['bad op', { op: 'xor', rules: [{ field: 'orderCount', cmp: 'eq', value: 1 }] }],
  ])('rejects %s', (_name, input) => {
    expect(() => parseRules(input)).toThrow(BadRequestException);
  });

  it('refuses a depth bomb at the first level past the limit', () => {
    let node: unknown = { field: 'orderCount', cmp: 'eq', value: 1 };
    for (let i = 0; i < MAX_DEPTH + 1; i += 1) node = { op: 'and', rules: [node] };
    expect(() => parseRules(node)).toThrow(/deeper than/);
    // exactly at the limit is fine
    let ok: unknown = { field: 'orderCount', cmp: 'eq', value: 1 };
    for (let i = 0; i < MAX_DEPTH - 1; i += 1) ok = { op: 'and', rules: [ok] };
    expect(() => parseRules(ok)).not.toThrow();
  });

  it('does not recurse a 100k-deep structure to find out it is too deep', () => {
    let node: unknown = { field: 'orderCount', cmp: 'eq', value: 1 };
    for (let i = 0; i < 100_000; i += 1) node = { op: 'and', rules: [node] };
    expect(() => parseRules(node)).toThrow(/deeper than/);
  });

  it('caps the width of a group and the total node count', () => {
    const leaf = { field: 'orderCount', cmp: 'eq', value: 1 };
    expect(() =>
      parseRules({ op: 'or', rules: Array.from({ length: MAX_GROUP_RULES + 1 }, () => leaf) }),
    ).toThrow(/more than/);
    const group = { op: 'or', rules: Array.from({ length: MAX_GROUP_RULES }, () => leaf) };
    expect(() =>
      parseRules({ op: 'and', rules: [group, group, group] }),
    ).toThrow(new RegExp(`more than ${MAX_NODES}`));
  });

  it('ignores __proto__ / constructor smuggling: unknown keys are refused, and output is rebuilt', () => {
    const evil = JSON.parse(
      '{"field":"orderCount","cmp":"eq","value":1,"__proto__":{"admin":true}}',
    ) as unknown;
    expect(() => parseRules(evil)).toThrow(BadRequestException);
    const out = parseRules({ field: 'orderCount', cmp: 'eq', value: 1 });
    expect(Object.keys(out)).toEqual(['field', 'cmp', 'value']);
  });

  it('whatever string a client puts in any value slot, the SQL text never contains it', () => {
    const payloads = ["'; DROP TABLE customer; --", '1 OR 1=1', '${x}', '`', '\\'];
    const slots: ((p: string) => unknown)[] = [
      (p) => ({ field: 'orderCount', cmp: 'eq', value: p }),
      (p) => ({ field: 'orderCount', cmp: p, value: 1 }),
      (p) => ({ field: 'tag', cmp: 'has', value: p }),
      (p) => ({ field: 'lifetimeSpend', cmp: 'gt', value: p, currency: 'AED' }),
      (p) => ({ field: 'lifetimeSpend', cmp: 'gt', value: '1', currency: p }),
      (p) => ({ field: 'lastOrderDate', cmp: 'before', value: p }),
      (p) => ({ field: 'consent', cmp: 'is', channel: p, value: 'granted' }),
      (p) => ({ field: p, cmp: 'eq', value: 1 }),
      (p) => ({ op: p, rules: [] }),
    ];
    for (const slot of slots) {
      for (const p of payloads) {
        // Either refused outright, or (never expected) compiled without the text.
        try {
          const out = compile(slot(p));
          expect(out.sql).not.toContain(p);
        } catch (e) {
          expect(e).toBeInstanceOf(BadRequestException);
        }
      }
    }
  });
});
