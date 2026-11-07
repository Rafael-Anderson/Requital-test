import type { CollectionRule, CollectionRuleField } from "@/lib/types";

// Mirrors backend/src/collections/collection-rules.ts (kept in sync by hand).
// Only attributes that exist in our product data are offered. Not offered, with
// the reason: Variant SKU/barcode are not part of the requested list; "Weight"
// compares in kilograms (the product's own unit is converted on the server).

type Kind = "text" | "number" | "integer" | "status" | "tag" | "category";

export interface RuleAttribute {
  field: CollectionRuleField;
  label: string;
  kind: Kind;
  operators: string[];
}

const TEXT_OPS = ["eq", "neq", "starts_with", "ends_with", "contains", "not_contains"];
const NUMBER_OPS = ["eq", "neq", "gt", "lt"];

export const RULE_ATTRIBUTES: RuleAttribute[] = [
  { field: "category", label: "Category", kind: "category", operators: ["eq", "neq"] },
  {
    field: "compare_at_price",
    label: "Compare at price",
    kind: "number",
    operators: [...NUMBER_OPS, "is_set", "is_not_set"],
  },
  { field: "stock", label: "Inventory stock", kind: "integer", operators: NUMBER_OPS },
  { field: "price", label: "Price", kind: "number", operators: NUMBER_OPS },
  { field: "status", label: "Status", kind: "status", operators: ["eq", "neq"] },
  { field: "tag", label: "Tag", kind: "tag", operators: ["eq", "neq"] },
  { field: "title", label: "Title", kind: "text", operators: TEXT_OPS },
  { field: "product_type", label: "Type", kind: "text", operators: TEXT_OPS },
  { field: "variant_title", label: "Variant title", kind: "text", operators: TEXT_OPS },
  { field: "vendor", label: "Vendor", kind: "text", operators: TEXT_OPS },
  { field: "weight", label: "Weight (kg)", kind: "number", operators: NUMBER_OPS },
];

export const OPERATOR_LABELS: Record<string, string> = {
  eq: "is equal to",
  neq: "is not equal to",
  starts_with: "starts with",
  ends_with: "ends with",
  contains: "contains",
  not_contains: "does not contain",
  gt: "is greater than",
  lt: "is less than",
  is_set: "is set",
  is_not_set: "is not set",
};

export const MAX_CONDITIONS = 20;
export const STATUS_OPTIONS = ["Available", "Unavailable", "Archived"];

export function attributeFor(field: CollectionRuleField): RuleAttribute {
  return RULE_ATTRIBUTES.find((a) => a.field === field) ?? RULE_ATTRIBUTES[0];
}

export function newRule(field: CollectionRuleField): CollectionRule {
  const attr = attributeFor(field);
  return {
    field,
    operator: attr.operators[0],
    value: attr.kind === "status" ? "Available" : "",
  };
}

export function needsValue(rule: CollectionRule): boolean {
  return rule.operator !== "is_set" && rule.operator !== "is_not_set";
}

// A condition is previewed/saved only once it has what the server will accept.
export function isRuleComplete(rule: CollectionRule): boolean {
  if (!needsValue(rule)) return true;
  const v = (rule.value ?? "").trim();
  if (v === "" || v.length > 255) return false;
  const kind = attributeFor(rule.field).kind;
  if (kind === "number") return /^-?\d{1,18}(\.\d{1,6})?$/.test(v);
  if (kind === "integer") return /^-?\d{1,9}$/.test(v);
  return true;
}

export function ruleSummary(rule: CollectionRule): string {
  const attr = attributeFor(rule.field);
  const op = OPERATOR_LABELS[rule.operator] ?? rule.operator;
  return needsValue(rule) ? `${attr.label} ${op} ${rule.value ?? ""}` : `${attr.label} ${op}`;
}
