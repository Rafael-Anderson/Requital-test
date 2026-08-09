import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { BranchRolesService } from '../branch-roles/branch-roles.service';

const RESULTS_PER_COLLECTION = 5;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchRolesService: BranchRolesService,
  ) {}

  // Deliberately its own light queries rather than delegating to
  // Products/Orders/CustomersService.findAll — those return the full,
  // richly-included shape their own list pages need; a command-palette
  // result only ever needs id + a couple of display fields. The ACCESS
  // rules below are still hand-matched to what each of those controllers
  // actually allows today (products: any role; orders: any role, branch
  // outlet-scoped; customers: admin/viewer only) — if those controllers'
  // @Roles ever change, this needs updating alongside them.
  async search(ctx: TenantContext, q: string) {
    const query = q?.trim();
    if (!query) {
      return { products: [], orders: [], customers: [] };
    }
    const searchAsId = /^\d+$/.test(query) ? Number(query) : undefined;

    const [products, orders, customers] = await Promise.all([
      this.searchProducts(ctx, query),
      this.searchOrders(ctx, query, searchAsId),
      this.searchCustomers(ctx, query),
    ]);

    return { products, orders, customers };
  }

  private async searchProducts(ctx: TenantContext, query: string) {
    const rows = await this.prisma.product.findMany({
      where: {
        shopId: ctx.shopId,
        OR: [{ name: { contains: query } }, { sku: { contains: query } }],
      },
      select: { id: true, name: true, sku: true, price: true, thumbnail: true },
      take: RESULTS_PER_COLLECTION,
      orderBy: { name: 'asc' },
    });
    return rows.map((p) => ({ ...p, price: p.price.toString() }));
  }

  private async searchOrders(
    ctx: TenantContext,
    query: string,
    searchAsId: number | undefined,
  ) {
    const outletId = resolveOutletFilter(ctx, undefined);
    // The only outlet-scoped part of search — searchProducts is shop-wide
    // by design (any role) and searchCustomers' gate below is a pure role
    // check with no outlet involved, so neither needs this.
    if (outletId !== undefined) {
      await this.branchRolesService.assertPermission(
        ctx,
        outletId,
        'search.use',
      );
    }
    const rows = await this.prisma.order.findMany({
      where: {
        shopId: ctx.shopId,
        ...(outletId !== undefined && { outletId }),
        OR: [
          { customerName: { contains: query } },
          { customerPhone: { contains: query } },
          ...(searchAsId !== undefined ? [{ id: searchAsId }] : []),
        ],
      },
      select: { id: true, customerName: true, status: true, total: true },
      take: RESULTS_PER_COLLECTION,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((o) => ({ ...o, total: o.total.toString() }));
  }

  private async searchCustomers(ctx: TenantContext, query: string) {
    // Matches CustomersController's own access split — 'branch' and
    // 'order_manager' never see customer data anywhere else in the app, so
    // they shouldn't see it surface here either. Silently empty rather than
    // throwing, so one blocked collection doesn't fail the whole search.
    if (ctx.role !== 'admin' && ctx.role !== 'viewer') return [];

    const rows = await this.prisma.customer.findMany({
      where: {
        shopId: ctx.shopId,
        OR: [
          { name: { contains: query } },
          { phone: { contains: query } },
          { email: { contains: query } },
        ],
      },
      select: { id: true, name: true, phone: true, email: true },
      take: RESULTS_PER_COLLECTION,
      orderBy: { name: 'asc' },
    });
    return rows;
  }
}
