import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { createLogger } from '../common/logging/logger';
import { PaymentsService } from './payments.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentSettingsService } from './payment-settings.service';

const logger = createLogger('PaymentReconciliation');

// How long a payment gets to arrive by webhook before the sweep goes and asks.
// Stripe normally delivers in seconds and retries for hours, so 20 minutes is
// comfortably past "just slow" while still being the same shift the merchant is
// working. Shorter would race a delivery that was going to succeed anyway;
// longer leaves a paid order looking unpaid for no benefit.
export const RECONCILE_AFTER_MINUTES = 20;

// Upper bound on how far back to look. Without it the candidate set grows
// forever: every order a customer abandoned at the payment step stays unpaid
// with a session id attached, and the sweep would re-poll all of them nightly
// for the life of the platform. A session Stripe has expired is never going to
// become paid, and 7 days is well past any provider's own retry window.
export const RECONCILE_WINDOW_DAYS = 7;

// Per-tick cap, so one sweep cannot spend unbounded time in outbound API calls
// (each candidate is a network round trip to the gateway). A backlog simply
// drains across subsequent ticks.
export const MAX_PER_TICK = 50;

// Recheck backoff, by the order's age. The sweep used to have no memory of
// having asked, so the 50 OLDEST unpaid orders in the window were re-polled
// every tick and a paid order behind them was never reached (starvation).
// Each candidate is now claimed (see claim()) and then left alone for its
// window. Windows follow how likely a flip still is: a Stripe Checkout session
// lives 24h by default, so a young session can still be paid any minute and
// is rechecked every tick, an older one hourly, and one past the 24h session
// lifetime (only possible if Stripe never reported it expired) twice a day.
// Hard-coded in SQL so the SELECT and the claim use the exact same number.
export const RECHECK_MINUTES = { young: 10, live: 60, late: 720 } as const;
const YOUNG_UNDER_MINUTES = 120;
const LIVE_UNDER_MINUTES = 24 * 60;
const WINDOW_SQL = `(CASE
            WHEN TIMESTAMPDIFF(MINUTE, o.createdAt, NOW()) < ${YOUNG_UNDER_MINUTES} THEN ${RECHECK_MINUTES.young}
            WHEN TIMESTAMPDIFF(MINUTE, o.createdAt, NOW()) < ${LIVE_UNDER_MINUTES} THEN ${RECHECK_MINUTES.live}
            ELSE ${RECHECK_MINUTES.late} END)`;

