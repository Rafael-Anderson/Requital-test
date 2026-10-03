import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { TenantContext } from '../common/tenant-context';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { trimDecimal } from '../database/decimal.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotifySubscriptionsService } from '../notify-subscriptions/notify-subscriptions.service';
import { parseCsv } from '../common/csv.util';
import { sanitizeHtml } from '../common/sanitize-html';
import { ProductBomService } from './product-bom.service';
import { ProductImportService } from './product-import.service';
import {
  MAX_SHOPIFY_ROWS,
  decimalEquals,
  looksLikeShopifyExport,
  mapShopifyRows,
  normalizeDecimal,
  type ShopifyProductIn,
  type ShopifyVariantIn,
} from './shopify-import';

// ONB-1: Shopify product import. This is a COLUMN MAPPER (shopify-import.ts)
// plus a classifier and writer that sit on the same preview/confirm contract the
// Requital CSV import uses: preview is read-only, confirm re-uploads the same
// file and RE-PARSES AND RE-CLASSIFIES it (nothing from a preview is trusted),
// every lookup is scoped by ctx.shopId, stock goes through the shared
// applyImportStock (ledger row per change, outlet validated against the shop).
//
// Images are RECORDED AS URLS ONLY. The existing import never fetches an image
// and neither does this: there is no outbound HTTP in this file, so there is
// nothing to make SSRF-safe. (ONB-5, image fetch-and-store, is a separate job.)

const MAX_DESCRIPTION_LENGTH = 60_000; // product.description is TEXT (65,535 bytes)
const REPORT_PRODUCT_CAP = 1_000;
const IN_CHUNK = 500;

export type ExistingPolicy = 'update' | 'skip';

export interface ShopifyImportOptions {
  collectionId?: number;
  outletId?: number;
  onExisting?: ExistingPolicy;
}

export type ProductImportAction = 'create' | 'update' | 'skip' | 'error';

export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface VariantChange extends FieldChange {
  sku: string;
}

export interface ShopifyProductReport {
  handle: string;
  rowNumber: number;
  name: string;
  action: ProductImportAction;
  reason: string | null;
  changes: FieldChange[];
  variantChanges: VariantChange[];
  variants: {
    total: number;
    toCreate: number;
    toUpdate: number;
    notMatched: number;
  };
  images: { total: number; toAdd: number; urls: string[] };
  stockUpdates: number;
  warnings: string[];
  errors: string[];
}

export interface ShopifyImportReport {
  source: 'shopify';
  currency: string;
  currencyNote: string;
  outletId: number | null;
  collectionId: number | null;
  onExisting: ExistingPolicy;
  totals: {
    products: number;
    create: number;
    update: number;
    skip: number;
    error: number;
    variants: number;
    images: number;
    stockUpdates: number;
  };
  // Errors first, then the rest, capped; the totals are always complete.
  products: ShopifyProductReport[];
  truncated: boolean;
  warnings: string[];
  unsupportedColumns: string[];
}

interface ExistingProduct {
  id: number;
  slug: string;
  sku: string;
  name: string;
  description: string | null;
  price: string;
  compareAtPrice: string | null;
  costPrice: string | null;
  vendor: string | null;
  productType: string | null;
  status: string;
  metaTitle: string | null;
  metaDescription: string | null;
  trackInventory: boolean;
  continueSellingOutOfStock: boolean;
  chargeTax: boolean;
  physicalProduct: boolean;
  weight: string | null;
  usesIngredients: boolean;
}

interface ExistingVariant {
  id: number;
  productId: number;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compareAtPrice: string | null;
  weight: string | null;
}

interface StockTarget {
  quantity: number;
  // Exactly one of these is set: the matched variant, or the product itself
  // (a simple product has its stock on a product-level shadow ingredient).
  variantId?: number;
  productId?: number;
  // The SKU shown beside this target in the diff.
  label?: string;
}

interface Plan {
  product: ShopifyProductIn;
  descriptionHtml: string | null;
  sku: string;
  action: ProductImportAction;
  existing?: ExistingProduct;
  // Update only:
  productSet: Record<string, string | number | boolean | null>;
  tagsToSet: string[] | null;
  newImages: string[];
  variantUpdates: { id: number; set: Record<string, string | null> }[];
  existingVariantIds: number[];
  existingImageCount: number;
  stock: StockTarget[];
  report: ShopifyProductReport;
}

