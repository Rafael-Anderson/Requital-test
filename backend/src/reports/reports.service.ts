import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
function resolveMonthRange(month: string): { dateFrom: string; dateTo: string } {
  const [year, m] = month.split('-').map(Number);
  const dateFrom = `${month}-01`;
  const nextMonth = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
  return { dateFrom, dateTo: nextMonth };
}

const PRODUCT_SALES_SORT_COLUMN: Record<string, string> = {
  name: 'p.name',
  currentPrice: 'p.price',
  orderCount: 'orderCount',
  totalQuantity: 'totalQuantity',
  totalSalePrice: 'totalSalePrice',
};

interface ProductSalesRow {
  productId: number;
  name: string;
  thumbnail: string;
  currentPrice: string;
  orderCount: bigint;
  totalQuantity: bigint;
  totalSalePrice: string | null;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // General Report only — no cancelled-exclusion baked in here. Unlike
  // Product Sale Report (which the task explicitly defines as excluding
  // cancelled orders, same as Dashboard/Customers lifetime value), General
  // Report is meant to be a raw, auditable view of exactly what matches the
  // filters — a merchant filters status=cancelled themselves to see
  // cancellation totals, or leaves status unset to see everything. Baking
  // in an implicit exclusion here would make the stat cards disagree with
  // "Order status: All" in a way that isn't visible anywhere in the UI.
  private buildOrderWhere(ctx: TenantContext, filters: ReportsFilterQueryDto): Prisma.orderWhereInput {
    return {
      shopId: ctx.shopId,
      ...(filters.outletId !== undefined && { outletId: filters.outletId }),
      ...(filters.orderType && { orderType: filters.orderType }),
      ...(filters.status && { status: filters.status }),
      ...(filters.paymentMode && { paymentMethod: filters.paymentMode }),
      ...(filters.channel && { channel: filters.channel }),
      ...((filters.dateFrom || filters.dateTo) && {
        createdAt: {
          ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
          ...(filters.dateTo && { lte: new Date(filters.dateTo) }),
        },
      }),
    };
  }

  async getGeneralSummary(ctx: TenantContext, filters: ReportsFilterQueryDto) {
    const where = this.buildOrderWhere(ctx, filters);
    const result = await this.prisma.order.aggregate({
      where,
      _count: { _all: true },
      _sum: { total: true, deliveryFee: true },
    });
    const grandTotal = Number(result._sum.total ?? 0);
    const totalDeliveryFee = Number(result._sum.deliveryFee ?? 0);
    return {
      totalOrders: result._count._all,
      grandTotal,
      totalPayments: grandTotal - totalDeliveryFee,
      totalDeliveryFee,
    };
  }

  async listGeneralOrders(ctx: TenantContext, query: ListGeneralReportQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const searchAsId = search && /^\d+$/.test(search) ? Number(search) : undefined;
    const where: Prisma.orderWhereInput = {
      ...this.buildOrderWhere(ctx, query),
      ...(search && {
        OR: [
          { customerName: { contains: search } },
          { customerPhone: { contains: search } },
          ...(searchAsId !== undefined ? [{ id: searchAsId }] : []),
        ],
      }),
    };

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          outlet: { select: { name: true } },
          customer: { select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((o) => ({
        id: o.id,
        outletName: o.outlet.name,
        status: o.status,
        customerId: o.customer?.id ?? null,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        orderType: o.orderType,
        paymentMethod: o.paymentMethod,
        total: o.total,
        channel: o.channel,
        createdAt: o.createdAt,
      })),
      page,
      pageSize,
      total,
    };
  }

  // Monthly Report is General Report with `month` translated into the same
  // dateFrom/dateTo pair — no parallel aggregation path, no new query
  // logic, just a thin call-through into the exact same methods above.
  async getMonthlySummary(ctx: TenantContext, filters: MonthlyReportFilterDto) {
    const { month, ...rest } = filters;
    return this.getGeneralSummary(ctx, { ...rest, ...resolveMonthRange(month) });
  }

