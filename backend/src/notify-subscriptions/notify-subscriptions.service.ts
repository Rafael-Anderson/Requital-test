import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { sendEmail } from '../common/email';
import { SubscribeDto } from './dto/subscribe.dto';

const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3002';
const RATE_LIMIT_PER_HOUR = 3;
const NOTIFY_CHUNK_SIZE = 50;

@Injectable()
export class NotifySubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async subscribe(dto: SubscribeDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, shopId: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (dto.variantId) {
      const variant = await this.prisma.productvariant.findFirst({
        where: { id: dto.variantId, productId: dto.productId },
      });
      if (!variant) {
        throw new BadRequestException('variantId is invalid for this product');
      }
    }

    const email = dto.email.toLowerCase().trim();
    const shopId = product.shopId;

    // Idempotent: a repeat subscribe for the same (shop, product, variant,
    // email) just returns the existing row — no error, no duplicate row,
    // and doesn't count against the rate limit below. findFirst rather than
    // findUnique on the compound key: Prisma's generated compound-unique
    // input type requires variantId to be a plain number (MySQL's
    // NULL-is-distinct unique-index semantics mean the compound key can't
    // be looked up with an explicit null), so a product-level (variantId
    // null) subscription has to be matched via a regular filtered query.
    const existing = await this.prisma.notifysubscription.findFirst({
      where: {
        shopId,
        productId: dto.productId,
        variantId: dto.variantId ?? null,
        email,
      },
    });
    if (existing) {
      return { subscription: existing, alreadySubscribed: true };
    }

    // ponytail: soft rate limit (count-then-insert, not CAS) — a shopper
    // spamming subscribes isn't a financial or security-sensitive path, so
    // a small race window under true concurrency isn't worth a DB-level
    // counter. Tighten only if this endpoint is ever abused for real.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.prisma.notifysubscription.count({
      where: { shopId, email, createdAt: { gte: oneHourAgo } },
    });
    if (recentCount >= RATE_LIMIT_PER_HOUR) {
      throw new BadRequestException(
        'Too many notify-me subscriptions from this email — try again later',
      );
    }

    const subscription = await this.prisma.notifysubscription.create({
      data: {
        shopId,
        productId: dto.productId,
        variantId: dto.variantId ?? null,
        email,
      },
    });
    return { subscription, alreadySubscribed: false };
  }

  // Matches on email + shopId (via productId) only — never confirms or
  // denies whether a *specific* email/product pair was actually subscribed,
  // so this can't be used to probe another shopper's subscriptions.
  async unsubscribe(email: string, productId: number) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { shopId: true },
    });
    if (!product) return { success: true };

    await this.prisma.notifysubscription.deleteMany({
      where: {
        shopId: product.shopId,
        productId,
        email: email.toLowerCase().trim(),
      },
    });
    return { success: true };
  }

  // Called when a product/variant's stock crosses 0 -> positive. Fire and
  // forget from the caller's perspective (not awaited) — a slow or failing
  // email batch must never hold up the stock write that triggered it.
  async triggerForProduct(
    shopId: number,
    productId: number,
    variantId?: number | null,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        thumbnail: true,
        slug: true,
        shop: { select: { subdomain: true, name: true } },
      },
    });
    if (!product) return;

    const subscriptions = await this.prisma.notifysubscription.findMany({
      where: {
        shopId,
        productId,
        variantId: variantId ?? null,
        notifiedAt: null,
      },
    });
    if (subscriptions.length === 0) return;

    const productUrl = `${STOREFRONT_URL}/${product.shop.subdomain}/products/${product.slug}`;

    for (let i = 0; i < subscriptions.length; i += NOTIFY_CHUNK_SIZE) {
      const chunk = subscriptions.slice(i, i + NOTIFY_CHUNK_SIZE);
      await Promise.allSettled(
        chunk.map(async (sub) => {
          const unsubscribeUrl = `${STOREFRONT_URL}/${product.shop.subdomain}/unsubscribe-notify?email=${encodeURIComponent(sub.email)}&productId=${productId}`;
          await sendEmail(
            sub.email,
            `${product.name} is back in stock!`,
            [
              `Good news — ${product.name} is back in stock at ${product.shop.name}.`,
              '',
              `View it here: ${productUrl}`,
              '',
              `Don't want these emails? Unsubscribe: ${unsubscribeUrl}`,
            ].join('\n'),
            { fromName: product.shop.name },
          );
          // Marked notified even if sendEmail internally fell back to its
          // stub (sendEmail never throws) — a batch failure here is only
          // ever a genuinely unexpected error (e.g. the DB write itself),
          // which Promise.allSettled already isolates per-subscriber so one
          // bad row can't abort the rest of the chunk.
          await this.prisma.notifysubscription.update({
            where: { id: sub.id },
            data: { notifiedAt: new Date() },
          });
        }),
      );
    }
  }
}
