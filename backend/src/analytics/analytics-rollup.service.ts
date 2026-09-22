import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { JobsWorkerService } from '../jobs/jobs.worker.service';
import { SchedulerService } from '../jobs/scheduler.service';
import type {
  ComputeDailyRollupJobPayload,
  RecomputeCustomerMetricsJobPayload,
} from '../jobs/jobs.types';
import { dateKeyInTimezone } from '../outlets/outlet-status';
import { createLogger } from '../common/logging/logger';
import {
  computeProductDayMetrics,
  computeShopDayMetrics,
  type RollupItemRow,
  type RollupOrderRow,
} from './rollup';

const logger = createLogger('AnalyticsRollup');

// How far back a single nightly tick will catch up. The catch-up path exists
// for "the box was down for a few days", not for backfilling a shop's whole
// history on first deploy - an unbounded loop there would enqueue a job per
// day per shop for however long the shop has existed, on one tick. Days older
// than this stay uncomputed until someone asks for a real backfill.
export const ROLLUP_CATCHUP_MAX_DAYS = 30;

// A cancelled order is not revenue. This matches Dashboard and the Product
// Sales Report; the General Report deliberately differs because it is a raw
// audit view (see CLAUDE.md). Kept as one constant so every query in this
// file - day rollups AND customer ltv - cannot drift apart.
const EXCLUDE_CANCELLED = `o.status <> 'cancelled'`;

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

