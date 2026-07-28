// Tax applies to the goods subtotal only, not the delivery fee — a common
// default and the simplest reading of "Exclusive/Inclusive tax rate" with
// nothing in the settings UI saying otherwise; revisit if a merchant needs
// delivery fees taxed too.
export function computeOrderTotals(params: {
  subtotal: number;
  deliveryFee: number;
  taxRate: number;
  taxInclusive: boolean;
}): { taxAmount: number; total: number } {
  const { subtotal, deliveryFee, taxRate, taxInclusive } = params;
  if (taxInclusive) {
    // Prices already include tax — back it out of the subtotal for display,
    // don't add it again on top.
    const taxAmount = subtotal - subtotal / (1 + taxRate / 100);
    return { taxAmount, total: subtotal + deliveryFee };
  }
  const taxAmount = subtotal * (taxRate / 100);
  return { taxAmount, total: subtotal + deliveryFee + taxAmount };
}

interface ZoneLike {
  name: string;
  isActive: boolean;
}

// Zones aren't modeled with a dedicated area/emirate column — they're a
// free-text `name` (e.g. "Dubai", "DXB/SHJ/AJM") — so matching is a
// case-insensitive compare against the customer's area first (more
// specific), falling back to their emirate. Flag back if zones should
// instead carry a structured area/emirate list.
export function matchDeliveryZone<Z extends ZoneLike>(
  zones: Z[],
  area: string | null | undefined,
  emirate: string,
): Z | null {
  const active = zones.filter((z) => z.isActive);
  const norm = (s: string) => s.trim().toLowerCase();
  if (area?.trim()) {
    const byArea = active.find((z) => norm(z.name) === norm(area));
    if (byArea) return byArea;
  }
  return active.find((z) => norm(z.name) === norm(emirate)) ?? null;
}
