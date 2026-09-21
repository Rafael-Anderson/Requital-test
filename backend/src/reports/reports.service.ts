import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { QueryParam } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { ReportsFilterQueryDto } from './dto/reports-filter-query.dto';
import { bucketPrepTimes, type PrepTimeSample } from './prep-time';
import { ListGeneralReportQueryDto } from './dto/list-general-report-query.dto';
import { ListProductSalesQueryDto } from './dto/list-product-sales-query.dto';
import { MonthlyReportFilterDto } from './dto/monthly-report-filter.dto';
import { ListMonthlyReportQueryDto } from './dto/list-monthly-report-query.dto';

// "YYYY-MM" -> the [firstOfMonth, firstOfNextMonth) date-string pair
// General Report's own date filter already understands. dateTo deliberately
// resolves to the *first day of the next month*, not the last day of this
// one: buildOrderWhere's `lte: new Date(dateTo)` parses a bare date string
// as that day's midnight, so a dateTo of "the last day of July" would only
// include instants up to July 31st 00:00 — i.e. almost none of July 31st.
// Using the first day of August instead correctly captures the entire
// month (every instant in July is < August 1st 00:00).
function resolveMonthRange(month: string): {
  dateFrom: string;
  dateTo: string;
} {
  const [year, m] = month.split('-').map(Number);
  const dateFrom = `${month}-01`;
  const nextMonth =
    m === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(m + 1).padStart(2, '0')}-01`;
  return { dateFrom, dateTo: nextMonth };
}

const PRODUCT_SALES_SORT_COLUMN: Record<string, string> = {
  name: 'p.name',
  currentPrice: 'p.price',
  orderCount: 'orderCount',
  totalQuantity: 'totalQuantity',
  totalSalePrice: 'totalSalePrice',
};

export type MarginDimension =
  | 'product'
  | 'collection'
  | 'channel'
  | 'outlet'
  | 'order';

// keyExpr/labelExpr are fixed strings chosen by the dimension enum, never
// interpolated from user input - the DTO validates against this key set, so
// there is no path from a query string into the SQL.
const MARGIN_DIMENSIONS: Record<
  MarginDimension,
  { keyExpr: string; labelExpr: string; joins: string }
> = {
  product: {
    keyExpr: 'oi.productId',
    // productName is the snapshot taken at order time; preferring it over the
    // live product row keeps a renamed or deleted product readable in a
    // historical report.
    labelExpr: 'oi.productName',
    joins: '',
  },
  collection: {
    keyExpr: 'c.id',
    labelExpr: 'c.name',
    joins:
      'LEFT JOIN productcollection pc ON pc.productId = oi.productId ' +
      'LEFT JOIN collection c ON c.id = pc.collectionId',
  },
  channel: { keyExpr: 'o.channel', labelExpr: 'o.channel', joins: '' },
  outlet: {
    keyExpr: 'o.outletId',
    labelExpr: 'ou.name',
    joins: 'JOIN outlet ou ON ou.id = o.outletId',
  },
  order: { keyExpr: 'o.id', labelExpr: 'CAST(o.id AS CHAR)', joins: '' },
};

function marginShape(revenue: number, cost: number) {
  const margin = revenue - cost;
  return {
    revenue: round2(revenue),
    cost: round2(cost),
    margin: round2(margin),
    // Null rather than 0 when there is no costed revenue: 0% and "nothing to
    // measure" are different answers.
    marginPercent: revenue > 0 ? round2((margin / revenue) * 100) : null,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  // General Report only — no cancelled-exclusion baked in here. Unlike
  // Product Sale Report (which the task explicitly defines as excluding
  // cancelled orders, same as Dashboard/Customers lifetime value), General
  // Report is meant to be a raw, auditable view of exactly what matches the
  // filters — a merchant filters status=cancelled themselves to see
  // cancellation totals, or leaves status unset to see everything. Baking
  // in an implicit exclusion here would make the stat cards disagree with
  // "Order status: All" in a way that isn't visible anywhere in the UI.
  private buildOrderWhere(
    ctx: TenantContext,
    filters: ReportsFilterQueryDto,
    alias = 'o',
  ): { sql: string; params: QueryParam[] } {
    const conditions = [`${alias}.shopId = ?`];
    const params: QueryParam[] = [ctx.shopId];
    if (filters.outletId !== undefined) {
      conditions.push(`${alias}.outletId = ?`);
      params.push(filters.outletId);
    }
    if (filters.orderType) {
      conditions.push(`${alias}.orderType = ?`);
      params.push(filters.orderType);
    }
    if (filters.status) {
      conditions.push(`${alias}.status = ?`);
      params.push(filters.status);
    }
    if (filters.paymentMode) {
      conditions.push(`${alias}.paymentMethod = ?`);
      params.push(filters.paymentMode);
    }
    if (filters.channel) {
      conditions.push(`${alias}.channel = ?`);
      params.push(filters.channel);
    }
    if (filters.dateFrom) {
      conditions.push(`${alias}.createdAt >= ?`);
      params.push(new Date(filters.dateFrom));
    }
    if (filters.dateTo) {
      conditions.push(`${alias}.createdAt <= ?`);
      params.push(new Date(filters.dateTo));
    }
    return { sql: conditions.join(' AND '), params };
  }

  // NOV-12 prep-time truth. shop.deliveryPreparationTimeMinutes and its
  // siblings are merchant-guessed constants - and, checked while building
  // this, constants that nothing in the codebase actually reads: not slot
  // generation, not the storefront. They are a promise nobody measures. This
  // reports what the orders actually did, next to what the merchant
  // configured, and deliberately changes nothing.
  //
  // The only record of status transitions is `auditlog`: there are no
  // per-status timestamp columns and no status-history table. OrdersService.
  // getHistory already reads the same rows for a single order, so this is the
  // same source, aggregated. Two consequences worth knowing, both surfaced in
  // the response rather than hidden:
  //   - Only transitions that went through the staff endpoint are logged, so
  //     an order advanced by a webhook (a Slider `delivered` callback, a BNPL
  //     approval) contributes nothing.
  //   - An order still in progress, or one that skipped straight to
  //     delivered, has no pair and is excluded.
  // `ordersConsidered` vs `ordersMeasured` is what makes that visible: a big
  // gap means the sample is not the business.
  async getPrepTimeTruth(ctx: TenantContext, filters: ReportsFilterQueryDto) {
    const { sql, params } = this.buildOrderWhere(ctx, filters, 'o');

    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT timezone, deliveryPreparationTimeMinutes, pickupPreparationTimeMinutes
         FROM shop WHERE id = ?`,
      [ctx.shopId],
    );
    const shop = shopRows[0];
    const timezone = (shop?.timezone as string) ?? 'Asia/Dubai';

    // MIN() per status rather than a join per status: a join would multiply
    // rows if an order ever carried two log entries for the same status, and
    // the first transition is the real one either way.
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT o.id,
              o.outletId,
              ou.name AS outletName,
              MIN(CASE WHEN al.after->>'$.status' = 'confirmed' THEN al.createdAt END) AS confirmedAt,
              MIN(CASE WHEN al.after->>'$.status' = 'preparing' THEN al.createdAt END) AS preparingAt,
              MIN(CASE WHEN al.after->>'$.status' = 'out_for_delivery' THEN al.createdAt END) AS readyAt
         FROM \`order\` o
         JOIN outlet ou ON ou.id = o.outletId
         JOIN auditlog al
           ON al.shopId = o.shopId
          AND al.entityType = 'order'
          AND al.entityId = o.id
          AND al.action = 'order.status_changed'
        WHERE ${sql}
        GROUP BY o.id, o.outletId, ou.name
       HAVING confirmedAt IS NOT NULL AND readyAt IS NOT NULL AND readyAt > confirmedAt`,
      params,
    );

    const countRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM \`order\` o WHERE ${sql}`,
      params,
    );

    const samples: PrepTimeSample[] = rows.map((r) => {
      const confirmedAt = r.confirmedAt as Date;
      const readyAt = r.readyAt as Date;
      const preparingAt = r.preparingAt as Date | null;
      return {
        outletId: r.outletId as number,
        outletName: r.outletName as string,
        confirmedAt,
        totalMinutes: (readyAt.getTime() - confirmedAt.getTime()) / 60000,
        handsOnMinutes:
          preparingAt && readyAt > preparingAt
            ? (readyAt.getTime() - preparingAt.getTime()) / 60000
            : null,
      };
    });

    return {
      // What the merchant configured, for the side-by-side. Both are exposed
      // because the measured span mixes delivery and pickup orders unless the
      // caller filters by orderType.
      configured: {
        deliveryPreparationTimeMinutes: Number(
          shop?.deliveryPreparationTimeMinutes ?? 0,
        ),
        pickupPreparationTimeMinutes: Number(
          shop?.pickupPreparationTimeMinutes ?? 0,
        ),
      },
      timezone,
      ordersConsidered: Number(countRows[0].c),
      ordersMeasured: samples.length,
      buckets: bucketPrepTimes(samples, timezone),
    };
  }

  // Gross margin, computed over orderitem.unitCost - the cost captured AT
  // ORDER TIME (migration 20260921120000), never product.costPrice read now.
  // Reading today's cost against a historical sale silently rewrites every
  // past report the moment a merchant edits a cost; that is the whole reason
  // the column exists.
  //
  // Queries, not a rollup table: rollups are a separate piece of work, and
  // this has to be correct before it can be pre-aggregated.
  //
  // Lines with a NULL unitCost are excluded from the margin arithmetic and
  // counted separately, because there are two genuinely different reasons a
  // line has no cost and a merchant needs to tell them apart:
  //   - the order predates the migration, and never will have one; or
  //   - the product (or one of its ingredients) has no cost set, which the
  //     merchant can fix.
  // Folding either into the totals as 0 would report 100% margin on it.
  async getMarginSummary(ctx: TenantContext, filters: ReportsFilterQueryDto) {
    const { sql, params } = this.buildOrderWhere(ctx, filters, 'o');

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN oi.unitCost IS NOT NULL
                           THEN oi.quantity * oi.priceAtPurchase END), 0) AS revenue,
         COALESCE(SUM(CASE WHEN oi.unitCost IS NOT NULL
                           THEN oi.quantity * oi.unitCost END), 0) AS cost,
         COALESCE(SUM(CASE WHEN oi.unitCost IS NULL THEN 1 ELSE 0 END), 0) AS linesWithoutCost,
         COUNT(*) AS lineCount
       FROM orderitem oi
       JOIN \`order\` o ON o.id = oi.orderId
       WHERE ${sql}`,
      params,
    );

    const revenue = Number(rows[0].revenue);
    const cost = Number(rows[0].cost);
    return {
      ...marginShape(revenue, cost),
      linesCosted:
        Number(rows[0].lineCount) - Number(rows[0].linesWithoutCost),
      linesWithoutCost: Number(rows[0].linesWithoutCost),
    };
  }

  // The same arithmetic grouped four ways. One method rather than four
  // near-identical ones: the only thing that varies is the GROUP BY key and
  // its label, and four copies of a money aggregate is four places for the
  // CASE WHEN unitCost IS NOT NULL guard to be forgotten.
  async getMarginBreakdown(
    ctx: TenantContext,
    filters: ReportsFilterQueryDto,
    dimension: MarginDimension,
  ) {
    const { sql, params } = this.buildOrderWhere(ctx, filters, 'o');
    const dim = MARGIN_DIMENSIONS[dimension];

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT ${dim.keyExpr} AS groupKey,
              ${dim.labelExpr} AS label,
              COALESCE(SUM(CASE WHEN oi.unitCost IS NOT NULL
                                THEN oi.quantity * oi.priceAtPurchase END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN oi.unitCost IS NOT NULL
                                THEN oi.quantity * oi.unitCost END), 0) AS cost,
              COALESCE(SUM(CASE WHEN oi.unitCost IS NULL THEN 1 ELSE 0 END), 0) AS linesWithoutCost
         FROM orderitem oi
         JOIN \`order\` o ON o.id = oi.orderId
         ${dim.joins}
        WHERE ${sql}
        GROUP BY ${dim.keyExpr}, ${dim.labelExpr}
        HAVING revenue > 0 OR linesWithoutCost > 0
        ORDER BY (revenue - cost) DESC
        LIMIT 200`,
      params,
    );

    return rows.map((r) => ({
      key: r.groupKey as string | number | null,
      label: (r.label as string | null) ?? 'Unattributed',
      ...marginShape(Number(r.revenue), Number(r.cost)),
      linesWithoutCost: Number(r.linesWithoutCost),
    }));
  }

  async getGeneralSummary(ctx: TenantContext, filters: ReportsFilterQueryDto) {
    const { sql, params } = this.buildOrderWhere(ctx, filters, 'o');
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(deliveryFee), 0) AS deliveryFee
       FROM \`order\` o WHERE ${sql}`,
      params,
    );
    const grandTotal = Number(rows[0].total);
    const totalDeliveryFee = Number(rows[0].deliveryFee);
    return {
      totalOrders: Number(rows[0].c),
      grandTotal,
      totalPayments: grandTotal - totalDeliveryFee,
      totalDeliveryFee,
    };
  }

  async listGeneralOrders(
    ctx: TenantContext,
    query: ListGeneralReportQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const searchAsId =
      search && /^\d+$/.test(search) ? Number(search) : undefined;
    const { sql: whereSql, params: whereParams } = this.buildOrderWhere(
      ctx,
      query,
      'o',
    );
    let sql = whereSql;
    const params = [...whereParams];
    if (search) {
      const orParts = ['o.customerName LIKE ?', 'o.customerPhone LIKE ?'];
      const orParams: QueryParam[] = [`%${search}%`, `%${search}%`];
      if (searchAsId !== undefined) {
        orParts.push('o.id = ?');
        orParams.push(searchAsId);
      }
      sql += ` AND (${orParts.join(' OR ')})`;
      params.push(...orParams);
    }

    const [orders, totalRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT o.id, o.status, o.customerName, o.customerPhone, o.orderType, o.paymentMethod,
                o.total, o.channel, o.createdAt, ot.name AS outletName, c.id AS customerId
         FROM \`order\` o
         JOIN outlet ot ON ot.id = o.outletId
         LEFT JOIN customer c ON c.id = o.customerId
         WHERE ${sql}
         ORDER BY o.createdAt DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM \`order\` o WHERE ${sql}`,
        params,
      ),
    ]);

    return {
      data: orders.map((o) => ({
        id: o.id as number,
        outletName: o.outletName as string,
        status: o.status as string,
        customerId: (o.customerId as number | null) ?? null,
        customerName: o.customerName as string,
        customerPhone: o.customerPhone as string,
        orderType: o.orderType as string | null,
        paymentMethod: o.paymentMethod as string | null,
        total: o.total as string,
        channel: o.channel as string | null,
        createdAt: o.createdAt as Date,
      })),
      page,
      pageSize,
      total: Number(totalRows[0].c),
    };
  }

  // Monthly Report is General Report with `month` translated into the same
  // dateFrom/dateTo pair — no parallel aggregation path, no new query
  // logic, just a thin call-through into the exact same methods above.
  async getMonthlySummary(ctx: TenantContext, filters: MonthlyReportFilterDto) {
    const { month, ...rest } = filters;
    return this.getGeneralSummary(ctx, {
      ...rest,
      ...resolveMonthRange(month),
    });
  }

  async listMonthlyOrders(
    ctx: TenantContext,
    query: ListMonthlyReportQueryDto,
  ) {
    const { month, ...rest } = query;
    return this.listGeneralOrders(ctx, {
      ...rest,
      ...resolveMonthRange(month),
    });
  }

  // Same filter set as General Report's order list (reuses
  // ListGeneralReportQueryDto directly rather than a near-duplicate DTO) —
  // `status` here still means the *order's* status, not the external
  // delivery's own status column, for consistency with every other filter
  // on this shared bar. The delivery's own status is shown in the table but
  // isn't filterable through this bar, to avoid overloading one `status`
  // param with two different meanings.
  async listExternalDeliveries(
    ctx: TenantContext,
    query: ListGeneralReportQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const searchAsId =
      search && /^\d+$/.test(search) ? Number(search) : undefined;

    // buildOrderWhere only filters by outletId when the caller explicitly
    // requests one — it never auto-scopes a branch user to their own
    // outlet the way outlet-scoped modules (orders, dashboard, stock) do.
    // Every other Reports route is admin/viewer-only (never 'branch'), so
    // this was never a gap until this route opened up to branch/
    // order_manager — resolveOutletFilter is the same forcing rule every
    // other outlet-scoped read already goes through, applied here so a
    // branch user can't omit outletId and see every outlet's deliveries.
    const { sql: orderWhereSql, params: orderWhereParams } =
      this.buildOrderWhere(
        ctx,
        { ...query, outletId: resolveOutletFilter(ctx, query.outletId) },
        'o',
      );
    let sql = orderWhereSql;
    const params = [...orderWhereParams];
    if (search) {
      const orParts = [
        'ed.carrier LIKE ?',
        'o.customerName LIKE ?',
        'o.customerPhone LIKE ?',
      ];
      const orParams: QueryParam[] = [
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
      ];
      if (searchAsId !== undefined) {
        orParts.push('ed.orderId = ?');
        orParams.push(searchAsId);
      }
      sql += ` AND (${orParts.join(' OR ')})`;
      params.push(...orParams);
    }

    const [rows, totalRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT ed.*, o.customerName AS orderCustomerName, o.customerPhone AS orderCustomerPhone, ot.name AS outletName
         FROM externaldelivery ed
         JOIN \`order\` o ON o.id = ed.orderId
         JOIN outlet ot ON ot.id = o.outletId
         WHERE ${sql}
         ORDER BY ed.createdAt DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c
         FROM externaldelivery ed
         JOIN \`order\` o ON o.id = ed.orderId
         WHERE ${sql}`,
        params,
      ),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id as number,
        orderId: r.orderId as number,
        outletName: r.outletName as string,
        customerName: r.orderCustomerName as string,
        customerPhone: r.orderCustomerPhone as string,
        carrier: r.carrier as string,
        vehicleType: r.vehicleType as string | null,
        price: r.price as string,
        destination: r.destination as string,
        status: r.status as string,
        createdAt: r.createdAt as Date,
        provider: r.provider as string,
        trackingUrl: r.trackingUrl as string | null,
        driverName: r.driverName as string | null,
        driverPhone: r.driverPhone as string | null,
      })),
      page,
      pageSize,
      total: Number(totalRows[0].c),
    };
  }

  // Cancelled orders excluded — same convention as Dashboard/Customers
  // lifetime value (an order that never completed shouldn't count toward
  // what actually sold), explicitly the opposite default from General
  // Report above.
  async listProductSales(ctx: TenantContext, query: ListProductSalesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const sortColumn =
      PRODUCT_SALES_SORT_COLUMN[query.sortBy ?? 'totalSalePrice'];
    const sortDir = query.sortDir === 'asc' ? 'ASC' : 'DESC';

    const conditions = ['o.shopId = ?', "o.status != 'cancelled'"];
    const params: QueryParam[] = [ctx.shopId];
    if (query.outletId !== undefined) {
      conditions.push('o.outletId = ?');
      params.push(query.outletId);
    }
    if (query.orderType) {
      conditions.push('o.orderType = ?');
      params.push(query.orderType);
    }
    if (query.status) {
      conditions.push('o.status = ?');
      params.push(query.status);
    }
    if (query.paymentMode) {
      conditions.push('o.paymentMethod = ?');
      params.push(query.paymentMode);
    }
    if (query.channel) {
      conditions.push('o.channel = ?');
      params.push(query.channel);
    }
    if (query.dateFrom) {
      conditions.push('o.createdAt >= ?');
      params.push(new Date(query.dateFrom));
    }
    if (query.dateTo) {
      conditions.push('o.createdAt <= ?');
      params.push(new Date(query.dateTo));
    }
    if (search) {
      conditions.push('p.name LIKE ?');
      params.push(`%${search}%`);
    }
    const filterSql = conditions.join(' AND ');

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT p.id AS productId, p.name AS name, p.thumbnail AS thumbnail, p.price AS currentPrice,
              COUNT(DISTINCT oi.orderId) AS orderCount,
              SUM(oi.quantity) AS totalQuantity,
              SUM(oi.quantity * oi.priceAtPurchase) AS totalSalePrice
       FROM orderitem oi
       JOIN \`order\` o ON o.id = oi.orderId
       JOIN product p ON p.id = oi.productId
       WHERE ${filterSql}
       GROUP BY p.id
       ORDER BY ${sortColumn} ${sortDir}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    const totalRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT p.id) AS total
       FROM orderitem oi
       JOIN \`order\` o ON o.id = oi.orderId
       JOIN product p ON p.id = oi.productId
       WHERE ${filterSql}`,
      params,
    );

    return {
      data: rows.map((r) => ({
        productId: r.productId as number,
        name: r.name as string,
        thumbnail: r.thumbnail as string,
        currentPrice: r.currentPrice as string,
        orderCount: Number(r.orderCount),
        totalQuantity: Number(r.totalQuantity),
        totalSalePrice: Number(r.totalSalePrice ?? 0),
        // Delivery fee lives on the order, not the line item — there's no
        // principled way to allocate a portion of it to one product in a
        // multi-item order, so this is always 0 rather than an invented
        // split. Matches the reference tool's apparent behavior.
        deliveryFee: 0,
      })),
      page,
      pageSize,
      total: Number(totalRows[0].total),
    };
  }
}
