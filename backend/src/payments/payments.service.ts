import { isMarketplaceChannel } from '../channels/marketplace-channels';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError, isLockConflict } from '../database/mysql-errors';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentSettingsService } from './payment-settings.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { OrdersService } from '../orders/orders.service';
import { OrderNotificationsService } from '../orders/order-notifications.service';
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { resolveErrorTrackingProvider } from '../common/error-tracking/error-tracking.provider';
import { WebhookLogService } from '../webhook-log/webhook-log.service';
import { ConversionEventsService } from '../shop-analytics/conversion-events.service';
import { createLogger } from '../common/logging/logger';
import type { WebhookResult } from './payment-provider.interface';
import { storefrontUrl, type ShopUrlFields } from '../common/storefront-url';
import { minorUnitFactor } from '../common/currency-minor-units';
import { amountDueMinor, amountDueDecimal } from '../common/amount-due';

// What a gateway may still be asked for (see common/amount-due.ts), as a
// number of major units for the provider interface.
export function amountStillDue(order: Record<string, unknown>): number {
  return (
    amountDueMinor(order) /
    minorUnitFactor(order.currency as string | null | undefined)
  );
}

const logger = createLogger('PaymentsService');

const LINK_EXPIRY_DAYS = 3;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly paymentSettingsService: PaymentSettingsService,
    private readonly affiliateService: AffiliateService,
    private readonly branchRolesService: BranchRolesService,
    private readonly ordersService: OrdersService,
    private readonly webhookLogService: WebhookLogService,
    private readonly conversionEventsService: ConversionEventsService,
    private readonly orderNotificationsService: OrderNotificationsService,
    private readonly giftCardsService: GiftCardsService,
  ) {}

  async generateLink(ctx: TenantContext, orderId: number) {
    const outletId = resolveOutletFilter(ctx);
    const conditions = ['id = ?', 'shopId = ?'];
    const params: (string | number)[] = [orderId, ctx.shopId];
    if (outletId !== undefined) {
      conditions.push('outletId = ?');
      params.push(outletId);
    }
    const rows = await this.db.query<RowDataPacket[]>(
      // The shop is joined purely to build the link from its own public host
      // (see common/storefront-url.ts); `conditions` are all on `order`, so
      // they are qualified with o. here.
      `SELECT o.*, s.subdomain AS shopSubdomain,
              s.customDomain AS shopCustomDomain,
              s.customDomainStatus AS shopCustomDomainStatus,
              s.domainType AS shopDomainType
         FROM \`order\` o JOIN shop s ON s.id = o.shopId
        WHERE ${conditions.map((c) => `o.${c}`).join(' AND ')}`,
      params,
    );
    const order = rows[0];
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    // The order's own outletId, not the pre-fetch filter variable above —
    // for an admin, `outletId` here is undefined (no filter applied to the
    // query), but the order itself always belongs to a real, single
    // outlet. A restrictive override at that specific outlet must still
    // apply to an admin generating a payment link for one of its orders.
    await this.branchRolesService.assertPermission(
      ctx,
      order.outletId as number,
      'payments.generate_link',
    );
    // The marketplace collected the money; there is nothing for us to charge.
    // Also enforced in getCheckoutSession below (the link is the capability).
    if (isMarketplaceChannel(order.channel as string | null)) {
      throw new BadRequestException(
        'This order was paid on the marketplace and cannot be charged here',
      );
    }
    if (order.paymentStatus === 'paid') {
      throw new BadRequestException('Order is already paid');
    }
    if (order.status === 'cancelled') {
      throw new BadRequestException(
        'Cannot generate a payment link for a cancelled order',
      );
    }

    const token = randomUUID();
    const expiresAt = new Date(
      Date.now() + LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.db.execute(
      `UPDATE \`order\` SET paymentLinkToken = ?, paymentLinkExpiresAt = ? WHERE id = ?`,
      [token, expiresAt, orderId],
    );

    return {
      url: storefrontUrl(shopUrlFieldsFrom(order), `/pay?token=${token}`),
      token,
      expiresAt,
    };
  }

  // What the /pay page renders. READ-ONLY, deliberately.
  //
  // getCheckoutSession below MINTS a gateway checkout session and writes
  // paymentSessionId on every call, so a page that called it just to display
  // "Order #12 - 199.00 AED" would create a live session per render and per
  // refresh. This returns the same decision (payable / already paid / expired)
  // plus enough to render, and touches nothing.
  async getPaymentLinkSummary(token: string) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT o.shopOrderNumber, o.total, o.giftCardAmount, o.storeCreditAmount, o.currency, o.paymentStatus,
              o.paymentLinkExpiresAt, s.name AS shopName, s.displayName AS shopDisplayName
         FROM \`order\` o JOIN shop s ON s.id = o.shopId
        WHERE o.paymentLinkToken = ?`,
      [token],
    );
    const order = rows[0];
    if (!order) {
      throw new NotFoundException('Payment link not found');
    }
    const expiresAt = order.paymentLinkExpiresAt as Date | null;
    return {
      shopOrderNumber: order.shopOrderNumber as number,
      // what is still payable: gift card and store credit were already taken
      total: String(amountStillDue(order)),
      currency: order.currency as string,
      shopName: (order.shopDisplayName ?? order.shopName) as string,
      alreadyPaid: order.paymentStatus === 'paid',
      // Expiry is reported rather than thrown so the page can render a proper
      // "this link expired" state instead of a bare 410.
      expired: !expiresAt || expiresAt < new Date(),
      expiresAt,
    };
  }

  // Public (token-authenticated, not shop-scoped) — the token is the
  // credential a customer holds, standing in for a merchant session.
  async getCheckoutSession(token: string) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT o.*, s.id AS shopRowId, s.paymentGateway AS shopPaymentGateway,
              s.subdomain AS shopSubdomain,
              s.customDomain AS shopCustomDomain,
              s.customDomainStatus AS shopCustomDomainStatus,
              s.domainType AS shopDomainType
       FROM \`order\` o JOIN shop s ON s.id = o.shopId
       WHERE o.paymentLinkToken = ?`,
      [token],
    );
    const order = rows[0];
    if (!order) {
      throw new NotFoundException('Payment link not found');
    }
    if (isMarketplaceChannel(order.channel as string | null)) {
      throw new NotFoundException('Payment link not found');
    }
    if (order.paymentStatus === 'paid') {
      return { alreadyPaid: true as const };
    }
    if (
      !order.paymentLinkExpiresAt ||
      (order.paymentLinkExpiresAt as Date) < new Date()
    ) {
      throw new GoneException('Payment link has expired');
    }

    const provider = this.providerRegistry.get(
      order.shopPaymentGateway as string,
    );
    const credentials = await this.paymentSettingsService.resolveCredentials(
      order.shopRowId as number,
      order.shopPaymentGateway as string,
    );
    const due = amountStillDue(order);
    if (due <= 0) {
      throw new ConflictException('Nothing is left to pay on this order');
    }
    const session = await provider.createCheckoutSession({
      orderId: order.id as number,
      orderNumber: order.shopOrderNumber as number,
      amount: due,
      // The ORDER's own currency (captured at placement), never the shop's live
      // one: a shop that changed currency since must not have this unpaid order
      // charged in the new currency at the old order's figure.
      currency: order.currency as string,
      successUrl: storefrontUrl(
        shopUrlFieldsFrom(order),
        `/pay/success?token=${token}`,
      ),
      cancelUrl: storefrontUrl(shopUrlFieldsFrom(order), `/pay?token=${token}`),
      credentials,
    });
    // Same reason as the storefront path: without this, a payment-link order
    // whose webhook is lost has nothing to reconcile against.
    //
    // This path re-mints a session on every visit, so the reconciliation state
    // belongs to the previous session and must not carry over: an expired
    // session A settles the row, and without this reset a later paid session B
    // would never be polled. Same transaction, so the new session id and the
    // "never checked" state appear together.
    await this.db.transaction(async (conn) => {
      await conn.query(
        `UPDATE \`order\` SET paymentSessionId = ?, paymentSessionGateway = ?,
                paymentSessionUrl = NULL, paymentSessionAt = NULL
          WHERE id = ?`,
        [
          session.providerReference,
          order.shopPaymentGateway as string,
          order.id,
        ],
      );
      await conn.query(
        `DELETE FROM paymentreconciliation WHERE orderId = ? AND shopId = ?`,
        [order.id, order.shopId],
      );
    });
    return { alreadyPaid: false as const, checkoutUrl: session.checkoutUrl };
  }

  // `gateway` comes from the webhook URL path (/payments/webhook/:gateway or
  // /payments/webhook/:gateway/:shopId), not from anything in the payload
  // itself — the provider registered under that name is the only one asked
  // to parse/verify this delivery.
  //
  // `shopId` (only present on the per-shop route) is what makes per-shop
  // webhook secrets possible at all: the shop is known from the URL before
  // signature verification even starts, so that shop's own stored
  // webhookSecret credential is resolved and handed to the provider to
  // verify against — never the platform-level secret in that case. Omitted
  // entirely on the legacy platform-wide route, which still verifies
  // against the provider's own platform-level fallback (Stripe's
  // STRIPE_WEBHOOK_SECRET) exactly as before.
  async handleWebhook(
    gateway: string,
    rawBody: Buffer,
    signatureHeader: string,
    shopId?: number,
  ) {
    const provider = this.providerRegistry.get(gateway);

    let webhookSecret: string | undefined;
    if (shopId !== undefined) {
      const credentials = await this.paymentSettingsService.resolveCredentials(
        shopId,
        gateway,
      );
      if (!credentials) {
        await this.webhookLogService.log(
          shopId,
          gateway,
          'unconfigured',
          'rejected',
        );
        throw new BadRequestException(
          `Shop ${shopId} has no ${gateway} credentials configured`,
        );
      }
      // PayPal's webhook verification needs 3 fields (clientId/clientSecret/
      // webhookId), not the single shared secret every HMAC-based gateway
      // here uses — bundle the whole resolved credentials object as JSON
      // rather than widening this method's signature (and every other
      // provider's parseWebhookEvent) for one gateway's different
      // verification shape. See PayPalPaymentProvider.parseWebhookEvent for
      // the corresponding decode.
      webhookSecret =
        gateway === 'paypal'
          ? JSON.stringify(credentials)
          : credentials.webhookSecret;
      if (!webhookSecret) {
        await this.webhookLogService.log(
          shopId,
          gateway,
          'unconfigured',
          'rejected',
        );
        throw new BadRequestException(
          `Shop ${shopId} has no ${gateway} webhook secret configured`,
        );
      }
    }

    const result = await provider.parseWebhookEvent(
      rawBody,
      signatureHeader,
      webhookSecret,
    );
    if (!result) {
      return { received: true };
    }

    return this.applyWebhookResult(gateway, provider.name, result, shopId);
  }

  // The single place a payment outcome is applied to an order. Extracted from
  // handleWebhook so PaymentReconciliationService can reuse it verbatim rather
  // than growing a second, parallel "mark as paid" path that would inevitably
  // drift from this one - same transaction, same unique-index idempotency guard,
  // same affiliate sync, same CAS status advancement.
  //
  // `providerName` is passed separately from `gateway` because handleWebhook
  // resolves a provider instance and reconciliation does not need one.
  async applyWebhookResult(
    gateway: string,
    providerName: string,
    result: WebhookResult,
    shopId?: number,
  ): Promise<{ received: boolean }> {
    const orderRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM \`order\` WHERE id = ?`,
      [result.orderId],
    );
    const order = orderRows[0];
    if (!order) {
      return { received: true };
    }
    // Defense in depth on top of signature verification itself (which
    // already rejects an event signed with the wrong shop's secret): even a
    // validly-signed event must actually belong to the shop whose URL it
    // arrived on, never silently applied to a different shop's order.
    if (shopId !== undefined && order.shopId !== shopId) {
      logger.warn(
        `webhook for order ${order.id as number} received on the wrong shop's webhook URL: ignoring`,
        { orderId: order.id, orderShopId: order.shopId, webhookShopId: shopId },
      );
      await this.webhookLogService.log(shopId, gateway, 'mismatch', 'rejected');
      return { received: true };
    }

    let outcome: 'applied' | 'cancelled' | 'duplicate' = 'applied';
    try {
      // The paymenttransaction insert and the order update live in one
      // transaction, guarded by a unique (gateway, gatewayReference) index —
      // not a "check if it exists, then insert" read-then-write, which two
      // concurrent deliveries of the same retried event could both pass.
      // If the insert violates the unique constraint, the whole transaction
      // (including the order update) rolls back, so a duplicate delivery
      // can't re-apply the paymentStatus change or insert a second row.
      outcome = await this.db.transaction(async (conn) => {
        // The order row is locked FIRST (the same order a cancel takes it in),
        // so the cancelled check and the paid write below cannot interleave with
        // a cancel.
        let cancelled = false;
        let duplicate = false;
        if (result.status === 'paid') {
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT status, paymentStatus FROM \`order\` WHERE id = ? AND shopId = ? FOR UPDATE`,
            [order.id, order.shopId],
          );
          cancelled = rows[0]?.status === 'cancelled';
          // A second payment: the order is already paid, and by a DIFFERENT
          // charge (the same payment reported again, say by the webhook after the
          // reconciliation sweep, carries the same charge reference and is not
          // one). Read before this event's own row is inserted.
          if (
            !cancelled &&
            rows[0]?.paymentStatus === 'paid' &&
            result.chargeReference
          ) {
            const [prior] = await conn.query<RowDataPacket[]>(
              `SELECT id FROM paymenttransaction
                WHERE orderId = ? AND status = 'paid'
                  AND providerChargeReference IS NOT NULL AND providerChargeReference <> ?
                LIMIT 1`,
              [order.id, result.chargeReference],
            );
            duplicate = prior.length > 0;
          }
        }
        await conn.query(
          `INSERT INTO paymenttransaction (orderId, gateway, gatewayReference, providerChargeReference, amount, status, currency)
           VALUES (?, ?, ?, ?, ?, ?, (SELECT currency FROM \`order\` WHERE id = ?))`,
          [
            order.id,
            providerName,
            result.providerReference,
            result.chargeReference ?? null,
            // What the gateway was asked for: the total less the gift card and
            // store credit already taken from this order (amountDueDecimal), not
            // order.total.
            amountDueDecimal(order),
            result.status,
            order.id, // the currency subselect above
          ],
        );
        // A payment for an order that is ALREADY cancelled (a staff cancel, or
        // a gateway session that outlived an auto-cancel) is recorded as the
        // transaction it is, but the order is NOT marked paid and stays
        // cancelled: its stock, discount and tenders were already given back, so
        // calling it paid would be false. The money is real, so it is raised
        // loudly below for the merchant to refund by hand (no auto-refund).
        //
        // A duplicate payment is recorded too and leaves the order exactly as it is
        // (already paid); it is raised for refund the same way.
        if (result.status === 'paid' && !cancelled && !duplicate) {
          await conn.query(
            `UPDATE \`order\` SET paymentStatus = 'paid' WHERE id = ?`,
            [order.id],
          );
        }
        return cancelled ? 'cancelled' : duplicate ? 'duplicate' : 'applied';
      });
    } catch (error) {
      // Duplicate key (errno 1062): the unique (gateway, gatewayReference)
      // index rejected a duplicate insert — the earlier delivery already
      // fully committed. Lock conflict (errno 1213/1205): observed in
      // practice when two deliveries of the same event land truly
      // concurrently, before either has committed, so neither has hit 1062
      // yet. Both outcomes mean "a concurrent/prior delivery of this exact
      // event owns this write," so both no-op the same way instead of
      // surfacing a 500 that would make the gateway retry a delivery that
      // already succeeded elsewhere.
      if (isDuplicateKeyError(error) || isLockConflict(error)) {
        // A duplicate key proves the event is already recorded. A lock conflict
        // proves nothing of the kind (our own transaction was the one rolled
        // back), so unless the row is really there the failure is rethrown and the
        // gateway retries the delivery rather than the payment being lost.
        if (!isDuplicateKeyError(error)) {
          const recorded = await this.db.query<RowDataPacket[]>(
            `SELECT id FROM paymenttransaction WHERE gateway = ? AND gatewayReference = ?`,
            [providerName, result.providerReference],
          );
          if (!recorded[0]) throw error;
        }
        await this.webhookLogService.log(
          order.shopId as number,
          gateway,
          result.status,
          'duplicate',
        );
        // At-least-once for the ad-platform conversion: if the delivery that
        // committed the payment died before queueing it, a redelivery repairs
        // that here. Idempotent (job key capi:purchase:<orderId>), so this can
        // never produce a second job.
        if (result.status === 'paid') {
          // The order's status NOW, not the one read before this delivery started:
          // a cancel may have landed since.
          const fresh = await this.db.query<RowDataPacket[]>(
            `SELECT status, paymentStatus FROM \`order\` WHERE id = ? AND shopId = ?`,
            [order.id as number, order.shopId as number],
          );
          if (fresh[0]?.status === 'cancelled') {
            // The delivery that recorded it may have died before alerting.
            await this.raiseLatePayment(order, gateway, result);
          } else {
            await this.conversionEventsService.enqueuePurchase(
              order.id as number,
              { paid: true },
            );
            await this.sendPaidGiftCardCodes(order);
            // A redelivery of a SECOND payment's event: if the delivery that
            // recorded it died before alerting, alert now (idempotent by job key).
            // Only a charge that differs from an EARLIER paid row counts, so the
            // original payment's own redelivery is never mislabelled.
            if (
              fresh[0]?.paymentStatus === 'paid' &&
              (await this.isLaterDifferentCharge(
                order.id as number,
                providerName,
                result,
              ))
            ) {
              await this.raiseDuplicatePayment(order, gateway, result);
            }
          }
        }
        return { received: true };
      }
      throw error;
    }
    await this.webhookLogService.log(
      order.shopId as number,
      gateway,
      result.status,
      'success',
    );

    if (outcome === 'cancelled') {
      await this.raiseLatePayment(order, gateway, result);
      return { received: true };
    }
    if (outcome === 'duplicate') {
      await this.raiseDuplicatePayment(order, gateway, result);
      return { received: true };
    }

    if (result.status === 'paid') {
      await this.affiliateService.syncOrderStatus(order.id as number, {
        paymentPaid: true,
      });
      // MKT-4: the online-payment conversion. This method is the single place a
      // payment outcome is applied, reached by the gateway webhooks AND by the
      // reconciliation sweep, so queueing here covers both with one call. It
      // never throws and queues nothing without recorded marketing consent.
      await this.conversionEventsService.enqueuePurchase(order.id as number, {
        paid: true,
      });
      await this.sendPaidGiftCardCodes(order);
    }

    if (result.advanceOrderStatus) {
      await this.applyAdvanceOrderStatus(
        order.id as number,
        order.shopId as number,
        result.advanceOrderStatus,
      );
    }

    return { received: true };
  }

  // Gift cards an ONLINE order sold are emailed only once it is paid (see
  // GiftCardsService.issueForOrder's deferEmail). Idempotent (one job per order)
  // and never throws: the payment is already recorded.
  private async sendPaidGiftCardCodes(order: RowDataPacket) {
    try {
      await this.giftCardsService.sendIssuedEmailForOrder(
        order.shopId as number,
        order.id as number,
      );
    } catch (err) {
      logger.error('gift card code email after payment failed', {
        orderId: order.id as number,
        shopId: order.shopId as number,
        error: err instanceof Error ? err.name : 'non-error',
      });
    }
  }

  // Is this (already recorded) event a payment whose charge differs from a paid
  // transaction recorded BEFORE it for the same order? False when its own row is
  // not found or it carries no charge reference.
  private async isLaterDifferentCharge(
    orderId: number,
    providerName: string,
    result: WebhookResult,
  ): Promise<boolean> {
    if (!result.chargeReference) return false;
    const mine = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM paymenttransaction WHERE gateway = ? AND gatewayReference = ?`,
      [providerName, result.providerReference],
    );
    if (!mine[0]) return false;
    const earlier = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM paymenttransaction
        WHERE orderId = ? AND status = 'paid' AND id < ?
          AND providerChargeReference IS NOT NULL AND providerChargeReference <> ?
        LIMIT 1`,
      [orderId, mine[0].id as number, result.chargeReference],
    );
    return earlier.length > 0;
  }

  // A second, different payment arrived for an order that is already paid (two
  // sessions were open and the shopper paid both). Recorded, the order untouched,
  // and raised for a manual refund exactly like a late payment: error line,
  // error-tracking capture, and a merchant alert once per charge (job key).
  private async raiseDuplicatePayment(
    order: RowDataPacket,
    gateway: string,
    result: WebhookResult,
  ) {
    const context = {
      orderId: order.id as number,
      shopId: order.shopId as number,
      gateway,
    };
    logger.error(
      'second payment received for an already PAID order, refund it in the payment provider',
      { ...context, providerReference: result.providerReference },
    );
    try {
      resolveErrorTrackingProvider().captureException(
        new Error('second payment received for a paid order'),
        { shopId: order.shopId as number, route: `payment webhook ${gateway}` },
      );
      const alerted = await this.orderNotificationsService.alertDuplicatePayment(
        order.shopId as number,
        order.id as number,
        result.chargeReference ?? result.providerReference,
      );
      if (!alerted) {
        logger.error(
          'duplicate payment on a paid order and NO merchant number to alert, refund it by hand',
          context,
        );
      }
    } catch (err) {
      logger.error('duplicate-payment alert failed', {
        ...context,
        error: err instanceof Error ? err.name : 'non-error',
      });
    }
  }

  // Money arrived for an order that is cancelled. There is deliberately no
  // auto-refund (owner decision), so the only safe thing is to make sure a human
  // knows, once: a structured error line (and the error-tracking sink when one is
  // configured), plus a merchant WhatsApp alert whose job key makes it once per
  // order however many events or redeliveries arrive. Never throws (the payment
  // is already recorded; a failing alert must not turn the webhook into a retry
  // storm).
  private async raiseLatePayment(
    order: RowDataPacket,
    gateway: string,
    result: WebhookResult,
  ) {
    const context = {
      orderId: order.id as number,
      shopId: order.shopId as number,
      gateway,
    };
    logger.error(
      'payment received for a CANCELLED order, refund it in the payment provider',
      { ...context, providerReference: result.providerReference },
    );
    try {
      resolveErrorTrackingProvider().captureException(
        new Error('payment received for a cancelled order'),
        { shopId: order.shopId as number, route: `payment webhook ${gateway}` },
      );
      const alerted = await this.orderNotificationsService.alertLatePayment(
        order.shopId as number,
        order.id as number,
      );
      if (!alerted) {
        // No merchant WhatsApp number to tell: the log line and the
        // error-tracking capture above are the only signal, so say so with the id.
        logger.error(
          'late payment on a cancelled order and NO merchant number to alert, refund it by hand',
          context,
        );
      }
    } catch (err) {
      logger.error('late-payment alert failed', {
        ...context,
        error: err instanceof Error ? err.name : 'non-error',
      });
    }
  }

  // BNPL-specific (Tabby/Tamara — see WebhookResult.advanceOrderStatus).
  // Runs the same CAS state machine OrdersController's own status/cancel
  // endpoints use, just under a synthetic system context instead of a real
  // staff session — every shop always has at least one admin (signup
  // creates one, and the last remaining admin can never be demoted/deleted,
  // see AuthService/branch-roles), so this always resolves one to attribute
  // the resulting audit-log/stock-movement rows to. Only ever applied while
  // the order is still 'pending': a provider's approval/expiry signal
  // arriving after a merchant already moved the order forward (or already
  // cancelled it) is stale and is silently ignored rather than forced
  // through — updateStatus/cancel's own exceptions on an invalid or
  // already-superseded transition are swallowed here for exactly that
  // reason, never allowed to fail the webhook response itself.
  private async applyAdvanceOrderStatus(
    orderId: number,
    shopId: number,
    action: 'confirmed' | 'cancelled',
  ) {
    const orderRows = await this.db.query<RowDataPacket[]>(
      `SELECT status FROM \`order\` WHERE id = ?`,
      [orderId],
    );
    const order = orderRows[0];
    if (!order || order.status !== 'pending') {
      return;
    }
    const adminRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM user WHERE shopId = ? AND role = 'admin' ORDER BY id ASC LIMIT 1`,
      [shopId],
    );
    const admin = adminRows[0];
    if (!admin) {
      logger.warn(
        `webhook-driven order ${action} skipped: shop has no admin user to attribute it to`,
        { orderId, shopId, action },
      );
      return;
    }
    const ctx: TenantContext = {
      userId: admin.id as number,
      shopId,
      role: 'admin',
      outletId: null,
      systemActorLabel: 'system (payment gateway)',
    };
    try {
      if (action === 'confirmed') {
        await this.ordersService.updateStatus(ctx, orderId, {
          status: 'confirmed',
        });
      } else {
        await this.ordersService.cancel(ctx, orderId);
      }
    } catch (error) {
      logger.warn(`webhook-driven order ${action} failed`, {
        orderId,
        shopId,
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// Both methods above join the shop only for its public-host fields; this keeps
// the aliasing in one place.
function shopUrlFieldsFrom(row: RowDataPacket): ShopUrlFields {
  return {
    subdomain: row.shopSubdomain as string,
    domainType: row.shopDomainType as string | null,
    customDomain: row.shopCustomDomain as string | null,
    customDomainStatus: row.shopCustomDomainStatus as string | null,
  };
}
