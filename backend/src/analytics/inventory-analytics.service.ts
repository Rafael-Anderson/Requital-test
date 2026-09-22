import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { QueryParam } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { dateKeyInTimezone } from '../outlets/outlet-status';
import {
  computeMovementMetrics,
  sortByUrgency,
  type ProductMovementInput,
} from './inventory-analytics';

// Sensible defaults, both overridable per request. 30 days is long enough to
// smooth a florist's weekly rhythm without reaching back past a seasonal shift.
export const DEFAULT_WINDOW_DAYS = 30;
export const DEFAULT_DEAD_STOCK_DAYS = 30;

@Injectable()
export class InventoryAnalyticsService {
  constructor(private readonly db: DatabaseService) {}

  // ANL-8. Reads dailyproductmetrics (ANL-1) for movement and the LIVE stock
  // tables for what is on hand right now - the two are deliberately different
  // ages. "How much has moved" is a settled historical question the rollups
  // answer cheaply; "how much is left" is only true as of this instant and has
  // no meaningful rolled-up form.
  //
  // Stock resolves through the SHADOW ingredient, not a column on product:
  // outletstock/outletvariantstock do not exist, they were dropped by
  // 20260808120000_ingredient_backed_stock, and every product reaches stock via
  // ingredient.shadowProductId / shadowVariantId (see CLAUDE.md's
  // catalog-vs-stock split).
  async getMovement(
    ctx: TenantContext,
    options: {
      days?: number;
      deadStockDays?: number;
      outletId?: number;
    } = {},
  ) {
    const days = options.days ?? DEFAULT_WINDOW_DAYS;
    const deadStockDays = options.deadStockDays ?? DEFAULT_DEAD_STOCK_DAYS;
    const outletId = resolveOutletFilter(ctx, options.outletId);

    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT timezone FROM shop WHERE id = ?`,
      [ctx.shopId],
    );
    const timezone = (shopRows[0]?.timezone as string | null) ?? 'Asia/Dubai';
    const today = dateKeyInTimezone(new Date(), timezone);

    const outletMetricSql = outletId !== undefined ? 'AND m.outletId = ?' : '';
    const outletMetricParam: QueryParam[] =
      outletId !== undefined ? [outletId] : [];
    const outletStockSql = outletId !== undefined ? 'AND ois.outletId = ?' : '';
    const outletStockParam: QueryParam[] =
      outletId !== undefined ? [outletId] : [];

    const [movement, stock] = await Promise.all([
      // Units and last-movement date per product, from the rollups.
      this.db.query<RowDataPacket[]>(
        `SELECT p.id AS productId, p.name,
                COALESCE(SUM(m.units), 0) AS unitsSold,
                MAX(CASE WHEN m.units > 0 THEN m.\`date\` END) AS lastSaleDate
           FROM product p
           LEFT JOIN dailyproductmetrics m
             ON m.productId = p.id
            AND m.shopId = p.shopId
            AND m.\`date\` > DATE_SUB(?, INTERVAL ? DAY)
            ${outletMetricSql}
          WHERE p.shopId = ?
          GROUP BY p.id, p.name
          ORDER BY p.id`,
        [today, days, ...outletMetricParam, ctx.shopId],
      ),
      // Current on-hand, summed across outlets unless one is requested. A
      // product with no shadow ingredient row (a recipe-backed product) simply
      // has no row here, which is how it ends up with a NULL stock figure
      // rather than a fabricated zero.
      this.db.query<RowDataPacket[]>(
        `SELECT ing.shadowProductId AS productId,
                SUM(ois.stockQuantity) AS stockQuantity
           FROM ingredient ing
           JOIN outletingredientstock ois
             ON ois.ingredientId = ing.id ${outletStockSql}
          WHERE ing.shopId = ? AND ing.shadowProductId IS NOT NULL
          GROUP BY ing.shadowProductId`,
        [...outletStockParam, ctx.shopId],
      ),
    ]);

    const stockBy = new Map(
      stock.map((r) => [r.productId as number, Number(r.stockQuantity)]),
    );

    const inputs: ProductMovementInput[] = movement.map((r) => {
      const lastSale = r.lastSaleDate as Date | string | null;
      let daysSinceLastSale: number | null = null;
      if (lastSale) {
        const key =
          lastSale instanceof Date
            ? dateKeyInTimezone(lastSale, timezone)
            : String(lastSale).slice(0, 10);
        daysSinceLastSale = Math.max(
          0,
          Math.round(
            (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${key}T00:00:00Z`)) /
              86_400_000,
          ),
        );
      }
      const productId = r.productId as number;
      return {
        productId,
        name: r.name as string,
        unitsSold: Number(r.unitsSold),
        stockOnHand: stockBy.has(productId)
          ? (stockBy.get(productId) as number)
          : null,
        daysSinceLastSale,
      };
    });

    const rows = sortByUrgency(
      computeMovementMetrics(inputs, days, deadStockDays),
    );

    return {
      windowDays: days,
      deadStockAfterDays: deadStockDays,
      // Surfaced so the UI can say the report is only as complete as the
      // rollups behind it, rather than implying it covers today.
      rolledUpThrough: await this.lastRolledUpDate(ctx.shopId),
      rows,
      deadStock: rows.filter((r) => r.isDeadStock),
    };
  }

  // The most recent day the nightly job has actually computed. Null when a shop
  // has never been rolled up, which is a real state on a shop whose first order
  // landed today.
  private async lastRolledUpDate(shopId: number): Promise<string | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(MAX(\`date\`), '%Y-%m-%d') AS lastDate
         FROM dailyshopmetrics WHERE shopId = ?`,
      [shopId],
    );
    return (rows[0]?.lastDate as string | null) ?? null;
  }
}
