import type { AutoDiscount } from "./types";

export interface AutoDiscountedPrice {
  originalPrice: number;
  discountedPrice: number;
}

// Best (largest) applicable auto discount for a product, mirroring backend
// DiscountsService.computeAmount's math (percentage/fixed amount off,
// capped at the product's own price) — no code entry, no cart round trip.
// Pure so both ProductCard and the PDP can call it against the same
// once-per-session-fetched discount list (see shop-context.tsx).
export function computeAutoDiscountedPrice(
  product: { id: number; price: string; collections: { id: number }[] },
  autoDiscounts: AutoDiscount[],
): AutoDiscountedPrice | null {
  const price = Number(product.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const collectionIds = new Set(product.collections.map((c) => c.id));

  let bestAmount = 0;
  for (const discount of autoDiscounts) {
    if (discount.type === "FREE_SHIPPING") continue; // no effect on a product's own price
    const applies =
      discount.appliesTo === "SPECIFIC_PRODUCTS"
        ? discount.productIds.includes(product.id)
        : discount.appliesTo === "SPECIFIC_COLLECTIONS"
          ? discount.collectionIds.some((id) => collectionIds.has(id))
          : false; // ALL_PRODUCTS is never a valid scope for an auto discount (backend-enforced)
    if (!applies) continue;
    const value = Number(discount.value);
    const rawAmount = discount.type === "PERCENTAGE" ? (price * value) / 100 : value;
    const amount = Math.min(price, Math.max(0, rawAmount));
    if (amount > bestAmount) bestAmount = amount;
  }

  if (bestAmount <= 0) return null;
  return { originalPrice: price, discountedPrice: price - bestAmount };
}
