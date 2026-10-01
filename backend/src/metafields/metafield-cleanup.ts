import type { MetafieldOwnerType } from './metafield-types';

// metafieldvalue.ownerId is polymorphic and carries no FK, so deleting an
// owner would otherwise leave its values behind. A plain function (not an
// injected service) so product/collection/outlet/customer code can call it
// without a module cycle, and so it can join the caller's transaction, same
// shape as invoices/invoice-superseded.ts. Ids are never reused (MySQL 8
// persists AUTO_INCREMENT), so an orphan could not attach to a later owner;
// this is hygiene and, for customers, a PDPL obligation.
export interface MetafieldExecutor {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export async function deleteMetafieldValues(
  exec: MetafieldExecutor,
  ownerType: MetafieldOwnerType,
  ownerIds: number[],
): Promise<void> {
  if (ownerIds.length === 0) return;
  await exec.query(
    `DELETE FROM metafieldvalue WHERE ownerType = ? AND ownerId IN (${ownerIds.map(() => '?').join(', ')})`,
    [ownerType, ...ownerIds],
  );
}

// Variants die with their product (ON DELETE CASCADE), so a product delete
// has to sweep its variants' values by product id before the cascade.
export async function deleteVariantMetafieldValuesForProduct(
  exec: MetafieldExecutor,
  productId: number,
): Promise<void> {
  await exec.query(
    `DELETE mv FROM metafieldvalue mv
       JOIN productvariant v ON v.id = mv.ownerId
      WHERE mv.ownerType = 'variant' AND v.productId = ?`,
    [productId],
  );
}
