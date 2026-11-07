// Automated collections: the conditions a merchant can put on a collection, and the
// ONLY place that turns them into SQL.
//
// Safety model (read before touching):
//   - field and operator are looked up in the FIELDS table below; anything else is
//     rejected before any SQL is built. No part of a field name, operator or value is
//     ever concatenated into SQL: the fragments are fixed strings from this file and
//     every merchant-supplied value is a bound `?` parameter.
//   - LIKE patterns escape %, _ and the escape character itself, so a value of "%" or
//     "_" matches that literal character, not everything.
//   - numbers and money are kept as decimal STRINGS (validated by a regex) and compared
//     with CAST(? AS DECIMAL(24,6)): never a JS float, never toFixed.
//   - NULL means unknown: every comparison is guarded by `IS NOT NULL`, so a product
//     with no compare-at price, no brand, no weight or untracked stock never matches a
//     comparison (not even "is not equal to"). "is set / is not set" is the only way to
//     ask about absence.
//   - every query is scoped by p.shopId = ?, and every sub-select that crosses a table
//     repeats the shop (tag, brand, category, ingredient), so a rule can only ever match
//     products of the collection's own shop.
import { BadRequestException } from '@nestjs/common';
import type { QueryParam } from '../database/database.service';

export const MAX_RULES = 20;
export const MAX_VALUE_LENGTH = 255;

export const COLLECTION_TYPES = ['manual', 'automated'] as const;
export type CollectionType = (typeof COLLECTION_TYPES)[number];
export const MATCH_MODES = ['all', 'any'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const TEXT_OPERATORS = [
  'equals',
  'not_equals',
  'starts_with',
  'ends_with',
  'contains',
  'not_contains',
] as const;
export const NUMBER_OPERATORS = ['equals', 'not_equals', 'gt', 'lt'] as const;
export const EQUALITY_OPERATORS = ['equals', 'not_equals'] as const;
export const PRESENCE_OPERATORS = ['is_set', 'is_not_set'] as const;

export const RULE_OPERATORS = [
  ...new Set([
    ...TEXT_OPERATORS,
    ...NUMBER_OPERATORS,
    ...EQUALITY_OPERATORS,
    ...PRESENCE_OPERATORS,
  ]),
] as const;

export const PRODUCT_STATUS_VALUES = ['Available', 'Unavailable', 'Archived'];

type ValueKind = 'text' | 'number' | 'integer' | 'status';

interface FieldDef {
  label: string;
  operators: readonly string[];
  valueKind: ValueKind;
  // Text/number: a scalar SQL expression over `p`. Others are built by hand below.
  expr?: string;
}

export const WEIGHT_KG_EXPR =
  "CASE p.weightUnit WHEN 'kg' THEN p.weight WHEN 'g' THEN p.weight / 1000 WHEN 'lb' THEN p.weight * 0.45359237 ELSE NULL END";

export const STOCK_EXPR =
  'CASE WHEN p.trackInventory = 1 THEN (SELECT SUM(ois.stockQuantity) FROM ingredient ing JOIN outletingredientstock ois ON ois.ingredientId = ing.id WHERE ing.shadowProductId = p.id AND ing.shopId = p.shopId) ELSE NULL END';

export const BRAND_EXPR =
  '(SELECT b.name FROM brand b WHERE b.id = p.brandId AND b.shopId = p.shopId)';

// The attributes offered. Every Shopify-equivalent that exists in this schema:
// Category (collections), Compare at price, Inventory stock (ingredient-backed, summed
// over outlets, tracked products only), Price, Status, Tag, Title, Type (productType),
// Variant title (option values joined with " / "), Vendor (our Brand), Weight.
export const RULE_FIELDS: Record<string, FieldDef> = {
  category: { label: 'Category', operators: EQUALITY_OPERATORS, valueKind: 'integer' },
  compare_at_price: {
    label: 'Compare at price',
    operators: [...NUMBER_OPERATORS, ...PRESENCE_OPERATORS],
    valueKind: 'number',
    expr: 'p.compareAtPrice',
  },
  stock: {
    label: 'Inventory stock',
    operators: NUMBER_OPERATORS,
    valueKind: 'number',
    expr: STOCK_EXPR,
  },
  price: {
    label: 'Price',
    operators: NUMBER_OPERATORS,
    valueKind: 'number',
    expr: 'p.price',
  },
  status: { label: 'Status', operators: EQUALITY_OPERATORS, valueKind: 'status' },
  tag: { label: 'Tag', operators: EQUALITY_OPERATORS, valueKind: 'text' },
  title: {
    label: 'Title',
    operators: TEXT_OPERATORS,
    valueKind: 'text',
    expr: 'p.name',
  },
  product_type: {
    label: 'Type',
    operators: TEXT_OPERATORS,
    valueKind: 'text',
    expr: 'p.productType',
  },
  variant_title: { label: 'Variant title', operators: TEXT_OPERATORS, valueKind: 'text' },
  brand: {
    label: 'Vendor (brand)',
    operators: TEXT_OPERATORS,
    valueKind: 'text',
    expr: BRAND_EXPR,
  },
  weight: {
    label: 'Weight (kg)',
    operators: NUMBER_OPERATORS,
    valueKind: 'number',
    expr: WEIGHT_KG_EXPR,
  },
};

export interface RuleInput {
  field: string;
  operator: string;
  value?: string | null;
}

const NUMBER_RE = /^-?\d{1,12}(\.\d{1,6})?$/;
const INTEGER_RE = /^\d{1,10}$/;

export function isPresenceOperator(op: string): boolean {
  return (PRESENCE_OPERATORS as readonly string[]).includes(op);
}

/** Throws BadRequestException (client-safe message, no SQL) on the first problem. */
export function validateRules(rules: RuleInput[]): void {
  if (!Array.isArray(rules)) throw new BadRequestException('rules must be a list');
  if (rules.length > MAX_RULES) {
    throw new BadRequestException(`An automated collection can have at most ${MAX_RULES} conditions`);
  }
  rules.forEach((r, i) => {
    const n = i + 1;
    const def = Object.prototype.hasOwnProperty.call(RULE_FIELDS, r.field)
      ? RULE_FIELDS[r.field]
      : undefined;
    if (!def) throw new BadRequestException(`Condition ${n}: unknown attribute`);
    if (!def.operators.includes(r.operator)) {
      throw new BadRequestException(`Condition ${n}: "${def.label}" does not support that operator`);
    }
    if (isPresenceOperator(r.operator)) {
      if (r.value !== undefined && r.value !== null && r.value !== '') {
        throw new BadRequestException(`Condition ${n}: this operator takes no value`);
      }
      return;
    }
    const v = r.value;
    if (typeof v !== 'string' || v.trim() === '') {
      throw new BadRequestException(`Condition ${n}: a value is required`);
    }
    if (v.length > MAX_VALUE_LENGTH) {
      throw new BadRequestException(`Condition ${n}: the value is too long (max ${MAX_VALUE_LENGTH} characters)`);
    }
    if (def.valueKind === 'number' && !NUMBER_RE.test(v.trim())) {
      throw new BadRequestException(`Condition ${n}: "${def.label}" needs a number such as 25 or 25.50`);
    }
    if (def.valueKind === 'integer' && !INTEGER_RE.test(v.trim())) {
      throw new BadRequestException(`Condition ${n}: pick a value from the list`);
    }
    if (def.valueKind === 'status' && !PRODUCT_STATUS_VALUES.includes(v)) {
      throw new BadRequestException(`Condition ${n}: unknown status`);
    }
  });
}

const LIKE_ESCAPE = '!';
export function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (c) => `${LIKE_ESCAPE}${c}`);
}

