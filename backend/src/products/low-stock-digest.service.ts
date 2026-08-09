import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { buildVariantLabel } from './variant-generator';

interface LowStockLine {
  label: string;
  outletName: string;
  stockQuantity: number;
  lowStockThreshold: number;
}

// Scheduled daily summary — explicitly NOT real-time per-item email (see
// the Low Stock Alerts task's own scope note). Runs once a day for every
// shop that has opted in; lastSentAt is a per-shop CAS guard (claimed via
// updateMany, same discipline as AbandonedCartsService) so an overlapping
// or re-triggered run can never double-send for the same shop on the same
// day, and a shop that hasn't opted in never gets queried at all.
@Injectable()
export class LowStockDigestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
    private readonly schedulerService: SchedulerService,
  ) {}

  // Wrapped in the cross-instance advisory lock (see SchedulerService) so
  // only one app instance actually runs the sweep body per tick — the
  // per-shop CAS claim inside sendForShop already made double-*sending*
  // impossible, but without this lock every instance would still redundantly
  // query every opted-in shop's stock on every tick.
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async sendDueDigests() {
    await this.schedulerService.runLocked(
      'low-stock-digest-sweep',
      600,
      () => this.runSweep(),
    );
  }

  private async runSweep() {
    const candidates = await this.prisma.shop.findMany({
      where: { notifyLowStockDigest: true },
      select: {
        id: true,
        name: true,
        email: true,
        lowStockDigestLastSentAt: true,
      },
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    for (const shop of candidates) {
      if (
        shop.lowStockDigestLastSentAt &&
        shop.lowStockDigestLastSentAt >= startOfToday
      ) {
        continue; // already sent today
      }
      await this.sendForShop(shop.id, shop.name, shop.email, startOfToday);
    }
  }

  // Split out so tests (and a future "send now" admin action) can trigger
  // one shop's digest directly, without waiting for the cron tick — checks
  // the opt-in toggle itself (not just relying on sendDueDigests' own
  // pre-filter) so it's correct no matter how it's called.
  async sendForShop(
    shopId: number,
    shopName: string,
    shopEmail: string | null,
    startOfToday: Date,
  ) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { notifyLowStockDigest: true },
    });
    if (!shop?.notifyLowStockDigest) return false;

    // CAS claim FIRST, before doing any query work — mirrors
    // AbandonedCartsService's claim-before-send discipline: if two
    // triggers for the same shop race, only one updateMany can match
    // (lastSentAt is still before today), the other gets count 0 and skips.
    const claimed = await this.prisma.shop.updateMany({
      where: {
        id: shopId,
        notifyLowStockDigest: true,
        OR: [
          { lowStockDigestLastSentAt: null },
          { lowStockDigestLastSentAt: { lt: startOfToday } },
        ],
      },
      data: { lowStockDigestLastSentAt: new Date() },
    });
    if (claimed.count === 0) return false;

    const lines = await this.collectLowStockLines(shopId);
    if (lines.length === 0) return false; // claimed the send-slot, but nothing to report — no empty email

    const recipient = shopEmail ?? (await this.resolveAdminEmail(shopId));
    if (!recipient) return false;

    const bodyText = [
      `${lines.length} item${lines.length === 1 ? ' is' : 's are'} at or below its reorder threshold:`,
      '',
      ...lines.map(
        (l) =>
          `- ${l.label} @ ${l.outletName}: ${l.stockQuantity} left (threshold ${l.lowStockThreshold})`,
      ),
    ].join('\n');
    await this.jobsService.enqueue(
      shopId,
      'send_email',
      {
        to: recipient,
        subject: `${shopName}: ${lines.length} low-stock item${lines.length === 1 ? '' : 's'}`,
        bodyText,
        fromName: shopName,
      },
      `low-stock-digest-email:${shopId}:${startOfToday.toISOString().slice(0, 10)}`,
    );
    return true;
  }

  // Live query against current stock — not a persisted "flagged" event log.
  // The check that matters (crossing at-or-below the threshold) happens
  // implicitly on every read, since stockQuantity is always current: any
  // stock-decreasing operation (order placement, adjustment, transfer-out)
  // already updates this same column, so there's nothing separate to hook
  // — a background poll re-deriving the same comparison on a schedule
  // (this digest) is correct without also needing a write-time side effect.
  // Phase A: a single query against outletingredientstock — the only stock
  // table now — replaces the three parallel product/variant/ingredient
  // queries this used before. A shadow-backed product/variant's row
  // resolves its label through ingredient.shadowProduct/shadowVariant; a
  // real merchant-created ingredient (both null) uses its own name.
  private async collectLowStockLines(shopId: number): Promise<LowStockLine[]> {
    const rows = await this.prisma.outletingredientstock.findMany({
      where: { lowStockThreshold: { not: null }, ingredient: { shopId } },
      select: {
        stockQuantity: true,
        lowStockThreshold: true,
        outlet: { select: { name: true } },
        ingredient: {
          select: {
            name: true,
            shadowProduct: { select: { name: true } },
            shadowVariant: {
              select: {
                product: { select: { name: true } },
                optionValue1: { select: { value: true } },
                optionValue2: { select: { value: true } },
                optionValue3: { select: { value: true } },
              },
            },
          },
        },
      },
    });

    const lines: LowStockLine[] = [];
    for (const row of rows) {
      if (
        row.lowStockThreshold === null ||
        row.stockQuantity > row.lowStockThreshold
      ) {
        continue;
      }
      let label: string;
      if (row.ingredient.shadowVariant) {
        const variantLabel = buildVariantLabel([
          row.ingredient.shadowVariant.optionValue1?.value,
          row.ingredient.shadowVariant.optionValue2?.value,
          row.ingredient.shadowVariant.optionValue3?.value,
        ]);
        label = variantLabel
          ? `${row.ingredient.shadowVariant.product.name} (${variantLabel})`
          : row.ingredient.shadowVariant.product.name;
      } else if (row.ingredient.shadowProduct) {
        label = row.ingredient.shadowProduct.name;
      } else {
        label = row.ingredient.name;
      }
      lines.push({
        label,
        outletName: row.outlet.name,
        stockQuantity: row.stockQuantity,
        lowStockThreshold: row.lowStockThreshold,
      });
    }
    return lines;
  }

  private async resolveAdminEmail(shopId: number): Promise<string | null> {
    const admin = await this.prisma.user.findFirst({
      where: { shopId, role: 'admin' },
      orderBy: { id: 'asc' },
      select: { email: true },
    });
    return admin?.email ?? null;
  }
}
