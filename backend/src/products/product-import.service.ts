import { Injectable, BadRequestException } from '@nestjs/common';
import { buildSetClause } from '../database/update.util';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { TenantContext } from '../common/tenant-context';
import { slugify } from '../common/slugify';
import { PRODUCT_STATUSES, ProductStatus } from './dto/create-product.dto';
import { parseCsv } from '../common/csv.util';
import {
  ImportAction,
  ImportRowResult,
  parseImportBoolean,
  parseImportNumber,
  splitList,
} from './products-import';
import { DatabaseService } from '../database/database.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  NotifySubscriptionsService,
} from '../notify-subscriptions/notify-subscriptions.service';
import { ProductBomService } from './product-bom.service';
import { ProductStockService } from './product-stock.service';

// CSV import working types — see products-import.ts for the header
// contract and classifyImportRows below for how raw CSV rows become these.
interface ResolvedVariantRow {
  rowNumber: number;
  action: ImportAction;
  variantId?: number;
  price?: number;
  compareAtPrice?: number;
  stock?: number;
}

interface ResolvedProductGroup {
  rowNumber: number;
  action: ImportAction;
  productId?: number;
  data: {
    name: string;
    sku?: string;
    price?: number;
    thumbnail?: string;
    description?: string;
    barcode?: string;
    compareAtPrice?: number;
    costPrice?: number;
    status?: ProductStatus;
    trackInventory?: boolean;
    chargeTax?: boolean;
    vendor?: string;
    productType?: string;
    collectionIds?: number[];
    tagNames?: string[];
  };
  stock?: number;
  variants: ResolvedVariantRow[];
}


