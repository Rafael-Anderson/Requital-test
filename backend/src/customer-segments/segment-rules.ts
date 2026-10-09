import { BadRequestException } from '@nestjs/common';
import { SUPPORTED_CURRENCIES } from '../shop/dto/update-shop.dto';
import { CONSENT_CHANNELS } from '../customer-crm/consent-wording';

// CUS-1. A segment is a JSON RULE TREE, validated against the strict schema below
// and compiled to a parameterised SQL predicate over the alias `c` (a row of
// `customer`). The client never supplies SQL: every operator, column and table in
// the output is a literal in THIS file, chosen by a closed lookup keyed on a
// validated enum, and every client value travels as a bound parameter (and is
// type-checked first: integers, a currency from the supported list, a calendar
// date, a decimal string). There is no free-text value anywhere in the schema, so
// there is nothing for an injection string to be.
//
//   Group: { op: 'and' | 'or', rules: Node[] }
//   Leaf : { field, cmp, value, [currency | channel] }
//
// Bounds: depth <= MAX_DEPTH, <= MAX_NODES nodes in total, <= MAX_GROUP_RULES per
// group. They are enforced WHILE walking, so a depth bomb is refused at the first
// level past the limit rather than after the whole structure is traversed.

export const MAX_DEPTH = 4;
export const MAX_NODES = 50;
export const MAX_GROUP_RULES = 20;

const NUMERIC_CMP = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;
const DAYS_CMP = ['gt', 'gte', 'lt', 'lte'] as const;
const NUMERIC_SQL: Record<(typeof NUMERIC_CMP)[number], string> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};
// "last order more than N days ago" = last order timestamp BEFORE (now - N days),
// so the comparison against the timestamp is the mirror of the one on the days.
const DAYS_SQL: Record<(typeof DAYS_CMP)[number], string> = {
  gt: '<',
  gte: '<=',
  lt: '>',
  lte: '>=',
};

export type RuleNode = RuleGroup | RuleLeaf;
export interface RuleGroup {
  op: 'and' | 'or';
  rules: RuleNode[];
}
export type RuleLeaf =
  | { field: 'orderCount'; cmp: (typeof NUMERIC_CMP)[number]; value: number }
  | {
      field: 'lifetimeSpend';
      cmp: (typeof NUMERIC_CMP)[number];
      value: string;
      currency: string;
    }
  | { field: 'lastOrderDate'; cmp: 'before' | 'onOrAfter'; value: string }
  | { field: 'lastOrderDaysAgo'; cmp: (typeof DAYS_CMP)[number]; value: number }
  | { field: 'tag'; cmp: 'has' | 'notHas'; value: number }
  | { field: 'region'; cmp: 'has' | 'notHas'; value: number }
  | {
      field: 'consent';
      cmp: 'is';
      channel: (typeof CONSENT_CHANNELS)[number];
      value: 'granted' | 'withdrawn' | 'unknown';
    }
  | { field: 'newsletterSubscriber'; cmp: 'is'; value: boolean };

export const SEGMENT_FIELDS = [
  'orderCount',
  'lifetimeSpend',
  'lastOrderDate',
  'lastOrderDaysAgo',
  'tag',
  'region',
  'consent',
  'newsletterSubscriber',
] as const;

function fail(path: string, message: string): never {
  throw new BadRequestException(`Invalid segment rules at ${path}: ${message}`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function onlyKeys(obj: Record<string, unknown>, allowed: string[], path: string) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(path, `unknown property "${k}"`);
  }
}

function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    fail(path, `must be a whole number between ${min} and ${max}`);
  }
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    fail(path, `must be one of: ${allowed.join(', ')}`);
  }
  return v as T;
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Validates and NORMALISES: the returned tree is rebuilt from the checked values
// only, so nothing the client sent beyond the schema can be stored or compiled.
export function parseRules(input: unknown): RuleNode {
  const budget = { nodes: 0 };
  return parseNode(input, 'rules', 1, budget);
}

