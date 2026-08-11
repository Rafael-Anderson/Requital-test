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
      `INSERT INTO giftcard (shopId, code, initialValue, remainingBalance, expiresAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        ctx.shopId,
        code,
        dto.initialValue,
        dto.initialValue,
        dto.expiresAt ? new Date(dto.expiresAt) : null,
        new Date(),
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
        "This gift card's balance just changed — please try again",
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
  ) {
    const issued: { code: string; initialValue: number }[] = [];
    for (const line of lines) {
      for (let i = 0; i < line.quantity; i += 1) {
        const code = await this.generateUniqueCode(conn);
        await conn.query(
          `INSERT INTO giftcard (shopId, code, initialValue, remainingBalance, purchasedByCustomerId, purchaseOrderId, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [shopId, code, line.amount, line.amount, customerId, orderId, new Date()],
        );
        issued.push({ code, initialValue: line.amount });
      }
    }
    if (recipientEmail && issued.length > 0) {
      const bodyLines = [
        `Thanks for your purchase from ${shopName}! Here ${issued.length === 1 ? 'is your gift card code' : 'are your gift card codes'}:`,
        '',
        ...issued.map((g) => `${g.code} — ${g.initialValue}`),
      ];
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
          fromName: shopName,
        },
        `gift-card-issued-email:${orderId}`,
        { tx: conn },
      );
    }
    return issued;
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
      'Could not generate a unique gift card code — please try again',
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