@Injectable()
export class ProductShopifyImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
    private readonly importService: ProductImportService,
    private readonly bom: ProductBomService,
    private readonly notifySubscriptionsService: NotifySubscriptionsService,
  ) {}

  async preview(
    ctx: TenantContext,
    file: Express.Multer.File,
    options: ShopifyImportOptions,
  ): Promise<ShopifyImportReport> {
    const { report } = await this.classify(ctx, file, options);
    return report;
  }

  async confirm(
    ctx: TenantContext,
    file: Express.Multer.File,
    options: ShopifyImportOptions,
  ) {
    // Re-parse and re-classify from the uploaded bytes. Preview output is never
    // an input here.
    const { plans, report } = await this.classify(ctx, file, options);
    const writable = plans.filter(
      (p) => p.action === 'create' || p.action === 'update',
    );
    const taxClassIds = await this.importService.resolveChargeTaxClassIds(
      ctx.shopId,
    );
    const restockTargets: { productId: number; variantId: number | null }[] =
      [];

    try {
      await this.db.transaction(async (conn) => {
        for (const plan of writable) {
          if (plan.action === 'create') {
            await this.createProduct(
              conn,
              ctx,
              plan,
              options,
              taxClassIds,
              restockTargets,
            );
          } else {
            await this.updateProduct(conn, ctx, plan, options, restockTargets);
          }
        }
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A product with the same handle or SKU was created while this import ran. Run the preview again.',
        );
      }
      throw error;
    }

    for (const target of restockTargets) {
      this.notifySubscriptionsService
        .triggerForProduct(
          ctx.shopId,
          target.productId,
          target.variantId ?? undefined,
        )
        .catch(() => {});
    }

    await this.auditLogService.logCtx(ctx, {
      action: 'product.shopify_imported',
      entityType: 'product',
      metadata: {
        created: report.totals.create,
        updated: report.totals.update,
        skipped: report.totals.skip,
        errors: report.totals.error,
        outletId: options.outletId ?? null,
      },
    });

    return {
      created: report.totals.create,
      updated: report.totals.update,
      skipped: report.totals.skip,
      errors: report.totals.error,
      report,
    };
  }

  // ------------------------------------------------------------ classify

  private async classify(
    ctx: TenantContext,
    file: Express.Multer.File,
    options: ShopifyImportOptions,
  ): Promise<{ plans: Plan[]; report: ShopifyImportReport }> {
    const onExisting: ExistingPolicy = options.onExisting ?? 'update';

    // Validate every client-supplied id against THIS shop before anything else.
    if (options.collectionId !== undefined) {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM collection WHERE id = ? AND shopId = ?`,
        [options.collectionId, ctx.shopId],
      );
      if (rows.length === 0) {
        throw new BadRequestException('collectionId is invalid for this shop');
      }
    }
    if (options.outletId !== undefined) {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
        [options.outletId, ctx.shopId],
      );
      if (rows.length === 0) {
        throw new BadRequestException('outletId is invalid for this shop');
      }
    }

    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT currency FROM shop WHERE id = ?`,
      [ctx.shopId],
    );
    const currency = (shopRows[0]?.currency as string | undefined) ?? '';

    const rows = parseCsv(file.buffer.toString('utf-8'));
    if (rows.length === 0)
      throw new BadRequestException('The file has no product rows');
    if (rows.length > MAX_SHOPIFY_ROWS) {
      throw new BadRequestException(
        `A Shopify import can have at most ${MAX_SHOPIFY_ROWS} rows`,
      );
    }
    const headers = Object.keys(rows[0]);
    if (!looksLikeShopifyExport(headers)) {
      throw new BadRequestException(
        'This does not look like a Shopify product export (it needs at least Handle and Title columns)',
      );
    }
    const mapped = mapShopifyRows(rows, headers);

    const handles = mapped.products.map((p) => p.handle);
    const firstSkus = mapped.products
      .map((p) => p.variants[0]?.sku)
      .filter((s): s is string => typeof s === 'string' && s !== '');
    const bySlug = await this.loadExistingBy('slug', handles, ctx.shopId);
    const bySku = await this.loadExistingBy('sku', firstSkus, ctx.shopId);
    // Fallback SKUs (taken from the handle) must not collide with another product.
    const bySkuForFallback = await this.loadExistingBy(
      'sku',
      handles,
      ctx.shopId,
    );

    const existingIds = [
      ...new Set([...bySlug.values(), ...bySku.values()].map((p) => p.id)),
    ];
    const [tagsByProduct, variantsByProduct, imagesByProduct] =
      await Promise.all([
        this.loadTags(existingIds),
        this.loadVariants(existingIds),
        this.loadImageUrls(existingIds),
      ]);

    const plans: Plan[] = [];
    const usedNewSkus = new Map<string, string>();
    for (const product of mapped.products) {
      plans.push(
        this.planProduct(product, {
          options,
          onExisting,
          bySlug,
          bySku,
          bySkuForFallback,
          tagsByProduct,
          variantsByProduct,
          imagesByProduct,
          usedNewSkus,
        }),
      );
    }

    await this.dropUnchangedStock(plans, options.outletId);

    const warnings = [
      ...mapped.warnings,
      ...mapped.rowIssues.map((i) => `Row ${i.rowNumber}: ${i.message}`),
    ];
    if (mapped.unsupportedColumns.length > 0) {
      warnings.push(
        `These columns have data but are not imported: ${mapped.unsupportedColumns.join(', ')}.`,
      );
    }
    if (
      options.outletId === undefined &&
      mapped.products.some((p) => p.variants.some((v) => v.quantity !== null))
    ) {
      warnings.push(
        'No outlet was chosen, so stock quantities were not imported. Choose an outlet to import them.',
      );
    }

    const reports = plans.map((p) => p.report);
    const ordered = [
      ...reports.filter((r) => r.action === 'error'),
      ...reports.filter((r) => r.action !== 'error'),
    ];
    const count = (action: ProductImportAction) =>
      reports.filter((r) => r.action === action).length;
    const report: ShopifyImportReport = {
      source: 'shopify',
      currency,
      currencyNote: `Prices are imported exactly as exported and are read as ${currency || 'your shop currency'}. A Shopify export has no currency column.`,
      outletId: options.outletId ?? null,
      collectionId: options.collectionId ?? null,
      onExisting,
      totals: {
        products: reports.length,
        create: count('create'),
        update: count('update'),
        skip: count('skip'),
        error: count('error'),
        variants: reports.reduce((n, r) => n + r.variants.total, 0),
        images: reports.reduce((n, r) => n + r.images.total, 0),
        stockUpdates: reports.reduce((n, r) => n + r.stockUpdates, 0),
      },
      products: ordered.slice(0, REPORT_PRODUCT_CAP),
      truncated: ordered.length > REPORT_PRODUCT_CAP,
      warnings,
      unsupportedColumns: mapped.unsupportedColumns,
    };
    return { plans, report };
  }

  private planProduct(
    product: ShopifyProductIn,
    ctx: {
      options: ShopifyImportOptions;
      onExisting: ExistingPolicy;
      bySlug: Map<string, ExistingProduct>;
      bySku: Map<string, ExistingProduct>;
      bySkuForFallback: Map<string, ExistingProduct>;
      tagsByProduct: Map<number, string[]>;
      variantsByProduct: Map<number, ExistingVariant[]>;
      imagesByProduct: Map<number, string[]>;
      usedNewSkus: Map<string, string>;
    },
  ): Plan {
    const errors = [...product.errors];
    const warnings = [...product.warnings];
    const first: ShopifyVariantIn | undefined = product.variants[0];

    // Body HTML is cleaned BEFORE it is stored. The raw text never reaches the
    // database or the preview.
    let descriptionHtml: string | null = null;
    if (product.bodyHtml) {
      const cleaned = sanitizeHtml(product.bodyHtml);
      descriptionHtml = cleaned.html.trim() === '' ? null : cleaned.html;
      if (cleaned.removedTags.length > 0) {
        warnings.push(
          `Description: unsupported HTML was removed (${cleaned.removedTags.map((t) => `<${t}>`).join(', ')})`,
        );
      }
      if (
        descriptionHtml !== null &&
        descriptionHtml.length > MAX_DESCRIPTION_LENGTH
      ) {
        errors.push(
          `Description is longer than ${MAX_DESCRIPTION_LENGTH} characters after cleaning`,
        );
      }
    }

    const slugMatch = ctx.bySlug.get(product.handle);
    const skuMatch = first?.sku ? ctx.bySku.get(first.sku) : undefined;
    if (slugMatch && skuMatch && slugMatch.id !== skuMatch.id) {
      errors.push(
        `The handle matches "${slugMatch.name}" but the SKU ${first?.sku} matches "${skuMatch.name}". They are different products.`,
      );
    }
    const existing = slugMatch ?? skuMatch;
    const sku = first?.sku ?? product.handle;

    const plan: Plan = {
      product,
      descriptionHtml,
      sku,
      action: 'error',
      existing,
      productSet: {},
      tagsToSet: null,
      newImages: [],
      variantUpdates: [],
      existingVariantIds: [],
      existingImageCount: 0,
      stock: [],
      report: {
        handle: product.handle,
        rowNumber: product.rowNumber,
        name: product.title,
        action: 'error',
        reason: null,
        changes: [],
        variantChanges: [],
        variants: {
          total: product.variants.length,
          toCreate: 0,
          toUpdate: 0,
          notMatched: 0,
        },
        images: {
          total: product.images.length,
          toAdd: 0,
          urls: product.images.slice(0, 10).map((i) => i.url),
        },
        stockUpdates: 0,
        warnings,
        errors,
      },
    };

    const canStock = ctx.options.outletId !== undefined;
    if (!existing) {
      if (!first?.sku) {
        warnings.push(
          `No Variant SKU in the file, so the handle "${product.handle}" is used as the SKU`,
        );
      }
      const clash = ctx.bySkuForFallback.get(sku) ?? ctx.bySku.get(sku);
      if (clash) {
        errors.push(
          `SKU "${sku}" is already used by "${clash.name}". Add a Variant SKU to this product in the file.`,
        );
      }
      const other = ctx.usedNewSkus.get(sku);
      if (other)
        errors.push(`SKU "${sku}" is also the SKU of "${other}" in this file`);
      else ctx.usedNewSkus.set(sku, product.handle);

      if (ctx.options.collectionId === undefined) {
        errors.push('Choose a collection to put new products in');
      }
      if (product.images.length === 0) {
        errors.push(
          'At least one valid Image Src is required to create a product',
        );
      }
      plan.report.variants.toCreate = product.variants.length;
      plan.report.images.toAdd = product.images.length;
      if (canStock) {
        for (const v of product.variants) {
          if (v.tracked && v.quantity !== null) {
            plan.stock.push({ quantity: v.quantity });
          }
        }
        plan.report.stockUpdates = plan.stock.length;
      }
      if (errors.length > 0) {
        plan.action = 'error';
        plan.report.action = 'error';
        return plan;
      }
      plan.action = 'create';
      plan.report.action = 'create';
      return plan;
    }

    // ---- existing product: update or skip ----
    plan.report.name = product.title || existing.name;
    if (errors.length > 0) {
      plan.action = 'error';
      plan.report.action = 'error';
      return plan;
    }
    if (ctx.onExisting === 'skip') {
      return this.finishSkip(plan, 'Already exists, kept as it is');
    }
    this.diffExisting(plan, existing, ctx);
    plan.report.variants.toCreate = 0;
    const hasWork =
      plan.report.changes.length > 0 ||
      plan.report.variantChanges.length > 0 ||
      plan.newImages.length > 0 ||
      plan.stock.length > 0;
    if (!hasWork) return this.finishSkip(plan, 'No changes');
    plan.action = 'update';
    plan.report.action = 'update';
    return plan;
  }

  // Re-importing the same file must be a no-op: a stock target equal to what
  // the outlet already holds is dropped, and the ones that remain are reported
  // as Stock changes with their current value. A missing stock row counts as 0
  // (that is what applyImportStock reads for it too).
  private async dropUnchangedStock(
    plans: Plan[],
    outletId: number | undefined,
  ) {
    if (outletId === undefined) return;
    const variantIds = new Set<number>();
    const productIds = new Set<number>();
    for (const plan of plans) {
      if (plan.action !== 'update') continue;
      for (const t of plan.stock) {
        if (t.variantId !== undefined) variantIds.add(t.variantId);
        if (t.productId !== undefined) productIds.add(t.productId);
      }
    }
    const current = new Map<string, number>();
    const load = async (
      column: 'shadowVariantId' | 'shadowProductId',
      ids: number[],
      prefix: string,
    ) => {
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const chunk = ids.slice(i, i + IN_CHUNK);
        const rows = await this.db.query<RowDataPacket[]>(
          `SELECT i.\`${column}\` AS ref, s.stockQuantity
           FROM ingredient i
           LEFT JOIN outletingredientstock s ON s.ingredientId = i.id AND s.outletId = ?
           WHERE i.\`${column}\` IN (${chunk.map(() => '?').join(', ')})`,
          [outletId, ...chunk],
        );
        for (const r of rows) {
          current.set(
            `${prefix}${r.ref as number}`,
            Number(r.stockQuantity ?? 0),
          );
        }
      }
    };
    await load('shadowVariantId', [...variantIds], 'v');
    await load('shadowProductId', [...productIds], 'p');

    for (const plan of plans) {
      if (plan.action !== 'update') continue;
      const kept: StockTarget[] = [];
      for (const t of plan.stock) {
        const key =
          t.variantId !== undefined ? `v${t.variantId}` : `p${t.productId}`;
        const from = current.get(key) ?? 0;
        if (from === t.quantity) continue;
        kept.push(t);
        plan.report.variantChanges.push({
          sku: t.label ?? plan.sku,
          field: 'Stock',
          from: String(from),
          to: String(t.quantity),
        });
      }
      plan.stock = kept;
      plan.report.stockUpdates = kept.length;
      if (
        plan.report.changes.length === 0 &&
        plan.report.variantChanges.length === 0 &&
        plan.newImages.length === 0
      ) {
        this.finishSkip(plan, 'No changes');
      }
    }
  }

  private finishSkip(plan: Plan, reason: string): Plan {
    plan.action = 'skip';
    plan.report.action = 'skip';
    plan.report.reason = reason;
    plan.productSet = {};
    plan.tagsToSet = null;
    plan.newImages = [];
    plan.variantUpdates = [];
    plan.stock = [];
    plan.report.changes = [];
    plan.report.variantChanges = [];
    plan.report.stockUpdates = 0;
    plan.report.images.toAdd = 0;
    return plan;
  }

  private diffExisting(
    plan: Plan,
    existing: ExistingProduct,
    ctx: {
      options: ShopifyImportOptions;
      tagsByProduct: Map<number, string[]>;
      variantsByProduct: Map<number, ExistingVariant[]>;
      imagesByProduct: Map<number, string[]>;
    },
  ) {
    const product = plan.product;
    const first = product.variants[0];
    const changes = plan.report.changes;
    const set = plan.productSet;
    const warnings = plan.report.warnings;

    const text = (
      field: string,
      column: string,
      from: string | null,
      to: string | null,
    ) => {
      if (to === null || to === from) return;
      changes.push({ field, from, to });
      set[column] = to;
    };
    const money = (
      field: string,
      column: string,
      from: string | null,
      to: string | null,
    ) => {
      if (to === null) return;
      const current = from === null ? null : trimDecimal(from);
      if (decimalEquals(current, to)) return;
      changes.push({ field, from: current, to: normalizeDecimal(to) });
      set[column] = to;
    };
    const flag = (
      field: string,
      column: string,
      from: boolean,
      to: boolean | null,
    ) => {
      if (to === null || to === from) return;
      changes.push({ field, from: String(from), to: String(to) });
      set[column] = to;
    };

    text('Title', 'name', existing.name, product.title || null);
    text(
      'Description',
      'description',
      existing.description,
      plan.descriptionHtml,
    );
    text('Vendor', 'vendor', existing.vendor, product.vendor);
    text('Type', 'productType', existing.productType, product.productType);
    text('Status', 'status', existing.status, product.status);
    text('SEO Title', 'metaTitle', existing.metaTitle, product.seoTitle);
    text(
      'SEO Description',
      'metaDescription',
      existing.metaDescription,
      product.seoDescription,
    );
    if (first) {
      money('Price', 'price', existing.price, first.price);
      money(
        'Compare at price',
        'compareAtPrice',
        existing.compareAtPrice,
        first.compareAtPrice,
      );
      money('Cost per item', 'costPrice', existing.costPrice, first.cost);
      money('Weight (kg)', 'weight', existing.weight, first.weightKg);
      flag(
        'Track inventory',
        'trackInventory',
        existing.trackInventory,
        first.tracked,
      );
      flag(
        'Continue selling when out of stock',
        'continueSellingOutOfStock',
        existing.continueSellingOutOfStock,
        first.continueSelling,
      );
      flag('Charge tax', 'chargeTax', existing.chargeTax, first.taxable);
      flag(
        'Physical product',
        'physicalProduct',
        existing.physicalProduct,
        first.requiresShipping,
      );
    }

    const currentTags = ctx.tagsByProduct.get(existing.id) ?? [];
    if (product.tags.length > 0) {
      const same =
        currentTags.length === product.tags.length &&
        currentTags.every((t) =>
          product.tags.some((n) => n.toLowerCase() === t.toLowerCase()),
        );
      if (!same) {
        changes.push({
          field: 'Tags',
          from: currentTags.join(', ') || null,
          to: product.tags.join(', '),
        });
        plan.tagsToSet = product.tags;
      }
    }

    // Images: URLs the product does not already have are added; none removed.
    const have = new Set(ctx.imagesByProduct.get(existing.id) ?? []);
    plan.existingImageCount = have.size;
    plan.newImages = product.images
      .map((i) => i.url)
      .filter((u) => !have.has(u));
    plan.report.images.toAdd = plan.newImages.length;

    // Variants are matched to existing ones by SKU. Creating a NEW variant on an
    // existing product is not supported (that needs the option tree rebuilt in
    // the product editor), same limit as the Requital CSV import.
    const existingVariants = ctx.variantsByProduct.get(existing.id) ?? [];
    plan.existingVariantIds = existingVariants.map((v) => v.id);
    const bySku = new Map(
      existingVariants.filter((v) => v.sku).map((v) => [v.sku as string, v]),
    );
    const simple = existingVariants.length === 0;
    let toUpdate = 0;
    let notMatched = 0;
    for (const v of product.variants) {
      if (simple) {
        if (product.variants.length === 1) {
          toUpdate += 1;
          if (
            v.tracked &&
            v.quantity !== null &&
            ctx.options.outletId !== undefined
          ) {
            this.addStock(plan, existing, {
              quantity: v.quantity,
              productId: existing.id,
              label: v.sku ?? existing.sku,
            });
          }
        } else {
          notMatched += 1;
        }
        continue;
      }
      const match = v.sku ? bySku.get(v.sku) : undefined;
      if (!match) {
        notMatched += 1;
        continue;
      }
      toUpdate += 1;
      const set2: Record<string, string | null> = {};
      const sku = v.sku as string;
      const vMoney = (
        field: string,
        column: string,
        from: string | null,
        to: string | null,
      ) => {
        if (to === null) return;
        const current = from === null ? null : trimDecimal(from);
        if (decimalEquals(current, to)) return;
        plan.report.variantChanges.push({
          sku,
          field,
          from: current,
          to: normalizeDecimal(to),
        });
        set2[column] = to;
      };
      vMoney('Price', 'price', match.price, v.price);
      vMoney(
        'Compare at price',
        'compareAtPrice',
        match.compareAtPrice,
        v.compareAtPrice,
      );
      vMoney('Weight (kg)', 'weight', match.weight, v.weightKg);
      if (v.barcode !== null && v.barcode !== match.barcode) {
        plan.report.variantChanges.push({
          sku,
          field: 'Barcode',
          from: match.barcode,
          to: v.barcode,
        });
        set2['barcode'] = v.barcode;
      }
      if (Object.keys(set2).length > 0)
        plan.variantUpdates.push({ id: match.id, set: set2 });
      if (
        v.tracked &&
        v.quantity !== null &&
        ctx.options.outletId !== undefined
      ) {
        this.addStock(plan, existing, {
          quantity: v.quantity,
          variantId: match.id,
          label: sku,
        });
      }
    }
    plan.report.variants.toUpdate = toUpdate;
    plan.report.variants.notMatched = notMatched;
    if (notMatched > 0) {
      warnings.push(
        `${notMatched} variant(s) are not in Requital under that SKU. New variants cannot be added to an existing product by import, so they were left out.`,
      );
    }
    plan.report.stockUpdates = plan.stock.length;
  }

  private addStock(plan: Plan, existing: ExistingProduct, target: StockTarget) {
    // A recipe product has no single stock number: same rule as the Requital CSV import.
    if (existing.usesIngredients) {
      if (
        !plan.report.warnings.some((w) =>
          w.startsWith('This product uses a recipe'),
        )
      ) {
        plan.report.warnings.push(
          'This product uses a recipe, so its stock quantity was not imported. Set ingredient stock directly.',
        );
      }
      return;
    }
    plan.stock.push(target);
  }

  // ------------------------------------------------------------ lookups

  private async loadExistingBy(
    column: 'slug' | 'sku',
    values: string[],
    shopId: number,
  ): Promise<Map<string, ExistingProduct>> {
    const out = new Map<string, ExistingProduct>();
    const unique = [...new Set(values)].filter(Boolean);
    for (let i = 0; i < unique.length; i += IN_CHUNK) {
      const chunk = unique.slice(i, i + IN_CHUNK);
      const found = await this.db.query<(ExistingProduct & RowDataPacket)[]>(
        `SELECT id, slug, sku, name, description, price, compareAtPrice, costPrice, vendor, productType,
                status, metaTitle, metaDescription, trackInventory, continueSellingOutOfStock,
                chargeTax, physicalProduct, weight, usesIngredients
         FROM product WHERE shopId = ? AND \`${column}\` IN (${chunk.map(() => '?').join(', ')})`,
        [shopId, ...chunk],
      );
      for (const row of found) out.set(row[column], row);
    }
    return out;
  }

  private async loadTags(productIds: number[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    for (let i = 0; i < productIds.length; i += IN_CHUNK) {
      const chunk = productIds.slice(i, i + IN_CHUNK);
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT pt.productId, t.name FROM producttag pt JOIN tag t ON t.id = pt.tagId
         WHERE pt.productId IN (${chunk.map(() => '?').join(', ')})`,
        chunk,
      );
      for (const r of rows) {
        const list = out.get(r.productId as number) ?? [];
        list.push(r.name as string);
        out.set(r.productId as number, list);
      }
    }
    return out;
  }

  private async loadVariants(
    productIds: number[],
  ): Promise<Map<number, ExistingVariant[]>> {
    const out = new Map<number, ExistingVariant[]>();
    for (let i = 0; i < productIds.length; i += IN_CHUNK) {
      const chunk = productIds.slice(i, i + IN_CHUNK);
      const rows = await this.db.query<(ExistingVariant & RowDataPacket)[]>(
        `SELECT id, productId, sku, barcode, price, compareAtPrice, weight FROM productvariant
         WHERE productId IN (${chunk.map(() => '?').join(', ')})`,
        chunk,
      );
      for (const r of rows) {
        const list = out.get(r.productId) ?? [];
        list.push(r);
        out.set(r.productId, list);
      }
    }
    return out;
  }

  private async loadImageUrls(
    productIds: number[],
  ): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    for (let i = 0; i < productIds.length; i += IN_CHUNK) {
      const chunk = productIds.slice(i, i + IN_CHUNK);
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT productId, url FROM productimage WHERE productId IN (${chunk.map(() => '?').join(', ')})`,
        chunk,
      );
      for (const r of rows) {
        const list = out.get(r.productId as number) ?? [];
        list.push(r.url as string);
        out.set(r.productId as number, list);
      }
    }
    return out;
  }

  // ------------------------------------------------------------- writes

  private async createProduct(
    conn: PoolConnection,
    ctx: TenantContext,
    plan: Plan,
    options: ShopifyImportOptions,
    taxClassIds: { standard: number | null; zero: number | null },
    restockTargets: { productId: number; variantId: number | null }[],
  ) {
    const p = plan.product;
    const first = p.variants[0];
    const chargeTax = first.taxable ?? true;
    const thumbnail = p.images[0].url;
    const hasOptions = p.optionNames.length > 0;

    const [result] = await conn.query(
      `INSERT INTO product (
         shopId, name, price, compareAtPrice, costPrice, thumbnail, sku, barcode, slug,
         metaTitle, metaDescription, description, vendor, productType, status,
         trackInventory, continueSellingOutOfStock, chargeTax, taxClassId,
         physicalProduct, weight, weightUnit, showVariants
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.shopId,
        p.title,
        first.price,
        first.compareAtPrice,
        first.cost,
        thumbnail,
        plan.sku,
        first.barcode,
        p.handle,
        p.seoTitle,
        p.seoDescription,
        plan.descriptionHtml,
        p.vendor,
        p.productType,
        p.status,
        first.tracked,
        first.continueSelling,
        chargeTax,
        chargeTax ? taxClassIds.standard : taxClassIds.zero,
        first.requiresShipping ?? true,
        first.weightKg,
        'kg',
        hasOptions,
      ],
    );
    const productId = (result as { insertId: number }).insertId;

    const imageIdByUrl = new Map<string, number>();
    for (let i = 0; i < p.images.length; i += 1) {
      const [img] = await conn.query(
        `INSERT INTO productimage (productId, url, \`order\`) VALUES (?, ?, ?)`,
        [productId, p.images[i].url, i],
      );
      imageIdByUrl.set(p.images[i].url, (img as { insertId: number }).insertId);
    }

    await conn.query(
      `INSERT INTO productcollection (productId, collectionId) VALUES (?, ?)`,
      [productId, options.collectionId!],
    );
    if (p.tags.length > 0) {
      const tagIds = await this.importService.resolveTagIdsTx(
        conn,
        ctx,
        p.tags,
      );
      if (tagIds.length > 0) {
        await conn.query(
          `INSERT INTO producttag (productId, tagId) VALUES ${tagIds.map(() => '(?, ?)').join(', ')}`,
          tagIds.flatMap((tagId) => [productId, tagId]),
        );
      }
    }

    const shadowMeta = (cost: string | null) => ({
      name: p.title,
      thumbnail,
      trackInventory: first.tracked,
      costPrice: cost,
    });

    if (!hasOptions) {
      await this.bom.provisionShadowForProduct(
        conn,
        ctx,
        productId,
        shadowMeta(first.cost),
      );
      for (const target of plan.stock) {
        await this.applyStock(
          conn,
          ctx,
          options.outletId!,
          { ...target, productId },
          restockTargets,
          productId,
        );
      }
      return;
    }

    // Options and exactly the variants the file lists (not the cartesian
    // product): a Shopify store need not sell every combination.
    const valueIds: Map<string, number>[] = [];
    for (let i = 0; i < p.optionNames.length; i += 1) {
      const [opt] = await conn.query(
        `INSERT INTO productoption (productId, name, \`order\`) VALUES (?, ?, ?)`,
        [productId, p.optionNames[i], i],
      );
      const optionId = (opt as { insertId: number }).insertId;
      const ids = new Map<string, number>();
      for (const v of p.variants) {
        const value = v.optionValues[i];
        const key = value.toLowerCase();
        if (ids.has(key)) continue;
        const [val] = await conn.query(
          `INSERT INTO productoptionvalue (optionId, value, \`order\`) VALUES (?, ?, ?)`,
          [optionId, value, ids.size],
        );
        ids.set(key, (val as { insertId: number }).insertId);
      }
      valueIds.push(ids);
    }

    let order = 0;
    for (const v of p.variants) {
      const optionValueIds = p.optionNames.map((_, i) =>
        valueIds[i].get(v.optionValues[i].toLowerCase())!,
      );
      const [variantResult] = await conn.query(
        `INSERT INTO productvariant
           (productId, optionValue1Id, optionValue2Id, optionValue3Id, \`order\`, price, compareAtPrice, weight, sku, barcode, imageId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          productId,
          optionValueIds[0] ?? null,
          optionValueIds[1] ?? null,
          optionValueIds[2] ?? null,
          order,
          v.price,
          v.compareAtPrice,
          v.weightKg,
          v.sku,
          v.barcode,
          v.imageUrl ? (imageIdByUrl.get(v.imageUrl) ?? null) : null,
        ],
      );
      order += 1;
      const variantId = (variantResult as { insertId: number }).insertId;
      await this.bom.provisionShadowForVariant(
        conn,
        ctx,
        productId,
        variantId,
        shadowMeta(v.cost),
      );
      if (v.tracked && v.quantity !== null && options.outletId !== undefined) {
        await this.applyStock(
          conn,
          ctx,
          options.outletId,
          { quantity: v.quantity, variantId },
          restockTargets,
          productId,
        );
      }
    }
  }

  private async updateProduct(
    conn: PoolConnection,
    ctx: TenantContext,
    plan: Plan,
    options: ShopifyImportOptions,
    restockTargets: { productId: number; variantId: number | null }[],
  ) {
    const existing = plan.existing!;
    const productId = existing.id;

    if (plan.tagsToSet) {
      const tagIds = await this.importService.resolveTagIdsTx(
        conn,
        ctx,
        plan.tagsToSet,
      );
      await conn.query(`DELETE FROM producttag WHERE productId = ?`, [
        productId,
      ]);
      if (tagIds.length > 0) {
        await conn.query(
          `INSERT INTO producttag (productId, tagId) VALUES ${tagIds.map(() => '(?, ?)').join(', ')}`,
          tagIds.flatMap((tagId) => [productId, tagId]),
        );
      }
    }

    const set = buildSetClause(plan.productSet);
    if (set) {
      await conn.query(
        `UPDATE product SET ${set.setClause} WHERE id = ? AND shopId = ?`,
        [...set.params, productId, ctx.shopId],
      );
      const shadow = {
        name: plan.productSet['name'] as string | undefined,
        trackInventory: plan.productSet['trackInventory'] as
          boolean | undefined,
        costPrice: plan.productSet['costPrice'] as string | undefined,
      };
      // No-op for a variant-carrying or recipe product (no matching shadow).
      await this.bom.syncShadowMeta(
        conn,
        { shadowProductId: productId },
        shadow,
      );
      if (plan.existingVariantIds.length > 0) {
        await this.bom.syncShadowMeta(
          conn,
          { shadowVariantIdIn: plan.existingVariantIds },
          { name: shadow.name, trackInventory: shadow.trackInventory },
        );
      }
    }

    let order = plan.existingImageCount;
    for (const url of plan.newImages) {
      await conn.query(
        `INSERT INTO productimage (productId, url, \`order\`) VALUES (?, ?, ?)`,
        [productId, url, order],
      );
      order += 1;
    }

    for (const update of plan.variantUpdates) {
      const variantSet = buildSetClause(update.set);
      if (!variantSet) continue;
      // productId in the WHERE keeps the write inside the product just matched
      // for this shop.
      await conn.query(
        `UPDATE productvariant SET ${variantSet.setClause} WHERE id = ? AND productId = ?`,
        [...variantSet.params, update.id, productId],
      );
    }

    for (const target of plan.stock) {
      await this.applyStock(
        conn,
        ctx,
        options.outletId!,
        target,
        restockTargets,
        productId,
      );
    }
  }

  private async applyStock(
    conn: PoolConnection,
    ctx: TenantContext,
    outletId: number,
    target: StockTarget,
    restockTargets: { productId: number; variantId: number | null }[],
    productId: number,
  ) {
    const { crossedToPositive } = await this.importService.applyImportStock(
      conn,
      ctx,
      {
        outletId,
        productId,
        variantId: target.variantId,
        stock: target.quantity,
      },
    );
    if (crossedToPositive) {
      restockTargets.push({ productId, variantId: target.variantId ?? null });
    }
  }
}
