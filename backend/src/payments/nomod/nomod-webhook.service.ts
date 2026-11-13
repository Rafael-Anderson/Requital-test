import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { createLogger } from '../../common/logging/logger';
import { resolveErrorTrackingProvider } from '../../common/error-tracking/error-tracking.provider';
import { WebhookLogService } from '../../webhook-log/webhook-log.service';
import { OrderNotificationsService } from '../../orders/order-notifications.service';
import { PaymentSettingsService } from '../payment-settings.service';
import type { NomodcheckoutRow } from '../../db/types';
import { NomodConfirmService } from './nomod-confirm.service';
import {
  NomodPaymentService,
  verifyObservedPayment,
} from './nomod-payment.service';
import { parseNomodEvent, type NomodEvent } from './nomod-events';
import { decimalToMinor } from '../../drivers/cash';
import { pickWebhookHeaders, verifyStandardWebhook } from './nomod-signature';

const logger = createLogger('NomodWebhookService');

// 64 hex characters: 32 random bytes (see NomodAdminService.ensureWebhookToken).
export const NOMOD_WEBHOOK_TOKEN_SHAPE = /^[0-9a-f]{64}$/;

@Injectable()
export class NomodWebhookService {
  constructor(
    private readonly db: DatabaseService,
    private readonly settings: PaymentSettingsService,
    private readonly payments: NomodPaymentService,
    private readonly confirm: NomodConfirmService,
    private readonly webhookLog: WebhookLogService,
    private readonly notifications: OrderNotificationsService,
  ) {}

