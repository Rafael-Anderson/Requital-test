import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { type QueryParam, DatabaseService } from '../database/database.service';
import { upsert } from '../database/upsert.util';
import type { PoolConnection, Pool, RowDataPacket } from 'mysql2/promise';
import type { TenantContext } from '../common/tenant-context';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TransferStockDto } from './dto/transfer-stock.dto';
import { AdjustStockWithReasonDto } from './dto/adjust-stock-with-reason.dto';
import { SetLowStockThresholdDto } from './dto/set-low-stock-threshold.dto';
import {
  ListStockMovementsQueryDto,
} from './dto/list-stock-movements-query.dto';
import { buildVariantLabel } from './variant-generator';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import {
  NotifySubscriptionsService,
} from '../notify-subscriptions/notify-subscriptions.service';

// Stock operations: adjust, transfer, movement history and low-stock thresholds, for products, variants and ingredients.
@Injectable()
export class ProductStockService {
  constructor(
    private readonly db: DatabaseService,
    private readonly branchRolesService: BranchRolesService,
    private readonly notifySubscriptionsService: NotifySubscriptionsService,
  ) {}

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
}
