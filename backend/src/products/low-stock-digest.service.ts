import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import { JobsService } from '../jobs/jobs.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { buildVariantLabel } from './variant-generator';
import { escapeHtml } from '../common/email';

interface LowStockLine {
  label: string;
  outletName: string;
  stockQuantity: number;
  lowStockThreshold: number;
}

// Scheduled daily summary — explicitly NOT real-time per-item email (see
// the Low Stock Alerts task's own scope note). Runs once a day for every
// shop that has opted in; lastSentAt is a per-shop CAS guard (claimed via
// an UPDATE ... WHERE checking affectedRows, same discipline as
// AbandonedCartsService) so an overlapping or re-triggered run can never
// double-send for the same shop on the same day, and a shop that hasn't
// opted in never gets queried at all.
@Injectable()
export class LowStockDigestService {
  constructor(
    private readonly db: DatabaseService,
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
    const candidates = await this.db.query<RowDataPacket[]>(
      `SELECT id, name, email, lowStockDigestLastSentAt FROM shop WHERE notifyLowStockDigest = true`,
    );

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    for (const shop of candidates) {
      const lastSentAt = shop.lowStockDigestLastSentAt as Date | null;
      if (lastSentAt && lastSentAt >= startOfToday) {
        continue; // already sent today
      }
      await this.sendForShop(
        shop.id as number,
        shop.name as string,
        shop.email as string | null,
        startOfToday,
      );
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
    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT notifyLowStockDigest FROM shop WHERE id = ?`,
      [shopId],
    );
    if (!shopRows[0]?.notifyLowStockDigest) return false;

    // CAS claim FIRST, before doing any query work — mirrors
    // AbandonedCartsService's claim-before-send discipline: if two
    // triggers for the same shop race, only one UPDATE can match
    // (lastSentAt is still before today), the other gets affectedRows 0
    // and skips.
    const claimed = await this.db.execute(
      `UPDATE shop SET lowStockDigestLastSentAt = ?
       WHERE id = ? AND notifyLowStockDigest = true
         AND (lowStockDigestLastSentAt IS NULL OR lowStockDigestLastSentAt < ?)`,
      [new Date(), shopId, startOfToday],
    );
    if (claimed.affectedRows === 0) return false;

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
    const lineRows = lines
      .map(
        (l) =>
          `<tr><td style="padding:6px 0;font-size:14px;color:#111111;">${escapeHtml(l.label)} @ ${escapeHtml(l.outletName)}</td><td style="padding:6px 0;font-size:14px;color:#111111;text-align:right;">${l.stockQuantity} left (threshold ${l.lowStockThreshold})</td></tr>`,
      )
      .join('');
    const digestHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#111111;">${lines.length} item${lines.length === 1 ? ' is' : 's are'} at or below ${lines.length === 1 ? 'its' : 'their'} reorder threshold:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;">${lineRows}</table>
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
        to: recipient,
        subject: `${shopName}: ${lines.length} low-stock item${lines.length === 1 ? '' : 's'}`,
        bodyText,
        html: digestHtml,
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
  // A shadow-backed product/variant's row resolves its label through
  // ingredient.shadowProduct/shadowVariant; a real merchant-created
  // ingredient (both null) uses its own name.
  private async collectLowStockLines(shopId: number): Promise<LowStockLine[]> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT ois.stockQuantity, ois.lowStockThreshold, o.name AS outletName,
              ing.name AS ingredientName,
              sp.name AS shadowProductName,
              svp.name AS shadowVariantProductName,
              ov1.value AS optionValue1, ov2.value AS optionValue2, ov3.value AS optionValue3
       FROM outletingredientstock ois
       JOIN outlet o ON o.id = ois.outletId
       JOIN ingredient ing ON ing.id = ois.ingredientId
       LEFT JOIN product sp ON sp.id = ing.shadowProductId
       LEFT JOIN productvariant sv ON sv.id = ing.shadowVariantId
       LEFT JOIN product svp ON svp.id = sv.productId
       LEFT JOIN productoptionvalue ov1 ON ov1.id = sv.optionValue1Id
       LEFT JOIN productoptionvalue ov2 ON ov2.id = sv.optionValue2Id
       LEFT JOIN productoptionvalue ov3 ON ov3.id = sv.optionValue3Id
       WHERE ois.lowStockThreshold IS NOT NULL AND ing.shopId = ?`,
      [shopId],
    );

    const lines: LowStockLine[] = [];
    for (const row of rows) {
      const lowStockThreshold = row.lowStockThreshold as number | null;
      const stockQuantity = row.stockQuantity as number;
      if (lowStockThreshold === null || stockQuantity > lowStockThreshold) {
        continue;
      }
      let label: string;
      if (row.shadowVariantProductName) {
        const variantLabel = buildVariantLabel([
          row.optionValue1 as string | undefined,
          row.optionValue2 as string | undefined,
          row.optionValue3 as string | undefined,
        ]);
        label = variantLabel
          ? `${row.shadowVariantProductName as string} (${variantLabel})`
          : (row.shadowVariantProductName as string);
      } else if (row.shadowProductName) {
        label = row.shadowProductName as string;
      } else {
        label = row.ingredientName as string;
      }
      lines.push({
        label,
        outletName: row.outletName as string,
        stockQuantity,
        lowStockThreshold,
      });
    }
    return lines;
  }

  private async resolveAdminEmail(shopId: number): Promise<string | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT email FROM user WHERE shopId = ? AND role = ? ORDER BY id ASC LIMIT 1`,
      [shopId, 'admin'],
    );
    return (rows[0]?.email as string | undefined) ?? null;
  }
}
