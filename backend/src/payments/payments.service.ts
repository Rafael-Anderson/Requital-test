import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentSettingsService } from './payment-settings.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { BranchRolesService } from '../branch-roles/branch-roles.service';

const LINK_EXPIRY_DAYS = 3;
const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3002';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly paymentSettingsService: PaymentSettingsService,
    private readonly affiliateService: AffiliateService,
    private readonly branchRolesService: BranchRolesService,
  ) {}

  async generateLink(ctx: TenantContext, orderId: number) {
    const outletId = resolveOutletFilter(ctx);
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        shopId: ctx.shopId,
        ...(outletId !== undefined && { outletId }),
      },
    });
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
      order.outletId,
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
    await this.prisma.order.update({
      where: { id: orderId },
      data: { paymentLinkToken: token, paymentLinkExpiresAt: expiresAt },
    });

    return { url: `${STOREFRONT_URL}/pay/${token}`, token, expiresAt };
  }

  // Public (token-authenticated, not shop-scoped) — the token is the
  // credential a customer holds, standing in for a merchant session.
  async getCheckoutSession(token: string) {
    const order = await this.prisma.order.findUnique({
      where: { paymentLinkToken: token },
      include: { shop: true },
    });
    if (!order) {
      throw new NotFoundException('Payment link not found');
    }
    if (order.paymentStatus === 'paid') {
      return { alreadyPaid: true as const };
    }
    if (
      !order.paymentLinkExpiresAt ||
      order.paymentLinkExpiresAt < new Date()
    ) {
      throw new GoneException('Payment link has expired');
    }

    const provider = this.providerRegistry.get(order.shop.paymentGateway);
    const credentials = await this.paymentSettingsService.resolveCredentials(
      order.shop.id,
      order.shop.paymentGateway,
    );
    const session = await provider.createCheckoutSession({
      orderId: order.id,
      amount: Number(order.total),
      currency: order.shop.currency,
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
      webhookSecret = credentials?.webhookSecret;
      if (!webhookSecret) {
        throw new BadRequestException(
          `Shop ${shopId} has no ${gateway} webhook secret configured`,
        );
      }
    }

    const result = provider.parseWebhookEvent(
      rawBody,
      signatureHeader,
      webhookSecret,
    );
    if (!result) {
      return { received: true };
    }

    const order = await this.prisma.order.findUnique({
      where: { id: result.orderId },
    });
    if (!order) {
      return { received: true };
    }
    // Defense in depth on top of signature verification itself (which
    // already rejects an event signed with the wrong shop's secret): even a
    // validly-signed event must actually belong to the shop whose URL it
    // arrived on, never silently applied to a different shop's order.
    if (shopId !== undefined && order.shopId !== shopId) {
      console.warn(
        `[payments] webhook for order ${order.id} (shop ${order.shopId}) received on shop ${shopId}'s webhook URL — ignoring`,
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
      await this.prisma.$transaction([
        this.prisma.paymenttransaction.create({
          data: {
            orderId: order.id,
            gateway: provider.name,
            gatewayReference: result.providerReference,
            providerChargeReference: result.chargeReference,
            amount: order.total,
            status: result.status,
          },
        }),
        ...(result.status === 'paid'
          ? [
              this.prisma.order.update({
                where: { id: order.id },
                data: { paymentStatus: 'paid' },
              }),
            ]
          : []),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // P2002: the unique (gateway, gatewayReference) index rejected a
        // duplicate insert — the earlier delivery already fully committed.
        // P2034: MySQL reported a write conflict — observed in practice when
        // two deliveries of the same event land truly concurrently, before
        // either has committed, so neither has hit P2002 yet. Both outcomes
        // mean "a concurrent/prior delivery of this exact event owns this
        // write," so both no-op the same way instead of surfacing a 500 that
        // would make the gateway retry a delivery that already succeeded elsewhere.
        if (error.code === 'P2002' || error.code === 'P2034') {
          return { received: true };
        }
      }
      throw error;
    }

    if (result.status === 'paid') {
      await this.affiliateService.syncOrderStatus(order.id, {
        paymentPaid: true,
      });
    }

    return { received: true };
  }
}
