import { BadRequestException, Injectable } from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { trimDecimal } from '../database/decimal.util';
import type { OrderreturnRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { OrdersService } from '../orders/orders.service';
import { PaymentProviderRegistry } from '../payments/payment-provider.registry';
import { PaymentSettingsService } from '../payments/payment-settings.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { createLogger } from '../common/logging/logger';

const logger = createLogger('ReturnsService');
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { ProductsService } from '../products/products.service';
import { CreateReturnDto } from './dto/create-return.dto';

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
    if (order.status !== 'delivered') {
      throw new BadRequestException('Only a delivered order can be returned');
    }

    const itemIds = dto.items.map((i) => i.orderItemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException(
        'orderItemId must not repeat within a single return',
      );
    }
    const orderItems = order.orderitem.filter((oi: { id: number }) =>
      itemIds.includes(oi.id),
    );
    if (orderItems.length !== itemIds.length) {
      throw new BadRequestException(
        'One or more orderItemId are invalid for this order',
      );
    }

    // Per-line-item cap: can't return more units than (original - already returned).
    const alreadyReturnedRows = await this.db.query<RowDataPacket[]>(
      `SELECT orderItemId, SUM(quantity) AS qty FROM orderreturnitem
       WHERE orderItemId IN (${itemIds.map(() => '?').join(', ')})
       GROUP BY orderItemId`,
      itemIds,
    );
    const alreadyReturnedByItem = new Map(
      alreadyReturnedRows.map((r) => [r.orderItemId as number, Number(r.qty)]),
    );

    let computedRefund = 0;
    for (const line of dto.items) {
      const orderItem = orderItems.find(
        (oi: { id: number }) => oi.id === line.orderItemId,
      )!;
      const alreadyReturnedQty =
        alreadyReturnedByItem.get(line.orderItemId) ?? 0;
      if (line.quantity + alreadyReturnedQty > orderItem.quantity) {
        throw new BadRequestException(
          `Cannot return ${line.quantity} of order item ${line.orderItemId} — only ${orderItem.quantity - alreadyReturnedQty} remaining unreturned`,
        );
      }
      computedRefund += Number(orderItem.priceAtPurchase) * line.quantity;
    }

    const refundAmount = Number(dto.refundAmount ?? computedRefund);

    // Running-total cap: cumulative refunds across every return on this
    // order must never exceed the order's original total.
    const priorReturnsRows = await this.db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(refundAmount), 0) AS total FROM orderreturn WHERE orderId = ?`,
      [orderId],
    );
    const alreadyRefunded = Number(priorReturnsRows[0].total);
    if (alreadyRefunded + refundAmount > Number(order.total)) {
      throw new BadRequestException(
        `Refund amount would exceed the order total — ${alreadyRefunded} already refunded of ${order.total}`,
      );
    }

    // Split this return's refund proportionally to how the order was
    // originally paid: order.giftCardAmount / order.total is the fraction
    // that came off a gift card, applied to THIS return's refundAmount (not
    // the order total) so a full return correctly reverses both portions
    // and a partial return splits fairly. Summed across every return on an
    // order, this can never exceed the original giftCardAmount, since total
    // refunds across all returns are already capped at order.total above.
    const giftCardRefundAmount =
      order.giftCardId && order.giftCardAmount && Number(order.giftCardAmount) > 0
        ? (refundAmount * Number(order.giftCardAmount)) / Number(order.total)
        : 0;
    const providerRefundPortion = refundAmount - giftCardRefundAmount;

    // Only ever asked to refund the non-gift-card slice — a return that's
    // fully covered by gift-card credit never touches the payment provider
    // at all (providerRefundPortion is 0, attemptProviderRefund short-
    // circuits to 'manual' with no reference, since there's nothing to
    // charge/refund through a gateway for zero amount).
    const { refundMethod, providerRefundReference } =
      await this.attemptProviderRefund(
        order.id,
        order.shopId,
        providerRefundPortion,
      );

    const restock = dto.restock ?? true;
    const productIds = [...new Set(orderItems.map((oi: { productId: number }) => oi.productId))];
    let trackInventoryByProduct = new Map<number, boolean>();
    if (restock && productIds.length > 0) {
      const productRows = await this.db.query<RowDataPacket[]>(
        `SELECT id, trackInventory FROM product WHERE id IN (${productIds.map(() => '?').join(', ')})`,
        productIds,
      );
      trackInventoryByProduct = new Map(
        productRows.map((p) => [p.id as number, Boolean(p.trackInventory)]),
      );
    }

    const returnId = await this.db.transaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO orderreturn (orderId, reason, refundAmount, refundMethod, providerRefundReference, giftCardRefundAmount, restocked, staffUserId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          dto.reason,
          refundAmount,
          refundMethod,
          providerRefundReference,
          giftCardRefundAmount,
          restock,
          ctx.userId,
        ],
      );
      const newReturnId = (result as { insertId: number }).insertId;

      if (order.giftCardId && giftCardRefundAmount > 0) {
        await this.giftCardsService.creditRefund(
          conn,
          order.giftCardId,
          giftCardRefundAmount,
        );
      }

      for (const line of dto.items) {
        const orderItem = orderItems.find(
          (oi: { id: number }) => oi.id === line.orderItemId,
        )!;
        await conn.query(
          `INSERT INTO orderreturnitem (orderReturnId, orderItemId, quantity) VALUES (?, ?, ?)`,
          [newReturnId, line.orderItemId, line.quantity],
        );

        if (restock && trackInventoryByProduct.get(orderItem.productId)) {
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
                productId: orderItem.productId,
                variantId: orderItem.variantId,
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

      return newReturnId;
    });

    const cumulativeRefunded = alreadyRefunded + refundAmount;
    if (cumulativeRefunded >= Number(order.total)) {
      await this.db.execute(`UPDATE \`order\` SET paymentStatus = 'refunded' WHERE id = ?`, [
        order.id,
      ]);
    }

    await this.auditLogService.logCtx(ctx, {
      action: 'order.return.created',
      entityType: 'orderreturn',
      entityId: returnId,
      after: {
        orderId,
        reason: dto.reason,
        refundAmount: String(refundAmount),
        refundMethod,
        restocked: restock,
      },
    });

    const returns = await this.loadReturnsWithRelations([returnId]);
    return this.toResponse(returns.get(returnId)!);
  }

  // Tries the order's most recent successful paid transaction's provider
  // refund capability; falls back to a manual (record-only) refund whenever
  // that's absent, the transaction has no chargeReference, or the API call
  // itself throws — always returns a definite outcome, never propagates the
  // provider error to the caller (see PaymentProvider.refundPayment's own
  // comment on why this is optional).
  private async attemptProviderRefund(
    orderId: number,
    shopId: number,
    amount: number,
  ): Promise<{
    refundMethod: 'provider' | 'manual';
    providerRefundReference: string | null;
  }> {
    // A refund fully (or, for this call, entirely-for-its-portion) covered
    // by gift-card credit has nothing left for a provider to refund —
    // never call out to a gateway for zero amount.
    if (amount <= 0) {
      return { refundMethod: 'manual', providerRefundReference: null };
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM paymenttransaction
       WHERE orderId = ? AND status = 'paid' AND providerChargeReference IS NOT NULL
       ORDER BY createdAt DESC LIMIT 1`,
      [orderId],
    );
    const paidTransaction = rows[0];
    if (!paidTransaction?.providerChargeReference) {
      return { refundMethod: 'manual', providerRefundReference: null };
    }

    try {
      const provider = this.providerRegistry.get(paidTransaction.gateway as string);
      if (!provider.refundPayment) {
        return { refundMethod: 'manual', providerRefundReference: null };
      }
      const credentials = await this.paymentSettingsService.resolveCredentials(
        shopId,
        paidTransaction.gateway as string,
      );
      const result = await provider.refundPayment({
        chargeReference: paidTransaction.providerChargeReference as string,
        amount,
        credentials,
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
    };
  }
}
