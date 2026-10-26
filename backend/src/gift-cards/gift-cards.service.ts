import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { PoolConnection, Pool, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { trimDecimal } from '../database/decimal.util';
import type { GiftcardRow } from '../db/types';
import { JobsService } from '../jobs/jobs.service';
import { escapeHtml } from '../common/email';
import type { TenantContext } from '../common/tenant-context';
import { CreateGiftCardDto } from './dto/create-gift-card.dto';
import { UpdateGiftCardDto } from './dto/update-gift-card.dto';
import {
  GIFT_CARD_REJECTION_MESSAGES,
  GiftCardRejectionReason,
} from './gift-card.constants';

export interface EvaluateGiftCardResult {
  valid: boolean;
  reason?: GiftCardRejectionReason;
  message?: string;
  giftCardId?: number;
  code?: string;
  remainingBalance?: number;
}

// Globally unique (not shop-scoped) — the code alone is the redemption
// credential, same "possession proves it" shape as order.trackingToken, not
// a login. Grouped into readable blocks the way a real gift card's printed
// code would be, even though this is digital-only (see the task's own
// scope note) — purely a UX nicety for reading it back over the phone/
// pasting it correctly.
function generateGiftCardCode(): string {
  const raw = randomBytes(10).toString('hex').toUpperCase(); // 20 hex chars
  return raw.match(/.{1,4}/g)!.join('-');
}

@Injectable()
export class GiftCardsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobsService: JobsService,
  ) {}

  async findAll(ctx: TenantContext) {
    const rows = await this.db.query<(GiftcardRow & RowDataPacket)[]>(
      `SELECT g.*, c.id AS purchaserId, c.name AS purchaserName
       FROM giftcard g
       LEFT JOIN customer c ON c.id = g.purchasedByCustomerId
       WHERE g.shopId = ?
       ORDER BY g.id DESC`,
      [ctx.shopId],
    );
    return rows.map((r) => this.toResponse(r));
  }

  async findOne(ctx: TenantContext, id: number) {
    const card = await this.findRaw(ctx, id);
    return this.toResponse(card);
  }

  // Admin-issued only — a storefront purchase goes through issueForOrder
  // instead, from inside the order transaction. No email is sent here; the
  // admin sees the generated code directly in the response/list and relays
  // it to the customer however they normally would (phone, WhatsApp) — see
  // the task's own "simple admin CRUD" scope, no email-on-issue was asked
  // for on this path specifically (unlike the storefront purchase path,
  // where nobody's looking at an admin screen to relay it).
  async create(ctx: TenantContext, dto: CreateGiftCardDto) {
    const code = await this.generateUniqueCode();
    const result = await this.db.execute(
      `INSERT INTO giftcard (shopId, code, initialValue, remainingBalance, expiresAt, updatedAt, currency)
       VALUES (?, ?, ?, ?, ?, ?, (SELECT currency FROM shop WHERE id = ?))`,
      [
        ctx.shopId,
        code,
        dto.initialValue,
        dto.initialValue,
        dto.expiresAt ? new Date(dto.expiresAt) : null,
        new Date(),
        ctx.shopId, // the currency subselect above
      ],
    );
    const card = await this.findByIdRaw(result.insertId);
    return this.toResponse(card);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateGiftCardDto) {
    await this.findRaw(ctx, id);
    const set = buildSetClause({
      status: dto.status,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      updatedAt: new Date(),
    });
    if (set) {
      await this.db.execute(`UPDATE giftcard SET ${set.setClause} WHERE id = ?`, [
        ...set.params,
        id,
      ]);
    }
    const card = await this.findByIdRaw(id);
    return this.toResponse(card);
  }

  // Full endpoint logic for the storefront's checkout gift-card-code field
  // — same "resolve then evaluate" split as DiscountsService.validate, and
  // deliberately doesn't touch remainingBalance (see redeem() for the
  // atomic claim, which only happens inside the order's own transaction).
  async validateCode(
    shopId: number,
    rawCode: string,
  ): Promise<EvaluateGiftCardResult> {
    const code = this.normalizeCode(rawCode);
    const rows = await this.db.query<(GiftcardRow & RowDataPacket)[]>(
      `SELECT * FROM giftcard WHERE code = ?`,
      [code],
    );
    const card = rows[0];
    if (!card || card.shopId !== shopId) return this.reject('not_found');
    if (card.status === 'disabled') return this.reject('disabled');
    if (
      card.status === 'expired' ||
      (card.expiresAt && card.expiresAt < new Date())
    ) {
      return this.reject('expired');
    }
    if (Number(card.remainingBalance) <= 0) return this.reject('no_balance');
    return {
      valid: true,
      giftCardId: card.id,
      code: card.code,
      remainingBalance: Number(card.remainingBalance),
    };
  }

  async resolveById(shopId: number, id: number) {
    const rows = await this.db.query<(GiftcardRow & RowDataPacket)[]>(
      `SELECT * FROM giftcard WHERE id = ? AND shopId = ?`,
      [id, shopId],
    );
    return rows[0] ?? null;
  }

  // Atomically draws down `amount` — CAS on remainingBalance, same
  // WHERE-guarded UPDATE idiom as stock/discount. Must run inside the
  // same transaction that creates the order: if two concurrent checkouts
  // both validated the same card's balance a moment ago and only one can
  // actually be covered, the loser's CAS fails here and the whole order
  // attempt aborts, exactly like a discount's usage-limit race.
  async redeem(
    conn: PoolConnection,
    giftCardId: number,
    amount: number,
    orderId: number,
  ) {
    const [result] = await conn.query(
      `UPDATE giftcard SET remainingBalance = remainingBalance - ?, updatedAt = ?
       WHERE id = ? AND remainingBalance >= ?`,
      [amount, new Date(), giftCardId, amount],
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new ConflictException(
        "This gift card's balance just changed. Please try again",
      );
    }
    await conn.query(
      `INSERT INTO giftcardredemption (giftCardId, orderId, amountUsed) VALUES (?, ?, ?)`,
      [giftCardId, orderId, amount],
    );
    await this.syncStatus(conn, giftCardId);
  }

  // Credits a refund back onto the card's balance instead of a provider
  // refund — see ReturnsService, which computes the split. Never touches a
  // disabled/expired card's status (money still needs to land somewhere,
  // but a merchant-revoked or expired card doesn't get silently
  // reactivated by an unrelated refund) — only the automatic active<->
  // redeemed transition (syncStatus) applies here.
  async creditRefund(conn: PoolConnection, giftCardId: number, amount: number) {
    await conn.query(
      `UPDATE giftcard SET remainingBalance = remainingBalance + ?, updatedAt = ? WHERE id = ?`,
      [amount, new Date(), giftCardId],
    );
    await this.syncStatus(conn, giftCardId);
  }

  // An order edit lowered the total below what the order holds in gift card +
  // store credit, and `amount` of the card's share is put back: the balance goes
  // up (status re-synced exactly like a refund) and the order's redemption record
  // shrinks by the same amount, so SUM(amountUsed) keeps describing what the card
  // still funds. Runs on the caller's transaction, after the order row lock.
  async releaseForOrderEdit(
    conn: PoolConnection,
    giftCardId: number,
    orderId: number,
    amount: number,
  ) {
    await this.creditRefund(conn, giftCardId, amount);
    await conn.query(
      `UPDATE giftcardredemption SET amountUsed = GREATEST(amountUsed - ?, 0)
        WHERE giftCardId = ? AND orderId = ?`,
      [amount, giftCardId, orderId],
    );
  }

  // A CANCEL gives back every gift card balance the order drew (F8: the one tender
  // a cancel never returned; store credit, stock and the discount use all were).
  // Runs on the caller's transaction, after the cancel's status CAS won, so the
  // order is locked and only one cancel can be here. Shop-scoped through the card
  // (the order id alone is never trusted). Idempotent: each redemption record is
  // zeroed as it is released, so a second pass (a retried cancel, or an order that
  // an edit had already part-released) gives back only what is still held.
  async releaseAllForOrder(
    conn: PoolConnection,
    shopId: number,
    orderId: number,
  ) {
    const [held] = await conn.query<RowDataPacket[]>(
      `SELECT r.giftCardId, r.amountUsed
         FROM giftcardredemption r
         JOIN giftcard g ON g.id = r.giftCardId
        WHERE r.orderId = ? AND g.shopId = ? AND r.amountUsed > 0
        ORDER BY r.giftCardId, r.id
          FOR UPDATE`,
      [orderId, shopId],
    );
    for (const r of held) {
      await this.releaseForOrderEdit(
        conn,
        r.giftCardId as number,
        orderId,
        Number(trimDecimal(r.amountUsed as string)),
      );
    }
  }

  // F8: the order that SOLD gift cards is being cancelled (by staff, a payment
  // webhook or the gateway-failure system cancel), so the codes it issued must not
  // work and the email that carries them must not go out. The cards are disabled
  // (an admin can see them and re-enable), and the queued delivery email is
  // dismissed while still pending; one already sent cannot be recalled, which is
  // why the card is disabled as well. Only a card still 'active' and untouched is
  // changed, so it is idempotent and never takes back a card already spent from.
  async voidIssuedForOrder(
    conn: PoolConnection,
    shopId: number,
    orderId: number,
  ) {
    await conn.query(
      `UPDATE giftcard SET status = 'disabled', updatedAt = ?
        WHERE purchaseOrderId = ? AND shopId = ? AND status = 'active'
          AND remainingBalance = initialValue`,
      [new Date(), orderId, shopId],
    );
    await conn.query(
      `UPDATE job SET status = 'dismissed', updatedAt = ?
        WHERE shopId = ? AND idempotencyKey = ? AND status = 'pending'`,
      [new Date(), shopId, `gift-card-issued-email:${orderId}`],
    );
  }

  // One unit issued per quantity — e.g. quantity 3 of a 200 AED gift card
  // product creates three independent 200-balance cards, each individually
  // redeemable (not one 600-balance card), matching how a shopper buying 3
  // physical gift cards would expect 3 separate codes to give to 3 different
  // people. Self-purchase only for this pass (see the task's own scope
  // note) — emails the code(s) to the purchaser's own order email, not a
  // separate recipient field.
  async issueForOrder(
    conn: PoolConnection,
    shopId: number,
    orderId: number,
    customerId: number | null,
    lines: { amount: number; quantity: number }[],
    recipientEmail: string | null,
    shopName: string,
    // deferEmail: an unpaid ONLINE order does not email its codes yet; see
    // sendIssuedEmailForOrder.
    opts: { deferEmail?: boolean } = {},
  ) {
    const issued: { code: string; initialValue: number }[] = [];
    for (const line of lines) {
      for (let i = 0; i < line.quantity; i += 1) {
        const code = await this.generateUniqueCode(conn);
        await conn.query(
          `INSERT INTO giftcard (shopId, code, initialValue, remainingBalance, purchasedByCustomerId, purchaseOrderId, updatedAt, currency)
           VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT currency FROM shop WHERE id = ?))`,
          [shopId, code, line.amount, line.amount, customerId, orderId, new Date(), shopId],
        );
        issued.push({ code, initialValue: line.amount });
      }
    }
    if (recipientEmail && issued.length > 0 && !opts.deferEmail) {
      await this.enqueueIssuedEmail(
        shopId,
        orderId,
        recipientEmail,
        shopName,
        issued,
        conn,
      );
    }
    return issued;
  }

  // The "here are your gift card codes" email. Enqueued on the order transaction
  // when one is given (it then commits atomically with the cards), otherwise
  // directly (the deferred send after payment). One job per order (the key), so
  // sending it twice is harmless.
  private async enqueueIssuedEmail(
    shopId: number,
    orderId: number,
    recipientEmail: string,
    shopName: string,
    issued: { code: string; initialValue: number }[],
    tx?: PoolConnection,
  ) {
    const bodyLines = [
      `Thanks for your purchase from ${shopName}! Here ${issued.length === 1 ? 'is your gift card code' : 'are your gift card codes'}:`,
      '',
      ...issued.map((g) => `${g.code}: ${g.initialValue}`),
    ];
    const codeRows = issued
      .map(
        (g) =>
          `<tr><td style="padding:10px 16px;background-color:#f4f4f4;border-radius:6px;font-family:monospace;font-size:15px;color:#111111;">${escapeHtml(g.code)}</td><td style="padding:10px 16px;font-size:14px;color:#111111;text-align:right;">${escapeHtml(String(g.initialValue))}</td></tr><tr><td colspan="2" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>`,
      )
      .join('');
    const giftCardHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#111111;">Thanks for your purchase from ${escapeHtml(shopName)}! Here ${issued.length === 1 ? 'is your gift card code' : 'are your gift card codes'}:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${codeRows}</table>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 40px;text-align:center;">
<p style="margin:0 0 8px;font-size:12px;color:#999999;">This email was sent by ${escapeHtml(shopName)} via Requital.</p>
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
    // Enqueued via `conn` (not the plain injected db pool) so the job
    // row commits atomically with the gift cards it describes — if the
    // surrounding order-creation transaction rolls back, this job row
    // never exists to be sent either. Also moves what used to be a
    // synchronous Resend network call off the critical path of an
    // open DB transaction.
    await this.jobsService.enqueue(
      shopId,
      'send_email',
      {
        to: recipientEmail,
        subject: `Your ${shopName} gift card`,
        bodyText: bodyLines.join('\n'),
        html: giftCardHtml,
        fromName: shopName,
      },
      `gift-card-issued-email:${orderId}`,
      tx ? { tx } : {},
    );
  }

  // F8: gift cards sold by an ONLINE order are emailed only once the order is paid
  // (issueForOrder defers the email for them), so an unpaid or abandoned order never
  // leaks a working code. Called when the payment is recorded. Only cards still
  // active are included (a cancelled order's cards were voided), the recipient is
  // the order's own customerEmail, and the job key makes it once per order.
  async sendIssuedEmailForOrder(shopId: number, orderId: number) {
    // The cards are read FOR UPDATE and the job is enqueued on the same
    // transaction, so a cancel voiding them (which takes the same row locks) is
    // strictly before (no cards left to email) or after (it dismisses the pending
    // job): the email can never go out for a card that is no longer active.
    await this.db.transaction(async (conn) => {
      const [cards] = await conn.query<RowDataPacket[]>(
        `SELECT code, initialValue FROM giftcard
          WHERE purchaseOrderId = ? AND shopId = ? AND status = 'active'
          ORDER BY id FOR UPDATE`,
        [orderId, shopId],
      );
      if (cards.length === 0) return;
      const [orders] = await conn.query<RowDataPacket[]>(
        `SELECT o.customerEmail, s.name AS shopName
           FROM \`order\` o JOIN shop s ON s.id = o.shopId
          WHERE o.id = ? AND o.shopId = ?`,
        [orderId, shopId],
      );
      const email = orders[0]?.customerEmail as string | null | undefined;
      if (!email) return;
      await this.enqueueIssuedEmail(
        shopId,
        orderId,
        email,
        orders[0].shopName as string,
        cards.map((c) => ({
          code: c.code as string,
          initialValue: Number(trimDecimal(c.initialValue as string)),
        })),
        conn,
      );
    });
  }

  private async syncStatus(conn: PoolConnection, giftCardId: number) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT status, remainingBalance FROM giftcard WHERE id = ?`,
      [giftCardId],
    );
    const card = rows[0];
    if (!card) return;
    // Only ever flips between the two auto-managed states — a disabled or
    // expired card stays exactly as an admin/the expiry check left it.
    if (card.status !== 'active' && card.status !== 'redeemed') return;
    const nextStatus =
      Number(card.remainingBalance) <= 0 ? 'redeemed' : 'active';
    if (nextStatus !== card.status) {
      await conn.query(`UPDATE giftcard SET status = ?, updatedAt = ? WHERE id = ?`, [
        nextStatus,
        new Date(),
        giftCardId,
      ]);
    }
  }

  private async generateUniqueCode(
    runner: PoolConnection | Pool = this.db.pool,
  ): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateGiftCardCode();
      const [rows] = await runner.query<RowDataPacket[]>(
        `SELECT id FROM giftcard WHERE code = ?`,
        [code],
      );
      if (rows.length === 0) return code;
    }
    throw new ConflictException(
      'Could not generate a unique gift card code. Please try again',
    );
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private reject(reason: GiftCardRejectionReason): EvaluateGiftCardResult {
    return {
      valid: false,
      reason,
      message: GIFT_CARD_REJECTION_MESSAGES[reason],
    };
  }

  private async findRaw(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(GiftcardRow & RowDataPacket)[]>(
      `SELECT * FROM giftcard WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Gift card ${id} not found`);
    }
    return rows[0];
  }

  private async findByIdRaw(id: number) {
    const rows = await this.db.query<(GiftcardRow & RowDataPacket)[]>(
      `SELECT * FROM giftcard WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  private toResponse(card: GiftcardRow & { purchaserId?: number; purchaserName?: string }) {
    const { purchaserId, purchaserName, ...rest } = card;
    return {
      ...rest,
      initialValue: trimDecimal(card.initialValue),
      remainingBalance: trimDecimal(card.remainingBalance),
      purchasedByCustomer:
        purchaserId != null ? { id: purchaserId, name: purchaserName } : null,
    };
  }
}
