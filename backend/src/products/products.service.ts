import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

// Bill of Materials — an ingredient's own fields plus (only when an outlet
// is actually resolved) its live stock at that outlet, needed for the
// effective-makeable-quantity display. Shared by both the product-level
// recipe include below and each variant's override include.
function ingredientSelectFor(outletId: number | undefined) {
  return {
    id: true,
    name: true,
    unit: true,
    trackInventory: true,
    ...(outletId !== undefined && {
      outletingredientstock: {
        where: { outletId },
        select: { stockQuantity: true },
      },
    }),
  } satisfies Prisma.ingredientSelect;
}

function variantIncludeFor(outletId: number | undefined) {
  return {
    image: true,
    optionValue1: true,
    optionValue2: true,
    optionValue3: true,
    // This variant's own recipe override rows (not the product-level
    // defaults — those are fetched separately, see productIngredientIncludeFor).
    productingredient: {
      include: { ingredient: { select: ingredientSelectFor(outletId) } },
      orderBy: { id: 'asc' },
    },
    ...(outletId !== undefined && {
      outletvariantstock: {
        where: { outletId },
        select: { stockQuantity: true, lowStockThreshold: true },
      },
    }),
  } satisfies Prisma.productvariantInclude;
}

// Product-level default recipe rows only (variantId: null) — a variant's
// own override rows come from its own nested productingredient include
// above, never from this one.
function productIngredientIncludeFor(outletId: number | undefined) {
  return {
    where: { variantId: null },
    include: { ingredient: { select: ingredientSelectFor(outletId) } },
    orderBy: { id: 'asc' },
  } satisfies Prisma.productInclude['productingredient'];
}

const productInclude = {
  productcategory: { include: { category: true } },
  producttag: { include: { tag: true } },
  productimage: { orderBy: { order: 'asc' } },
  productattribute: { orderBy: { order: 'asc' } },
  productfaq: { orderBy: { order: 'asc' } },
  productoption: {
    orderBy: { order: 'asc' },
    include: { productoptionvalue: { orderBy: { order: 'asc' } } },
  },
  productvariant: {
    orderBy: { order: 'asc' },
    include: variantIncludeFor(undefined),
  },
  productingredient: productIngredientIncludeFor(undefined),
} satisfies Prisma.productInclude;

type ProductWithRelations = Prisma.productGetPayload<{
  include: typeof productInclude;
}> & {
  outletstock?: { stockQuantity: number; lowStockThreshold: number | null }[];
};

type VariantWithRelations = ProductWithRelations['productvariant'][number] & {
  outletvariantstock?: {
    stockQuantity: number;
    lowStockThreshold: number | null;
  }[];
};

