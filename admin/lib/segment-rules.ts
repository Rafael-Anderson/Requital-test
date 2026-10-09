import type { ConsentChannel } from "./types";

// CUS-1 rule tree, as the builder edits it. The server (backend
// customer-segments/segment-rules.ts) is the authority and re-validates
// everything; this file only builds a payload of the right shape and words it.

export const SEGMENT_CURRENCIES = ["AED", "SAR", "KWD", "QAR", "BHD", "OMR", "USD"] as const;
export const MAX_DEPTH = 4;

export type SegmentField =
  | "orderCount"
  | "lifetimeSpend"
  | "lastOrderDate"
  | "lastOrderDaysAgo"
  | "tag"
  | "region"
  | "consent"
  | "newsletterSubscriber";

export interface SegmentLeaf {
  field: SegmentField;
  cmp: string;
  // Held as typed text while editing; toPayload converts to the wire types.
  value: string;
  currency?: string;
  channel?: ConsentChannel;
}
export interface SegmentGroup {
  op: "and" | "or";
  rules: SegmentNode[];
}
export type SegmentNode = SegmentGroup | SegmentLeaf;

export const isGroup = (n: SegmentNode): n is SegmentGroup => "op" in n;

const NUMERIC_CMPS: [string, string][] = [
  ["eq", "is"],
  ["neq", "is not"],
  ["gt", "more than"],
  ["gte", "at least"],
  ["lt", "less than"],
  ["lte", "at most"],
];

export const FIELD_DEFS: Record<
  SegmentField,
  { label: string; cmps: [string, string][]; input: "number" | "money" | "date" | "tag" | "region" | "consent" | "bool" }
> = {
  orderCount: { label: "Number of orders", cmps: NUMERIC_CMPS, input: "number" },
  lifetimeSpend: { label: "Lifetime spend", cmps: NUMERIC_CMPS, input: "money" },
  lastOrderDate: {
    label: "Last order date",
    cmps: [
      ["before", "before"],
      ["onOrAfter", "on or after"],
    ],
    input: "date",
  },
  lastOrderDaysAgo: {
    label: "Days since last order",
    cmps: [
      ["gt", "more than"],
      ["gte", "at least"],
      ["lt", "less than"],
      ["lte", "at most"],
    ],
    input: "number",
  },
  tag: {
    label: "Tag",
    cmps: [
      ["has", "has"],
      ["notHas", "does not have"],
    ],
    input: "tag",
  },
  region: {
    label: "Has ordered to region",
    cmps: [
      ["has", "yes"],
      ["notHas", "no"],
    ],
    input: "region",
  },
  consent: { label: "Marketing consent", cmps: [["is", "is"]], input: "consent" },
  newsletterSubscriber: { label: "Newsletter subscriber", cmps: [["is", "is"]], input: "bool" },
};

export const FIELD_ORDER = Object.keys(FIELD_DEFS) as SegmentField[];

export function newLeaf(field: SegmentField = "orderCount"): SegmentLeaf {
  const def = FIELD_DEFS[field];
  const leaf: SegmentLeaf = { field, cmp: def.cmps[0][0], value: def.input === "bool" ? "true" : def.input === "consent" ? "granted" : "" };
  if (field === "lifetimeSpend") leaf.currency = "AED";
  if (field === "consent") leaf.channel = "email";
  return leaf;
}

export const newGroup = (): SegmentGroup => ({ op: "and", rules: [newLeaf()] });

// A tree with an empty value cannot be saved or previewed.
export function isComplete(node: SegmentNode): boolean {
  if (isGroup(node)) return node.rules.length > 0 && node.rules.every(isComplete);
  return node.value.trim() !== "";
}

export function depthOf(node: SegmentNode): number {
  return isGroup(node) ? 1 + Math.max(0, ...node.rules.map(depthOf)) : 0;
}

// Wire shape: numbers as numbers, the boolean as a boolean, the rest as strings.
export function toPayload(node: SegmentNode): Record<string, unknown> {
  if (isGroup(node)) return { op: node.op, rules: node.rules.map(toPayload) };
  const base: Record<string, unknown> = { field: node.field, cmp: node.cmp };
  const def = FIELD_DEFS[node.field];
  if (def.input === "number" || def.input === "tag" || def.input === "region") base.value = Number(node.value);
  else if (def.input === "bool") base.value = node.value === "true";
  else base.value = node.value.trim();
  if (node.field === "lifetimeSpend") base.currency = node.currency;
  if (node.field === "consent") base.channel = node.channel;
  return base;
}

// The inverse, for editing a saved segment.
export function fromPayload(raw: unknown): SegmentNode {
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.rules)) {
    return { op: o.op === "or" ? "or" : "and", rules: o.rules.map(fromPayload) };
  }
  return {
    field: o.field as SegmentField,
    cmp: String(o.cmp),
    value: String(o.value),
    ...(o.currency ? { currency: String(o.currency) } : {}),
    ...(o.channel ? { channel: o.channel as ConsentChannel } : {}),
  };
}

export function describeNode(node: SegmentNode, tagName: (id: number) => string): string {
  if (isGroup(node)) {
    const parts = node.rules.map((r) => describeNode(r, tagName));
    const joined = parts.join(node.op === "and" ? " and " : " or ");
    return parts.length > 1 ? `(${joined})` : joined;
  }
  const def = FIELD_DEFS[node.field];
  const cmp = def.cmps.find(([k]) => k === node.cmp)?.[1] ?? node.cmp;
  switch (node.field) {
    case "lifetimeSpend":
      return `${def.label} ${cmp} ${node.value} ${node.currency ?? ""}`.trim();
    case "tag":
      return `${def.label} ${cmp} "${tagName(Number(node.value))}"`;
    case "consent":
      return `${node.channel ?? "email"} consent ${node.value === "unknown" ? "not asked" : node.value}`;
    case "newsletterSubscriber":
      return node.value === "true" ? "On the newsletter" : "Not on the newsletter";
    case "lastOrderDaysAgo":
      return `${def.label} ${cmp} ${node.value}`;
    default:
      return `${def.label} ${cmp} ${node.value}`;
  }
}
