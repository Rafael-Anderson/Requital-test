import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sendEmail } from '../common/email';
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
  constructor(private readonly prisma: PrismaService) {}

  async findAll(ctx: TenantContext) {
    return this.prisma.giftcard.findMany({
      where: { shopId: ctx.shopId },
      orderBy: { id: 'desc' },
      include: { purchasedByCustomer: { select: { id: true, name: true } } },
    });
  }

  async findOne(ctx: TenantContext, id: number) {
    const card = await this.findRaw(ctx, id);
    return card;
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
    return this.prisma.giftcard.create({
      data: {
        shopId: ctx.shopId,
        code,
        initialValue: dto.initialValue,
        remainingBalance: dto.initialValue,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
  }

  async update(ctx: TenantContext, id: number, dto: UpdateGiftCardDto) {
    await this.findRaw(ctx, id);
    return this.prisma.giftcard.update({
      where: { id },
      data: {
        status: dto.status,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
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
    const card = await this.prisma.giftcard.findUnique({ where: { code } });
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
    return this.prisma.giftcard.findFirst({ where: { id, shopId } });
  }

  // Atomically draws down `amount` — CAS on remainingBalance, same
  // WHERE-guarded updateMany idiom as stock/discount. Must run inside the
  // same transaction that creates the order: if two concurrent checkouts
  // both validated the same card's balance a moment ago and only one can
  // actually be covered, the loser's CAS fails here and the whole order
  // attempt aborts, exactly like a discount's usage-limit race.
  async redeem(
    tx: Prisma.TransactionClient,
    giftCardId: number,
    amount: number,
    orderId: number,
  ) {
    const result = await tx.giftcard.updateMany({
      where: { id: giftCardId, remainingBalance: { gte: amount } },
      data: { remainingBalance: { decrement: amount } },
    });
    if (result.count === 0) {
      throw new ConflictException(
        "This gift card's balance just changed — please try again",
      );
    }
    await tx.giftcardredemption.create({
      data: { giftCardId, orderId, amountUsed: amount },
    });
    await this.syncStatus(tx, giftCardId);
  }

  // Credits a refund back onto the card's balance instead of a provider
  // refund — see ReturnsService, which computes the split. Never touches a
  // disabled/expired card's status (money still needs to land somewhere,
  // but a merchant-revoked or expired card doesn't get silently
  // reactivated by an unrelated refund) — only the automatic active<->
  // redeemed transition (syncStatus) applies here.
  async creditRefund(
    tx: Prisma.TransactionClient,
    giftCardId: number,
    amount: number,
  ) {
    await tx.giftcard.update({
      where: { id: giftCardId },
      data: { remainingBalance: { increment: amount } },
    });
    await this.syncStatus(tx, giftCardId);
  }

  // One unit issued per quantity — e.g. quantity 3 of a 200 AED gift card
  // product creates three independent 200-balance cards, each individually
  // redeemable (not one 600-balance card), matching how a shopper buying 3
  // physical gift cards would expect 3 separate codes to give to 3 different
  // people. Self-purchase only for this pass (see the task's own scope
  // note) — emails the code(s) to the purchaser's own order email, not a
  // separate recipient field.
  async issueForOrder(
    tx: Prisma.TransactionClient,
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
        const code = await this.generateUniqueCode(tx);
        await tx.giftcard.create({
          data: {
            shopId,
            code,
            initialValue: line.amount,
            remainingBalance: line.amount,
            purchasedByCustomerId: customerId ?? undefined,
            purchaseOrderId: orderId,
          },
        });
        issued.push({ code, initialValue: line.amount });
      }
    }
    if (recipientEmail && issued.length > 0) {
      const bodyLines = [
        `Thanks for your purchase from ${shopName}! Here ${issued.length === 1 ? 'is your gift card code' : 'are your gift card codes'}:`,
        '',
        ...issued.map((g) => `${g.code} — ${g.initialValue}`),
      ];
      await sendEmail(
        recipientEmail,
        `Your ${shopName} gift card`,
        bodyLines.join('\n'),
        { fromName: shopName },
      );
    }
    return issued;
  }

  private async syncStatus(tx: Prisma.TransactionClient, giftCardId: number) {
    const card = await tx.giftcard.findUnique({
      where: { id: giftCardId },
      select: { status: true, remainingBalance: true },
    });
    if (!card) return;
    // Only ever flips between the two auto-managed states — a disabled or
    // expired card stays exactly as an admin/the expiry check left it.
    if (card.status !== 'active' && card.status !== 'redeemed') return;
    const nextStatus =
      Number(card.remainingBalance) <= 0 ? 'redeemed' : 'active';
    if (nextStatus !== card.status) {
      await tx.giftcard.update({
        where: { id: giftCardId },
        data: { status: nextStatus },
      });
    }
  }

  private async generateUniqueCode(
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateGiftCardCode();
      const existing = await client.giftcard.findUnique({ where: { code } });
      if (!existing) return code;
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
    const card = await this.prisma.giftcard.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!card) {
      throw new NotFoundException(`Gift card ${id} not found`);
    }
    return card;
  }
}
