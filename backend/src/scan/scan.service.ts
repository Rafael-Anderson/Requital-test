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

@Injectable()
export class ScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ocrService: OcrService,
    private readonly scanSettingsService: ScanSettingsService,
  ) {}

  // Read-only — OCR + heuristic parsing + fuzzy-match suggestions against
  // this shop's existing catalog. Nothing is persisted except the uploaded
  // image itself (needed either way for the audit trail once/if the
  // merchant confirms — see ScanController's multer config, same
  // upload-now-reference-later pattern as products/upload).
  async preview(ctx: TenantContext, file: Express.Multer.File) {
    const settings = await this.scanSettingsService.findOne(ctx);
    const rawText = await this.ocrService.recognize(file.path);
    const parsedLines = parseInvoiceText(rawText, settings.excludeKeywords, settings.includeKeywords);

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
      ...products.map((p) => ({ id: p.id, type: 'product' as const, name: p.name })),
      ...ingredients.map((i) => ({ id: i.id, type: 'ingredient' as const, name: i.name })),
    ];

    const items = parsedLines.map((line) => ({
      rawLine: line.rawLine,
      name: line.name,
      quantity: line.quantity,
      price: line.price,
      suggestions: findBestMatches(line.name, candidates),
    }));

    return {
      imageUrl: `/uploads/scans/${file.filename}`,
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
      throw new BadRequestException('One or more outletId values are invalid for this shop');
    }

    const matchedProductIds = dto.items
      .filter((i) => i.targetType === 'product' && i.matchedId)
      .map((i) => i.matchedId!);
    const matchedIngredientIds = dto.items
      .filter((i) => i.targetType === 'ingredient' && i.matchedId)
      .map((i) => i.matchedId!);
    const [ownedProducts, ownedIngredients] = await Promise.all([
      matchedProductIds.length
        ? this.prisma.product.findMany({ where: { id: { in: matchedProductIds }, shopId: ctx.shopId }, select: { id: true } })
        : [],
      matchedIngredientIds.length
        ? this.prisma.ingredient.findMany({ where: { id: { in: matchedIngredientIds }, shopId: ctx.shopId }, select: { id: true } })
        : [],
    ]);
    const ownedProductIds = new Set(ownedProducts.map((p) => p.id));
    const ownedIngredientIds = new Set(ownedIngredients.map((i) => i.id));

    const newCategoryIds = [
      ...new Set(
        dto.items
          .filter((i) => !i.matchedId && i.targetType === 'product' && i.createNew?.categoryId)
          .map((i) => i.createNew!.categoryId!),
      ),
    ];
    if (newCategoryIds.length > 0) {
      const owned = await this.prisma.category.count({ where: { id: { in: newCategoryIds }, shopId: ctx.shopId } });
      if (owned !== newCategoryIds.length) {
        throw new BadRequestException('One or more categoryId values are invalid for this shop');
      }
    }

    for (const item of dto.items) {
      if (item.matchedId) {
        const ownedSet = item.targetType === 'product' ? ownedProductIds : ownedIngredientIds;
        if (!ownedSet.has(item.matchedId)) {
          throw new BadRequestException(`matchedId ${item.matchedId} is invalid for this shop`);
        }
      } else if (!item.createNew) {
        throw new BadRequestException('Each item needs either matchedId or createNew');
      } else if (item.targetType === 'product' && (item.createNew.price === undefined || item.createNew.categoryId === undefined)) {
        throw new BadRequestException('Creating a new product requires price and categoryId');
      } else if (item.targetType === 'ingredient' && !item.createNew.unit) {
        throw new BadRequestException('Creating a new ingredient requires a unit');
      }
    }

    let created = 0;
    let updated = 0;
    const usedSlugsThisBatch = new Set<string>();

    const batch = await this.prisma.$transaction(async (tx) => {
      const scanBatch = await tx.scanbatch.create({
        data: { shopId: ctx.shopId, imageUrl: dto.imageUrl, actorUserId: ctx.userId },
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
            (await tx.product.findFirst({ where: { shopId: ctx.shopId, slug }, select: { id: true } }))
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
              productcategory: { create: [{ categoryId: item.createNew!.categoryId! }] },
            },
            select: { id: true },
          });
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
        // now the total count".
        if (item.targetType === 'product') {
          await tx.outletstock.upsert({
            where: { outletId_productId: { outletId: item.outletId, productId: targetId } },
            update: { stockQuantity: { increment: item.quantity } },
            create: { outletId: item.outletId, productId: targetId, stockQuantity: item.quantity },
          });
        } else {
          await tx.outletingredientstock.upsert({
            where: { outletId_ingredientId: { outletId: item.outletId, ingredientId: targetId } },
            update: { stockQuantity: { increment: item.quantity } },
            create: { outletId: item.outletId, ingredientId: targetId, stockQuantity: item.quantity },
          });
        }

        await tx.stockmovement.create({
          data: {
            shopId: ctx.shopId,
            productId: item.targetType === 'product' ? targetId : null,
            ingredientId: item.targetType === 'ingredient' ? targetId : null,
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

    return { batchId: batch.id, created, updated, total: dto.items.length };
  }
}
