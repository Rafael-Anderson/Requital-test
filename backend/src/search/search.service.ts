import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { BranchRolesService } from '../branch-roles/branch-roles.service';

const RESULTS_PER_COLLECTION = 5;

@Injectable()
export class SearchService {
  constructor(
    private readonly db: DatabaseService,
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
    const like = `%${query}%`;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, name, sku, price, thumbnail FROM product
       WHERE shopId = ? AND (name LIKE ? OR sku LIKE ?)
       ORDER BY name ASC
       LIMIT ?`,
      [ctx.shopId, like, like, RESULTS_PER_COLLECTION],
    );
    return rows.map((p) => ({
      id: p.id as number,
      name: p.name as string,
      sku: p.sku as string,
      price: p.price as string,
      thumbnail: p.thumbnail as string,
    }));
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

    const like = `%${query}%`;
    const conditions = ['shopId = ?'];
    const params: (string | number)[] = [ctx.shopId];
    if (outletId !== undefined) {
      conditions.push('outletId = ?');
      params.push(outletId);
    }
    const orClauses = ['customerName LIKE ?', 'customerPhone LIKE ?'];
    params.push(like, like);
    if (searchAsId !== undefined) {
      orClauses.push('id = ?');
      params.push(searchAsId);
    }
    conditions.push(`(${orClauses.join(' OR ')})`);

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, customerName, status, total FROM \`order\`
       WHERE ${conditions.join(' AND ')}
       ORDER BY createdAt DESC
       LIMIT ?`,
      [...params, RESULTS_PER_COLLECTION],
    );
    return rows.map((o) => ({
      id: o.id as number,
      customerName: o.customerName as string,
      status: o.status as string,
      total: o.total as string,
    }));
  }

  private async searchCustomers(ctx: TenantContext, query: string) {
    // Matches CustomersController's own access split — 'branch' and
    // 'order_manager' never see customer data anywhere else in the app, so
    // they shouldn't see it surface here either. Silently empty rather than
    // throwing, so one blocked collection doesn't fail the whole search.
    if (ctx.role !== 'admin' && ctx.role !== 'viewer') return [];

    const like = `%${query}%`;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, name, phone, email FROM customer
       WHERE shopId = ? AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)
       ORDER BY name ASC
       LIMIT ?`,
      [ctx.shopId, like, like, like, RESULTS_PER_COLLECTION],
    );
    return rows.map((c) => ({
      id: c.id as number,
      name: c.name as string,
      phone: c.phone as string,
      email: c.email as string | null,
    }));
  }
}
