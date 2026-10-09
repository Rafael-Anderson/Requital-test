import { NotFoundException } from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../database/database.service';

// The one tenant check every per-customer CRM endpoint starts with. A customer
// id from another shop is indistinguishable from one that does not exist (404),
// never 403, so ids cannot be probed across tenants.
export async function assertCustomerInShop(
  db: DatabaseService,
  shopId: number,
  customerId: number,
): Promise<void> {
  const rows = await db.query<RowDataPacket[]>(
    `SELECT id FROM customer WHERE id = ? AND shopId = ?`,
    [customerId, shopId],
  );
  if (rows.length === 0) {
    throw new NotFoundException(`Customer ${customerId} not found`);
  }
}

// Same check on a transaction's own connection, locking the customer row. Used
// by the writes that must serialise per customer (consent, store credit, merge).
export async function lockCustomerInShop(
  conn: PoolConnection,
  shopId: number,
  customerId: number,
): Promise<RowDataPacket> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT * FROM customer WHERE id = ? AND shopId = ? FOR UPDATE`,
    [customerId, shopId],
  );
  if (rows.length === 0) {
    throw new NotFoundException(`Customer ${customerId} not found`);
  }
  return rows[0];
}