  // One delivery. The SHOP comes only from the token in the URL (never from the
  // payload), the body is verified against that shop's own signing secret, every
  // event is recorded once by eventId, and an event is only ever applied to an order
  // reached through THAT shop's own checkout rows.
  //
  // Answers 200 once the event is durably recorded and handled. A failure while
  // handling throws (a 5xx), which makes Nomod retry; the event row is still
  // unprocessed then, so the retry is handled, not swallowed as a duplicate.
  async handle(
    token: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | undefined,
  ): Promise<{ received: true }> {
    // Unknown or malformed token: one uniform 404, with no query for a bad shape.
    if (typeof token !== 'string' || !NOMOD_WEBHOOK_TOKEN_SHAPE.test(token)) {
      throw new NotFoundException();
    }
    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT shopId FROM shoppaymentprovider WHERE provider = 'nomod' AND webhookToken = ?`,
      [token],
    );
    const shopId = shopRows[0]?.shopId as number | undefined;
    if (!shopId) throw new NotFoundException();

    const credentials = await this.settings.resolveCredentials(shopId, 'nomod');
    const secret = credentials?.webhookSecret?.trim();
    if (!secret || !rawBody) {
      await this.webhookLog.log(shopId, 'nomod', 'unconfigured', 'rejected');
      throw new UnauthorizedException();
    }
    const verdict = verifyStandardWebhook({
      headers: pickWebhookHeaders(headers),
      rawBody,
      secret,
    });
    if (!verdict.ok) {
      // The reason is a fixed code, never the signature or any header value.
      logger.warn('nomod webhook rejected', { shopId, reason: verdict.reason });
      await this.webhookLog.log(shopId, 'nomod', verdict.reason, 'rejected');
      throw new UnauthorizedException();
    }

    const event = parseNomodEvent(rawBody);
    if (!event) {
      await this.webhookLog.log(shopId, 'nomod', 'unparsable', 'rejected');
      return { received: true };
    }

    // Durable record BEFORE any work. INSERT IGNORE: exactly one delivery of an
    // eventId inserts; the others see an existing row.
    const inserted = await this.db.execute(
      `INSERT IGNORE INTO nomodwebhookevent (shopId, eventId, eventType, objectId)
       VALUES (?, ?, ?, ?)`,
      [shopId, event.eventId, event.type.slice(0, 64), event.objectId],
    );
    if (inserted.affectedRows !== 1) {
      const prior = await this.db.query<RowDataPacket[]>(
        `SELECT processedAt FROM nomodwebhookevent WHERE shopId = ? AND eventId = ?`,
        [shopId, event.eventId],
      );
      if (prior[0]?.processedAt) {
        await this.webhookLog.log(shopId, 'nomod', event.type, 'duplicate');
        return { received: true };
      }
      // Recorded earlier but never finished (the process died or a step failed):
      // handle it now. Everything below is idempotent.
    }

    let outcome: string;
    let orderId: number | null = null;
    try {
      const result = await this.dispatch(shopId, event);
      outcome = result.outcome;
      orderId = result.orderId;
    } catch (err) {
      logger.error('nomod webhook handling failed', {
        shopId,
        eventType: event.type,
        error: err instanceof Error ? err.name : 'non-error',
      });
      await this.webhookLog.log(shopId, 'nomod', event.type, 'failed');
      throw err;
    }
    await this.db.execute(
      `UPDATE nomodwebhookevent SET processedAt = NOW(3), outcome = ?, orderId = ?
        WHERE shopId = ? AND eventId = ?`,
      [outcome.slice(0, 40), orderId, shopId, event.eventId],
    );
    return { received: true };
  }

  private async dispatch(
    shopId: number,
    event: NomodEvent,
  ): Promise<{ outcome: string; orderId: number | null }> {
    switch (event.type) {
      case 'charge.completed':
        return this.onCompleted(shopId, event);
      case 'charge.failed':
        return this.onFailed(shopId, event, 'failed');
      case 'charge.cancelled':
        return this.onFailed(shopId, event, 'cancelled');
      case 'charge.refunded':
      case 'charge.partially_refunded':
        return this.onRefunded(shopId, event);
      case 'charge.dispute.created':
        return this.onDispute(shopId, event);
      case 'charge.created':
      case 'charge.authorised':
        await this.webhookLog.log(shopId, 'nomod', event.type, 'success');
        return { outcome: 'noted', orderId: null };
      default:
        // An event type we do not know: acknowledged and ignored.
        await this.webhookLog.log(shopId, 'nomod', event.type, 'success');
        return { outcome: 'ignored_type', orderId: null };
    }
  }

  // The row this event is about, found ONLY inside this shop.
  private async rowFor(
    shopId: number,
    event: NomodEvent,
  ): Promise<NomodcheckoutRow | null> {
    if (!event.referenceId) {
      logger.warn('nomod event without a reference', {
        shopId,
        eventType: event.type,
        missing: event.missing,
      });
      return null;
    }
    return this.payments.findByReference(shopId, event.referenceId);
  }

  private async onCompleted(shopId: number, event: NomodEvent) {
    const row = await this.rowFor(shopId, event);
    if (!row) {
      await this.webhookLog.log(shopId, 'nomod', event.type, 'rejected');
      return { outcome: 'unknown_reference', orderId: null };
    }
    const order = await this.payments.loadOrderForVerification(
      shopId,
      row.orderId,
    );
    if (!order) return { outcome: 'unknown_order', orderId: null };

    if (event.totalMinor === null || !event.currency) {
      // The event did not carry what we must verify: ask Nomod for the checkout
      // instead of guessing (a failure here propagates, so Nomod retries).
      logger.warn('nomod completed event missing fields, confirming by GET', {
        shopId,
        orderId: row.orderId,
        missing: event.missing,
      });
      const credentials = await this.settings.resolveCredentials(
        shopId,
        'nomod',
      );
      const verdict = await this.payments.inspect(row, credentials);
      if (verdict.kind === 'paid') {
        await this.confirm.applyPaid(row, event.objectId);
        return { outcome: 'paid_via_get', orderId: row.orderId };
      }
      return {
        outcome: verdict.kind === 'review' ? 'review' : 'not_paid_on_get',
        orderId: row.orderId,
      };
    }

    const check = verifyObservedPayment(row, order, {
      currency: event.currency,
      totalMinor: event.totalMinor,
    });
    if (!check.ok) {
      await this.payments.markReview(row, check.reason);
      await this.webhookLog.log(shopId, 'nomod', event.type, 'rejected');
      return {
        outcome: `review:${check.reason}`.slice(0, 40),
        orderId: row.orderId,
      };
    }
    await this.confirm.applyPaid(row, event.objectId);
    return { outcome: 'paid', orderId: row.orderId };
  }

  private async onFailed(
    shopId: number,
    event: NomodEvent,
    kind: 'failed' | 'cancelled',
  ) {
    const row = await this.rowFor(shopId, event);
    if (!row) {
      await this.webhookLog.log(shopId, 'nomod', event.type, 'rejected');
      return { outcome: 'unknown_reference', orderId: null };
    }
    // A failure event for a checkout that is already PAID is stale: never undone.
    if (row.status === 'paid') {
      return { outcome: 'stale_after_paid', orderId: row.orderId };
    }
    await this.confirm.applyFailed(row, event.eventId, kind);
    return { outcome: kind, orderId: row.orderId };
  }

  // charge.refunded / charge.partially_refunded: records how much Nomod says has been
  // refunded and settles our own pending refunds that it now covers. It never
  // changes an order's payment or fulfilment status on its own: a refund started in
  // the Nomod dashboard is recorded here for the merchant to see, and a refund
  // started by us already has its return record.
  private async onRefunded(shopId: number, event: NomodEvent) {
    const row = await this.rowFor(shopId, event);
    if (!row) {
      await this.webhookLog.log(shopId, 'nomod', event.type, 'rejected');
      return { outcome: 'unknown_reference', orderId: null };
    }
    if (event.refundTotalMinor === null) {
      logger.warn('nomod refund event without a readable refundTotal', {
        shopId,
        orderId: row.orderId,
        missing: event.missing,
      });
      await this.webhookLog.log(shopId, 'nomod', event.type, 'success');
      return { outcome: 'refund_unreadable', orderId: row.orderId };
    }
    // Only ever moves up: an older event arriving late must not lower the total.
    await this.db.execute(
      `UPDATE nomodcheckout SET refundedMinor = GREATEST(refundedMinor, ?) WHERE id = ? AND shopId = ?`,
      [event.refundTotalMinor, row.id, shopId],
    );
    await this.settlePendingRefunds(row, event.refundTotalMinor);
    await this.webhookLog.log(shopId, 'nomod', event.type, 'success');
    return { outcome: 'refund_recorded', orderId: row.orderId };
  }

  // Marks this order's provider refunds that are still 'pending' as 'completed',
  // oldest first, while the total Nomod reports covers them.
  private async settlePendingRefunds(
    row: NomodcheckoutRow,
    refundedMinor: number,
  ) {
    const returns = await this.db.query<RowDataPacket[]>(
      `SELECT r.id, r.providerRefundStatus, r.refundAmount, r.giftCardRefundAmount,
              r.storeCreditRefundAmount, o.currency
         FROM orderreturn r JOIN \`order\` o ON o.id = r.orderId
        WHERE r.orderId = ? AND o.shopId = ? AND r.refundMethod = 'provider'
          AND r.providerRefundStatus IN ('pending', 'completed')
        ORDER BY r.id ASC`,
      [row.orderId, row.shopId],
    );
    let covered = 0;
    for (const r of returns) {
      const currency = r.currency as string;
      // The slice of the refund that went to the gateway: total less the gift card
      // and store credit shares (exact decimal parsing, minor units).
      const minor =
        (decimalToMinor(String(r.refundAmount), currency) ?? 0) -
        (decimalToMinor(String(r.giftCardRefundAmount), currency) ?? 0) -
        (decimalToMinor(String(r.storeCreditRefundAmount), currency) ?? 0);
      if (r.providerRefundStatus === 'completed') {
        covered += minor;
        continue;
      }
      if (covered + minor <= refundedMinor) {
        covered += minor;
        await this.db.execute(
          `UPDATE orderreturn SET providerRefundStatus = 'completed'
            WHERE id = ? AND providerRefundStatus = 'pending'`,
          [r.id as number],
        );
      }
    }
  }

  private async onDispute(shopId: number, event: NomodEvent) {
    const row = await this.rowFor(shopId, event);
    if (!row) {
      await this.webhookLog.log(shopId, 'nomod', event.type, 'rejected');
      return { outcome: 'unknown_reference', orderId: null };
    }
    await this.db.execute(
      `UPDATE nomodcheckout SET disputedAt = COALESCE(disputedAt, NOW(3)) WHERE id = ? AND shopId = ?`,
      [row.id, shopId],
    );
    logger.error('nomod dispute opened on an order', {
      orderId: row.orderId,
      shopId,
    });
    try {
      resolveErrorTrackingProvider().captureException(
        new Error('payment dispute opened'),
        { shopId, route: 'payment webhook nomod' },
      );
    } catch {
      // never fail the webhook over error tracking
    }
    await this.notifications
      .alertPaymentDispute(shopId, row.orderId)
      .catch(() => undefined);
    await this.webhookLog.log(shopId, 'nomod', event.type, 'success');
    return { outcome: 'dispute_flagged', orderId: row.orderId };
  }
}
