import { DatabaseService } from '../../src/database/database.service';
import type { RowDataPacket } from 'mysql2/promise';

// Phase A: a usesIngredients:false product/variant's stock lives on its
// auto-provisioned shadow Ingredient's own outletingredientstock row, not
// on a product-keyed outletstock/outletvariantstock table (both retired).
// Tests that used to read those tables directly now resolve through the
// shadow the same way every stock-mutation endpoint does (see
// ProductsService.resolveShadowStockTarget) — this is that same resolution,
// kept here once so it isn't duplicated across every e2e spec that asserts
// on a raw stock number.
export async function getShadowStockQuantity(
  db: DatabaseService,
  outletId: number,
  target: { productId: number; variantId?: number },
): Promise<number> {
  const ingredientRows = await db.query<RowDataPacket[]>(
    target.variantId
      ? `SELECT id FROM ingredient WHERE shadowVariantId = ?`
      : `SELECT id FROM ingredient WHERE shadowProductId = ?`,
    [target.variantId ?? target.productId],
  );
  const ingredient = ingredientRows[0];
  if (!ingredient) return 0;
  const stockRows = await db.query<RowDataPacket[]>(
    `SELECT stockQuantity FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
    [outletId, ingredient.id],
  );
  return (stockRows[0]?.stockQuantity as number | undefined) ?? 0;
}
