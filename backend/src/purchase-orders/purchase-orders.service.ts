import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { trimDecimal } from '../database/decimal.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type {
  PurchaseorderlineRow,
  PurchaseorderRow,
  PurchaseorderreceiptlineRow,
  PurchaseorderreceiptRow,
} from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { NotifySubscriptionsService } from '../notify-subscriptions/notify-subscriptions.service';
import { ProductsService } from '../products/products.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import {
  CreatePurchaseOrderDto,
  ListPurchaseOrdersQueryDto,
  PurchaseOrderLineDto,
  ReceivePurchaseOrderDto,
  ReplacePurchaseOrderLinesDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';
import {
  CANCELLABLE_STATUSES,
  formatPoNumber,
  isRealDateKey,
  lineAmount,
  RECEIVABLE_STATUSES,
  statusAfterReceipt,
  sumAmounts,
} from './purchase-order-rules';
import { applyStockReceipt } from './receipt-stock';

// =============================================================================
// STEP 0 DESIGN (INV-2): how receiving stock interacts with the rest of the
// system. Verified against the code on 2026-10-02; each point cites where.
//
// (a) THE STOCK LEDGER. Stock lives in outletingredientstock (composite PK
//     [outletId, ingredientId]); every change also writes a stockmovement row
//     (type is a plain VARCHAR; see products/stock-movement.constants.ts), and the
//     W5 invariant is SUM(stockmovement.delta) == outletingredientstock.stockQuantity
//     (test/stock-concurrency-ledger.e2e-spec.ts, expectConserved). Receiving posts
//     through receipt-stock.ts, which performs the identical additive upsert and
//     movement insert that adjustStock (products/product-stock.service.ts, the
//     `INSERT ... ON DUPLICATE KEY UPDATE stockQuantity = stockQuantity + ...`
//     branch) and scan-to-stock (scan/scan.service.ts) perform inline; there is no
//     shared helper to call, and refactoring those paths is out of scope. The new
//     movement type is 'PURCHASE_RECEIPT' (no migration: the column is VARCHAR). Each
//     receipt line stores its stockmovement id, so receipt -> ledger is traceable.
// (b) THE ORDER CONSUMPTION RECORD. orderstockconsumption / order.consumptionRecordedAt
//     (orders/orders.service.ts, products/product-order-items.service.ts
//     releaseOrderConsumption) record what an ORDER holds out of stock so cancel,
//     return and edit-down give back exactly that. A receipt is not an order: it
//     adds stock and must never be released by an order lifecycle path. So this
//     module never reads or writes either, and is invisible to them; ledger
//     conservation still holds because every receipt posts its own movement.
// (c) COSTS. ingredient.costPerUnit has no currency column and product.costPrice /
//     orderitem.unitCost are read as the shop's currency (products/product-cost.ts,
//     unitCostCurrency is universally AED), so writing a PO's cost into them would
//     silently re-denominate a KWD price as AED. Therefore NOTHING here changes
//     ingredient.costPerUnit or product.costPrice, and the opt-in "update ingredient
//     cost" flag is NOT built (decision, reported). The unit cost of what was actually
//     received is captured on purchaseorderreceiptline.unitCost (+ currency) at the
//     moment of receipt and never recomputed; the ordered price on the PO line is a
//     separate frozen figure.
// (d) BACK-IN-STOCK. NotifySubscriptionsService.triggerForProduct fires on 0 ->
//     positive crossings in adjustStock / transfer / scan (not awaited, after commit).
//     Receiving does the same: the crossing is detected on the row our own write
//     locked, collected during the transaction, and fired after commit, only for a
//     shadow ingredient (the only kind with a product to notify about).
// (e) PRODUCT PICKER. Every product resolves to an ingredient through productingredient
//     (a plain product through its shadow ingredient; product-bom.service.ts). A PO
//     line therefore stores ingredientId; a product-level pick (productId[, variantId])
//     is resolved to it through ProductsService.resolveShadowStockTarget, which also
//     validates shop ownership and refuses a recipe-backed product.
//
// OTHER DECISIONS
//  - Quantities are whole units (stock columns are INT). A line may not receive more
//    than ordered (409): no allowOverReceive in v1, over-delivery is a new line or a
//    supplier conversation.
//  - Cancelling is allowed only from draft|sent. After any receipt it is a 409:
//    received stock is never reversed in v1 (that is a supplier return document).
//  - PO currency is NOT NULL and never defaulted: from the supplier or an explicit
//    override, else 400. Every line and receipt carries that currency.
//  - totals: line amounts rounded once (minor unit of the PO currency), subtotal is the
//    exact integer-minor-unit sum of the lines, total = subtotal (no tax/freight in v1).
//  - Receiving is one transaction: PO row locked FOR UPDATE first, status and per-line
//    caps re-read under the lock, the PO status moved by a compare-and-swap UPDATE whose
//    affectedRows is checked. Nothing inside the transaction touches the pool.
// =============================================================================

