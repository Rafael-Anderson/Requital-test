import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

// Per-shop order numbering. Reuses the atomic-upsert pattern proven by
// `invoicecounter` (see InvoicesService.nextInvoiceNumber) rather than inventing
// a second concurrency-safety mechanism.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS A CALLBACK AND NOT A FUNCTION THAT RETURNS A NUMBER
// ─────────────────────────────────────────────────────────────────────────────
// LAST_INSERT_ID() is per-CONNECTION state, not per-statement. The sequence
// below is only correct in one order:
//
//   1. upsert `ordercounter`, which sets LAST_INSERT_ID() to the new number
//   2. SELECT LAST_INSERT_ID() to read it back
//   3. INSERT the order carrying that number
//
// Step 3 is itself an AUTO_INCREMENT insert, so it OVERWRITES LAST_INSERT_ID()
// on this connection with the new order's own id. If steps 2 and 3 were ever
// swapped - or if a future edit slipped another insert between them - the
// "order number" read back would silently be the order's global id instead:
// exactly the 56,410-instead-of-1 bug this feature exists to remove, except
// now written into the column that is supposed to be the fix.
//
// That failure is silent, produces plausible-looking numbers, and no type
// signature would catch it. So the ordering is not documented and trusted, it
// is made impossible: the caller hands its INSERT in as `insertOrder`, and this
// function invokes it only after the claim has completed. There is no way to
// obtain a number from this module and insert "later", because the insert
// happens inside the call that produces the number.
//
// This mirrors the shape the codebase already uses for the same reason -
// DatabaseService.transaction(conn => ...) hands you a connection rather than
// letting you open and forget to close one.
//
// Do not refactor this into `const n = await claimOrderNumber(conn, shopId)`.
export async function withShopOrderNumber<T>(
  conn: PoolConnection,
  shopId: number,
  insertOrder: (shopOrderNumber: number) => Promise<T>,
): Promise<T> {
  const shopOrderNumber = await claimNext(conn, shopId);
  return insertOrder(shopOrderNumber);
}

// Deliberately NOT exported. Exporting it would re-open the ordering hazard the
// callback above closes, by making it possible to claim a number in one place
// and insert in another.
async function claimNext(
  conn: PoolConnection,
  shopId: number,
): Promise<number> {
  // Both branches wrap the value in LAST_INSERT_ID(...), including the seed.
  // `ordercounter` has no AUTO_INCREMENT column of its own, so on a shop's very
  // first order the plain-INSERT branch would leave LAST_INSERT_ID() holding
  // whatever unrelated insert last ran on this pooled connection. Wrapping the
  // seed is what makes the SELECT below correct on the create path and not just
  // the increment path - the same subtlety called out in
  // InvoicesService.nextInvoiceNumber.
  await conn.query(
    `INSERT INTO ordercounter (shopId, lastNumber)
     VALUES (?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE lastNumber = LAST_INSERT_ID(lastNumber + 1)`,
    [shopId],
  );
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT LAST_INSERT_ID() AS n`,
  );
  return Number(rows[0].n);
}
