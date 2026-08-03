import { Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sendEmail } from '../common/email';
import { generateOpaqueToken } from '../common/token-hash';
import type { TenantContext } from '../common/tenant-context';
import { CaptureAbandonedCartDto } from './dto/capture-abandoned-cart.dto';

const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3002';

export interface CartItemSnapshot {
  productId: number;
  variantId?: number;
  name: string;
  variantLabel?: string;
  price: number;
  quantity: number;
  thumbnail: string;
}

@Injectable()
export class AbandonedCartsService {
  constructor(private readonly prisma: PrismaService) {}

  // Called by the storefront checkout page once name+phone are both
  // filled in — see PublicController. Upsert keyed on [shopId,
  // customerPhone]: a still-open episode (no recoveredOrderId yet) just
  // gets its cart snapshot refreshed in place (capturedAt and
  // recoveryEmailSentAt stay untouched, so re-visiting checkout without
  // completing can never re-trigger a second recovery email for the same
  // episode); a row left over from a *previous, already-completed*
  // episode gets fully reset into a fresh one.
  async capture(shopId: number, dto: CaptureAbandonedCartDto) {
    const cartValue = dto.cartItems.reduce(
      (sum, i) => sum + i.price * i.quantity,
      0,
    );
    const cartItems: CartItemSnapshot[] = dto.cartItems;

    const existing = await this.prisma.abandonedcart.findUnique({
      where: {
        shopId_customerPhone: { shopId, customerPhone: dto.customerPhone },
      },
    });

    if (existing && existing.recoveredOrderId === null) {
      return this.prisma.abandonedcart.update({
        where: { id: existing.id },
        data: {
          customerName: dto.customerName,
          customerEmail: dto.customerEmail ?? null,
          outletId: dto.outletId ?? existing.outletId,
          cartItems: cartItems as unknown as Prisma.InputJsonValue,
          cartValue,
        },
      });
    }

    return this.prisma.abandonedcart.upsert({
      where: {
        shopId_customerPhone: { shopId, customerPhone: dto.customerPhone },
      },
      create: {
        shopId,
        outletId: dto.outletId,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        customerEmail: dto.customerEmail,
        cartItems: cartItems as unknown as Prisma.InputJsonValue,
        cartValue,
        recoverToken: generateOpaqueToken(),
      },
      update: {
        customerName: dto.customerName,
        customerEmail: dto.customerEmail ?? null,
        outletId: dto.outletId,
        cartItems: cartItems as unknown as Prisma.InputJsonValue,
        cartValue,
        capturedAt: new Date(),
        recoveryEmailSentAt: null,
        recoveredOrderId: null,
        recoverToken: generateOpaqueToken(),
      },
    });
  }

  // Public, token-authenticated (not the row's numeric id) — the
  // storefront's /cart/recover route calls this to repopulate a shopper's
  // local cart from the email link. Never returns a fully "spent"
  // (recovered) cart's contents past the point they'd be useful — not a
  // security boundary (the cart is already theirs), just avoids the
  // recovery link re-adding items after they already checked out via it or
  // another device.
  async resolveByToken(token: string) {
    const cart = await this.prisma.abandonedcart.findUnique({
      where: { recoverToken: token },
    });
    if (!cart || cart.recoveredOrderId !== null) {
      throw new NotFoundException('This recovery link is no longer valid');
    }
    return {
      cartItems: cart.cartItems as unknown as CartItemSnapshot[],
      outletId: cart.outletId,
    };
  }

  // Called from inside PublicService.createOrder's transaction, right
  // after the order is created — a CAS updateMany (WHERE recoveredOrderId
  // IS NULL), same idiom as stock/discount. This is the write that makes
  // the "completion racing the recovery job" scenario safe: whichever of
  // this call and the recovery job's own claim (see claimDueForShop below)
  // lands first in the DB wins the row, and the loser's own WHERE clause
  // simply matches zero rows.
  async markRecovered(
    tx: Prisma.TransactionClient,
    shopId: number,
    customerPhone: string,
    orderId: number,
  ) {
    await tx.abandonedcart.updateMany({
      where: { shopId, customerPhone, recoveredOrderId: null },
      data: { recoveredOrderId: orderId },
    });
  }

  async findAllForShop(ctx: TenantContext) {
    return this.prisma.abandonedcart.findMany({
      where: { shopId: ctx.shopId },
      orderBy: { capturedAt: 'desc' },
      select: {
        id: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        cartValue: true,
        capturedAt: true,
        recoveryEmailSentAt: true,
        recoveredOrderId: true,
      },
    });
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sendDueRecoveryEmails() {
    const shops = await this.prisma.shop.findMany({
      where: { notifyAbandonedCart: true },
      select: {
        id: true,
        name: true,
        subdomain: true,
        abandonedCartWindowMinutes: true,
      },
    });
    for (const shop of shops) {
      await this.sendDueForShop(
        shop.id,
        shop.name,
        shop.subdomain,
        shop.abandonedCartWindowMinutes,
      );
    }
  }

  // Split out from the cron sweep so a test (or a future "send now" admin
  // action) can trigger one shop's pass directly — checks the opt-in toggle
  // itself (not just relying on the cron's pre-filter) so it's correct no
  // matter how it's called.
  async sendDueForShop(
    shopId: number,
    shopName: string,
    shopSlug: string,
    windowMinutes: number,
  ) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { notifyAbandonedCart: true },
    });
    if (!shop?.notifyAbandonedCart) return 0;

    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
    const candidates = await this.prisma.abandonedcart.findMany({
      where: {
        shopId,
        capturedAt: { lte: cutoff },
        recoveryEmailSentAt: null,
        recoveredOrderId: null,
      },
    });

    let sent = 0;
    for (const cart of candidates) {
      if (!cart.customerEmail) continue; // nothing to send to — phone-only carts stay silently unrecovered by email

      // Claim THIS row right before sending — the candidates list above was
      // read a moment ago and could already be stale (an order may have
      // completed, or another overlapping run may have claimed it, in the
      // interim). Only a successful claim (count 1) is allowed to send.
      const claimed = await this.prisma.abandonedcart.updateMany({
        where: {
          id: cart.id,
          recoveryEmailSentAt: null,
          recoveredOrderId: null,
        },
        data: { recoveryEmailSentAt: new Date() },
      });
      if (claimed.count === 0) continue;

      const items = cart.cartItems as unknown as CartItemSnapshot[];
      const bodyLines = [
        `Hi ${cart.customerName}, you left these in your cart at ${shopName}:`,
        '',
        ...items.map(
          (i) =>
            `- ${i.quantity}x ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} — ${i.price}`,
        ),
        '',
        `Pick up where you left off: ${STOREFRONT_URL}/${shopSlug}/cart/recover?token=${cart.recoverToken}`,
      ];
      await sendEmail(
        cart.customerEmail,
        `You left something at ${shopName}`,
        bodyLines.join('\n'),
        {
          fromName: shopName,
        },
      );
      sent += 1;
    }
    return sent;
  }
}
