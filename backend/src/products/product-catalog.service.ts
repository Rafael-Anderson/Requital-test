import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { buildSetClause } from '../database/update.util';
import { trimDecimal } from '../database/decimal.util';
import type { RowDataPacket } from 'mysql2/promise';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { slugify } from '../common/slugify';
import { CreateProductDto, ProductImageInput } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  UpdateProductAvailabilityDto,
} from './dto/update-product-availability.dto';
import { BulkProductIdsDto } from './dto/bulk-product-ids.dto';
import {
  BulkUpdateProductStatusDto,
} from './dto/bulk-update-product-status.dto';
import { BulkPriceUpdateDto } from './dto/bulk-price-update.dto';
import { UpdateProductOptionsDto } from './dto/update-product-options.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import {
  MAX_PRODUCT_OPTIONS,
  MAX_VARIANTS_PER_PRODUCT,
  comboKey,
  generateVariantCombinations,
} from './variant-generator';
import { DatabaseService } from '../database/database.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { TaxClassesService } from '../tax-classes/tax-classes.service';
import { ProductReadService } from './product-read.service';
import { ProductBomService } from './product-bom.service';
import {
  deleteMetafieldValues,
  deleteVariantMetafieldValuesForProduct,
} from '../metafields/metafield-cleanup';