  async listMonthlyOrders(ctx: TenantContext, query: ListMonthlyReportQueryDto) {
    const { month, ...rest } = query;
    return this.listGeneralOrders(ctx, { ...rest, ...resolveMonthRange(month) });
  }

  // Same filter set as General Report's order list (reuses
  // ListGeneralReportQueryDto directly rather than a near-duplicate DTO) —
  // `status` here still means the *order's* status, not the external
  // delivery's own status column, for consistency with every other filter
  // on this shared bar. The delivery's own status is shown in the table but
  // isn't filterable through this bar, to avoid overloading one `status`
  // param with two different meanings.
  async listExternalDeliveries(ctx: TenantContext, query: ListGeneralReportQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const searchAsId = search && /^\d+$/.test(search) ? Number(search) : undefined;

    const where: Prisma.externaldeliveryWhereInput = {
      order: this.buildOrderWhere(ctx, query),
      ...(search && {
        OR: [
          { carrier: { contains: search } },
          { order: { customerName: { contains: search } } },
          { order: { customerPhone: { contains: search } } },
          ...(searchAsId !== undefined ? [{ orderId: searchAsId }] : []),
        ],
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.externaldelivery.findMany({
        where,
        include: {
          order: {
            select: {
              customerName: true,
              customerPhone: true,
              outlet: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.externaldelivery.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        outletName: r.order.outlet.name,
        customerName: r.order.customerName,
        customerPhone: r.order.customerPhone,
        carrier: r.carrier,
        vehicleType: r.vehicleType,
        price: r.price,
        destination: r.destination,
        status: r.status,
        createdAt: r.createdAt,
      })),
      page,
      pageSize,
      total,
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
    const sortColumn = PRODUCT_SALES_SORT_COLUMN[query.sortBy ?? 'totalSalePrice'];
    const sortDir = query.sortDir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const filterSql = Prisma.sql`
      o.shopId = ${ctx.shopId} AND o.status != 'cancelled'
      ${query.outletId !== undefined ? Prisma.sql`AND o.outletId = ${query.outletId}` : Prisma.empty}
      ${query.orderType ? Prisma.sql`AND o.orderType = ${query.orderType}` : Prisma.empty}
      ${query.status ? Prisma.sql`AND o.status = ${query.status}` : Prisma.empty}
      ${query.paymentMode ? Prisma.sql`AND o.paymentMethod = ${query.paymentMode}` : Prisma.empty}
      ${query.channel ? Prisma.sql`AND o.channel = ${query.channel}` : Prisma.empty}
      ${query.dateFrom ? Prisma.sql`AND o.createdAt >= ${new Date(query.dateFrom)}` : Prisma.empty}
      ${query.dateTo ? Prisma.sql`AND o.createdAt <= ${new Date(query.dateTo)}` : Prisma.empty}
    `;
    const searchSql = search ? Prisma.sql`AND p.name LIKE ${`%${search}%`}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<ProductSalesRow[]>`
      SELECT p.id AS productId, p.name AS name, p.thumbnail AS thumbnail, p.price AS currentPrice,
        COUNT(DISTINCT oi.orderId) AS orderCount,
        SUM(oi.quantity) AS totalQuantity,
        SUM(oi.quantity * oi.priceAtPurchase) AS totalSalePrice
      FROM orderitem oi
      JOIN \`order\` o ON o.id = oi.orderId
      JOIN product p ON p.id = oi.productId
      WHERE ${filterSql}
      ${searchSql}
      GROUP BY p.id
      ORDER BY ${Prisma.raw(sortColumn)} ${sortDir}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(DISTINCT p.id) AS total
      FROM orderitem oi
      JOIN \`order\` o ON o.id = oi.orderId
      JOIN product p ON p.id = oi.productId
      WHERE ${filterSql}
      ${searchSql}
    `;

    return {
      data: rows.map((r) => ({
        productId: r.productId,
        name: r.name,
        thumbnail: r.thumbnail,
        currentPrice: r.currentPrice,
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
      total: Number(total),
    };
  }
}
