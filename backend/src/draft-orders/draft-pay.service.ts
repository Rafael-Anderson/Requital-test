import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { PublicService } from '../public/public.service';
import { PaymentsService } from '../payments/payments.service';
import { createLogger } from '../common/logging/logger';
import { PAY_TOKEN_SHAPE } from './draft-order-constants';
import { DraftOrdersService, type DraftSnapshot } from './draft-orders.service';

const logger = createLogger('DraftPayService');

export type PayState =
  'payable' | 'unavailable' | 'paid' | 'closed' | 'cancelled' | 'expired';

// The customer's /pay/<token> page for a custom order. The token is the only
// credential; it is looked up within the shop named by the URL, so another
// shop's token is the same not-found as an unknown one.
@Injectable()
export class DraftPayService {
  constructor(
    private readonly db: DatabaseService,
    private readonly publicService: PublicService,
    private readonly drafts: DraftOrdersService,
    private readonly payments: PaymentsService,
  ) {}

  private async load(shopSlug: string, token: string) {
    if (!PAY_TOKEN_SHAPE.test(token))
      throw new NotFoundException('Payment link not found');
    const shop = await this.publicService.resolveShopBySlug(shopSlug);
    const draft = await this.drafts.findByPayToken(
      shop.id,
      token.toLowerCase(),
    );
    if (!draft || !draft.snapshotJson)
      throw new NotFoundException('Payment link not found');
    return { shop, draft, snapshot: draft.snapshotJson as DraftSnapshot };
  }

  private async state(
    shopId: number,
    draft: {
      status: string;
      payLinkExpiresAt: Date | null;
      convertedOrderId: number | null;
    },
  ): Promise<{ state: PayState; order: RowDataPacket | null }> {
    let order: RowDataPacket | null = null;
    if (draft.convertedOrderId) {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id, shopOrderNumber, paymentStatus, status, trackingToken FROM \`order\` WHERE id = ? AND shopId = ?`,
        [draft.convertedOrderId, shopId],
      );
      order = rows[0] ?? null;
    }
    if (draft.status === 'CANCELLED')
      return { state: 'cancelled', order: null };
    if (draft.status === 'COMPLETED') {
      return {
        state: order?.paymentStatus === 'paid' ? 'paid' : 'closed',
        order,
      };
    }
    if (draft.status === 'OPEN') return { state: 'closed', order: null };
    if (!draft.payLinkExpiresAt || draft.payLinkExpiresAt < new Date()) {
      return { state: 'expired', order: null };
    }
    if (!(await this.drafts.cardAvailable(shopId)))
      return { state: 'unavailable', order: null };
    return { state: 'payable', order: null };
  }

  // What the pay page renders. Read-only: no order, no session.
  async summary(shopSlug: string, token: string) {
    const { shop, draft, snapshot } = await this.load(shopSlug, token);
    const { state, order } = await this.state(shop.id, draft);
    const { stockWarnings: _omit, ...bill } = snapshot.bill;
    void _omit;
    return {
      state,
      shop: {
        name: shop.displayName || shop.name,
        phone: shop.whatsappNumber
          ? `${shop.whatsappCountryCode ?? ''}${shop.whatsappNumber}`
          : null,
        email: shop.email ?? null,
      },
      bill,
      fulfilment: snapshot.fulfilment,
      expiresAt: draft.payLinkExpiresAt,
      // Only once paid: the order number and its tracking page.
      order:
        state === 'paid' && order
          ? {
              shopOrderNumber: order.shopOrderNumber as number,
              trackingToken: order.trackingToken as string,
            }
          : null,
    };
  }

  // Pay pressed: convert (or reuse the pending order) and mint a fresh gateway
  // session through the existing payment-link path. A return page is never
  // proof of payment: the order is marked paid only by the gateway's webhook or
  // the confirmation poll (the existing idempotent apply path, with its amount
  // and currency guard).
  async createSession(shopSlug: string, token: string) {
    const { shop, draft } = await this.load(shopSlug, token);
    const { state } = await this.state(shop.id, draft);
    if (state === 'paid') return { alreadyPaid: true as const };
    if (state === 'expired')
      throw new GoneException('This payment link has expired');
    if (state === 'unavailable') {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'card_unavailable',
        message:
          'Card payment is temporarily unavailable. Please contact the shop.',
      });
    }
    if (state !== 'payable')
      throw new ConflictException('This order can no longer be paid here');

    const conversion = await this.drafts.convertForPayment(shop.id, draft.id);
    try {
      const result = await this.payments.getCheckoutSession(
        conversion.orderToken,
        {
          // The storefront order confirmation page: it asks the gateway itself
          // when the webhook is late (the existing "confirming payment" flow).
          success: `/orders/${conversion.trackingToken}`,
          cancel: `/pay/${token.toLowerCase()}`,
        },
      );
      if (result.alreadyPaid) return { alreadyPaid: true as const };
      await this.drafts
        .announceAfterSession(
          shop.id,
          conversion.orderId,
          draft.createdByUserId,
        )
        .catch(() => undefined);
      return { alreadyPaid: false as const, checkoutUrl: result.checkoutUrl };
    } catch (err) {
      logger.warn('custom order payment session failed', {
        error: err instanceof Error ? err.name : 'unknown',
        shopId: shop.id,
        draftId: draft.id,
        orderId: conversion.orderId,
        created: conversion.created,
      });
      // The order this press created was never payable: cancel it (stock and
      // discount use come back) and the link works again. A reused order from an
      // earlier press keeps its earlier session.
      if (conversion.created) {
        await this.drafts
          .releaseAfterGatewayFailure(
            shop.id,
            draft.id,
            conversion.orderId,
            shop.paymentGateway,
          )
          .catch(() => undefined);
      }
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'card_unavailable',
        message:
          'Card payment is temporarily unavailable. Please try again or contact the shop.',
      });
    }
  }
}