type PoRow = PurchaseorderRow & RowDataPacket;
type LineRow = PurchaseorderlineRow & RowDataPacket;

interface ResolvedLine {
  ingredientId: number;
  productId: number | null;
  variantId: number | null;
  supplierSku: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
    private readonly branchRolesService: BranchRolesService,
    private readonly notifySubscriptionsService: NotifySubscriptionsService,
    private readonly productsService: ProductsService,
    private readonly suppliersService: SuppliersService,
  ) {}

  // ---- reads ----

  async findAll(ctx: TenantContext, query: ListPurchaseOrdersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    // A branch user's own outlet always wins over what the request asked for.
    const outletId = resolveOutletFilter(ctx, query.outletId);
    const conditions = ['po.shopId = ?'];
    const params: (string | number)[] = [ctx.shopId];
    if (outletId !== undefined) {
      conditions.push('po.outletId = ?');
      params.push(outletId);
    }
    if (query.status) {
      conditions.push('po.status = ?');
      params.push(query.status);
    }
    if (query.supplierId) {
      conditions.push('po.supplierId = ?');
      params.push(query.supplierId);
    }
    const where = conditions.join(' AND ');
    const count = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM purchaseorder po WHERE ${where}`,
      params,
    );
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT po.*, DATE_FORMAT(po.expectedAt, '%Y-%m-%d') AS expectedAtKey,
              s.name AS supplierName, o.name AS outletName,
              (SELECT COALESCE(SUM(l.quantityOrdered), 0) FROM purchaseorderline l WHERE l.poId = po.id) AS unitsOrdered,
              (SELECT COALESCE(SUM(l.quantityReceived), 0) FROM purchaseorderline l WHERE l.poId = po.id) AS unitsReceived
       FROM purchaseorder po
       JOIN supplier s ON s.id = po.supplierId AND s.shopId = po.shopId
       JOIN outlet o ON o.id = po.outletId AND o.shopId = po.shopId
       WHERE ${where}
       ORDER BY po.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    return {
      data: rows.map((r) => ({
        ...this.shapePo(r as PoRow & { expectedAtKey: string | null }),
        supplierName: r.supplierName as string,
        outletName: r.outletName as string,
        unitsOrdered: Number(r.unitsOrdered),
        unitsReceived: Number(r.unitsReceived),
      })),
      page,
      pageSize,
      total: Number(count[0].c),
    };
  }

  async findOne(ctx: TenantContext, id: number) {
    const po = await this.getVisible(ctx, id);
    await this.branchRolesService.assertPermission(
      ctx,
      po.outletId,
      'purchase_orders.view',
    );
    return this.buildDetail(ctx.shopId, po);
  }

  // ---- writes ----

  async create(ctx: TenantContext, dto: CreatePurchaseOrderDto) {
    const outletId = resolveOutletFilter(ctx, dto.outletId);
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    if (dto.expectedAt && !isRealDateKey(dto.expectedAt)) {
      throw new BadRequestException('expectedAt is not a real date');
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
      'purchase_orders.manage',
    );

    const supplier = await this.suppliersService.getOwned(
      ctx.shopId,
      dto.supplierId,
    );
    if (supplier.status !== 'active') {
      throw new ConflictException(
        'This supplier is archived. Restore it before raising a new purchase order.',
      );
    }
    const currency = dto.currency ?? supplier.currency;
    if (!currency) {
      throw new BadRequestException(
        'This supplier has no currency. Set one on the supplier or choose a currency for this purchase order.',
      );
    }
    const lines = await this.resolveLines(
      ctx,
      supplier.id,
      currency,
      dto.lines,
    );
    const subtotal = sumAmounts(
      lines.map((l) => l.lineTotal),
      currency,
    );

    const id = await this.db.transaction(async (conn) => {
      const poNumber = await this.nextPoNumber(conn, ctx.shopId);
      const [result] = await conn.query(
        `INSERT INTO purchaseorder (shopId, outletId, supplierId, poNumber, status, currency, subtotal, total, expectedAt, notes, createdByUserId, updatedAt)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          outletId,
          supplier.id,
          poNumber,
          currency,
          subtotal,
          subtotal,
          dto.expectedAt ?? null,
          dto.notes ?? null,
          ctx.userId,
          new Date(),
        ],
      );
      const poId = (result as { insertId: number }).insertId;
      await this.insertLines(conn, ctx.shopId, poId, currency, lines);
      return poId;
    });
    await this.auditLogService.logCtx(ctx, {
      action: 'purchase_order.created',
      entityType: 'purchaseorder',
      entityId: id,
      after: { supplierId: supplier.id, outletId, currency, subtotal },
    });
    return this.buildDetail(ctx.shopId, await this.getOwnedRow(ctx.shopId, id));
  }

  // Draft only: expectedAt and notes ride along with sent as well, lines never do.
  async update(ctx: TenantContext, id: number, dto: UpdatePurchaseOrderDto) {
    const po = await this.getVisible(ctx, id);
    await this.branchRolesService.assertPermission(
      ctx,
      po.outletId,
      'purchase_orders.manage',
    );
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (dto.expectedAt && !isRealDateKey(dto.expectedAt)) {
      throw new BadRequestException('expectedAt is not a real date');
    }
    if (dto.expectedAt !== undefined) {
      sets.push('expectedAt = ?');
      params.push(dto.expectedAt);
    }
    if (dto.notes !== undefined) {
      sets.push('notes = ?');
      params.push(dto.notes);
    }
    if (sets.length > 0) {
      const result = await this.db.execute(
        `UPDATE purchaseorder SET ${sets.join(', ')}, updatedAt = ?
         WHERE id = ? AND shopId = ? AND outletId = ? AND status IN ('draft', 'sent')`,
        [...params, new Date(), id, ctx.shopId, po.outletId],
      );
      if (result.affectedRows === 0) {
        throw new ConflictException(
          `A ${po.status} purchase order can no longer be edited`,
        );
      }
      await this.auditLogService.logCtx(ctx, {
        action: 'purchase_order.updated',
        entityType: 'purchaseorder',
        entityId: id,
        after: { ...dto },
      });
    }
    return this.buildDetail(ctx.shopId, await this.getOwnedRow(ctx.shopId, id));
  }

  // Replaces every line of a DRAFT. The status is re-checked under the row lock,
  // so a send racing this edit either wins (the edit 409s) or loses (the send sees
  // the new lines), never a send of half-edited lines.
  async replaceLines(
    ctx: TenantContext,
    id: number,
    dto: ReplacePurchaseOrderLinesDto,
  ) {
    const po = await this.getVisible(ctx, id);
    await this.branchRolesService.assertPermission(
      ctx,
      po.outletId,
      'purchase_orders.manage',
    );
    if (po.status !== 'draft') {
      throw new ConflictException('Lines can only be edited while a purchase order is a draft');
    }
    const lines = await this.resolveLines(
      ctx,
      po.supplierId,
      po.currency,
      dto.lines,
    );
    const subtotal = sumAmounts(
      lines.map((l) => l.lineTotal),
      po.currency,
    );
    await this.db.transaction(async (conn) => {
      const [locked] = await conn.query<RowDataPacket[]>(
        `SELECT status FROM purchaseorder WHERE id = ? AND shopId = ? AND outletId = ? FOR UPDATE`,
        [id, ctx.shopId, po.outletId],
      );
      if (locked.length === 0) throw new NotFoundException(`Purchase order ${id} not found`);
      if (locked[0].status !== 'draft') {
        throw new ConflictException('Lines can only be edited while a purchase order is a draft');
      }
      await conn.query(`DELETE FROM purchaseorderline WHERE poId = ? AND shopId = ?`, [
        id,
        ctx.shopId,
      ]);
      await this.insertLines(conn, ctx.shopId, id, po.currency, lines);
      await conn.query(
        `UPDATE purchaseorder SET subtotal = ?, total = ?, updatedAt = ? WHERE id = ? AND shopId = ?`,
        [subtotal, subtotal, new Date(), id, ctx.shopId],
      );
    });
    await this.auditLogService.logCtx(ctx, {
      action: 'purchase_order.lines_replaced',
      entityType: 'purchaseorder',
      entityId: id,
      after: { lineCount: lines.length, subtotal },
    });
    return this.buildDetail(ctx.shopId, await this.getOwnedRow(ctx.shopId, id));
  }

  // draft -> sent, compare-and-swap.
  async send(ctx: TenantContext, id: number) {
    const po = await this.getVisible(ctx, id);
    await this.branchRolesService.assertPermission(
      ctx,
      po.outletId,
      'purchase_orders.manage',
    );
    const supplier = await this.suppliersService.getOwned(ctx.shopId, po.supplierId);
    if (supplier.status !== 'active') {
      throw new ConflictException('This supplier is archived. Restore it before sending the purchase order.');
    }
    const result = await this.db.execute(
      `UPDATE purchaseorder SET status = 'sent', sentAt = ?, updatedAt = ?
       WHERE id = ? AND shopId = ? AND outletId = ? AND status = 'draft'`,
      [new Date(), new Date(), id, ctx.shopId, po.outletId],
    );
    if (result.affectedRows === 0) {
      throw new ConflictException('Only a draft purchase order can be sent');
    }
    await this.auditLogService.logCtx(ctx, {
      action: 'purchase_order.sent',
      entityType: 'purchaseorder',
      entityId: id,
    });
    return this.buildDetail(ctx.shopId, await this.getOwnedRow(ctx.shopId, id));
  }

  // draft|sent -> cancelled, compare-and-swap. A partially received order is
  // refused: stock already received is never reversed in v1.
  async cancel(ctx: TenantContext, id: number) {
    const po = await this.getVisible(ctx, id);
    await this.branchRolesService.assertPermission(
      ctx,
      po.outletId,
      'purchase_orders.manage',
    );
    const result = await this.db.execute(
      `UPDATE purchaseorder SET status = 'cancelled', cancelledAt = ?, updatedAt = ?
       WHERE id = ? AND shopId = ? AND outletId = ? AND status IN (${CANCELLABLE_STATUSES.map(() => '?').join(', ')})`,
      [new Date(), new Date(), id, ctx.shopId, po.outletId, ...CANCELLABLE_STATUSES],
    );
    if (result.affectedRows === 0) {
      const now = await this.getOwnedRow(ctx.shopId, id);
      throw new ConflictException(
        now.status === 'partially_received'
          ? 'Part of this order has already been received into stock, so it cannot be cancelled'
          : `A ${now.status} purchase order cannot be cancelled`,
      );
    }
    await this.auditLogService.logCtx(ctx, {
      action: 'purchase_order.cancelled',
      entityType: 'purchaseorder',
      entityId: id,
    });
    return this.buildDetail(ctx.shopId, await this.getOwnedRow(ctx.shopId, id));
  }

  // sent|partially_received -> partially_received|received, posting stock.
  async receive(ctx: TenantContext, id: number, dto: ReceivePurchaseOrderDto) {
    const seen = new Set<number>();
    for (const l of dto.lines) {
      if (seen.has(l.lineId)) {
        throw new BadRequestException(`Line ${l.lineId} appears more than once`);
      }
      seen.add(l.lineId);
    }
    const preview = await this.getVisible(ctx, id);
    await this.branchRolesService.assertPermission(
      ctx,
      preview.outletId,
      'purchase_orders.receive',
    );

    const crossed: { productId: number; variantId: number | null }[] = [];
    const outcome = await this.db.transaction(async (conn) => {
      // 1. Lock the PO row first; everything below is decided under this lock.
      const [poRows] = await conn.query<PoRow[]>(
        `SELECT * FROM purchaseorder WHERE id = ? AND shopId = ? FOR UPDATE`,
        [id, ctx.shopId],
      );
      const po = poRows[0];
      if (!po || (ctx.role === 'branch' && po.outletId !== ctx.outletId)) {
        throw new NotFoundException(`Purchase order ${id} not found`);
      }
      // 2. A retried receive with the same key returns the original receipt.
      if (dto.idempotencyKey) {
        const [prior] = await conn.query<RowDataPacket[]>(
          `SELECT id FROM purchaseorderreceipt WHERE poId = ? AND shopId = ? AND idempotencyKey = ?`,
          [id, ctx.shopId, dto.idempotencyKey],
        );
        if (prior.length > 0) {
          return { receiptId: prior[0].id as number, replayed: true };
        }
      }
      if (!(RECEIVABLE_STATUSES as readonly string[]).includes(po.status)) {
        throw new ConflictException(
          `A ${po.status} purchase order cannot be received`,
        );
      }
      // 3. Lines are re-read under the lock: caps are checked against what is
      //    really received now, not what the caller last saw.
      const [lineRows] = await conn.query<LineRow[]>(
        `SELECT * FROM purchaseorderline WHERE poId = ? AND shopId = ? ORDER BY id FOR UPDATE`,
        [id, ctx.shopId],
      );
      const byId = new Map(lineRows.map((l) => [l.id, l]));
      type Planned = {
        line: LineRow;
        quantity: number;
        unitCost: number;
        lineTotal: number;
      };
      const planned: Planned[] = [];
      for (const r of dto.lines) {
        const line = byId.get(r.lineId);
        if (!line) {
          throw new NotFoundException(`Line ${r.lineId} is not on this purchase order`);
        }
        if (line.ingredientId === null) {
          throw new ConflictException(
            `"${line.description}" no longer exists in your stock list, so it cannot be received`,
          );
        }
        if (line.quantityReceived + r.quantity > line.quantityOrdered) {
          throw new ConflictException(
            `Cannot receive ${r.quantity} of "${line.description}": ${line.quantityOrdered - line.quantityReceived} still outstanding`,
          );
        }
        const unitCost = r.unitCost ?? Number(line.unitCost);
        planned.push({
          line,
          quantity: r.quantity,
          unitCost,
          lineTotal: lineAmount(r.quantity, unitCost, po.currency),
        });
      }
      const receiptTotal = sumAmounts(
        planned.map((p) => p.lineTotal),
        po.currency,
      );
      const [receiptResult] = await conn.query(
        `INSERT INTO purchaseorderreceipt (poId, shopId, outletId, receivedByUserId, deliveryNoteRef, note, idempotencyKey, currency, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          ctx.shopId,
          po.outletId,
          ctx.userId,
          dto.deliveryNoteRef ?? null,
          dto.note ?? null,
          dto.idempotencyKey ?? null,
          po.currency,
          receiptTotal,
        ],
      );
      const receiptId = (receiptResult as { insertId: number }).insertId;

      // 4. Post stock in a fixed ingredient order so two receipts touching the
      //    same ingredients never lock their stock rows in opposite orders.
      planned.sort(
        (a, b) =>
          (a.line.ingredientId as number) - (b.line.ingredientId as number) ||
          a.line.id - b.line.id,
      );
      for (const p of planned) {
        // The WHERE re-states the cap, so the UPDATE itself refuses an overshoot
        // even if the lock above were ever bypassed.
        const [upd] = await conn.query(
          `UPDATE purchaseorderline SET quantityReceived = quantityReceived + ?, updatedAt = ?
           WHERE id = ? AND poId = ? AND shopId = ? AND quantityReceived + ? <= quantityOrdered`,
          [p.quantity, new Date(), p.line.id, id, ctx.shopId, p.quantity],
        );
        if ((upd as { affectedRows: number }).affectedRows === 0) {
          throw new ConflictException(
            `"${p.line.description}" was received by someone else in the meantime`,
          );
        }
        const posted = await applyStockReceipt(conn, {
          shopId: ctx.shopId,
          outletId: po.outletId,
          ingredientId: p.line.ingredientId as number,
          productId: p.line.productId,
          variantId: p.line.variantId,
          quantity: p.quantity,
          actorUserId: ctx.userId,
          note: `${po.poNumber} receipt ${receiptId}`,
        });
        await conn.query(
          `INSERT INTO purchaseorderreceiptline (receiptId, poId, poLineId, shopId, ingredientId, quantity, unitCost, currency, lineTotal, stockMovementId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            receiptId,
            id,
            p.line.id,
            ctx.shopId,
            p.line.ingredientId,
            p.quantity,
            p.unitCost,
            po.currency,
            p.lineTotal,
            posted.movementId,
          ],
        );
        if (posted.crossedFromZero && p.line.productId !== null) {
          crossed.push({ productId: p.line.productId, variantId: p.line.variantId });
        }
      }

      // 5. Move the PO's status with a compare-and-swap (affectedRows checked).
      const [after] = await conn.query<LineRow[]>(
        `SELECT quantityOrdered, quantityReceived FROM purchaseorderline WHERE poId = ? AND shopId = ?`,
        [id, ctx.shopId],
      );
      const next = statusAfterReceipt(after);
      const [swap] = await conn.query(
        `UPDATE purchaseorder SET status = ?, receivedAt = ?, updatedAt = ?
         WHERE id = ? AND shopId = ? AND status IN (${RECEIVABLE_STATUSES.map(() => '?').join(', ')})`,
        [
          next,
          next === 'received' ? new Date() : null,
          new Date(),
          id,
          ctx.shopId,
          ...RECEIVABLE_STATUSES,
        ],
      );
      if ((swap as { affectedRows: number }).affectedRows === 0) {
        throw new ConflictException('The purchase order changed while receiving; nothing was posted');
      }
      return { receiptId, replayed: false };
    }).catch((error: unknown) => {
      // Two receives with the same key racing past the existence check: the
      // unique index lets exactly one in; the loser reads the winner's receipt.
      if (dto.idempotencyKey && isDuplicateKeyError(error)) return null;
      throw error;
    });

    let receiptId: number;
    let replayed: boolean;
    if (outcome === null) {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM purchaseorderreceipt WHERE poId = ? AND shopId = ? AND idempotencyKey = ?`,
        [id, ctx.shopId, dto.idempotencyKey as string],
      );
      receiptId = rows[0].id as number;
      replayed = true;
    } else {
      ({ receiptId, replayed } = outcome);
    }

    if (!replayed) {
      // After commit, not awaited: a slow email batch never delays a goods-in.
      for (const c of crossed) {
        this.notifySubscriptionsService
          .triggerForProduct(ctx.shopId, c.productId, c.variantId ?? undefined)
          .catch(() => {});
      }
      await this.auditLogService.logCtx(ctx, {
        action: 'purchase_order.received',
        entityType: 'purchaseorder',
        entityId: id,
        metadata: { receiptId, lines: dto.lines.length },
      });
    }
    const detail = await this.buildDetail(
      ctx.shopId,
      await this.getOwnedRow(ctx.shopId, id),
    );
    return { receiptId, replayed, purchaseOrder: detail };
  }

  // ---- helpers ----

  // The PO as the caller may see it: shop-scoped, and a branch user only ever
  // sees their own outlet's orders (checked against the FETCHED row's outlet,
  // not a pre-fetch filter). Anything else is a 404, never a 403 that would
  // confirm another outlet's order exists.
  private async getVisible(ctx: TenantContext, id: number) {
    const po = await this.getOwnedRow(ctx.shopId, id);
    if (ctx.role === 'branch' && po.outletId !== ctx.outletId) {
      throw new NotFoundException(`Purchase order ${id} not found`);
    }
    return po;
  }

  private async getOwnedRow(shopId: number, id: number) {
    const rows = await this.db.query<PoRow[]>(
      `SELECT po.*, DATE_FORMAT(po.expectedAt, '%Y-%m-%d') AS expectedAtKey
       FROM purchaseorder po WHERE po.id = ? AND po.shopId = ?`,
      [id, shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Purchase order ${id} not found`);
    }
    return rows[0] as PoRow & { expectedAtKey: string | null };
  }

  private async buildDetail(
    shopId: number,
    po: PoRow & { expectedAtKey?: string | null },
  ) {
    const [supplier, outlet, lines, receipts, receiptLines] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT id, name, status, currency FROM supplier WHERE id = ? AND shopId = ?`,
        [po.supplierId, shopId],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT id, name FROM outlet WHERE id = ? AND shopId = ?`,
        [po.outletId, shopId],
      ),
      this.db.query<LineRow[]>(
        `SELECT * FROM purchaseorderline WHERE poId = ? AND shopId = ? ORDER BY id`,
        [po.id, shopId],
      ),
      this.db.query<(PurchaseorderreceiptRow & RowDataPacket)[]>(
        `SELECT * FROM purchaseorderreceipt WHERE poId = ? AND shopId = ? ORDER BY id`,
        [po.id, shopId],
      ),
      this.db.query<(PurchaseorderreceiptlineRow & RowDataPacket)[]>(
        `SELECT * FROM purchaseorderreceiptline WHERE poId = ? AND shopId = ? ORDER BY id`,
        [po.id, shopId],
      ),
    ]);
    return {
      ...this.shapePo(po),
      supplier: supplier[0] ?? null,
      outlet: outlet[0] ?? null,
      lines: lines.map((l) => ({
        ...l,
        unitCost: trimDecimal(l.unitCost),
        lineTotal: trimDecimal(l.lineTotal),
      })),
      receipts: receipts.map((r) => ({
        ...r,
        total: trimDecimal(r.total),
        lines: receiptLines
          .filter((rl) => rl.receiptId === r.id)
          .map((rl) => ({
            ...rl,
            unitCost: trimDecimal(rl.unitCost),
            lineTotal: trimDecimal(rl.lineTotal),
          })),
      })),
    };
  }

  // `expectedAtKey` is a DATE_FORMAT alias (a plain 'YYYY-MM-DD', never a
  // timezone-ambiguous Date); it replaces the raw column in the response.
  private shapePo(po: PurchaseorderRow & { expectedAtKey?: string | null }) {
    const { expectedAtKey, ...rest } = po;
    return {
      ...rest,
      expectedAt: expectedAtKey ?? null,
      subtotal: trimDecimal(po.subtotal),
      total: trimDecimal(po.total),
    };
  }

  // Per-shop counter, same idiom as invoicecounter: the seed value is wrapped in
  // LAST_INSERT_ID(...) too, or a later SELECT LAST_INSERT_ID() on the pooled
  // connection could read back an unrelated insert.
  private async nextPoNumber(conn: PoolConnection, shopId: number) {
    await conn.query(
      `INSERT INTO purchaseordercounter (shopId, lastNumber)
       VALUES (?, LAST_INSERT_ID(1))
       ON DUPLICATE KEY UPDATE lastNumber = LAST_INSERT_ID(lastNumber + 1)`,
      [shopId],
    );
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT LAST_INSERT_ID() AS seq`,
    );
    return formatPoNumber(Number(rows[0].seq));
  }

  private async insertLines(
    conn: PoolConnection,
    shopId: number,
    poId: number,
    currency: string,
    lines: ResolvedLine[],
  ) {
    for (const l of lines) {
      await conn.query(
        `INSERT INTO purchaseorderline (poId, shopId, ingredientId, productId, variantId, supplierSku, description, quantityOrdered, unitCost, currency, lineTotal, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          poId,
          shopId,
          l.ingredientId,
          l.productId,
          l.variantId,
          l.supplierSku,
          l.description,
          l.quantity,
          l.unitCost,
          currency,
          l.lineTotal,
          new Date(),
        ],
      );
    }
  }

  // Turns client lines into stock-bearing, priced, snapshotted lines. Runs on the
  // pool BEFORE any transaction opens (never inside one). Every id is checked
  // against the caller's shop: ingredients directly, products through
  // resolveShadowStockTarget.
  private async resolveLines(
    ctx: TenantContext,
    supplierId: number,
    currency: string,
    input: PurchaseOrderLineDto[],
  ): Promise<ResolvedLine[]> {
    const targets: number[] = [];
    for (const [i, l] of input.entries()) {
      const hasIng = l.ingredientId !== undefined;
      const hasProd = l.productId !== undefined;
      if (hasIng === hasProd) {
        throw new BadRequestException(
          `Line ${i + 1}: provide either ingredientId or productId`,
        );
      }
      if (l.variantId !== undefined && !hasProd) {
        throw new BadRequestException(`Line ${i + 1}: variantId needs a productId`);
      }
      const ingredientId = hasIng
        ? l.ingredientId!
        : (
            await this.productsService.resolveShadowStockTarget(ctx, {
              productId: l.productId,
              variantId: l.variantId,
            })
          ).ingredientId;
      if (targets.includes(ingredientId)) {
        throw new BadRequestException(
          `Line ${i + 1}: this item is already on the purchase order`,
        );
      }
      targets.push(ingredientId);
    }

    const ingRows = await this.db.query<RowDataPacket[]>(
      `SELECT i.id, i.name, i.shadowProductId, i.shadowVariantId, pv.productId AS variantProductId
       FROM ingredient i LEFT JOIN productvariant pv ON pv.id = i.shadowVariantId
       WHERE i.shopId = ? AND i.id IN (${targets.map(() => '?').join(', ')})`,
      [ctx.shopId, ...targets],
    );
    const ingById = new Map(ingRows.map((r) => [r.id as number, r]));
    const itemRows = await this.db.query<RowDataPacket[]>(
      `SELECT ingredientId, supplierSku, unitCost, currency FROM supplieritem
       WHERE shopId = ? AND supplierId = ? AND ingredientId IN (${targets.map(() => '?').join(', ')})`,
      [ctx.shopId, supplierId, ...targets],
    );
    const itemByIng = new Map(itemRows.map((r) => [r.ingredientId as number, r]));

    return input.map((l, i) => {
      const ingredientId = targets[i];
      const ing = ingById.get(ingredientId);
      if (!ing) throw new NotFoundException(`Ingredient ${ingredientId} not found`);
      const catalogue = itemByIng.get(ingredientId);
      // The catalogue price is a default only when it is in the PO's currency;
      // a price in another currency is never silently reused.
      const catalogueCost =
        catalogue && catalogue.unitCost !== null && catalogue.currency === currency
          ? Number(catalogue.unitCost)
          : undefined;
      const unitCost = l.unitCost ?? catalogueCost;
      if (unitCost === undefined) {
        throw new BadRequestException(
          `Line ${i + 1}: a unit cost in ${currency} is required`,
        );
      }
      return {
        ingredientId,
        productId:
          (ing.shadowProductId as number | null) ??
          (ing.variantProductId as number | null) ??
          null,
        variantId: (ing.shadowVariantId as number | null) ?? null,
        supplierSku: l.supplierSku ?? (catalogue?.supplierSku as string | null) ?? null,
        description: (l.description ?? (ing.name as string)).slice(0, 255),
        quantity: l.quantity,
        unitCost,
        lineTotal: lineAmount(l.quantity, unitCost, currency),
      };
    });
  }
}
