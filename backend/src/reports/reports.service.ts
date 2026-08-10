import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { QueryParam } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import { ReportsFilterQueryDto } from './dto/reports-filter-query.dto';
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

    const { sql: orderWhereSql, params: orderWhereParams } = this.buildOrderWhere(
      ctx,
      query,
      'o',
    );
    let sql = orderWhereSql;
    const params = [...orderWhereParams];
    if (search) {
      const orParts = ['ed.carrier LIKE ?', 'o.customerName LIKE ?', 'o.customerPhone LIKE ?'];
      const orParams: QueryParam[] = [`%${search}%`, `%${search}%`, `%${search}%`];
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

    const conditions = ["o.shopId = ?", "o.status != 'cancelled'"];
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
