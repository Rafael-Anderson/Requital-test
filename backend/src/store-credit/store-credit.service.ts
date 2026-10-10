import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { lockCustomerInShop, assertCustomerInShop } from '../customer-crm/customer-scope';
import { SUPPORTED_CURRENCIES } from '../shop/dto/update-shop.dto';
import {
  decimalToMinor,
  minorToDecimal,
  parseAdminAmount,
} from './store-credit-money';
import type { AdjustStoreCreditDto } from './dto/store-credit.dto';

export const STORE_CREDIT_ENTRY_TYPES = [
  'grant',
  'deduct',
  'spend',
  'spend_reversal',
  'return_refund',
] as const;

// CUS-6. An append-only ledger; a balance is SUM(amount) per (customer, currency).
// See the migration header for the data model and the unique keys that make each
// automatic entry idempotent.
//
// THE NON-NEGATIVE GUARANTEE. Every write that can lower a balance (an admin
// deduction, a checkout spend) runs in a transaction whose FIRST locking step is
// `SELECT ... FROM customer ... FOR UPDATE` on that customer's row, then reads the
// balance with a locking read and compares in integer minor units before
// inserting. Two concurrent spends for one customer therefore serialise on the
// customer row, and the second sees the first's committed entry. Credits (grant,
// reversal, refund) never need the guard and only add.
//
// Nothing inside a transaction here touches the pool: every method that takes a
// `conn` uses only it.
@Injectable()
export class StoreCreditService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---- reads (pool) ----

  async balances(shopId: number, customerId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT currency, SUM(amount) AS balance, COUNT(*) AS entries
         FROM storecreditentry WHERE customerId = ? AND shopId = ?
        GROUP BY currency ORDER BY currency`,
      [customerId, shopId],
    );
    return rows.map((r) => {
      const currency = r.currency as string;
      const minor = decimalToMinor(String(r.balance), currency);
      return {
        currency,
        balance: minorToDecimal(minor, currency),
        balanceMinor: minor,
        entries: Number(r.entries),
      };
    });
  }

  // The balance in ONE currency, in minor units (0 when there are no entries).
  async balanceMinor(shopId: number, customerId: number, currency: string): Promise<number> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount), 0) AS b FROM storecreditentry
        WHERE customerId = ? AND shopId = ? AND currency = ?`,
      [customerId, shopId, currency],
    );
    return decimalToMinor(String(rows[0].b), currency);
  }

  async entries(shopId: number, customerId: number, page = 1, pageSize = 50) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT e.id, e.currency, e.amount, e.entryType, e.reason,
              COALESCE(e.orderId, rt.orderId) AS orderId, e.returnId,
              e.actorUserId, u.name AS actorName, e.createdAt
         FROM storecreditentry e
         LEFT JOIN orderreturn rt ON rt.id = e.returnId
         LEFT JOIN user u ON u.id = e.actorUserId AND u.shopId = e.shopId
        WHERE e.customerId = ? AND e.shopId = ?
        ORDER BY e.id DESC
        LIMIT ? OFFSET ?`,
      [customerId, shopId, pageSize, (page - 1) * pageSize],
    );
    return rows.map((r) => ({
      id: r.id as number,
      currency: r.currency as string,
      amount: minorToDecimal(decimalToMinor(String(r.amount), r.currency as string), r.currency as string),
      type: r.entryType as string,
      reason: (r.reason as string | null) ?? null,
      orderId: (r.orderId as number | null) ?? null,
      returnId: (r.returnId as number | null) ?? null,
      actorName: (r.actorName as string | null) ?? null,
      createdAt: r.createdAt as Date,
    }));
  }

  async overview(shopId: number, customerId: number) {
    await assertCustomerInShop(this.db, shopId, customerId);
    const [balances, entries] = await Promise.all([
      this.balances(shopId, customerId),
      this.entries(shopId, customerId),
    ]);
    return { balances, entries };
  }

  // ---- admin grant / deduct ----

  async adjust(ctx: TenantContext, customerId: number, dto: AdjustStoreCreditDto) {
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(dto.currency)) {
      throw new BadRequestException('Unsupported currency');
    }
    const minor = parseAdminAmount(dto.amount, dto.currency);
    const signed = dto.direction === 'grant' ? minor : -minor;
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException('A reason is required');
    const entryType = dto.direction;

    const result = await this.db.transaction(async (conn) => {
      const customer = await lockCustomerInShop(conn, ctx.shopId, customerId);
      if (String(customer.email ?? '').endsWith('@deleted.requital')) {
        throw new ConflictException('This customer has been deleted');
      }
      if (dto.idempotencyKey) {
        const existing = await this.findByKey(conn, ctx.shopId, dto.idempotencyKey);
        if (existing) {
          const same =
            existing.customerId === customerId &&
            existing.currency === dto.currency &&
            decimalToMinor(String(existing.amount), dto.currency) === signed;
          if (!same) {
            throw new ConflictException('That idempotency key was already used for a different request');
          }
          return { id: existing.id as number, replay: true };
        }
      }
      if (signed < 0) {
        const have = await this.lockedBalanceMinor(conn, customerId, dto.currency);
        if (have + signed < 0) {
          throw new ConflictException(
            `This would take the balance below zero (balance ${minorToDecimal(have, dto.currency)} ${dto.currency})`,
          );
        }
      }
      try {
        const [res] = await conn.query(
          `INSERT INTO storecreditentry (shopId, customerId, currency, amount, entryType, reason, actorUserId, idempotencyKey)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ctx.shopId,
            customerId,
            dto.currency,
            minorToDecimal(signed, dto.currency),
            entryType,
            reason,
            ctx.userId,
            dto.idempotencyKey ?? null,
          ],
        );
        return { id: (res as { insertId: number }).insertId, replay: false };
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new ConflictException('That idempotency key was already used');
        }
        throw error;
      }
    });

    if (!result.replay) {
      await this.auditLog.logCtx(ctx, {
        action: dto.direction === 'grant' ? 'customer.store_credit.granted' : 'customer.store_credit.deducted',
        entityType: 'customer',
        entityId: customerId,
        // The reason is on the ledger row; the audit entry carries the figures.
        after: { currency: dto.currency, amount: minorToDecimal(minor, dto.currency), entryId: result.id },
      });
    }
    return { ...(await this.overview(ctx.shopId, customerId)), replay: result.replay };
  }

  // ---- checkout / cancel / return (all on the caller's transaction) ----

  // Locks the customer row. The caller makes this the FIRST statement of its
  // transaction, before anything else that locks (stock, discount), so every
  // flow that touches one customer's credit takes locks in the same order.
  lockCustomer(conn: PoolConnection, shopId: number, customerId: number) {
    return lockCustomerInShop(conn, shopId, customerId);
  }

  // Draws `amountMinor` of the customer's credit in `currency` for an order.
  // Re-reads the balance under the customer lock and refuses (409) rather than
  // ever going below zero or spending less than the order was priced with.
  async spend(
    conn: PoolConnection,
    shopId: number,
    customerId: number,
    orderId: number,
    currency: string,
    amountMinor: number,
  ): Promise<void> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new Error('spend() needs a positive whole number of minor units');
    }
    await lockCustomerInShop(conn, shopId, customerId);
    const have = await this.lockedBalanceMinor(conn, customerId, currency);
    if (have < amountMinor) {
      throw new ConflictException(
        'Your store credit balance just changed. Please review your order and try again.',
      );
    }
    await conn.query(
      `INSERT INTO storecreditentry (shopId, customerId, currency, amount, entryType, orderId)
       VALUES (?, ?, ?, ?, 'spend', ?)`,
      [shopId, customerId, currency, minorToDecimal(-amountMinor, currency), orderId],
    );
  }

  // Puts back what an order spent. IDEMPOTENT by the (orderId, entryType) unique
  // key: running it twice, or racing two cancels, writes one reversal. Returns the
  // number of minor units restored (0 when the order spent none or was already
  // reversed). Re-uses the original entry's customer and currency, so credit can
  // only ever return to the account and currency it came from.
  async reverseSpendForOrder(
    conn: PoolConnection,
    shopId: number,
    orderId: number,
    reason: string,
  ): Promise<void> {
    await conn.query(
      `INSERT INTO storecreditentry (shopId, customerId, currency, amount, entryType, reason, orderId)
       SELECT s.shopId, s.customerId, s.currency, -s.amount, 'spend_reversal', ?, s.orderId
         FROM storecreditentry s
        WHERE s.orderId = ? AND s.shopId = ? AND s.entryType = 'spend'
       ON DUPLICATE KEY UPDATE storecreditentry.id = storecreditentry.id`,
      [reason, orderId, shopId],
    );
  }

  // Credit issued for a return (the store-credit-paid share of the refund, plus the
  // rest when staff chose "refund to store credit"). One per return, by the
  // (returnId, entryType) unique key. orderId is deliberately NOT stored on the
  // row: (orderId, entryType) is unique and an order can have several returns, so
  // the order is reached through the return (see entries()).
  async creditForReturn(
    conn: PoolConnection,
    shopId: number,
    customerId: number,
    returnId: number,
    currency: string,
    amountMinor: number,
    reason: string,
  ): Promise<void> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) return;
    await lockCustomerInShop(conn, shopId, customerId);
    await conn.query(
      `INSERT INTO storecreditentry (shopId, customerId, currency, amount, entryType, reason, returnId)
       VALUES (?, ?, ?, ?, 'return_refund', ?, ?)`,
      [shopId, customerId, currency, minorToDecimal(amountMinor, currency), reason, returnId],
    );
  }

  // ---- internals ----

  private async lockedBalanceMinor(
    conn: PoolConnection,
    customerId: number,
    currency: string,
  ): Promise<number> {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount), 0) AS b FROM storecreditentry
        WHERE customerId = ? AND currency = ? FOR UPDATE`,
      [customerId, currency],
    );
    return decimalToMinor(String(rows[0].b), currency);
  }

  private async findByKey(conn: PoolConnection, shopId: number, key: string) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, customerId, currency, amount FROM storecreditentry
        WHERE shopId = ? AND idempotencyKey = ? FOR UPDATE`,
      [shopId, key],
    );
    return rows[0] ?? null;
  }
}
