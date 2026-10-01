import { Injectable, BadRequestException } from '@nestjs/common';
import { buildSetClause } from '../database/update.util';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { TenantContext } from '../common/tenant-context';
import { ProductIngredientInput } from './dto/product-ingredient-input.dto';
import { DatabaseService } from '../database/database.service';

// Bill of materials plumbing: the auto-created "shadow" ingredient that makes a plain product stock-trackable, and recipe link validation. Leaf service called by catalog and CSV import.
@Injectable()
export class ProductBomService {
  constructor(
    private readonly db: DatabaseService,
  ) {}

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
  async provisionShadowForVariant(
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
  // Keeps a shadow ingredient's own columns in step with the product (or
  // variant) it mirrors. Every field here is a *projection* of the product:
  // a shadow has no independent identity, so letting one drift is a silent
  // data bug rather than a difference of opinion.
  //
  // costPerUnit was missing from this list until 2026-09-21, so a shadow's
  // cost was a snapshot frozen at provisioning time that never moved again
  // when the merchant edited product.costPrice. Nothing merchant-visible
  // read it (IngredientsService excludes shadows from both list and detail),
  // and the margin work deliberately computes a plain product's cost from
  // product.costPrice rather than from here - but that was containment, not
  // a fix: any future reader of a shadow's costPerUnit would have inherited
  // the staleness. Now it tracks.
  //
  // undefined means "this save did not touch that field" (buildSetClause
  // drops it), so passing dto.costPrice through only writes when a cost was
  // actually submitted.
  async syncShadowMeta(
    conn: PoolConnection,
    where: { shadowProductId: number } | { shadowVariantIdIn: number[] },
    meta: {
      name?: string;
      thumbnail?: string;
      trackInventory?: boolean;
      costPrice?: string | number | null;
    },
  ): Promise<void> {
    const set = buildSetClause({
      name: meta.name,
      image: meta.thumbnail,
      trackInventory: meta.trackInventory,
      // Same column the provisioning INSERTs above populate from the very
      // same product.costPrice, so the two cannot disagree about units.
      costPerUnit:
        meta.costPrice === undefined
          ? undefined
          : meta.costPrice === null
            ? null
            : String(meta.costPrice),
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
  async deleteShadowForProduct(
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
  async deleteShadowsForVariants(
    conn: PoolConnection,
    variantIds: number[],
  ): Promise<void> {
    if (variantIds.length === 0) return;
    await conn.query(
      `DELETE FROM ingredient WHERE shadowVariantId IN (${variantIds.map(() => '?').join(', ')})`,
      variantIds,
    );
  }

  // Bill of Materials — validates a full recipe submission (product-level
  // default or a single variant's override list) before any writes: every
  // ingredientId must belong to this shop (tenant isolation — a recipe can
  // never reference another shop's ingredient) and appear at most once
  // (two rows for the same ingredient in one recipe is always a client
  // bug, not a real distinct-quantities case — the second would just
  // silently overwrite the first in `create`, so it's rejected up front
  // instead).
  async assertIngredientLinksValid(
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
}
