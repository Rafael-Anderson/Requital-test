import { BadRequestException, Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { trimDecimal } from '../database/decimal.util';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { ProductsService } from '../products/products.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import type { ResolvedLine } from './purchase-orders.service';
import { lineAmount, sumAmounts } from './purchase-order-rules';
import {
  applyMinOrderQty,
  baseOrderQuantity,
  groupByPurchaseOrder,
  pickSupplier,
  positionOf,
  type SkipReason,
  type SupplierOption,
} from './reorder-rules';
import type { CreateDraftPosDto, SetReorderPointDto } from './dto/reorder.dto';

type Exec = (sql: string, params: unknown[]) => Promise<RowDataPacket[]>;

// Open = money already committed to arrive at this outlet. A draft counts: it makes
// "create draft POs" idempotent (see reorder-rules.ts).
const ON_ORDER_STATUSES = `'draft', 'sent', 'partially_received'`;

interface SuggestedLine {
  outletId: number;
  supplierId: number;
  ingredientId: number;
  productId: number | null;
  variantId: number | null;
  name: string;
  unit: string;
  quantity: number;
  unitCost: number;
  currency: string;
  lineTotal: number;
  supplierSku: string | null;
  priceComparable: boolean;
  alternatives: number;
  stock: number;
  onOrder: number;
  reorderPoint: number;
}

interface Candidate {
  outletId: number;
  outletName: string;
  ingredientId: number;
  name: string;
  unit: string;
  productId: number | null;
  variantId: number | null;
  stock: number;
  onOrder: number;
  reorderPoint: number;
  reorderQuantity: number | null;
}

// INV-5. Reorder points live on outletingredientstock (per outlet, next to but
// distinct from lowStockThreshold; see the migration for why). Every query is
// scoped by shopId through ingredient AND outlet (the stock row has no shopId of
// its own), and an outlet id from a caller is verified against the shop before use.
@Injectable()
export class ReorderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
    private readonly branchRolesService: BranchRolesService,
    private readonly productsService: ProductsService,
    private readonly purchaseOrders: PurchaseOrdersService,
  ) {}

  // ---- set / clear (admin only, audit-logged) ----

  async setPoint(ctx: TenantContext, dto: SetReorderPointDto) {
    await this.assertOutletInShop(ctx.shopId, dto.outletId);
    // Shop-checks the ingredient / product / variant and refuses a recipe product.
    const target = await this.productsService.resolveShadowStockTarget(ctx, dto);
    const before = await this.db.query<RowDataPacket[]>(
      `SELECT ois.reorderPoint, ois.reorderQuantity
       FROM outletingredientstock ois
       JOIN ingredient ing ON ing.id = ois.ingredientId AND ing.shopId = ?
       WHERE ois.outletId = ? AND ois.ingredientId = ?`,
      [ctx.shopId, dto.outletId, target.ingredientId],
    );
    // The stock row is created lazily at quantity 0 (no movement, so ledger
    // conservation holds), exactly as setLowStockThreshold does.
    await this.db.execute(
      `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity, reorderPoint, reorderQuantity)
       VALUES (?, ?, 0, ?, ?)
       ON DUPLICATE KEY UPDATE reorderPoint = VALUES(reorderPoint), reorderQuantity = VALUES(reorderQuantity)`,
      [dto.outletId, target.ingredientId, dto.reorderPoint, dto.reorderQuantity],
    );
    await this.auditLogService.logCtx(ctx, {
      action: 'reorder_point.set',
      entityType: 'ingredient',
      entityId: target.ingredientId,
      before: before[0]
        ? {
            reorderPoint: before[0].reorderPoint as number | null,
            reorderQuantity: before[0].reorderQuantity as number | null,
          }
        : { reorderPoint: null, reorderQuantity: null },
      after: {
        outletId: dto.outletId,
        reorderPoint: dto.reorderPoint,
        reorderQuantity: dto.reorderQuantity,
      },
    });
    return {
      outletId: dto.outletId,
      ingredientId: target.ingredientId,
      reorderPoint: dto.reorderPoint,
      reorderQuantity: dto.reorderQuantity,
    };
  }

  // ---- reads ----

  async lowStock(ctx: TenantContext, requestedOutletId?: number) {
    const outletId = await this.readableOutlet(ctx, requestedOutletId);
    const exec = this.poolExec();
    const rows = await this.loadCandidates(exec, ctx.shopId, outletId, false);
    return {
      data: rows.map((c) => ({
        ...c,
        position: positionOf(c),
        // true when open purchase orders already bring the position above the point
        covered: positionOf(c) > c.reorderPoint,
      })),
    };
  }

  async suggestions(ctx: TenantContext, requestedOutletId?: number) {
    const outletId = await this.readableOutlet(ctx, requestedOutletId);
    const r = await this.computeSuggestions(this.poolExec(), ctx.shopId, outletId);
    return {
      ...r,
      groups: r.groups.map((g) => ({
        ...g,
        lines: g.lines.map((l) => ({ ...l, unitCost: trimDecimal(String(l.unitCost)) })),
      })),
    };
  }

  // ---- create drafts ----

  // Creates DRAFT purchase orders (never sent) for the current suggestions of one
  // outlet, optionally one supplier. IDEMPOTENCY RULE: the whole thing runs under a
  // row lock on the outlet and recomputes the suggestions inside that lock, with
  // drafts counted as on order. Two concurrent or repeated calls serialise; the
  // second sees the first's drafts, finds nothing left to order, and creates none.
  async createDrafts(ctx: TenantContext, dto: CreateDraftPosDto) {
    const outletId = resolveOutletFilter(ctx, dto.outletId);
    if (outletId === undefined) throw new BadRequestException('outletId is required');
    await this.assertOutletInShop(ctx.shopId, outletId);
    await this.branchRolesService.assertPermission(ctx, outletId, 'purchase_orders.manage');

    const created = await this.db.transaction(async (conn) => {
      // First statement: the lock. The suggestion reads below then take their
      // snapshot after any winning call has committed.
      const [locked] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM outlet WHERE id = ? AND shopId = ? FOR UPDATE`,
        [outletId, ctx.shopId],
      );
      if (locked.length === 0) throw new BadRequestException('outletId is invalid for this shop');
      const exec: Exec = async (sql, params) => {
        const [rows] = await conn.query<RowDataPacket[]>(sql, params as never[]);
        return rows;
      };
      const result = await this.computeSuggestions(exec, ctx.shopId, outletId);
      const out: { id: number; supplierId: number; currency: string; subtotal: number; lines: number }[] = [];
      for (const g of result.groups) {
        if (dto.supplierId !== undefined && g.supplierId !== dto.supplierId) continue;
        const lines: ResolvedLine[] = g.lines.map((l) => ({
          ingredientId: l.ingredientId,
          productId: l.productId,
          variantId: l.variantId,
          supplierSku: l.supplierSku,
          description: l.name.slice(0, 255),
          quantity: l.quantity,
          unitCost: l.unitCost,
          lineTotal: lineAmount(l.quantity, l.unitCost, g.currency),
        }));
        const subtotal = sumAmounts(
          lines.map((l) => l.lineTotal),
          g.currency,
        );
        const id = await this.purchaseOrders.insertPurchaseOrder(conn, {
          shopId: ctx.shopId,
          userId: ctx.userId,
          outletId,
          supplierId: g.supplierId,
          currency: g.currency,
          subtotal,
          expectedAt: null,
          notes: 'Created from reorder suggestions',
          lines,
        });
        out.push({ id, supplierId: g.supplierId, currency: g.currency, subtotal, lines: lines.length });
      }
      return out;
    });
    for (const po of created) {
      await this.auditLogService.logCtx(ctx, {
        action: 'purchase_order.created',
        entityType: 'purchaseorder',
        entityId: po.id,
        after: {
          supplierId: po.supplierId,
          outletId,
          currency: po.currency,
          subtotal: po.subtotal,
          source: 'reorder_suggestion',
        },
      });
    }
    return { created };
  }

  // ---- internals ----

  private poolExec(): Exec {
    return (sql, params) => this.db.query<RowDataPacket[]>(sql, params as never[]);
  }

  private async assertOutletInShop(shopId: number, outletId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [outletId, shopId],
    );
    if (rows.length === 0) throw new BadRequestException('outletId is invalid for this shop');
  }

  // A branch user is pinned to their outlet; a resolved outlet needs the view
  // permission (an unresolved one, the admin's all-outlets read, skips it).
  private async readableOutlet(ctx: TenantContext, requested?: number) {
    const outletId = resolveOutletFilter(ctx, requested);
    if (outletId !== undefined) {
      await this.assertOutletInShop(ctx.shopId, outletId);
      await this.branchRolesService.assertPermission(ctx, outletId, 'purchase_orders.view');
    }
    return outletId;
  }

  // Rows with a reorder point whose stock is at or below it. With
  // `positionOnly`, only those whose position (stock + on order) is still at or
  // below the point (the ones that need ordering).
  private async loadCandidates(
    exec: Exec,
    shopId: number,
    outletId: number | undefined,
    positionOnly: boolean,
  ): Promise<Candidate[]> {
    const params: unknown[] = [shopId, shopId, shopId];
    let outletClause = '';
    if (outletId !== undefined) {
      outletClause = 'AND ois.outletId = ?';
      params.push(outletId);
    }
    const rows = await exec(
      `SELECT ois.outletId, o.name AS outletName, ois.ingredientId, ing.name, ing.unit,
              COALESCE(ing.shadowProductId, pv.productId) AS productId, ing.shadowVariantId AS variantId,
              ois.stockQuantity AS stock, ois.reorderPoint, ois.reorderQuantity,
              (SELECT COALESCE(SUM(l.quantityOrdered - l.quantityReceived), 0)
                 FROM purchaseorderline l
                 JOIN purchaseorder po ON po.id = l.poId AND po.shopId = l.shopId
                WHERE l.shopId = ? AND po.outletId = ois.outletId
                  AND l.ingredientId = ois.ingredientId
                  AND po.status IN (${ON_ORDER_STATUSES})) AS onOrder
       FROM outletingredientstock ois
       JOIN ingredient ing ON ing.id = ois.ingredientId AND ing.shopId = ?
       JOIN outlet o ON o.id = ois.outletId AND o.shopId = ?
       LEFT JOIN productvariant pv ON pv.id = ing.shadowVariantId
       WHERE ois.reorderPoint IS NOT NULL AND ois.stockQuantity <= ois.reorderPoint
         AND ing.trackInventory = 1 ${outletClause}
       ORDER BY ois.outletId, ing.name, ois.ingredientId`,
      params,
    );
    const all = rows.map((r) => ({
      outletId: r.outletId as number,
      outletName: r.outletName as string,
      ingredientId: r.ingredientId as number,
      name: r.name as string,
      unit: r.unit as string,
      productId: (r.productId as number | null) ?? null,
      variantId: (r.variantId as number | null) ?? null,
      stock: r.stock as number,
      onOrder: Math.max(0, Number(r.onOrder)),
      reorderPoint: r.reorderPoint as number,
      reorderQuantity: (r.reorderQuantity as number | null) ?? null,
    }));
    return positionOnly ? all.filter((c) => positionOf(c) <= c.reorderPoint) : all;
  }

  private async computeSuggestions(exec: Exec, shopId: number, outletId: number | undefined) {
    const candidates = await this.loadCandidates(exec, shopId, outletId, true);
    const ingredientIds = [...new Set(candidates.map((c) => c.ingredientId))];
    const items = ingredientIds.length
      ? await exec(
          `SELECT si.ingredientId, si.supplierId, si.supplierSku, si.unitCost, si.currency,
                  si.minOrderQty, si.leadTimeDays, s.name AS supplierName,
                  s.currency AS supplierCurrency, s.minimumOrderAmount
           FROM supplieritem si
           JOIN supplier s ON s.id = si.supplierId AND s.shopId = ? AND s.status = 'active'
           WHERE si.shopId = ? AND si.ingredientId IN (${ingredientIds.map(() => '?').join(', ')})`,
          [shopId, shopId, ...ingredientIds],
        )
      : [];
    type Item = SupplierOption & { supplierName: string; supplierSku: string | null; supplierCurrency: string | null; minimumOrderAmount: number | null };
    const itemsByIngredient = new Map<number, { priced: Item[]; unpriced: number }>();
    for (const r of items) {
      const slot = itemsByIngredient.get(r.ingredientId as number) ?? { priced: [], unpriced: 0 };
      // Priced = a cost AND its own currency. A cost with no currency is unknown,
      // never read as the supplier's or the shop's.
      if (r.unitCost !== null && r.currency !== null) {
        slot.priced.push({
          supplierId: r.supplierId as number,
          unitCost: Number(r.unitCost),
          currency: r.currency as string,
          minOrderQty: (r.minOrderQty as number | null) ?? null,
          leadTimeDays: (r.leadTimeDays as number | null) ?? null,
          supplierName: r.supplierName as string,
          supplierSku: (r.supplierSku as string | null) ?? null,
          supplierCurrency: (r.supplierCurrency as string | null) ?? null,
          minimumOrderAmount: r.minimumOrderAmount === null ? null : Number(r.minimumOrderAmount),
        });
      } else {
        slot.unpriced += 1;
      }
      itemsByIngredient.set(r.ingredientId as number, slot);
    }

    const entries: SuggestedLine[] = [];
    const noSupplier: {
      outletId: number;
      ingredientId: number;
      name: string;
      reason: 'no_supplier' | 'unpriced_supplier_item' | SkipReason;
    }[] = [];
    for (const c of candidates) {
      const base = baseOrderQuantity(c);
      if ('skip' in base) {
        // covered cannot occur here (positionOnly); the others are listed so the
        // merchant sees why an item at its point produced no suggestion.
        if (base.skip === 'no_reorder_quantity') {
          noSupplier.push({ outletId: c.outletId, ingredientId: c.ingredientId, name: c.name, reason: base.skip });
        }
        continue;
      }
      const slot = itemsByIngredient.get(c.ingredientId);
      const pick = slot ? pickSupplier(slot.priced) : null;
      if (!pick || !slot) {
        noSupplier.push({
          outletId: c.outletId,
          ingredientId: c.ingredientId,
          name: c.name,
          reason: slot && slot.unpriced > 0 ? 'unpriced_supplier_item' : 'no_supplier',
        });
        continue;
      }
      const chosen = slot.priced.find((o) => o.supplierId === pick.chosen.supplierId && o.currency === pick.chosen.currency) as Item;
      const quantity = applyMinOrderQty(base.quantity, chosen.minOrderQty);
      entries.push({
        outletId: c.outletId,
        supplierId: chosen.supplierId,
        ingredientId: c.ingredientId,
        productId: c.productId,
        variantId: c.variantId,
        name: c.name,
        unit: c.unit,
        quantity,
        unitCost: chosen.unitCost,
        currency: chosen.currency,
        lineTotal: lineAmount(quantity, chosen.unitCost, chosen.currency),
        supplierSku: chosen.supplierSku,
        priceComparable: pick.priceComparable,
        alternatives: pick.alternatives,
        stock: c.stock,
        onOrder: c.onOrder,
        reorderPoint: c.reorderPoint,
      });
    }

    const supplierMeta = new Map<number, Item>();
    for (const slot of itemsByIngredient.values()) {
      for (const o of slot.priced) supplierMeta.set(o.supplierId, o);
    }
    const groups = groupByPurchaseOrder(entries).map((g) => {
      const meta = supplierMeta.get(g.supplierId);
      return {
        ...g,
        supplierName: meta?.supplierName ?? '',
        // Informational only: the supplier's minimum order value, compared only when
        // it is stated in the same currency as this group.
        belowMinimumOrderAmount:
          meta?.minimumOrderAmount != null &&
          meta.supplierCurrency === g.currency &&
          g.subtotal < meta.minimumOrderAmount,
      };
    });
    return { groups, noSupplier };
  }
}