// Catalog CRUD: products, variants and options, availability, bulk actions.
@Injectable()
export class ProductCatalogService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
    private readonly branchRolesService: BranchRolesService,
    private readonly taxClassesService: TaxClassesService,
    private readonly read: ProductReadService,
    private readonly bom: ProductBomService,
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
    const products = await this.read.loadProductsWithRelations(ids, outletId);
    const soldByProduct = await this.read.getUnitsSoldByProduct(ctx.shopId, ids);
    return ids.map((id) =>
      this.read.toResponse(products.get(id)!, soldByProduct.get(id) ?? 0),
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
    const products = await this.read.loadProductsWithRelations([id], outletId);
    const response = this.read.toResponse(products.get(id)!);
    if (allOutlets) {
      await this.read.attachOutletStockBreakdown(ctx.shopId, response);
    }
    return response;
  }

  async create(ctx: TenantContext, dto: CreateProductDto) {
    await this.assertCollectionsBelongToShop(ctx, dto.collectionIds);
    if (dto.brandId != null) {
      await this.assertBrandBelongsToShop(ctx, dto.brandId);
    }
    if (dto.taxClassId != null) {
      await this.taxClassesService.assertOwned(ctx.shopId, dto.taxClassId);
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
      await this.bom.assertIngredientLinksValid(ctx, dto.ingredients);
    }
    this.assertDeliveryTimeOverrideFields({
      estimatedDeliveryTimeFrom: dto.estimatedDeliveryTimeFrom,
      estimatedDeliveryTimeTo: dto.estimatedDeliveryTimeTo,
      estimatedDeliveryTimeUnit: dto.estimatedDeliveryTimeUnit,
    });
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
            shopId, name, price, compareAtPrice, isNew, newUntil,
            estimatedDeliveryTimeFrom, estimatedDeliveryTimeTo, estimatedDeliveryTimeUnit,
            thumbnail, sku, barcode, slug,
            metaTitle, metaDescription, description, shortSummary, longSummary,
            costPrice, status, trackInventory, continueSellingOutOfStock, chargeTax,
            isCheckoutAddon, showVariants, showAttributes, showFaqs, usesIngredients,
            vendor, productType, physicalProduct, weight, weightUnit, dimensions,
            isGiftCard, giftCardDenominations, giftCardCustomAmountMin, giftCardCustomAmountMax,
            additionalInfo, brandId, taxClassId
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ctx.shopId,
            dto.name,
            dto.price,
            dto.compareAtPrice ?? null,
            dto.isNew ?? false,
            dto.newUntil ?? null,
            dto.estimatedDeliveryTimeFrom ?? null,
            dto.estimatedDeliveryTimeTo ?? null,
            dto.estimatedDeliveryTimeUnit ?? null,
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
            dto.taxClassId ?? null,
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
          await this.bom.provisionShadowForProduct(conn, ctx, newId, {
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
    const products = await this.read.loadProductsWithRelations([productId], undefined);
    return this.read.toResponse(products.get(productId)!);
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
    const originals = await this.read.loadProductsWithRelations([id], undefined);
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

    // producttag doesn't carry tagId directly in the assembled shape (only the
    // joined tag.name) — re-resolve by name via the same upsert-by-name helper
    // used everywhere else tags are written. Resolved BEFORE the transaction:
    // resolveTagIds goes through the pool, and a pool call inside a
    // transaction callback is a nested pool acquisition (deadlocks the API
    // when DB_POOL_SIZE concurrent duplicates each hold one connection).
    const tagIds =
      original.producttag.length > 0
        ? await this.resolveTagIds(
            ctx,
            original.producttag.map((pt) => pt.tag.name),
          )
        : [];

    let newProductId: number;
    try {
      newProductId = await this.db.transaction(async (conn) => {
        const [result] = await conn.query(
          `INSERT INTO product (
            shopId, name, description, shortSummary, longSummary, thumbnail, price,
            compareAtPrice, costPrice, sku, barcode, status, trackInventory,
            continueSellingOutOfStock, chargeTax, isCheckoutAddon, showVariants,
            showAttributes, showFaqs, vendor, productType, physicalProduct, weight,
            weightUnit, dimensions, slug, metaTitle, metaDescription, brandId, taxClassId
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            // Inherited, like brandId and chargeTax: a duplicate is the same
            // goods, so it carries the same VAT treatment.
            original.taxClassId ?? null,
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
          await this.bom.provisionShadowForVariant(conn, ctx, newProduct.id, newVariantId, {
            name: newProduct.name,
            thumbnail: newProduct.thumbnail,
            trackInventory: newProduct.trackInventory,
            costPrice: newProduct.costPrice,
          });
        }
        if (original.productvariant.length === 0) {
          await this.bom.provisionShadowForProduct(conn, ctx, newProduct.id, {
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
    const products = await this.read.loadProductsWithRelations([newProductId], undefined);
    return this.read.toResponse(products.get(newProductId)!);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateProductDto) {
    const current = await this.findRaw(ctx, id);

    if (dto.collectionIds) {
      await this.assertCollectionsBelongToShop(ctx, dto.collectionIds);
    }
    if (dto.brandId != null) {
      await this.assertBrandBelongsToShop(ctx, dto.brandId);
    }
    if (dto.taxClassId != null) {
      await this.taxClassesService.assertOwned(ctx.shopId, dto.taxClassId);
    }
    this.assertDeliveryTimeOverrideFields({
      estimatedDeliveryTimeFrom: dto.estimatedDeliveryTimeFrom,
      estimatedDeliveryTimeTo: dto.estimatedDeliveryTimeTo,
      estimatedDeliveryTimeUnit: dto.estimatedDeliveryTimeUnit,
    });
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
      await this.bom.assertIngredientLinksValid(ctx, dto.ingredients!);
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
          isNew: dto.isNew,
          // `null` (explicit clear) is passed through by buildSetClause;
          // `undefined` (omitted) is filtered out — leaves the column as-is.
          newUntil: dto.newUntil,
          estimatedDeliveryTimeFrom: dto.estimatedDeliveryTimeFrom,
          estimatedDeliveryTimeTo: dto.estimatedDeliveryTimeTo,
          estimatedDeliveryTimeUnit: dto.estimatedDeliveryTimeUnit,
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
          taxClassId: dto.taxClassId,
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
          await this.bom.deleteShadowForProduct(conn, id);
          if (variantIds.length > 0) {
            await this.bom.deleteShadowsForVariants(conn, variantIds);
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
              await this.bom.provisionShadowForVariant(conn, ctx, id, vId, {
                name: nameRow.name as string,
                thumbnail: nameRow.thumbnail as string,
                trackInventory: nameRow.trackInventory as boolean,
                costPrice: nameRow.costPrice as string | null,
              });
            }
          } else {
            await this.bom.provisionShadowForProduct(conn, ctx, id, {
              name: nameRow.name as string,
              thumbnail: nameRow.thumbnail as string,
              trackInventory: nameRow.trackInventory as boolean,
              costPrice: nameRow.costPrice as string | null,
            });
          }
        } else if (!nextUsesIngredients) {
          // Staying in shadow mode — keep the shadow ingredient(s)' display
          // fields synced with whatever actually changed on this save.
          await this.bom.syncShadowMeta(
            conn,
            { shadowProductId: id },
            {
              name: dto.name,
              thumbnail,
              trackInventory: dto.trackInventory,
              costPrice: dto.costPrice,
            },
          );
          if (variantIds.length > 0) {
            // A variant shadow mirrors the PARENT product's cost -
            // productvariant has no costPrice column of its own, and this is
            // the same value provisionShadowForVariant seeds it with.
            await this.bom.syncShadowMeta(
              conn,
              { shadowVariantIdIn: variantIds },
              {
                name: dto.name,
                thumbnail,
                trackInventory: dto.trackInventory,
                costPrice: dto.costPrice,
              },
            );
          }
        }
      });
    } catch (error) {
      this.handleDbError(error);
    }
    const products = await this.read.loadProductsWithRelations([id], undefined);
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
    return this.read.toResponse(product);
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
    const products = await this.read.loadProductsWithRelations([id], undefined);
    const product = this.read.toResponse(products.get(id)!);
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
        await deleteVariantMetafieldValuesForProduct(conn, id);
        await conn.query(`DELETE FROM productvariant WHERE productId = ?`, [id]);
        await conn.query(`DELETE FROM productoption WHERE productId = ?`, [id]);
        if (!product.usesIngredients) {
          await this.bom.provisionShadowForProduct(conn, ctx, id, {
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
        await deleteMetafieldValues(conn, 'variant', staleVariantIds);
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
          await this.bom.provisionShadowForVariant(conn, ctx, id, createdId, {
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
        await this.bom.deleteShadowForProduct(conn, id);
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
      await this.bom.assertIngredientLinksValid(ctx, dto.ingredients!);
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
    const updatedVariants = await this.read.loadVariantsWithRelations([variantId], undefined);
    const updated = updatedVariants.get(variantId)!;
    // Needed so the response's makeableQuantity can fall back to the
    // product-level default when this variant has no overrides of its own
    // (same effective-recipe resolution as toResponse's own variant mapping)
    // — no live outlet stock breakdown here (this endpoint isn't
    // outlet-scoped), same as everywhere else on this route today.
    const productDefaultIngredientRows = await this.read.loadIngredientLinks(
      'productId = ? AND variantId IS NULL',
      [productId],
      undefined,
    );
    return this.read.toVariantResponse(
      updated,
      productDefaultIngredientRows.map((r) => this.read.rowToIngredientLink(r)),
      product.usesIngredients as boolean,
    );
  }

  // Logs here — not separately in bulkRemove() below, which just calls this
  // in a loop — one row per product either way, single or bulk delete.
  async remove(ctx: TenantContext, id: number) {
    const product = await this.findOne(ctx, id);
    try {
      // One transaction: if the product delete is refused (FK from an order
      // line, say) its custom-field values are not lost. Variants cascade away
      // with the product, so their values are swept while the ids still resolve.
      await this.db.transaction(async (conn) => {
        await deleteVariantMetafieldValuesForProduct(conn, id);
        await deleteMetafieldValues(conn, 'product', [id]);
        // Variants must go BEFORE the product: deleting the product cascades
        // product -> productoption -> productoptionvalue, whose FKs on
        // productvariant.optionValueNId are ON DELETE SET NULL. That UPDATE
        // re-checks ProductVariant_productId_fkey against the product row
        // that is already mid-delete and fails with MySQL 1452. With the
        // variants gone first there is no row left to update.
        await conn.query(`DELETE FROM productvariant WHERE productId = ?`, [id]);
        await conn.query(`DELETE FROM product WHERE id = ?`, [id]);
      });
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

  // The per-product estimated-delivery-time override is all-or-nothing:
  // From/To/Unit must be set together (an override with no unit, or a unit
  // with no value, is meaningless) or all left unset/null (use the shop
  // default). Same "cross-field guard lives in the service, not the DTO"
  // shape as DiscountsService.assertDiscountKindFields.
  private assertDeliveryTimeOverrideFields(fields: {
    estimatedDeliveryTimeFrom?: number | null;
    estimatedDeliveryTimeTo?: number | null;
    estimatedDeliveryTimeUnit?: string | null;
  }) {
    const provided = [
      fields.estimatedDeliveryTimeFrom,
      fields.estimatedDeliveryTimeTo,
      fields.estimatedDeliveryTimeUnit,
    ].filter((v) => v !== undefined && v !== null);
    if (provided.length !== 0 && provided.length !== 3) {
      throw new BadRequestException(
        'estimatedDeliveryTimeFrom/To/Unit must all be set together, or all left unset, to override the shop default',
      );
    }
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
