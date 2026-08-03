import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { BranchRolesService } from '../branch-roles/branch-roles.service';

// UAE/Gulf merchants run on UTC+4 year-round (no DST) — day boundaries are
// computed in that offset rather than server-local/UTC time.
const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;

function startOfDayUAE(reference: Date): Date {
  const shifted = new Date(reference.getTime() + UAE_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - UAE_OFFSET_MS);
}

function uaeDateKey(instant: Date): string {
  return new Date(instant.getTime() + UAE_OFFSET_MS).toISOString().slice(0, 10);
}

interface DailyRevenueRow {
  day: Date;
  revenue: string | null;
}

interface TopProductRow {
  productId: number;
  revenue: string | null;
  unitsSold: bigint | null;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchRolesService: BranchRolesService,
  ) {}

  // Resolves the requested [from, to] into UAE-day-aligned instants, plus the
  // immediately preceding period of equal length for period-over-period
  // comparisons. `toExclusive` is the start of the day after `to`, so range
  // checks are always `createdAt >= from && createdAt < toExclusive` — no
  // off-by-one from end-of-day time components.
  private resolveRange(fromParam?: string, toParam?: string) {
    const to = toParam
      ? startOfDayUAE(new Date(toParam))
      : startOfDayUAE(new Date());
    const toExclusive = new Date(to.getTime() + DAY_MS);
    const from = fromParam
      ? startOfDayUAE(new Date(fromParam))
      : new Date(to.getTime() - (DEFAULT_WINDOW_DAYS - 1) * DAY_MS);

    const periodMs = toExclusive.getTime() - from.getTime();
    const prevToExclusive = from;
    const prevFrom = new Date(from.getTime() - periodMs);

    return { from, toExclusive, prevFrom, prevToExclusive };
  }

  private changePct(current: number, previous: number): number | null {
    if (previous === 0) return current === 0 ? 0 : null;
    return ((current - previous) / previous) * 100;
  }

  private async revenueAndCount(
    shopId: number,
    outletId: number | undefined,
    from: Date,
    toExclusive: Date,
  ) {
    const result = await this.prisma.order.aggregate({
      where: {
        shopId,
        ...(outletId !== undefined && { outletId }),
        status: { not: 'cancelled' },
        createdAt: { gte: from, lt: toExclusive },
      },
      _sum: { total: true },
      _count: { _all: true },
    });
    return {
      revenue: Number(result._sum.total ?? 0),
      orderCount: result._count._all,
    };
  }

  async getSummary(
    ctx: TenantContext,
    fromParam?: string,
    toParam?: string,
    requestedOutletId?: number,
  ) {
    const { from, toExclusive, prevFrom, prevToExclusive } = this.resolveRange(
      fromParam,
      toParam,
    );
    const outletId = resolveOutletFilter(ctx, requestedOutletId);
    // A branch-role override only ever matters when a single concrete
    // outlet is in view — the "all branches" aggregate (outletId
    // undefined) is unaffected by design, same as every other list/
    // aggregate endpoint in this audit.
    if (outletId !== undefined) {
      await this.branchRolesService.assertPermission(
        ctx,
        outletId,
        'dashboard.view',
      );
    }
    const outletWhere = outletId !== undefined ? { outletId } : {};

    const [
      current,
      previous,
      totalOrders,
      stageCounts,
      firstOrderByCustomer,
      channelGroups,
      outletCounts,
      outlets,
    ] = await Promise.all([
      this.revenueAndCount(ctx.shopId, outletId, from, toExclusive),
      this.revenueAndCount(ctx.shopId, outletId, prevFrom, prevToExclusive),
      this.prisma.order.count({
        where: {
          shopId: ctx.shopId,
          ...outletWhere,
          createdAt: { gte: from, lt: toExclusive },
        },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: {
          shopId: ctx.shopId,
          ...outletWhere,
          createdAt: { gte: from, lt: toExclusive },
        },
        _count: { _all: true },
      }),
      // First order per customer (by phone) within the resolved scope, not
      // period-bounded — so "new this period" means their very first order
      // (at this outlet, if one is resolved; shop-wide otherwise) fell in
      // it, not just that they ordered again during it.
      this.prisma.order.groupBy({
        by: ['customerPhone'],
        where: { shopId: ctx.shopId, ...outletWhere },
        _min: { createdAt: true },
      }),
      this.prisma.order.groupBy({
        by: ['channel'],
        where: {
          shopId: ctx.shopId,
          ...outletWhere,
          status: { not: 'cancelled' },
          createdAt: { gte: from, lt: toExclusive },
        },
        _count: { _all: true },
      }),
      // Per-outlet order volume for the Outlet Distribution panel — real
      // now that multi-branch exists, not the single-outlet-100% placeholder
      // this endpoint used before outlets were built.
      this.prisma.order.groupBy({
        by: ['outletId'],
        where: {
          shopId: ctx.shopId,
          ...outletWhere,
          createdAt: { gte: from, lt: toExclusive },
        },
        _count: { _all: true },
      }),
      this.prisma.outlet.findMany({
        where: {
          shopId: ctx.shopId,
          ...(outletId !== undefined && { id: outletId }),
        },
        select: { id: true, name: true },
      }),
    ]);

    const aov = (r: { revenue: number; orderCount: number }) =>
      r.orderCount > 0 ? r.revenue / r.orderCount : 0;

    const stageCountByStatus = Object.fromEntries(
      stageCounts.map((s) => [s.status, s._count._all]),
    );
    const ordersByStage = {
      placed: stageCountByStatus['pending'] ?? 0,
      accepted: stageCountByStatus['confirmed'] ?? 0,
      preparing: stageCountByStatus['preparing'] ?? 0,
      shipped: stageCountByStatus['out_for_delivery'] ?? 0,
      delivered: stageCountByStatus['delivered'] ?? 0,
    };

    const newCustomersIn = (rangeFrom: Date, rangeToExclusive: Date) =>
      firstOrderByCustomer.filter((c) => {
        const firstOrder = c._min.createdAt;
        return (
          firstOrder && firstOrder >= rangeFrom && firstOrder < rangeToExclusive
        );
      }).length;
    const currentNewCustomers = newCustomersIn(from, toExclusive);
    const previousNewCustomers = newCustomersIn(prevFrom, prevToExclusive);

    const channelTotal = channelGroups.reduce(
      (sum, g) => sum + g._count._all,
      0,
    );
    const channels = channelGroups
      .map((g) => ({
        channel: g.channel ?? 'Unspecified',
        count: g._count._all,
        percentage: channelTotal > 0 ? (g._count._all / channelTotal) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Outlets with zero orders in the range still show up at 0% — a branch
    // that's been quiet is a real signal, not something to hide.
    const outletOrderTotal = outletCounts.reduce(
      (sum, g) => sum + g._count._all,
      0,
    );
    const countByOutlet = new Map(
      outletCounts.map((g) => [g.outletId, g._count._all]),
    );
    const outletBreakdown = outlets
      .map((o) => {
        const count = countByOutlet.get(o.id) ?? 0;
        return {
          outletId: o.id,
          name: o.name,
          orderCount: count,
          percentage:
            outletOrderTotal > 0 ? (count / outletOrderTotal) * 100 : 0,
        };
      })
      .sort((a, b) => b.orderCount - a.orderCount);

    return {
      period: {
        from: uaeDateKey(from),
        to: uaeDateKey(new Date(toExclusive.getTime() - 1)),
      },
      revenue: {
        current: current.revenue,
        previous: previous.revenue,
        changePct: this.changePct(current.revenue, previous.revenue),
      },
      avgBasketValue: {
        current: aov(current),
        previous: aov(previous),
        changePct: this.changePct(aov(current), aov(previous)),
      },
      totalOrders,
      customerGrowth: {
        current: currentNewCustomers,
        previous: previousNewCustomers,
        changePct: this.changePct(currentNewCustomers, previousNewCustomers),
      },
      ordersByStage,
      outlets: outletBreakdown,
      channels,
    };
  }

  async getDailyRevenue(
    ctx: TenantContext,
    fromParam?: string,
    toParam?: string,
    requestedOutletId?: number,
  ) {
    const { from, toExclusive } = this.resolveRange(fromParam, toParam);
    const outletId = resolveOutletFilter(ctx, requestedOutletId);
    if (outletId !== undefined) {
      await this.branchRolesService.assertPermission(
        ctx,
        outletId,
        'dashboard.view',
      );
    }
    const outletFilter =
      outletId !== undefined
        ? Prisma.sql`AND outletId = ${outletId}`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<DailyRevenueRow[]>`
      SELECT DATE(DATE_ADD(createdAt, INTERVAL 4 HOUR)) AS day, SUM(total) AS revenue
      FROM \`order\`
      WHERE shopId = ${ctx.shopId} AND status != 'cancelled'
        AND createdAt >= ${from} AND createdAt < ${toExclusive}
        ${outletFilter}
      GROUP BY day
      ORDER BY day ASC
    `;
    const byDay = new Map(
      rows.map((r) => [
        new Date(r.day).toISOString().slice(0, 10),
        Number(r.revenue ?? 0),
      ]),
    );

    const series: { date: string; revenue: number }[] = [];
    const days = Math.round((toExclusive.getTime() - from.getTime()) / DAY_MS);
    for (let i = 0; i < days; i++) {
      const date = uaeDateKey(new Date(from.getTime() + i * DAY_MS));
      series.push({ date, revenue: byDay.get(date) ?? 0 });
    }
    return series;
  }

  async getTopProducts(
    ctx: TenantContext,
    fromParam?: string,
    toParam?: string,
    limit = 5,
    requestedOutletId?: number,
  ) {
    const { from, toExclusive } = this.resolveRange(fromParam, toParam);
    const outletId = resolveOutletFilter(ctx, requestedOutletId);
    if (outletId !== undefined) {
      await this.branchRolesService.assertPermission(
        ctx,
        outletId,
        'dashboard.view',
      );
    }
    const outletFilter =
      outletId !== undefined
        ? Prisma.sql`AND o.outletId = ${outletId}`
        : Prisma.empty;

    // Prisma's groupBy can't aggregate a derived expression (quantity *
    // priceAtPurchase varies per line item, so it isn't a plain column sum)
    // — raw SQL for this one, same as the daily-revenue DATE() grouping above.
    const rows = await this.prisma.$queryRaw<TopProductRow[]>`
      SELECT oi.productId AS productId,
             SUM(oi.quantity * oi.priceAtPurchase) AS revenue,
             SUM(oi.quantity) AS unitsSold
      FROM orderitem oi
      JOIN \`order\` o ON o.id = oi.orderId
      WHERE o.shopId = ${ctx.shopId} AND o.status != 'cancelled'
        AND o.createdAt >= ${from} AND o.createdAt < ${toExclusive}
        ${outletFilter}
      GROUP BY oi.productId
      ORDER BY revenue DESC
      LIMIT ${limit}
    `;

    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId) } },
      select: { id: true, name: true, thumbnail: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    return rows.map((r) => ({
      productId: r.productId,
      name: productById.get(r.productId)?.name ?? 'Unknown product',
      thumbnail: productById.get(r.productId)?.thumbnail ?? null,
      revenue: Number(r.revenue ?? 0),
      unitsSold: Number(r.unitsSold ?? 0),
    }));
  }
}
