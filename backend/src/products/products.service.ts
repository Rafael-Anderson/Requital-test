import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService, type QueryParam } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { buildSetClause } from '../database/update.util';
import { upsert } from '../database/upsert.util';
import { trimDecimal } from '../database/decimal.util';
import type { PoolConnection, Pool, RowDataPacket } from 'mysql2/promise';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { slugify } from '../common/slugify';
import { CreateProductDto, ProductImageInput } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductAvailabilityDto } from './dto/update-product-availability.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TransferStockDto } from './dto/transfer-stock.dto';
import { AdjustStockWithReasonDto } from './dto/adjust-stock-with-reason.dto';
import { SetLowStockThresholdDto } from './dto/set-low-stock-threshold.dto';
import { ListStockMovementsQueryDto } from './dto/list-stock-movements-query.dto';
import { BulkProductIdsDto } from './dto/bulk-product-ids.dto';
import { BulkUpdateProductStatusDto } from './dto/bulk-update-product-status.dto';
import { BulkPriceUpdateDto } from './dto/bulk-price-update.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { UpdateProductOptionsDto } from './dto/update-product-options.dto';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { NotifySubscriptionsService } from '../notify-subscriptions/notify-subscriptions.service';
import { DiscountsService } from '../discounts/discounts.service';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { ProductIngredientInput } from './dto/product-ingredient-input.dto';
import {
  MAX_PRODUCT_OPTIONS,
  MAX_VARIANTS_PER_PRODUCT,
  buildVariantLabel,
  comboKey,
  generateVariantCombinations,
} from './variant-generator';
import { PRODUCT_STATUSES, ProductStatus } from './dto/create-product.dto';
import { parseCsv } from '../common/csv.util';
import {
  ImportAction,
  ImportRowResult,
  parseImportBoolean,
  parseImportNumber,
  splitList,
} from './products-import';

interface BrandLiteRow extends RowDataPacket {
  id: number;
  name: string;
  logoUrl: string | null;
}

interface IngredientLinkRow extends RowDataPacket {
  id: number;
  productId: number;
  variantId: number | null;
  ingredientId: number;
  quantityPerUnit: number;
  ingredientName: string;
  ingredientUnit: string;
  ingredientTrackInventory: boolean;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
}

interface VariantRow extends RowDataPacket {
  id: number;
  productId: number;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compareAtPrice: string | null;
  weight: string | null;
  imageId: number | null;
  imageUrl: string | null;
  order: number;
  optionValue1Id: number | null;
  optionValue1Value: string | null;
  optionValue2Id: number | null;
  optionValue2Value: string | null;
  optionValue3Id: number | null;
  optionValue3Value: string | null;
  createdAt: Date;
}

interface AssembledIngredientLink {
  id: number;
  productId: number;
  variantId: number | null;
  ingredientId: number;
  quantityPerUnit: number;
  ingredient: {
    name: string;
    unit: string;
    trackInventory: boolean;
    outletingredientstock?: { stockQuantity: number; lowStockThreshold: number | null }[];
  };
}

interface AssembledVariant {
  id: number;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compareAtPrice: string | null;
  weight: string | null;
  imageId: number | null;
  image: { url: string } | null;
  order: number;
  optionValue1Id: number | null;
  optionValue1: { value: string } | null;
  optionValue2Id: number | null;
  optionValue2: { value: string } | null;
  optionValue3Id: number | null;
  optionValue3: { value: string } | null;
  productingredient: AssembledIngredientLink[];
}

interface AssembledProduct {
  [key: string]: unknown;
  id: number;
  shopId: number;
  name: string;
  price: string;
  compareAtPrice: string | null;
  thumbnail: string;
  sku: string;
  status: string;
  usesIngredients: boolean;
  brandId: number | null;
  brand: { id: number; name: string; logoUrl: string | null } | null;
  productcollection: { collection: RowDataPacket }[];
  producttag: { tag: { name: string } }[];
  productimage: { id: number; url: string; order: number }[];
  productattribute: { id: number; name: string; value: string; order: number }[];
  productfaq: { id: number; question: string; answer: string; order: number }[];
  productoption: {
    id: number;
    name: string;
    order: number;
    productoptionvalue: { id: number; value: string; order: number }[];
  }[];
  productvariant: AssembledVariant[];
  productingredient: AssembledIngredientLink[];
}

