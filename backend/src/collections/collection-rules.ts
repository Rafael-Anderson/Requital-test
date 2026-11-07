import { PRODUCT_STATUSES } from '../products/dto/create-product.dto';
import type { QueryParam } from '../database/database.service';

// Automated collections: a strict allowlist of attributes and operators. Nothing
// from a request ever reaches the SQL text; every column expression below is a
// literal in this file and every user value is a bound parameter.

export const MAX_RULES = 20;
export const MAX_RULE_VALUE_LENGTH = 255;

export const MATCH_MODES = ['all', 'any'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const COLLECTION_TYPES = ['manual', 'automated'] as const;
export type CollectionType = (typeof COLLECTION_TYPES)[number];

const TEXT_OPS = [
  'eq',
  'neq',
  'starts_with',
  'ends_with',
  'contains',
  'not_contains',
] as const;
const NUMBER_OPS = ['eq', 'neq', 'gt', 'lt'] as const;
const SET_OPS = ['eq', 'neq'] as const;

export type RuleField =
  | 'title'
  | 'variant_title'
  | 'vendor'
  | 'product_type'
  | 'price'
  | 'compare_at_price'
  | 'stock'
  | 'weight'
  | 'status'
  | 'tag'
  | 'category';

type ValueKind = 'text' | 'decimal' | 'integer' | 'status' | 'category';

interface FieldDef {
  kind: ValueKind;
  operators: readonly string[];
}

export const RULE_FIELDS: Record<RuleField, FieldDef> = {
  title: { kind: 'text', operators: TEXT_OPS },
  variant_title: { kind: 'text', operators: TEXT_OPS },
  vendor: { kind: 'text', operators: TEXT_OPS },
  product_type: { kind: 'text', operators: TEXT_OPS },
  price: { kind: 'decimal', operators: NUMBER_OPS },
  // is_set / is_not_set take no value.
  compare_at_price: {
    kind: 'decimal',
    operators: [...NUMBER_OPS, 'is_set', 'is_not_set'],
  },
  stock: { kind: 'integer', operators: NUMBER_OPS },
  weight: { kind: 'decimal', operators: NUMBER_OPS },
  status: { kind: 'status', operators: SET_OPS },
  tag: { kind: 'text', operators: SET_OPS },
  category: { kind: 'category', operators: SET_OPS },
};

export const RULE_FIELD_KEYS = Object.keys(RULE_FIELDS) as RuleField[];
export const RULE_OPERATORS = [
  ...new Set(Object.values(RULE_FIELDS).flatMap((d) => d.operators)),
];

export interface ParsedRule {
  field: RuleField;
  operator: string;
  value: string | null;
}

const DECIMAL_RE = /^-?\d{1,18}(\.\d{1,6})?$/;
const INTEGER_RE = /^-?\d{1,9}$/;
const ID_RE = /^\d{1,10}$/;

// Throws a plain Error with a staff-readable message; the service maps it to a 400.
export function normalizeRule(raw: {
  field: string;
  operator: string;
  value?: string | null;
}): ParsedRule {
  if (!Object.prototype.hasOwnProperty.call(RULE_FIELDS, raw.field)) {
    throw new Error(`Unknown condition attribute "${raw.field.slice(0, 40)}"`);
  }
  const field = raw.field as RuleField;
  const def = RULE_FIELDS[field];
  if (!def.operators.includes(raw.operator)) {
    throw new Error(`"${raw.operator.slice(0, 40)}" is not allowed for ${field}`);
  }
  if (raw.operator === 'is_set' || raw.operator === 'is_not_set') {
    return { field, operator: raw.operator, value: null };
  }
  const value = (raw.value ?? '').trim();
  if (value === '') throw new Error(`A value is required for ${field}`);
  if (value.length > MAX_RULE_VALUE_LENGTH) {
    throw new Error(`The value for ${field} is too long`);
  }
  if (def.kind === 'decimal' && !DECIMAL_RE.test(value)) {
    throw new Error(`The value for ${field} must be a number`);
  }
  if (def.kind === 'integer' && !INTEGER_RE.test(value)) {
    throw new Error(`The value for ${field} must be a whole number`);
  }
  if (
    def.kind === 'status' &&
    !(PRODUCT_STATUSES as readonly string[]).includes(value)
  ) {
    throw new Error('Status must be Available, Unavailable or Archived');
  }
  if (def.kind === 'category' && !ID_RE.test(value)) {
    throw new Error('Category must be a collection');
  }
  return { field, operator: raw.operator, value };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const KG_WEIGHT = `CASE p.weightUnit WHEN 'g' THEN p.weight / 1000 WHEN 'lb' THEN p.weight * 0.45359237 ELSE p.weight END`;

// Inventory stock = on-hand of the product's own stock ingredient across this
// shop's outlets. Not tracked, or no stock row: NULL (unknown), never 0.
const STOCK_EXPR = `(CASE WHEN p.trackInventory = 1 THEN (
  SELECT SUM(ois.stockQuantity)
  FROM ingredient ing
  JOIN outletingredientstock ois ON ois.ingredientId = ing.id
  JOIN outlet ou ON ou.id = ois.outletId AND ou.shopId = p.shopId
  WHERE ing.shadowProductId = p.id AND ing.shopId = p.shopId
) END)`;

const VENDOR_EXPR = `(SELECT b.name FROM brand b WHERE b.id = p.brandId AND b.shopId = p.shopId)`;

const TEXT_EXPR: Record<string, string> = {
  title: 'p.name',
  vendor: VENDOR_EXPR,
  product_type: 'p.productType',
};

const NUMBER_EXPR: Record<string, string> = {
  price: 'p.price',
  compare_at_price: 'p.compareAtPrice',
  stock: STOCK_EXPR,
  weight: `(${KG_WEIGHT})`,
};

const VARIANT_TITLE_EXPR = `NULLIF(CONCAT_WS(' / ', o1.value, o2.value, o3.value), '')`;
const VARIANT_FROM = `FROM productvariant v
  JOIN product vp ON vp.id = v.productId AND vp.shopId = p.shopId
  LEFT JOIN productoptionvalue o1 ON o1.id = v.optionValue1Id
  LEFT JOIN productoptionvalue o2 ON o2.id = v.optionValue2Id
  LEFT JOIN productoptionvalue o3 ON o3.id = v.optionValue3Id
  WHERE v.productId = p.id`;

function textComparison(
  expr: string,
  operator: string,
  value: string,
): { sql: string; params: QueryParam[] } {
  switch (operator) {
    case 'eq':
      return { sql: `${expr} = ?`, params: [value] };
    case 'neq':
      return { sql: `${expr} <> ?`, params: [value] };
    case 'starts_with':
      return {
        sql: `${expr} LIKE ? ESCAPE '\\\\'`,
        params: [`${escapeLike(value)}%`],
      };
    case 'ends_with':
      return {
        sql: `${expr} LIKE ? ESCAPE '\\\\'`,
        params: [`%${escapeLike(value)}`],
      };
    case 'contains':
      return {
        sql: `${expr} LIKE ? ESCAPE '\\\\'`,
        params: [`%${escapeLike(value)}%`],
      };
    default: // not_contains
      return {
        sql: `${expr} NOT LIKE ? ESCAPE '\\\\'`,
        params: [`%${escapeLike(value)}%`],
      };
  }
}

const NUMBER_SQL_OP: Record<string, string> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  lt: '<',
};

// One rule -> a predicate over alias `p` (product). NULL on either side is
// unknown and never matches (`IS TRUE`), including under the negative operators.
function ruleToSql(rule: ParsedRule): { sql: string; params: QueryParam[] } {
  const { field, operator } = rule;
  const value = rule.value ?? '';

  if (field === 'variant_title') {
    const negative = operator === 'neq' || operator === 'not_contains';
    const positiveOp =
      operator === 'neq' ? 'eq' : operator === 'not_contains' ? 'contains' : operator;
    const cmp = textComparison(VARIANT_TITLE_EXPR, positiveOp, value);
    const any = `EXISTS (SELECT 1 ${VARIANT_FROM} AND ${cmp.sql})`;
    if (!negative) return { sql: `(${any}) IS TRUE`, params: cmp.params };
    return {
      sql: `(EXISTS (SELECT 1 ${VARIANT_FROM} AND ${VARIANT_TITLE_EXPR} IS NOT NULL) AND NOT ${any}) IS TRUE`,
      params: cmp.params,
    };
  }

  if (field === 'title' || field === 'vendor' || field === 'product_type') {
    const cmp = textComparison(TEXT_EXPR[field], operator, value);
    return { sql: `(${cmp.sql}) IS TRUE`, params: cmp.params };
  }

  if (field === 'compare_at_price' && operator === 'is_set') {
    return { sql: 'p.compareAtPrice IS NOT NULL', params: [] };
  }
  if (field === 'compare_at_price' && operator === 'is_not_set') {
    return { sql: 'p.compareAtPrice IS NULL', params: [] };
  }

  if (field in NUMBER_EXPR) {
    // CAST keeps the comparison exact decimal (a bare string parameter would be
    // compared as a double). Integers go through the same exact path.
    return {
      sql: `(${NUMBER_EXPR[field]} ${NUMBER_SQL_OP[operator]} CAST(? AS DECIMAL(40, 6))) IS TRUE`,
      params: [value],
    };
  }

  if (field === 'status') {
    return {
      sql: `(p.status ${operator === 'eq' ? '=' : '<>'} ?) IS TRUE`,
      params: [value],
    };
  }

  if (field === 'tag') {
    const exists = `EXISTS (SELECT 1 FROM producttag pt JOIN tag t ON t.id = pt.tagId AND t.shopId = p.shopId WHERE pt.productId = p.id AND t.name = ?)`;
    return {
      sql: operator === 'eq' ? exists : `NOT ${exists}`,
      params: [value],
    };
  }

  // category: membership in a MANUAL collection of the same shop
  const exists = `EXISTS (SELECT 1 FROM productcollection pc JOIN collection c ON c.id = pc.collectionId AND c.shopId = p.shopId AND c.collectionType = 'manual' WHERE pc.productId = p.id AND pc.collectionId = ?)`;
  return {
    sql: operator === 'eq' ? exists : `NOT ${exists}`,
    params: [Number(value)],
  };
}

// The WHERE fragment for the whole collection (always scoped to the shop by the
// caller). No rules matches nothing, never everything.
export function buildCollectionPredicate(
  matchMode: MatchMode,
  rules: ParsedRule[],
): { sql: string; params: QueryParam[] } {
  if (rules.length === 0) return { sql: '1 = 0', params: [] };
  const parts = rules.map(ruleToSql);
  const joiner = matchMode === 'any' ? ' OR ' : ' AND ';
  return {
    sql: `(${parts.map((x) => `(${x.sql})`).join(joiner)})`,
    params: parts.flatMap((x) => x.params),
  };
}
