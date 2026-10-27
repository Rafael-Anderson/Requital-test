import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { TenantContext } from '../common/tenant-context';
import { createLogger } from '../common/logging/logger';
import { AuditLogService } from '../audit-log/audit-log.service';
import { FeaturesService } from '../features/features.service';
import { JobsService } from '../jobs/jobs.service';
import { JobsWorkerService } from '../jobs/jobs.worker.service';
import type { LoyaltyEarnJobPayload } from '../jobs/jobs.types';
import {
  assertCustomerInShop,
  lockCustomerInShop,
} from '../customer-crm/customer-scope';
import { isMarketplaceChannel } from '../channels/marketplace-channels';
import { ONLINE_PAYMENT_METHODS } from '../reports/attribution-report';
import { StoreCreditService } from '../store-credit/store-credit.service';
import { minorToDecimal } from '../store-credit/store-credit-money';
import type { CustomerContext } from '../customer-auth/customer-context';
import type {
  AdjustLoyaltyDto,
  RedeemLoyaltyDto,
  SaveLoyaltyProgramDto,
} from './dto/loyalty.dto';
import {
  clawbackTarget,
  earnBaseMinor,
  earnPoints,
  parseRate,
  redeemCreditMinor,
  toMinor,
  MAX_EARN_RATE,
  MAX_REDEEM_POINTS_PER_UNIT,
  type EarnBase,
} from './loyalty-math';

const logger = createLogger('LoyaltyService');

// Defaults of a shop that never saved a program: everything off, no rate.
const DEFAULT_PROGRAM = {
  enabled: false,
  earnRate: '0',
  earnBase: 'net_paid' as EarnBase,
  redeemEnabled: false,
  redeemPointsPerUnit: '0',
  redeemMinPoints: 1,
  redeemStepPoints: 1,
  redeemMaxPoints: null as number | null,
};
type Program = typeof DEFAULT_PROGRAM;

// A decimal(12,4) as the shortest string ("1.5000" -> "1.5", "100.0000" -> "100").
function trimRate(v: string | number | null): string {
  const s = String(v ?? '0');
  return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
}