// CSV product import (preview + confirm).
@Injectable()
export class ProductImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
    private readonly notifySubscriptionsService: NotifySubscriptionsService,
    private readonly bom: ProductBomService,
    private readonly stock: ProductStockService,
  ) {}

  // CSV bulk import — see products-import.ts for the header/type contract
  // shared with admin/lib/csv.ts's export. Preview and confirm run the
  // *exact same* read-only classification (classifyImportRows) so a client
  // can never get a different verdict between what it previewed and what
  // actually commits; the only difference is confirm additionally opens a
  // transaction and writes. There is no server-side upload id/session — the
  // client just re-submits the same file to /import/confirm after showing
  // the preview, keeping this endpoint pair fully stateless. Matching is
  // always by SKU/name scoped to ctx.shopId (never a client-supplied id), so
  // a crafted CSV can't reference or overwrite another shop's product.
  async previewImportProducts(ctx: TenantContext, file: Express.Multer.File) {
    const rawRows = parseCsv(file.buffer.toString('utf-8'));
    const { results } = await this.classifyImportRows(ctx, rawRows);
    return { rows: results };
  }

  async confirmImportProducts(
    ctx: TenantContext,
    file: Express.Multer.File,
    outletId: number | undefined,
  ) {
    if (outletId !== undefined) {
      const outletRows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
        [outletId, ctx.shopId],
      );
      if (outletRows.length === 0) {
        throw new BadRequestException('outletId is invalid for this shop');
      }
    }
    const rawRows = parseCsv(file.buffer.toString('utf-8'));
    const { results, groups } = await this.classifyImportRows(ctx, rawRows);

    // The CSV carries `chargeTax`, so an imported row expresses a real VAT
    // intent - and leaving taxClassId NULL would resolve it to the shop's
    // DEFAULT (standard) class once B2 computes per line, i.e. charging tax on a
    // row the merchant explicitly marked chargeTax=false. Mapped here the same
    // way migration 20260929120000 backfilled the existing catalog. Resolved
    // once per import rather than per row.
    const importTaxClassIds = await this.resolveChargeTaxClassIds(ctx.shopId);

    let created = 0;
    let updated = 0;
    const usedSlugsThisBatch = new Set<string>();
    const restockNotifyTargets: { productId: number; variantId: number | null }[] = [];

    await this.db.transaction(async (conn) => {
      for (const group of groups) {
        if (group.action === 'reject') continue;

        let productId: number;
        if (group.action === 'create') {
          const root = slugify(group.data.name);
          let slug = root;
          let suffix = 2;
          for (;;) {
            const [slugRows] = await conn.query<RowDataPacket[]>(
              `SELECT id FROM product WHERE shopId = ? AND slug = ?`,
              [ctx.shopId, slug],
            );
            if (!usedSlugsThisBatch.has(slug) && slugRows.length === 0) break;
            slug = `${root}-${suffix}`;
            suffix += 1;
          }
          usedSlugsThisBatch.add(slug);

          const tagIds = await this.resolveTagIdsTx(
            conn,
            ctx,
            group.data.tagNames ?? [],
          );
          const [productResult] = await conn.query(
            `INSERT INTO product (shopId, name, price, compareAtPrice, costPrice, thumbnail, sku, barcode, description, vendor, productType, slug, status, trackInventory, chargeTax, taxClassId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              ctx.shopId,
              group.data.name,
              group.data.price!,
              group.data.compareAtPrice ?? null,
              group.data.costPrice ?? null,
              group.data.thumbnail!,
              group.data.sku!,
              group.data.barcode ?? null,
              group.data.description ?? null,
              group.data.vendor ?? null,
              group.data.productType ?? null,
              slug,
              group.data.status ?? 'Available',
              group.data.trackInventory ?? false,
              group.data.chargeTax ?? true,
              (group.data.chargeTax ?? true)
                ? importTaxClassIds.standard
                : importTaxClassIds.zero,
            ],
          );
          const newProduct = {
            id: (productResult as { insertId: number }).insertId,
            name: group.data.name,
            thumbnail: group.data.thumbnail!,
            trackInventory: group.data.trackInventory ?? false,
            costPrice: group.data.costPrice != null ? String(group.data.costPrice) : null,
          };
          if ((group.data.collectionIds ?? []).length > 0) {
            const placeholders = group.data.collectionIds!.map(() => '(?, ?)').join(', ');
            await conn.query(
              `INSERT INTO productcollection (productId, collectionId) VALUES ${placeholders}`,
              group.data.collectionIds!.flatMap((collectionId) => [newProduct.id, collectionId]),
            );
          }
          if (tagIds.length > 0) {
            const placeholders = tagIds.map(() => '(?, ?)').join(', ');
            await conn.query(
              `INSERT INTO producttag (productId, tagId) VALUES ${placeholders}`,
              tagIds.flatMap((tagId) => [newProduct.id, tagId]),
            );
          }
          productId = newProduct.id;
          created += 1;
          // CSV import never creates a recipe (usesIngredients stays the
          // schema default, false) or variants for a new product — always
          // a product-level shadow.
          await this.bom.provisionShadowForProduct(conn, ctx, newProduct.id, newProduct);
        } else {
          productId = group.productId!;
          if (group.data.collectionIds) {
            await conn.query(`DELETE FROM productcollection WHERE productId = ?`, [productId]);
            if (group.data.collectionIds.length > 0) {
              const placeholders = group.data.collectionIds.map(() => '(?, ?)').join(', ');
              await conn.query(
                `INSERT INTO productcollection (productId, collectionId) VALUES ${placeholders}`,
                group.data.collectionIds.flatMap((collectionId) => [productId, collectionId]),
              );
            }
          }
          if (group.data.tagNames) {
            const tagIds = await this.resolveTagIdsTx(conn, ctx, group.data.tagNames);
            await conn.query(`DELETE FROM producttag WHERE productId = ?`, [productId]);
            if (tagIds.length > 0) {
              const placeholders = tagIds.map(() => '(?, ?)').join(', ');
              await conn.query(
                `INSERT INTO producttag (productId, tagId) VALUES ${placeholders}`,
                tagIds.flatMap((tagId) => [productId, tagId]),
              );
            }
          }
          const set = buildSetClause({
            name: group.data.name,
            sku: group.data.sku,
            price: group.data.price,
            compareAtPrice: group.data.compareAtPrice,
            costPrice: group.data.costPrice,
            thumbnail: group.data.thumbnail,
            barcode: group.data.barcode,
            description: group.data.description,
            vendor: group.data.vendor,
            productType: group.data.productType,
            status: group.data.status,
            trackInventory: group.data.trackInventory,
            chargeTax: group.data.chargeTax,
          });
          if (set) {
            await conn.query(`UPDATE product SET ${set.setClause} WHERE id = ?`, [
              ...set.params,
              productId,
            ]);
          }
          updated += 1;
          // No-op for a variant-carrying or recipe product (no matching
          // shadowProductId row) — see syncShadowMeta's own comment.
          await this.bom.syncShadowMeta(
            conn,
            { shadowProductId: productId },
            {
              name: group.data.name,
              thumbnail: group.data.thumbnail,
              trackInventory: group.data.trackInventory,
              costPrice: group.data.costPrice,
            },
          );
        }

        if (group.stock !== undefined && outletId !== undefined) {
          const { crossedToPositive } = await this.applyImportStock(conn, ctx, {
            outletId,
            productId,
            stock: group.stock,
          });
          if (crossedToPositive) {
            restockNotifyTargets.push({ productId, variantId: null });
          }
        }

        for (const variant of group.variants) {
          if (variant.action === 'reject') continue;
          const set = buildSetClause({
            price: variant.price,
            compareAtPrice: variant.compareAtPrice,
          });
          if (set) {
            await conn.query(`UPDATE productvariant SET ${set.setClause} WHERE id = ?`, [
              ...set.params,
              variant.variantId!,
            ]);
          }
          if (variant.stock !== undefined && outletId !== undefined) {
            const { crossedToPositive } = await this.applyImportStock(conn, ctx, {
              outletId,
              variantId: variant.variantId!,
              stock: variant.stock,
            });
            if (crossedToPositive) {
              restockNotifyTargets.push({ productId, variantId: variant.variantId! });
            }
          }
        }
      }
    });

    for (const target of restockNotifyTargets) {
      this.notifySubscriptionsService
        .triggerForProduct(ctx.shopId, target.productId, target.variantId ?? undefined)
        .catch(() => {});
    }

    await this.auditLogService.logCtx(ctx, {
      action: 'product.bulk_imported',
      entityType: 'product',
      metadata: {
        created,
        updated,
        rejected: results.filter((r) => r.action === 'reject').length,
      },
    });

    return {
      rows: results,
      created,
      updated,
      skipped: results.filter((r) => r.action === 'reject').length,
    };
  }

  // Absolute-set, not delta — a CSV "Stock" column is the merchant's
  // intended final count, same as re-importing their own prior export
  // should be a no-op. Still logged as a delta in stockmovement (computed
  // against the current value) so the movement history reads the same way
  // as every other adjustment. Returns whether this write crossed 0 ->
  // positive, so the caller can fire the back-in-stock notify-me trigger
  // once the transaction actually commits (same before/after-tx split as
  // adjustStock/transferStock use — never fired from inside the tx itself).
  async applyImportStock(
    conn: PoolConnection,
    ctx: TenantContext,
    target: {
      outletId: number;
      productId?: number;
      variantId?: number;
      stock: number;
    },
  ): Promise<{ crossedToPositive: boolean }> {
    // Passes `conn` explicitly — this runs mid-transaction inside
    // confirmImportProducts, sometimes against a product created earlier in
    // this very transaction, so resolution must see uncommitted writes.
    // Rejecting a usesIngredients:true product's Stock column happens
    // earlier, in classifyImportRows, so resolved here is always a shadow.
    const resolved = await this.stock.resolveShadowStockTarget(
      ctx,
      { productId: target.productId, variantId: target.variantId },
      conn,
    );

    const [beforeRows] = await conn.query<RowDataPacket[]>(
      `SELECT stockQuantity FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
      [target.outletId, resolved.ingredientId],
    );
    const before = (beforeRows[0]?.stockQuantity as number | undefined) ?? 0;

    await conn.query(
      `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE stockQuantity = VALUES(stockQuantity)`,
      [target.outletId, resolved.ingredientId, target.stock],
    );

    await conn.query(
      `INSERT INTO stockmovement (shopId, productId, variantId, ingredientId, type, reason, delta, outletId, toOutletId, note, actorUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.shopId,
        resolved.productId,
        resolved.variantId,
        resolved.ingredientId,
        'IMPORT',
        null,
        target.stock - before,
        target.outletId,
        null,
        'CSV import',
        ctx.userId,
      ],
    );

    return { crossedToPositive: before <= 0 && target.stock > 0 };
  }

  // Same as resolveTagIds below but against a transaction connection — kept
  // separate rather than parameterizing resolveTagIds's `this.db` call,
  // since every other write in the import commit path must go through the
  // same conn for the batch to be one real transaction (see confirmImportProducts).
  async resolveTagIdsTx(
    conn: PoolConnection,
    ctx: TenantContext,
    names: string[],
  ): Promise<number[]> {
    const uniqueNames = [
      ...new Set(names.map((n) => n.trim()).filter(Boolean)),
    ];
    const tagIds: number[] = [];
    for (const name of uniqueNames) {
      await conn.query(
        `INSERT INTO tag (shopId, name) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [ctx.shopId, name],
      );
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM tag WHERE shopId = ? AND name = ?`,
        [ctx.shopId, name],
      );
      tagIds.push(rows[0].id as number);
    }
    return tagIds;
  }

  // Pure classification, no writes — safe to call from preview. Groups raw
  // CSV rows by Handle (blank Handle = its own single-row product, for a
  // merchant that doesn't use variants and never learns the concept
  // exists); the first row of a group carries the product-level fields,
  // subsequent rows are variant sub-rows matched by Variant SKU only.
  //
  // Variant *creation* via CSV isn't supported (would need option/value
  // tree construction — see variant-generator.ts — which is a big enough
  // sub-feature on its own that it's out of scope here): a variant sub-row
  // only ever updates an existing variant matched by SKU. Everything else
  // (simple products, and updating an existing variant-bearing product's
  // own fields) is fully supported.
  private async classifyImportRows(
    ctx: TenantContext,
    rawRows: Record<string, string>[],
  ): Promise<{ results: ImportRowResult[]; groups: ResolvedProductGroup[] }> {
    const results: ImportRowResult[] = [];
    const groups: ResolvedProductGroup[] = [];

    const allCollectionNames = new Set<string>();
    rawRows.forEach((raw) =>
      splitList(raw['Collections'] ?? '').forEach((n) =>
        allCollectionNames.add(n),
      ),
    );
    const collectionRows = allCollectionNames.size
      ? await this.db.query<RowDataPacket[]>(
          `SELECT id, name FROM collection WHERE shopId = ? AND name IN (${[...allCollectionNames].map(() => '?').join(', ')})`,
          [ctx.shopId, ...allCollectionNames],
        )
      : [];
    const collectionIdByName = new Map(
      collectionRows.map((c) => [(c.name as string).toLowerCase(), c.id as number]),
    );

    let autoHandle = 0;
    const byHandle = new Map<
      string,
      { rowNumber: number; raw: Record<string, string> }[]
    >();
    rawRows.forEach((raw, i) => {
      const handle = raw['Handle']?.trim() || `__row_${(autoHandle += 1)}`;
      const list = byHandle.get(handle) ?? [];
      list.push({ rowNumber: i + 2, raw }); // +2: 1-based, plus the header row
      byHandle.set(handle, list);
    });

    const usedNewSkus = new Set<string>();
    const usedVariantSkus = new Set<string>();

    for (const rows of byHandle.values()) {
      const [head, ...variantRows] = rows;
      const raw = head.raw;
      const errors: string[] = [];

      const name = raw['Name']?.trim();
      const sku = raw['SKU']?.trim() || undefined;
      const price = parseImportNumber(raw['Price'] ?? '');
      const compareAtPrice = parseImportNumber(raw['Compare At Price'] ?? '');
      const costPrice = parseImportNumber(raw['Cost Price'] ?? '');
      const stock = parseImportNumber(raw['Stock'] ?? '');
      const trackInventory = parseImportBoolean(raw['Track Inventory'] ?? '');
      const chargeTax = parseImportBoolean(raw['Charge Tax'] ?? '');
      const status = raw['Status']?.trim() || undefined;
      const thumbnail = raw['Thumbnail URL']?.trim() || undefined;
      const collectionNames = splitList(raw['Collections'] ?? '');
      const tagNames = raw['Tags']?.trim() ? splitList(raw['Tags']) : undefined;

      if (!name) errors.push('Name is required');
      if (raw['Price'] && Number.isNaN(price))
        errors.push('Price is not a number');
      if (raw['Compare At Price'] && Number.isNaN(compareAtPrice))
        errors.push('Compare At Price is not a number');
      if (raw['Cost Price'] && Number.isNaN(costPrice))
        errors.push('Cost Price is not a number');
      if (raw['Stock'] && Number.isNaN(stock))
        errors.push('Stock is not a number');
      if (raw['Track Inventory'] && trackInventory === undefined)
        errors.push('Track Inventory must be true/false');
      if (raw['Charge Tax'] && chargeTax === undefined)
        errors.push('Charge Tax must be true/false');
      if (status && !(PRODUCT_STATUSES as readonly string[]).includes(status))
        errors.push(`Unknown status: ${status}`);

      const collectionIds: number[] = [];
      for (const catName of collectionNames) {
        const id = collectionIdByName.get(catName.toLowerCase());
        if (id === undefined) {
          errors.push(`Unknown collection: ${catName}`);
        } else {
          collectionIds.push(id);
        }
      }

      const existingRows = sku
        ? await this.db.query<RowDataPacket[]>(
            `SELECT id, usesIngredients FROM product WHERE shopId = ? AND sku = ?`,
            [ctx.shopId, sku],
          )
        : name
          ? await this.db.query<RowDataPacket[]>(
              `SELECT id, usesIngredients FROM product WHERE shopId = ? AND name = ?`,
              [ctx.shopId, name],
            )
          : [];
      const existing = existingRows[0];
      const action: ImportAction = existing ? 'update' : 'create';

      // A recipe product has no single stock number to absolute-set — see
      // applyImportStock's own comment on why this stays a bespoke
      // absolute-set rather than routing through consumeForOrderItems.
      if (existing?.usesIngredients && raw['Stock']?.trim()) {
        errors.push(
          'This product uses a recipe — set ingredient stock directly instead',
        );
      }

      if (action === 'create') {
        if (!sku) errors.push('SKU is required to create a new product');
        if (price === undefined)
          errors.push('Price is required to create a new product');
        if (!thumbnail)
          errors.push('Thumbnail URL is required to create a new product');
        if (collectionIds.length === 0)
          errors.push(
            'At least one collection is required to create a new product',
          );
        if (sku) {
          if (usedNewSkus.has(sku))
            errors.push(`Duplicate SKU within this file: ${sku}`);
          usedNewSkus.add(sku);
        }
      }

      const finalAction: ImportAction = errors.length > 0 ? 'reject' : action;
      results.push({
        rowNumber: head.rowNumber,
        kind: 'product',
        identifier: sku ?? name ?? `row ${head.rowNumber}`,
        action: finalAction,
        errors,
      });

      const group: ResolvedProductGroup = {
        rowNumber: head.rowNumber,
        action: finalAction,
        productId: existing?.id as number | undefined,
        data: {
          name: name ?? '',
          sku,
          price,
          thumbnail,
          description: raw['Description']?.trim() || undefined,
          barcode: raw['Barcode']?.trim() || undefined,
          compareAtPrice,
          costPrice,
          status: status as ProductStatus | undefined,
          trackInventory,
          chargeTax,
          vendor: raw['Vendor']?.trim() || undefined,
          productType: raw['Product Type']?.trim() || undefined,
          collectionIds: collectionNames.length > 0 ? collectionIds : undefined,
          tagNames,
        },
        stock: variantRows.length === 0 ? stock : undefined,
        variants: [],
      };

      for (const { rowNumber, raw: vraw } of variantRows) {
        const variantSku = vraw['Variant SKU']?.trim();
        const vErrors: string[] = [];
        let variantId: number | undefined;

        if (finalAction === 'reject') {
          vErrors.push('Parent product row was rejected');
        } else if (finalAction === 'create') {
          vErrors.push(
            "Can't attach variants to a new product via CSV import — add the variant in the product editor first, then re-export to update it",
          );
        } else if (!variantSku) {
          vErrors.push('Variant SKU is required');
        } else {
          const foundRows = await this.db.query<RowDataPacket[]>(
            `SELECT pv.id, pv.productId FROM productvariant pv
             JOIN product p ON p.id = pv.productId
             WHERE pv.sku = ? AND p.shopId = ?`,
            [variantSku, ctx.shopId],
          );
          const found = foundRows[0];
          if (!found) {
            vErrors.push(
              'No existing variant with this SKU — creating new variants via CSV import is not supported yet',
            );
          } else if (found.productId !== existing?.id) {
            vErrors.push('This SKU belongs to a different product');
          } else if (usedVariantSkus.has(variantSku)) {
            vErrors.push(
              `Duplicate Variant SKU within this file: ${variantSku}`,
            );
          } else {
            usedVariantSkus.add(variantSku);
            variantId = found.id as number;
          }
        }

        const vPrice = parseImportNumber(vraw['Variant Price'] ?? '');
        const vCompareAtPrice = parseImportNumber(
          vraw['Variant Compare At Price'] ?? '',
        );
        const vStock = parseImportNumber(vraw['Stock'] ?? '');
        if (vraw['Variant Price'] && Number.isNaN(vPrice))
          vErrors.push('Variant Price is not a number');
        if (vraw['Variant Compare At Price'] && Number.isNaN(vCompareAtPrice))
          vErrors.push('Variant Compare At Price is not a number');
        if (vraw['Stock'] && Number.isNaN(vStock))
          vErrors.push('Stock is not a number');
        if (existing?.usesIngredients && vraw['Stock']?.trim()) {
          vErrors.push(
            'This product uses a recipe — set ingredient stock directly instead',
          );
        }

        const variantAction: ImportAction =
          vErrors.length > 0 ? 'reject' : 'update';
        results.push({
          rowNumber,
          kind: 'variant',
          identifier: variantSku ?? `row ${rowNumber}`,
          action: variantAction,
          errors: vErrors,
        });
        group.variants.push({
          rowNumber,
          action: variantAction,
          variantId,
          price: vPrice,
          compareAtPrice: vCompareAtPrice,
          stock: vStock,
        });
      }

      groups.push(group);
    }

    return { results, groups };
  }

  // Maps the CSV contract's `chargeTax` boolean onto this shop's tax classes,
  // the same mapping migration 20260929120000 used for the existing catalog:
  // true -> the shop's default (standard) class, false -> its zero-rated one.
  //
  // Returns null for either side the shop genuinely lacks (a shop whose classes
  // were deleted), which leaves taxClassId NULL and lets B2's shop-default
  // fallback handle it - never an invented class and never a wrong one.
  async resolveChargeTaxClassIds(
    shopId: number,
  ): Promise<{ standard: number | null; zero: number | null }> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, type, isDefault FROM taxclass WHERE shopId = ?`,
      [shopId],
    );
    const zero = rows.find((r) => r.type === 'zero');
    const standard =
      rows.find((r) => r.isDefault === true) ??
      rows.find((r) => r.type === 'standard');
    return {
      standard: standard ? (standard.id as number) : null,
      zero: zero ? (zero.id as number) : null,
    };
  }
}
