import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import type { NotifysubscriptionRow } from '../db/types';
import { JobsService } from '../jobs/jobs.service';
import { escapeHtml } from '../common/email';
import { SubscribeDto } from './dto/subscribe.dto';

const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3002';
const RATE_LIMIT_PER_HOUR = 3;
const NOTIFY_CHUNK_SIZE = 50;

@Injectable()
export class NotifySubscriptionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobsService: JobsService,
  ) {}

  async subscribe(dto: SubscribeDto) {
    const productRows = await this.db.query<RowDataPacket[]>(
      `SELECT id, shopId FROM product WHERE id = ?`,
      [dto.productId],
    );
    const product = productRows[0];
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (dto.variantId) {
      const variantRows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM productvariant WHERE id = ? AND productId = ?`,
        [dto.variantId, dto.productId],
      );
      if (variantRows.length === 0) {
        throw new BadRequestException('variantId is invalid for this product');
      }
    }

    const email = dto.email.toLowerCase().trim();
    const shopId = product.shopId as number;
    const variantId = dto.variantId ?? null;

    // Idempotent: a repeat subscribe for the same (shop, product, variant,
    // email) just returns the existing row — no error, no duplicate row,
    // and doesn't count against the rate limit below.
    const existing = await this.findExisting(shopId, dto.productId, variantId, email);
    if (existing) {
      return { subscription: existing, alreadySubscribed: true };
    }

    // ponytail: soft rate limit (count-then-insert, not CAS) — a shopper
    // spamming subscribes isn't a financial or security-sensitive path, so
    // a small race window under true concurrency isn't worth a DB-level
    // counter. Tighten only if this endpoint is ever abused for real.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const countRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM notifysubscription WHERE shopId = ? AND email = ? AND createdAt >= ?`,
      [shopId, email, oneHourAgo],
    );
    const recentCount = Number(countRows[0].c);
    if (recentCount >= RATE_LIMIT_PER_HOUR) {
      throw new BadRequestException(
        'Too many notify-me subscriptions from this email — try again later',
      );
    }

    const result = await this.db.execute(
      `INSERT INTO notifysubscription (shopId, productId, variantId, email) VALUES (?, ?, ?, ?)`,
      [shopId, dto.productId, variantId, email],
    );
    const subscription = await this.findById(result.insertId);
    return { subscription, alreadySubscribed: false };
  }

  // Matches on email + shopId (via productId) only — never confirms or
  // denies whether a *specific* email/product pair was actually subscribed,
  // so this can't be used to probe another shopper's subscriptions.
  async unsubscribe(email: string, productId: number) {
    const productRows = await this.db.query<RowDataPacket[]>(
      `SELECT shopId FROM product WHERE id = ?`,
      [productId],
    );
    const product = productRows[0];
    if (!product) return { success: true };

    await this.db.execute(
      `DELETE FROM notifysubscription WHERE shopId = ? AND productId = ? AND email = ?`,
      [product.shopId, productId, email.toLowerCase().trim()],
    );
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
    const productRows = await this.db.query<RowDataPacket[]>(
      `SELECT p.id, p.name, p.thumbnail, p.slug, s.subdomain AS shopSubdomain, s.name AS shopName
       FROM product p JOIN shop s ON s.id = p.shopId
       WHERE p.id = ?`,
      [productId],
    );
    const product = productRows[0];
    if (!product) return;

    const subscriptions = await this.db.query<(NotifysubscriptionRow & RowDataPacket)[]>(
      `SELECT * FROM notifysubscription
       WHERE shopId = ? AND productId = ? AND variantId ${variantId == null ? 'IS NULL' : '= ?'} AND notifiedAt IS NULL`,
      variantId == null ? [shopId, productId] : [shopId, productId, variantId],
    );
    if (subscriptions.length === 0) return;

    const productUrl = `${STOREFRONT_URL}/${product.shopSubdomain as string}/products/${product.slug as string}`;

    for (let i = 0; i < subscriptions.length; i += NOTIFY_CHUNK_SIZE) {
      const chunk = subscriptions.slice(i, i + NOTIFY_CHUNK_SIZE);
      await Promise.allSettled(
        chunk.map(async (sub) => {
          const unsubscribeUrl = `${STOREFRONT_URL}/${product.shopSubdomain as string}/unsubscribe-notify?email=${encodeURIComponent(sub.email)}&productId=${productId}`;
          const productName = product.name as string;
          const shopName = product.shopName as string;
          const backInStockHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#111111;">Good news — ${escapeHtml(productName)} is back in stock at ${escapeHtml(shopName)}.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:6px;background-color:#0d9488;"><a href="${productUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">View product</a></td></tr></table>
<p style="margin:0 0 4px;font-size:13px;color:#666666;">Or copy this link into your browser:</p>
<p style="margin:0;font-size:12px;color:#999999;font-family:monospace;word-break:break-all;">${productUrl}</p>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 40px;text-align:center;">
<p style="margin:0 0 8px;font-size:12px;color:#999999;">This email was sent by ${escapeHtml(shopName)} via Requital. Don't want these emails? <a href="${unsubscribeUrl}" style="color:#999999;">Unsubscribe</a>.</p>
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
          await this.jobsService.enqueue(
            shopId,
            'send_email',
            {
              to: sub.email,
              subject: `${productName} is back in stock!`,
              bodyText: [
                `Good news — ${productName} is back in stock at ${shopName}.`,
                '',
                `View it here: ${productUrl}`,
                '',
                `Don't want these emails? Unsubscribe: ${unsubscribeUrl}`,
              ].join('\n'),
              html: backInStockHtml,
              fromName: shopName,
            },
            `back-in-stock-email:${sub.id}`,
          );
          // Marked notified once the send is queued (not once it's actually
          // delivered) — a batch failure here is only ever a genuinely
          // unexpected error (e.g. the DB write itself), which
          // Promise.allSettled already isolates per-subscriber so one bad
          // row can't abort the rest of the chunk. Real delivery failures
          // are now the queue's problem (retry/backoff/DLQ), not this
          // method's.
          await this.db.execute(
            `UPDATE notifysubscription SET notifiedAt = ? WHERE id = ?`,
            [new Date(), sub.id],
          );
        }),
      );
    }
  }

  private async findExisting(
    shopId: number,
    productId: number,
    variantId: number | null,
    email: string,
  ) {
    const rows = await this.db.query<(NotifysubscriptionRow & RowDataPacket)[]>(
      `SELECT * FROM notifysubscription
       WHERE shopId = ? AND productId = ? AND variantId ${variantId == null ? 'IS NULL' : '= ?'} AND email = ?`,
      variantId == null ? [shopId, productId, email] : [shopId, productId, variantId, email],
    );
    return rows[0];
  }

  private async findById(id: number) {
    const rows = await this.db.query<(NotifysubscriptionRow & RowDataPacket)[]>(
      `SELECT * FROM notifysubscription WHERE id = ?`,
      [id],
    );
    return rows[0];
  }
}