interface Frag {
  sql: string;
  params: QueryParam[];
}

// text comparison of a scalar expression, NULL = unknown (never matches)
function textCompare(expr: string, op: string, value: string): Frag {
  switch (op) {
    case 'equals':
      return { sql: `(${expr} IS NOT NULL AND ${expr} = ?)`, params: [value] };
    case 'not_equals':
      return { sql: `(${expr} IS NOT NULL AND ${expr} <> ?)`, params: [value] };
    case 'starts_with':
      return { sql: `(${expr} IS NOT NULL AND ${expr} LIKE ? ESCAPE '${LIKE_ESCAPE}')`, params: [`${escapeLike(value)}%`] };
    case 'ends_with':
      return { sql: `(${expr} IS NOT NULL AND ${expr} LIKE ? ESCAPE '${LIKE_ESCAPE}')`, params: [`%${escapeLike(value)}`] };
    case 'contains':
      return { sql: `(${expr} IS NOT NULL AND ${expr} LIKE ? ESCAPE '${LIKE_ESCAPE}')`, params: [`%${escapeLike(value)}%`] };
    case 'not_contains':
      return { sql: `(${expr} IS NOT NULL AND ${expr} NOT LIKE ? ESCAPE '${LIKE_ESCAPE}')`, params: [`%${escapeLike(value)}%`] };
    default:
      throw new BadRequestException('Unsupported operator');
  }
}

const NUMBER_SQL_OP: Record<string, string> = { equals: '=', not_equals: '<>', gt: '>', lt: '<' };