@Injectable()
export class AnalyticsRollupService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobsService: JobsService,
    private readonly jobsWorkerService: JobsWorkerService,
    private readonly schedulerService: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.jobsWorkerService.registerHandler('compute_daily_rollup', (payload) => {
      const { shopId, date } = payload as ComputeDailyRollupJobPayload;
      return this.computeForShopDay(shopId, date);
    });
    this.jobsWorkerService.registerHandler(
      'recompute_customer_metrics',
      (payload) => {
        const { shopId } = payload as RecomputeCustomerMetricsJobPayload;
        return this.recomputeCustomerMetrics(shopId);
      },
    );
  }

  // 01:00 UTC = 05:00 Asia/Dubai, comfortably after any shop's trading day has
  // closed, so "yesterday" is genuinely finished before it is rolled up.
  // Wrapped in the cross-instance advisory lock for the same reason the
  // low-stock digest is (see SchedulerService): the per-day idempotency key
  // already makes double-ENQUEUEING impossible, but without the lock every PM2
  // instance would still redundantly scan every shop on every tick.
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async nightlyRollup(): Promise<void> {
    await this.schedulerService.runLocked('analytics-rollup-sweep', 900, () =>
      this.sweep(),
    );
  }

  // Split from the cron so a test (or a future "recompute now" admin action)
  // can drive it directly.
  async sweep(): Promise<void> {
    // Only shops that have ever taken a countable order. Selecting every shop
    // instead would cost two queries per shop per night to discover that most
    // of them have nothing to roll up - against this project's own dev
    // database (~26k shops from repeated e2e runs, see the platform-admin
    // pagination note in CLAUDE.md) that is ~52k queries a tick to produce
    // nothing. The EXISTS prunes them in one.
    const shops = await this.db.query<RowDataPacket[]>(
      `SELECT s.id, s.timezone FROM shop s
        WHERE EXISTS (
          SELECT 1 FROM \`order\` o
           WHERE o.shopId = s.id AND o.status <> 'cancelled'
        )`,
    );
    for (const shop of shops) {
      const shopId = shop.id as number;
      const timezone = (shop.timezone as string | null) ?? 'Asia/Dubai';
      try {
        await this.enqueueDueDays(shopId, timezone);
        await this.jobsService.enqueue(
          shopId,
          'recompute_customer_metrics',
          { shopId },
          `customer-metrics:${shopId}:${dateKeyInTimezone(new Date(), timezone)}`,
        );
      } catch (err) {
        // One shop's bad data must not stop every later shop's rollup.
        logger.error('failed to enqueue rollup for shop', {
          shopId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // The incremental catch-up path. Rather than blindly computing "yesterday",
  // this looks at what has actually been computed and fills every gap up to
  // yesterday - so a few days of downtime self-heal on the next tick instead
  // of leaving permanent holes that only a manual backfill would find.
  //
  // `computedAt` is why a genuinely-empty day is not re-enqueued forever: an
  // empty day still writes a dailyshopmetrics row with orders = 0, so MAX(date)
  // advances past it. (A day with no orders at ANY outlet writes the sentinel
  // row described in computeForShopDay.)
  async enqueueDueDays(shopId: number, timezone: string): Promise<string[]> {
    const yesterday = addDays(dateKeyInTimezone(new Date(), timezone), -1);

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(MAX(\`date\`), '%Y-%m-%d') AS lastDate
         FROM dailyshopmetrics WHERE shopId = ?`,
      [shopId],
    );
    const lastComputed = rows[0]?.lastDate as string | null;

    // Never computed: start from the shop's own first order rather than its
    // creation date, so a brand-new shop with no orders enqueues nothing.
    let from: string;
    if (lastComputed) {
      from = addDays(lastComputed, 1);
    } else {
      const first = await this.db.query<RowDataPacket[]>(
        `SELECT MIN(o.createdAt) AS firstOrderAt FROM \`order\` o
          WHERE o.shopId = ? AND ${EXCLUDE_CANCELLED}`,
        [shopId],
      );
      const firstOrderAt = first[0]?.firstOrderAt as Date | null;
      if (!firstOrderAt) return [];
      from = dateKeyInTimezone(firstOrderAt, timezone);
    }

    const days: string[] = [];
    for (let d = from; d <= yesterday; d = addDays(d, 1)) {
      days.push(d);
      if (days.length >= ROLLUP_CATCHUP_MAX_DAYS) break;
    }

    for (const date of days) {
      await this.jobsService.enqueue(
        shopId,
        'compute_daily_rollup',
        { shopId, date },
        `daily-rollup:${shopId}:${date}`,
      );
    }
    return days;
  }

  // Idempotent by construction: every row this day owns is deleted and
  // rewritten inside one transaction, so running it twice produces the same
  // table as running it once. Upserting instead would leave a stale row behind
  // whenever a recompute finds LESS data than before (an order cancelled after
  // the fact, a product deleted), which is the case a retry is most likely to
  // hit.
  async computeForShopDay(shopId: number, date: string): Promise<void> {
    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT timezone FROM shop WHERE id = ?`,
      [shopId],
    );
    if (shopRows.length === 0) return; // shop deleted between enqueue and run
    const timezone = (shopRows[0].timezone as string | null) ?? 'Asia/Dubai';

    const { orders, items } = await this.loadDay(shopId, date, timezone);
    const newCustomers = await this.resolveNewCustomers(
      shopId,
      date,
      timezone,
      orders,
    );

    const shopMetrics = computeShopDayMetrics(orders, items, newCustomers);
    const productMetrics = computeProductDayMetrics(orders, items);
    const computedAt = new Date();

    await this.db.transaction(async (tx) => {
      await tx.query(
        `DELETE FROM dailyshopmetrics WHERE shopId = ? AND \`date\` = ?`,
        [shopId, date],
      );
      await tx.query(
        `DELETE FROM dailyproductmetrics WHERE shopId = ? AND \`date\` = ?`,
        [shopId, date],
      );

      if (shopMetrics.length === 0) {
        // A day that genuinely had no orders still gets ONE row, against the
        // shop's lowest outlet id. Without it, MAX(date) never advances past a
        // quiet day and enqueueDueDays would re-enqueue it on every tick
        // forever. A missing row means "not computed"; orders = 0 means
        // "computed, nothing happened" - the distinction the `computedAt`
        // column exists to preserve.
        const sentinelOutlet = await this.lowestOutletId(tx, shopId);
        if (sentinelOutlet !== null) {
          await tx.query(
            `INSERT INTO dailyshopmetrics
               (shopId, outletId, \`date\`, orders, revenue, cogs, discount,
                delivery, tax, newCustomers, returningCustomers,
                linesWithoutCost, computedAt)
             VALUES (?, ?, ?, 0, 0, NULL, 0, 0, 0, 0, 0, 0, ?)`,
            [shopId, sentinelOutlet, date, computedAt],
          );
        }
        return;
      }

      for (const m of shopMetrics) {
        await tx.query(
          `INSERT INTO dailyshopmetrics
             (shopId, outletId, \`date\`, orders, revenue, cogs, discount,
              delivery, tax, newCustomers, returningCustomers,
              linesWithoutCost, computedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shopId,
            m.outletId,
            date,
            m.orders,
            m.revenue,
            m.cogs,
            m.discount,
            m.delivery,
            m.tax,
            m.newCustomers,
            m.returningCustomers,
            m.linesWithoutCost,
            computedAt,
          ],
        );
      }

      for (const m of productMetrics) {
        await tx.query(
          `INSERT INTO dailyproductmetrics
             (shopId, productId, outletId, \`date\`, units, revenue, cogs,
              linesWithoutCost, computedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shopId,
            m.productId,
            m.outletId,
            date,
            m.units,
            m.revenue,
            m.cogs,
            m.linesWithoutCost,
            computedAt,
          ],
        );
      }
    });

    logger.debug('rolled up day', {
      shopId,
      date,
      outletRows: shopMetrics.length,
      productRows: productMetrics.length,
    });
  }

  private async lowestOutletId(
    tx: PoolConnection,
    shopId: number,
  ): Promise<number | null> {
    const [rows] = await tx.query<RowDataPacket[]>(
      `SELECT MIN(id) AS id FROM outlet WHERE shopId = ?`,
      [shopId],
    );
    return (rows[0]?.id as number | null) ?? null;
  }

  // Over-fetches a 3-day UTC window and then buckets by the shop's own local
  // date key, rather than computing a UTC offset for the window bounds. The
  // helper doing the bucketing (dateKeyInTimezone) is the same one the
  // time-slot and product-is-new logic already relies on, so there is one
  // timezone rule in the codebase instead of two, and no DST arithmetic to get
  // wrong. The window is bounded, so the over-fetch is a few rows.
  private async loadDay(
    shopId: number,
    date: string,
    timezone: string,
  ): Promise<{ orders: RollupOrderRow[]; items: RollupItemRow[] }> {
    const windowStart = `${addDays(date, -1)} 00:00:00`;
    const windowEnd = `${addDays(date, 2)} 00:00:00`;

    const orderRows = await this.db.query<RowDataPacket[]>(
      `SELECT o.id, o.outletId, o.customerId, o.deliveryFee, o.taxAmount,
              o.discountAmount, o.createdAt
         FROM \`order\` o
        WHERE o.shopId = ? AND ${EXCLUDE_CANCELLED}
          AND o.createdAt >= ? AND o.createdAt < ?`,
      [shopId, windowStart, windowEnd],
    );

    const orders: RollupOrderRow[] = orderRows
      .filter((r) => dateKeyInTimezone(r.createdAt as Date, timezone) === date)
      .map((r) => ({
        id: r.id as number,
        outletId: r.outletId as number,
        customerId: (r.customerId as number | null) ?? null,
        deliveryFee: (r.deliveryFee as string | null) ?? null,
        taxAmount: (r.taxAmount as string | null) ?? null,
        discountAmount: (r.discountAmount as string | null) ?? null,
      }));

    if (orders.length === 0) return { orders, items: [] };

    const ids = orders.map((o) => o.id);
    const itemRows = await this.db.query<RowDataPacket[]>(
      `SELECT oi.orderId, oi.productId, oi.quantity, oi.priceAtPurchase,
              oi.unitCost
         FROM orderitem oi
        WHERE oi.orderId IN (${ids.map(() => '?').join(', ')})`,
      ids,
    );

    return {
      orders,
      items: itemRows.map((r) => ({
        orderId: r.orderId as number,
        productId: r.productId as number,
        quantity: Number(r.quantity),
        priceAtPurchase: (r.priceAtPurchase as string | null) ?? null,
        unitCost: (r.unitCost as string | null) ?? null,
      })),
    };
  }

  // "New" means this is the customer's first EVER order at this shop, not
  // their first this day - so it is a whole-history question that the pure
  // computation cannot answer on its own. Uses the same cancelled-order
  // exclusion as the revenue figures, or a customer whose only earlier order
  // was cancelled would be miscounted as returning.
  private async resolveNewCustomers(
    shopId: number,
    date: string,
    timezone: string,
    orders: RollupOrderRow[],
  ): Promise<Set<number>> {
    const customerIds = [
      ...new Set(
        orders
          .map((o) => o.customerId)
          .filter((id): id is number => id !== null),
      ),
    ];
    if (customerIds.length === 0) return new Set();

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT o.customerId, MIN(o.createdAt) AS firstOrderAt
         FROM \`order\` o
        WHERE o.shopId = ? AND ${EXCLUDE_CANCELLED}
          AND o.customerId IN (${customerIds.map(() => '?').join(', ')})
        GROUP BY o.customerId`,
      [shopId, ...customerIds],
    );

    const isNew = new Set<number>();
    for (const r of rows) {
      const first = r.firstOrderAt as Date | null;
      if (first && dateKeyInTimezone(first, timezone) === date) {
        isNew.add(r.customerId as number);
      }
    }
    return isNew;
  }

  // Whole-shop snapshot, recomputed rather than incremented - which is what
  // makes it idempotent. ltv and orderCount deliberately use the same
  // cancelled-order exclusion as CustomersService's live computation so the
  // rollup and the customer detail page cannot show different numbers.
  async recomputeCustomerMetrics(shopId: number): Promise<void> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT o.customerId,
              MIN(o.createdAt) AS firstOrder,
              MAX(o.createdAt) AS lastOrder,
              COUNT(*) AS orderCount,
              COALESCE(SUM(o.total), 0) AS ltv
         FROM \`order\` o
        WHERE o.shopId = ? AND o.customerId IS NOT NULL AND ${EXCLUDE_CANCELLED}
        GROUP BY o.customerId`,
      [shopId],
    );

    const computedAt = new Date();
    await this.db.transaction(async (tx) => {
      await tx.query(`DELETE FROM customermetrics WHERE shopId = ?`, [shopId]);
      for (const r of rows) {
        await tx.query(
          `INSERT INTO customermetrics
             (shopId, customerId, firstOrder, lastOrder, orderCount, ltv,
              computedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            shopId,
            r.customerId,
            r.firstOrder,
            r.lastOrder,
            Number(r.orderCount),
            String(r.ltv),
            computedAt,
          ],
        );
      }
    });
  }
}
