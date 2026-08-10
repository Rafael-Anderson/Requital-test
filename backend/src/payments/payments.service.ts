import {
  BadRequestException,
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
import { createLogger } from '../common/logging/logger';

const logger = createLogger('PaymentsService');

const LINK_EXPIRY_DAYS = 3;
const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3002';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly paymentSettingsService: PaymentSettingsService,
    private readonly affiliateService: AffiliateService,
    private readonly branchRolesService: BranchRolesService,
    private readonly ordersService: OrdersService,
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
      `SELECT * FROM \`order\` WHERE ${conditions.join(' AND ')}`,
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

    return { url: `${STOREFRONT_URL}/pay/${token}`, token, expiresAt };
  }

  // Public (token-authenticated, not shop-scoped) — the token is the
  // credential a customer holds, standing in for a merchant session.
  async getCheckoutSession(token: string) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT o.*, s.id AS shopRowId, s.paymentGateway AS shopPaymentGateway, s.currency AS shopCurrency
       FROM \`order\` o JOIN shop s ON s.id = o.shopId
       WHERE o.paymentLinkToken = ?`,
      [token],
    );
    const order = rows[0];
    if (!order) {
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

    const provider = this.providerRegistry.get(order.shopPaymentGateway as string);
    const credentials = await this.paymentSettingsService.resolveCredentials(
      order.shopRowId as number,
      order.shopPaymentGateway as string,
    );
    const session = await provider.createCheckoutSession({
      orderId: order.id as number,
      amount: Number(order.total),
      currency: order.shopCurrency as string,
      successUrl: `${STOREFRONT_URL}/pay/${token}/success`,
      cancelUrl: `${STOREFRONT_URL}/pay/${token}`,
      credentials,
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
        `webhook for order ${order.id as number} received on the wrong shop's webhook URL — ignoring`,
        { orderId: order.id, orderShopId: order.shopId, webhookShopId: shopId },
      );
      return { received: true };
    }

    try {
      // The paymenttransaction insert and the order update live in one
      // transaction, guarded by a unique (gateway, gatewayReference) index —
      // not a "check if it exists, then insert" read-then-write, which two
      // concurrent deliveries of the same retried event could both pass.
      // If the insert violates the unique constraint, the whole transaction
      // (including the order update) rolls back, so a duplicate delivery
      // can't re-apply the paymentStatus change or insert a second row.
      await this.db.transaction(async (conn) => {
        await conn.query(
          `INSERT INTO paymenttransaction (orderId, gateway, gatewayReference, providerChargeReference, amount, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            order.id,
            provider.name,
            result.providerReference,
            result.chargeReference ?? null,
            order.total,
            result.status,
          ],
        );
        if (result.status === 'paid') {
          await conn.query(`UPDATE \`order\` SET paymentStatus = 'paid' WHERE id = ?`, [
            order.id,
          ]);
        }
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
        return { received: true };
      }
      throw error;
    }

    if (result.status === 'paid') {
      await this.affiliateService.syncOrderStatus(order.id as number, {
        paymentPaid: true,
      });
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
        `webhook-driven order ${action} skipped — shop has no admin user to attribute it to`,
        { orderId, shopId, action },
      );
      return;
    }
    const ctx: TenantContext = {
      userId: admin.id as number,
      shopId,
      role: 'admin',
      outletId: null,
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
