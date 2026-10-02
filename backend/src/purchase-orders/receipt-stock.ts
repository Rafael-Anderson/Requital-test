import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

// Posts one received line into the stock ledger on the caller's transaction
// connection. It is the same write every other stock-in path performs inline
// (adjustStock, scan-to-stock): an additive upsert of outletingredientstock plus
// a stockmovement row, in the same transaction, so SUM(stockmovement.delta) stays
// equal to the stock row (the W5 conservation invariant).
//
// Deliberately NOT touched: orderstockconsumption and order.consumptionRecordedAt.
// Those record what an ORDER holds out of stock so a cancel/return can give it
// back; a receipt is not an order, and stock it adds must never be "released" by
// any order lifecycle path. Nothing in here reads or writes either.
//
// ingredient.costPerUnit and product.costPrice are not touched either: the cost
// of this delivery lives on purchaseorderreceiptline, captured at receipt.
//
// `outletId` is the locked purchase order's own outlet (validated against the
// shop when the PO was created), never a client value.
export async function applyStockReceipt(
  conn: PoolConnection,
  p: {
    shopId: number;
    outletId: number;
    ingredientId: number;
    // Set only for a shadow ingredient, exactly as on every other movement row.
    productId: number | null;
    variantId: number | null;
    quantity: number;
    actorUserId: number | null;
    note: string;
  },
): Promise<{ movementId: number; crossedFromZero: boolean }> {
  await conn.query(
    `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE stockQuantity = stockQuantity + VALUES(stockQuantity)`,
    [p.outletId, p.ingredientId, p.quantity],
  );
  // Our own write holds the row lock, so this read is exact.
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT stockQuantity FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
    [p.outletId, p.ingredientId],
  );
  const after = rows[0].stockQuantity as number;
  const [result] = await conn.query(
    `INSERT INTO stockmovement (shopId, productId, variantId, ingredientId, type, reason, delta, outletId, toOutletId, note, actorUserId)
     VALUES (?, ?, ?, ?, 'PURCHASE_RECEIPT', NULL, ?, ?, NULL, ?, ?)`,
    [
      p.shopId,
      p.productId,
      p.variantId,
      p.ingredientId,
      p.quantity,
      p.outletId,
      p.note,
      p.actorUserId,
    ],
  );
  return {
    movementId: (result as { insertId: number }).insertId,
    crossedFromZero: after - p.quantity <= 0 && after > 0,
  };
}
