import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { createLogger } from '../../common/logging/logger';
import { PaymentsService } from '../payments.service';
import { PaymentSettingsService } from '../payment-settings.service';
import type { NomodcheckoutRow } from '../../db/types';
import { NomodPaymentService } from './nomod-payment.service';

const logger = createLogger('NomodConfirmService');

// A return page is NOT proof of payment. When a shopper lands back on the
// confirmation page the page asks the server, and the server asks Nomod
// (GET /v1/checkout/{id}); a webhook may arrive first or later, and both end in the
// same single, idempotent applyPaid below.

// Nomod is asked at most this often per checkout, however many tabs poll.
const CONFIRM_MIN_INTERVAL_SECONDS = 4;

export type ConfirmOutcome =
  'paid' | 'unpaid' | 'closed' | 'review' | 'skipped';

@Injectable()
export class NomodConfirmService {
  constructor(
    private readonly db: DatabaseService,
    private readonly payments: NomodPaymentService,
    private readonly paymentsService: PaymentsService,
    private readonly settings: PaymentSettingsService,
  ) {}

  // THE one place a Nomod payment is applied to an order. Keyed by the checkout id,
  // so the webhook, the return-page confirmation and a replay all collide on the
  // unique (gateway, gatewayReference) index and the order is marked paid, its
  // stock reserved and its emails queued exactly once.
  async applyPaid(
    row: NomodcheckoutRow,
    chargeId?: string | null,
  ): Promise<void> {
    const chargeReference = row.checkoutId ?? chargeId ?? undefined;
    await this.paymentsService.applyWebhookResult(
      'nomod',
      'nomod',
      {
        providerReference: `nomod:${row.shopId}:paid:${row.checkoutId ?? row.referenceId}`,
        orderId: row.orderId,
        status: 'paid',
        chargeReference,
        // As Stripe: a paid card order is confirmed (and so reserves stock) without
        // waiting for a human. Only acts while the order is still pending.
        advanceOrderStatus: 'confirmed',
      },
      row.shopId,
    );
    await this.db.execute(
      `UPDATE nomodcheckout SET status = 'paid', chargeId = COALESCE(?, chargeId) WHERE id = ? AND shopId = ?`,
      [chargeId ?? null, row.id, row.shopId],
    );
  }

  // Records a payment that failed or was cancelled on Nomod's page. The order stays
  // unpaid so the shopper can pay again with a fresh checkout.
  async applyFailed(
    row: NomodcheckoutRow,
    eventId: string,
    status: 'failed' | 'cancelled',
  ): Promise<void> {
    await this.paymentsService.applyWebhookResult(
      'nomod',
      'nomod',
      {
        providerReference: `nomod:${row.shopId}:${status}:${eventId}`,
        orderId: row.orderId,
        status: 'failed',
      },
      row.shopId,
    );
    await this.db.execute(
      `UPDATE nomodcheckout SET status = ? WHERE id = ? AND shopId = ? AND status NOT IN ('paid', 'review')`,
      [status, row.id, row.shopId],
    );
  }

  // Confirms ONE checkout against Nomod. Never throws on a Nomod failure (the page
  // keeps polling and the sweep is the backstop).
  async confirmCheckout(row: NomodcheckoutRow): Promise<ConfirmOutcome> {
    if (!row.checkoutId) return 'skipped';
    // Compare-and-swap on the per-checkout timer: only one caller asks per interval.
    const claim = await this.db.execute(
      `UPDATE nomodcheckout SET lastCheckedAt = NOW(3)
        WHERE id = ? AND shopId = ?
          AND (lastCheckedAt IS NULL OR lastCheckedAt < NOW(3) - INTERVAL ${CONFIRM_MIN_INTERVAL_SECONDS} SECOND)`,
      [row.id, row.shopId],
    );
    if (claim.affectedRows !== 1) return 'skipped';
    try {
      const credentials = await this.settings.resolveCredentials(
        row.shopId,
        'nomod',
      );
      const verdict = await this.payments.inspect(row, credentials);
      switch (verdict.kind) {
        case 'paid':
          await this.applyPaid(row);
          return 'paid';
        case 'expired':
        case 'cancelled':
          await this.db.execute(
            `UPDATE nomodcheckout SET status = ? WHERE id = ? AND shopId = ? AND status NOT IN ('paid', 'review')`,
            [verdict.kind, row.id, row.shopId],
          );
          return 'closed';
        case 'review':
          return 'review';
        default:
          return 'unpaid';
      }
    } catch (err) {
      logger.warn('nomod confirmation failed', {
        orderId: row.orderId,
        shopId: row.shopId,
        error: err instanceof Error ? err.name : 'non-error',
      });
      return 'unpaid';
    }
  }

  // Called when a shopper's confirmation page polls an unpaid online order. The
  // order id comes from a verified tracking token, so the shop is read off the order
  // row. Returns true when the order's payment state changed.
  async confirmForOrder(orderId: number): Promise<boolean> {
    const rows = await this.db.query<(NomodcheckoutRow & RowDataPacket)[]>(
      `SELECT c.* FROM nomodcheckout c
         JOIN \`order\` o ON o.id = c.orderId AND o.shopId = c.shopId
        WHERE c.orderId = ? AND o.paymentStatus = 'unpaid' AND o.status <> 'cancelled'
          AND c.checkoutId IS NOT NULL AND c.status IN ('created', 'creating', 'failed', 'cancelled')
        ORDER BY c.id DESC LIMIT 2`,
      [orderId],
    );
    let changed = false;
    for (const row of rows) {
      if ((await this.confirmCheckout(row)) === 'paid') changed = true;
    }
    return changed;
  }
}
