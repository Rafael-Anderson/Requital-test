import { adjustStock } from "./api";
import type { StockByOutlet } from "./types";

// Converts edited absolute quantities (what OutletQuantityTable shows) back
// into the delta-based adjustStock calls the backend actually expects — one
// call per outlet whose value changed, since a single bulk-adjust request is
// scoped to one outlet at a time. Shared by the product-level Inventory
// section and the per-variant edit modal.
export async function commitStockChanges(
  rows: StockByOutlet[],
  values: Record<number, string>,
  target: { productId: number; variantId?: number },
) {
  const changed = rows.filter((r) => {
    const raw = values[r.outletId];
    return raw !== undefined && Number(raw) !== r.stockQuantity;
  });
  await Promise.all(
    changed.map((r) =>
      adjustStock(
        [{ productId: target.productId, variantId: target.variantId, delta: Number(values[r.outletId]) - r.stockQuantity }],
        r.outletId,
      ),
    ),
  );
}
