// The attributes and operators an automated collection offers. Mirrors
// backend/src/collections/collection-rules.ts (RULE_FIELDS): the backend is the source of
// truth and re-validates everything; this table only drives the editor's pickers. Keep the
// two in sync by hand (the apps share no code).
export type RuleValueKind = "text" | "number" | "category" | "status";

export interface RuleFieldDef {
  key: string;
  label: string;
  operators: string[];
  valueKind: RuleValueKind;
  placeholder?: string;
}

const TEXT_OPERATORS = ["equals", "not_equals", "starts_with", "ends_with", "contains", "not_contains"];
const NUMBER_OPERATORS = ["equals", "not_equals", "gt", "lt"];
const EQUALITY_OPERATORS = ["equals", "not_equals"];

export const OPERATOR_LABELS: Record<string, string> = {
  equals: "is equal to",
  not_equals: "is not equal to",
  starts_with: "starts with",
  ends_with: "ends with",
  contains: "contains",
  not_contains: "does not contain",
  gt: "is greater than",
  lt: "is less than",
  is_set: "is set",
  is_not_set: "is not set",
};

export const RULE_FIELDS: RuleFieldDef[] = [
  { key: "category", label: "Category", operators: EQUALITY_OPERATORS, valueKind: "category" },
  {
    key: "compare_at_price",
    label: "Compare at price",
    operators: [...NUMBER_OPERATORS, "is_set", "is_not_set"],
    valueKind: "number",
    placeholder: "0.00",
  },
  { key: "stock", label: "Inventory stock", operators: NUMBER_OPERATORS, valueKind: "number", placeholder: "0" },
  { key: "price", label: "Price", operators: NUMBER_OPERATORS, valueKind: "number", placeholder: "0.00" },
  { key: "status", label: "Status", operators: EQUALITY_OPERATORS, valueKind: "status" },
  { key: "tag", label: "Tag", operators: EQUALITY_OPERATORS, valueKind: "text", placeholder: "Tag name" },
  { key: "title", label: "Title", operators: TEXT_OPERATORS, valueKind: "text" },
  { key: "product_type", label: "Type", operators: TEXT_OPERATORS, valueKind: "text" },
  { key: "variant_title", label: "Variant title", operators: TEXT_OPERATORS, valueKind: "text", placeholder: "Small / Pink" },
  { key: "brand", label: "Vendor (brand)", operators: TEXT_OPERATORS, valueKind: "text" },
  { key: "weight", label: "Weight (kg)", operators: NUMBER_OPERATORS, valueKind: "number", placeholder: "0.5" },
];

export const MAX_RULES = 20;
export const MAX_VALUE_LENGTH = 255;

export function fieldDef(key: string): RuleFieldDef | undefined {
  return RULE_FIELDS.find((f) => f.key === key);
}

export function isPresenceOperator(op: string): boolean {
  return op === "is_set" || op === "is_not_set";
}

const NUMBER_RE = /^-?\d{1,12}(\.\d{1,6})?$/;

/** Client-side check so the editor can say what is wrong; the backend re-validates. */
export function conditionError(rule: { field: string; operator: string; value?: string | null }): string | null {
  const def = fieldDef(rule.field);
  if (!def) return "Pick an attribute";
  if (!def.operators.includes(rule.operator)) return "Pick a comparison";
  if (isPresenceOperator(rule.operator)) return null;
  const v = (rule.value ?? "").trim();
  if (v === "") return "Enter a value";
  if (v.length > MAX_VALUE_LENGTH) return `At most ${MAX_VALUE_LENGTH} characters`;
  if (def.valueKind === "number" && !NUMBER_RE.test(v)) return "Enter a number such as 25 or 25.50";
  return null;
}
