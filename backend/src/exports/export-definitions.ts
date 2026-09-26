import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import type { QueryParam } from '../database/database.service';
import { PRODUCT_IMPORT_HEADERS } from '../products/products-import';
import { buildVariantLabel } from '../products/variant-generator';

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
        `SELECT o.id, o.shopOrderNumber, o.status, o.customerName, o.orderType,
                o.paymentStatus, o.total, o.channel, o.createdAt
           FROM \`order\` o
          WHERE o.shopId = ? ${outletSql}
          ORDER BY o.id DESC
          LIMIT ? OFFSET ?`,
        [ctx.shopId, ...outletParam, limit, offset],
      );
      return rows.map((r): unknown[] => [
        // The merchant's own order number, not the global id - see migration
        // 20260923130000. Exports are read by humans and pasted into
        // spreadsheets, so they carry the same number the admin shows.
        r.shopOrderNumber,
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

  // Variant-expanded, one row per variant, because this file IS the CSV import
  // format's round trip: headers come from PRODUCT_IMPORT_HEADERS itself rather
  // than a copy, so the two cannot drift, and products.e2e re-imports a file
  // this produces and asserts nothing changed.
  //
  // Collections and tags join with "; " (not a comma or a pipe) because that is
  // what the importer splits on.
  products: {
    roles: ['admin', 'viewer'],
    filenamePrefix: 'products',
    headers: PRODUCT_IMPORT_HEADERS,
    async fetchPage({ db, ctx, outletId }, limit, offset) {
      // Pages over PRODUCTS and expands each into its variant rows, so a
      // product's variants can never be split across two pages - which would
      // corrupt the round trip by orphaning variants from their Handle.
      const products = await db.query<RowDataPacket[]>(
        `SELECT p.id, p.slug, p.name, p.description, p.sku, p.barcode, p.price,
                p.compareAtPrice, p.costPrice, p.status, p.trackInventory,
                p.chargeTax, p.vendor, p.productType, p.thumbnail
           FROM product p
          WHERE p.shopId = ?
          ORDER BY p.id
          LIMIT ? OFFSET ?`,
        [ctx.shopId, limit, offset],
      );
      if (products.length === 0) return [];

      const ids = products.map((p) => p.id as number);
      const placeholders = ids.map(() => '?').join(', ');
      const stockSum =
        outletId !== undefined
          ? 'AND ois.outletId = ?'
          : '';
      const stockParams: QueryParam[] =
        outletId !== undefined ? [outletId] : [];

      const [variants, collections, tags, productStock, variantStock] =
        await Promise.all([
          db.query<RowDataPacket[]>(
            `SELECT v.id, v.productId, v.sku, v.price, v.compareAtPrice,
                    ov1.value AS optionValue1, ov2.value AS optionValue2,
                    ov3.value AS optionValue3
               FROM productvariant v
               LEFT JOIN productoptionvalue ov1 ON ov1.id = v.optionValue1Id
               LEFT JOIN productoptionvalue ov2 ON ov2.id = v.optionValue2Id
               LEFT JOIN productoptionvalue ov3 ON ov3.id = v.optionValue3Id
              WHERE v.productId IN (${placeholders})
              ORDER BY v.productId, v.id`,
            ids,
          ),
          db.query<RowDataPacket[]>(
            `SELECT pc.productId, c.name
               FROM productcollection pc
               JOIN collection c ON c.id = pc.collectionId
              WHERE pc.productId IN (${placeholders})
              ORDER BY pc.productId, c.name`,
            ids,
          ),
          db.query<RowDataPacket[]>(
            `SELECT pt.productId, t.name
               FROM producttag pt
               JOIN tag t ON t.id = pt.tagId
              WHERE pt.productId IN (${placeholders})
              ORDER BY pt.productId, t.name`,
            ids,
          ),
          // Stock lives on the SHADOW ingredient, never on product (see
          // CLAUDE.md's catalog-vs-stock split). A simple product resolves
          // through ingredient.shadowProductId; a variant through
          // shadowVariantId. Summed across outlets when none is requested, so
          // the number means the same thing the "all branches" view shows.
          db.query<RowDataPacket[]>(
            `SELECT ing.shadowProductId AS productId,
                    SUM(ois.stockQuantity) AS stockQuantity
               FROM ingredient ing
               JOIN outletingredientstock ois ON ois.ingredientId = ing.id ${stockSum}
              WHERE ing.shadowProductId IN (${placeholders})
              GROUP BY ing.shadowProductId`,
            [...stockParams, ...ids],
          ),
          db.query<RowDataPacket[]>(
            `SELECT ing.shadowVariantId AS variantId,
                    SUM(ois.stockQuantity) AS stockQuantity
               FROM ingredient ing
               JOIN productvariant v ON v.id = ing.shadowVariantId
               JOIN outletingredientstock ois ON ois.ingredientId = ing.id ${stockSum}
              WHERE v.productId IN (${placeholders})
              GROUP BY ing.shadowVariantId`,
            [...stockParams, ...ids],
          ),
        ]);

      const groupBy = <T extends RowDataPacket>(rows: T[], key: string) => {
        const map = new Map<number, T[]>();
        for (const r of rows) {
          const id = r[key] as number;
          const list = map.get(id);
          if (list) list.push(r);
          else map.set(id, [r]);
        }
        return map;
      };
      const variantsBy = groupBy(variants, 'productId');
      const collectionsBy = groupBy(collections, 'productId');
      const tagsBy = groupBy(tags, 'productId');
      const productStockBy = new Map(
        productStock.map((r) => [r.productId as number, Number(r.stockQuantity)]),
      );
      const variantStockBy = new Map(
        variantStock.map((r) => [r.variantId as number, Number(r.stockQuantity)]),
      );

      const out: unknown[][] = [];
      for (const p of products) {
        const id = p.id as number;
        const base: unknown[] = [
          p.slug,
          p.name,
          p.description ?? '',
          p.sku ?? '',
          p.barcode ?? '',
          p.price,
          p.compareAtPrice ?? '',
          p.costPrice ?? '',
          p.status,
          yesNo(p.trackInventory),
          yesNo(p.chargeTax),
          p.vendor ?? '',
          p.productType ?? '',
          p.thumbnail ?? '',
          (collectionsBy.get(id) ?? []).map((c) => c.name as string).join('; '),
          (tagsBy.get(id) ?? []).map((t) => t.name as string).join('; '),
        ];

        const productVariants = variantsBy.get(id) ?? [];
        if (productVariants.length === 0) {
          out.push([...base, '', '', '', '', productStockBy.get(id) ?? '']);
          continue;
        }
        for (const v of productVariants) {
          const label = buildVariantLabel([
            v.optionValue1 as string | undefined,
            v.optionValue2 as string | undefined,
            v.optionValue3 as string | undefined,
          ]);
          out.push([
            ...base,
            label ?? '',
            v.sku ?? '',
            v.price ?? '',
            v.compareAtPrice ?? '',
            variantStockBy.get(v.id as number) ?? '',
          ]);
        }
      }
      return out;
    },
  },

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
