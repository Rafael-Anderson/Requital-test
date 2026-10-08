import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

// Gives back the discount use an order holds, for BOTH limits together: deletes
// the order's discountredemption row (the per-customer count) and decrements
// discount.timesUsed (the global usageLimit counter) by exactly one.
//
// A PLAIN FUNCTION on the caller's own connection (same shape as
// markInvoicesSuperseded) so the release commits or rolls back with the status
// change that caused it, and so it can never touch the pool inside a
// transaction. Call it from the one place an order becomes cancelled
// (OrdersService.cancel) and where a return fully refunds an order.
//
// Idempotent by construction: the DELETE's affectedRows is the guard. The
// counter is only decremented by the call whose DELETE removed the row, so a
// second cancel, a retry, or a webhook cancel racing a staff cancel releases at
// most once (orderId is UNIQUE on discountredemption, so there is one row).
// Returns whether a use was actually released.
//
// Tenant scope: the redemption is found through discount.shopId AND order.shopId
// and the counter update re-checks shopId, so a row belonging to another shop
// can never be released from here. Auto discounts write no redemption row and
// never touch timesUsed, so they have nothing to release.
export async function releaseDiscountRedemption(
  conn: PoolConnection,
  shopId: number,
  orderId: number,
): Promise<boolean> {
  const [found] = await conn.query<RowDataPacket[]>(
    `SELECT dr.id AS id, dr.discountId AS discountId
       FROM discountredemption dr
       JOIN discount d ON d.id = dr.discountId AND d.shopId = ?
       JOIN \`order\` o ON o.id = dr.orderId AND o.shopId = ?
      WHERE dr.orderId = ?`,
    [shopId, shopId, orderId],
  );
  if (found.length === 0) return false;
  const { id, discountId } = found[0] as { id: number; discountId: number };

  // Lock order matches redeem(): discount row first, then the redemption row.
  await conn.query(`SELECT id FROM discount WHERE id = ? AND shopId = ? FOR UPDATE`, [
    discountId,
    shopId,
  ]);
  const [deleted] = await conn.query(
    `DELETE FROM discountredemption WHERE id = ?`,
    [id],
  );
  if ((deleted as { affectedRows: number }).affectedRows !== 1) return false;

  await conn.query(
    `UPDATE discount SET timesUsed = GREATEST(timesUsed - 1, 0), updatedAt = ?
      WHERE id = ? AND shopId = ?`,
    [new Date(), discountId, shopId],
  );
  return true;
}
