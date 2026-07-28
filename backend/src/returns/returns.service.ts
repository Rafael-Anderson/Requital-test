import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { OrdersService } from '../orders/orders.service';
import { PaymentProviderRegistry } from '../payments/payment-provider.registry';
import { PaymentSettingsService } from '../payments/payment-settings.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { CreateReturnDto } from './dto/create-return.dto';

const returnInclude = {
  orderreturnitem: true,
  staff: { select: { id: true, name: true } },
} satisfies Prisma.orderreturnInclude;

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly paymentSettingsService: PaymentSettingsService,
    private readonly auditLogService: AuditLogService,
    private readonly giftCardsService: GiftCardsService,
  ) {}

  async findAllForOrder(ctx: TenantContext, orderId: number) {
    await this.ordersService.findOne(ctx, orderId); // tenant/outlet scope check
    return this.prisma.orderreturn.findMany({
      where: { orderId },
      include: returnInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(ctx: TenantContext, orderId: number, dto: CreateReturnDto) {
    const order = await this.ordersService.findOne(ctx, orderId);
    if (order.status !== 'delivered') {
      throw new BadRequestException('Only a delivered order can be returned');
    }

    const itemIds = dto.items.map((i) => i.orderItemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException('orderItemId must not repeat within a single return');
    }
    const orderItems = order.orderitem.filter((oi) => itemIds.includes(oi.id));
    if (orderItems.length !== itemIds.length) {
      throw new BadRequestException('One or more orderItemId are invalid for this order');
    }

    // Per-line-item cap: can't return more units than (original - already returned).
    const alreadyReturned = await this.prisma.orderreturnitem.groupBy({
      by: ['orderItemId'],
      where: { orderItemId: { in: itemIds } },
      _sum: { quantity: true },
    });
    const alreadyReturnedByItem = new Map(alreadyReturned.map((r) => [r.orderItemId, r._sum.quantity ?? 0]));

    let computedRefund = new Prisma.Decimal(0);
    for (const line of dto.items) {
      const orderItem = orderItems.find((oi) => oi.id === line.orderItemId)!;
      const alreadyReturnedQty = alreadyReturnedByItem.get(line.orderItemId) ?? 0;
      if (line.quantity + alreadyReturnedQty > orderItem.quantity) {
        throw new BadRequestException(
          `Cannot return ${line.quantity} of order item ${line.orderItemId} — only ${orderItem.quantity - alreadyReturnedQty} remaining unreturned`,
        );
      }
      computedRefund = computedRefund.add(orderItem.priceAtPurchase.mul(line.quantity));
    }

    const refundAmount = new Prisma.Decimal(dto.refundAmount ?? computedRefund);

    // Running-total cap: cumulative refunds across every return on this
    // order must never exceed the order's original total.
    const priorReturns = await this.prisma.orderreturn.aggregate({
      where: { orderId },
      _sum: { refundAmount: true },
    });
    const alreadyRefunded = priorReturns._sum.refundAmount ?? new Prisma.Decimal(0);
    if (alreadyRefunded.add(refundAmount).greaterThan(order.total)) {
      throw new BadRequestException(
        `Refund amount would exceed the order total — ${alreadyRefunded.toString()} already refunded of ${order.total.toString()}`,
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
      order.giftCardId && order.giftCardAmount && order.giftCardAmount.greaterThan(0)
        ? refundAmount.mul(order.giftCardAmount).div(order.total)
        : new Prisma.Decimal(0);
    const providerRefundPortion = refundAmount.sub(giftCardRefundAmount);

    // Only ever asked to refund the non-gift-card slice — a return that's
    // fully covered by gift-card credit never touches the payment provider
    // at all (providerRefundPortion is 0, attemptProviderRefund short-
    // circuits to 'manual' with no reference, since there's nothing to
    // charge/refund through a gateway for zero amount).
    const { refundMethod, providerRefundReference } = await this.attemptProviderRefund(
      order.id,
      order.shopId,
      providerRefundPortion,
    );

    const restock = dto.restock ?? true;
    const productIds = [...new Set(orderItems.map((oi) => oi.productId))];
    const products = restock
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, trackInventory: true },
        })
      : [];
    const trackInventoryByProduct = new Map(products.map((p) => [p.id, p.trackInventory]));

    const created = await this.prisma.$transaction(async (tx) => {
      const orderReturn = await tx.orderreturn.create({
        data: {
          orderId,
          reason: dto.reason,
          refundAmount,
          refundMethod,
          providerRefundReference,
          giftCardRefundAmount,
          restocked: restock,
          staffUserId: ctx.userId,
        },
      });

      if (order.giftCardId && giftCardRefundAmount.greaterThan(0)) {
        await this.giftCardsService.creditRefund(tx, order.giftCardId, Number(giftCardRefundAmount));
      }

      for (const line of dto.items) {
        const orderItem = orderItems.find((oi) => oi.id === line.orderItemId)!;
        await tx.orderreturnitem.create({
          data: { orderReturnId: orderReturn.id, orderItemId: line.orderItemId, quantity: line.quantity },
        });

        if (restock && trackInventoryByProduct.get(orderItem.productId)) {
          if (orderItem.variantId) {
            await tx.outletvariantstock.upsert({
              where: { outletId_variantId: { outletId: order.outletId, variantId: orderItem.variantId } },
              update: { stockQuantity: { increment: line.quantity } },
              create: { outletId: order.outletId, variantId: orderItem.variantId, stockQuantity: line.quantity },
            });
          } else {
            await tx.outletstock.upsert({
              where: { outletId_productId: { outletId: order.outletId, productId: orderItem.productId } },
              update: { stockQuantity: { increment: line.quantity } },
              create: { outletId: order.outletId, productId: orderItem.productId, stockQuantity: line.quantity },
            });
          }
          await tx.stockmovement.create({
            data: {
              shopId: order.shopId,
              productId: orderItem.productId,
              variantId: orderItem.variantId,
              type: 'RETURN',
              reason: dto.reason,
              delta: line.quantity,
              outletId: order.outletId,
              note: `Return #${orderReturn.id}`,
              actorUserId: ctx.userId,
            },
          });
        }
      }

      return orderReturn;
    });

    const cumulativeRefunded = alreadyRefunded.add(refundAmount);
    if (cumulativeRefunded.greaterThanOrEqualTo(order.total)) {
      await this.prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'refunded' } });
    }

    await this.auditLogService.logCtx(ctx, {
      action: 'order.return.created',
      entityType: 'orderreturn',
      entityId: created.id,
      after: { orderId, reason: dto.reason, refundAmount: refundAmount.toString(), refundMethod, restocked: restock },
    });

    return this.prisma.orderreturn.findUnique({ where: { id: created.id }, include: returnInclude });
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
    amount: Prisma.Decimal,
  ): Promise<{ refundMethod: 'provider' | 'manual'; providerRefundReference: string | null }> {
    // A refund fully (or, for this call, entirely-for-its-portion) covered
    // by gift-card credit has nothing left for a provider to refund —
    // never call out to a gateway for zero amount.
    if (amount.lessThanOrEqualTo(0)) {
      return { refundMethod: 'manual', providerRefundReference: null };
    }
    const paidTransaction = await this.prisma.paymenttransaction.findFirst({
      where: { orderId, status: 'paid', providerChargeReference: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!paidTransaction?.providerChargeReference) {
      return { refundMethod: 'manual', providerRefundReference: null };
    }

    try {
      const provider = this.providerRegistry.get(paidTransaction.gateway);
      if (!provider.refundPayment) {
        return { refundMethod: 'manual', providerRefundReference: null };
      }
      const credentials = await this.paymentSettingsService.resolveCredentials(shopId, paidTransaction.gateway);
      const result = await provider.refundPayment({
        chargeReference: paidTransaction.providerChargeReference,
        amount: Number(amount),
        credentials,
      });
      return { refundMethod: 'provider', providerRefundReference: result.providerReference };
    } catch (error) {
      console.warn(`[returns] provider refund failed for order ${orderId}, falling back to manual:`, error);
      return { refundMethod: 'manual', providerRefundReference: null };
    }
  }
}
