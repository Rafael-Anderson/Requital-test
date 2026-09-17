import type { Product, Shop } from "./types";

// PDP "Delivered in X" line — replaces the plain "In stock" text. Pure,
// client-side resolution (unlike product-is-new.ts's server-side
// resolution, which exists only because that feature compares against
// "today" in the shop's timezone; a duration has no such dependency).
export interface DeliveryTimeEstimate {
  from: number;
  to: number;
  unit: string;
}

// A product override is only used when all three fields are set (the
// backend enforces they're saved together or not at all) — otherwise falls
// back to the shop-wide default, which always has real values (NOT NULL
// DEFAULT columns).
export function resolveDeliveryTimeEstimate(product: Product, shop: Shop): DeliveryTimeEstimate {
  if (
    product.estimatedDeliveryTimeFrom != null &&
    product.estimatedDeliveryTimeTo != null &&
    product.estimatedDeliveryTimeUnit
  ) {
    return {
      from: product.estimatedDeliveryTimeFrom,
      to: product.estimatedDeliveryTimeTo,
      unit: product.estimatedDeliveryTimeUnit,
    };
  }
  return {
    from: shop.estimatedDeliveryTimeFrom,
    to: shop.estimatedDeliveryTimeTo,
    unit: shop.estimatedDeliveryTimeUnit,
  };
}

export function formatDeliveryTimeLabel(estimate: DeliveryTimeEstimate): string {
  const { from, to, unit } = estimate;
  const single = from === to;
  if (unit === "days") {
    if (single) return from === 1 ? "Delivered next day" : `Delivered in ${from} days`;
    return `Delivered in ${from}-${to} days`;
  }
  if (single) {
    const noun = unit === "hours" ? (from === 1 ? "hour" : "hours") : from === 1 ? "min" : "mins";
    return `Delivered in ${from} ${noun}`;
  }
  return `Delivered in ${from}-${to} ${unit}`;
}