@Injectable()
export class PaymentReconciliationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly schedulerService: SchedulerService,
    private readonly paymentsService: PaymentsService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly paymentSettingsService: PaymentSettingsService,
  ) {}

  // Every 10 minutes, wrapped in the same cross-instance advisory lock every
  // other sweep in this codebase uses - without it each PM2 instance would
  // independently poll the gateway for the same orders.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep(): Promise<void> {
    await this.schedulerService.runLocked(
      'payment-reconciliation-sweep',
      600,
      async () => {
        await this.runSweep();
      },
    );
  }

  // Split out so a test can drive it directly rather than waiting for a tick.
  // Returns how many orders it actually reconciled, which the cron ignores.
  async runSweep(): Promise<number> {
    // Priority: never-checked first (no paymentreconciliation row), and among
    // those NEWEST first - only a recent order can still have a payable
    // session, so it is the one a missed webhook actually hurts; the stale
    // backlog drains behind it instead of in front of it. Already-checked rows
    // come back oldest-check-first, once their backoff window has elapsed.
    // ponytail: newest-first never-checked could starve an old never-checked
    // row only if >MAX_PER_TICK new unpaid sessions arrive every 10 minutes;
    // revisit with a mixed oldest/newest budget if volume ever gets there.
    const candidates = await this.db.query<RowDataPacket[]>(
      `SELECT o.id, o.shopId, o.paymentSessionId, o.paymentSessionGateway,
              r.orderId IS NOT NULL AS checkedBefore,
              ${WINDOW_SQL} AS windowMinutes
         FROM \`order\` o
         LEFT JOIN paymentreconciliation r ON r.orderId = o.id
        WHERE o.paymentStatus = 'unpaid'
          AND o.paymentSessionId IS NOT NULL
          AND o.paymentSessionGateway IS NOT NULL
          AND o.status <> 'cancelled'
          AND o.createdAt < DATE_SUB(NOW(), INTERVAL ? MINUTE)
          AND o.createdAt > DATE_SUB(NOW(), INTERVAL ? DAY)
          AND (r.orderId IS NULL
               OR (r.settledAt IS NULL
                   AND r.lastCheckedAt < DATE_SUB(NOW(3), INTERVAL ${WINDOW_SQL} MINUTE)))
        ORDER BY r.orderId IS NULL DESC, r.lastCheckedAt ASC, o.createdAt DESC
        LIMIT ?`,
      [RECONCILE_AFTER_MINUTES, RECONCILE_WINDOW_DAYS, MAX_PER_TICK],
    );

    let reconciled = 0;
    for (const row of candidates) {
      try {
        // Compare-and-swap BEFORE the gateway call: only the claimant asks, so
        // an overlapping tick or a second process cannot double-check. Done
        // before (not after) the call so a throw still consumes the window; a
        // persistently failing order must not be able to monopolise the
        // per-tick budget. ponytail: a transient failure after a paid answer
        // waits out its window (<= 1h for a live session); no early release.
        if (!(await this.claim(row))) continue;
        if (await this.reconcileOne(row)) reconciled += 1;
      } catch (err) {
        // One order's gateway call failing must not abandon the rest of the
        // batch - the next tick will retry this one anyway.
        logger.error('reconciliation failed for order', {
          orderId: row.id as number,
          shopId: row.shopId as number,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (reconciled > 0) {
      logger.warn(
        `reconciled ${reconciled} payment(s) whose webhook never arrived`,
        { reconciled, candidates: candidates.length },
      );
    }
    return reconciled;
  }

  private async claim(row: RowDataPacket): Promise<boolean> {
    const orderId = row.id as number;
    if (!row.checkedBefore) {
      // INSERT IGNORE: the PK makes exactly one concurrent claimant win.
      const res = await this.db.execute(
        `INSERT IGNORE INTO paymentreconciliation (orderId, shopId, lastCheckedAt)
         VALUES (?, ?, NOW(3))`,
        [orderId, row.shopId as number],
      );
      return res.affectedRows === 1;
    }
    const res = await this.db.execute(
      `UPDATE paymentreconciliation
          SET lastCheckedAt = NOW(3)
        WHERE orderId = ? AND settledAt IS NULL
          AND lastCheckedAt < DATE_SUB(NOW(3), INTERVAL ? MINUTE)`,
      [orderId, row.windowMinutes as number],
    );
    return res.affectedRows === 1;
  }

  private async reconcileOne(row: RowDataPacket): Promise<boolean> {
    const orderId = row.id as number;
    const shopId = row.shopId as number;
    const gateway = row.paymentSessionGateway as string;
    const sessionId = row.paymentSessionId as string;

    const provider = this.providerRegistry.get(gateway);
    // A provider that cannot be polled is skipped rather than guessed at. Only
    // Stripe implements retrieveSessionOutcome today.
    if (!provider.retrieveSessionOutcome) return false;

    const credentials = await this.paymentSettingsService.resolveCredentials(
      shopId,
      gateway,
    );
    const outcome = await provider.retrieveSessionOutcome(
      sessionId,
      credentials,
    );
    if (!outcome || outcome.status !== 'paid') {
      // Still unpaid: nothing to do, the backoff decides when to ask again.
      // Expired is terminal for a checkout session, so stop asking. Order and
      // payment status are deliberately left exactly as they were.
      if (outcome?.status === 'expired') {
        await this.db.execute(
          `UPDATE paymentreconciliation SET settledAt = NOW(3) WHERE orderId = ?`,
          [orderId],
        );
      }
      return false;
    }

    // Applied through the SAME method the real webhook uses, not a parallel
    // mark-as-paid path: same transaction, same unique-index idempotency guard,
    // same affiliate sync, same CAS status advancement (so a reconciled card
    // payment confirms the order exactly as a webhook-delivered one does).
    //
    // providerReference is derived from the session id with a distinct prefix.
    // It must be deterministic, so running the sweep twice collides on the
    // unique (gateway, gatewayReference) index and the second attempt no-ops.
    // It must NOT be the webhook's own event id, which this path does not have
    // and cannot invent - and prefixing keeps a reconciliation record
    // distinguishable from a real delivery in paymenttransaction, and out of the
    // same value space as Stripe's event ids.
    await this.paymentsService.applyWebhookResult(gateway, gateway, {
      providerReference: `reconciled:${sessionId}`,
      orderId,
      status: 'paid',
      chargeReference: outcome.chargeReference,
      // Matches what the provider's own webhook now returns (Fix 3b), so a
      // reconciled payment reserves stock the same way a delivered one does.
      advanceOrderStatus: 'confirmed',
    });

    logger.warn('order marked paid by reconciliation, not by webhook', {
      orderId,
      shopId,
      gateway,
    });
    return true;
  }
}