interface UnitsSoldRow {
  productId: number;
  unitsSold: bigint | null;
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
    categoryIds?: number[];
    tagNames?: string[];
  };
  stock?: number;
  variants: ResolvedVariantRow[];
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly branchRolesService: BranchRolesService,
    private readonly notifySubscriptionsService: NotifySubscriptionsService,
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
    const products = await this.prisma.product.findMany({
      where: { shopId: ctx.shopId },
      include: this.includeFor(outletId),
      orderBy: { id: 'asc' },
    });
    const soldByProduct = await this.getUnitsSoldByProduct(
      ctx.shopId,
      products.map((p) => p.id),
    );
    return products.map((product) =>
      this.toResponse(product, soldByProduct.get(product.id) ?? 0),
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
    const product = await this.prisma.product.findFirst({
      where: { id, shopId: ctx.shopId },
      include: this.includeFor(outletId),
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    const response = this.toResponse(product);
    if (allOutlets) {
      await this.attachOutletStockBreakdown(ctx.shopId, response);
    }
    return response;
  }

  async create(ctx: TenantContext, dto: CreateProductDto) {
    await this.assertCategoriesBelongToShop(ctx, dto.categoryIds);
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

    try {
      const product = await this.prisma.product.create({
        data: {
          shopId: ctx.shopId,
          name: dto.name,
          price: dto.price,
          compareAtPrice: dto.compareAtPrice,
          thumbnail,
          sku: dto.sku,
          barcode: dto.barcode,
          slug,
          metaTitle: dto.metaTitle,
          metaDescription: dto.metaDescription,
          description: dto.description,
          shortSummary: dto.shortSummary,
          longSummary: dto.longSummary,
          costPrice: dto.costPrice,
          status: dto.status ?? 'Available',
          trackInventory: dto.trackInventory ?? false,
          continueSellingOutOfStock: dto.continueSellingOutOfStock ?? false,
          chargeTax: dto.chargeTax ?? true,
          isCheckoutAddon: dto.isCheckoutAddon ?? false,
          showVariants: dto.showVariants ?? false,
          showAttributes: dto.showAttributes ?? false,
          showFaqs: dto.showFaqs ?? false,
          vendor: dto.vendor,
          productType: dto.productType,
          physicalProduct: dto.physicalProduct ?? true,
          weight: dto.weight,
          weightUnit: dto.weightUnit ?? 'kg',
          dimensions: dto.dimensions,
          isGiftCard: dto.isGiftCard ?? false,
          giftCardDenominations: dto.giftCardDenominations,
          giftCardCustomAmountMin: dto.giftCardCustomAmountMin,
          giftCardCustomAmountMax: dto.giftCardCustomAmountMax,
          productimage: dto.images?.length
            ? {
                create: dto.images.map((img, i) => ({
                  url: img.url,
                  order: img.order ?? i,
                })),
              }
            : undefined,
          productattribute: dto.attributes?.length
            ? {
                create: dto.attributes.map((a, i) => ({
                  name: a.name.trim(),
                  value: a.value.trim(),
                  order: a.order ?? i,
                })),
              }
            : undefined,
          productfaq: dto.faqs?.length
            ? {
                create: dto.faqs.map((f, i) => ({
                  question: f.question.trim(),
                  answer: f.answer.trim(),
                  order: f.order ?? i,
                })),
              }
            : undefined,
          productcategory: {
            create: dto.categoryIds.map((categoryId) => ({ categoryId })),
          },
          producttag: { create: tagIds.map((tagId) => ({ tagId })) },
          ...(dto.ingredients?.length && {
            productingredient: {
              create: dto.ingredients.map((i) => ({
                shopId: ctx.shopId,
                ingredientId: i.ingredientId,
                quantityPerUnit: i.quantityPerUnit,
              })),
            },
          }),
        },
        include: productInclude,
      });
      return this.toResponse(product);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  // Deep-copies title/description/pricing/organization + every variant and
  // option, and references the same image URLs rather than re-uploading —
  // but deliberately does NOT copy: sku (unique per shop — see below),
  // barcode, slug (both regenerated fresh), or any stock/outletstock rows
  // (a copy always starts at zero/untracked, same as a brand-new product;
  // duplicating live counts would be actively wrong — two products both
  // claiming to have the original's stock). New copy always lands as
  // status: 'Unavailable' (shown to merchants as "Draft" — see
  // PRODUCT_STATUS_LABELS in the admin frontend) regardless of the
  // original's status, so a duplicate never goes live by accident.
  async duplicate(ctx: TenantContext, id: number) {
    const original = await this.prisma.product.findFirst({
      where: { id, shopId: ctx.shopId },
      include: productInclude,
    });
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

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const newProduct = await tx.product.create({
          data: {
            shopId: ctx.shopId,
            name: newName,
            description: original.description,
            shortSummary: original.shortSummary,
            longSummary: original.longSummary,
            thumbnail: original.thumbnail,
            price: original.price,
            compareAtPrice: original.compareAtPrice,
            costPrice: original.costPrice,
            sku: newSku,
            barcode: null,
            status: 'Unavailable',
            trackInventory: original.trackInventory,
            continueSellingOutOfStock: original.continueSellingOutOfStock,
            chargeTax: original.chargeTax,
            isCheckoutAddon: original.isCheckoutAddon,
            showVariants: original.showVariants,
            showAttributes: original.showAttributes,
            showFaqs: original.showFaqs,
            vendor: original.vendor,
            productType: original.productType,
            physicalProduct: original.physicalProduct,
            weight: original.weight,
            weightUnit: original.weightUnit,
            dimensions: original.dimensions,
            slug: newSlug,
            metaTitle: original.metaTitle,
            metaDescription: original.metaDescription,
            productimage: {
              create: original.productimage.map((img) => ({
                url: img.url,
                order: img.order,
              })),
            },
            productcategory: {
              create: original.productcategory.map((pc) => ({
                categoryId: pc.categoryId,
              })),
            },
            producttag: {
              create: original.producttag.map((pt) => ({ tagId: pt.tagId })),
            },
          },
          include: { productimage: true },
        });

        // Match by `order` (copied 1:1 from the original above) rather than
        // array position — Prisma doesn't guarantee nested-create return
        // order matches input order.
        const imageIdByOrder = new Map(
          newProduct.productimage.map((img) => [img.order, img.id]),
        );
        const newImageIdFor = (oldImageId: number | null) => {
          if (oldImageId === null) return null;
          const oldOrder = original.productimage.find(
            (img) => img.id === oldImageId,
          )?.order;
          return oldOrder === undefined
            ? null
            : (imageIdByOrder.get(oldOrder) ?? null);
        };

        const optionValueIdMap = new Map<number, number>();
        for (const option of original.productoption) {
          const newOption = await tx.productoption.create({
            data: {
              productId: newProduct.id,
              name: option.name,
              order: option.order,
            },
          });
          for (const value of option.productoptionvalue) {
            const newValue = await tx.productoptionvalue.create({
              data: {
                optionId: newOption.id,
                value: value.value,
                order: value.order,
              },
            });
            optionValueIdMap.set(value.id, newValue.id);
          }
        }

        for (const variant of original.productvariant) {
          await tx.productvariant.create({
            data: {
              productId: newProduct.id,
              // Left blank — no uniqueness constraint on variant sku/barcode
              // (unlike the product-level sku above), so a real blank is safe.
              sku: null,
              barcode: null,
              price: variant.price,
              compareAtPrice: variant.compareAtPrice,
              weight: variant.weight,
              imageId: newImageIdFor(variant.imageId),
              order: variant.order,
              optionValue1Id: variant.optionValue1Id
                ? (optionValueIdMap.get(variant.optionValue1Id) ?? null)
                : null,
              optionValue2Id: variant.optionValue2Id
                ? (optionValueIdMap.get(variant.optionValue2Id) ?? null)
                : null,
              optionValue3Id: variant.optionValue3Id
                ? (optionValueIdMap.get(variant.optionValue3Id) ?? null)
                : null,
            },
          });
        }

        return tx.product.findUniqueOrThrow({
          where: { id: newProduct.id },
          include: productInclude,
        });
      });
      return this.toResponse(created);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(ctx: TenantContext, id: number, dto: UpdateProductDto) {
    const current = await this.findRaw(ctx, id);

    if (dto.categoryIds) {
      await this.assertCategoriesBelongToShop(ctx, dto.categoryIds);
    }
    if (dto.ingredients) {
      await this.assertIngredientLinksValid(ctx, dto.ingredients);
    }
    const tagIds =
      dto.tags !== undefined
        ? await this.resolveTagIds(ctx, dto.tags)
        : undefined;
    const thumbnail =
      dto.images !== undefined
        ? this.resolveFeaturedThumbnail(dto.images, current.thumbnail)
        : undefined;

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        if (dto.categoryIds) {
          await tx.productcategory.deleteMany({ where: { productId: id } });
        }
        if (tagIds !== undefined) {
          await tx.producttag.deleteMany({ where: { productId: id } });
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
          const existingImages = await tx.productimage.findMany({
            where: { productId: id },
          });
          const existingByUrl = new Map(
            existingImages.map((img) => [img.url, img]),
          );
          const keepUrls = new Set(dto.images.map((img) => img.url));
          const removedIds = existingImages
            .filter((img) => !keepUrls.has(img.url))
            .map((img) => img.id);
          if (removedIds.length > 0) {
            await tx.productimage.deleteMany({
              where: { id: { in: removedIds } },
            });
          }
          for (let i = 0; i < dto.images.length; i++) {
            const img = dto.images[i];
            const order = img.order ?? i;
            const existing = existingByUrl.get(img.url);
            if (existing) {
              if (existing.order !== order) {
                await tx.productimage.update({
                  where: { id: existing.id },
                  data: { order },
                });
              }
            } else {
              await tx.productimage.create({
                data: { productId: id, url: img.url, order },
              });
            }
          }
        }
        if (dto.ingredients !== undefined) {
          await tx.productingredient.deleteMany({
            where: { productId: id, variantId: null },
          });
        }
        // Delete-then-recreate, unlike images' id-preserving upsert above —
        // nothing FKs into productattribute/productfaq (no variant.imageId-
        // style dependency on a stable id), so there's no id-stability
        // concern here worth the extra complexity.
        if (dto.attributes !== undefined) {
          await tx.productattribute.deleteMany({ where: { productId: id } });
          if (dto.attributes.length > 0) {
            await tx.productattribute.createMany({
              data: dto.attributes.map((a, i) => ({
                productId: id,
                name: a.name.trim(),
                value: a.value.trim(),
                order: a.order ?? i,
              })),
            });
          }
        }
        if (dto.faqs !== undefined) {
          await tx.productfaq.deleteMany({ where: { productId: id } });
          if (dto.faqs.length > 0) {
            await tx.productfaq.createMany({
              data: dto.faqs.map((f, i) => ({
                productId: id,
                question: f.question.trim(),
                answer: f.answer.trim(),
                order: f.order ?? i,
              })),
            });
          }
        }
        return tx.product.update({
          where: { id },
          data: {
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
            vendor: dto.vendor,
            productType: dto.productType,
            physicalProduct: dto.physicalProduct,
            weight: dto.weight,
            weightUnit: dto.weightUnit,
            dimensions: dto.dimensions,
            isGiftCard: dto.isGiftCard,
            giftCardDenominations: dto.giftCardDenominations,
            giftCardCustomAmountMin: dto.giftCardCustomAmountMin,
            giftCardCustomAmountMax: dto.giftCardCustomAmountMax,
            ...(dto.categoryIds && {
              productcategory: {
                create: dto.categoryIds.map((categoryId) => ({
                  categoryId,
                })),
              },
            }),
            ...(tagIds !== undefined && {
              producttag: { create: tagIds.map((tagId) => ({ tagId })) },
            }),
            ...(dto.ingredients !== undefined && {
              productingredient: {
                create: dto.ingredients.map((i) => ({
                  shopId: ctx.shopId,
                  ingredientId: i.ingredientId,
                  quantityPerUnit: i.quantityPerUnit,
                })),
              },
            }),
          },
          include: productInclude,
        });
      });
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
            price: current.price,
            compareAtPrice: current.compareAtPrice,
          },
          after: {
            price: product.price,
            compareAtPrice: product.compareAtPrice,
          },
        });
      }
      return this.toResponse(product);
    } catch (error) {
      this.handlePrismaError(error);
    }
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
    const product = await this.prisma.product.update({
      where: { id },
      data: { status: dto.status },
      include: productInclude,
    });
    if (before.status !== dto.status) {
      await this.auditLogService.logCtx(ctx, {
        action: 'product.status_changed',
        entityType: 'product',
        entityId: id,
        before: { status: before.status },
        after: { status: dto.status },
      });
    }
    return this.toResponse(product);
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
    const product = await this.prisma.product.findFirst({
      where: { id, shopId: ctx.shopId },
      include: {
        productoption: {
          orderBy: { order: 'asc' },
          include: { productoptionvalue: { orderBy: { order: 'asc' } } },
        },
        productvariant: true,
      },
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
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
      // that never had options.
      await this.prisma.$transaction([
        this.prisma.productvariant.deleteMany({ where: { productId: id } }),
        this.prisma.productoption.deleteMany({ where: { productId: id } }),
      ]);
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

    await this.prisma.$transaction(async (tx) => {
      const valueIdsByOption: number[][] = [];

      for (let i = 0; i < cleanedOptions.length; i++) {
        const target = cleanedOptions[i];
        const existingOption = product.productoption[i];

        const option = existingOption
          ? await tx.productoption.update({
              where: { id: existingOption.id },
              data: { name: target.name, order: i },
            })
          : await tx.productoption.create({
              data: { productId: id, name: target.name, order: i },
            });

        const existingValues = existingOption?.productoptionvalue ?? [];
        const existingByValue = new Map(
          existingValues.map((v) => [v.value.trim().toLowerCase(), v]),
        );
        const valueIds: number[] = [];
        for (let j = 0; j < target.values.length; j++) {
          const value = target.values[j];
          const match = existingByValue.get(value.toLowerCase());
          if (match) {
            existingByValue.delete(value.toLowerCase());
            await tx.productoptionvalue.update({
              where: { id: match.id },
              data: { value, order: j },
            });
            valueIds.push(match.id);
          } else {
            const created = await tx.productoptionvalue.create({
              data: { optionId: option.id, value, order: j },
            });
            valueIds.push(created.id);
          }
        }
        // Whatever's left in existingByValue is a value that's no longer
        // present — its variants get reconciled away below (their combo key
        // won't be in newComboKeys since this id no longer exists).
        const removedIds = [...existingByValue.values()].map((v) => v.id);
        if (removedIds.length > 0) {
          await tx.productoptionvalue.deleteMany({
            where: { id: { in: removedIds } },
          });
        }
        valueIdsByOption.push(valueIds);
      }

      // Any existing option beyond the new option count is dropped entirely
      // (e.g. product had 3 options, now has 2).
      const droppedOptionIds = product.productoption
        .slice(cleanedOptions.length)
        .map((o) => o.id);
      if (droppedOptionIds.length > 0) {
        await tx.productoption.deleteMany({
          where: { id: { in: droppedOptionIds } },
        });
      }

      const newCombos = generateVariantCombinations(valueIdsByOption);
      const newComboKeys = new Set(newCombos.map(comboKey));
      const existingByKey = new Map(
        product.productvariant.map((v) => [
          comboKey([v.optionValue1Id, v.optionValue2Id, v.optionValue3Id]),
          v,
        ]),
      );

      const staleVariantIds = product.productvariant
        .filter(
          (v) =>
            !newComboKeys.has(
              comboKey([v.optionValue1Id, v.optionValue2Id, v.optionValue3Id]),
            ),
        )
        .map((v) => v.id);
      if (staleVariantIds.length > 0) {
        await tx.productvariant.deleteMany({
          where: { id: { in: staleVariantIds } },
        });
      }

      for (let i = 0; i < newCombos.length; i++) {
        const combo = newCombos[i];
        const key = comboKey(combo);
        const existing = existingByKey.get(key);
        if (existing) {
          if (existing.order !== i) {
            await tx.productvariant.update({
              where: { id: existing.id },
              data: { order: i },
            });
          }
          continue;
        }
        await tx.productvariant.create({
          data: {
            productId: id,
            optionValue1Id: combo[0],
            optionValue2Id: combo[1],
            optionValue3Id: combo[2],
            order: i,
            // New variants inherit the parent product's current price —
            // never a null "unset" price a customer could otherwise buy at
            // (see the resolution fallback in orders/public.service.ts,
            // which still falls back to product.price defensively).
            price: product.price,
            compareAtPrice: product.compareAtPrice,
            weight: product.weight,
          },
        });
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
    await this.findRaw(ctx, productId);
    const variant = await this.prisma.productvariant.findFirst({
      where: { id: variantId, productId },
    });
    if (!variant) {
      throw new NotFoundException(`Variant ${variantId} not found`);
    }
    if (dto.imageId) {
      const image = await this.prisma.productimage.findFirst({
        where: { id: dto.imageId, productId },
      });
      if (!image) {
        throw new BadRequestException(
          'imageId must reference an image already uploaded to this product',
        );
      }
    }
    if (dto.ingredients) {
      await this.assertIngredientLinksValid(ctx, dto.ingredients);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.ingredients !== undefined) {
        await tx.productingredient.deleteMany({
          where: { productId, variantId },
        });
      }
      return tx.productvariant.update({
        where: { id: variantId },
        data: {
          sku: dto.sku,
          barcode: dto.barcode,
          price: dto.price,
          compareAtPrice: dto.compareAtPrice,
          weight: dto.weight,
          imageId: dto.imageId,
          ...(dto.ingredients !== undefined && {
            productingredient: {
              create: dto.ingredients.map((i) => ({
                shopId: ctx.shopId,
                productId,
                ingredientId: i.ingredientId,
                quantityPerUnit: i.quantityPerUnit,
              })),
            },
          }),
        },
        include: variantIncludeFor(undefined),
      });
    });
    // Needed so the response's makeableQuantity can fall back to the
    // product-level default when this variant has no overrides of its own
    // (same effective-recipe resolution as toResponse's own variant mapping)
    // — no live outlet stock breakdown here (this endpoint isn't
    // outlet-scoped), same as everywhere else on this route today.
    const productDefaultIngredients =
      await this.prisma.productingredient.findMany({
        where: { productId, variantId: null },
        include: { ingredient: { select: ingredientSelectFor(undefined) } },
        orderBy: { id: 'asc' },
      });
    return this.toVariantResponse(updated, productDefaultIngredients);
  }

  async adjustStock(ctx: TenantContext, dto: AdjustStockDto) {
    // Same outlet-override rule as order creation: a branch user's request
    // is always forced onto their own outlet, no matter what outletId (if
    // any) they send.
    const outletId = ctx.role === 'branch' ? ctx.outletId! : dto.outletId;
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: outletId, shopId: ctx.shopId },
    });
    if (!outlet) {
      throw new BadRequestException('outletId is invalid for this shop');
    }
    await this.branchRolesService.assertPermission(
      ctx,
      outletId,
      'products.manage_stock',
    );

    const productIds = [...new Set(dto.adjustments.map((a) => a.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, shopId: ctx.shopId },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException(
        'One or more productIds are invalid for this shop',
      );
    }

    const variantAdjustments = dto.adjustments.filter(
      (a) => a.variantId !== undefined,
    );
    if (variantAdjustments.length > 0) {
      const variantIds = [
        ...new Set(variantAdjustments.map((a) => a.variantId!)),
      ];
      const variants = await this.prisma.productvariant.findMany({
        where: { id: { in: variantIds }, productId: { in: productIds } },
      });
      const variantsById = new Map(variants.map((v) => [v.id, v]));
      for (const a of variantAdjustments) {
        const variant = variantsById.get(a.variantId!);
        if (!variant || variant.productId !== a.productId) {
          throw new BadRequestException(
            'One or more variantIds are invalid for the given product',
          );
        }
      }
    }

    const productLevel = dto.adjustments.filter(
      (a) => a.variantId === undefined,
    );
    const currentProductStock = await this.prisma.outletstock.findMany({
      where: {
        outletId,
        productId: { in: productLevel.map((a) => a.productId) },
      },
    });
    const currentByProduct = new Map(
      currentProductStock.map((s) => [s.productId, s.stockQuantity]),
    );
    for (const { productId, delta } of productLevel) {
      const current = currentByProduct.get(productId) ?? 0;
      if (current + delta < 0) {
        throw new BadRequestException(
          `Adjustment would take product ${productId} below zero stock at this outlet`,
        );
      }
    }

    const currentVariantStock = await this.prisma.outletvariantstock.findMany({
      where: {
        outletId,
        variantId: { in: variantAdjustments.map((a) => a.variantId!) },
      },
    });
    const currentByVariant = new Map(
      currentVariantStock.map((s) => [s.variantId, s.stockQuantity]),
    );
    for (const { variantId, delta } of variantAdjustments) {
      const current = currentByVariant.get(variantId!) ?? 0;
      if (current + delta < 0) {
        throw new BadRequestException(
          `Adjustment would take variant ${variantId} below zero stock at this outlet`,
        );
      }
    }

    await this.prisma.$transaction([
      ...productLevel.map(({ productId, delta }) =>
        this.prisma.outletstock.upsert({
          where: { outletId_productId: { outletId, productId } },
          update: { stockQuantity: { increment: delta } },
          create: { outletId, productId, stockQuantity: delta },
        }),
      ),
      ...variantAdjustments.map(({ variantId, delta }) =>
        this.prisma.outletvariantstock.upsert({
          where: { outletId_variantId: { outletId, variantId: variantId! } },
          update: { stockQuantity: { increment: delta } },
          create: { outletId, variantId: variantId!, stockQuantity: delta },
        }),
      ),
    ]);

    // Back-in-stock notify — fire (not awaited) for every product/variant
    // whose stock just crossed 0 -> positive at this outlet. Not awaited so
    // a slow/failing email batch never delays the stock-adjustment response.
    const variantProductById = new Map(
      variantAdjustments.map((a) => [a.variantId!, a.productId]),
    );
    for (const { productId, delta } of productLevel) {
      const before = currentByProduct.get(productId) ?? 0;
      if (before <= 0 && before + delta > 0) {
        this.notifySubscriptionsService
          .triggerForProduct(ctx.shopId, productId)
          .catch(() => {});
      }
    }
    for (const { variantId, delta } of variantAdjustments) {
      const before = currentByVariant.get(variantId!) ?? 0;
      if (before <= 0 && before + delta > 0) {
        this.notifySubscriptionsService
          .triggerForProduct(
            ctx.shopId,
            variantProductById.get(variantId!)!,
            variantId!,
          )
          .catch(() => {});
      }
    }

    return {
      products: await this.prisma.outletstock.findMany({
        where: {
          outletId,
          productId: { in: productLevel.map((a) => a.productId) },
        },
        select: { productId: true, stockQuantity: true },
      }),
      variants: await this.prisma.outletvariantstock.findMany({
        where: {
          outletId,
          variantId: { in: variantAdjustments.map((a) => a.variantId!) },
        },
        select: { variantId: true, stockQuantity: true },
      }),
    };
  }

  // Moves N units of one product/variant from one outlet to another,
  // atomically. Unlike adjustStock above (a read-then-check-then-write, fine
  // for low-concurrency manual admin corrections), this uses the same
  // CAS-guarded updateMany discipline as checkout's reserveStock
  // (orders.service.ts) — the floor check lives in the WHERE clause of the
  // decrement itself, inside a real interactive $transaction, so two
  // concurrent transfers of the same source stock can't both succeed past
  // what's actually there.
  async transferStock(ctx: TenantContext, dto: TransferStockDto) {
    if (dto.fromOutletId === dto.toOutletId) {
      throw new BadRequestException(
        'fromOutletId and toOutletId must be different',
      );
    }
    this.assertStockTarget(dto);

    const [fromOutlet, toOutlet] = await Promise.all([
      this.prisma.outlet.findFirst({
        where: { id: dto.fromOutletId, shopId: ctx.shopId },
      }),
      this.prisma.outlet.findFirst({
        where: { id: dto.toOutletId, shopId: ctx.shopId },
      }),
    ]);
    if (!fromOutlet || !toOutlet) {
      throw new BadRequestException(
        'fromOutletId/toOutletId is invalid for this shop',
      );
    }

    if (dto.ingredientId) {
      await this.assertIngredientBelongsToShop(ctx, dto.ingredientId);
    } else {
      const product = await this.prisma.product.findFirst({
        where: { id: dto.productId, shopId: ctx.shopId },
      });
      if (!product) {
        throw new NotFoundException(`Product ${dto.productId} not found`);
      }
      if (dto.variantId) {
        const variant = await this.prisma.productvariant.findFirst({
          where: { id: dto.variantId, productId: dto.productId },
        });
        if (!variant) {
          throw new BadRequestException(
            'variantId is invalid for this product',
          );
        }
      }
    }

    // Read for the back-in-stock notify check below — a plain read before
    // the transaction is fine here (unlike the CAS decrement/increment
    // itself): worst case under true concurrency is a missed or extra
    // notify trigger, never an incorrect stock quantity.
    const destinationBefore = dto.ingredientId
      ? null
      : dto.variantId
        ? (
            await this.prisma.outletvariantstock.findUnique({
              where: {
                outletId_variantId: {
                  outletId: dto.toOutletId,
                  variantId: dto.variantId,
                },
              },
            })
          )?.stockQuantity ?? 0
        : (
            await this.prisma.outletstock.findUnique({
              where: {
                outletId_productId: {
                  outletId: dto.toOutletId,
                  productId: dto.productId!,
                },
              },
            })
          )?.stockQuantity ?? 0;

    await this.prisma.$transaction(async (tx) => {
      const decremented = dto.ingredientId
        ? await tx.outletingredientstock.updateMany({
            where: {
              outletId: dto.fromOutletId,
              ingredientId: dto.ingredientId,
              stockQuantity: { gte: dto.quantity },
            },
            data: { stockQuantity: { decrement: dto.quantity } },
          })
        : dto.variantId
          ? await tx.outletvariantstock.updateMany({
              where: {
                outletId: dto.fromOutletId,
                variantId: dto.variantId,
                stockQuantity: { gte: dto.quantity },
              },
              data: { stockQuantity: { decrement: dto.quantity } },
            })
          : await tx.outletstock.updateMany({
              where: {
                outletId: dto.fromOutletId,
                productId: dto.productId,
                stockQuantity: { gte: dto.quantity },
              },
              data: { stockQuantity: { decrement: dto.quantity } },
            });
      if (decremented.count === 0) {
        throw new ConflictException(
          'Not enough stock at the source outlet for this transfer',
        );
      }

      if (dto.ingredientId) {
        await tx.outletingredientstock.upsert({
          where: {
            outletId_ingredientId: {
              outletId: dto.toOutletId,
              ingredientId: dto.ingredientId,
            },
          },
          update: { stockQuantity: { increment: dto.quantity } },
          create: {
            outletId: dto.toOutletId,
            ingredientId: dto.ingredientId,
            stockQuantity: dto.quantity,
          },
        });
      } else if (dto.variantId) {
        await tx.outletvariantstock.upsert({
          where: {
            outletId_variantId: {
              outletId: dto.toOutletId,
              variantId: dto.variantId,
            },
          },
          update: { stockQuantity: { increment: dto.quantity } },
          create: {
            outletId: dto.toOutletId,
            variantId: dto.variantId,
            stockQuantity: dto.quantity,
          },
        });
      } else {
        // assertStockTarget already guarantees productId is set on this
        // (non-ingredient, non-variant) branch.
        await tx.outletstock.upsert({
          where: {
            outletId_productId: {
              outletId: dto.toOutletId,
              productId: dto.productId!,
            },
          },
          update: { stockQuantity: { increment: dto.quantity } },
          create: {
            outletId: dto.toOutletId,
            productId: dto.productId!,
            stockQuantity: dto.quantity,
          },
        });
      }

      await tx.stockmovement.create({
        data: {
          shopId: ctx.shopId,
          productId: dto.ingredientId ? null : dto.productId,
          variantId: dto.ingredientId ? null : dto.variantId,
          ingredientId: dto.ingredientId ?? null,
          type: 'TRANSFER',
          reason: null,
          delta: dto.quantity,
          outletId: dto.fromOutletId,
          toOutletId: dto.toOutletId,
          note: dto.note,
          actorUserId: ctx.userId,
        },
      });
    });

    if (destinationBefore !== null && destinationBefore <= 0) {
      this.notifySubscriptionsService
        .triggerForProduct(ctx.shopId, dto.productId!, dto.variantId)
        .catch(() => {});
    }

    return this.getStockSnapshot(
      {
        productId: dto.productId,
        variantId: dto.variantId,
        ingredientId: dto.ingredientId,
      },
      [dto.fromOutletId, dto.toOutletId],
    );
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
    this.assertStockTarget(dto);
    const outletId = ctx.role === 'branch' ? ctx.outletId! : dto.outletId;
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: outletId, shopId: ctx.shopId },
    });
    if (!outlet) {
      throw new BadRequestException('outletId is invalid for this shop');
    }
    await this.branchRolesService.assertPermission(
      ctx,
      outletId,
      'products.manage_stock',
    );

    if (dto.ingredientId) {
      await this.assertIngredientBelongsToShop(ctx, dto.ingredientId);
    } else {
      const product = await this.prisma.product.findFirst({
        where: { id: dto.productId, shopId: ctx.shopId },
      });
      if (!product) {
        throw new NotFoundException(`Product ${dto.productId} not found`);
      }
      if (dto.variantId) {
        const variant = await this.prisma.productvariant.findFirst({
          where: { id: dto.variantId, productId: dto.productId },
        });
        if (!variant) {
          throw new BadRequestException(
            'variantId is invalid for this product',
          );
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.delta < 0) {
        const result = dto.ingredientId
          ? await tx.outletingredientstock.updateMany({
              where: {
                outletId,
                ingredientId: dto.ingredientId,
                stockQuantity: { gte: -dto.delta },
              },
              data: { stockQuantity: { decrement: -dto.delta } },
            })
          : dto.variantId
            ? await tx.outletvariantstock.updateMany({
                where: {
                  outletId,
                  variantId: dto.variantId,
                  stockQuantity: { gte: -dto.delta },
                },
                data: { stockQuantity: { decrement: -dto.delta } },
              })
            : await tx.outletstock.updateMany({
                where: {
                  outletId,
                  productId: dto.productId,
                  stockQuantity: { gte: -dto.delta },
                },
                data: { stockQuantity: { decrement: -dto.delta } },
              });
        if (result.count === 0) {
          throw new ConflictException(
            'Adjustment would take stock below zero at this outlet',
          );
        }
      } else if (dto.delta > 0) {
        if (dto.ingredientId) {
          await tx.outletingredientstock.upsert({
            where: {
              outletId_ingredientId: {
                outletId,
                ingredientId: dto.ingredientId,
              },
            },
            update: { stockQuantity: { increment: dto.delta } },
            create: {
              outletId,
              ingredientId: dto.ingredientId,
              stockQuantity: dto.delta,
            },
          });
        } else if (dto.variantId) {
          await tx.outletvariantstock.upsert({
            where: {
              outletId_variantId: { outletId, variantId: dto.variantId },
            },
            update: { stockQuantity: { increment: dto.delta } },
            create: {
              outletId,
              variantId: dto.variantId,
              stockQuantity: dto.delta,
            },
          });
        } else {
          // assertStockTarget already guarantees productId is set on this
          // (non-ingredient, non-variant) branch.
          await tx.outletstock.upsert({
            where: {
              outletId_productId: { outletId, productId: dto.productId! },
            },
            update: { stockQuantity: { increment: dto.delta } },
            create: {
              outletId,
              productId: dto.productId!,
              stockQuantity: dto.delta,
            },
          });
        }
      }
      // delta === 0 is a valid "recount confirmed the existing number, no
      // change" adjustment — still logged below, no stock mutation needed.

      await tx.stockmovement.create({
        data: {
          shopId: ctx.shopId,
          productId: dto.ingredientId ? null : dto.productId,
          variantId: dto.ingredientId ? null : dto.variantId,
          ingredientId: dto.ingredientId ?? null,
          type: 'ADJUSTMENT',
          reason: dto.reason,
          delta: dto.delta,
          outletId,
          toOutletId: null,
          note: dto.note,
          actorUserId: ctx.userId,
        },
      });
    });

    return this.getStockSnapshot(
      {
        productId: dto.productId,
        variantId: dto.variantId,
        ingredientId: dto.ingredientId,
      },
      [outletId],
    );
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
    this.assertStockTarget(dto);
    const outletId = ctx.role === 'branch' ? ctx.outletId! : dto.outletId;
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: outletId, shopId: ctx.shopId },
    });
    if (!outlet) {
      throw new BadRequestException('outletId is invalid for this shop');
    }
    await this.branchRolesService.assertPermission(
      ctx,
      outletId,
      'products.manage_stock',
    );

    if (dto.ingredientId) {
      await this.assertIngredientBelongsToShop(ctx, dto.ingredientId);
      await this.prisma.outletingredientstock.upsert({
        where: {
          outletId_ingredientId: { outletId, ingredientId: dto.ingredientId },
        },
        update: { lowStockThreshold: dto.lowStockThreshold },
        create: {
          outletId,
          ingredientId: dto.ingredientId,
          lowStockThreshold: dto.lowStockThreshold,
        },
      });
    } else {
      const product = await this.prisma.product.findFirst({
        where: { id: dto.productId, shopId: ctx.shopId },
      });
      if (!product) {
        throw new NotFoundException(`Product ${dto.productId} not found`);
      }
      if (dto.variantId) {
        const variant = await this.prisma.productvariant.findFirst({
          where: { id: dto.variantId, productId: dto.productId },
        });
        if (!variant) {
          throw new BadRequestException(
            'variantId is invalid for this product',
          );
        }
        await this.prisma.outletvariantstock.upsert({
          where: { outletId_variantId: { outletId, variantId: dto.variantId } },
          update: { lowStockThreshold: dto.lowStockThreshold },
          create: {
            outletId,
            variantId: dto.variantId,
            lowStockThreshold: dto.lowStockThreshold,
          },
        });
      } else {
        await this.prisma.outletstock.upsert({
          where: {
            outletId_productId: { outletId, productId: dto.productId! },
          },
          update: { lowStockThreshold: dto.lowStockThreshold },
          create: {
            outletId,
            productId: dto.productId!,
            lowStockThreshold: dto.lowStockThreshold,
          },
        });
      }
    }

    return this.getStockSnapshot(
      {
        productId: dto.productId,
        variantId: dto.variantId,
        ingredientId: dto.ingredientId,
      },
      [outletId],
    );
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

  private async assertIngredientBelongsToShop(
    ctx: TenantContext,
    ingredientId: number,
  ) {
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id: ingredientId, shopId: ctx.shopId },
    });
    if (!ingredient) {
      throw new NotFoundException(`Ingredient ${ingredientId} not found`);
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
    const count = await this.prisma.ingredient.count({
      where: { id: { in: uniqueIds }, shopId: ctx.shopId },
    });
    if (count !== uniqueIds.length) {
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

    const where: Prisma.stockmovementWhereInput = {
      shopId: ctx.shopId,
      ...(query.productId && { productId: query.productId }),
      ...(query.variantId && { variantId: query.variantId }),
      ...(query.ingredientId && { ingredientId: query.ingredientId }),
      ...(query.type && { type: query.type }),
      // A branch user is scoped to their own outlet on either side of a
      // transfer (sender or receiver); an admin filtering by outletId gets
      // the same OR-on-both-sides treatment so a transfer shows up in
      // either outlet's history, not just the "outletId" column's literal
      // meaning of "source".
      ...(outletScope !== undefined && {
        OR: [{ outletId: outletScope }, { toOutletId: outletScope }],
      }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.stockmovement.count({ where }),
      this.prisma.stockmovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          product: { select: { id: true, name: true } },
          variant: {
            select: {
              id: true,
              optionValue1: { select: { value: true } },
              optionValue2: { select: { value: true } },
              optionValue3: { select: { value: true } },
            },
          },
          ingredient: { select: { id: true, name: true, unit: true } },
          outlet: { select: { id: true, name: true } },
          toOutlet: { select: { id: true, name: true } },
          actor: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        // Exactly one of productId/ingredientId is ever set on a given row —
        // see schema.prisma's comment on the stockmovement model.
        productId: r.productId,
        productName: r.product?.name ?? null,
        variantId: r.variantId,
        variantLabel: r.variant
          ? buildVariantLabel([
              r.variant.optionValue1?.value,
              r.variant.optionValue2?.value,
              r.variant.optionValue3?.value,
            ])
          : null,
        ingredientId: r.ingredientId,
        ingredientName: r.ingredient?.name ?? null,
        ingredientUnit: r.ingredient?.unit ?? null,
        type: r.type,
        reason: r.reason,
        delta: r.delta,
        outletId: r.outletId,
        outletName: r.outlet.name,
        toOutletId: r.toOutletId,
        toOutletName: r.toOutlet?.name ?? null,
        note: r.note,
        // null only for a CONSUMED row auto-generated by an anonymous
        // storefront checkout — see stockmovement.actorUserId's schema comment.
        actorName: r.actor?.name ?? null,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  private async getStockSnapshot(
    target: { productId?: number; variantId?: number; ingredientId?: number },
    outletIds: number[],
  ) {
    if (target.ingredientId) {
      return {
        ingredients: await this.prisma.outletingredientstock.findMany({
          where: {
            ingredientId: target.ingredientId,
            outletId: { in: outletIds },
          },
          select: {
            outletId: true,
            ingredientId: true,
            stockQuantity: true,
            lowStockThreshold: true,
          },
        }),
      };
    }
    if (target.variantId) {
      return {
        variants: await this.prisma.outletvariantstock.findMany({
          where: { variantId: target.variantId, outletId: { in: outletIds } },
          select: {
            outletId: true,
            variantId: true,
            stockQuantity: true,
            lowStockThreshold: true,
          },
        }),
      };
    }
    return {
      products: await this.prisma.outletstock.findMany({
        where: { productId: target.productId, outletId: { in: outletIds } },
        select: {
          outletId: true,
          productId: true,
          stockQuantity: true,
          lowStockThreshold: true,
        },
      }),
    };
  }

  // Logs here — not separately in bulkRemove() below, which just calls this
  // in a loop — one row per product either way, single or bulk delete.
  async remove(ctx: TenantContext, id: number) {
    const product = await this.findOne(ctx, id);
    try {
      await this.prisma.product.delete({ where: { id } });
    } catch (error) {
      this.handlePrismaError(error);
    }
    await this.auditLogService.logCtx(ctx, {
      action: 'product.deleted',
      entityType: 'product',
      entityId: id,
      before: { name: product.name, sku: product.sku },
    });
    return { id, deleted: true };
  }

  // A single updateMany scoped to shopId is inherently the tenant-safe
  // shape for this: any id in `productIds` that doesn't belong to this shop
  // (spoofed or otherwise) simply isn't in the WHERE match — `count` only
  // ever reflects real, owned rows, nothing leaks about ids that don't
  // belong to the caller.
  async bulkUpdateStatus(ctx: TenantContext, dto: BulkUpdateProductStatusDto) {
    const result = await this.prisma.product.updateMany({
      where: { id: { in: dto.productIds }, shopId: ctx.shopId },
      data: { status: dto.status },
    });
    // One summary row for the whole batch, not one per product — the
    // individual product ids are already in `metadata` for anyone who needs
    // them; the log's job here is "what happened", not a per-row diff.
    await this.auditLogService.logCtx(ctx, {
      action: 'product.bulk_status_changed',
      entityType: 'product',
      after: { status: dto.status },
      metadata: { productIds: dto.productIds, updated: result.count },
    });
    return { updated: result.count, requested: dto.productIds.length };
  }

  // Deliberately a loop of the existing single remove() (tenant-scoped via
  // findOne, same friendly "has order history" message via
  // handlePrismaError) rather than one deleteMany — a single multi-row
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
    const products = await this.prisma.product.findMany({
      where: { id: { in: dto.productIds }, shopId: ctx.shopId },
      select: { id: true, name: true, price: true, compareAtPrice: true },
    });

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
          id: p.id,
          name: p.name,
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
          id: p.id,
          name: p.name,
          oldPrice: current.toString(),
          success: false,
          error: 'Would go below zero',
        });
        continue;
      }
      updates.push({ id: p.id, newPrice: rounded });
      results.push({
        id: p.id,
        name: p.name,
        oldPrice: current.toString(),
        newPrice: String(rounded),
        success: true,
      });
    }

    if (updates.length > 0) {
      await this.prisma.$transaction(
        updates.map(({ id, newPrice }) =>
          this.prisma.product.update({
            where: { id },
            data:
              dto.field === 'price'
                ? { price: newPrice }
                : { compareAtPrice: newPrice },
          }),
        ),
      );
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
      const outlet = await this.prisma.outlet.findFirst({
        where: { id: outletId, shopId: ctx.shopId },
      });
      if (!outlet) {
        throw new BadRequestException('outletId is invalid for this shop');
      }
    }
    const rawRows = parseCsv(file.buffer.toString('utf-8'));
    const { results, groups } = await this.classifyImportRows(ctx, rawRows);

    let created = 0;
    let updated = 0;
    const usedSlugsThisBatch = new Set<string>();

    await this.prisma.$transaction(async (tx) => {
      for (const group of groups) {
        if (group.action === 'reject') continue;

        let productId: number;
        if (group.action === 'create') {
          const root = slugify(group.data.name);
          let slug = root;
          let suffix = 2;
          while (
            usedSlugsThisBatch.has(slug) ||
            (await tx.product.findFirst({
              where: { shopId: ctx.shopId, slug },
              select: { id: true },
            }))
          ) {
            slug = `${root}-${suffix}`;
            suffix += 1;
          }
          usedSlugsThisBatch.add(slug);

          const tagIds = await this.resolveTagIdsTx(
            tx,
            ctx,
            group.data.tagNames ?? [],
          );
          const newProduct = await tx.product.create({
            data: {
              shopId: ctx.shopId,
              name: group.data.name,
              price: group.data.price!,
              compareAtPrice: group.data.compareAtPrice,
              costPrice: group.data.costPrice,
              thumbnail: group.data.thumbnail!,
              sku: group.data.sku!,
              barcode: group.data.barcode,
              description: group.data.description,
              vendor: group.data.vendor,
              productType: group.data.productType,
              slug,
              status: group.data.status ?? 'Available',
              trackInventory: group.data.trackInventory ?? false,
              chargeTax: group.data.chargeTax ?? true,
              productcategory: {
                create: (group.data.categoryIds ?? []).map((categoryId) => ({
                  categoryId,
                })),
              },
              producttag: { create: tagIds.map((tagId) => ({ tagId })) },
            },
            select: { id: true },
          });
          productId = newProduct.id;
          created += 1;
        } else {
          productId = group.productId!;
          if (group.data.categoryIds) {
            await tx.productcategory.deleteMany({ where: { productId } });
            await tx.productcategory.createMany({
              data: group.data.categoryIds.map((categoryId) => ({
                productId,
                categoryId,
              })),
            });
          }
          if (group.data.tagNames) {
            const tagIds = await this.resolveTagIdsTx(
              tx,
              ctx,
              group.data.tagNames,
            );
            await tx.producttag.deleteMany({ where: { productId } });
            await tx.producttag.createMany({
              data: tagIds.map((tagId) => ({ productId, tagId })),
            });
          }
          await tx.product.update({
            where: { id: productId },
            data: {
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
            },
          });
          updated += 1;
        }

        if (group.stock !== undefined && outletId !== undefined) {
          await this.applyImportStock(tx, ctx, {
            outletId,
            productId,
            stock: group.stock,
          });
        }

        for (const variant of group.variants) {
          if (variant.action === 'reject') continue;
          const data: Prisma.productvariantUpdateInput = {};
          if (variant.price !== undefined) data.price = variant.price;
          if (variant.compareAtPrice !== undefined)
            data.compareAtPrice = variant.compareAtPrice;
          if (Object.keys(data).length > 0) {
            await tx.productvariant.update({
              where: { id: variant.variantId! },
              data,
            });
          }
          if (variant.stock !== undefined && outletId !== undefined) {
            await this.applyImportStock(tx, ctx, {
              outletId,
              variantId: variant.variantId!,
              stock: variant.stock,
            });
          }
        }
      }
    });

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
  // as every other adjustment.
  private async applyImportStock(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    target: {
      outletId: number;
      productId?: number;
      variantId?: number;
      stock: number;
    },
  ) {
    const before = target.variantId
      ? ((
          await tx.outletvariantstock.findUnique({
            where: {
              outletId_variantId: {
                outletId: target.outletId,
                variantId: target.variantId,
              },
            },
          })
        )?.stockQuantity ?? 0)
      : ((
          await tx.outletstock.findUnique({
            where: {
              outletId_productId: {
                outletId: target.outletId,
                productId: target.productId!,
              },
            },
          })
        )?.stockQuantity ?? 0);

    if (target.variantId) {
      await tx.outletvariantstock.upsert({
        where: {
          outletId_variantId: {
            outletId: target.outletId,
            variantId: target.variantId,
          },
        },
        update: { stockQuantity: target.stock },
        create: {
          outletId: target.outletId,
          variantId: target.variantId,
          stockQuantity: target.stock,
        },
      });
    } else {
      await tx.outletstock.upsert({
        where: {
          outletId_productId: {
            outletId: target.outletId,
            productId: target.productId!,
          },
        },
        update: { stockQuantity: target.stock },
        create: {
          outletId: target.outletId,
          productId: target.productId!,
          stockQuantity: target.stock,
        },
      });
    }

    await tx.stockmovement.create({
      data: {
        shopId: ctx.shopId,
        productId: target.variantId ? null : target.productId,
        variantId: target.variantId ?? null,
        ingredientId: null,
        type: 'IMPORT',
        reason: null,
        delta: target.stock - before,
        outletId: target.outletId,
        toOutletId: null,
        note: 'CSV import',
        actorUserId: ctx.userId,
      },
    });
  }

  // Same as resolveTagIds below but against a transaction client — kept
  // separate rather than parameterizing resolveTagIds's `this.prisma` call,
  // since every other write in the import commit path must go through the
  // same tx for the batch to be one real transaction (see confirmImportProducts).
  private async resolveTagIdsTx(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    names: string[],
  ): Promise<number[]> {
    const uniqueNames = [
      ...new Set(names.map((n) => n.trim()).filter(Boolean)),
    ];
    const tagIds: number[] = [];
    for (const name of uniqueNames) {
      const tag = await tx.tag.upsert({
        where: { shopId_name: { shopId: ctx.shopId, name } },
        update: {},
        create: { shopId: ctx.shopId, name },
      });
      tagIds.push(tag.id);
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

    const allCategoryNames = new Set<string>();
    rawRows.forEach((raw) =>
      splitList(raw['Categories'] ?? '').forEach((n) =>
        allCategoryNames.add(n),
      ),
    );
    const categoryRows = allCategoryNames.size
      ? await this.prisma.category.findMany({
          where: { shopId: ctx.shopId, name: { in: [...allCategoryNames] } },
          select: { id: true, name: true },
        })
      : [];
    const categoryIdByName = new Map(
      categoryRows.map((c) => [c.name.toLowerCase(), c.id]),
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
      const categoryNames = splitList(raw['Categories'] ?? '');
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

      const categoryIds: number[] = [];
      for (const catName of categoryNames) {
        const id = categoryIdByName.get(catName.toLowerCase());
        if (id === undefined) {
          errors.push(`Unknown category: ${catName}`);
        } else {
          categoryIds.push(id);
        }
      }

      const existing = sku
        ? await this.prisma.product.findFirst({
            where: { shopId: ctx.shopId, sku },
            select: { id: true },
          })
        : name
          ? await this.prisma.product.findFirst({
              where: { shopId: ctx.shopId, name },
              select: { id: true },
            })
          : null;
      const action: ImportAction = existing ? 'update' : 'create';

      if (action === 'create') {
        if (!sku) errors.push('SKU is required to create a new product');
        if (price === undefined)
          errors.push('Price is required to create a new product');
        if (!thumbnail)
          errors.push('Thumbnail URL is required to create a new product');
        if (categoryIds.length === 0)
          errors.push(
            'At least one category is required to create a new product',
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
        productId: existing?.id,
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
          categoryIds: categoryNames.length > 0 ? categoryIds : undefined,
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
          const found = await this.prisma.productvariant.findFirst({
            where: { sku: variantSku, product: { shopId: ctx.shopId } },
            select: { id: true, productId: true },
          });
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
            variantId = found.id;
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
  // full response shape — avoids re-running the heavier include just to read
  // e.g. current.thumbnail/current.price.
  private async findRaw(ctx: TenantContext, id: number) {
    const product = await this.prisma.product.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  private includeFor(outletId: number | undefined) {
    return {
      ...productInclude,
      productvariant: {
        orderBy: { order: 'asc' as const },
        include: variantIncludeFor(outletId),
      },
      productingredient: productIngredientIncludeFor(outletId),
      ...(outletId !== undefined && {
        outletstock: {
          where: { outletId },
          select: { stockQuantity: true, lowStockThreshold: true },
        },
      }),
    };
  }

  private resolveFeaturedThumbnail(
    images: ProductImageInput[] | undefined,
    fallback: string,
  ): string {
    if (!images || images.length === 0) return fallback;
    const sorted = [...images].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return sorted[0].url;
  }

  private async assertCategoriesBelongToShop(
    ctx: TenantContext,
    categoryIds: number[],
  ) {
    const uniqueIds = [...new Set(categoryIds)];
    const count = await this.prisma.category.count({
      where: { id: { in: uniqueIds }, shopId: ctx.shopId },
    });
    if (count !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more categoryIds are invalid for this shop',
      );
    }
  }

  // Auto-generates a per-shop-unique slug from `base` (the product name),
  // appending -2, -3, ... on collision rather than failing — unlike sku,
  // duplicate product names are common (two "Chocolate Cake" products) and
  // shouldn't block creation. Only used on create's auto-generate path; an
  // explicitly-provided slug (create or update) is used as-is and relies on
  // the DB unique constraint to reject a real collision, same as categories.
  private async resolveUniqueSlug(
    shopId: number,
    base: string,
  ): Promise<string> {
    const root = slugify(base);
    let candidate = root;
    let suffix = 2;
    while (
      await this.prisma.product.findFirst({
        where: { shopId, slug: candidate },
        select: { id: true },
      })
    ) {
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
      const tag = await this.prisma.tag.upsert({
        where: { shopId_name: { shopId: ctx.shopId, name } },
        update: {},
        create: { shopId: ctx.shopId, name },
      });
      tagIds.push(tag.id);
    }
    return tagIds;
  }

  private async getUnitsSoldByProduct(shopId: number, productIds: number[]) {
    if (productIds.length === 0) return new Map<number, number>();
    const rows = await this.prisma.$queryRaw<UnitsSoldRow[]>`
      SELECT oi.productId AS productId, SUM(oi.quantity) AS unitsSold
      FROM orderitem oi
      JOIN \`order\` o ON o.id = oi.orderId
      WHERE o.shopId = ${shopId} AND o.status != 'cancelled'
        AND oi.productId IN (${Prisma.join(productIds)})
      GROUP BY oi.productId
    `;
    return new Map(rows.map((r) => [r.productId, Number(r.unitsSold ?? 0)]));
  }

  private toResponse(product: ProductWithRelations, totalSold = 0) {
    const {
      productcategory,
      producttag,
      productimage,
      productattribute,
      productfaq,
      productoption,
      productvariant,
      productingredient,
      outletstock,
      ...rest
    } = product;
    const stock = outletstock?.[0];
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
    const ingredients = productingredient.map((pi) =>
      this.toIngredientLinkResponse(pi),
    );
    const availability = this.computeIngredientAvailability(productingredient);
    return {
      ...rest,
      categories: productcategory.map((pc) => pc.category),
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
        this.toVariantResponse(v, productingredient),
      ),
      // null when no outlet was resolved for this request (e.g. an admin
      // viewing the catalog without picking a branch) — distinct from 0,
      // which means "this outlet genuinely has none in stock".
      stockQuantity: stock?.stockQuantity ?? null,
      lowStockThreshold: stock?.lowStockThreshold ?? null,
      totalSold,
      // Bill of Materials — this product's own default recipe (variantId:
      // null rows only; see productIngredientIncludeFor). A variant's
      // effective recipe (its own override, or this same default) is on
      // each variant response instead — see toVariantResponse.
      ingredients,
      // Informational only — never gates checkout/cart in this pass (see
      // ProductsService.consumeForOrderItems's own comment on why enforcing
      // this at sale time is deliberately deferred). null when no recipe is
      // defined at all (unconstrained, today's behavior unchanged) or when
      // no outlet was resolved for this request.
      makeableQuantity: availability.makeableQuantity,
      limitedByIngredient: availability.limitedByIngredient,
    };
  }

  private toVariantResponse(
    v: VariantWithRelations,
    productDefaultIngredients: ProductWithRelations['productingredient'],
  ) {
    const stock = v.outletvariantstock?.[0];
    // A variant with its own override rows uses exactly those; one with
    // none inherits the product-level default wholesale (not merged
    // ingredient-by-ingredient — setting ANY override row for a variant
    // means that variant's recipe is now fully described by its own rows).
    const effectiveIngredientRows =
      v.productingredient.length > 0
        ? v.productingredient
        : productDefaultIngredients;
    const availability = this.computeIngredientAvailability(
      effectiveIngredientRows,
    );
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
      stockQuantity: stock?.stockQuantity ?? null,
      lowStockThreshold: stock?.lowStockThreshold ?? null,
      // This variant's own override rows only (empty when it has none and
      // simply inherits the product default) — distinct from the effective
      // recipe used for makeableQuantity below, which falls back to the
      // product default when this list is empty.
      ingredientOverrides: v.productingredient.map((pi) =>
        this.toIngredientLinkResponse(pi),
      ),
      makeableQuantity: availability.makeableQuantity,
      limitedByIngredient: availability.limitedByIngredient,
    };
  }

  private toIngredientLinkResponse(
    pi: ProductWithRelations['productingredient'][number],
  ) {
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
  // wasn't fetched — see ingredientSelectFor).
  private computeIngredientAvailability(
    rows: {
      quantityPerUnit: number;
      ingredient: {
        name: string;
        trackInventory: boolean;
        outletingredientstock?: { stockQuantity: number }[];
      };
    }[],
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
  // Doesn't touch stock — callers decrement outletstock/outletvariantstock
  // themselves (storefront checkout needs a CAS guard, admin-entered orders
  // defer the decrement to confirmation — see orders.service.ts).
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
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, shopId },
      include: { productoption: { select: { id: true } } },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException(
        'One or more items reference a product that does not belong to this shop',
      );
    }
    const productsById = new Map(products.map((p) => [p.id, p]));

    const variantIds = [
      ...new Set(
        items.filter((i) => i.variantId !== undefined).map((i) => i.variantId!),
      ),
    ];
    const variants = variantIds.length
      ? await this.prisma.productvariant.findMany({
          where: { id: { in: variantIds } },
          include: {
            optionValue1: true,
            optionValue2: true,
            optionValue3: true,
          },
        })
      : [];
    const variantsById = new Map(variants.map((v) => [v.id, v]));

    return items.map((item) => {
      const product = productsById.get(item.productId)!;
      const hasVariants = product.productoption.length > 0;
      let variant: (typeof variants)[number] | null = null;
      if (hasVariants) {
        if (item.variantId === undefined) {
          throw new BadRequestException(
            `${product.name} requires selecting an option before ordering`,
          );
        }
        const found = variantsById.get(item.variantId);
        if (!found || found.productId !== product.id) {
          throw new BadRequestException(
            `Invalid variant selected for ${product.name}`,
          );
        }
        variant = found;
      } else if (item.variantId !== undefined) {
        throw new BadRequestException(
          `${product.name} does not have variant options`,
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
      let price: Prisma.Decimal;
      if (product.isGiftCard) {
        if (item.giftCardAmount === undefined) {
          throw new BadRequestException(
            `${product.name} requires choosing a gift card amount`,
          );
        }
        this.assertValidGiftCardAmount(product, item.giftCardAmount);
        price = new Prisma.Decimal(item.giftCardAmount);
      } else if (item.giftCardAmount !== undefined) {
        throw new BadRequestException(
          `${product.name} is not a gift card product`,
        );
      } else {
        // Admin-only override (draft orders / manual phone-order price
        // adjustments) — see CreateOrderDto.items.priceOverride. Never
        // exposed on the public/storefront item DTO, so a storefront
        // customer can never set their own price this way.
        price =
          item.priceOverride !== undefined
            ? new Prisma.Decimal(item.priceOverride)
            : (variant?.price ?? product.price);
      }

      return {
        product,
        variant,
        quantity: item.quantity,
        price,
        variantLabel: variant
          ? buildVariantLabel([
              variant.optionValue1?.value,
              variant.optionValue2?.value,
              variant.optionValue3?.value,
            ])
          : null,
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
    tx: Prisma.TransactionClient,
    shopId: number,
    outletId: number,
    items: { productId: number; variantId: number | null; quantity: number }[],
    direction: 1 | -1,
    options: { throwOnInsufficientStock: boolean; actorUserId: number | null },
  ): Promise<boolean> {
    if (direction === -1) {
      const shop = await tx.shop.findUniqueOrThrow({
        where: { id: shopId },
        select: { autoDeductIngredientStock: true },
      });
      if (!shop.autoDeductIngredientStock) return false;
    }

    const productIds = [...new Set(items.map((i) => i.productId))];
    if (productIds.length === 0) return false;
    const recipeRows = await tx.productingredient.findMany({
      where: { productId: { in: productIds } },
      include: { ingredient: { select: { name: true, trackInventory: true } } },
    });
    if (recipeRows.length === 0) return false;

    const rowsByProduct = new Map<number, typeof recipeRows>();
    for (const row of recipeRows) {
      if (!rowsByProduct.has(row.productId))
        rowsByProduct.set(row.productId, []);
      rowsByProduct.get(row.productId)!.push(row);
    }

    let consumedAnything = false;
    for (const item of items) {
      const rowsForProduct = rowsByProduct.get(item.productId);
      if (!rowsForProduct) continue;
      const effectiveRows = this.resolveEffectiveRecipeRows(
        rowsForProduct,
        item.variantId,
      );
      for (const row of effectiveRows) {
        if (!row.ingredient.trackInventory) continue;
        const totalQty = row.quantityPerUnit * item.quantity;
        const delta = direction * totalQty;
        consumedAnything = true;

        if (direction === -1 && options.throwOnInsufficientStock) {
          const result = await tx.outletingredientstock.updateMany({
            where: {
              outletId,
              ingredientId: row.ingredientId,
              stockQuantity: { gte: totalQty },
            },
            data: { stockQuantity: { decrement: totalQty } },
          });
          if (result.count === 0) {
            throw new ConflictException(
              `Not enough ${row.ingredient.name} in stock to fulfill this order`,
            );
          }
        } else {
          // Matches product stock's own adjustStockForOrder behavior at
          // this exact point (the confirm-transition decrement and every
          // restock): an atomic increment, no floor guard — deliberately
          // not stricter for ingredients than the codebase already is for
          // product stock at this same trigger point.
          await tx.outletingredientstock.upsert({
            where: {
              outletId_ingredientId: {
                outletId,
                ingredientId: row.ingredientId,
              },
            },
            update: { stockQuantity: { increment: delta } },
            create: {
              outletId,
              ingredientId: row.ingredientId,
              stockQuantity: delta,
            },
          });
        }

        await tx.stockmovement.create({
          data: {
            shopId,
            productId: null,
            variantId: null,
            ingredientId: row.ingredientId,
            type: 'CONSUMED',
            reason: null,
            delta,
            outletId,
            toOutletId: null,
            note: null,
            actorUserId: options.actorUserId,
          },
        });
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
    product: {
      name: string;
      giftCardDenominations: Prisma.JsonValue;
      giftCardCustomAmountMin: Prisma.Decimal | null;
      giftCardCustomAmountMax: Prisma.Decimal | null;
    },
    amount: number,
  ) {
    if (amount <= 0) {
      throw new BadRequestException(
        'Gift card amount must be greater than zero',
      );
    }
    const denominations = Array.isArray(product.giftCardDenominations)
      ? (product.giftCardDenominations as number[])
      : [];
    if (denominations.includes(amount)) return;
    if (
      product.giftCardCustomAmountMin !== null &&
      product.giftCardCustomAmountMax !== null
    ) {
      const min = Number(product.giftCardCustomAmountMin);
      const max = Number(product.giftCardCustomAmountMax);
      if (amount >= min && amount <= max) return;
    }
    throw new BadRequestException(
      `${amount} is not a valid gift card amount for ${product.name}`,
    );
  }

  private async attachOutletStockBreakdown(
    shopId: number,
    response: ReturnType<ProductsService['toResponse']>,
  ) {
    const outlets = await this.prisma.outlet.findMany({
      where: { shopId },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });

    const productStock = await this.prisma.outletstock.findMany({
      where: { productId: response.id },
      select: { outletId: true, stockQuantity: true },
    });
    const productStockByOutlet = new Map(
      productStock.map((s) => [s.outletId, s.stockQuantity]),
    );
    (response as any).stockByOutlet = outlets.map((o) => ({
      outletId: o.id,
      outletName: o.name,
      stockQuantity: productStockByOutlet.get(o.id) ?? 0,
    }));

    if (response.variants.length === 0) return;
    const variantIds = response.variants.map((v) => v.id);
    const variantStock = await this.prisma.outletvariantstock.findMany({
      where: { variantId: { in: variantIds } },
      select: { outletId: true, variantId: true, stockQuantity: true },
    });
    const byVariant = new Map<number, Map<number, number>>();
    for (const row of variantStock) {
      if (!byVariant.has(row.variantId))
        byVariant.set(row.variantId, new Map());
      byVariant.get(row.variantId)!.set(row.outletId, row.stockQuantity);
    }
    for (const v of response.variants as any[]) {
      const m = byVariant.get(v.id) ?? new Map();
      v.stockByOutlet = outlets.map((o) => ({
        outletId: o.id,
        outletName: o.name,
        stockQuantity: m.get(o.id) ?? 0,
      }));
    }
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = String(error.meta?.target ?? '');
        if (target.toLowerCase().includes('slug')) {
          throw new ConflictException(
            'A product with this slug already exists',
          );
        }
        throw new ConflictException('A product with this SKU already exists');
      }
      if (error.code === 'P2003') {
        throw new ConflictException(
          'This product has order history and cannot be deleted — mark it Unavailable instead',
        );
      }
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
