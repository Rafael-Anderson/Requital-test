import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import type { QueryParam } from '../database/database.service';

// ANL-11: one definition per exportable report. Adding an export is adding an
// entry here - the controller, the streaming, the paging, the escaping and the
// tenant scoping are all shared, which is the whole point of replacing five
// separate client-side implementations.
//
// Every query MUST be shop-scoped and MUST have a deterministic ORDER BY:
// paging with LIMIT/OFFSET over an unordered result set can repeat or skip
// rows between pages, which in an export shows up as a duplicated or missing
// line rather than an error.

export interface ExportContext {
  db: DatabaseService;
  ctx: TenantContext;
  outletId?: number;
  search?: string;
}

export interface ExportDefinition {
  // Roles allowed to run it, checked on top of the controller's own guard.
  roles: readonly string[];
  filenamePrefix: string;
  headers: readonly string[];
  fetchPage(
    env: ExportContext,
    limit: number,
    offset: number,
  ): Promise<unknown[][]>;
}

function yesNo(value: unknown): string {
  return value ? 'TRUE' : 'FALSE';
}

function isoOrEmpty(value: unknown): string {
  return value instanceof Date ? value.toISOString() : '';
}

export const EXPORT_DEFINITIONS: Record<string, ExportDefinition> = {
  // Matches the columns the in-page button produced, so a merchant's existing
  // spreadsheet templates keep working - the difference is that this one is
  // every customer, not whichever page happened to be on screen.
  customers: {
    roles: ['admin', 'viewer', 'order_manager'],
    filenamePrefix: 'customers',
    headers: ['Name', 'Phone', 'Orders', 'Lifetime Value', 'Last Order'],
    async fetchPage({ db, ctx, search }, limit, offset) {
      // Same OR-across-name-and-phone shape as CustomersService, so the file
      // matches what the page was showing.
      const searchSql = search ? 'AND (c.name LIKE ? OR c.phone LIKE ?)' : '';
      const searchParams: QueryParam[] = search
        ? [`%${search}%`, `%${search}%`]
        : [];
      const rows = await db.query<RowDataPacket[]>(
        `SELECT c.name, c.phone,
                COUNT(o.id) AS orderCount,
                COALESCE(SUM(o.total), 0) AS ltv,
                MAX(o.createdAt) AS lastOrderDate
           FROM customer c
           LEFT JOIN \`order\` o
             ON o.customerId = c.id AND o.status <> 'cancelled'
          WHERE c.shopId = ? ${searchSql}
          GROUP BY c.id
          ORDER BY c.id
          LIMIT ? OFFSET ?`,
        [ctx.shopId, ...searchParams, limit, offset],
      );
      return rows.map((r): unknown[] => [
        r.name,
        r.phone,
        Number(r.orderCount),
        Number(r.ltv).toFixed(2),
        isoOrEmpty(r.lastOrderDate),
      ]);
    },
  },

  orders: {
    roles: ['admin', 'viewer', 'order_manager', 'branch'],
    filenamePrefix: 'orders',
    headers: [
      'Ref No',
      'Status',
      'Customer',
      'Type',
      'Payment Status',
      'Total',
      'Channel',
      'Placed At',
    ],
    async fetchPage({ db, ctx, outletId }, limit, offset) {
      const outletSql = outletId !== undefined ? 'AND o.outletId = ?' : '';
      const outletParam = outletId !== undefined ? [outletId] : [];
      const rows = await db.query<RowDataPacket[]>(
        `SELECT o.id, o.status, o.customerName, o.orderType, o.paymentStatus,
                o.total, o.channel, o.createdAt
           FROM \`order\` o
          WHERE o.shopId = ? ${outletSql}
          ORDER BY o.id DESC
          LIMIT ? OFFSET ?`,
        [ctx.shopId, ...outletParam, limit, offset],
      );
      return rows.map((r): unknown[] => [
        r.id,
        r.status,
        r.customerName,
        r.orderType ?? '',
        r.paymentStatus,
        r.total,
        r.channel ?? '',
        isoOrEmpty(r.createdAt),
      ]);
    },
  },

  // Ingredients, which is what the Inventory page actually lists. Stock is
  // summed across every outlet when no outlet is requested rather than being
  // silently taken from one - "Stock" on a multi-branch shop's export has to
  // mean the same thing as the page's "all branches" view.
  inventory: {
    roles: ['admin', 'viewer', 'branch'],
    filenamePrefix: 'ingredients',
    headers: ['Name', 'Unit', 'Track Inventory', 'Stock'],
    async fetchPage({ db, ctx, outletId }, limit, offset) {
      const stockJoin =
        outletId !== undefined
          ? `LEFT JOIN outletingredientstock s
               ON s.ingredientId = i.id AND s.outletId = ?`
          : `LEFT JOIN outletingredientstock s ON s.ingredientId = i.id`;
      const params: QueryParam[] =
        outletId !== undefined
          ? [outletId, ctx.shopId, limit, offset]
          : [ctx.shopId, limit, offset];
      const rows = await db.query<RowDataPacket[]>(
        `SELECT i.name, i.unit, i.trackInventory,
                SUM(COALESCE(s.stockQuantity, 0)) AS stockQuantity,
                COUNT(s.ingredientId) AS stockRows
           FROM ingredient i
           ${stockJoin}
          WHERE i.shopId = ?
          GROUP BY i.id
          ORDER BY i.id
          LIMIT ? OFFSET ?`,
        params,
      );
      return rows.map((r): unknown[] => [
        r.name,
        r.unit,
        yesNo(r.trackInventory),
        // No stock row at all is "not stocked here", which is different from a
        // real zero - matching GET /products' own null-not-zero rule.
        Number(r.stockRows) === 0 ? '' : Number(r.stockQuantity),
      ]);
    },
  },

  'newsletter-subscribers': {
    roles: ['admin', 'viewer'],
    filenamePrefix: 'newsletter-subscribers',
    headers: ['Email', 'Source', 'Subscribed'],
    async fetchPage({ db, ctx, search }, limit, offset) {
      const searchSql = search ? 'AND email LIKE ?' : '';
      const searchParams: QueryParam[] = search ? [`%${search}%`] : [];
      const rows = await db.query<RowDataPacket[]>(
        `SELECT email, source, createdAt
           FROM newslettersubscriber
          WHERE shopId = ? ${searchSql}
          ORDER BY id
          LIMIT ? OFFSET ?`,
        [ctx.shopId, ...searchParams, limit, offset],
      );
      return rows.map((r): unknown[] => [r.email, r.source, isoOrEmpty(r.createdAt)]);
    },
  },

  // `products` is DELIBERATELY NOT HERE. The admin's product export is a bulk
  // action over the current SELECTION, not a paginated "export all", so it does
  // not have the bug this endpoint exists to fix - and its columns are
  // PRODUCT_IMPORT_HEADERS, an import round-trip format whose Stock column has
  // to resolve through shadow ingredients into outletingredientstock. Building
  // that badly would break re-import silently. It moves in the ANL-8 PR, which
  // is already in the stock code.

  // Part A's margin report (A4). Uses orderitem.unitCost - the cost captured
  // at order time - and keeps that report's own null-not-zero rule: an
  // uncosted line is excluded from the money and counted in its own column,
  // never folded in as a zero.
  margin: {
    roles: ['admin', 'viewer'],
    filenamePrefix: 'margin-by-product',
    headers: [
      'Product',
      'Revenue',
      'Cost',
      'Margin',
      'Margin %',
      'Uncosted Lines',
    ],
    async fetchPage({ db, ctx, outletId }, limit, offset) {
      const outletSql = outletId !== undefined ? 'AND o.outletId = ?' : '';
      const outletParam = outletId !== undefined ? [outletId] : [];
      const rows = await db.query<RowDataPacket[]>(
        `SELECT oi.productName AS label,
                COALESCE(SUM(CASE WHEN oi.unitCost IS NOT NULL
                                  THEN oi.quantity * oi.priceAtPurchase END), 0) AS revenue,
                COALESCE(SUM(CASE WHEN oi.unitCost IS NOT NULL
                                  THEN oi.quantity * oi.unitCost END), 0) AS cost,
                COALESCE(SUM(CASE WHEN oi.unitCost IS NULL THEN 1 ELSE 0 END), 0) AS linesWithoutCost
           FROM orderitem oi
           JOIN \`order\` o ON o.id = oi.orderId
          WHERE o.shopId = ? ${outletSql}
          GROUP BY oi.productId, oi.productName
          ORDER BY oi.productId
          LIMIT ? OFFSET ?`,
        [ctx.shopId, ...outletParam, limit, offset],
      );
      return rows.map((r): unknown[] => {
        const revenue = Number(r.revenue);
        const cost = Number(r.cost);
        const margin = revenue - cost;
        return [
          r.label,
          revenue.toFixed(2),
          cost.toFixed(2),
          margin.toFixed(2),
          // Blank, not 0, when nothing costed sold: "0%" and "nothing to
          // measure" are different answers.
          revenue > 0 ? ((margin / revenue) * 100).toFixed(1) : '',
          Number(r.linesWithoutCost),
        ];
      });
    },
  },
};

export const EXPORT_KINDS = Object.keys(EXPORT_DEFINITIONS);