// CUS-5 loyalty. The ledger (loyaltyentry) is append-only; a balance is
// SUM(points). THE GATES: everything here is behind the `loyalty` feature key
// (platform grant) AND loyaltyprogram.enabled (the merchant's switch). With
// either off, nothing is earned, clawed back, redeemed or shown, and nothing is
// written. Redeeming also needs redeemEnabled and the shop's phone_otp_register
// flag (see redeem()).
//
// LOCK ORDER (same as the rest of the money paths): order -> customer -> ledger.
// Earn and clawback run on a transaction that already holds the order row; every
// path that lowers a balance takes the customer row FOR UPDATE first and reads the
// balance under it, so two concurrent redemptions serialise and the second sees
// the first's committed entry. Nothing inside a transaction here touches the pool.
@Injectable()
export class LoyaltyService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly features: FeaturesService,
    private readonly jobs: JobsService,
    private readonly worker: JobsWorkerService,
    private readonly storeCredit: StoreCreditService,
    private readonly auditLog: AuditLogService,
  ) {}

  onModuleInit(): void {
    this.worker.registerHandler('loyalty_earn', (payload) =>
      this.earnForOrder(payload as unknown as LoyaltyEarnJobPayload),
    );
  }

  // ---- gates ----

  private async programRow(
    shopId: number,
    conn?: PoolConnection,
  ): Promise<(Program & { id: number }) | null> {
    const sql = `SELECT id, enabled, earnRate, earnBase, redeemEnabled, redeemPointsPerUnit,
                        redeemMinPoints, redeemStepPoints, redeemMaxPoints
                   FROM loyaltyprogram WHERE shopId = ?`;
    const rows = conn
      ? (await conn.query<RowDataPacket[]>(sql, [shopId]))[0]
      : await this.db.query<RowDataPacket[]>(sql, [shopId]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id as number,
      enabled: Boolean(r.enabled),
      earnRate: trimRate(r.earnRate as string),
      earnBase: r.earnBase as EarnBase,
      redeemEnabled: Boolean(r.redeemEnabled),
      redeemPointsPerUnit: trimRate(r.redeemPointsPerUnit as string),
      redeemMinPoints: r.redeemMinPoints as number,
      redeemStepPoints: r.redeemStepPoints as number,
      redeemMaxPoints: (r.redeemMaxPoints as number | null) ?? null,
    };
  }

  // The program when loyalty is live for the shop (flag on AND program enabled),
  // else null. `conn` reads inside the caller's transaction.
  private async liveProgram(shopId: number, conn?: PoolConnection) {
    if (!(await this.features.isEnabled(shopId, 'loyalty', conn))) return null;
    const p = await this.programRow(shopId, conn);
    return p?.enabled ? p : null;
  }

  // Pre-transaction check for OrdersService: is it worth queueing an earn job.
  // The handler re-checks under locks, so this only saves queue rows.
  async isLive(shopId: number): Promise<boolean> {
    return (await this.liveProgram(shopId)) !== null;
  }

  // Redemption needs a strictly larger set of gates. Returns the program or null.
  private async redeemProgram(shopId: number, conn?: PoolConnection) {
    const p = await this.liveProgram(shopId, conn);
    if (!p || !p.redeemEnabled) return null;
    if (!(await this.features.isEnabled(shopId, 'phone_otp_register', conn))) {
      return null;
    }
    const rate = parseRate(p.redeemPointsPerUnit);
    if (rate === null || rate <= 0n) return null;
    return p;
  }

  // ---- admin: program ----

  async getProgram(shopId: number) {
    const available = await this.features.isEnabled(shopId, 'loyalty');
    if (!available) return { available: false as const };
    const row = await this.programRow(shopId);
    const { id: _id, ...program } = row ?? { id: 0, ...DEFAULT_PROGRAM };
    void _id;
    const cur = await this.db.query<RowDataPacket[]>(
      `SELECT currency FROM shop WHERE id = ?`,
      [shopId],
    );
    return {
      available: true as const,
      currency: (cur[0]?.currency as string | undefined) ?? null,
      // Redemption also needs the shop's phone verification flag; the page
      // explains why it may be unavailable.
      phoneVerificationOn: await this.features.isEnabled(
        shopId,
        'phone_otp_register',
      ),
      program,
    };
  }

  async saveProgram(ctx: TenantContext, dto: SaveLoyaltyProgramDto) {
    if (!(await this.features.isEnabled(ctx.shopId, 'loyalty'))) {
      throw new NotFoundException('Not found');
    }
    const before = (await this.programRow(ctx.shopId)) ?? {
      id: 0,
      ...DEFAULT_PROGRAM,
    };
    const next: Program = {
      enabled: dto.enabled ?? before.enabled,
      earnRate:
        dto.earnRate !== undefined
          ? this.rateText(dto.earnRate, 'earnRate', MAX_EARN_RATE)
          : before.earnRate,
      earnBase: dto.earnBase ?? before.earnBase,
      redeemEnabled: dto.redeemEnabled ?? before.redeemEnabled,
      redeemPointsPerUnit:
        dto.redeemPointsPerUnit !== undefined
          ? this.rateText(
              dto.redeemPointsPerUnit,
              'redeemPointsPerUnit',
              MAX_REDEEM_POINTS_PER_UNIT,
            )
          : before.redeemPointsPerUnit,
      redeemMinPoints: dto.redeemMinPoints ?? before.redeemMinPoints,
      redeemStepPoints: dto.redeemStepPoints ?? before.redeemStepPoints,
      redeemMaxPoints:
        dto.redeemMaxPoints !== undefined
          ? dto.redeemMaxPoints
          : before.redeemMaxPoints,
    };
    if (next.enabled && Number(next.earnRate) <= 0) {
      throw new BadRequestException(
        'Set how many points a customer earns per currency unit before turning loyalty on',
      );
    }
    if (next.redeemEnabled && Number(next.redeemPointsPerUnit) <= 0) {
      throw new BadRequestException(
        'Set how many points make one currency unit of store credit before turning redemption on',
      );
    }
    if (
      next.redeemMaxPoints !== null &&
      next.redeemMaxPoints < next.redeemMinPoints
    ) {
      throw new BadRequestException(
        'The maximum per redemption cannot be below the minimum',
      );
    }
    await this.db.execute(
      `INSERT INTO loyaltyprogram (shopId, enabled, earnRate, earnBase, redeemEnabled, redeemPointsPerUnit, redeemMinPoints, redeemStepPoints, redeemMaxPoints)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), earnRate = VALUES(earnRate), earnBase = VALUES(earnBase),
         redeemEnabled = VALUES(redeemEnabled), redeemPointsPerUnit = VALUES(redeemPointsPerUnit),
         redeemMinPoints = VALUES(redeemMinPoints), redeemStepPoints = VALUES(redeemStepPoints),
         redeemMaxPoints = VALUES(redeemMaxPoints), updatedAt = CURRENT_TIMESTAMP(3)`,
      [
        ctx.shopId,
        next.enabled,
        next.earnRate,
        next.earnBase,
        next.redeemEnabled,
        next.redeemPointsPerUnit,
        next.redeemMinPoints,
        next.redeemStepPoints,
        next.redeemMaxPoints,
      ],
    );
    const { id: _b, ...beforeView } = before;
    void _b;
    await this.auditLog.logCtx(ctx, {
      action: 'loyalty.program_saved',
      entityType: 'loyaltyprogram',
      before: beforeView,
      after: next,
    });
    return this.getProgram(ctx.shopId);
  }

  private rateText(raw: unknown, field: string, max: number): string {
    const r = parseRate(raw);
    if (r === null) {
      throw new BadRequestException(
        `${field} must be a number with at most 4 decimal places`,
      );
    }
    if (r > BigInt(max) * 10000n) {
      throw new BadRequestException(`${field} cannot be more than ${max}`);
    }
    return trimRate(`${r / 10000n}.${String(r % 10000n).padStart(4, '0')}`);
  }

  // ---- reads ----

  private async balanceOf(shopId: number, customerId: number): Promise<number> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(points), 0) AS b FROM loyaltyentry WHERE shopId = ? AND customerId = ?`,
      [shopId, customerId],
    );
    return Number(rows[0].b);
  }

  private async lockedBalance(
    conn: PoolConnection,
    shopId: number,
    customerId: number,
  ): Promise<number> {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(points), 0) AS b FROM loyaltyentry WHERE shopId = ? AND customerId = ? FOR UPDATE`,
      [shopId, customerId],
    );
    return Number(rows[0].b);
  }

  // customerView: the shopper must not see who on the staff made an entry or the
  // reason the staff typed (those are for the merchant).
  private async entries(
    shopId: number,
    customerId: number,
    limit: number,
    customerView: boolean,
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT e.id, e.entryType, e.points, e.shortfall, e.reason, e.orderId, o.shopOrderNumber AS orderNumber,
              e.returnId, e.actorUserId, u.name AS actorName, e.createdAt
         FROM loyaltyentry e
         LEFT JOIN \`order\` o ON o.id = e.orderId AND o.shopId = e.shopId
         LEFT JOIN user u ON u.id = e.actorUserId AND u.shopId = e.shopId
        WHERE e.customerId = ? AND e.shopId = ?
        ORDER BY e.id DESC
        LIMIT ?`,
      [customerId, shopId, limit],
    );
    return rows.map((r) => ({
      id: r.id as number,
      type: r.entryType as string,
      points: r.points as number,
      shortfall: customerView ? 0 : (r.shortfall as number),
      reason:
        customerView && r.actorUserId != null
          ? null
          : ((r.reason as string | null) ?? null),
      orderId: (r.orderId as number | null) ?? null,
      orderNumber: (r.orderNumber as number | null) ?? null,
      returnId: (r.returnId as number | null) ?? null,
      actorName: customerView ? null : ((r.actorName as string | null) ?? null),
      createdAt: r.createdAt as Date,
    }));
  }

  // Admin customer card. `available: false` when the platform grant is off, so the
  // page can hide the card; the customer id is tenant-checked first (404).
  async customerOverview(shopId: number, customerId: number) {
    await assertCustomerInShop(this.db, shopId, customerId);
    if (!(await this.features.isEnabled(shopId, 'loyalty'))) {
      return { available: false as const };
    }
    const program = await this.programRow(shopId);
    const [balance, entries, short] = await Promise.all([
      this.balanceOf(shopId, customerId),
      this.entries(shopId, customerId, 50, false),
      this.db.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(shortfall), 0) AS s FROM loyaltyentry WHERE shopId = ? AND customerId = ?`,
        [shopId, customerId],
      ),
    ]);
    return {
      available: true as const,
      programEnabled: program?.enabled ?? false,
      balance,
      // Points that could not be taken back on returns because they were already
      // spent. Admin only. See the clamp in clawbackForReturn.
      shortfallTotal: Number(short[0].s),
      entries,
    };
  }

  // Storefront account card. `enabled: false` (and nothing else) when the flag or
  // the program is off. Always the caller's own customer id (from the session).
  async accountOverview(ctx: CustomerContext) {
    const p = await this.liveProgram(ctx.shopId);
    if (!p) return { enabled: false as const };
    const [balance, entries, redeemP, cur, who] = await Promise.all([
      this.balanceOf(ctx.shopId, ctx.customerId),
      this.entries(ctx.shopId, ctx.customerId, 20, true),
      this.redeemProgram(ctx.shopId),
      this.db.query<RowDataPacket[]>(`SELECT currency FROM shop WHERE id = ?`, [
        ctx.shopId,
      ]),
      this.db.query<RowDataPacket[]>(
        `SELECT phoneVerifiedAt FROM customer WHERE id = ? AND shopId = ?`,
        [ctx.customerId, ctx.shopId],
      ),
    ]);
    const currency = cur[0]?.currency as string;
    const phoneVerified = who[0]?.phoneVerifiedAt != null;
    return {
      enabled: true as const,
      balance,
      entries,
      redeem:
        redeemP && phoneVerified
          ? {
              pointsPerUnit: redeemP.redeemPointsPerUnit,
              minPoints: redeemP.redeemMinPoints,
              stepPoints: redeemP.redeemStepPoints,
              maxPoints: redeemP.redeemMaxPoints,
              currency,
            }
          : null,
    };
  }

  // PDPL export: the customer's own balance and ledger, whatever the flags say
  // (it is their data). Reason text typed by staff is withheld.
  async exportFor(shopId: number, customerId: number) {
    const [balance, entries] = await Promise.all([
      this.balanceOf(shopId, customerId),
      this.entries(shopId, customerId, 1000, true),
    ]);
    return { balance, entries };
  }

  // ---- admin adjust ----

  async adjust(ctx: TenantContext, customerId: number, dto: AdjustLoyaltyDto) {
    if (dto.points === 0) {
      throw new BadRequestException('points cannot be zero');
    }
    const reason = dto.reason.trim();
    if (reason.length < 3)
      throw new BadRequestException('A reason is required');
    if (!(await this.features.isEnabled(ctx.shopId, 'loyalty'))) {
      throw new NotFoundException('Not found');
    }
    const key = dto.idempotencyKey
      ? `adjust:${customerId}:${dto.idempotencyKey}`
      : null;

    const result = await this.db.transaction(async (conn) => {
      const customer = await lockCustomerInShop(conn, ctx.shopId, customerId);
      if (String(customer.email ?? '').endsWith('@deleted.requital')) {
        throw new ConflictException('This customer has been deleted');
      }
      if (key) {
        const existing = await this.findByKey(conn, ctx.shopId, key);
        if (existing) {
          if (
            existing.customerId !== customerId ||
            existing.points !== dto.points
          ) {
            throw new ConflictException(
              'That idempotency key was already used for a different request',
            );
          }
          return { id: existing.id, replay: true };
        }
      }
      if (dto.points < 0) {
        const have = await this.lockedBalance(conn, ctx.shopId, customerId);
        if (have + dto.points < 0) {
          throw new ConflictException(
            `This would take the balance below zero (balance ${have} points)`,
          );
        }
      }
      try {
        const [res] = await conn.query(
          `INSERT INTO loyaltyentry (shopId, customerId, entryType, points, reason, actorUserId, idempotencyKey)
           VALUES (?, ?, 'adjust', ?, ?, ?, ?)`,
          [ctx.shopId, customerId, dto.points, reason, ctx.userId, key],
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
        action: 'customer.loyalty.adjusted',
        entityType: 'customer',
        entityId: customerId,
        // The reason is on the ledger row; the audit entry carries the figures.
        after: { points: dto.points, entryId: result.id },
      });
    }
    return {
      ...(await this.customerOverview(ctx.shopId, customerId)),
      replay: result.replay,
    };
  }

  private async findByKey(conn: PoolConnection, shopId: number, key: string) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, customerId, points FROM loyaltyentry WHERE shopId = ? AND idempotencyKey = ? FOR UPDATE`,
      [shopId, key],
    );
    return rows[0]
      ? {
          id: rows[0].id as number,
          customerId: rows[0].customerId as number,
          points: rows[0].points as number,
        }
      : null;
  }

  // ---- earn ----

  // Queues the earn job for an order that just became delivered. Called INSIDE
  // the status-change transaction with its connection, so the job commits or rolls
  // back with the status (no lost or phantom job). Idempotent on the job key.
  async enqueueEarn(
    conn: PoolConnection,
    shopId: number,
    orderId: number,
  ): Promise<void> {
    await this.jobs.enqueue(
      shopId,
      'loyalty_earn',
      { shopId, orderId } satisfies LoyaltyEarnJobPayload,
      `loyalty:earn:${orderId}`,
      { tx: conn },
    );
  }

  // The job handler. One transaction: order row lock, then customer row lock,
  // then the earn row, whose (orderId, entryType) unique key makes any duplicate
  // delivery of the job (or a second job) a no-op. Eligibility, all re-read here:
  //   - the order is delivered, in THIS shop, not refunded, not a marketplace order;
  //   - it belongs to a customer with a real account (a guest checkout row has no
  //     passwordHash) that has not been anonymised;
  //   - loyalty is live for the shop and the base earns at least one point.
  // Anything else is a quiet skip, never an error (a retry would not change it).
  async earnForOrder(payload: LoyaltyEarnJobPayload): Promise<void> {
    const { shopId, orderId } = payload;
    if (!Number.isInteger(shopId) || !Number.isInteger(orderId)) return;
    const earned = await this.db.transaction(async (conn) => {
      const [orders] = await conn.query<RowDataPacket[]>(
        `SELECT status, paymentStatus, paymentMethod, channel, customerId, currency, total, deliveryFee, taxAmount, giftCardAmount, storeCreditAmount
           FROM \`order\` WHERE id = ? AND shopId = ? FOR UPDATE`,
        [orderId, shopId],
      );
      const o = orders[0];
      if (
        !o ||
        o.status !== 'delivered' ||
        o.paymentStatus === 'refunded' ||
        // An online-payment order earns only once it is PAID (a delivered order
        // that was never paid is a gateway or ops problem, not a sale). Cash and
        // card-at-handover orders are settled by the delivery itself.
        (ONLINE_PAYMENT_METHODS.includes(o.paymentMethod as string) &&
          o.paymentStatus !== 'paid') ||
        isMarketplaceChannel(o.channel as string | null) ||
        o.customerId == null
      ) {
        return 0;
      }
      const program = await this.liveProgram(shopId, conn);
      if (!program) return 0;
      const customer = await lockCustomerInShop(
        conn,
        shopId,
        o.customerId as number,
      );
      if (
        customer.passwordHash == null ||
        String(customer.email ?? '').endsWith('@deleted.requital')
      ) {
        return 0;
      }
      const rate = parseRate(program.earnRate);
      if (rate === null) return 0;
      const currency = o.currency as string;
      const points = earnPoints(
        earnBaseMinor(
          {
            total: o.total,
            deliveryFee: o.deliveryFee,
            taxAmount: o.taxAmount,
            giftCardAmount: o.giftCardAmount,
            storeCreditAmount: o.storeCreditAmount,
            currency,
          },
          program.earnBase,
        ),
        rate,
        currency,
      );
      if (points <= 0) return 0;
      try {
        await conn.query(
          `INSERT INTO loyaltyentry (shopId, customerId, entryType, points, orderId)
           VALUES (?, ?, 'earn', ?, ?)`,
          [shopId, o.customerId, points, orderId],
        );
      } catch (error) {
        if (isDuplicateKeyError(error)) return 0;
        throw error;
      }
      // A return that landed BEFORE this job ran found no earn row to claw back
      // from, so catch up here: the same cumulative rule clawbackForReturn uses,
      // booked on the latest return (the order row lock we hold serialises this
      // against any return, so a later one will see this earn row instead).
      const [refunds] = await conn.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(refundAmount), 0) AS refunded, MAX(id) AS lastReturnId
           FROM orderreturn WHERE orderId = ?`,
        [orderId],
      );
      const lastReturnId = refunds[0].lastReturnId as number | null;
      if (lastReturnId != null) {
        const claw = clawbackTarget(
          points,
          toMinor(refunds[0].refunded, currency),
          toMinor(o.total, currency) - toMinor(o.deliveryFee, currency),
        );
        if (claw > 0) {
          await conn.query(
            `INSERT INTO loyaltyentry (shopId, customerId, entryType, points, returnId)
             VALUES (?, ?, 'clawback', ?, ?)`,
            [shopId, o.customerId, -claw, lastReturnId],
          );
        }
      }
      return points;
    });
    if (earned > 0) {
      logger.info('loyalty points earned', { shopId, orderId, points: earned });
    }
  }

  // ---- clawback (inside ReturnsService.create's transaction) ----

  // Takes back the share of an order's earned points that the money refunded so
  // far represents. `refundedMinor` is the cumulative refund INCLUDING this
  // return; `refundableMinor` is what can ever be refunded by default (order total
  // minus the delivery fee). The caller holds the order row lock; this takes the
  // customer lock next. Idempotent per return by (returnId, 'clawback').
  //
  // THE FLOOR (owner decision, flagged): the ledger never goes below zero. When the
  // customer has already spent the points, the clawback is CLAMPED to the balance
  // and the unrecovered part is recorded as `shortfall` on the entry; the store
  // credit those points bought is NOT reclaimed.
  //
  // Needs only the platform grant (not program.enabled): a merchant pausing the
  // program must not make returned orders keep their points.
  async clawbackForReturn(
    conn: PoolConnection,
    p: {
      shopId: number;
      orderId: number;
      returnId: number;
      customerId: number | null;
      refundedMinor: number;
      refundableMinor: number;
    },
  ): Promise<void> {
    if (p.customerId == null) return;
    if (!(await this.features.isEnabled(p.shopId, 'loyalty', conn))) return;
    const [earnRows] = await conn.query<RowDataPacket[]>(
      `SELECT customerId, points FROM loyaltyentry
        WHERE shopId = ? AND orderId = ? AND entryType = 'earn'`,
      [p.shopId, p.orderId],
    );
    const earn = earnRows[0];
    if (!earn) return;
    const customerId = earn.customerId as number;
    await lockCustomerInShop(conn, p.shopId, customerId);
    const [priorRows] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(-e.points + e.shortfall), 0) AS gross
         FROM loyaltyentry e JOIN orderreturn r ON r.id = e.returnId
        WHERE e.shopId = ? AND r.orderId = ? AND e.entryType = 'clawback'`,
      [p.shopId, p.orderId],
    );
    const gross =
      clawbackTarget(
        earn.points as number,
        p.refundedMinor,
        p.refundableMinor,
      ) - Number(priorRows[0].gross);
    if (gross <= 0) return;
    const balance = await this.lockedBalance(conn, p.shopId, customerId);
    // ZERO FLOOR, KNOWN FARMING HOLE (BLOCKER for turning redemption on): this clamp
    // means points already spent (redeemed for store credit) are NOT recovered when
    // the order is later returned; the unrecovered part is only RECORDED as
    // `shortfall`. Earn, redeem, return again = free store credit. Redemption must
    // stay off until the owner decides how to recover it (reclaim store credit,
    // allow a negative balance, or hold points until the return window closes).
    const taken = Math.min(gross, Math.max(balance, 0));
    try {
      await conn.query(
        `INSERT INTO loyaltyentry (shopId, customerId, entryType, points, shortfall, returnId)
         VALUES (?, ?, 'clawback', ?, ?, ?)`,
        [p.shopId, customerId, -taken, gross - taken, p.returnId],
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  // ---- redeem (points -> store credit) ----

  // Customer-authenticated. Gates (any off = 404, nothing written): loyalty flag,
  // program.enabled, program.redeemEnabled, the shop's phone_otp_register flag, a
  // positive conversion rate. The conversion rate and the limits are the
  // program's, never the client's. One transaction: customer row lock, idempotency
  // check, balance read under the lock, redeem entry, store-credit grant, link.
  async redeem(ctx: CustomerContext, dto: RedeemLoyaltyDto) {
    const key = `redeem:${ctx.customerId}:${dto.idempotencyKey}`;
    const out = await this.db.transaction(async (conn) => {
      const customer = await lockCustomerInShop(
        conn,
        ctx.shopId,
        ctx.customerId,
      );
      // The account holder must have proved control of the phone (the register-
      // claim hole): an account that never did cannot turn points into money.
      if (
        String(customer.email ?? '').endsWith('@deleted.requital') ||
        customer.phoneVerifiedAt == null
      ) {
        throw new NotFoundException('Not found');
      }
      const program = await this.redeemProgram(ctx.shopId, conn);
      if (!program) throw new NotFoundException('Not found');

      const existing = await this.findByKey(conn, ctx.shopId, key);
      if (existing) {
        if (existing.points !== -dto.points) {
          throw new ConflictException(
            'That idempotency key was already used for a different request',
          );
        }
        return {
          replay: true,
          entryId: existing.id,
          creditMinor: 0,
          currency: '',
        };
      }

      if (
        dto.points < program.redeemMinPoints ||
        (program.redeemMaxPoints !== null &&
          dto.points > program.redeemMaxPoints) ||
        dto.points % program.redeemStepPoints !== 0
      ) {
        throw new BadRequestException(
          'That number of points is not allowed for redemption',
        );
      }
      const [shopRows] = await conn.query<RowDataPacket[]>(
        `SELECT currency FROM shop WHERE id = ?`,
        [ctx.shopId],
      );
      const currency = shopRows[0].currency as string;
      const creditMinor = redeemCreditMinor(
        dto.points,
        parseRate(program.redeemPointsPerUnit)!,
        currency,
      );
      if (creditMinor <= 0) {
        throw new BadRequestException('Those points are too few to redeem');
      }
      const have = await this.lockedBalance(conn, ctx.shopId, ctx.customerId);
      if (have < dto.points) {
        throw new ConflictException(
          'Your points balance just changed. Please review and try again.',
        );
      }
      const [res] = await conn.query(
        `INSERT INTO loyaltyentry (shopId, customerId, entryType, points, idempotencyKey)
         VALUES (?, ?, 'redeem', ?, ?)`,
        [ctx.shopId, ctx.customerId, -dto.points, key],
      );
      const entryId = (res as { insertId: number }).insertId;
      const creditEntryId = await this.storeCredit.grantForLoyaltyRedemption(
        conn,
        ctx.shopId,
        ctx.customerId,
        currency,
        creditMinor,
        entryId,
      );
      await conn.query(
        `UPDATE loyaltyentry SET storeCreditEntryId = ? WHERE id = ? AND shopId = ?`,
        [creditEntryId, entryId, ctx.shopId],
      );
      return { replay: false, entryId, creditMinor, currency };
    });
    return {
      replay: out.replay,
      balance: await this.balanceOf(ctx.shopId, ctx.customerId),
      ...(out.replay
        ? {}
        : {
            pointsRedeemed: dto.points,
            credit: minorToDecimal(out.creditMinor, out.currency),
            currency: out.currency,
          }),
    };
  }
}
