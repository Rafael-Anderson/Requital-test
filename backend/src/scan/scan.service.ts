import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
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
    private readonly db: DatabaseService,
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
      this.db.query<RowDataPacket[]>(
        `SELECT id, name FROM product WHERE shopId = ?`,
        [ctx.shopId],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT id, name FROM ingredient WHERE shopId = ?`,
        [ctx.shopId],
      ),
    ]);
    const candidates: MatchCandidate[] = [
      ...products.map((p) => ({
        id: p.id as number,
        type: 'product' as const,
        name: p.name as string,
      })),
      ...ingredients.map((i) => ({
        id: i.id as number,
        type: 'ingredient' as const,
        name: i.name as string,
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
    const outletRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id IN (${outletIds.map(() => '?').join(', ')}) AND shopId = ?`,
      [...outletIds, ctx.shopId],
    );
    if (outletRows.length !== outletIds.length) {
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
    const [ownedProductRows, ownedProductOptionRows, ownedIngredientRows] =
      await Promise.all([
        matchedProductIds.length
          ? this.db.query<RowDataPacket[]>(
              `SELECT id, usesIngredients, costPrice FROM product WHERE id IN (${matchedProductIds.map(() => '?').join(', ')}) AND shopId = ?`,
              [...matchedProductIds, ctx.shopId],
            )
          : Promise.resolve([]),
        matchedProductIds.length
          ? this.db.query<RowDataPacket[]>(
              `SELECT DISTINCT productId FROM productoption WHERE productId IN (${matchedProductIds.map(() => '?').join(', ')})`,
              matchedProductIds,
            )
          : Promise.resolve([]),
        matchedIngredientIds.length
          ? this.db.query<RowDataPacket[]>(
              `SELECT id FROM ingredient WHERE id IN (${matchedIngredientIds.map(() => '?').join(', ')}) AND shopId = ?`,
              [...matchedIngredientIds, ctx.shopId],
            )
          : Promise.resolve([]),
      ]);
    const ownedProductIds = new Set(ownedProductRows.map((p) => p.id as number));
    const productsWithOptions = new Set(
      ownedProductOptionRows.map((r) => r.productId as number),
    );
    const ownedProductsById = new Map(
      ownedProductRows.map((p) => [
        p.id as number,
        {
          id: p.id as number,
          usesIngredients: Boolean(p.usesIngredients),
          hasOptions: productsWithOptions.has(p.id as number),
        },
      ]),
    );
    const ownedIngredientIds = new Set(ownedIngredientRows.map((i) => i.id as number));

    // Every variantId the client sent alongside a matched product — checked
    // in bulk (not per-item findFirst) that each actually belongs to the
    // product it was submitted against.
    const variantChecks = dto.items.filter(
      (i) => i.targetType === 'product' && i.matchedId && i.variantId,
    );
    const variantIdsToCheck = variantChecks.map((i) => i.variantId!);
    const ownedVariantRows = variantIdsToCheck.length
      ? await this.db.query<RowDataPacket[]>(
          `SELECT id, productId FROM productvariant WHERE id IN (${variantIdsToCheck.map(() => '?').join(', ')})`,
          variantIdsToCheck,
        )
      : [];
    const ownedVariantsById = new Map(
      ownedVariantRows.map((v) => [v.id as number, { id: v.id as number, productId: v.productId as number }]),
    );

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
      const ownedRows = await this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM collection WHERE id IN (${newCollectionIds.map(() => '?').join(', ')}) AND shopId = ?`,
        [...newCollectionIds, ctx.shopId],
      );
      if (Number(ownedRows[0].c) !== newCollectionIds.length) {
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
          if (product.hasOptions && !item.variantId) {
            throw new BadRequestException(
              `Product ${item.matchedId} has variants — select which one this line is for`,
            );
          }
          if (!product.hasOptions && item.variantId) {
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

    const batchId = await this.db.transaction(async (conn) => {
      const [batchResult] = await conn.query(
        `INSERT INTO scanbatch (shopId, imageUrl, actorUserId) VALUES (?, ?, ?)`,
        [ctx.shopId, dto.imageUrl, ctx.userId],
      );
      const newBatchId = (batchResult as { insertId: number }).insertId;

      for (const item of dto.items) {
        let targetId: number;

        if (item.matchedId) {
          targetId = item.matchedId;
          updated += 1;
        } else if (item.targetType === 'product') {
          const root = slugify(item.createNew!.name);
          let slug = root;
          let suffix = 2;
          for (;;) {
            if (usedSlugsThisBatch.has(slug)) {
              slug = `${root}-${suffix}`;
              suffix += 1;
              continue;
            }
            const [existingRows] = await conn.query<RowDataPacket[]>(
              `SELECT id FROM product WHERE shopId = ? AND slug = ?`,
              [ctx.shopId, slug],
            );
            if (existingRows.length === 0) break;
            slug = `${root}-${suffix}`;
            suffix += 1;
          }
          usedSlugsThisBatch.add(slug);

          const [productResult] = await conn.query(
            `INSERT INTO product (shopId, name, price, thumbnail, sku, slug, status, trackInventory)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              ctx.shopId,
              item.createNew!.name,
              item.createNew!.price!,
              // No image comes from a scanned invoice — left blank rather
              // than a fake placeholder URL; the merchant adds a real photo
              // when they flesh out this quick-created draft (see
              // CommitScanNewItemDto's comment).
              '',
              `SCAN-${randomUUID().slice(0, 8).toUpperCase()}`,
              slug,
              // Draft, same as ProductsService.duplicate's quick-created
              // copies — a scan-created product shouldn't go live on the
              // storefront before the merchant has reviewed it.
              'Unavailable',
              true,
            ],
          );
          const newProductId = (productResult as { insertId: number }).insertId;
          await conn.query(
            `INSERT INTO productcollection (productId, collectionId) VALUES (?, ?)`,
            [newProductId, item.createNew!.collectionId!],
          );
          // A scan-created product is always simple/usesIngredients:false
          // (no recipe UI exists on this flow) — needs its own shadow
          // ingredient just like one created via the product form.
          await this.productsService.provisionShadowForProduct(
            conn,
            ctx,
            newProductId,
            {
              name: item.createNew!.name,
              thumbnail: '',
              trackInventory: true,
              costPrice: null,
            },
          );
          targetId = newProductId;
          created += 1;
        } else {
          const [ingredientResult] = await conn.query(
            `INSERT INTO ingredient (shopId, name, unit, trackInventory) VALUES (?, ?, ?, ?)`,
            [ctx.shopId, item.createNew!.name, item.createNew!.unit!, true],
          );
          targetId = (ingredientResult as { insertId: number }).insertId;
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
                conn,
              )
            : { ingredientId: targetId, productId: null, variantId: null };

        const [beforeRows] = await conn.query<RowDataPacket[]>(
          `SELECT stockQuantity FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
          [item.outletId, resolved.ingredientId],
        );
        const beforeQty = (beforeRows[0]?.stockQuantity as number | undefined) ?? 0;
        if (
          item.targetType === 'product' &&
          beforeQty <= 0 &&
          beforeQty + item.quantity > 0
        ) {
          restockNotifyTargets.add(`${targetId}:${item.variantId ?? ''}`);
        }
        await conn.query(
          `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE stockQuantity = stockQuantity + VALUES(stockQuantity)`,
          [item.outletId, resolved.ingredientId, item.quantity],
        );

        // Price capture — OCR-parsed and merchant-confirmed on the review
        // screen (see CommitScanItemDto.price's own comment). Written to
        // whichever field the merchant actually sees: product.costPrice for
        // a product target (its own shadow ingredient's costPerUnit is
        // never displayed anywhere), ingredient.costPerUnit for a real
        // ingredient target.
        if (item.price !== undefined) {
          if (item.targetType === 'product') {
            await conn.query(`UPDATE product SET costPrice = ? WHERE id = ?`, [
              item.price,
              targetId,
            ]);
          } else {
            await conn.query(`UPDATE ingredient SET costPerUnit = ? WHERE id = ?`, [
              item.price,
              targetId,
            ]);
          }
        }

        await conn.query(
          `INSERT INTO stockmovement (shopId, productId, variantId, ingredientId, type, reason, delta, outletId, toOutletId, note, actorUserId, scanBatchId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ctx.shopId,
            resolved.productId,
            resolved.variantId,
            resolved.ingredientId,
            'RECEIVED',
            null,
            item.quantity,
            item.outletId,
            null,
            'Scan to Stock',
            ctx.userId,
            newBatchId,
          ],
        );
      }

      return newBatchId;
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

    return { batchId, created, updated, total: dto.items.length };
  }
}
