// Where an order came from. Mirror of backend/src/orders/order-sources.ts (same
// entries, same order; backend order-sources.spec.ts fails when they differ).
// The storefront shows no source today; the type keeps any future order payload
// that carries `source` speaking the same vocabulary.
export const ORDER_SOURCES = [
  { key: "website", label: "Website", tag: "Website", tone: "neutral", icon: "globe", channel: "storefront" },
  { key: "custom", label: "Custom order", tag: "Custom", tone: "neutral", icon: "pen", channel: null },
  { key: "talabat", label: "Talabat", tag: "Talabat", tone: "warning", icon: "store", channel: "talabat" },
  { key: "deliveroo", label: "Deliveroo", tag: "Deliveroo", tone: "accent", icon: "store", channel: "deliveroo" },
] as const;

export type OrderSource = (typeof ORDER_SOURCES)[number]["key"];
