// Where an order came from. Mirror of backend/src/orders/order-sources.ts (same
// entries, same order; backend order-sources.spec.ts fails when they differ).
// Adding a source (Careem, Noon, ...) is one entry here and in each mirror.
// `tone` picks one of the existing chip styles (components/OrderSourceTag.tsx);
// no new colours.
export const ORDER_SOURCES = [
  { key: "website", label: "Website", tag: "Website", tone: "neutral", icon: "globe", channel: "storefront" },
  { key: "custom", label: "Custom order", tag: "Custom", tone: "neutral", icon: "pen", channel: null },
  { key: "talabat", label: "Talabat", tag: "Talabat", tone: "warning", icon: "store", channel: "talabat" },
  { key: "deliveroo", label: "Deliveroo", tag: "Deliveroo", tone: "accent", icon: "store", channel: "deliveroo" },
] as const;

export type OrderSource = (typeof ORDER_SOURCES)[number]["key"];
export type OrderSourceEntry = (typeof ORDER_SOURCES)[number];

export const ORDER_SOURCE_KEYS: readonly OrderSource[] = ORDER_SOURCES.map((s) => s.key);

export function isOrderSource(value: string): value is OrderSource {
  return (ORDER_SOURCE_KEYS as readonly string[]).includes(value);
}

export function orderSourceEntry(key: string | null | undefined): OrderSourceEntry | null {
  return ORDER_SOURCES.find((s) => s.key === key) ?? null;
}

// Website orders are the shop's own storefront and stay untagged.
export function showsSourceTag(key: string | null | undefined): boolean {
  return !!orderSourceEntry(key) && key !== "website";
}

// ---- URL state for the orders board and history (?sources=a,b&sort=source) ----

export type OrderListSort = "newest" | "source";

// Unknown keys are dropped; nothing (or nothing valid) means All.
export function parseSourcesParam(raw: string | null): OrderSource[] {
  if (!raw) return [];
  const picked = new Set(raw.split(",").filter(isOrderSource));
  return ORDER_SOURCE_KEYS.filter((k) => picked.has(k));
}

export function parseSortParam(raw: string | null): OrderListSort {
  return raw === "source" ? "source" : "newest";
}

// Writes the two keys into a copy of the current query, removing them at their
// defaults so a plain page URL stays plain.
export function withSourceParams(
  current: URLSearchParams,
  sources: readonly OrderSource[],
  sort: OrderListSort,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const ordered = ORDER_SOURCE_KEYS.filter((k) => sources.includes(k));
  if (ordered.length) next.set("sources", ordered.join(","));
  else next.delete("sources");
  if (sort === "source") next.set("sort", "source");
  else next.delete("sort");
  return next;
}
