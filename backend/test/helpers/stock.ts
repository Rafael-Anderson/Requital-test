import { PrismaService } from '../../src/prisma/prisma.service';

// Phase A: a usesIngredients:false product/variant's stock lives on its
// auto-provisioned shadow Ingredient's own outletingredientstock row, not
// on a product-keyed outletstock/outletvariantstock table (both retired).
// Tests that used to read those tables directly now resolve through the
// shadow the same way every stock-mutation endpoint does (see
// ProductsService.resolveShadowStockTarget) — this is that same resolution,
// kept here once so it isn't duplicated across every e2e spec that asserts
// on a raw stock number.
export async function getShadowStockQuantity(
  prisma: PrismaService,
  outletId: number,
  target: { productId: number; variantId?: number },
): Promise<number> {
  const ingredient = await prisma.ingredient.findFirst({
    where: target.variantId
      ? { shadowVariantId: target.variantId }
      : { shadowProductId: target.productId },
    select: { id: true },
  });
  if (!ingredient) return 0;
  const row = await prisma.outletingredientstock.findUnique({
    where: { outletId_ingredientId: { outletId, ingredientId: ingredient.id } },
  });
  return row?.stockQuantity ?? 0;
}
