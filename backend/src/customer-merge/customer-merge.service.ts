import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isLockConflict } from '../database/mysql-errors';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { MergeCustomersDto } from './dto/merge.dto';

const WISHLIST_MAX = 100; // customer-account's cap
const MAX_ATTEMPTS = 3;

export interface MergeMoved {
  orders: number;
  draftOrders: number;
  giftCards: number;
  discountRedemptions: number;
  storeCreditEntries: number;
  notes: number;
  tags: number;
  consentEvents: number;
  addresses: number;
  wishlistItems: number;
}

// CUS-10. Folds duplicate customers of ONE shop into a primary. NOT REVERSIBLE:
// the duplicate row is deleted once everything it owned has been re-pointed. What
// is kept is a customermerge record (the duplicate's old contact snapshot, what
// moved, who did it, when), and the duplicate's old phone keeps resolving to the
// primary at checkout (CustomersService.findOrCreateForOrder).
//
// Concurrency. Rows are locked FOR UPDATE in ascending customer-id order, so two
// overlapping merges (or a merge and a store-credit spend, which also locks the
// customer row first) cannot deadlock on each other's customer rows. A merge
// still takes order-row locks after the customer locks, while a cancel/return
// takes an order lock and then the customer; that inversion is rare, and a
// deadlock InnoDB picks this transaction for is retried (the whole transaction
// rolled back, nothing half-moved), up to MAX_ATTEMPTS.
//
// Idempotent: a duplicate id that already has a merge record into this primary and
// no longer exists is reported, not an error, and not repeated.
@Injectable()
export class CustomerMergeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  async history(ctx: TenantContext, primaryId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT m.id, m.duplicateCustomerId, m.duplicateName, m.duplicatePhone, m.duplicateEmail,
              m.moved, m.createdAt, u.name AS actorName
         FROM customermerge m
         LEFT JOIN user u ON u.id = m.actorUserId AND u.shopId = m.shopId
        WHERE m.shopId = ? AND m.primaryCustomerId = ?
        ORDER BY m.id DESC`,
      [ctx.shopId, primaryId],
    );
    return rows.map((r) => ({
      id: r.id as number,
      duplicateCustomerId: r.duplicateCustomerId as number,
      duplicateName: (r.duplicateName as string | null) ?? null,
      duplicatePhone: (r.duplicatePhone as string | null) ?? null,
      duplicateEmail: (r.duplicateEmail as string | null) ?? null,
      moved: (typeof r.moved === 'string'
        ? JSON.parse(r.moved)
        : r.moved) as MergeMoved,
      actorName: (r.actorName as string | null) ?? null,
      createdAt: r.createdAt as Date,
    }));
  }

  // What WOULD move, without changing anything.
  async preview(ctx: TenantContext, primaryId: number, duplicateIds: number[]) {
    const ids = this.cleanIds(primaryId, duplicateIds);
    const customers = await this.db.query<RowDataPacket[]>(
      `SELECT id, name, phone, email, passwordHash FROM customer WHERE shopId = ? AND id IN (${[primaryId, ...ids].map(() => '?').join(', ')})`,
      [ctx.shopId, primaryId, ...ids],
    );
    if (customers.length !== ids.length + 1)
      throw new NotFoundException('One or more customers were not found');
    const counts = async (table: string, col: string) => {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${col}\` IN (${ids.map(() => '?').join(', ')}) AND shopId = ?`,
        [...ids, ctx.shopId],
      );
      return Number(rows[0].n);
    };
    return {
      customers: customers.map((c) => ({
        id: c.id as number,
        name: c.name as string,
        phone: c.phone as string,
        email: (c.email as string | null) ?? null,
        registered: c.passwordHash != null,
      })),
      willMove: {
        orders: await counts('order', 'customerId'),
        draftOrders: await counts('draftorder', 'customerId'),
        storeCreditEntries: await counts('storecreditentry', 'customerId'),
        notes: await counts('customernote', 'customerId'),
      },
    };
  }

  async merge(ctx: TenantContext, primaryId: number, dto: MergeCustomersDto) {
    const ids = this.cleanIds(primaryId, dto.duplicateIds);

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const out = await this.db.transaction((conn) =>
          this.mergeTx(conn, ctx, primaryId, ids),
        );
        if (out.merged.length > 0) {
          await this.auditLog.logCtx(ctx, {
            action: 'customer.merged',
            entityType: 'customer',
            entityId: primaryId,
            // Ids and counts only: no names, phones or emails in the audit row.
            after: {
              duplicateIds: out.merged.map((m) => m.duplicateCustomerId),
            },
          });
        }
        return {
          primaryId,
          merged: out.merged,
          alreadyMerged: out.alreadyMerged,
        };
      } catch (error) {
        lastError = error;
        if (!isLockConflict(error) || attempt === MAX_ATTEMPTS) break;
      }
    }
    if (isLockConflict(lastError)) {
      throw new ConflictException(
        'The customers are busy right now. Please try again.',
      );
    }
    throw lastError;
  }

  private cleanIds(primaryId: number, duplicateIds: number[]): number[] {
    const ids = [...new Set(duplicateIds)];
    if (ids.includes(primaryId)) {
      throw new BadRequestException('A customer cannot be merged into itself');
    }
    return ids;
  }

  private async mergeTx(
    conn: PoolConnection,
    ctx: TenantContext,
    primaryId: number,
    dupIds: number[],
  ): Promise<{
    merged: { duplicateCustomerId: number; moved: MergeMoved }[];
    alreadyMerged: number[];
  }> {
    const shopId = ctx.shopId;
    // 1. Lock every customer involved, lowest id first.
    const locked = new Map<number, RowDataPacket>();
    for (const id of [primaryId, ...dupIds].sort((a, b) => a - b)) {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM customer WHERE id = ? AND shopId = ? FOR UPDATE`,
        [id, shopId],
      );
      if (rows[0]) locked.set(id, rows[0]);
    }
    const primary = locked.get(primaryId);
    if (!primary)
      throw new NotFoundException(`Customer ${primaryId} not found`);

    // 2. A duplicate that is gone is only acceptable if THIS primary already
    //    absorbed it (a repeat of the same request). Anything else is a 404, which
    //    is also what a customer of another shop looks like.
    const alreadyMerged: number[] = [];
    const toMerge: number[] = [];
    for (const id of dupIds) {
      if (locked.has(id)) {
        toMerge.push(id);
        continue;
      }
      const [rec] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM customermerge WHERE shopId = ? AND duplicateCustomerId = ? AND primaryCustomerId = ?`,
        [shopId, id, primaryId],
      );
      if (rec.length === 0)
        throw new NotFoundException(`Customer ${id} not found`);
      alreadyMerged.push(id);
    }

    if (this.isAnonymised(primary)) {
      throw new ConflictException(
        'A deleted customer cannot be the merge target',
      );
    }
    for (const id of toMerge) {
      const dup = locked.get(id)!;
      if (this.isAnonymised(dup)) {
        throw new ConflictException(
          `Customer ${id} has been deleted and cannot be merged`,
        );
      }
      // Its login would be lost (the primary keeps its own). Merge the other way
      // round, or have the customer delete the extra account first.
      if (dup.passwordHash != null) {
        throw new ConflictException(
          `Customer ${id} has a storefront account. Choose that customer as the one to keep, or ask them to delete the extra account.`,
        );
      }
    }

    // 3. Move everything, one duplicate at a time.
    const merged: { duplicateCustomerId: number; moved: MergeMoved }[] = [];
    for (const id of toMerge) {
      const dup = locked.get(id)!;
      const moved = await this.mergeOne(conn, shopId, primary, dup);
      await conn.query(
        `INSERT INTO customermerge (shopId, primaryCustomerId, duplicateCustomerId, duplicateName, duplicatePhone, duplicateEmail, actorUserId, moved)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          shopId,
          primaryId,
          id,
          dup.name,
          dup.phone,
          dup.email ?? null,
          ctx.userId,
          JSON.stringify(moved),
        ],
      );
      // Anything that previously merged INTO the duplicate now belongs to the primary.
      await conn.query(
        `UPDATE customermerge SET primaryCustomerId = ? WHERE primaryCustomerId = ? AND shopId = ?`,
        [primaryId, id, shopId],
      );
      // Everything it owned is re-pointed; what is left (auth tokens, metrics,
      // tag links) goes with the row. storecreditentry is RESTRICT, so a ledger
      // row left behind would make this DELETE fail and roll the merge back.
      await conn.query(`DELETE FROM customer WHERE id = ? AND shopId = ?`, [
        id,
        shopId,
      ]);
      merged.push({ duplicateCustomerId: id, moved });
    }
    return { merged, alreadyMerged };
  }

  private isAnonymised(c: RowDataPacket): boolean {
    return String(c.email ?? '').endsWith('@deleted.requital');
  }

  private async mergeOne(
    conn: PoolConnection,
    shopId: number,
    primary: RowDataPacket,
    dup: RowDataPacket,
  ): Promise<MergeMoved> {
    const p = primary.id as number;
    const d = dup.id as number;
    const run = async (sql: string, params: (string | number)[]) => {
      const [res] = await conn.query(sql, params);
      return (res as { affectedRows: number }).affectedRows;
    };

    const orders = await this.moveOrders(conn, shopId, p, d, run);
    const draftOrders = await run(
      `UPDATE draftorder SET customerId = ? WHERE customerId = ? AND shopId = ?`,
      [p, d, shopId],
    );
    const giftCards = await run(
      `UPDATE giftcard SET purchasedByCustomerId = ? WHERE purchasedByCustomerId = ? AND shopId = ?`,
      [p, d, shopId],
    );
    // The per-customer discount limit counts rows by customerId: moving them is
    // what makes the primary inherit the duplicate's redemptions.
    const discountRedemptions = await run(
      `UPDATE discountredemption SET customerId = ? WHERE customerId = ?`,
      [p, d],
    );
    const storeCreditEntries = await this.moveLedger(conn, shopId, p, d, run);
    const notes = await run(
      `UPDATE customernote SET customerId = ? WHERE customerId = ? AND shopId = ?`,
      [p, d, shopId],
    );
    const tags = await run(
      `INSERT INTO customertagassignment (customerId, tagId, shopId)
       SELECT ?, src.tagId, src.shopId FROM customertagassignment src WHERE src.customerId = ? AND src.shopId = ?
       ON DUPLICATE KEY UPDATE customertagassignment.customerId = customertagassignment.customerId`,
      [p, d, shopId],
    );
    const consentEvents = await this.mergeConsent(conn, shopId, p, d, run);
    // Custom-field values: keep the primary's where both have one.
    await conn.query(
      `UPDATE IGNORE metafieldvalue SET ownerId = ? WHERE ownerType = 'customer' AND ownerId = ? AND shopId = ?`,
      [p, d, shopId],
    );
    await conn.query(
      `DELETE FROM metafieldvalue WHERE ownerType = 'customer' AND ownerId = ? AND shopId = ?`,
      [d, shopId],
    );

    const { addresses, wishlist, addressCount, wishlistCount } =
      this.mergeJsonLists(primary, dup);
    const email = (primary.email ?? dup.email ?? null) as string | null;
    const birthday = (primary.birthday ?? dup.birthday ?? null) as Date | null;
    await conn.query(
      `UPDATE customer SET addresses = ?, wishlist = ?, email = ?, birthday = ? WHERE id = ? AND shopId = ?`,
      [addresses, wishlist, email, birthday, p, shopId],
    );

    return {
      orders,
      draftOrders,
      giftCards,
      discountRedemptions,
      storeCreditEntries,
      notes,
      tags,
      consentEvents,
      addresses: addressCount,
      wishlistItems: wishlistCount,
    };
  }

  // Seam for the atomicity test: the orders move is the first and biggest step.
  protected moveOrders(
    _conn: PoolConnection,
    shopId: number,
    p: number,
    d: number,
    run: (sql: string, params: (string | number)[]) => Promise<number>,
  ) {
    return run(
      `UPDATE \`order\` SET customerId = ? WHERE customerId = ? AND shopId = ?`,
      [p, d, shopId],
    );
  }

  // Ledger rows are re-pointed, never copied or deleted: every row survives, so
  // the primary's balance in each currency is exactly its own plus the
  // duplicate's. The only UPDATE the ledger ever sees.
  protected moveLedger(
    _conn: PoolConnection,
    shopId: number,
    p: number,
    d: number,
    run: (sql: string, params: (string | number)[]) => Promise<number>,
  ) {
    return run(
      `UPDATE storecreditentry SET customerId = ? WHERE customerId = ? AND shopId = ?`,
      [p, d, shopId],
    );
  }

  // Per channel the more recent answer wins (a later withdrawal beats an earlier
  // grant and vice versa); a channel only one of them answered is taken as is.
  // History moves with it, so "what happened" stays complete on the primary.
  protected async mergeConsent(
    conn: PoolConnection,
    shopId: number,
    p: number,
    d: number,
    run: (sql: string, params: (string | number)[]) => Promise<number>,
  ) {
    await conn.query(
      `INSERT INTO customerconsent (customerId, channel, shopId, status, source, wordingVersion, updatedAt)
       SELECT ?, dc.channel, dc.shopId, dc.status, dc.source, dc.wordingVersion, dc.updatedAt
         FROM customerconsent dc
        WHERE dc.customerId = ? AND dc.shopId = ?
       ON DUPLICATE KEY UPDATE
         status = IF(VALUES(updatedAt) > customerconsent.updatedAt, VALUES(status), customerconsent.status),
         source = IF(VALUES(updatedAt) > customerconsent.updatedAt, VALUES(source), customerconsent.source),
         wordingVersion = IF(VALUES(updatedAt) > customerconsent.updatedAt, VALUES(wordingVersion), customerconsent.wordingVersion),
         updatedAt = GREATEST(VALUES(updatedAt), customerconsent.updatedAt)`,
      [p, d, shopId],
    );
    await conn.query(
      `DELETE FROM customerconsent WHERE customerId = ? AND shopId = ?`,
      [d, shopId],
    );
    return run(
      `UPDATE customerconsentevent SET customerId = ? WHERE customerId = ? AND shopId = ?`,
      [p, d, shopId],
    );
  }

  private mergeJsonLists(primary: RowDataPacket, dup: RowDataPacket) {
    const asArray = (v: unknown): unknown[] => {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') {
        try {
          const parsed: unknown = JSON.parse(v);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    };
    const pAddr = asArray(primary.addresses) as { id?: string }[];
    const dAddr = asArray(dup.addresses) as { id?: string }[];
    const seen = new Set(pAddr.map((a) => a.id));
    const addresses = [
      ...pAddr,
      ...dAddr.filter((a) => !a.id || !seen.has(a.id)),
    ];
    const pWish = asArray(primary.wishlist) as number[];
    const dWish = asArray(dup.wishlist) as number[];
    const wishlist = [...new Set([...pWish, ...dWish])].slice(0, WISHLIST_MAX);
    return {
      addresses: addresses.length
        ? JSON.stringify(addresses)
        : primary.addresses == null && dup.addresses == null
          ? null
          : JSON.stringify(addresses),
      wishlist: wishlist.length
        ? JSON.stringify(wishlist)
        : primary.wishlist == null && dup.wishlist == null
          ? null
          : JSON.stringify(wishlist),
      addressCount: dAddr.length,
      wishlistCount: dWish.length,
    };
  }
}
