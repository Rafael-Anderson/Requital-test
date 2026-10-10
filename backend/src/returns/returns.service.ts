import { BadRequestException, Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { trimDecimal } from '../database/decimal.util';
import type { OrderreturnRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { OrdersService } from '../orders/orders.service';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import type { PaymentProvider } from '../payments/payment-provider.interface';
import { PaymentProviderRegistry } from '../payments/payment-provider.registry';
import { PaymentSettingsService } from '../payments/payment-settings.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { markInvoicesSuperseded } from '../invoices/invoice-superseded';
import { createLogger } from '../common/logging/logger';
import { minorUnitFactor, roundMoney } from '../common/currency-minor-units';

const logger = createLogger('ReturnsService');
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { StoreCreditService } from '../store-credit/store-credit.service';
import { ProductsService } from '../products/products.service';
import { defaultReturnRefundMinor } from './return-refund';
import { CreateReturnDto } from './dto/create-return.dto';

interface RefundTarget {
  provider: PaymentProvider;
  credentials: Record<string, string> | null;
  chargeReference: string;
  currency: string;
}

interface AssembledOrderReturn extends OrderreturnRow {
  orderreturnitem: { id: number; orderItemId: number; quantity: number }[];
  staff: { id: number; name: string };
}

@Injectable()
export class ReturnsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly ordersService: OrdersService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly paymentSettingsService: PaymentSettingsService,
    private readonly auditLogService: AuditLogService,
    private readonly giftCardsService: GiftCardsService,
    private readonly productsService: ProductsService,
    private readonly branchRolesService: BranchRolesService,
    private readonly storeCreditService: StoreCreditService,
  ) {}

  async findAllForOrder(ctx: TenantContext, orderId: number) {
    await this.ordersService.findOne(ctx, orderId); // tenant/outlet scope check
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM orderreturn WHERE orderId = ? ORDER BY createdAt DESC`,
      [orderId],
    );
    const ids = rows.map((r) => r.id as number);
    const returns = await this.loadReturnsWithRelations(ids);
    return ids.map((id) => this.toResponse(returns.get(id)!));
  }

  async create(ctx: TenantContext, orderId: number, dto: CreateReturnDto) {
    const order = await this.ordersService.findOne(ctx, orderId);
    // A return records a refund, restocks and may credit a gift card: it is a
    // manage action, not a view. findOne only asserts orders.view.
    await this.branchRolesService.assertPermission(
      ctx,
      order.outletId,
      'orders.manage',
    );
    if (order.status !== 'delivered') {
      throw new BadRequestException('Only a delivered order can be returned');
    }
    // `order` above is the tenant/outlet scope check only. Everything money- or
    // quantity-related is re-read below under the order row lock: this snapshot
    // can be stale by the time a concurrent return commits.

    const itemIds = dto.items.map((i) => i.orderItemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException(
        'orderItemId must not repeat within a single return',
      );
    }
    const restock = dto.restock ?? true;
    const factor = minorUnitFactor(order.currency);

    // Everything the provider refund needs from the pool is read HERE, before
    // the transaction. The transaction below holds one pool connection for the
    // order row lock, so nothing inside it may ask the pool for another: with
    // DB_POOL_SIZE concurrent returns each holding one connection and waiting
    // for a second, the whole API would hang. Inside the lock only `conn` and
    // the provider's own HTTP call are used. These reads are per-order stable
    // (the paid charge, the shop's credentials).
    const refundTarget = await this.loadRefundTarget(order.id, order.shopId);

    // One transaction from the order row lock to the last write. The caps (units
    // per line, cumulative refund, gift-card share) are read AFTER the lock, and
    // the provider is only called once they have passed, so two concurrent
    // returns serialise here instead of both passing a stale cap. Every query
    // below is for this (already tenant-checked) order.
    const result = await this.db.transaction(async (conn) => {
      const [lockRows] = await conn.query<RowDataPacket[]>(
        `SELECT status, total, deliveryFee, discountAmount, taxAmount, giftCardId, giftCardAmount, storeCreditAmount, customerId, consumptionRecordedAt
           FROM \`order\` WHERE id = ? AND shopId = ? FOR UPDATE`,
        [orderId, order.shopId],
      );
      const locked = lockRows[0];
      if (!locked || locked.status !== 'delivered') {
        throw new BadRequestException('Only a delivered order can be returned');
      }
      const hasStockRecord = locked.consumptionRecordedAt != null;

      const [lineRows] = await conn.query<RowDataPacket[]>(
        `SELECT oi.id, oi.productId, oi.variantId, oi.quantity, oi.priceAtPurchase, oi.taxRate, oi.taxAmount,
                COALESCE((SELECT SUM(ri.quantity) FROM orderreturnitem ri WHERE ri.orderItemId = oi.id), 0) AS returned
           FROM orderitem oi WHERE oi.orderId = ?`,
        [orderId],
      );
      const lineById = new Map(lineRows.map((l) => [l.id as number, l]));
      if (itemIds.some((id) => !lineById.has(id))) {
        throw new BadRequestException(
          'One or more orderItemId are invalid for this order',
        );
      }

      // Per-line-item cap: can't return more units than (original - already returned).
      for (const line of dto.items) {
        const orderItem = lineById.get(line.orderItemId)!;
        const remaining =
          (orderItem.quantity as number) - Number(orderItem.returned);
        if (line.quantity > remaining) {
          throw new BadRequestException(
            `Cannot return ${line.quantity} of order item ${line.orderItemId} — only ${remaining} remaining unreturned`,
          );
        }
      }

      const [priorRows] = await conn.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(refundAmount), 0) AS total, COALESCE(SUM(giftCardRefundAmount), 0) AS gift, COALESCE(SUM(storeCreditRefundAmount), 0) AS store FROM orderreturn WHERE orderId = ?`,
        [orderId],
      );
      const alreadyRefunded = Number(priorRows[0].total);
      const alreadyMinor = Math.round(alreadyRefunded * factor);
      const totalMinor = Math.round(Number(locked.total) * factor);

      let refundMinor: number;
      if (dto.refundAmount != null) {
        // Staff typed it: still rounded to the currency and capped below.
        refundMinor = Math.round(
          roundMoney(dto.refundAmount, order.currency) * factor,
        );
      } else {
        const paidShare = defaultReturnRefundMinor({
          order: {
            total: locked.total as string,
            deliveryFee: locked.deliveryFee as string | null,
            discountAmount: locked.discountAmount as string | null,
            taxAmount: locked.taxAmount as string | null,
            currency: order.currency,
          },
          orderLines: lineRows.map((l) => ({
            id: l.id as number,
            quantity: l.quantity as number,
            priceAtPurchase: l.priceAtPurchase as string,
            taxRate: l.taxRate as string | null,
            taxAmount: l.taxAmount as string | null,
          })),
          priorReturned: new Map(
            lineRows.map((l) => [l.id as number, Number(l.returned)]),
          ),
          returning: dto.items,
        });
        if (paidShare === null) {
          // LEGACY order: no captured tax (NULL = unknown), so the paid share
          // cannot be derived. Keep the old default, priceAtPurchase x qty.
          refundMinor = Math.round(
            roundMoney(
              dto.items.reduce(
                (s, i) =>
                  s +
                  Number(lineById.get(i.orderItemId)!.priceAtPurchase) *
                    i.quantity,
                0,
              ),
              order.currency,
            ) * factor,
          );
        } else {
          // The delivery fee is not refunded by default, so goods can never
          // take more than total - delivery; this also absorbs a one minor unit
          // rounding gap between the per-line figures and the stored total.
          const ceiling =
            totalMinor - Math.round(Number(locked.deliveryFee ?? 0) * factor);
          refundMinor = Math.min(
            paidShare,
            Math.max(0, ceiling - alreadyMinor),
          );
        }
      }
      const refundAmount = refundMinor / factor;

      // Running-total cap: cumulative refunds across every return on this
      // order must never exceed the order's original total.
      if (alreadyMinor + refundMinor > totalMinor) {
        throw new BadRequestException(
          `Refund amount would exceed the order total — ${alreadyRefunded} already refunded of ${locked.total}`,
        );
      }

      // Split this return's refund proportionally to how the order was
      // originally paid: giftCardAmount / total is the fraction that came off a
      // gift card, applied to THIS return's refundAmount (not the order total)
      // so a full return reverses both portions and a partial return splits
      // fairly.
      //
      // Split in integer minor units so the two parts sum EXACTLY to
      // refundAmount (F6): the gift-card share is rounded once, the provider
      // share is the remainder. Across returns the gift share is capped at what
      // is still unreturned of giftCardAmount, and the return that completes
      // the refund returns all of it, so rounding can neither create nor lose a
      // minor unit on the card.
      const giftTotalMinor = Math.round(
        Number(locked.giftCardAmount ?? 0) * factor,
      );
      let giftMinor = 0;
      if (locked.giftCardId && giftTotalMinor > 0) {
        const giftLeftMinor =
          giftTotalMinor - Math.round(Number(priorRows[0].gift) * factor);
        const completesRefund = alreadyMinor + refundMinor >= totalMinor;
        giftMinor = Math.max(
          0,
          Math.min(
            completesRefund
              ? giftLeftMinor
              : Math.round((refundMinor * giftTotalMinor) / totalMinor),
            giftLeftMinor,
            refundMinor,
          ),
        );
      }
      const giftCardRefundAmount = giftMinor / factor;

      // The share that was paid with STORE CREDIT goes back to store credit, by
      // the same proportional rule as the gift card: rounded once, capped at what
      // is still unreturned of storeCreditAmount and at what is left of this
      // refund after the gift share, and the return that completes the refund
      // gets all that remains (so partial returns sum exactly to the whole).
      const storeTotalMinor = Math.round(
        Number(locked.storeCreditAmount ?? 0) * factor,
      );
      let storeMinor = 0;
      if (storeTotalMinor > 0) {
        const storeLeftMinor =
          storeTotalMinor - Math.round(Number(priorRows[0].store) * factor);
        const completesRefundStore = alreadyMinor + refundMinor >= totalMinor;
        storeMinor = Math.max(
          0,
          Math.min(
            completesRefundStore
              ? storeLeftMinor
              : Math.round((refundMinor * storeTotalMinor) / totalMinor),
            storeLeftMinor,
            refundMinor - giftMinor,
          ),
        );
      }
      const storeCreditRefundAmount = storeMinor / factor;
      const toStoreCredit = dto.refundTo === 'store_credit';
      const ownerCustomerId = (locked.customerId as number | null) ?? null;
      if ((toStoreCredit || storeMinor > 0) && ownerCustomerId === null) {
        throw new BadRequestException(
          'This order has no customer account to credit store credit to',
        );
      }
      const providerPortionMinor = refundMinor - giftMinor - storeMinor;
      const providerRefundPortion = providerPortionMinor / factor;
      // Refunded to store credit instead of the original payment: the provider
      // is not called at all.
      const creditMinor = storeMinor + (toStoreCredit ? providerPortionMinor : 0);

      // Only ever asked to refund the non-gift-card slice — a return that's
      // fully covered by gift-card credit never touches the payment provider
      // at all (providerRefundPortion is 0, attemptProviderRefund short-
      // circuits to 'manual' with no reference, since there's nothing to
      // charge/refund through a gateway for zero amount). Called with the order
      // row lock held and every cap already passed.
      const { refundMethod, providerRefundReference } = toStoreCredit
        ? { refundMethod: 'store_credit' as const, providerRefundReference: null }
        : await this.attemptProviderRefund(
            order.id,
            refundTarget,
            providerRefundPortion,
          );

      // An order with a stock record (consumptionRecordedAt) gets exactly what
      // it holds back, not today's recipe and not today's product flags. A LEGACY
      // order (no record) keeps the recipe-driven restock below.
      // Units of each line identity (product + variant) still with the customer
      // before this return: the denominator for "k of n units". Lines that share
      // an identity (same product, different note) pool together, since the
      // record is keyed by identity, not by line.
      const remainingByIdentity = new Map<string, number>();
      if (restock && hasStockRecord) {
        for (const l of lineRows) {
          const k = `${l.productId as number}:${(l.variantId as number | null) ?? ''}`;
          remainingByIdentity.set(
            k,
            (remainingByIdentity.get(k) ?? 0) +
              (l.quantity as number) -
              Number(l.returned),
          );
        }
      }
      let trackInventoryByProduct = new Map<number, boolean>();
      const productIds = [
        ...new Set(
          dto.items.map(
            (i) => lineById.get(i.orderItemId)!.productId as number,
          ),
        ),
      ];
      if (restock && productIds.length > 0) {
        const [productRows] = await conn.query<RowDataPacket[]>(
          `SELECT id, trackInventory FROM product WHERE id IN (${productIds.map(() => '?').join(', ')})`,
          productIds,
        );
        trackInventoryByProduct = new Map(
          productRows.map((p) => [p.id as number, Boolean(p.trackInventory)]),
        );
      }

      const [insert] = await conn.query(
        `INSERT INTO orderreturn (orderId, reason, refundAmount, refundMethod, providerRefundReference, giftCardRefundAmount, storeCreditRefundAmount, restocked, staffUserId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          dto.reason,
          refundAmount,
          refundMethod,
          providerRefundReference,
          giftCardRefundAmount,
          storeCreditRefundAmount,
          restock,
          ctx.userId,
        ],
      );
      const newReturnId = (insert as { insertId: number }).insertId;

      if (locked.giftCardId && giftCardRefundAmount > 0) {
        await this.giftCardsService.creditRefund(
          conn,
          locked.giftCardId as number,
          giftCardRefundAmount,
        );
      }

      if (creditMinor > 0 && ownerCustomerId !== null) {
        // In this transaction, so the return and the credit commit together.
        // Currency is the ORDER'S: credit returns in the currency it was spent in.
        await this.storeCreditService.creditForReturn(
          conn,
          order.shopId,
          ownerCustomerId,
          newReturnId,
          order.currency,
          creditMinor,
          `Return #${newReturnId}`,
        );
      }

      for (const line of dto.items) {
        const orderItem = lineById.get(line.orderItemId)!;
        const productId = orderItem.productId as number;
        const variantId = orderItem.variantId as number | null;
        await conn.query(
          `INSERT INTO orderreturnitem (orderReturnId, orderItemId, quantity) VALUES (?, ?, ?)`,
          [newReturnId, line.orderItemId, line.quantity],
        );

        if (restock && hasStockRecord) {
          const k = `${productId}:${variantId ?? ''}`;
          const den = remainingByIdentity.get(k) ?? 0;
          await this.productsService.releaseOrderConsumption(conn, {
            shopId: order.shopId,
            outletId: order.outletId,
            orderId,
            actorUserId: ctx.userId,
            movementType: 'RETURN',
            note: `Return #${newReturnId}`,
            reason: dto.reason,
            only: [{ productId, variantId, num: line.quantity, den }],
          });
          remainingByIdentity.set(k, den - line.quantity);
        } else if (restock && trackInventoryByProduct.get(productId)) {
          // Phase A: routes through the same CAS-disciplined mechanism
          // every other stock-mutation path now uses (shadow or real
          // recipe) — throwOnInsufficientStock: false since a return
          // restocking never fails on a floor check, matching this
          // codebase's own unconditional-upsert restock behavior
          // everywhere else. movementType: 'RETURN' (not the default
          // 'CONSUMED') keeps this distinguishable from an order
          // cancellation in Movement History, same distinction the
          // original inline stockmovement.create already drew.
          await this.productsService.consumeForOrderItems(
            conn,
            order.shopId,
            order.outletId,
            [
              {
                productId,
                variantId,
                quantity: line.quantity,
                allowNegative: true,
              },
            ],
            1,
            {
              throwOnInsufficientStock: false,
              actorUserId: ctx.userId,
              movementType: 'RETURN',
              note: `Return #${newReturnId}`,
              reason: dto.reason,
            },
          );
        }
      }

      // A refunded/returned order is no longer described by the invoice issued
      // for it (C2) - the document still records what was sold, but the order has
      // moved on. In the same transaction as the return itself.
      await markInvoicesSuperseded(conn, orderId);

      if (alreadyMinor + refundMinor >= totalMinor) {
        await conn.query(
          `UPDATE \`order\` SET paymentStatus = 'refunded' WHERE id = ?`,
          [orderId],
        );
      }

      return { returnId: newReturnId, refundAmount, refundMethod };
    });

    await this.auditLogService.logCtx(ctx, {
      action: 'order.return.created',
      entityType: 'orderreturn',
      entityId: result.returnId,
      after: {
        orderId,
        reason: dto.reason,
        refundAmount: String(result.refundAmount),
        refundMethod: result.refundMethod,
        restocked: restock,
      },
    });

    const returns = await this.loadReturnsWithRelations([result.returnId]);
    return this.toResponse(returns.get(result.returnId)!);
  }

  // Looks up the order's most recent successful paid transaction and, when its
  // provider can refund, the credentials to do it with. Pool reads only, so it
  // runs BEFORE the return transaction opens (see create()). Any failure means
  // "no provider refund possible": the caller falls back to a manual refund.
  private async loadRefundTarget(
    orderId: number,
    shopId: number,
  ): Promise<RefundTarget | null> {
    try {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT * FROM paymenttransaction
         WHERE orderId = ? AND status = 'paid' AND providerChargeReference IS NOT NULL
         ORDER BY createdAt DESC LIMIT 1`,
        [orderId],
      );
      const paidTransaction = rows[0];
      if (!paidTransaction?.providerChargeReference) return null;
      const provider = this.providerRegistry.get(
        paidTransaction.gateway as string,
      );
      if (!provider.refundPayment) return null;
      const credentials = await this.paymentSettingsService.resolveCredentials(
        shopId,
        paidTransaction.gateway as string,
      );
      return {
        provider,
        credentials,
        chargeReference: paidTransaction.providerChargeReference as string,
        // The currency the CHARGE moved, read off the same paymenttransaction
        // row the chargeReference came from — not the order's and not the
        // shop's. A refund reverses one specific past charge, so that row is
        // the only authoritative source.
        currency: paidTransaction.currency as string,
      };
    } catch (error) {
      logger.warn(
        `provider refund lookup failed for order ${orderId}, falling back to manual`,
        {
          orderId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
  }

  // Calls the provider refund for the non-gift-card slice, or falls back to a
  // manual (record-only) refund whenever there is no target, nothing to refund,
  // or the API call itself throws — always returns a definite outcome, never
  // propagates the provider error to the caller (see
  // PaymentProvider.refundPayment's own comment on why this is optional). Runs
  // under the order row lock: it must not touch the pool (HTTP only).
  private async attemptProviderRefund(
    orderId: number,
    target: RefundTarget | null,
    amount: number,
  ): Promise<{
    refundMethod: 'provider' | 'manual';
    providerRefundReference: string | null;
  }> {
    // A refund fully (or, for this call, entirely-for-its-portion) covered
    // by gift-card credit has nothing left for a provider to refund —
    // never call out to a gateway for zero amount.
    if (amount <= 0 || !target) {
      return { refundMethod: 'manual', providerRefundReference: null };
    }
    try {
      const result = await target.provider.refundPayment!({
        chargeReference: target.chargeReference,
        amount,
        currency: target.currency,
        credentials: target.credentials,
      });
      return {
        refundMethod: 'provider',
        providerRefundReference: result.providerReference,
      };
    } catch (error) {
      logger.warn(`provider refund failed for order ${orderId}, falling back to manual`, {
        orderId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { refundMethod: 'manual', providerRefundReference: null };
    }
  }

  private async loadReturnsWithRelations(
    ids: number[],
  ): Promise<Map<number, AssembledOrderReturn>> {
    const result = new Map<number, AssembledOrderReturn>();
    if (ids.length === 0) return result;
    const idList = ids.map(() => '?').join(', ');
    const [returns, items] = await Promise.all([
      this.db.query<(OrderreturnRow & RowDataPacket)[]>(
        `SELECT orr.*, u.id AS staffId, u.name AS staffName
         FROM orderreturn orr JOIN user u ON u.id = orr.staffUserId
         WHERE orr.id IN (${idList})`,
        ids,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT * FROM orderreturnitem WHERE orderReturnId IN (${idList})`,
        ids,
      ),
    ]);
    const itemsByReturn = new Map<number, { id: number; orderItemId: number; quantity: number }[]>();
    for (const item of items) {
      const list = itemsByReturn.get(item.orderReturnId as number) ?? [];
      list.push({
        id: item.id as number,
        orderItemId: item.orderItemId as number,
        quantity: item.quantity as number,
      });
      itemsByReturn.set(item.orderReturnId as number, list);
    }
    for (const r of returns) {
      result.set(r.id, {
        ...r,
        orderreturnitem: itemsByReturn.get(r.id) ?? [],
        staff: { id: r.staffId as number, name: r.staffName as string },
      });
    }
    return result;
  }

  private toResponse(orderReturn: AssembledOrderReturn) {
    return {
      ...orderReturn,
      refundAmount: trimDecimal(orderReturn.refundAmount),
      giftCardRefundAmount: trimDecimal(orderReturn.giftCardRefundAmount),
      storeCreditRefundAmount: trimDecimal(orderReturn.storeCreditRefundAmount),
    };
  }
}
