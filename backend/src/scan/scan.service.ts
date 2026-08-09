import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { slugify } from '../common/slugify';
import { OcrService } from './ocr.service';
import { ScanSettingsService } from './scan-settings.service';
import { parseInvoiceText } from './ocr-parser';
import { findBestMatches, type MatchCandidate } from './fuzzy-match';
import { CommitScanDto } from './dto/commit-scan.dto';
import { StorageService } from '../storage/storage.service';
import { NotifySubscriptionsService } from '../notify-subscriptions/notify-subscriptions.service';
import { ProductsService } from '../products/products.service';

@Injectable()
export class ScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ocrService: OcrService,
    private readonly scanSettingsService: ScanSettingsService,
    private readonly storageService: StorageService,
    private readonly notifySubscriptionsService: NotifySubscriptionsService,
    private readonly productsService: ProductsService,
  ) {}

  // Read-only — OCR + heuristic parsing + fuzzy-match suggestions against
  // this shop's existing catalog. Nothing is persisted except the uploaded
  // image itself (needed either way for the audit trail once/if the
  // merchant confirms — see ScanController's multer config, same
  // upload-now-reference-later pattern as products/upload). Routes through
  // StorageService like every other image upload (Phase 6) — real
  // magic-byte validation and shop-scoped storage apply here too, not just
  // to customer-facing product photos; OCR runs against the same in-memory
  // buffer, not the (thumbnail/medium) stored variants.
  async preview(ctx: TenantContext, file: Express.Multer.File) {
    const settings = await this.scanSettingsService.findOne(ctx);
    const [rawText, uploaded] = await Promise.all([
      this.ocrService.recognize(file.buffer),
      this.storageService.uploadImage(ctx.shopId, 'scans', file),
    ]);
    const parsedLines = parseInvoiceText(
      rawText,
      settings.excludeKeywords,
      settings.includeKeywords,
    );

    const [products, ingredients] = await Promise.all([
      this.prisma.product.findMany({
        where: { shopId: ctx.shopId },
        select: { id: true, name: true },
      }),
      this.prisma.ingredient.findMany({
        where: { shopId: ctx.shopId },
        select: { id: true, name: true },
      }),
    ]);
    const candidates: MatchCandidate[] = [
      ...products.map((p) => ({
        id: p.id,
        type: 'product' as const,
        name: p.name,
      })),
      ...ingredients.map((i) => ({
        id: i.id,
        type: 'ingredient' as const,
        name: i.name,
      })),
    ];

    const items = parsedLines.map((line) => ({
      rawLine: line.rawLine,
      name: line.name,
      quantity: line.quantity,
      price: line.price,
      suggestions: findBestMatches(line.name, candidates),
    }));

    return {
      imageUrl: uploaded.url,
      rawText,
      items,
      defaultOutletId: settings.defaultOutletId,
      unmatchedBehavior: settings.unmatchedBehavior,
    };
  }

  // Everything the merchant reviewed/edited on the preview screen, applied
  // as one transaction: creates Products/Ingredients as needed, applies a
  // RECEIVED stockmovement per line (see stock-movement.constants.ts),
  // grouped under one scanbatch row pointing at the source image. Every
  // matchedId is re-verified against ctx.shopId here — never trusted from
  // the client, same discipline as CSV import's row matching.
  async commit(ctx: TenantContext, dto: CommitScanDto) {
    if (dto.items.length === 0) {
      throw new BadRequestException('No items to commit');
    }

    const outletIds = [...new Set(dto.items.map((i) => i.outletId))];
    const outlets = await this.prisma.outlet.findMany({
      where: { id: { in: outletIds }, shopId: ctx.shopId },
      select: { id: true },
    });
    if (outlets.length !== outletIds.length) {
      throw new BadRequestException(
        'One or more outletId values are invalid for this shop',
      );
    }

    const matchedProductIds = dto.items
      .filter((i) => i.targetType === 'product' && i.matchedId)
      .map((i) => i.matchedId!);
    const matchedIngredientIds = dto.items
      .filter((i) => i.targetType === 'ingredient' && i.matchedId)
      .map((i) => i.matchedId!);
    const [ownedProducts, ownedIngredients] = await Promise.all([
      matchedProductIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: matchedProductIds }, shopId: ctx.shopId },
            select: {
              id: true,
              usesIngredients: true,
              productoption: { select: { id: true } },
            },
          })
        : [],
      matchedIngredientIds.length
        ? this.prisma.ingredient.findMany({
            where: { id: { in: matchedIngredientIds }, shopId: ctx.shopId },
            select: { id: true },
          })
        : [],
    ]);
    const ownedProductIds = new Set(ownedProducts.map((p) => p.id));
    // `as const` on the tuple, not just relying on inference — this
    // ternary+Promise.all pattern makes TS lose ownedProducts' element type
    // (collapses to `any`, see CLAUDE.md's own note on this exact file),
    // which otherwise breaks Map's constructor overload resolution
    // entirely (a bare `.map((p) => [p.id, p])` infers `any[]`, not a
    // 2-tuple). The `.usesIngredients`/`.productoption` reads below are
    // still effectively unchecked by the type checker as a result — a
    // pre-existing, documented gap, not introduced by this cast.
    const ownedProductsById = new Map(
      ownedProducts.map((p) => [p.id, p] as const),
    );
    const ownedIngredientIds = new Set(ownedIngredients.map((i) => i.id));

    // Every variantId the client sent alongside a matched product — checked
    // in bulk (not per-item findFirst) that each actually belongs to the
    // product it was submitted against.
    const variantChecks = dto.items.filter(
      (i) => i.targetType === 'product' && i.matchedId && i.variantId,
    );
    const variantIdsToCheck = variantChecks.map((i) => i.variantId!);
    const ownedVariants = variantIdsToCheck.length
      ? await this.prisma.productvariant.findMany({
          where: { id: { in: variantIdsToCheck } },
          select: { id: true, productId: true },
        })
      : [];
    const ownedVariantsById = new Map(ownedVariants.map((v) => [v.id, v]));

    const newCollectionIds = [
      ...new Set(
        dto.items
          .filter(
            (i) =>
              !i.matchedId &&
              i.targetType === 'product' &&
              i.createNew?.collectionId,
          )
          .map((i) => i.createNew!.collectionId!),
      ),
    ];
    if (newCollectionIds.length > 0) {
      const owned = await this.prisma.collection.count({
        where: { id: { in: newCollectionIds }, shopId: ctx.shopId },
      });
      if (owned !== newCollectionIds.length) {
        throw new BadRequestException(
          'One or more collectionId values are invalid for this shop',
        );
      }
    }

    for (const item of dto.items) {
      if (item.matchedId) {
        const ownedSet =
          item.targetType === 'product' ? ownedProductIds : ownedIngredientIds;
        if (!ownedSet.has(item.matchedId)) {
          throw new BadRequestException(
            `matchedId ${item.matchedId} is invalid for this shop`,
          );
        }
        if (item.targetType === 'product') {
          const product = ownedProductsById.get(item.matchedId)!;
          if (product.usesIngredients) {
            throw new BadRequestException(
              'This product uses a recipe — scan its ingredients individually instead',
            );
          }
          if (product.productoption.length > 0 && !item.variantId) {
            throw new BadRequestException(
              `Product ${item.matchedId} has variants — select which one this line is for`,
            );
          }
          if (product.productoption.length === 0 && item.variantId) {
            throw new BadRequestException(
              `Product ${item.matchedId} does not have variants`,
            );
          }
          if (item.variantId) {
            const variant = ownedVariantsById.get(item.variantId);
            if (!variant || variant.productId !== item.matchedId) {
              throw new BadRequestException(
                `variantId ${item.variantId} is invalid for product ${item.matchedId}`,
              );
            }
          }
        } else if (item.variantId) {
          throw new BadRequestException(
            'variantId is only valid for targetType product',
          );
        }
      } else if (!item.createNew) {
        throw new BadRequestException(
          'Each item needs either matchedId or createNew',
        );
      } else if (
        item.targetType === 'product' &&
        (item.createNew.price === undefined ||
          item.createNew.collectionId === undefined)
      ) {
        throw new BadRequestException(
          'Creating a new product requires price and collectionId',
        );
      } else if (item.targetType === 'ingredient' && !item.createNew.unit) {
        throw new BadRequestException(
          'Creating a new ingredient requires a unit',
        );
      }
    }

    let created = 0;
    let updated = 0;
    const usedSlugsThisBatch = new Set<string>();
    const restockNotifyTargets = new Set<string>();

    const batch = await this.prisma.$transaction(async (tx) => {
      const scanBatch = await tx.scanbatch.create({
        data: {
          shopId: ctx.shopId,
          imageUrl: dto.imageUrl,
          actorUserId: ctx.userId,
        },
      });

      for (const item of dto.items) {
        let targetId: number;

        if (item.matchedId) {
          targetId = item.matchedId;
          updated += 1;
        } else if (item.targetType === 'product') {
          const root = slugify(item.createNew!.name);
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

          const newProduct = await tx.product.create({
            data: {
              shopId: ctx.shopId,
              name: item.createNew!.name,
              price: item.createNew!.price!,
              // No image comes from a scanned invoice — left blank rather
              // than a fake placeholder URL; the merchant adds a real photo
              // when they flesh out this quick-created draft (see
              // CommitScanNewItemDto's comment).
              thumbnail: '',
              sku: `SCAN-${randomUUID().slice(0, 8).toUpperCase()}`,
              slug,
              // Draft, same as ProductsService.duplicate's quick-created
              // copies — a scan-created product shouldn't go live on the
              // storefront before the merchant has reviewed it.
              status: 'Unavailable',
              trackInventory: true,
              productcollection: {
                create: [{ collectionId: item.createNew!.collectionId! }],
              },
            },
            select: {
              id: true,
              name: true,
              thumbnail: true,
              trackInventory: true,
              costPrice: true,
            },
          });
          // A scan-created product is always simple/usesIngredients:false
          // (no recipe UI exists on this flow) — needs its own shadow
          // ingredient just like one created via the product form.
          await this.productsService.provisionShadowForProduct(
            tx,
            ctx,
            newProduct.id,
            {
              name: newProduct.name,
              thumbnail: newProduct.thumbnail,
              trackInventory: newProduct.trackInventory,
              costPrice: newProduct.costPrice,
            },
          );
          targetId = newProduct.id;
          created += 1;
        } else {
          const newIngredient = await tx.ingredient.create({
            data: {
              shopId: ctx.shopId,
              name: item.createNew!.name,
              unit: item.createNew!.unit!,
              trackInventory: true,
            },
            select: { id: true },
          });
          targetId = newIngredient.id;
          created += 1;
        }

        // RECEIVED is always an add, not the CSV import's absolute-set —
        // scanning an invoice means "these units arrived", never "this is
        // now the total count". A product target resolves through its
        // shadow ingredient (or the matched variant's own shadow) — same
        // resolver every other stock-mutation endpoint uses; an ingredient
        // target is already the real ingredientId.
        const resolved =
          item.targetType === 'product'
            ? await this.productsService.resolveShadowStockTarget(
                ctx,
                { productId: targetId, variantId: item.variantId },
                tx,
              )
            : { ingredientId: targetId, productId: null, variantId: null };

        const before = await tx.outletingredientstock.findUnique({
          where: {
            outletId_ingredientId: {
              outletId: item.outletId,
              ingredientId: resolved.ingredientId,
            },
          },
        });
        const beforeQty = before?.stockQuantity ?? 0;
        if (
          item.targetType === 'product' &&
          beforeQty <= 0 &&
          beforeQty + item.quantity > 0
        ) {
          restockNotifyTargets.add(
            `${targetId}:${item.variantId ?? ''}`,
          );
        }
        await tx.outletingredientstock.upsert({
          where: {
            outletId_ingredientId: {
              outletId: item.outletId,
              ingredientId: resolved.ingredientId,
            },
          },
          update: { stockQuantity: { increment: item.quantity } },
          create: {
            outletId: item.outletId,
            ingredientId: resolved.ingredientId,
            stockQuantity: item.quantity,
          },
        });

        // Price capture — OCR-parsed and merchant-confirmed on the review
        // screen (see CommitScanItemDto.price's own comment). Written to
        // whichever field the merchant actually sees: product.costPrice for
        // a product target (its own shadow ingredient's costPerUnit is
        // never displayed anywhere), ingredient.costPerUnit for a real
        // ingredient target.
        if (item.price !== undefined) {
          if (item.targetType === 'product') {
            await tx.product.update({
              where: { id: targetId },
              data: { costPrice: item.price },
            });
          } else {
            await tx.ingredient.update({
              where: { id: targetId },
              data: { costPerUnit: item.price },
            });
          }
        }

        await tx.stockmovement.create({
          data: {
            shopId: ctx.shopId,
            productId: resolved.productId,
            variantId: resolved.variantId,
            ingredientId: resolved.ingredientId,
            type: 'RECEIVED',
            reason: null,
            delta: item.quantity,
            outletId: item.outletId,
            toOutletId: null,
            note: 'Scan to Stock',
            actorUserId: ctx.userId,
            scanBatchId: scanBatch.id,
          },
        });
      }

      return scanBatch;
    });

    for (const key of restockNotifyTargets) {
      const [productIdStr, variantIdStr] = key.split(':');
      this.notifySubscriptionsService
        .triggerForProduct(
          ctx.shopId,
          Number(productIdStr),
          variantIdStr ? Number(variantIdStr) : undefined,
        )
        .catch(() => {});
    }

    return { batchId: batch.id, created, updated, total: dto.items.length };
  }
}