function numberCompare(expr: string, op: string, value: string): Frag {
  const sqlOp = NUMBER_SQL_OP[op];
  if (!sqlOp) throw new BadRequestException('Unsupported operator');
  return {
    sql: `(${expr} IS NOT NULL AND ${expr} ${sqlOp} CAST(? AS DECIMAL(24,6)))`,
    params: [value.trim()],
  };
}

const VARIANT_TITLE_EXPR = "CONCAT_WS(' / ', o1.value, o2.value, o3.value)";
const VARIANT_FROM =
  'FROM productvariant v JOIN productoptionvalue o1 ON o1.id = v.optionValue1Id LEFT JOIN productoptionvalue o2 ON o2.id = v.optionValue2Id LEFT JOIN productoptionvalue o3 ON o3.id = v.optionValue3Id WHERE v.productId = p.id';

function variantTitleFrag(op: string, value: string): Frag {
  // Positive operators: some variant's title matches. Negative operators: the product
  // has at least one titled variant and NO variant's title matches the positive form.
  const positive: Record<string, string> = {
    equals: 'equals',
    not_equals: 'equals',
    starts_with: 'starts_with',
    ends_with: 'ends_with',
    contains: 'contains',
    not_contains: 'contains',
  };
  const posOp = positive[op];
  if (!posOp) throw new BadRequestException('Unsupported operator');
  const inner = textCompare(VARIANT_TITLE_EXPR, posOp, value);
  const exists = `EXISTS (SELECT 1 ${VARIANT_FROM} AND ${inner.sql})`;
  if (op === 'not_equals' || op === 'not_contains') {
    return {
      sql: `(EXISTS (SELECT 1 ${VARIANT_FROM}) AND NOT ${exists})`,
      params: inner.params,
    };
  }
  return { sql: exists, params: inner.params };
}

export function ruleToSql(rule: RuleInput): Frag {
  const def = Object.prototype.hasOwnProperty.call(RULE_FIELDS, rule.field)
    ? RULE_FIELDS[rule.field]
    : undefined;
  if (!def || !def.operators.includes(rule.operator)) {
    throw new BadRequestException('Unsupported condition');
  }
  const op = rule.operator;
  if (isPresenceOperator(op)) {
    // only compare_at_price offers presence operators (see RULE_FIELDS)
    return { sql: `${def.expr} IS ${op === 'is_set' ? 'NOT ' : ''}NULL`, params: [] };
  }
  const value = rule.value as string;
  switch (rule.field) {
    case 'category': {
      const exists =
        'EXISTS (SELECT 1 FROM productcollection pc JOIN collection c ON c.id = pc.collectionId WHERE pc.productId = p.id AND c.shopId = p.shopId AND pc.collectionId = ?)';
      return { sql: op === 'equals' ? exists : `NOT ${exists}`, params: [Number(value.trim())] };
    }
    case 'tag': {
      const exists =
        'EXISTS (SELECT 1 FROM producttag pt JOIN tag t ON t.id = pt.tagId WHERE pt.productId = p.id AND t.shopId = p.shopId AND t.name = ?)';
      return { sql: op === 'equals' ? exists : `NOT ${exists}`, params: [value] };
    }
    case 'status':
      return { sql: `p.status ${op === 'equals' ? '=' : '<>'} ?`, params: [value] };
    case 'variant_title':
      return variantTitleFrag(op, value);
    default:
      break;
  }
  if (!def.expr) throw new BadRequestException('Unsupported condition');
  return def.valueKind === 'number'
    ? numberCompare(def.expr, op, value)
    : textCompare(def.expr, op, value);
}

export interface RuleSet {
  matchMode: string;
  rules: RuleInput[];
}

/**
 * WHERE clause (without the word WHERE) for an automated collection's members:
 * `p.shopId = ?` first, then optionally only Available products, then the conditions.
 * An automated collection with no conditions matches nothing.
 */
export function buildMembershipWhere(
  shopId: number,
  set: RuleSet,
  opts: { onlyAvailable: boolean },
): Frag {
  validateRules(set.rules);
  if (!(MATCH_MODES as readonly string[]).includes(set.matchMode)) {
    throw new BadRequestException('matchMode must be "all" or "any"');
  }
  const parts: string[] = ['p.shopId = ?'];
  const params: QueryParam[] = [shopId];
  if (opts.onlyAvailable) parts.push("p.status = 'Available'");
  if (set.rules.length === 0) {
    parts.push('1 = 0');
  } else {
    const frags = set.rules.map(ruleToSql);
    const joiner = set.matchMode === 'any' ? ' OR ' : ' AND ';
    parts.push(`(${frags.map((f) => f.sql).join(joiner)})`);
    for (const f of frags) params.push(...f.params);
  }
  return { sql: parts.join(' AND '), params };
}
