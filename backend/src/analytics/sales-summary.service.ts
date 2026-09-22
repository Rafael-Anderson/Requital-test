import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { escapeHtml } from '../common/email';
import { createLogger } from '../common/logging/logger';
import { dateKeyInTimezone } from '../outlets/outlet-status';
import { AnalyticsRollupService } from './analytics-rollup.service';

const logger = createLogger('SalesSummary');

// Fallback when a shop has no business hours configured for today. Late enough
// that a normal trading day is over, early enough to be the same evening.
const DEFAULT_CLOSE_TIME = '20:00';

// Weekly digest goes out on Monday, covering the seven days before it, so a
// merchant reads last week as a finished week rather than a partial one.
const WEEKLY_DIGEST_DAY = 1; // JS getUTCDay(): 0 = Sunday

interface DayTotals {
  orders: number;
  revenue: number;
  cogs: number | null;
  discount: number;
  delivery: number;
  tax: number;
  newCustomers: number;
  returningCustomers: number;
  linesWithoutCost: number;
}

function money(value: number): string {
  return `${value.toFixed(2)} AED`;
}

// Minutes since midnight, or null for anything that is not "HH:MM".
function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

// businessHours is a JSON column shaped { mon: { open, close, closed }, ... }.
// A closed day has no close time to fire at, so it yields null and the shop is
// simply skipped that day rather than emailed at an arbitrary hour.
export function resolveCloseMinutes(
  businessHours: unknown,
  dayIndex: number,
): number | null {
  if (!businessHours || typeof businessHours !== 'object') {
    return parseClock(DEFAULT_CLOSE_TIME);
  }
  const day = (businessHours as Record<string, unknown>)[DAY_KEYS[dayIndex]];
  if (!day || typeof day !== 'object') return parseClock(DEFAULT_CLOSE_TIME);
  const entry = day as { close?: unknown; closed?: unknown };
  if (entry.closed === true) return null;
  return (
    parseClock(typeof entry.close === 'string' ? entry.close : null) ??
    parseClock(DEFAULT_CLOSE_TIME)
  );
}