interface UnitsSoldRow extends RowDataPacket {
  productId: number;
  unitsSold: string | null;
}

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

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
    private readonly branchRolesService: BranchRolesService,
    private readonly notifySubscriptionsService: NotifySubscriptionsService,
    private readonly discountsService: DiscountsService,
  ) {}

  async findAll(ctx: TenantContext, requestedOutletId?: number) {
    const outletId = resolveOutletFilter(ctx, requestedOutletId);
    // Products are shop-wide catalog — outletId here is only which
    // outlet's stock count to attach, not ownership, so this uses the
    // filter variable (skipped when undefined) same as Ingredients, not a
    // fetched resource's "real" outlet.
    if (outletId !== undefined) {
      await this.branchRolesService.assertPermission(
        ctx,
        outletId,
        'products.view',
      );
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM product WHERE shopId = ? ORDER BY id ASC`,
      [ctx.shopId],
    );
    const ids = rows.map((r) => r.id as number);
    const products = await this.loadProductsWithRelations(ids, outletId);
    const soldByProduct = await this.getUnitsSoldByProduct(ctx.shopId, ids);
    return ids.map((id) =>
      this.toResponse(products.get(id)!, soldByProduct.get(id) ?? 0),
    );
  }

  async findOne(
    ctx: TenantContext,
    id: number,
    requestedOutletId?: number,
    allOutlets?: boolean,
  ) {
    const outletId = resolveOutletFilter(ctx, requestedOutletId);
    if (outletId !== undefined) {
      await this.branchRolesService.assertPermission(
        ctx,
        outletId,
        'products.view',
      );
    }
    const ownRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM product WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (ownRows.length === 0) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    const products = await this.loadProductsWithRelations([id], outletId);
    const response = this.toResponse(products.get(id)!);
    if (allOutlets) {
      await this.attachOutletStockBreakdown(ctx.shopId, response);
    }
    return response;
  }

  async create(ctx: TenantContext, dto: CreateProductDto) {
    await this.assertCollectionsBelongToShop(ctx, dto.collectionIds);
    if (dto.brandId != null) {
      await this.assertBrandBelongsToShop(ctx, dto.brandId);
    }
    // Inferred, not just defaulted to false, when the caller doesn't touch
    // this field at all: submitting a non-empty `ingredients` array without
    // ever mentioning `usesIngredients` is exactly what every pre-Phase-A
    // caller (and every existing BOM e2e fixture) does, and it has to keep
    // meaning "this product has a recipe" — an explicit `usesIngredients`
    // always wins over the inference either way.
    const usesIngredients =
      dto.usesIngredients ?? (dto.ingredients?.length ?? 0) > 0;
    if (usesIngredients && !dto.ingredients?.length) {
      throw new BadRequestException(
        'A product using a recipe needs at least one ingredient',
      );
    }
    if (dto.ingredients) {
      await this.assertIngredientLinksValid(ctx, dto.ingredients);
    }
    const tagIds = dto.tags?.length
      ? await this.resolveTagIds(ctx, dto.tags)
      : [];
    // An explicit slug is taken as-is (validated for collision by the DB
    // unique constraint below, same as sku); an omitted one is
    // auto-disambiguated up front so two products named "Chocolate Cake" in
    // the same shop don't collide — see resolveUniqueSlug.
    const slug =
      dto.slug ?? (await this.resolveUniqueSlug(ctx.shopId, dto.name));
    const thumbnail = this.resolveFeaturedThumbnail(dto.images, dto.thumbnail);

    let productId: number;
    try {
      productId = await this.db.transaction(async (conn) => {
        const [result] = await conn.query(
          `INSERT INTO product (
            shopId, name, price, compareAtPrice, thumbnail, sku, barcode, slug,
            metaTitle, metaDescription, description, shortSummary, longSummary,
            costPrice, status, trackInventory, continueSellingOutOfStock, chargeTax,
            isCheckoutAddon, showVariants, showAttributes, showFaqs, usesIngredients,
            vendor, productType, physicalProduct, weight, weightUnit, dimensions,
            isGiftCard, giftCardDenominations, giftCardCustomAmountMin, giftCardCustomAmountMax,
            additionalInfo, brandId
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ctx.shopId,
            dto.name,
            dto.price,
            dto.compareAtPrice ?? null,
            thumbnail,
            dto.sku,
            dto.barcode ?? null,
            slug,
            dto.metaTitle ?? null,
            dto.metaDescription ?? null,
            dto.description ?? null,
            dto.shortSummary ?? null,
            dto.longSummary ?? null,
            dto.costPrice ?? null,
            dto.status ?? 'Available',
            dto.trackInventory ?? false,
            dto.continueSellingOutOfStock ?? false,
            dto.chargeTax ?? true,
            dto.isCheckoutAddon ?? false,
            dto.showVariants ?? false,
            dto.showAttributes ?? false,
            dto.showFaqs ?? false,
            usesIngredients,
            dto.vendor ?? null,
            dto.productType ?? null,
            dto.physicalProduct ?? true,
            dto.weight ?? null,
            dto.weightUnit ?? 'kg',
            dto.dimensions ?? null,
            dto.isGiftCard ?? false,
            dto.giftCardDenominations ? JSON.stringify(dto.giftCardDenominations) : null,
            dto.giftCardCustomAmountMin ?? null,
            dto.giftCardCustomAmountMax ?? null,
            dto.additionalInfo ? JSON.stringify(dto.additionalInfo) : null,
            dto.brandId ?? null,
          ],
        );
        const newId = (result as { insertId: number }).insertId;

        if (dto.images?.length) {
          const placeholders = dto.images.map(() => '(?, ?, ?)').join(', ');
          const params = dto.images.flatMap((img, i) => [
            newId,
            img.url,
            img.order ?? i,
          ]);
          await conn.query(
            `INSERT INTO productimage (productId, url, \`order\`) VALUES ${placeholders}`,
            params,
          );
        }
        if (dto.attributes?.length) {
          const placeholders = dto.attributes.map(() => '(?, ?, ?, ?)').join(', ');
          const params = dto.attributes.flatMap((a, i) => [
            newId,
            a.name.trim(),
            a.value.trim(),
            a.order ?? i,
          ]);
          await conn.query(
            `INSERT INTO productattribute (productId, name, value, \`order\`) VALUES ${placeholders}`,
            params,
          );
        }
        if (dto.faqs?.length) {
          const placeholders = dto.faqs.map(() => '(?, ?, ?, ?)').join(', ');
          const params = dto.faqs.flatMap((f, i) => [
            newId,
            f.question.trim(),
            f.answer.trim(),
            f.order ?? i,
          ]);
          await conn.query(
            `INSERT INTO productfaq (productId, question, answer, \`order\`) VALUES ${placeholders}`,
            params,
          );
        }
        const collectionPlaceholders = dto.collectionIds.map(() => '(?, ?)').join(', ');
        await conn.query(
          `INSERT INTO productcollection (productId, collectionId) VALUES ${collectionPlaceholders}`,
          dto.collectionIds.flatMap((collectionId) => [newId, collectionId]),
        );
        if (tagIds.length > 0) {
          const tagPlaceholders = tagIds.map(() => '(?, ?)').join(', ');
          await conn.query(
            `INSERT INTO producttag (productId, tagId) VALUES ${tagPlaceholders}`,
            tagIds.flatMap((tagId) => [newId, tagId]),
          );
        }
        if (usesIngredients && dto.ingredients?.length) {
          const placeholders = dto.ingredients.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
          const params = dto.ingredients.flatMap((i) => [
            ctx.shopId,
            newId,
            null,
            i.ingredientId,
            i.quantityPerUnit,
            new Date(),
          ]);
          await conn.query(
            `INSERT INTO productingredient (shopId, productId, variantId, ingredientId, quantityPerUnit, updatedAt) VALUES ${placeholders}`,
            params,
          );
        }
        if (!usesIngredients) {
          await this.provisionShadowForProduct(conn, ctx, newId, {
            name: dto.name,
            thumbnail,
            trackInventory: dto.trackInventory ?? false,
            costPrice: dto.costPrice ?? null,
          });
        }
        return newId;
      });
    } catch (error) {
      this.handleDbError(error);
    }
    const products = await this.loadProductsWithRelations([productId], undefined);
    return this.toResponse(products.get(productId)!);
  }

  // Deep-copies title/description/pricing/organization + every variant and
  // option, and references the same image URLs rather than re-uploading —
  // but deliberately does NOT copy: sku (unique per shop — see below),
  // barcode, slug (both regenerated fresh), or any stock/recipe rows (a
  // copy always starts at zero/untracked, same as a brand-new product;
  // duplicating live counts would be actively wrong — two products both
  // claiming to have the original's stock). New copy always lands as
  // status: 'Unavailable' (shown to merchants as "Draft" — see
  // PRODUCT_STATUS_LABELS in the admin frontend) regardless of the
  // original's status, so a duplicate never goes live by accident.
  async duplicate(ctx: TenantContext, id: number) {
    const ownRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM product WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (ownRows.length === 0) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    const originals = await this.loadProductsWithRelations([id], undefined);
    const original = originals.get(id);
    if (!original) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    const newName = `${original.name} (Copy)`;
    const newSlug = await this.resolveUniqueSlug(ctx.shopId, newName);
    // product.sku is @@unique([shopId, sku]) and NOT NULL — a literal blank
    // copy would collide with itself on a second duplication of the same
    // product, so it's suffixed with a short random tag instead (visibly
    // not a real SKU, prompting the merchant to set a real one before
    // publishing). Variant sku/barcode below have no such uniqueness
    // constraint, so those genuinely are left blank.
    const newSku = `${original.sku}-COPY-${randomUUID().slice(0, 6).toUpperCase()}`;

    let newProductId: number;
    try {
      newProductId = await this.db.transaction(async (conn) => {
        const [result] = await conn.query(
          `INSERT INTO product (
            shopId, name, description, shortSummary, longSummary, thumbnail, price,
            compareAtPrice, costPrice, sku, barcode, status, trackInventory,
            continueSellingOutOfStock, chargeTax, isCheckoutAddon, showVariants,
            showAttributes, showFaqs, vendor, productType, physicalProduct, weight,
            weightUnit, dimensions, slug, metaTitle, metaDescription, brandId
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ctx.shopId,
            newName,
            original.description,
            original.shortSummary,
            original.longSummary,
            original.thumbnail,
            original.price,
            original.compareAtPrice,
            original.costPrice,
            newSku,
            null,
            'Unavailable',
            original.trackInventory,
            original.continueSellingOutOfStock,
            original.chargeTax,
            original.isCheckoutAddon,
            original.showVariants,
            original.showAttributes,
            original.showFaqs,
            original.vendor,
            original.productType,
            original.physicalProduct,
            original.weight,
            original.weightUnit,
            original.dimensions,
            newSlug,
            original.metaTitle,
            original.metaDescription,
            original.brandId ?? null,
          ],
        );
        const newProduct = {
          id: (result as { insertId: number }).insertId,
          name: newName,
          thumbnail: original.thumbnail as string,
          trackInventory: original.trackInventory as boolean,
          costPrice: original.costPrice as string | null,
        };

        // Match by `order` (copied 1:1 from the original above) rather than
        // array position — id-preserving isn't guaranteed insert-order.
        const imageIdByOrder = new Map<number, number>();
        if (original.productimage.length > 0) {
          const placeholders = original.productimage.map(() => '(?, ?, ?)').join(', ');
          const params = original.productimage.flatMap((img) => [
            newProduct.id,
            img.url,
            img.order,
          ]);
          await conn.query(
            `INSERT INTO productimage (productId, url, \`order\`) VALUES ${placeholders}`,
            params,
          );
          const [newImages] = await conn.query<RowDataPacket[]>(
            `SELECT id, \`order\` FROM productimage WHERE productId = ?`,
            [newProduct.id],
          );
          for (const img of newImages) {
            imageIdByOrder.set(img.order as number, img.id as number);
          }
        }
        const newImageIdFor = (oldImageId: number | null) => {
          if (oldImageId === null) return null;
          const oldOrder = original.productimage.find((img) => img.id === oldImageId)?.order;
          return oldOrder === undefined ? null : (imageIdByOrder.get(oldOrder) ?? null);
        };

        if (original.productcollection.length > 0) {
          const placeholders = original.productcollection.map(() => '(?, ?)').join(', ');
          await conn.query(
            `INSERT INTO productcollection (productId, collectionId) VALUES ${placeholders}`,
            original.productcollection.flatMap((pc) => [newProduct.id, pc.collection.id]),
          );
        }
        if (original.producttag.length > 0) {
          // producttag doesn't carry tagId directly in the assembled shape
          // (only the joined tag.name) — re-resolve by name via the same
          // upsert-by-name helper used everywhere else tags are written.
          const tagIds = await this.resolveTagIds(
            ctx,
            original.producttag.map((pt) => pt.tag.name),
          );
          const placeholders = tagIds.map(() => '(?, ?)').join(', ');
          await conn.query(
            `INSERT INTO producttag (productId, tagId) VALUES ${placeholders}`,
            tagIds.flatMap((tagId) => [newProduct.id, tagId]),
          );
        }

        const optionValueIdMap = new Map<number, number>();
        for (const option of original.productoption) {
          const [optResult] = await conn.query(
            `INSERT INTO productoption (productId, name, \`order\`) VALUES (?, ?, ?)`,
            [newProduct.id, option.name, option.order],
          );
          const newOptionId = (optResult as { insertId: number }).insertId;
          for (const value of option.productoptionvalue) {
            const [valResult] = await conn.query(
              `INSERT INTO productoptionvalue (optionId, value, \`order\`) VALUES (?, ?, ?)`,
              [newOptionId, value.value, value.order],
            );
            optionValueIdMap.set(value.id, (valResult as { insertId: number }).insertId);
          }
        }

        for (const variant of original.productvariant) {
          const [varResult] = await conn.query(
            `INSERT INTO productvariant (
              productId, sku, barcode, price, compareAtPrice, weight, imageId, \`order\`,
              optionValue1Id, optionValue2Id, optionValue3Id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newProduct.id,
              // Left blank — no uniqueness constraint on variant sku/barcode
              // (unlike the product-level sku above), so a real blank is safe.
              null,
              null,
              variant.price,
              variant.compareAtPrice,
              variant.weight,
              newImageIdFor(variant.imageId),
              variant.order,
              variant.optionValue1Id ? (optionValueIdMap.get(variant.optionValue1Id) ?? null) : null,
              variant.optionValue2Id ? (optionValueIdMap.get(variant.optionValue2Id) ?? null) : null,
              variant.optionValue3Id ? (optionValueIdMap.get(variant.optionValue3Id) ?? null) : null,
            ],
          );
          const newVariantId = (varResult as { insertId: number }).insertId;
          // A duplicate never copies the original's recipe/stock (same
          // "always starts at zero/untracked" reasoning as everywhere else
          // in this method) — it's always usesIngredients:false, so every
          // variant needs its own fresh shadow ingredient.
          await this.provisionShadowForVariant(conn, ctx, newProduct.id, newVariantId, {
            name: newProduct.name,
            thumbnail: newProduct.thumbnail,
            trackInventory: newProduct.trackInventory,
            costPrice: newProduct.costPrice,
          });
        }
        if (original.productvariant.length === 0) {
          await this.provisionShadowForProduct(conn, ctx, newProduct.id, {
            name: newProduct.name,
            thumbnail: newProduct.thumbnail,
            trackInventory: newProduct.trackInventory,
            costPrice: newProduct.costPrice,
          });
        }

        return newProduct.id;
      });
    } catch (error) {
      this.handleDbError(error);
    }
    const products = await this.loadProductsWithRelations([newProductId], undefined);
    return this.toResponse(products.get(newProductId)!);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateProductDto) {
    const current = await this.findRaw(ctx, id);

    if (dto.collectionIds) {
      await this.assertCollectionsBelongToShop(ctx, dto.collectionIds);
    }
    if (dto.brandId != null) {
      await this.assertBrandBelongsToShop(ctx, dto.brandId);
    }
    // Toggle-flip bookkeeping — see the shadow-provisioning methods below.
    // "current" is this product's state before this save; "next" is what it
    // will be once this save lands (dto field omitted = unchanged). Same
    // inference as create(): submitting a non-empty `ingredients` array
    // without ever mentioning `usesIngredients` auto-upgrades a still-shadow
    // product into recipe mode (pre-Phase-A callers always could) — an
    // explicit `usesIngredients` always wins over the inference either way.
    const nextUsesIngredients =
      dto.usesIngredients ??
      (current.usesIngredients || (dto.ingredients?.length ?? 0) > 0);
    const togglingToRecipe = !current.usesIngredients && nextUsesIngredients;
    const togglingToShadow = current.usesIngredients && !nextUsesIngredients;
    if (togglingToRecipe && !dto.ingredients?.length) {
      throw new BadRequestException(
        'A product using a recipe needs at least one ingredient',
      );
    }
    // A usesIngredients:false product's recipe is the auto-managed shadow
    // link — never client-editable — so a stray dto.ingredients sent while
    // staying/going into shadow mode is ignored rather than trusted. Same
    // "the check lives where the decision is made, not per caller"
    // reasoning as every other toggle-bypass guardrail in this codebase.
    const applyIngredientsReplace =
      nextUsesIngredients && dto.ingredients !== undefined;
    if (applyIngredientsReplace) {
      await this.assertIngredientLinksValid(ctx, dto.ingredients!);
    }
    const tagIds =
      dto.tags !== undefined
        ? await this.resolveTagIds(ctx, dto.tags)
        : undefined;
    const thumbnail =
      dto.images !== undefined
        ? this.resolveFeaturedThumbnail(dto.images, current.thumbnail as string)
        : undefined;

    try {
      await this.db.transaction(async (conn) => {
        if (dto.collectionIds) {
          await conn.query(`DELETE FROM productcollection WHERE productId = ?`, [id]);
        }
        if (tagIds !== undefined) {
          await conn.query(`DELETE FROM producttag WHERE productId = ?`, [id]);
        }
        if (dto.images !== undefined) {
          // Upsert-by-url, not delete-all-then-recreate: the old approach
          // deleted every productimage row and made brand new ones (fresh
          // ids) on every single save that touched images — which is every
          // save, since the frontend always resends the full gallery. Any
          // productvariant.imageId pointing at one of those rows would get
          // silently SetNull'd, wiping the variant's image assignment on
          // its very next unrelated product save. Matching by url keeps the
          // id (and therefore any variant's assignment) stable for images
          // that didn't actually change; only genuinely removed urls get
          // deleted (SetNull-ing variants that pointed at THOSE, which is
          // correct — the image is really gone) and only genuinely new
          // urls get a new row.
          const [existingImages] = await conn.query<RowDataPacket[]>(
            `SELECT * FROM productimage WHERE productId = ?`,
            [id],
          );
          const existingByUrl = new Map(existingImages.map((img) => [img.url as string, img]));
          const keepUrls = new Set(dto.images.map((img) => img.url));
          const removedIds = existingImages
            .filter((img) => !keepUrls.has(img.url as string))
            .map((img) => img.id as number);
          if (removedIds.length > 0) {
            await conn.query(
              `DELETE FROM productimage WHERE id IN (${removedIds.map(() => '?').join(', ')})`,
              removedIds,
            );
          }
          for (let i = 0; i < dto.images.length; i++) {
            const img = dto.images[i];
            const order = img.order ?? i;
            const existing = existingByUrl.get(img.url);
            if (existing) {
              if (existing.order !== order) {
                await conn.query(`UPDATE productimage SET \`order\` = ? WHERE id = ?`, [
                  order,
                  existing.id,
                ]);
              }
            } else {
              await conn.query(
                `INSERT INTO productimage (productId, url, \`order\`) VALUES (?, ?, ?)`,
                [id, img.url, order],
              );
            }
          }
        }
        if (applyIngredientsReplace) {
          await conn.query(
            `DELETE FROM productingredient WHERE productId = ? AND variantId IS NULL`,
            [id],
          );
        }
        // Delete-then-recreate, unlike images' id-preserving upsert above —
        // nothing FKs into productattribute/productfaq (no variant.imageId-
        // style dependency on a stable id), so there's no id-stability
        // concern here worth the extra complexity.
        if (dto.attributes !== undefined) {
          await conn.query(`DELETE FROM productattribute WHERE productId = ?`, [id]);
          if (dto.attributes.length > 0) {
            const placeholders = dto.attributes.map(() => '(?, ?, ?, ?)').join(', ');
            await conn.query(
              `INSERT INTO productattribute (productId, name, value, \`order\`) VALUES ${placeholders}`,
              dto.attributes.flatMap((a, i) => [id, a.name.trim(), a.value.trim(), a.order ?? i]),
            );
          }
        }
        if (dto.faqs !== undefined) {
          await conn.query(`DELETE FROM productfaq WHERE productId = ?`, [id]);
          if (dto.faqs.length > 0) {
            const placeholders = dto.faqs.map(() => '(?, ?, ?, ?)').join(', ');
            await conn.query(
              `INSERT INTO productfaq (productId, question, answer, \`order\`) VALUES ${placeholders}`,
              dto.faqs.flatMap((f, i) => [id, f.question.trim(), f.answer.trim(), f.order ?? i]),
            );
          }
        }

        const set = buildSetClause({
          name: dto.name,
          price: dto.price,
          compareAtPrice: dto.compareAtPrice,
          thumbnail,
          sku: dto.sku,
          barcode: dto.barcode,
          slug: dto.slug,
          metaTitle: dto.metaTitle,
          metaDescription: dto.metaDescription,
          description: dto.description,
          shortSummary: dto.shortSummary,
          longSummary: dto.longSummary,
          costPrice: dto.costPrice,
          trackInventory: dto.trackInventory,
          continueSellingOutOfStock: dto.continueSellingOutOfStock,
          chargeTax: dto.chargeTax,
          isCheckoutAddon: dto.isCheckoutAddon,
          showVariants: dto.showVariants,
          showAttributes: dto.showAttributes,
          showFaqs: dto.showFaqs,
          usesIngredients: dto.usesIngredients,
          vendor: dto.vendor,
          productType: dto.productType,
          physicalProduct: dto.physicalProduct,
          weight: dto.weight,
          weightUnit: dto.weightUnit,
          dimensions: dto.dimensions,
          isGiftCard: dto.isGiftCard,
          giftCardDenominations: dto.giftCardDenominations
            ? JSON.stringify(dto.giftCardDenominations)
            : undefined,
          giftCardCustomAmountMin: dto.giftCardCustomAmountMin,
          giftCardCustomAmountMax: dto.giftCardCustomAmountMax,
          additionalInfo: dto.additionalInfo ? JSON.stringify(dto.additionalInfo) : undefined,
          brandId: dto.brandId,
        });
        if (set) {
          await conn.query(`UPDATE product SET ${set.setClause} WHERE id = ?`, [
            ...set.params,
            id,
          ]);
        }
        if (dto.collectionIds) {
          const placeholders = dto.collectionIds.map(() => '(?, ?)').join(', ');
          await conn.query(
            `INSERT INTO productcollection (productId, collectionId) VALUES ${placeholders}`,
            dto.collectionIds.flatMap((collectionId) => [id, collectionId]),
          );
        }
        if (tagIds !== undefined && tagIds.length > 0) {
          const placeholders = tagIds.map(() => '(?, ?)').join(', ');
          await conn.query(
            `INSERT INTO producttag (productId, tagId) VALUES ${placeholders}`,
            tagIds.flatMap((tagId) => [id, tagId]),
          );
        }
        if (applyIngredientsReplace && dto.ingredients!.length > 0) {
          const placeholders = dto.ingredients!.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
          await conn.query(
            `INSERT INTO productingredient (shopId, productId, variantId, ingredientId, quantityPerUnit, updatedAt) VALUES ${placeholders}`,
            dto.ingredients!.flatMap((i) => [
              ctx.shopId,
              id,
              null,
              i.ingredientId,
              i.quantityPerUnit,
              new Date(),
            ]),
          );
        }

        const [variantRows] = await conn.query<RowDataPacket[]>(
          `SELECT id FROM productvariant WHERE productId = ?`,
          [id],
        );
        const variantIds = variantRows.map((v) => v.id as number);

        // Bill of Materials (Phase A) toggle-flip side effects — see the
        // shadow-provisioning methods below.
        if (togglingToRecipe) {
          await this.deleteShadowForProduct(conn, id);
          if (variantIds.length > 0) {
            await this.deleteShadowsForVariants(conn, variantIds);
          }
        } else if (togglingToShadow) {
          await conn.query(`DELETE FROM productingredient WHERE productId = ?`, [id]);
          const [nameRows] = await conn.query<RowDataPacket[]>(
            `SELECT name, thumbnail, trackInventory, costPrice FROM product WHERE id = ?`,
            [id],
          );
          const nameRow = nameRows[0];
          if (variantIds.length > 0) {
            for (const vId of variantIds) {
              await this.provisionShadowForVariant(conn, ctx, id, vId, {
                name: nameRow.name as string,
                thumbnail: nameRow.thumbnail as string,
                trackInventory: nameRow.trackInventory as boolean,
                costPrice: nameRow.costPrice as string | null,
              });
            }
          } else {
            await this.provisionShadowForProduct(conn, ctx, id, {
              name: nameRow.name as string,
              thumbnail: nameRow.thumbnail as string,
              trackInventory: nameRow.trackInventory as boolean,
              costPrice: nameRow.costPrice as string | null,
            });
          }
        } else if (!nextUsesIngredients) {
          // Staying in shadow mode — keep the shadow ingredient(s)' display
          // fields synced with whatever actually changed on this save.
          await this.syncShadowMeta(
            conn,
            { shadowProductId: id },
            { name: dto.name, thumbnail, trackInventory: dto.trackInventory },
          );
          if (variantIds.length > 0) {
            await this.syncShadowMeta(
              conn,
              { shadowVariantIdIn: variantIds },
              { name: dto.name, thumbnail, trackInventory: dto.trackInventory },
            );
          }
        }
      });
    } catch (error) {
      this.handleDbError(error);
    }
    const products = await this.loadProductsWithRelations([id], undefined);
    const product = products.get(id)!;
    if (
      (dto.price !== undefined &&
        Number(dto.price) !== Number(current.price)) ||
      (dto.compareAtPrice !== undefined &&
        Number(dto.compareAtPrice) !== Number(current.compareAtPrice ?? 0))
    ) {
      await this.auditLogService.logCtx(ctx, {
        action: 'product.price_changed',
        entityType: 'product',
        entityId: id,
        before: {
          price: trimDecimal(current.price as string),
          compareAtPrice: trimDecimal(current.compareAtPrice as string | null),
        },
        after: {
          price: product.price,
          compareAtPrice: product.compareAtPrice,
        },
      });
    }
    return this.toResponse(product);
  }

  // Deliberately the only thing this touches — see UpdateProductAvailabilityDto
  // for why this is a separate method/route from update(): a branch user is
  // allowed to flip availability but not the rest of the catalog entry.
  async updateAvailability(
    ctx: TenantContext,
    id: number,
    dto: UpdateProductAvailabilityDto,
  ) {
    const before = await this.findOne(ctx, id);
    await this.db.execute(`UPDATE product SET status = ? WHERE id = ?`, [
      dto.status,
      id,
    ]);
    const products = await this.loadProductsWithRelations([id], undefined);
    const product = this.toResponse(products.get(id)!);
    if (before.status !== dto.status) {
      await this.auditLogService.logCtx(ctx, {
        action: 'product.status_changed',
        entityType: 'product',
        entityId: id,
        before: { status: before.status },
        after: { status: dto.status },
      });
    }
    return product;
  }

  // Full replace of the option/value set, reconciling the existing variant
  // list against the new combinations rather than blowing everything away —
  // see variant-generator.ts and the module-level comment on productvariant
  // in schema.prisma for the matching rules. Options are matched to their
  // existing counterpart by *position* (1st option vs 1st option, etc), not
  // by name — a rename alone never touches variants; only the value set
  // changing does.
  async updateOptions(
    ctx: TenantContext,
    id: number,
    dto: UpdateProductOptionsDto,
  ) {
    const productRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM product WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    const product = productRows[0];
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    const optionRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM productoption WHERE productId = ? ORDER BY \`order\` ASC`,
      [id],
    );
    const optionValueRows = optionRows.length
      ? await this.db.query<RowDataPacket[]>(
          `SELECT * FROM productoptionvalue WHERE optionId IN (${optionRows.map(() => '?').join(', ')}) ORDER BY \`order\` ASC`,
          optionRows.map((o) => o.id),
        )
      : [];
    const valuesByOption = new Map<number, RowDataPacket[]>();
    for (const v of optionValueRows) {
      const list = valuesByOption.get(v.optionId as number) ?? [];
      list.push(v);
      valuesByOption.set(v.optionId as number, list);
    }
    const existingOptions = optionRows.map((o) => ({
      id: o.id as number,
      name: o.name as string,
      order: o.order as number,
      productoptionvalue: valuesByOption.get(o.id as number) ?? [],
    }));
    const variantRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM productvariant WHERE productId = ?`,
      [id],
    );

    if (dto.options.length > MAX_PRODUCT_OPTIONS) {
      throw new BadRequestException(
        `A product can have at most ${MAX_PRODUCT_OPTIONS} options`,
      );
    }

    // Dedup values per option (trim, drop blanks, case-insensitive,
    // keep first-seen casing) — mirrors resolveTagIds's dedup rule.
    const cleanedOptions = dto.options.map((o) => ({
      name: o.name.trim(),
      values: dedupeCaseInsensitive(
        o.values.map((v) => v.trim()).filter(Boolean),
      ),
    }));
    for (const o of cleanedOptions) {
      if (o.values.length === 0) {
        throw new BadRequestException(
          `Option "${o.name}" needs at least one value`,
        );
      }
    }

    if (cleanedOptions.length === 0) {
      // Wipe path — reverts to a single implicit variant, same as a product
      // that never had options. Deleting every variant cascades away their
      // shadow ingredients too (ON DELETE CASCADE) — a usesIngredients:false
      // product now needs a fresh product-level shadow to have anywhere for
      // its stock to live again.
      await this.db.transaction(async (conn) => {
        await conn.query(`DELETE FROM productvariant WHERE productId = ?`, [id]);
        await conn.query(`DELETE FROM productoption WHERE productId = ?`, [id]);
        if (!product.usesIngredients) {
          await this.provisionShadowForProduct(conn, ctx, id, {
            name: product.name as string,
            thumbnail: product.thumbnail as string,
            trackInventory: product.trackInventory as boolean,
            costPrice: product.costPrice as string | null,
          });
        }
      });
      return this.findOne(ctx, id);
    }

    const totalVariants = cleanedOptions.reduce(
      (n, o) => n * o.values.length,
      1,
    );
    if (totalVariants > MAX_VARIANTS_PER_PRODUCT) {
      throw new BadRequestException(
        `These options would create ${totalVariants} variants — the maximum is ${MAX_VARIANTS_PER_PRODUCT}. Remove some values or options.`,
      );
    }

    await this.db.transaction(async (conn) => {
      const valueIdsByOption: number[][] = [];

      for (let i = 0; i < cleanedOptions.length; i++) {
        const target = cleanedOptions[i];
        const existingOption = existingOptions[i];

        let optionId: number;
        if (existingOption) {
          await conn.query(`UPDATE productoption SET name = ?, \`order\` = ? WHERE id = ?`, [
            target.name,
            i,
            existingOption.id,
          ]);
          optionId = existingOption.id;
        } else {
          const [optResult] = await conn.query(
            `INSERT INTO productoption (productId, name, \`order\`) VALUES (?, ?, ?)`,
            [id, target.name, i],
          );
          optionId = (optResult as { insertId: number }).insertId;
        }

        const existingValues = existingOption?.productoptionvalue ?? [];
        const existingByValue = new Map(
          existingValues.map((v) => [(v.value as string).trim().toLowerCase(), v]),
        );
        const valueIds: number[] = [];
        for (let j = 0; j < target.values.length; j++) {
          const value = target.values[j];
          const match = existingByValue.get(value.toLowerCase());
          if (match) {
            existingByValue.delete(value.toLowerCase());
            await conn.query(`UPDATE productoptionvalue SET value = ?, \`order\` = ? WHERE id = ?`, [
              value,
              j,
              match.id,
            ]);
            valueIds.push(match.id as number);
          } else {
            const [valResult] = await conn.query(
              `INSERT INTO productoptionvalue (optionId, value, \`order\`) VALUES (?, ?, ?)`,
              [optionId, value, j],
            );
            valueIds.push((valResult as { insertId: number }).insertId);
          }
        }
        // Whatever's left in existingByValue is a value that's no longer
        // present — its variants get reconciled away below (their combo key
        // won't be in newComboKeys since this id no longer exists).
        const removedIds = [...existingByValue.values()].map((v) => v.id as number);
        if (removedIds.length > 0) {
          await conn.query(
            `DELETE FROM productoptionvalue WHERE id IN (${removedIds.map(() => '?').join(', ')})`,
            removedIds,
          );
        }
        valueIdsByOption.push(valueIds);
      }

      // Any existing option beyond the new option count is dropped entirely
      // (e.g. product had 3 options, now has 2).
      const droppedOptionIds = existingOptions.slice(cleanedOptions.length).map((o) => o.id);
      if (droppedOptionIds.length > 0) {
        await conn.query(
          `DELETE FROM productoption WHERE id IN (${droppedOptionIds.map(() => '?').join(', ')})`,
          droppedOptionIds,
        );
      }

      const newCombos = generateVariantCombinations(valueIdsByOption);
      const newComboKeys = new Set(newCombos.map(comboKey));
      const existingByKey = new Map(
        variantRows.map((v) => [
          comboKey([v.optionValue1Id as number | null, v.optionValue2Id as number | null, v.optionValue3Id as number | null]),
          v,
        ]),
      );

      const staleVariantIds = variantRows
        .filter(
          (v) =>
            !newComboKeys.has(
              comboKey([v.optionValue1Id as number | null, v.optionValue2Id as number | null, v.optionValue3Id as number | null]),
            ),
        )
        .map((v) => v.id as number);
      if (staleVariantIds.length > 0) {
        await conn.query(
          `DELETE FROM productvariant WHERE id IN (${staleVariantIds.map(() => '?').join(', ')})`,
          staleVariantIds,
        );
      }

      for (let i = 0; i < newCombos.length; i++) {
        const combo = newCombos[i];
        const key = comboKey(combo);
        const existing = existingByKey.get(key);
        if (existing) {
          if (existing.order !== i) {
            await conn.query(`UPDATE productvariant SET \`order\` = ? WHERE id = ?`, [
              i,
              existing.id,
            ]);
          }
          continue;
        }
        const [createdResult] = await conn.query(
          `INSERT INTO productvariant (productId, optionValue1Id, optionValue2Id, optionValue3Id, \`order\`, price, compareAtPrice, weight)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            combo[0],
            combo[1],
            combo[2],
            i,
            // New variants inherit the parent product's current price —
            // never a null "unset" price a customer could otherwise buy at
            // (see the resolution fallback in orders/public.service.ts,
            // which still falls back to product.price defensively).
            product.price,
            product.compareAtPrice,
            product.weight,
          ],
        );
        const createdId = (createdResult as { insertId: number }).insertId;
        // A newly-generated variant of a usesIngredients:false product
        // needs its own shadow ingredient (Bill of Materials, Phase A) —
        // exactly like a freshly-created non-variant product does in
        // create(). staleVariantIds' deletion above needs no matching
        // cleanup call: ingredient.shadowVariantId's own ON DELETE CASCADE
        // already removes the shadow when the variant row itself is gone.
        if (!product.usesIngredients) {
          await this.provisionShadowForVariant(conn, ctx, id, createdId, {
            name: product.name as string,
            thumbnail: product.thumbnail as string,
            trackInventory: product.trackInventory as boolean,
            costPrice: product.costPrice as string | null,
          });
        }
      }

      // A product transitioning from zero options to real variants for the
      // first time may still be carrying the product-level shadow it got
      // at creation (see create()) — a variant-carrying product only ever
      // has per-variant shadows (see ingredient.shadowVariantId's schema
      // comment), so that now-stale product-level one must go. No-op once
      // the product already has variants on every subsequent save.
      if (!product.usesIngredients) {
        await this.deleteShadowForProduct(conn, id);
      }
    });

    return this.findOne(ctx, id);
  }

  // Row-level "fuller field set" edit for one already-generated variant —
  // see UpdateVariantDto.
  async updateVariant(
    ctx: TenantContext,
    productId: number,
    variantId: number,
    dto: UpdateVariantDto,
  ) {
    const product = await this.findRaw(ctx, productId);
    const variantRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM productvariant WHERE id = ? AND productId = ?`,
      [variantId, productId],
    );
    if (variantRows.length === 0) {
      throw new NotFoundException(`Variant ${variantId} not found`);
    }
    if (dto.imageId) {
      const imageRows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM productimage WHERE id = ? AND productId = ?`,
        [dto.imageId, productId],
      );
      if (imageRows.length === 0) {
        throw new BadRequestException(
          'imageId must reference an image already uploaded to this product',
        );
      }
    }
    // A usesIngredients:false product's variant has no merchant-editable
    // recipe — only its own auto-managed shadow link, which lives in this
    // exact (productId, variantId) row set. Without this guard, a stray
    // dto.ingredients here would delete that shadow link via the same
    // delete the real-override path uses below, orphaning the shadow
    // ingredient and breaking this variant's stock resolution entirely —
    // same "ignore, don't corrupt" rule update() applies for the
    // product-level case.
    const applyIngredientsReplace =
      product.usesIngredients && dto.ingredients !== undefined;
    if (applyIngredientsReplace) {
      await this.assertIngredientLinksValid(ctx, dto.ingredients!);
    }
    await this.db.transaction(async (conn) => {
      if (applyIngredientsReplace) {
        await conn.query(
          `DELETE FROM productingredient WHERE productId = ? AND variantId = ?`,
          [productId, variantId],
        );
      }
      const set = buildSetClause({
        sku: dto.sku,
        barcode: dto.barcode,
        price: dto.price,
        compareAtPrice: dto.compareAtPrice,
        weight: dto.weight,
        imageId: dto.imageId,
      });
      if (set) {
        await conn.query(`UPDATE productvariant SET ${set.setClause} WHERE id = ?`, [
          ...set.params,
          variantId,
        ]);
      }
      if (applyIngredientsReplace && dto.ingredients!.length > 0) {
        const placeholders = dto.ingredients!.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
        await conn.query(
          `INSERT INTO productingredient (shopId, productId, variantId, ingredientId, quantityPerUnit, updatedAt) VALUES ${placeholders}`,
          dto.ingredients!.flatMap((i) => [
            ctx.shopId,
            productId,
            variantId,
            i.ingredientId,
            i.quantityPerUnit,
            new Date(),
          ]),
        );
      }
    });
    const updatedVariants = await this.loadVariantsWithRelations([variantId], undefined);
    const updated = updatedVariants.get(variantId)!;
    // Needed so the response's makeableQuantity can fall back to the
    // product-level default when this variant has no overrides of its own
    // (same effective-recipe resolution as toResponse's own variant mapping)
    // — no live outlet stock breakdown here (this endpoint isn't
    // outlet-scoped), same as everywhere else on this route today.
    const productDefaultIngredientRows = await this.loadIngredientLinks(
      'productId = ? AND variantId IS NULL',
      [productId],
      undefined,
    );
    return this.toVariantResponse(
      updated,
      productDefaultIngredientRows.map((r) => this.rowToIngredientLink(r)),
      product.usesIngredients as boolean,
    );
  }

  async adjustStock(ctx: TenantContext, dto: AdjustStockDto) {
    // Same outlet-override rule as order creation: a branch user's request
    // is always forced onto their own outlet, no matter what outletId (if
    // any) they send.
    const outletId = ctx.role === 'branch' ? ctx.outletId! : dto.outletId;
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    const outletRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [outletId, ctx.shopId],
    );
    if (outletRows.length === 0) {
      throw new BadRequestException('outletId is invalid for this shop');
    }
    await this.branchRolesService.assertPermission(
      ctx,
      outletId,
      'products.manage_stock',
    );

    // Resolves every adjustment's shadow ingredient up front — also
    // verifies shop/product/variant ownership and rejects a
    // usesIngredients:true product target (see resolveShadowStockTarget).
    const resolved = await Promise.all(
      dto.adjustments.map(async (a) => ({
        delta: a.delta,
        target: await this.resolveShadowStockTarget(ctx, {
          productId: a.productId,
          variantId: a.variantId,
        }),
      })),
    );

    const ingredientIds = resolved.map((r) => r.target.ingredientId);
    const currentStock = await this.db.query<RowDataPacket[]>(
      `SELECT ingredientId, stockQuantity FROM outletingredientstock
       WHERE outletId = ? AND ingredientId IN (${ingredientIds.map(() => '?').join(', ')})`,
      [outletId, ...ingredientIds],
    );
    const currentByIngredient = new Map(
      currentStock.map((s) => [s.ingredientId as number, s.stockQuantity as number]),
    );
    for (const { delta, target } of resolved) {
      const current = currentByIngredient.get(target.ingredientId) ?? 0;
      if (current + delta < 0) {
        throw new BadRequestException(
          `Adjustment would take product ${target.productId} below zero stock at this outlet`,
        );
      }
    }

    await this.db.transaction(async (conn) => {
      for (const { delta, target } of resolved) {
        // upsert() can't express increment-on-conflict (see its own doc
        // comment) — a direct ON DUPLICATE KEY UPDATE ... = col + VALUES(col)
        // instead: inserts `delta` for a brand-new row, adds `delta` to an
        // existing one.
        await conn.query(
          `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE stockQuantity = stockQuantity + VALUES(stockQuantity)`,
          [outletId, target.ingredientId, delta],
        );
      }
    });

    // Back-in-stock notify — fire (not awaited) for every product/variant
    // whose stock just crossed 0 -> positive at this outlet. Not awaited so
    // a slow/failing email batch never delays the stock-adjustment response.
    for (const { delta, target } of resolved) {
      const before = currentByIngredient.get(target.ingredientId) ?? 0;
      if (before <= 0 && before + delta > 0) {
        this.notifySubscriptionsService
          .triggerForProduct(
            ctx.shopId,
            target.productId!,
            target.variantId ?? undefined,
          )
          .catch(() => {});
      }
    }

    const stockRows = await this.db.query<RowDataPacket[]>(
      `SELECT ingredientId, stockQuantity FROM outletingredientstock
       WHERE outletId = ? AND ingredientId IN (${ingredientIds.map(() => '?').join(', ')})`,
      [outletId, ...ingredientIds],
    );
    const stockByIngredient = new Map(
      stockRows.map((s) => [s.ingredientId as number, s.stockQuantity as number]),
    );

    return {
      products: resolved
        .filter((r) => r.target.variantId === null)
        .map((r) => ({
          productId: r.target.productId,
          stockQuantity: stockByIngredient.get(r.target.ingredientId) ?? 0,
        })),
      variants: resolved
        .filter((r) => r.target.variantId !== null)
        .map((r) => ({
          variantId: r.target.variantId,
          stockQuantity: stockByIngredient.get(r.target.ingredientId) ?? 0,
        })),
    };
  }

  // Moves N units of one product/variant from one outlet to another,
  // atomically. Unlike adjustStock above (a read-then-check-then-write, fine
  // for low-concurrency manual admin corrections), this uses the same
  // CAS-guarded UPDATE...affectedRows discipline as checkout's reserveStock
  // (orders.service.ts) — the floor check lives in the WHERE clause of the
  // decrement itself, inside a real transaction, so two concurrent
  // transfers of the same source stock can't both succeed past what's
  // actually there.
  async transferStock(ctx: TenantContext, dto: TransferStockDto) {
    if (dto.fromOutletId === dto.toOutletId) {
      throw new BadRequestException(
        'fromOutletId and toOutletId must be different',
      );
    }

    const [fromOutletRows, toOutletRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(`SELECT id FROM outlet WHERE id = ? AND shopId = ?`, [
        dto.fromOutletId,
        ctx.shopId,
      ]),
      this.db.query<RowDataPacket[]>(`SELECT id FROM outlet WHERE id = ? AND shopId = ?`, [
        dto.toOutletId,
        ctx.shopId,
      ]),
    ]);
    if (fromOutletRows.length === 0 || toOutletRows.length === 0) {
      throw new BadRequestException(
        'fromOutletId/toOutletId is invalid for this shop',
      );
    }

    const resolved = await this.resolveShadowStockTarget(ctx, dto);

    // Read for the back-in-stock notify check below — a plain read before
    // the transaction is fine here (unlike the CAS decrement/increment
    // itself): worst case under true concurrency is a missed or extra
    // notify trigger, never an incorrect stock quantity.
    const destBeforeRows = await this.db.query<RowDataPacket[]>(
      `SELECT stockQuantity FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
      [dto.toOutletId, resolved.ingredientId],
    );
    const destinationBefore = (destBeforeRows[0]?.stockQuantity as number | undefined) ?? 0;

    await this.db.transaction(async (conn) => {
      const [decremented] = await conn.query(
        `UPDATE outletingredientstock SET stockQuantity = stockQuantity - ?
         WHERE outletId = ? AND ingredientId = ? AND stockQuantity >= ?`,
        [dto.quantity, dto.fromOutletId, resolved.ingredientId, dto.quantity],
      );
      if ((decremented as { affectedRows: number }).affectedRows === 0) {
        throw new ConflictException(
          'Not enough stock at the source outlet for this transfer',
        );
      }

      await conn.query(
        `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE stockQuantity = stockQuantity + VALUES(stockQuantity)`,
        [dto.toOutletId, resolved.ingredientId, dto.quantity],
      );

      await conn.query(
        `INSERT INTO stockmovement (shopId, productId, variantId, ingredientId, type, reason, delta, outletId, toOutletId, note, actorUserId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          resolved.productId,
          resolved.variantId,
          resolved.ingredientId,
          'TRANSFER',
          null,
          dto.quantity,
          dto.fromOutletId,
          dto.toOutletId,
          dto.note ?? null,
          ctx.userId,
        ],
      );
    });

    if (resolved.productId !== null && destinationBefore <= 0) {
      this.notifySubscriptionsService
        .triggerForProduct(
          ctx.shopId,
          resolved.productId,
          resolved.variantId ?? undefined,
        )
        .catch(() => {});
    }

    return this.getStockSnapshot(resolved, [dto.fromOutletId, dto.toOutletId]);
  }

  // Reason-coded replacement for a raw quantity edit — every adjustment is
  // logged to stockmovement (actor/timestamp/reason/delta), not just
  // applied silently. Negative deltas get the same CAS floor-check as
  // transferStock's decrement; positive deltas (and the delta === 0
  // "confirmed, no change" case for a recount) don't need one.
  async adjustStockWithReason(
    ctx: TenantContext,
    dto: AdjustStockWithReasonDto,
  ) {
    const outletId = ctx.role === 'branch' ? ctx.outletId! : dto.outletId;
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    const outletRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [outletId, ctx.shopId],
    );
    if (outletRows.length === 0) {
      throw new BadRequestException('outletId is invalid for this shop');
    }
    await this.branchRolesService.assertPermission(
      ctx,
      outletId,
      'products.manage_stock',
    );

    const resolved = await this.resolveShadowStockTarget(ctx, dto);

    await this.db.transaction(async (conn) => {
      if (dto.delta < 0) {
        const [result] = await conn.query(
          `UPDATE outletingredientstock SET stockQuantity = stockQuantity - ?
           WHERE outletId = ? AND ingredientId = ? AND stockQuantity >= ?`,
          [-dto.delta, outletId, resolved.ingredientId, -dto.delta],
        );
        if ((result as { affectedRows: number }).affectedRows === 0) {
          throw new ConflictException(
            'Adjustment would take stock below zero at this outlet',
          );
        }
      } else if (dto.delta > 0) {
        await conn.query(
          `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE stockQuantity = stockQuantity + VALUES(stockQuantity)`,
          [outletId, resolved.ingredientId, dto.delta],
        );
      }
      // delta === 0 is a valid "recount confirmed the existing number, no
      // change" adjustment — still logged below, no stock mutation needed.

      await conn.query(
        `INSERT INTO stockmovement (shopId, productId, variantId, ingredientId, type, reason, delta, outletId, toOutletId, note, actorUserId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          resolved.productId,
          resolved.variantId,
          resolved.ingredientId,
          'ADJUSTMENT',
          dto.reason,
          dto.delta,
          outletId,
          null,
          dto.note ?? null,
          ctx.userId,
        ],
      );
    });

    return this.getStockSnapshot(resolved, [outletId]);
  }

  // Bill of Materials (Phase A) — auto-provisions the invisible 1:1 shadow
  // Ingredient + quantityPerUnit:1 recipe row backing a usesIngredients:false
  // product's own stock (see ingredient.shadowProductId's schema comment).
  // Idempotent — a no-op if a shadow already exists for this product, so
  // it's safe to call from create()/update() without separately tracking
  // whether one was already provisioned. Not private — ScanService's
  // scan-to-stock flow (its own product-creation path) reuses this exact
  // provisioning logic rather than duplicating it.
  async provisionShadowForProduct(
    conn: PoolConnection,
    ctx: TenantContext,
    productId: number,
    meta: {
      name: string;
      thumbnail: string;
      trackInventory: boolean;
      costPrice: string | number | null;
    },
  ): Promise<void> {
    const [existingRows] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM ingredient WHERE shadowProductId = ?`,
      [productId],
    );
    if (existingRows.length > 0) return;
    const [shadowResult] = await conn.query(
      `INSERT INTO ingredient (shopId, name, unit, trackInventory, image, costPerUnit, shadowProductId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.shopId,
        meta.name,
        'unit',
        meta.trackInventory,
        meta.thumbnail,
        meta.costPrice !== null ? String(meta.costPrice) : null,
        productId,
      ],
    );
    const shadowId = (shadowResult as { insertId: number }).insertId;
    await conn.query(
      `INSERT INTO productingredient (shopId, productId, variantId, ingredientId, quantityPerUnit, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ctx.shopId, productId, null, shadowId, 1, new Date()],
    );
  }

  // Same as provisionShadowForProduct but for one variant of a
  // usesIngredients:false, variant-carrying product — one shadow ingredient
  // PER VARIANT, never one at the product level once a product has
  // variants (mirrors how variant stock was always independent of the
  // parent product's own stock before Phase A).
  private async provisionShadowForVariant(
    conn: PoolConnection,
    ctx: TenantContext,
    productId: number,
    variantId: number,
    meta: {
      name: string;
      thumbnail: string;
      trackInventory: boolean;
      costPrice: string | number | null;
    },
  ): Promise<void> {
    const [existingRows] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM ingredient WHERE shadowVariantId = ?`,
      [variantId],
    );
    if (existingRows.length > 0) return;
    const [shadowResult] = await conn.query(
      `INSERT INTO ingredient (shopId, name, unit, trackInventory, image, costPerUnit, shadowVariantId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.shopId,
        meta.name,
        'unit',
        meta.trackInventory,
        meta.thumbnail,
        meta.costPrice !== null ? String(meta.costPrice) : null,
        variantId,
      ],
    );
    const shadowId = (shadowResult as { insertId: number }).insertId;
    await conn.query(
      `INSERT INTO productingredient (shopId, productId, variantId, ingredientId, quantityPerUnit, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ctx.shopId, productId, variantId, shadowId, 1, new Date()],
    );
  }

  // Keeps a usesIngredients:false product's/variant's shadow ingredient
  // display fields in sync with whatever actually changed on this save —
  // no-op (and cheap: a single UPDATE, not a loop) when nothing in `meta`
  // changed, and a no-op when no shadow exists for `where` (e.g. called for
  // a product with zero variants against a shadowVariantId filter that
  // matches nothing).
  private async syncShadowMeta(
    conn: PoolConnection,
    where: { shadowProductId: number } | { shadowVariantIdIn: number[] },
    meta: { name?: string; thumbnail?: string; trackInventory?: boolean },
  ): Promise<void> {
    const set = buildSetClause({
      name: meta.name,
      image: meta.thumbnail,
      trackInventory: meta.trackInventory,
    });
    if (!set) return;
    if ('shadowProductId' in where) {
      await conn.query(`UPDATE ingredient SET ${set.setClause} WHERE shadowProductId = ?`, [
        ...set.params,
        where.shadowProductId,
      ]);
    } else {
      if (where.shadowVariantIdIn.length === 0) return;
      await conn.query(
        `UPDATE ingredient SET ${set.setClause} WHERE shadowVariantId IN (${where.shadowVariantIdIn.map(() => '?').join(', ')})`,
        [...set.params, ...where.shadowVariantIdIn],
      );
    }
  }

  // Deletes a product's shadow ingredient — cascades to its
  // outletingredientstock/productingredient/stockmovement rows. Only ever
  // called for the usesIngredients false->true toggle flip; an actual
  // product deletion relies on ingredient.shadowProductId's own ON DELETE
  // CASCADE instead (see remove()).
  private async deleteShadowForProduct(
    conn: PoolConnection,
    productId: number,
  ): Promise<void> {
    await conn.query(`DELETE FROM ingredient WHERE shadowProductId = ?`, [productId]);
  }

  // Same as deleteShadowForProduct but for every variant in the list — used
  // for the false->true toggle flip on a variant-carrying product (each
  // variant's own shadow is torn down, not just the product-level one,
  // since a variant-carrying usesIngredients:false product never has a
  // product-level shadow to begin with).
  private async deleteShadowsForVariants(
    conn: PoolConnection,
    variantIds: number[],
  ): Promise<void> {
    if (variantIds.length === 0) return;
    await conn.query(
      `DELETE FROM ingredient WHERE shadowVariantId IN (${variantIds.map(() => '?').join(', ')})`,
      variantIds,
    );
  }

  // The single place every stock-mutation endpoint (transferStock,
  // adjustStockWithReason, setLowStockThreshold, adjustStock/bulk) resolves
  // a caller-supplied {productId, variantId?} or {ingredientId} target down
  // to the one outletingredientstock row that's actually authoritative —
  // the structural fix for the "toggle check lives in a caller instead of
  // the shared function" bug class this codebase has hit before (see
  // consumeForOrderItems's own comment on AbandonedCartsService/
  // LowStockDigestService): a usesIngredients:true product is rejected
  // here, once, rather than relying on every call site to separately
  // remember to check it. Folds in assertStockTarget's own XOR checks so
  // callers no longer need to call that separately. Not private — reused
  // by ScanService for the same reason.
  //
  async resolveShadowStockTarget(
    ctx: TenantContext,
    target: { productId?: number; variantId?: number; ingredientId?: number },
    client: PoolConnection | Pool = this.db.pool,
  ): Promise<{
    ingredientId: number;
    productId: number | null;
    variantId: number | null;
  }> {
    this.assertStockTarget(target);

    if (target.ingredientId) {
      const [rows] = await client.query<RowDataPacket[]>(
        `SELECT id FROM ingredient WHERE id = ? AND shopId = ?`,
        [target.ingredientId, ctx.shopId],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Ingredient ${target.ingredientId} not found`);
      }
      return { ingredientId: target.ingredientId, productId: null, variantId: null };
    }
    const [productRows] = await client.query<RowDataPacket[]>(
      `SELECT id, usesIngredients FROM product WHERE id = ? AND shopId = ?`,
      [target.productId, ctx.shopId],
    );
    const product = productRows[0];
    if (!product) {
      throw new NotFoundException(`Product ${target.productId} not found`);
    }
    if (product.usesIngredients) {
      throw new BadRequestException(
        'This product uses a recipe — adjust the individual ingredient stock instead',
      );
    }
    if (target.variantId) {
      const [variantRows] = await client.query<RowDataPacket[]>(
        `SELECT id FROM productvariant WHERE id = ? AND productId = ?`,
        [target.variantId, product.id],
      );
      if (variantRows.length === 0) {
        throw new BadRequestException('variantId is invalid for this product');
      }
      const [shadowRows] = await client.query<RowDataPacket[]>(
        `SELECT id FROM ingredient WHERE shadowVariantId = ?`,
        [target.variantId],
      );
      if (shadowRows.length === 0) {
        throw new BadRequestException(`Variant ${target.variantId} has no stock record`);
      }
      return { ingredientId: shadowRows[0].id as number, productId: product.id as number, variantId: target.variantId };
    }
    const [shadowRows] = await client.query<RowDataPacket[]>(
      `SELECT id FROM ingredient WHERE shadowProductId = ?`,
      [product.id],
    );
    if (shadowRows.length === 0) {
      throw new BadRequestException(`Product ${product.id as number} has no stock record`);
    }
    return { ingredientId: shadowRows[0].id as number, productId: product.id as number, variantId: null };
  }

  // Exactly one of productId/ingredientId, never both, never neither;
  // ingredients don't support variants. Enforced here (service layer), not
  // via a custom class-validator decorator on the DTO — same convention as
  // every other discriminated-field invariant in this codebase.
  private assertStockTarget(dto: {
    productId?: number;
    variantId?: number;
    ingredientId?: number;
  }) {
    if (!dto.productId && !dto.ingredientId) {
      throw new BadRequestException('productId or ingredientId is required');
    }
    if (dto.productId && dto.ingredientId) {
      throw new BadRequestException(
        'Provide either a productId or an ingredientId, not both',
      );
    }
    if (dto.ingredientId && dto.variantId) {
      throw new BadRequestException('Ingredients do not support variants');
    }
  }

  // Bill of Materials — validates a full recipe submission (product-level
  // default or a single variant's override list) before any writes: every
  // ingredientId must belong to this shop (tenant isolation — a recipe can
  // never reference another shop's ingredient) and appear at most once
  // (two rows for the same ingredient in one recipe is always a client
  // bug, not a real distinct-quantities case — the second would just
  // silently overwrite the first in `create`, so it's rejected up front
  // instead).
  private async assertIngredientLinksValid(
    ctx: TenantContext,
    inputs: ProductIngredientInput[],
  ) {
    const ids = inputs.map((i) => i.ingredientId);
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== ids.length) {
      throw new BadRequestException(
        'Each ingredient can only be linked once per recipe',
      );
    }
    if (uniqueIds.length === 0) return;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM ingredient WHERE id IN (${uniqueIds.map(() => '?').join(', ')}) AND shopId = ?`,
      [...uniqueIds, ctx.shopId],
    );
    if (Number(rows[0].c) !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more ingredientIds are invalid for this shop',
      );
    }
  }

  async listStockMovements(
    ctx: TenantContext,
    query: ListStockMovementsQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const outletScope = ctx.role === 'branch' ? ctx.outletId! : query.outletId;
    // List/aggregate endpoint — skipped when undefined (admin viewing
    // movements across every outlet), same as every other aggregate view.
    if (outletScope !== undefined) {
      await this.branchRolesService.assertPermission(
        ctx,
        outletScope,
        'products.manage_stock',
      );
    }

    const conditions = ['sm.shopId = ?'];
    const params: QueryParam[] = [ctx.shopId];
    if (query.productId) {
      conditions.push('sm.productId = ?');
      params.push(query.productId);
    }
    if (query.variantId) {
      conditions.push('sm.variantId = ?');
      params.push(query.variantId);
    }
    if (query.ingredientId) {
      conditions.push('sm.ingredientId = ?');
      params.push(query.ingredientId);
    }
    if (query.type) {
      conditions.push('sm.type = ?');
      params.push(query.type);
    }
    // A branch user is scoped to their own outlet on either side of a
    // transfer (sender or receiver); an admin filtering by outletId gets
    // the same OR-on-both-sides treatment so a transfer shows up in
    // either outlet's history, not just the "outletId" column's literal
    // meaning of "source".
    if (outletScope !== undefined) {
      conditions.push('(sm.outletId = ? OR sm.toOutletId = ?)');
      params.push(outletScope, outletScope);
    }
    const whereClause = conditions.join(' AND ');

    const countRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM stockmovement sm WHERE ${whereClause}`,
      params,
    );
    const total = Number(countRows[0].c);

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT sm.*, p.name AS productName,
              ov1.value AS variantOptionValue1, ov2.value AS variantOptionValue2, ov3.value AS variantOptionValue3,
              ing.name AS ingredientName, ing.unit AS ingredientUnit,
              o.name AS outletName, tOutlet.name AS toOutletName, actor.name AS actorName
       FROM stockmovement sm
       LEFT JOIN product p ON p.id = sm.productId
       LEFT JOIN productvariant v ON v.id = sm.variantId
       LEFT JOIN productoptionvalue ov1 ON ov1.id = v.optionValue1Id
       LEFT JOIN productoptionvalue ov2 ON ov2.id = v.optionValue2Id
       LEFT JOIN productoptionvalue ov3 ON ov3.id = v.optionValue3Id
       LEFT JOIN ingredient ing ON ing.id = sm.ingredientId
       JOIN outlet o ON o.id = sm.outletId
       LEFT JOIN outlet tOutlet ON tOutlet.id = sm.toOutletId
       LEFT JOIN user actor ON actor.id = sm.actorUserId
       WHERE ${whereClause}
       ORDER BY sm.createdAt DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return {
      data: rows.map((r) => ({
        id: r.id as number,
        // Exactly one of productId/ingredientId is ever set on a given row —
        // see schema.prisma's comment on the stockmovement model.
        productId: r.productId as number | null,
        productName: (r.productName as string | null) ?? null,
        variantId: r.variantId as number | null,
        variantLabel: r.variantId
          ? buildVariantLabel([
              r.variantOptionValue1 as string | undefined,
              r.variantOptionValue2 as string | undefined,
              r.variantOptionValue3 as string | undefined,
            ])
          : null,
        ingredientId: r.ingredientId as number | null,
        ingredientName: (r.ingredientName as string | null) ?? null,
        ingredientUnit: (r.ingredientUnit as string | null) ?? null,
        type: r.type as string,
        reason: r.reason as string | null,
        delta: r.delta as number,
        outletId: r.outletId as number,
        outletName: r.outletName as string,
        toOutletId: r.toOutletId as number | null,
        toOutletName: (r.toOutletName as string | null) ?? null,
        note: r.note as string | null,
        // null only for a CONSUMED row auto-generated by an anonymous
        // storefront checkout — see stockmovement.actorUserId's schema comment.
        actorName: (r.actorName as string | null) ?? null,
        createdAt: r.createdAt as Date,
      })),
      total,
      page,
      pageSize,
    };
  }

  // Takes an already-resolved target (see resolveShadowStockTarget) and
  // reshapes the one real outletingredientstock query back into whichever
  // response envelope the original request implied — {products:[...]} /
  // {variants:[...]} / {ingredients:[...]} — so every caller's existing
  // FE-facing response shape stays unchanged even though there's only one
  // stock table underneath now.
  private async getStockSnapshot(
    target: {
      ingredientId: number;
      productId: number | null;
      variantId: number | null;
    },
    outletIds: number[],
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT outletId, stockQuantity, lowStockThreshold FROM outletingredientstock
       WHERE ingredientId = ? AND outletId IN (${outletIds.map(() => '?').join(', ')})`,
      [target.ingredientId, ...outletIds],
    );
    if (target.variantId !== null) {
      return {
        variants: rows.map((r) => ({ ...r, variantId: target.variantId })),
      };
    }
    if (target.productId !== null) {
      return {
        products: rows.map((r) => ({ ...r, productId: target.productId })),
      };
    }
    return {
      ingredients: rows.map((r) => ({ ...r, ingredientId: target.ingredientId })),
    };
  }

  // Sets (or clears, via null) the reorder alert threshold on the relevant
  // per-outlet stock row — a pure config write, no stockmovement log entry
  // (unlike adjustStockWithReason, nothing about the actual stock quantity
  // changed) and no CAS guard needed (not a decrement). Upserts the stock
  // row with stockQuantity: 0 if one doesn't exist yet — same "the row is
  // created lazily on first touch" precedent as adjustStock's own upserts,
  // so a merchant can set a threshold before ever adjusting quantity at a
  // given outlet.
  async setLowStockThreshold(ctx: TenantContext, dto: SetLowStockThresholdDto) {
    const outletId = ctx.role === 'branch' ? ctx.outletId! : dto.outletId;
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    const outletRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [outletId, ctx.shopId],
    );
    if (outletRows.length === 0) {
      throw new BadRequestException('outletId is invalid for this shop');
    }
    await this.branchRolesService.assertPermission(
      ctx,
      outletId,
      'products.manage_stock',
    );

    const resolved = await this.resolveShadowStockTarget(ctx, dto);
    await upsert(
      this.db.pool,
      'outletingredientstock',
      {
        outletId,
        ingredientId: resolved.ingredientId,
        stockQuantity: 0,
        lowStockThreshold: dto.lowStockThreshold,
      },
      ['lowStockThreshold'],
    );

    return this.getStockSnapshot(resolved, [outletId]);
  }

  // Logs here — not separately in bulkRemove() below, which just calls this
  // in a loop — one row per product either way, single or bulk delete.
  async remove(ctx: TenantContext, id: number) {
    const product = await this.findOne(ctx, id);
    try {
      await this.db.execute(`DELETE FROM product WHERE id = ?`, [id]);
    } catch (error) {
      this.handleDbError(error);
    }
    await this.auditLogService.logCtx(ctx, {
      action: 'product.deleted',
      entityType: 'product',
      entityId: id,
      before: { name: product.name, sku: product.sku },
    });
    return { id, deleted: true };
  }

  // A single UPDATE scoped to shopId is inherently the tenant-safe shape
  // for this: any id in `productIds` that doesn't belong to this shop
  // (spoofed or otherwise) simply isn't in the WHERE match — `affectedRows`
  // only ever reflects real, owned rows, nothing leaks about ids that don't
  // belong to the caller.
  async bulkUpdateStatus(ctx: TenantContext, dto: BulkUpdateProductStatusDto) {
    const result = await this.db.execute(
      `UPDATE product SET status = ? WHERE id IN (${dto.productIds.map(() => '?').join(', ')}) AND shopId = ?`,
      [dto.status, ...dto.productIds, ctx.shopId],
    );
    // One summary row for the whole batch, not one per product — the
    // individual product ids are already in `metadata` for anyone who needs
    // them; the log's job here is "what happened", not a per-row diff.
    await this.auditLogService.logCtx(ctx, {
      action: 'product.bulk_status_changed',
      entityType: 'product',
      after: { status: dto.status },
      metadata: { productIds: dto.productIds, updated: result.affectedRows },
    });
    return { updated: result.affectedRows, requested: dto.productIds.length };
  }

  // Deliberately a loop of the existing single remove() (tenant-scoped via
  // findOne, same friendly "has order history" message via
  // handleDbError) rather than one multi-row DELETE — a single multi-row
  // DELETE would fail (and roll back) entirely if even one id hits the
  // order-history FK guard, when the correct behavior is "delete what can
  // be deleted, report what couldn't."
  async bulkRemove(ctx: TenantContext, dto: BulkProductIdsDto) {
    const results: { id: number; success: boolean; error?: string }[] = [];
    for (const id of dto.productIds) {
      try {
        await this.remove(ctx, id);
        results.push({ id, success: true });
      } catch (err) {
        results.push({
          id,
          success: false,
          error: err instanceof Error ? err.message : 'Failed to delete',
        });
      }
    }
    return { results, succeeded: results.filter((r) => r.success).length };
  }

  // Preview lives entirely client-side (the admin already has every
  // product's current price loaded in the list it's selecting rows from) —
  // this endpoint is only the authoritative commit path. It always
  // recomputes the new price itself from the DB's current value; a client
  // never gets to hand over a pre-computed "newPrice" directly, so a
  // tampered request can't set an arbitrary price under cover of a
  // percentage/fixed adjustment. Tenant-scoped the same way bulkUpdateStatus
  // is: productIds not owned by this shop just don't appear in `products`.
  async bulkUpdatePrice(ctx: TenantContext, dto: BulkPriceUpdateDto) {
    const products = await this.db.query<RowDataPacket[]>(
      `SELECT id, name, price, compareAtPrice FROM product
       WHERE id IN (${dto.productIds.map(() => '?').join(', ')}) AND shopId = ?`,
      [...dto.productIds, ctx.shopId],
    );

    const results: {
      id: number;
      name: string;
      oldPrice: string | null;
      newPrice?: string;
      success: boolean;
      error?: string;
    }[] = [];
    const updates: { id: number; newPrice: number }[] = [];

    for (const p of products) {
      const current = dto.field === 'price' ? p.price : p.compareAtPrice;
      if (current === null) {
        results.push({
          id: p.id as number,
          name: p.name as string,
          oldPrice: null,
          success: false,
          error:
            dto.field === 'compareAtPrice'
              ? 'No compare-at price set'
              : 'No price set',
        });
        continue;
      }
      const currentNum = Number(current);
      const newPriceNum =
        dto.mode === 'percentage'
          ? currentNum * (1 + dto.value / 100)
          : currentNum + dto.value;
      const rounded = Math.round(newPriceNum * 100) / 100;
      if (rounded < 0) {
        results.push({
          id: p.id as number,
          name: p.name as string,
          oldPrice: trimDecimal(String(current)),
          success: false,
          error: 'Would go below zero',
        });
        continue;
      }
      updates.push({ id: p.id as number, newPrice: rounded });
      results.push({
        id: p.id as number,
        name: p.name as string,
        oldPrice: trimDecimal(String(current)),
        newPrice: String(rounded),
        success: true,
      });
    }

    if (updates.length > 0) {
      await this.db.transaction(async (conn) => {
        for (const { id, newPrice } of updates) {
          await conn.query(
            `UPDATE product SET ${dto.field === 'price' ? 'price' : 'compareAtPrice'} = ? WHERE id = ?`,
            [newPrice, id],
          );
        }
      });
      // One summary row for the batch (field/mode/value + which ids
      // succeeded) — same reasoning as bulkUpdateStatus above.
      await this.auditLogService.logCtx(ctx, {
        action: 'product.bulk_price_changed',
        entityType: 'product',
        metadata: {
          field: dto.field,
          mode: dto.mode,
          value: dto.value,
          updated: updates.map((u) => u.id),
        },
      });
    }

    return { results, succeeded: updates.length };
  }

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
            `INSERT INTO product (shopId, name, price, compareAtPrice, costPrice, thumbnail, sku, barcode, description, vendor, productType, slug, status, trackInventory, chargeTax)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          await this.provisionShadowForProduct(conn, ctx, newProduct.id, newProduct);
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
          await this.syncShadowMeta(
            conn,
            { shadowProductId: productId },
            {
              name: group.data.name,
              thumbnail: group.data.thumbnail,
              trackInventory: group.data.trackInventory,
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
  private async applyImportStock(
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
    const resolved = await this.resolveShadowStockTarget(
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
  private async resolveTagIdsTx(
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

  // Bare product row (no relations) for internal checks that don't need the
  // full response shape — avoids re-running the heavier loaders just to
  // read e.g. current.thumbnail/current.price.
  private async findRaw(ctx: TenantContext, id: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM product WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (!rows[0]) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return rows[0];
  }

  private resolveFeaturedThumbnail(
    images: ProductImageInput[] | undefined,
    fallback: string,
  ): string {
    if (!images || images.length === 0) return fallback;
    const sorted = [...images].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return sorted[0].url;
  }

  private async assertBrandBelongsToShop(ctx: TenantContext, brandId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM brand WHERE id = ? AND shopId = ?`,
      [brandId, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new BadRequestException('brandId is invalid for this shop');
    }
  }

  private async assertCollectionsBelongToShop(
    ctx: TenantContext,
    collectionIds: number[],
  ) {
    const uniqueIds = [...new Set(collectionIds)];
    if (uniqueIds.length === 0) return;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM collection WHERE id IN (${uniqueIds.map(() => '?').join(', ')}) AND shopId = ?`,
      [...uniqueIds, ctx.shopId],
    );
    if (Number(rows[0].c) !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more collectionIds are invalid for this shop',
      );
    }
  }

  // Auto-generates a per-shop-unique slug from `base` (the product name),
  // appending -2, -3, ... on collision rather than failing — unlike sku,
  // duplicate product names are common (two "Chocolate Cake" products) and
  // shouldn't block creation. Only used on create's auto-generate path; an
  // explicitly-provided slug (create or update) is used as-is and relies on
  // the DB unique constraint to reject a real collision, same as collections.
  private async resolveUniqueSlug(
    shopId: number,
    base: string,
  ): Promise<string> {
    const root = slugify(base);
    let candidate = root;
    let suffix = 2;
    for (;;) {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM product WHERE shopId = ? AND slug = ?`,
        [shopId, candidate],
      );
      if (rows.length === 0) break;
      candidate = `${root}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private async resolveTagIds(
    ctx: TenantContext,
    names: string[],
  ): Promise<number[]> {
    const uniqueNames = [
      ...new Set(names.map((name) => name.trim()).filter(Boolean)),
    ];
    const tagIds: number[] = [];
    for (const name of uniqueNames) {
      await this.db.execute(
        `INSERT INTO tag (shopId, name) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [ctx.shopId, name],
      );
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM tag WHERE shopId = ? AND name = ?`,
        [ctx.shopId, name],
      );
      tagIds.push(rows[0].id as number);
    }
    return tagIds;
  }

  private async getUnitsSoldByProduct(shopId: number, productIds: number[]) {
    if (productIds.length === 0) return new Map<number, number>();
    const rows = await this.db.query<UnitsSoldRow[]>(
      `SELECT oi.productId AS productId, SUM(oi.quantity) AS unitsSold
       FROM orderitem oi
       JOIN \`order\` o ON o.id = oi.orderId
       WHERE o.shopId = ? AND o.status != 'cancelled'
         AND oi.productId IN (${productIds.map(() => '?').join(', ')})
       GROUP BY oi.productId`,
      [shopId, ...productIds],
    );
    return new Map(rows.map((r) => [r.productId, Number(r.unitsSold ?? 0)]));
  }

  // Batch-loads every relation productInclude used to fetch in one Prisma
  // nested include, as separate WHERE...IN queries grouped in JS — see
  // loadVariantsWithRelations/loadIngredientLinks below for the two
  // sub-loaders this composes. Returns a Map so callers (findAll/findOne/
  // update/duplicate) can look up by id without re-querying.
  private async loadProductsWithRelations(
    productIds: number[],
    outletId: number | undefined,
  ): Promise<Map<number, AssembledProduct>> {
    const result = new Map<number, AssembledProduct>();
    if (productIds.length === 0) return result;
    const idList = productIds.map(() => '?').join(', ');

    const [
      products,
      collectionLinks,
      tagLinks,
      images,
      attributes,
      faqs,
      options,
      variants,
      productIngredients,
    ] = await Promise.all([
      this.db.query<RowDataPacket[]>(`SELECT * FROM product WHERE id IN (${idList})`, productIds),
      this.db.query<RowDataPacket[]>(
        `SELECT pc.productId, c.* FROM productcollection pc JOIN collection c ON c.id = pc.collectionId WHERE pc.productId IN (${idList})`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT pt.productId, t.name AS tagName FROM producttag pt JOIN tag t ON t.id = pt.tagId WHERE pt.productId IN (${idList})`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT * FROM productimage WHERE productId IN (${idList}) ORDER BY \`order\` ASC`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT * FROM productattribute WHERE productId IN (${idList}) ORDER BY \`order\` ASC`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT * FROM productfaq WHERE productId IN (${idList}) ORDER BY \`order\` ASC`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT po.*, pov.id AS valueId, pov.value AS valueValue, pov.order AS valueOrder
         FROM productoption po
         LEFT JOIN productoptionvalue pov ON pov.optionId = po.id
         WHERE po.productId IN (${idList})
         ORDER BY po.\`order\` ASC, pov.\`order\` ASC`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT id, productId FROM productvariant WHERE productId IN (${idList}) ORDER BY \`order\` ASC`,
        productIds,
      ),
      this.loadIngredientLinks(
        `productId IN (${idList}) AND variantId IS NULL`,
        productIds,
        outletId,
      ),
    ]);

    const collectionsByProduct = new Map<number, { collection: RowDataPacket }[]>();
    for (const row of collectionLinks) {
      const list = collectionsByProduct.get(row.productId as number) ?? [];
      list.push({ collection: row });
      collectionsByProduct.set(row.productId as number, list);
    }
    const tagsByProduct = new Map<number, { tag: { name: string } }[]>();
    for (const row of tagLinks) {
      const list = tagsByProduct.get(row.productId as number) ?? [];
      list.push({ tag: { name: row.tagName as string } });
      tagsByProduct.set(row.productId as number, list);
    }
    const imagesByProduct = new Map<number, RowDataPacket[]>();
    for (const row of images) {
      const list = imagesByProduct.get(row.productId as number) ?? [];
      list.push(row);
      imagesByProduct.set(row.productId as number, list);
    }
    const attributesByProduct = new Map<number, RowDataPacket[]>();
    for (const row of attributes) {
      const list = attributesByProduct.get(row.productId as number) ?? [];
      list.push(row);
      attributesByProduct.set(row.productId as number, list);
    }
    const faqsByProduct = new Map<number, RowDataPacket[]>();
    for (const row of faqs) {
      const list = faqsByProduct.get(row.productId as number) ?? [];
      list.push(row);
      faqsByProduct.set(row.productId as number, list);
    }
    const optionsByProduct = new Map<
      number,
      Map<number, { id: number; name: string; order: number; productoptionvalue: { id: number; value: string; order: number }[] }>
    >();
    for (const row of options) {
      const pid = row.productId as number;
      const optMap = optionsByProduct.get(pid) ?? new Map();
      const opt = optMap.get(row.id as number) ?? {
        id: row.id as number,
        name: row.name as string,
        order: row.order as number,
        productoptionvalue: [],
      };
      if (row.valueId != null) {
        opt.productoptionvalue.push({
          id: row.valueId as number,
          value: row.valueValue as string,
          order: row.valueOrder as number,
        });
      }
      optMap.set(opt.id, opt);
      optionsByProduct.set(pid, optMap);
    }

    const brandIds = [
      ...new Set(
        products
          .map((p) => p.brandId as number | null)
          .filter((b): b is number => b != null),
      ),
    ];
    const variantIds = variants.map((v) => v.id as number);
    const [assembledVariants, variantIngredients, brandRows] = await Promise.all([
      this.loadVariantsWithRelations(variantIds, outletId),
      this.loadIngredientLinks(
        variantIds.length
          ? `variantId IN (${variantIds.map(() => '?').join(', ')})`
          : '1 = 0',
        variantIds,
        outletId,
      ),
      brandIds.length
        ? this.db.query<BrandLiteRow[]>(
            `SELECT id, name, logoUrl FROM brand WHERE id IN (${brandIds
              .map(() => '?')
              .join(', ')})`,
            brandIds,
          )
        : Promise.resolve([] as BrandLiteRow[]),
    ]);
    const brandById = new Map(
      brandRows.map((b) => [
        b.id,
        { id: b.id, name: b.name, logoUrl: b.logoUrl },
      ]),
    );
    const variantsByProduct = new Map<number, AssembledVariant[]>();
    for (const v of variants) {
      const list = variantsByProduct.get(v.productId as number) ?? [];
      list.push(assembledVariants.get(v.id as number)!);
      variantsByProduct.set(v.productId as number, list);
    }
    void variantIngredients; // already folded into assembledVariants via loadVariantsWithRelations

    const productIngredientsByProduct = new Map<number, AssembledIngredientLink[]>();
    for (const row of productIngredients) {
      const list = productIngredientsByProduct.get(row.productId) ?? [];
      list.push(this.rowToIngredientLink(row));
      productIngredientsByProduct.set(row.productId, list);
    }

    for (const p of products) {
      const id = p.id as number;
      result.set(id, {
        ...(p as unknown as Record<string, unknown>),
        id,
        shopId: p.shopId as number,
        name: p.name as string,
        price: trimDecimal(p.price as string),
        compareAtPrice: trimDecimal(p.compareAtPrice as string | null),
        costPrice: trimDecimal(p.costPrice as string | null),
        weight: trimDecimal(p.weight as string | null),
        giftCardCustomAmountMin: trimDecimal(p.giftCardCustomAmountMin as string | null),
        giftCardCustomAmountMax: trimDecimal(p.giftCardCustomAmountMax as string | null),
        thumbnail: p.thumbnail as string,
        sku: p.sku as string,
        usesIngredients: Boolean(p.usesIngredients),
        brandId: (p.brandId as number | null) ?? null,
        brand:
          p.brandId != null ? (brandById.get(p.brandId as number) ?? null) : null,
        productcollection: collectionsByProduct.get(id) ?? [],
        producttag: tagsByProduct.get(id) ?? [],
        productimage: (imagesByProduct.get(id) ?? []).map((i) => ({
          id: i.id as number,
          url: i.url as string,
          order: i.order as number,
        })),
        productattribute: (attributesByProduct.get(id) ?? []).map((a) => ({
          id: a.id as number,
          name: a.name as string,
          value: a.value as string,
          order: a.order as number,
        })),
        productfaq: (faqsByProduct.get(id) ?? []).map((f) => ({
          id: f.id as number,
          question: f.question as string,
          answer: f.answer as string,
          order: f.order as number,
        })),
        productoption: [...(optionsByProduct.get(id)?.values() ?? [])],
        productvariant: variantsByProduct.get(id) ?? [],
        productingredient: productIngredientsByProduct.get(id) ?? [],
      } as unknown as AssembledProduct);
    }
    return result;
  }

  // Sub-loader for a set of variant ids — used both standalone
  // (updateVariant's response) and as part of loadProductsWithRelations.
  private async loadVariantsWithRelations(
    variantIds: number[],
    outletId: number | undefined,
  ): Promise<Map<number, AssembledVariant>> {
    const result = new Map<number, AssembledVariant>();
    if (variantIds.length === 0) return result;
    const idList = variantIds.map(() => '?').join(', ');

    const [rows, ingredientLinks] = await Promise.all([
      this.db.query<VariantRow[]>(
        `SELECT v.*, img.url AS imageUrl,
                ov1.value AS optionValue1Value, ov2.value AS optionValue2Value, ov3.value AS optionValue3Value
         FROM productvariant v
         LEFT JOIN productimage img ON img.id = v.imageId
         LEFT JOIN productoptionvalue ov1 ON ov1.id = v.optionValue1Id
         LEFT JOIN productoptionvalue ov2 ON ov2.id = v.optionValue2Id
         LEFT JOIN productoptionvalue ov3 ON ov3.id = v.optionValue3Id
         WHERE v.id IN (${idList})`,
        variantIds,
      ),
      this.loadIngredientLinks(
        `variantId IN (${idList})`,
        variantIds,
        outletId,
      ),
    ]);
    const ingredientsByVariant = new Map<number, AssembledIngredientLink[]>();
    for (const row of ingredientLinks) {
      const vId = row.variantId as number;
      const list = ingredientsByVariant.get(vId) ?? [];
      list.push(this.rowToIngredientLink(row));
      ingredientsByVariant.set(vId, list);
    }

    for (const v of rows) {
      result.set(v.id, {
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        price: trimDecimal(v.price),
        compareAtPrice: trimDecimal(v.compareAtPrice),
        weight: trimDecimal(v.weight),
        imageId: v.imageId,
        image: v.imageUrl !== null ? { url: v.imageUrl } : null,
        order: v.order,
        optionValue1Id: v.optionValue1Id,
        optionValue1: v.optionValue1Value !== null ? { value: v.optionValue1Value } : null,
        optionValue2Id: v.optionValue2Id,
        optionValue2: v.optionValue2Value !== null ? { value: v.optionValue2Value } : null,
        optionValue3Id: v.optionValue3Id,
        optionValue3: v.optionValue3Value !== null ? { value: v.optionValue3Value } : null,
        productingredient: ingredientsByVariant.get(v.id) ?? [],
      });
    }
    return result;
  }

  // Shared by loadProductsWithRelations (product-level default rows,
  // variantId IS NULL) and loadVariantsWithRelations (a variant's own
  // override rows) — joins in the ingredient's own fields plus (only when
  // outletId is resolved) its live stock at that outlet, needed for the
  // effective-makeable-quantity display.
  private async loadIngredientLinks(
    whereSql: string,
    whereParams: QueryParam[],
    outletId: number | undefined,
  ): Promise<IngredientLinkRow[]> {
    if (whereParams.length === 0) return [];
    const stockJoin =
      outletId !== undefined
        ? `LEFT JOIN outletingredientstock ois ON ois.ingredientId = ing.id AND ois.outletId = ?`
        : '';
    const stockColumns =
      outletId !== undefined
        ? `ois.stockQuantity AS stockQuantity, ois.lowStockThreshold AS lowStockThreshold`
        : `NULL AS stockQuantity, NULL AS lowStockThreshold`;
    // outletId's `?` (in the JOIN clause) appears before whereSql's `?`s (in
    // the WHERE clause) in the SQL text below — params must be in that same
    // order since .query() binds positionally, not by clause.
    const params = outletId !== undefined ? [outletId, ...whereParams] : whereParams;
    return this.db.query<IngredientLinkRow[]>(
      `SELECT pi.id, pi.productId, pi.variantId, pi.ingredientId, pi.quantityPerUnit,
              ing.name AS ingredientName, ing.unit AS ingredientUnit, ing.trackInventory AS ingredientTrackInventory,
              ${stockColumns}
       FROM productingredient pi
       JOIN ingredient ing ON ing.id = pi.ingredientId
       ${stockJoin}
       WHERE pi.${whereSql}
       ORDER BY pi.id ASC`,
      params,
    );
  }

  private rowToIngredientLink(row: IngredientLinkRow): AssembledIngredientLink {
    return {
      id: row.id,
      productId: row.productId,
      variantId: row.variantId,
      ingredientId: row.ingredientId,
      quantityPerUnit: row.quantityPerUnit,
      ingredient: {
        name: row.ingredientName,
        unit: row.ingredientUnit,
        trackInventory: Boolean(row.ingredientTrackInventory),
        ...(row.stockQuantity !== null && {
          outletingredientstock: [
            { stockQuantity: row.stockQuantity, lowStockThreshold: row.lowStockThreshold },
          ],
        }),
      },
    };
  }

  private toResponse(product: AssembledProduct, totalSold = 0) {
    const {
      productcollection,
      producttag,
      productimage,
      productattribute,
      productfaq,
      productoption,
      productvariant,
      productingredient,
      ...rest
    } = product;
    const options = productoption.map((o) => ({
      id: o.id,
      name: o.name,
      order: o.order,
      values: o.productoptionvalue.map((v) => ({
        id: v.id,
        value: v.value,
        order: v.order,
      })),
    }));
    const availability = this.computeIngredientAvailability(productingredient);
    // A usesIngredients:false product's own recipe is always exactly its
    // one auto-managed shadow row (quantityPerUnit: 1) — never shown to the
    // merchant as "ingredients" (see ingredient.shadowProductId's schema
    // comment); the shadow row's own outletingredientstock.lowStockThreshold
    // is this product's real low-stock alert setting. A usesIngredients:true
    // product has no single meaningful threshold across a multi-ingredient
    // recipe — merchants set thresholds per-ingredient on the Ingredients
    // page instead, so this is permanently null here.
    const lowStockThreshold = rest.usesIngredients
      ? null
      : (productingredient[0]?.ingredient.outletingredientstock?.[0]
          ?.lowStockThreshold ?? null);
    return {
      ...rest,
      collections: productcollection.map((pc) => pc.collection),
      tags: producttag.map((pt) => pt.tag.name),
      images: productimage.map((i) => ({
        id: i.id,
        url: i.url,
        order: i.order,
      })),
      attributes: productattribute.map((a) => ({
        id: a.id,
        name: a.name,
        value: a.value,
        order: a.order,
      })),
      faqs: productfaq.map((f) => ({
        id: f.id,
        question: f.question,
        answer: f.answer,
        order: f.order,
      })),
      hasVariants: options.length > 0,
      options,
      variants: productvariant.map((v) =>
        this.toVariantResponse(v, productingredient, rest.usesIngredients as boolean),
      ),
      // Ingredient-derived (Phase A) — makeableQuantity below is now the
      // SAME computation, since a shadow product's "recipe" is always
      // exactly one ingredient at quantityPerUnit 1 (floor(stock/1) =
      // stock). null when no outlet was resolved for this request (e.g. an
      // admin viewing the catalog without picking a branch) — distinct from
      // 0, which means "this outlet genuinely has none in stock".
      stockQuantity: availability.makeableQuantity,
      lowStockThreshold,
      totalSold,
      // This product's own default recipe (variantId: null rows only; see
      // productIngredientIncludeFor) — empty for a usesIngredients:false
      // product, whose one row is its own internal shadow link, never
      // merchant-authored/editable. A variant's effective recipe (its own
      // override, or this same default) is on each variant response
      // instead — see toVariantResponse.
      ingredients: rest.usesIngredients
        ? productingredient.map((pi) => this.toIngredientLinkResponse(pi))
        : [],
      // Ingredient-stock-derived, same computation as stockQuantity above —
      // kept as a separate field for the admin UI's existing
      // "makeableQuantity < stockQuantity" amber-warning comparison
      // (structurally always equal for a shadow product now; only a real
      // multi-ingredient recipe can ever differ). null when no recipe row
      // exists at all, or no outlet was resolved for this request.
      makeableQuantity: availability.makeableQuantity,
      limitedByIngredient: availability.limitedByIngredient,
    };
  }

  private toVariantResponse(
    v: AssembledVariant,
    productDefaultIngredients: AssembledIngredientLink[],
    usesIngredients: boolean,
  ) {
    // A variant with its own override rows (its own shadow, when
    // usesIngredients:false and this product has variants, or a real
    // merchant-authored override) uses exactly those; one with none
    // inherits the product-level default wholesale (not merged
    // ingredient-by-ingredient — setting ANY override row for a variant
    // means that variant's recipe is now fully described by its own rows).
    const effectiveIngredientRows =
      v.productingredient.length > 0
        ? v.productingredient
        : productDefaultIngredients;
    const availability = this.computeIngredientAvailability(
      effectiveIngredientRows,
    );
    const lowStockThreshold = usesIngredients
      ? null
      : (v.productingredient[0]?.ingredient.outletingredientstock?.[0]
          ?.lowStockThreshold ?? null);
    return {
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      weight: v.weight,
      imageId: v.imageId,
      imageUrl: v.image?.url ?? null,
      order: v.order,
      optionValue1Id: v.optionValue1Id,
      optionValue2Id: v.optionValue2Id,
      optionValue3Id: v.optionValue3Id,
      label: buildVariantLabel([
        v.optionValue1?.value,
        v.optionValue2?.value,
        v.optionValue3?.value,
      ]),
      stockQuantity: availability.makeableQuantity,
      lowStockThreshold,
      // This variant's own override rows only (empty when it has none and
      // simply inherits the product default), and never the internal
      // shadow row for a usesIngredients:false variant — same "never shown
      // as a merchant-editable ingredient" reasoning as toResponse's
      // `ingredients` field above.
      ingredientOverrides: usesIngredients
        ? v.productingredient.map((pi) => this.toIngredientLinkResponse(pi))
        : [],
      makeableQuantity: availability.makeableQuantity,
      limitedByIngredient: availability.limitedByIngredient,
    };
  }

  private toIngredientLinkResponse(pi: AssembledIngredientLink) {
    return {
      id: pi.id,
      ingredientId: pi.ingredientId,
      ingredientName: pi.ingredient.name,
      ingredientUnit: pi.ingredient.unit,
      quantityPerUnit: pi.quantityPerUnit,
    };
  }

  // Informational only (see toResponse's own comment on why this doesn't
  // gate anything yet) — the smallest "stock at this outlet ÷ quantityPerUnit"
  // across every *tracked* ingredient the effective recipe references is how
  // many more units could actually be made, independent of the product/
  // variant's own stock number. null (not 0/Infinity) whenever the number
  // can't be computed: no recipe defined at all (unconstrained — today's
  // behavior), or no outlet was resolved for this request (ingredient stock
  // wasn't fetched — see loadIngredientLinks).
  private computeIngredientAvailability(
    rows: AssembledIngredientLink[],
  ): { makeableQuantity: number | null; limitedByIngredient: string | null } {
    const trackedRows = rows.filter((r) => r.ingredient.trackInventory);
    if (trackedRows.length === 0)
      return { makeableQuantity: null, limitedByIngredient: null };

    let makeableQuantity = Infinity;
    let limitedByIngredient: string | null = null;
    for (const row of trackedRows) {
      const stockRow = row.ingredient.outletingredientstock?.[0];
      if (!stockRow)
        return { makeableQuantity: null, limitedByIngredient: null };
      const possible = Math.floor(stockRow.stockQuantity / row.quantityPerUnit);
      if (possible < makeableQuantity) {
        makeableQuantity = possible;
        limitedByIngredient = row.ingredient.name;
      }
    }
    return { makeableQuantity, limitedByIngredient };
  }

  // Shared by OrdersService/PublicService order creation — validates that
  // every item references a real product for this shop, that variant-bearing
  // products get a variantId (and non-variant ones don't), and resolves the
  // effective price + a human-readable variantLabel snapshot for each line.
  // Doesn't touch stock — callers pass the resolved items (incl. the
  // allowNegative flag below) into consumeForOrderItems themselves
  // (storefront checkout needs a CAS guard, admin-entered orders defer the
  // decrement to confirmation — see orders.service.ts).
  async resolveOrderItems(
    shopId: number,
    items: {
      productId: number;
      quantity: number;
      variantId?: number;
      priceOverride?: number;
      giftCardAmount?: number;
    }[],
  ) {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM product WHERE id IN (${productIds.map(() => '?').join(', ')}) AND shopId = ?`,
      [...productIds, shopId],
    );
    if (products.length !== productIds.length) {
      throw new BadRequestException(
        'One or more items reference a product that does not belong to this shop',
      );
    }
    const optionCountRows = await this.db.query<RowDataPacket[]>(
      `SELECT productId, COUNT(*) AS c FROM productoption WHERE productId IN (${productIds.map(() => '?').join(', ')}) GROUP BY productId`,
      productIds,
    );
    const optionCountByProduct = new Map(
      optionCountRows.map((r) => [r.productId as number, Number(r.c)]),
    );
    const productsById = new Map(products.map((p) => [p.id as number, p]));

    // Auto-apply discounts ("applies automatically to every matching cart,
    // no code needed") must be resolved server-side, never trusted from a
    // client-computed display price — this is the actual source of truth
    // storefront/lib/auto-discounts.ts's computeAutoDiscountedPrice mirrors
    // for display only. One shop-wide fetch (not per item) + one collection
    // lookup, reused by DiscountsService.findBestAutoDiscountAmount below.
    const autoDiscounts =
      await this.discountsService.listActiveAutoDiscounts(shopId);
    const collectionRows = autoDiscounts.length
      ? await this.db.query<RowDataPacket[]>(
          `SELECT productId, collectionId FROM productcollection WHERE productId IN (${productIds.map(() => '?').join(', ')})`,
          productIds,
        )
      : [];
    const collectionIdsByProduct = new Map<number, number[]>();
    for (const row of collectionRows) {
      const pid = row.productId as number;
      const list = collectionIdsByProduct.get(pid) ?? [];
      list.push(row.collectionId as number);
      collectionIdsByProduct.set(pid, list);
    }

    const variantIds = [
      ...new Set(
        items.filter((i) => i.variantId !== undefined).map((i) => i.variantId!),
      ),
    ];
    const variants = variantIds.length
      ? await this.db.query<RowDataPacket[]>(
          `SELECT v.*, ov1.value AS optionValue1Value, ov2.value AS optionValue2Value, ov3.value AS optionValue3Value
           FROM productvariant v
           LEFT JOIN productoptionvalue ov1 ON ov1.id = v.optionValue1Id
           LEFT JOIN productoptionvalue ov2 ON ov2.id = v.optionValue2Id
           LEFT JOIN productoptionvalue ov3 ON ov3.id = v.optionValue3Id
           WHERE v.id IN (${variantIds.map(() => '?').join(', ')})`,
          variantIds,
        )
      : [];
    const variantsById = new Map(variants.map((v) => [v.id as number, v]));

    return items.map((item) => {
      const product = productsById.get(item.productId)!;
      const hasVariants = (optionCountByProduct.get(item.productId) ?? 0) > 0;
      let variant: RowDataPacket | null = null;
      if (hasVariants) {
        if (item.variantId === undefined) {
          throw new BadRequestException(
            `${product.name as string} requires selecting an option before ordering`,
          );
        }
        const found = variantsById.get(item.variantId);
        if (!found || found.productId !== product.id) {
          throw new BadRequestException(
            `Invalid variant selected for ${product.name as string}`,
          );
        }
        variant = found;
      } else if (item.variantId !== undefined) {
        throw new BadRequestException(
          `${product.name as string} does not have variant options`,
        );
      }

      // Gift Cards: the product's own `price` is a placeholder — the real
      // amount is whichever denomination/custom value the shopper picked,
      // supplied per-line as giftCardAmount. Unlike priceOverride (below),
      // this IS accepted from the public storefront DTO, but only ever for
      // a product actually flagged isGiftCard, and only ever a value the
      // merchant actually configured (one of giftCardDenominations, or
      // within the custom-amount min/max) — never an arbitrary customer-
      // supplied price the way a bare priceOverride would be.
      let price: string;
      let autoDiscountAmount: string | null = null;
      if (product.isGiftCard) {
        if (item.giftCardAmount === undefined) {
          throw new BadRequestException(
            `${product.name as string} requires choosing a gift card amount`,
          );
        }
        this.assertValidGiftCardAmount(product, item.giftCardAmount);
        price = String(item.giftCardAmount);
      } else if (item.giftCardAmount !== undefined) {
        throw new BadRequestException(
          `${product.name as string} is not a gift card product`,
        );
      } else if (item.priceOverride !== undefined) {
        // Admin-only override (draft orders / manual phone-order price
        // adjustments) — see CreateOrderDto.items.priceOverride. Never
        // exposed on the public/storefront item DTO, so a storefront
        // customer can never set their own price this way. An explicit
        // override always wins over an auto-discount, same as it already
        // wins over the plain catalog price.
        price = String(item.priceOverride);
      } else {
        const basePrice =
          (variant?.price as string | undefined) ?? (product.price as string);
        const discountAmount = autoDiscounts.length
          ? this.discountsService.findBestAutoDiscountAmount(autoDiscounts, {
              productId: item.productId,
              price: Number(basePrice),
              collectionIds: collectionIdsByProduct.get(item.productId) ?? [],
            })
          : 0;
        if (discountAmount > 0) {
          autoDiscountAmount = String(discountAmount);
          price = String(Number(basePrice) - discountAmount);
        } else {
          price = basePrice;
        }
      }

      return {
        product,
        variant,
        quantity: item.quantity,
        price,
        autoDiscountAmount,
        variantLabel: variant
          ? buildVariantLabel([
              variant.optionValue1Value as string | undefined,
              variant.optionValue2Value as string | undefined,
              variant.optionValue3Value as string | undefined,
            ])
          : null,
        // Threaded into consumeForOrderItems so a product/variant that
        // opted out of stock tracking entirely, or explicitly allows
        // overselling, never blocks (or is blocked by) a stricter sibling
        // item in the same cart — see consumeForOrderItems's own comment on
        // why this has to be per-item, not one flag for the whole call.
        allowNegative: !product.trackInventory || product.continueSellingOutOfStock,
      };
    });
  }

  // Bill of Materials — the actual ingredient-stock side effect of a sale.
  // Called from the exact same points product stock itself is
  // decremented/restocked (never a separate trigger — see each call site):
  // PublicService.createOrder and OrdersService.create's reserveStock path
  // (immediate reservation at creation, direction -1), and
  // OrdersService.adjustStockForOrder (the pending->confirmed decrement for
  // every other channel, direction -1; and every cancel-restock, direction
  // +1). Returns whether anything was actually consumed, so the caller can
  // set order.ingredientsConsumedAt — read back on restock instead of
  // re-deriving it from the toggle, see that column's own schema comment.
  //
  // Toggle gating is intentionally asymmetric by direction: direction -1 is
  // a fresh "should this fire at all" decision, so it re-checks
  // shop.autoDeductIngredientStock itself right here — not just relying on
  // an upstream pre-filter having already checked it, the exact class of
  // bug already caught twice in this codebase (AbandonedCartsService,
  // LowStockDigestService) when a toggle check lived only in the outer
  // caller. direction +1 is never a new policy decision, only ever
  // reversing one specific order's own already-recorded consumption — the
  // caller is responsible for only invoking it when
  // order.ingredientsConsumedAt says that really happened, regardless of
  // what the toggle reads *now*; re-checking the toggle here too would
  // silently skip a restock for an order that genuinely did consume stock
  // under an since-disabled toggle, corrupting the count in the opposite
  // direction.
  async consumeForOrderItems(
    conn: PoolConnection,
    shopId: number,
    outletId: number,
    items: {
      productId: number;
      variantId: number | null;
      quantity: number;
      // Per-item, not one flag for the whole call — a product that opted
      // out of stock tracking (trackInventory: false) or explicitly allows
      // overselling (continueSellingOutOfStock) must never block, and must
      // never BE blocked by, a stricter sibling item in the same
      // cart/order. Defaults false when the caller doesn't resolve it via
      // resolveOrderItems (every restock/return caller — going negative was
      // never possible to guard against on a restock anyway).
      allowNegative?: boolean;
    }[],
    direction: 1 | -1,
    options: {
      throwOnInsufficientStock: boolean;
      actorUserId: number | null;
      // 'CONSUMED' (default) for every order-lifecycle caller; 'RETURN' for
      // ReturnsService so a customer return stays distinguishable from an
      // order cancellation in Movement History, same audit-trail
      // distinction this table already draws between ADJUSTMENT/TRANSFER.
      movementType?: string;
      // Defaults to null (every order-lifecycle caller). ReturnsService
      // passes a real note referencing which return caused the restock —
      // same audit-trail detail its own direct outletstock/outletvariantstock
      // upsert used to carry before Phase A collapsed onto this function.
      note?: string | null;
      // Defaults to null. ReturnsService passes the return's own reason —
      // same field its own inline stockmovement.create already populated
      // for a RETURN row before Phase A (a deliberate, pre-existing
      // deviation from this column's "ADJUSTMENT only" schema comment, not
      // introduced here).
      reason?: string | null;
    },
  ): Promise<boolean> {
    if (direction === -1) {
      const [shopRows] = await conn.query<RowDataPacket[]>(
        `SELECT autoDeductIngredientStock FROM shop WHERE id = ?`,
        [shopId],
      );
      if (!Boolean(shopRows[0]?.autoDeductIngredientStock)) return false;
    }

    const productIds = [...new Set(items.map((i) => i.productId))];
    if (productIds.length === 0) return false;
    const [recipeRows] = await conn.query<RowDataPacket[]>(
      `SELECT pi.id, pi.productId, pi.variantId, pi.ingredientId, pi.quantityPerUnit,
              ing.name AS ingredientName, ing.trackInventory AS ingredientTrackInventory,
              ing.shadowProductId AS ingredientShadowProductId, ing.shadowVariantId AS ingredientShadowVariantId
       FROM productingredient pi
       JOIN ingredient ing ON ing.id = pi.ingredientId
       WHERE pi.productId IN (${productIds.map(() => '?').join(', ')})`,
      productIds,
    );
    if (recipeRows.length === 0) return false;

    const rowsByProduct = new Map<number, RowDataPacket[]>();
    for (const row of recipeRows) {
      const pid = row.productId as number;
      if (!rowsByProduct.has(pid)) rowsByProduct.set(pid, []);
      rowsByProduct.get(pid)!.push(row);
    }
    const movementType = options.movementType ?? 'CONSUMED';

    let consumedAnything = false;
    for (const item of items) {
      const rowsForProduct = rowsByProduct.get(item.productId);
      if (!rowsForProduct) continue;
      // Same effective-recipe rule as resolveEffectiveRecipeRows below, just
      // inlined — that generic doesn't structurally accept RowDataPacket's
      // index-signature shape as satisfying its `{variantId}` constraint.
      const variantOverrides =
        item.variantId !== null
          ? rowsForProduct.filter((r) => r.variantId === item.variantId)
          : [];
      const effectiveRows =
        variantOverrides.length > 0
          ? variantOverrides
          : rowsForProduct.filter((r) => r.variantId === null);
      for (const row of effectiveRows) {
        if (!Boolean(row.ingredientTrackInventory)) continue;
        const totalQty = (row.quantityPerUnit as number) * item.quantity;
        const delta = direction * totalQty;
        consumedAnything = true;

        if (
          direction === -1 &&
          options.throwOnInsufficientStock &&
          !item.allowNegative
        ) {
          const result = await conn.query(
            `UPDATE outletingredientstock SET stockQuantity = stockQuantity - ?
             WHERE outletId = ? AND ingredientId = ? AND stockQuantity >= ?`,
            [totalQty, outletId, row.ingredientId, totalQty],
          );
          if ((result[0] as { affectedRows: number }).affectedRows === 0) {
            throw new ConflictException(
              `Not enough ${row.ingredientName as string} in stock to fulfill this order`,
            );
          }
        } else {
          // Matches product stock's own adjustStockForOrder behavior at
          // this exact point (the confirm-transition decrement and every
          // restock): an atomic increment, no floor guard — deliberately
          // not stricter for ingredients than the codebase already is for
          // product stock at this same trigger point.
          await conn.query(
            `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE stockQuantity = stockQuantity + VALUES(stockQuantity)`,
            [outletId, row.ingredientId, delta],
          );
        }

        // Shadow-resolved (Phase A): set productId/variantId alongside
        // ingredientId so Movement History's existing productId filter
        // keeps working for a usesIngredients:false product/variant — see
        // stockmovement's own schema comment on this exception. A REAL
        // ingredient consumed by a multi-ingredient recipe keeps the
        // original ingredientId-only shape.
        const isShadow =
          row.ingredientShadowProductId !== null ||
          row.ingredientShadowVariantId !== null;
        await conn.query(
          `INSERT INTO stockmovement (shopId, productId, variantId, ingredientId, type, reason, delta, outletId, toOutletId, note, actorUserId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shopId,
            isShadow ? item.productId : null,
            isShadow ? row.variantId : null,
            row.ingredientId,
            movementType,
            options.reason ?? null,
            delta,
            outletId,
            null,
            options.note ?? null,
            options.actorUserId,
          ],
        );
      }
    }
    return consumedAnything;
  }

  // A variant's own override rows take over its recipe wholesale when any
  // exist; otherwise it inherits the product-level default (variantId:
  // null) rows — same rule as toVariantResponse's own effective-recipe
  // resolution, just operating on plain rows instead of API response shapes.
  private resolveEffectiveRecipeRows<T extends { variantId: number | null }>(
    rows: T[],
    variantId: number | null,
  ): T[] {
    if (variantId !== null) {
      const overrides = rows.filter((r) => r.variantId === variantId);
      if (overrides.length > 0) return overrides;
    }
    return rows.filter((r) => r.variantId === null);
  }

  private assertValidGiftCardAmount(
    product: RowDataPacket,
    amount: number,
  ) {
    if (amount <= 0) {
      throw new BadRequestException(
        'Gift card amount must be greater than zero',
      );
    }
    const denominationsRaw = product.giftCardDenominations as unknown;
    const denominations = Array.isArray(denominationsRaw)
      ? (denominationsRaw as number[])
      : [];
    if (denominations.includes(amount)) return;
    const min = product.giftCardCustomAmountMin as string | null;
    const max = product.giftCardCustomAmountMax as string | null;
    if (min !== null && max !== null) {
      if (amount >= Number(min) && amount <= Number(max)) return;
    }
    throw new BadRequestException(
      `${amount} is not a valid gift card amount for ${product.name as string}`,
    );
  }

  private async attachOutletStockBreakdown(
    shopId: number,
    response: ReturnType<ProductsService['toResponse']>,
  ) {
    const outlets = await this.db.query<RowDataPacket[]>(
      `SELECT id, name FROM outlet WHERE shopId = ? ORDER BY id ASC`,
      [shopId],
    );

    // A usesIngredients:true product has no single stock number per outlet
    // across a multi-ingredient recipe — same "no per-product low-stock
    // alerting" boundary as toResponse's lowStockThreshold. Per-ingredient
    // breakdown is still available via the Ingredients page.
    if ((response as any).usesIngredients) {
      (response as any).stockByOutlet = [];
      for (const v of response.variants as any[]) v.stockByOutlet = [];
      return;
    }

    const productShadowRows =
      response.variants.length === 0
        ? await this.db.query<RowDataPacket[]>(
            `SELECT id FROM ingredient WHERE shadowProductId = ?`,
            [response.id],
          )
        : [];
    const productShadow = productShadowRows[0];
    const productStockByOutlet = productShadow
      ? new Map(
          (
            await this.db.query<RowDataPacket[]>(
              `SELECT outletId, stockQuantity FROM outletingredientstock WHERE ingredientId = ?`,
              [productShadow.id],
            )
          ).map((s) => [s.outletId as number, s.stockQuantity as number]),
        )
      : new Map<number, number>();
    (response as any).stockByOutlet = outlets.map((o) => ({
      outletId: o.id,
      outletName: o.name,
      stockQuantity: productStockByOutlet.get(o.id as number) ?? 0,
    }));

    if (response.variants.length === 0) return;
    const variantIds = response.variants.map((v) => v.id);
    const variantShadows = await this.db.query<RowDataPacket[]>(
      `SELECT id, shadowVariantId FROM ingredient WHERE shadowVariantId IN (${variantIds.map(() => '?').join(', ')})`,
      variantIds,
    );
    const shadowIngredientIdByVariant = new Map(
      variantShadows.map((s) => [s.shadowVariantId as number, s.id as number]),
    );
    const variantStock = variantShadows.length
      ? await this.db.query<RowDataPacket[]>(
          `SELECT outletId, ingredientId, stockQuantity FROM outletingredientstock WHERE ingredientId IN (${variantShadows.map(() => '?').join(', ')})`,
          variantShadows.map((s) => s.id),
        )
      : [];
    const byIngredient = new Map<number, Map<number, number>>();
    for (const row of variantStock) {
      const ingId = row.ingredientId as number;
      if (!byIngredient.has(ingId)) byIngredient.set(ingId, new Map());
      byIngredient.get(ingId)!.set(row.outletId as number, row.stockQuantity as number);
    }
    for (const v of response.variants as any[]) {
      const shadowIngredientId = shadowIngredientIdByVariant.get(v.id as number);
      const m =
        (shadowIngredientId !== undefined && byIngredient.get(shadowIngredientId)) ||
        new Map<number, number>();
      v.stockByOutlet = outlets.map((o) => ({
        outletId: o.id,
        outletName: o.name,
        stockQuantity: m.get(o.id as number) ?? 0,
      }));
    }
  }

  private handleDbError(error: unknown): never {
    if (isDuplicateKeyError(error)) {
      const message = error instanceof Error ? error.message : '';
      if (message.toLowerCase().includes('slug')) {
        throw new ConflictException('A product with this slug already exists');
      }
      throw new ConflictException('A product with this SKU already exists');
    }
    if (
      error instanceof Error &&
      'errno' in error &&
      (error as { errno: number }).errno === 1451
    ) {
      throw new ConflictException(
        'This product has order history and cannot be deleted — mark it Unavailable instead',
      );
    }
    throw error;
  }
}

// Case-insensitive dedup that keeps the first-seen casing — same rule
// resolveTagIds already applies to tag names.
function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(v);
  }
  return result;
}