function parseNode(
  input: unknown,
  path: string,
  depth: number,
  budget: { nodes: number },
): RuleNode {
  if (depth > MAX_DEPTH) fail(path, `nesting is deeper than ${MAX_DEPTH} levels`);
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) fail(path, `more than ${MAX_NODES} conditions`);
  if (!isPlainObject(input)) fail(path, 'must be an object');

  if ('op' in input) {
    onlyKeys(input, ['op', 'rules'], path);
    const op = oneOf(input.op, ['and', 'or'] as const, `${path}.op`);
    const rules = input.rules;
    if (!Array.isArray(rules)) fail(`${path}.rules`, 'must be a list');
    if (rules.length < 1) fail(`${path}.rules`, 'needs at least one condition');
    if (rules.length > MAX_GROUP_RULES) {
      fail(`${path}.rules`, `has more than ${MAX_GROUP_RULES} conditions`);
    }
    return {
      op,
      rules: rules.map((r, i) =>
        parseNode(r, `${path}.rules[${i}]`, depth + 1, budget),
      ),
    };
  }

  const field = oneOf(input.field, SEGMENT_FIELDS, `${path}.field`);
  switch (field) {
    case 'orderCount': {
      onlyKeys(input, ['field', 'cmp', 'value'], path);
      return {
        field,
        cmp: oneOf(input.cmp, NUMERIC_CMP, `${path}.cmp`),
        value: int(input.value, `${path}.value`, 0, 1_000_000),
      };
    }
    case 'lifetimeSpend': {
      onlyKeys(input, ['field', 'cmp', 'value', 'currency'], path);
      const raw = input.value;
      const asString =
        typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw;
      // At most 12 integer digits and 3 decimals (the finest minor unit).
      if (typeof asString !== 'string' || !/^\d{1,12}(\.\d{1,3})?$/.test(asString)) {
        fail(`${path}.value`, 'must be a non-negative amount with up to 3 decimals');
      }
      return {
        field,
        cmp: oneOf(input.cmp, NUMERIC_CMP, `${path}.cmp`),
        value: asString,
        // Spend is only ever compared within one currency (no conversion).
        currency: oneOf(input.currency, SUPPORTED_CURRENCIES, `${path}.currency`),
      };
    }
    case 'lastOrderDate': {
      onlyKeys(input, ['field', 'cmp', 'value'], path);
      if (typeof input.value !== 'string' || !isRealDate(input.value)) {
        fail(`${path}.value`, 'must be a date as YYYY-MM-DD');
      }
      return {
        field,
        cmp: oneOf(input.cmp, ['before', 'onOrAfter'] as const, `${path}.cmp`),
        value: input.value,
      };
    }
    case 'lastOrderDaysAgo': {
      onlyKeys(input, ['field', 'cmp', 'value'], path);
      return {
        field,
        cmp: oneOf(input.cmp, DAYS_CMP, `${path}.cmp`),
        value: int(input.value, `${path}.value`, 0, 36_500),
      };
    }
    case 'tag':
    case 'region': {
      onlyKeys(input, ['field', 'cmp', 'value'], path);
      return {
        field,
        cmp: oneOf(input.cmp, ['has', 'notHas'] as const, `${path}.cmp`),
        value: int(input.value, `${path}.value`, 1, 2_147_483_647),
      };
    }
    case 'consent': {
      onlyKeys(input, ['field', 'cmp', 'channel', 'value'], path);
      return {
        field,
        cmp: oneOf(input.cmp, ['is'] as const, `${path}.cmp`),
        channel: oneOf(input.channel, CONSENT_CHANNELS, `${path}.channel`),
        value: oneOf(
          input.value,
          ['granted', 'withdrawn', 'unknown'] as const,
          `${path}.value`,
        ),
      };
    }
    case 'newsletterSubscriber': {
      onlyKeys(input, ['field', 'cmp', 'value'], path);
      if (typeof input.value !== 'boolean') fail(`${path}.value`, 'must be true or false');
      return {
        field,
        cmp: oneOf(input.cmp, ['is'] as const, `${path}.cmp`),
        value: input.value,
      };
    }
  }
}

export interface CompiledPredicate {
  sql: string;
  params: (string | number)[];
}

// Cancelled orders never count, the same convention as the customer list.
const ORDERS = `\`order\` o WHERE o.customerId = c.id AND o.shopId = c.shopId AND o.status <> 'cancelled'`;

// Compiles a VALIDATED tree (the output of parseRules). Every subquery re-states
// the shop through `c.shopId`, so a predicate can only ever see rows of the same
// shop as the customer it is evaluated for; the caller adds `c.shopId = ?`.
export function compileRules(node: RuleNode): CompiledPredicate {
  if ('op' in node) {
    const parts = node.rules.map(compileRules);
    return {
      sql: `(${parts.map((p) => p.sql).join(node.op === 'and' ? ' AND ' : ' OR ')})`,
      params: parts.flatMap((p) => p.params),
    };
  }
  switch (node.field) {
    case 'orderCount':
      return {
        sql: `(SELECT COUNT(*) FROM ${ORDERS}) ${NUMERIC_SQL[node.cmp]} ?`,
        params: [node.value],
      };
    case 'lifetimeSpend':
      return {
        // CAST so the comparison is exact decimal, not decimal-vs-double.
        sql: `(SELECT COALESCE(SUM(o.total), 0) FROM ${ORDERS} AND o.currency = ?) ${NUMERIC_SQL[node.cmp]} CAST(? AS DECIMAL(20,3))`,
        params: [node.currency, node.value],
      };
    case 'lastOrderDate':
      return {
        sql: `(SELECT MAX(o.createdAt) FROM ${ORDERS}) ${node.cmp === 'before' ? '<' : '>='} ?`,
        params: [`${node.value} 00:00:00`],
      };
    case 'lastOrderDaysAgo':
      return {
        sql: `(SELECT MAX(o.createdAt) FROM ${ORDERS}) ${DAYS_SQL[node.cmp]} DATE_SUB(NOW(3), INTERVAL ? DAY)`,
        params: [node.value],
      };
    case 'tag':
      return {
        sql: `${node.cmp === 'has' ? '' : 'NOT '}EXISTS (SELECT 1 FROM customertagassignment a WHERE a.customerId = c.id AND a.shopId = c.shopId AND a.tagId = ?)`,
        params: [node.value],
      };
    case 'region':
      return {
        sql: `${node.cmp === 'has' ? '' : 'NOT '}EXISTS (SELECT 1 FROM ${ORDERS} AND o.regionId = ?)`,
        params: [node.value],
      };
    case 'consent':
      return node.value === 'unknown'
        ? {
            sql: `NOT EXISTS (SELECT 1 FROM customerconsent k WHERE k.customerId = c.id AND k.shopId = c.shopId AND k.channel = ?)`,
            params: [node.channel],
          }
        : {
            sql: `EXISTS (SELECT 1 FROM customerconsent k WHERE k.customerId = c.id AND k.shopId = c.shopId AND k.channel = ? AND k.status = ?)`,
            params: [node.channel, node.value],
          };
    case 'newsletterSubscriber':
      return {
        sql: `${node.value ? '' : 'NOT '}EXISTS (SELECT 1 FROM newslettersubscriber s WHERE s.shopId = c.shopId AND c.email IS NOT NULL AND s.email COLLATE utf8mb4_unicode_ci = c.email COLLATE utf8mb4_unicode_ci)`,
        params: [],
      };
  }
}