// Wall-clock minutes since midnight in a given timezone.
export function minutesInTimezone(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

@Injectable()
export class SalesSummaryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobsService: JobsService,
    private readonly schedulerService: SchedulerService,
    private readonly rollupService: AnalyticsRollupService,
  ) {}

  // Hourly rather than at one fixed time, because "shop close" is per shop and
  // per weekday - a single daily tick could only ever be right for one of them.
  // The lock is the same cross-instance guard every other sweep uses.
  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    await this.schedulerService.runLocked('sales-summary-sweep', 600, () =>
      this.runSweep(new Date()),
    );
  }

  // `now` is injectable so a test can drive a specific wall-clock moment rather
  // than waiting for one.
  async runSweep(now: Date): Promise<void> {
    const shops = await this.db.query<RowDataPacket[]>(
      `SELECT id, name, email, timezone, businessHours,
              notifyDailySalesSummary, notifyWeeklyDigest,
              dailySalesSummaryLastSentAt, weeklyDigestLastSentAt
         FROM shop
        WHERE notifyDailySalesSummary = true OR notifyWeeklyDigest = true`,
    );

    for (const shop of shops) {
      try {
        await this.considerShop(shop, now);
      } catch (err) {
        // One shop's bad data must not stop every later shop's email.
        logger.error('scheduled report failed for shop', {
          shopId: shop.id as number,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async considerShop(shop: RowDataPacket, now: Date): Promise<void> {
    const shopId = shop.id as number;
    const timezone = (shop.timezone as string | null) ?? 'Asia/Dubai';
    const today = dateKeyInTimezone(now, timezone);
    const localDayIndex = new Date(`${today}T00:00:00Z`).getUTCDay();

    if (shop.notifyDailySalesSummary) {
      const closeMinutes = resolveCloseMinutes(
        shop.businessHours,
        localDayIndex,
      );
      const sentAt = shop.dailySalesSummaryLastSentAt as Date | null;
      const alreadySentToday =
        sentAt !== null && dateKeyInTimezone(sentAt, timezone) === today;

      if (
        closeMinutes !== null &&
        !alreadySentToday &&
        minutesInTimezone(now, timezone) >= closeMinutes
      ) {
        await this.sendDailySummary(shopId, shop, today, now);
      }
    }

    if (shop.notifyWeeklyDigest && localDayIndex === WEEKLY_DIGEST_DAY) {
      const sentAt = shop.weeklyDigestLastSentAt as Date | null;
      const alreadySentToday =
        sentAt !== null && dateKeyInTimezone(sentAt, timezone) === today;
      if (!alreadySentToday) {
        await this.sendWeeklyDigest(shopId, shop, today, now);
      }
    }
  }

  // Rolls TODAY up on demand before reading it, which is the crux of this
  // feature. The nightly job computes YESTERDAY at 01:00, so at close time
  // today has no rollup row at all - querying the rollups without this would
  // email every merchant a summary of nothing. computeForShopDay is
  // delete-then-insert, so computing today early and again tonight is safe and
  // produces the same rows; if a late order lands after the email, tonight's
  // run simply corrects the stored figures.
  private async sendDailySummary(
    shopId: number,
    shop: RowDataPacket,
    date: string,
    now: Date,
  ): Promise<void> {
    await this.rollupService.computeForShopDay(shopId, date);
    const totals = await this.totalsForRange(shopId, date, date);
    const recipient = await this.resolveRecipient(shopId, shop);
    if (!recipient) return;

    const shopName = shop.name as string;
    const claimed = await this.claimSend(
      shopId,
      'dailySalesSummaryLastSentAt',
      now,
      date,
      (shop.timezone as string | null) ?? 'Asia/Dubai',
    );
    if (!claimed) return;

    const lines = this.summaryLines(totals);
    await this.jobsService.enqueue(
      shopId,
      'send_email',
      {
        to: recipient,
        subject: `${shopName}: sales summary for ${date}`,
        bodyText: [`Sales summary for ${date}`, '', ...lines].join('\n'),
        html: this.renderEmail(shopName, `Sales summary for ${date}`, totals),
        fromName: shopName,
      },
      `daily-sales-summary:${shopId}:${date}`,
    );
  }

  private async sendWeeklyDigest(
    shopId: number,
    shop: RowDataPacket,
    today: string,
    now: Date,
  ): Promise<void> {
    const from = shiftDate(today, -7);
    const to = shiftDate(today, -1);
    // The week being reported is already finished, so unlike the daily summary
    // there is nothing to roll up on demand - the nightly job has covered every
    // day in the range.
    const totals = await this.totalsForRange(shopId, from, to);
    const recipient = await this.resolveRecipient(shopId, shop);
    if (!recipient) return;

    const shopName = shop.name as string;
    const claimed = await this.claimSend(
      shopId,
      'weeklyDigestLastSentAt',
      now,
      today,
      (shop.timezone as string | null) ?? 'Asia/Dubai',
    );
    if (!claimed) return;

    const title = `Weekly digest, ${from} to ${to}`;
    await this.jobsService.enqueue(
      shopId,
      'send_email',
      {
        to: recipient,
        subject: `${shopName}: ${title.toLowerCase()}`,
        bodyText: [title, '', ...this.summaryLines(totals)].join('\n'),
        html: this.renderEmail(shopName, title, totals),
        fromName: shopName,
      },
      `weekly-digest:${shopId}:${today}`,
    );
  }

  // Queries the ROLLUPS, never order/orderitem - that is the point of ANL-1.
  private async totalsForRange(
    shopId: number,
    from: string,
    to: string,
  ): Promise<DayTotals> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(orders), 0) AS orders,
              COALESCE(SUM(revenue), 0) AS revenue,
              SUM(cogs) AS cogs,
              COALESCE(SUM(discount), 0) AS discount,
              COALESCE(SUM(delivery), 0) AS delivery,
              COALESCE(SUM(tax), 0) AS tax,
              COALESCE(SUM(newCustomers), 0) AS newCustomers,
              COALESCE(SUM(returningCustomers), 0) AS returningCustomers,
              COALESCE(SUM(linesWithoutCost), 0) AS linesWithoutCost
         FROM dailyshopmetrics
        WHERE shopId = ? AND \`date\` BETWEEN ? AND ?`,
      [shopId, from, to],
    );
    const r = rows[0];
    return {
      orders: Number(r.orders),
      revenue: Number(r.revenue),
      // SUM over a nullable column is NULL only when every row was NULL, which
      // is exactly "nothing in this range had a captured cost" - kept as null
      // rather than coalesced to 0 so the email can say "not recorded" instead
      // of implying a 100% margin.
      cogs: r.cogs === null ? null : Number(r.cogs),
      discount: Number(r.discount),
      delivery: Number(r.delivery),
      tax: Number(r.tax),
      newCustomers: Number(r.newCustomers),
      returningCustomers: Number(r.returningCustomers),
      linesWithoutCost: Number(r.linesWithoutCost),
    };
  }

  private summaryLines(t: DayTotals): string[] {
    const lines = [
      `Orders: ${t.orders}`,
      `Revenue: ${money(t.revenue)}`,
      t.cogs === null
        ? 'Cost of goods: not recorded'
        : `Cost of goods: ${money(t.cogs)}`,
      t.cogs === null
        ? 'Gross margin: not available without recorded costs'
        : `Gross margin: ${money(t.revenue - t.cogs)}`,
      `Discounts: ${money(t.discount)}`,
      `Delivery: ${money(t.delivery)}`,
      `Tax: ${money(t.tax)}`,
      `New customers: ${t.newCustomers}`,
      `Returning customers: ${t.returningCustomers}`,
    ];
    if (t.linesWithoutCost > 0) {
      lines.push(
        `Note: ${t.linesWithoutCost} order line${t.linesWithoutCost === 1 ? '' : 's'} had no recorded cost and ${t.linesWithoutCost === 1 ? 'is' : 'are'} excluded from the cost figure.`,
      );
    }
    return lines;
  }

  private renderEmail(
    shopName: string,
    title: string,
    t: DayTotals,
  ): string {
    const row = (label: string, value: string) =>
      `<tr><td style="padding:6px 0;font-size:14px;color:#111111;">${escapeHtml(label)}</td><td style="padding:6px 0;font-size:14px;color:#111111;text-align:right;">${escapeHtml(value)}</td></tr>`;
    const rows = [
      row('Orders', String(t.orders)),
      row('Revenue', money(t.revenue)),
      row('Cost of goods', t.cogs === null ? 'Not recorded' : money(t.cogs)),
      row(
        'Gross margin',
        t.cogs === null ? 'Not available' : money(t.revenue - t.cogs),
      ),
      row('Discounts', money(t.discount)),
      row('Delivery', money(t.delivery)),
      row('Tax', money(t.tax)),
      row('New customers', String(t.newCustomers)),
      row('Returning customers', String(t.returningCustomers)),
    ].join('');

    const caveat =
      t.linesWithoutCost > 0
        ? `<p style="margin:16px 0 0;font-size:12px;color:#999999;">${t.linesWithoutCost} order line${t.linesWithoutCost === 1 ? '' : 's'} had no recorded cost and ${t.linesWithoutCost === 1 ? 'is' : 'are'} excluded from the cost figure.</p>`
        : '';

    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#111111;">${escapeHtml(title)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;">${rows}</table>
${caveat}
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 40px;text-align:center;">
<p style="margin:0 0 8px;font-size:12px;color:#999999;">This email was sent by ${escapeHtml(shopName)} via Requital.</p>
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
  }

  // Compare-and-swap on the lastSentAt column, claimed BEFORE the email is
  // enqueued. Two instances racing the same tick (or a tick overlapping a slow
  // previous run) both reach here; only one UPDATE matches, and the loser
  // returns without enqueueing. The job's own idempotency key is the second
  // guard, at the queue rather than at the decision.
  private async claimSend(
    shopId: number,
    column: 'dailySalesSummaryLastSentAt' | 'weeklyDigestLastSentAt',
    now: Date,
    dateKey: string,
    timezone: string,
  ): Promise<boolean> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT ${column} AS sentAt FROM shop WHERE id = ?`,
      [shopId],
    );
    const sentAt = rows[0]?.sentAt as Date | null;
    if (sentAt !== null && dateKeyInTimezone(sentAt, timezone) === dateKey) {
      return false;
    }
    const result = await this.db.execute(
      `UPDATE shop SET ${column} = ?
        WHERE id = ? AND (${column} IS NULL OR ${column} <=> ?)`,
      [now, shopId, sentAt],
    );
    return result.affectedRows === 1;
  }

  private async resolveRecipient(
    shopId: number,
    shop: RowDataPacket,
  ): Promise<string | null> {
    const shopEmail = shop.email as string | null;
    if (shopEmail) return shopEmail;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT email FROM user
        WHERE shopId = ? AND role = 'admin'
        ORDER BY id
        LIMIT 1`,
      [shopId],
    );
    return (rows[0]?.email as string | null) ?? null;
  }
}

function shiftDate(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
