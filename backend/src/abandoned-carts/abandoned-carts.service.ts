import { Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { trimDecimal } from '../database/decimal.util';
import type { AbandonedcartRow } from '../db/types';
import { JobsService } from '../jobs/jobs.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { generateOpaqueToken } from '../common/token-hash';
import { escapeHtml } from '../common/email';
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
  constructor(
    private readonly db: DatabaseService,
    private readonly jobsService: JobsService,
    private readonly schedulerService: SchedulerService,
  ) {}

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
    const cartItemsJson = JSON.stringify(cartItems);

    const existingRows = await this.db.query<(AbandonedcartRow & RowDataPacket)[]>(
      `SELECT * FROM abandonedcart WHERE shopId = ? AND customerPhone = ?`,
      [shopId, dto.customerPhone],
    );
    const existing = existingRows[0];

    if (existing && existing.recoveredOrderId === null) {
      await this.db.execute(
        `UPDATE abandonedcart SET customerName = ?, customerEmail = ?, outletId = ?, cartItems = ?, cartValue = ?, updatedAt = ?
         WHERE id = ?`,
        [
          dto.customerName,
          dto.customerEmail ?? null,
          dto.outletId ?? existing.outletId,
          cartItemsJson,
          cartValue,
          new Date(),
          existing.id,
        ],
      );
      return this.findByIdRaw(existing.id);
    }

    if (existing) {
      await this.db.execute(
        `UPDATE abandonedcart SET customerName = ?, customerEmail = ?, outletId = ?, cartItems = ?, cartValue = ?,
                capturedAt = ?, updatedAt = ?, recoveryEmailSentAt = NULL, recoveredOrderId = NULL, recoverToken = ?
         WHERE id = ?`,
        [
          dto.customerName,
          dto.customerEmail ?? null,
          dto.outletId ?? null,
          cartItemsJson,
          cartValue,
          new Date(),
          new Date(),
          generateOpaqueToken(),
          existing.id,
        ],
      );
      return this.findByIdRaw(existing.id);
    }

    const result = await this.db.execute(
      `INSERT INTO abandonedcart (shopId, outletId, customerName, customerPhone, customerEmail, cartItems, cartValue, recoverToken, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shopId,
        dto.outletId ?? null,
        dto.customerName,
        dto.customerPhone,
        dto.customerEmail ?? null,
        cartItemsJson,
        cartValue,
        generateOpaqueToken(),
        new Date(),
      ],
    );
    return this.findByIdRaw(result.insertId);
  }

  // Public, token-authenticated (not the row's numeric id) — the
  // storefront's /cart/recover route calls this to repopulate a shopper's
  // local cart from the email link. Never returns a fully "spent"
  // (recovered) cart's contents past the point they'd be useful — not a
  // security boundary (the cart is already theirs), just avoids the
  // recovery link re-adding items after they already checked out via it or
  // another device.
  async resolveByToken(token: string) {
    const rows = await this.db.query<(AbandonedcartRow & RowDataPacket)[]>(
      `SELECT * FROM abandonedcart WHERE recoverToken = ?`,
      [token],
    );
    const cart = rows[0];
    if (!cart || cart.recoveredOrderId !== null) {
      throw new NotFoundException('This recovery link is no longer valid');
    }
    return {
      cartItems: cart.cartItems as unknown as CartItemSnapshot[],
      outletId: cart.outletId,
    };
  }

  // Called from inside PublicService.createOrder's transaction, right
  // after the order is created — a CAS UPDATE (WHERE recoveredOrderId
  // IS NULL), same idiom as stock/discount. This is the write that makes
  // the "completion racing the recovery job" scenario safe: whichever of
  // this call and the recovery job's own claim (see sendDueForShop below)
  // lands first in the DB wins the row, and the loser's own WHERE clause
  // simply matches zero rows.
  async markRecovered(
    conn: PoolConnection,
    shopId: number,
    customerPhone: string,
    orderId: number,
  ) {
    await conn.query(
      `UPDATE abandonedcart SET recoveredOrderId = ?, updatedAt = ? WHERE shopId = ? AND customerPhone = ? AND recoveredOrderId IS NULL`,
      [orderId, new Date(), shopId, customerPhone],
    );
  }

  async findAllForShop(ctx: TenantContext) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, customerName, customerPhone, customerEmail, cartValue, capturedAt, recoveryEmailSentAt, recoveredOrderId
       FROM abandonedcart WHERE shopId = ? ORDER BY capturedAt DESC`,
      [ctx.shopId],
    );
    return rows.map((r) => ({
      id: r.id as number,
      customerName: r.customerName as string,
      customerPhone: r.customerPhone as string,
      customerEmail: r.customerEmail as string | null,
      cartValue: trimDecimal(r.cartValue as string),
      capturedAt: r.capturedAt as Date,
      recoveryEmailSentAt: r.recoveryEmailSentAt as Date | null,
      recoveredOrderId: r.recoveredOrderId as number | null,
    }));
  }

  // Wrapped in the cross-instance advisory lock (see SchedulerService) so
  // only one app instance runs the sweep per tick — sendDueForShop's own
  // per-cart CAS claim already made double-*sending* impossible, but
  // without this lock every instance would still redundantly query every
  // opted-in shop's abandoned carts on every tick.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sendDueRecoveryEmails() {
    await this.schedulerService.runLocked(
      'abandoned-cart-recovery-sweep',
      300,
      () => this.runSweep(),
    );
  }

  private async runSweep() {
    const shops = await this.db.query<RowDataPacket[]>(
      `SELECT id, name, subdomain, abandonedCartWindowMinutes FROM shop WHERE notifyAbandonedCart = TRUE`,
    );
    for (const shop of shops) {
      await this.sendDueForShop(
        shop.id as number,
        shop.name as string,
        shop.subdomain as string,
        shop.abandonedCartWindowMinutes as number,
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
    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT notifyAbandonedCart FROM shop WHERE id = ?`,
      [shopId],
    );
    if (!shopRows[0]?.notifyAbandonedCart) return 0;

    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
    const candidates = await this.db.query<(AbandonedcartRow & RowDataPacket)[]>(
      `SELECT * FROM abandonedcart WHERE shopId = ? AND capturedAt <= ? AND recoveryEmailSentAt IS NULL AND recoveredOrderId IS NULL`,
      [shopId, cutoff],
    );

    let sent = 0;
    for (const cart of candidates) {
      if (!cart.customerEmail) continue; // nothing to send to — phone-only carts stay silently unrecovered by email

      // Claim THIS row right before sending — the candidates list above was
      // read a moment ago and could already be stale (an order may have
      // completed, or another overlapping run may have claimed it, in the
      // interim). Only a successful claim (affectedRows 1) is allowed to send.
      const claimed = await this.db.execute(
        `UPDATE abandonedcart SET recoveryEmailSentAt = ?, updatedAt = ?
         WHERE id = ? AND recoveryEmailSentAt IS NULL AND recoveredOrderId IS NULL`,
        [new Date(), new Date(), cart.id],
      );
      if (claimed.affectedRows === 0) continue;

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
      const recoverLink = `${STOREFRONT_URL}/${shopSlug}/cart/recover?token=${cart.recoverToken}`;
      const itemRows = items
        .map(
          (i) =>
            `<tr><td style="padding:6px 0;font-size:14px;color:#111111;">${i.quantity}&times; ${escapeHtml(i.name)}${i.variantLabel ? ` (${escapeHtml(i.variantLabel)})` : ''}</td><td style="padding:6px 0;font-size:14px;color:#111111;text-align:right;">${escapeHtml(String(i.price))}</td></tr>`,
        )
        .join('');
      const cartHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111111;">Hi ${escapeHtml(cart.customerName)},</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#111111;">You left these in your cart at ${escapeHtml(shopName)}:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;">${itemRows}</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:6px;background-color:#0d9488;"><a href="${recoverLink}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Resume checkout</a></td></tr></table>
<p style="margin:0 0 4px;font-size:13px;color:#666666;">Or copy this link into your browser:</p>
<p style="margin:0;font-size:12px;color:#999999;font-family:monospace;word-break:break-all;">${recoverLink}</p>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 40px;text-align:center;">
<p style="margin:0 0 8px;font-size:12px;color:#999999;">This email was sent by ${escapeHtml(shopName)} via Requital.</p>
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
      await this.jobsService.enqueue(
        shopId,
        'send_email',
        {
          to: cart.customerEmail,
          subject: `You left something at ${shopName}`,
          bodyText: bodyLines.join('\n'),
          html: cartHtml,
          fromName: shopName,
        },
        `abandoned-cart-recovery-email:${cart.id}:${cart.recoverToken}`,
      );
      sent += 1;
    }
    return sent;
  }

  private async findByIdRaw(id: number) {
    const rows = await this.db.query<(AbandonedcartRow & RowDataPacket)[]>(
      `SELECT * FROM abandonedcart WHERE id = ?`,
      [id],
    );
    return rows[0];
  }
}
