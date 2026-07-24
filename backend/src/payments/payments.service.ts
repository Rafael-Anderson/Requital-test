import {
  BadRequestException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import type { PaymentProvider } from './payment-provider.interface';

const LINK_EXPIRY_DAYS = 3;
const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3001';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
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

    const session = await this.provider.createCheckoutSession({
      orderId: order.id,
      amount: Number(order.total),
      currency: order.shop.currency,
      successUrl: `${STOREFRONT_URL}/pay/${token}/success`,
      cancelUrl: `${STOREFRONT_URL}/pay/${token}`,
    });
    return { alreadyPaid: false as const, checkoutUrl: session.checkoutUrl };
  }

  async handleWebhook(rawBody: Buffer, signatureHeader: string) {
    const result = this.provider.parseWebhookEvent(rawBody, signatureHeader);
    if (!result) {
      return { received: true };
    }

    const order = await this.prisma.order.findUnique({
      where: { id: result.orderId },
    });
    if (!order) {
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
            gateway: this.provider.name,
            gatewayReference: result.providerReference,
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
        // would make Stripe retry a delivery that already succeeded elsewhere.
        if (error.code === 'P2002' || error.code === 'P2034') {
          return { received: true };
        }
      }
      throw error;
    }

    return { received: true };
  }
}
