import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { JobsService } from '../jobs/jobs.service';
import { createLogger } from '../common/logging/logger';
import { OrderNotificationsService } from '../orders/order-notifications.service';
import type { ChannelconnectionRow, ChannelorderRow } from '../db/types';
import { MARKETPLACE_ORDER_CHANNELS } from './marketplace-channels';
import { ChannelConnectionsService } from './channel-connections.service';
import {
  ChannelIngestionService,
  INBOX_LOCK_STALE_SECONDS,
} from './channel-ingestion.service';
import { ChannelProviderRegistry } from './channel-provider.registry';

const logger = createLogger('ChannelSweep');

export const POLL_INTERVAL_SECONDS = 120;
// Used only when the marketplace gave no deadline of its own.
export const DEFAULT_ACCEPT_WINDOW_MINUTES = 15;
// An accepted marketplace order whose Requital order is still `pending` after
// this long means the confirm step failed after the marketplace accepted.
export const CONFIRM_REPAIR_AFTER_MINUTES = 5;
export const PAYLOAD_RETENTION_DAYS = 30;
const BATCH = 50;

// Everything that makes "accepted orders are never lost" true when a webhook did
// not arrive, arrived and failed, or was processed half-way:
//   replayDue      re-runs inbox rows that are received/failed and due (or whose
//                  processor died holding the lock)
//   pollConnections the polling fallback, for providers that can list open orders
//   staleOrders    asks the marketplace about orders past their deadline, alerts
//                  the merchant once, and repairs accepted-but-unconfirmed orders
//   purgePayloads  drops stored delivery bodies (personal data) after retention
@Injectable()
export class ChannelSweepService {
  constructor(
    private readonly db: DatabaseService,
    private readonly scheduler: SchedulerService,
    private readonly jobs: JobsService,
    private readonly registry: ChannelProviderRegistry,
    private readonly connections: ChannelConnectionsService,
    private readonly ingestion: ChannelIngestionService,
    private readonly notifications: OrderNotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.scheduler.runLocked('channel-sweep', 55, async () => {
      await this.runOnce();
    });
  }

  // Split out so a test drives it directly. Each step is isolated: one failing
  // never starves the others.
  async runOnce() {
    const out = {
      replayed: 0,
      polled: 0,
      stale: 0,
      repaired: 0,
      purged: 0,
      scrubbed: 0,
    };
    const step = async (name: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        logger.error(`channel sweep step ${name} failed`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };
    await step(
      'replay',
      async () => void (out.replayed = await this.replayDue()),
    );
    await step(
      'poll',
      async () => void (out.polled = await this.pollConnections()),
    );
    await step('stale', async () => {
      const r = await this.staleOrders();
      out.stale = r.alerted;
      out.repaired = r.repaired;
    });
    await step(
      'purge',
      async () => void (out.purged = await this.purgePayloads()),
    );
    await step(
      'scrub',
      async () => void (out.scrubbed = await this.scrubClosedOrders()),
    );
    return out;
  }

  async replayDue(): Promise<number> {
    const now = new Date();
    const staleLock = new Date(now.getTime() - INBOX_LOCK_STALE_SECONDS * 1000);
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM channelinboundevent
        WHERE (status IN ('received', 'failed') AND nextAttemptAt <= ?)
           OR (status = 'processing' AND lockedAt < ?)
        ORDER BY nextAttemptAt ASC LIMIT ?`,
      [now, staleLock, BATCH],
    );
    let n = 0;
    for (const r of rows) {
      const outcome = await this.ingestion.processInboxEvent(r.id as number);
      if (outcome !== 'skipped') n += 1;
    }
    return n;
  }

  async pollConnections(): Promise<number> {
    const due = new Date(Date.now() - POLL_INTERVAL_SECONDS * 1000);
    const rows = await this.db.query<(ChannelconnectionRow & RowDataPacket)[]>(
      `SELECT * FROM channelconnection
        WHERE enabled = 1 AND (lastSyncAt IS NULL OR lastSyncAt < ?)
        ORDER BY lastSyncAt ASC LIMIT ?`,
      [due, BATCH],
    );
    let polled = 0;
    for (const conn of rows) {
      const provider = this.registry.find(conn.provider);
      if (!provider?.capabilities.pollOrders || !provider.listOpenOrders)
        continue;
      try {
        const events = await provider.listOpenOrders(
          this.connections.bind(conn),
        );
        for (const e of events) {
          const raw = JSON.stringify(e.payload);
          const written = await this.ingestion.writeInbox(conn, {
            eventId: e.eventId,
            source: 'poll',
            // Not a webhook: authenticated by the credentials of the call itself.
            signatureVerified: false,
            payload: e.payload,
            payloadHash: createHash('sha256').update(raw).digest('hex'),
          });
          if (!written.duplicate)
            await this.ingestion.processInboxEvent(written.inboxId);
        }
        await this.db.execute(
          `UPDATE channelconnection SET lastSyncAt = ?, lastSyncStatus = 'ok', lastError = NULL WHERE id = ?`,
          [new Date(), conn.id],
        );
        polled += 1;
      } catch (err) {
        await this.db.execute(
          `UPDATE channelconnection SET lastSyncAt = ?, lastSyncStatus = 'failed', lastError = ? WHERE id = ?`,
          [
            new Date(),
            (err instanceof Error ? err.message : String(err)).slice(0, 500),
            conn.id,
          ],
        );
      }
    }
    return polled;
  }

  async staleOrders(): Promise<{ alerted: number; repaired: number }> {
    const now = new Date();
    const fallback = new Date(
      now.getTime() - DEFAULT_ACCEPT_WINDOW_MINUTES * 60_000,
    );
    const overdue = await this.db.query<(ChannelorderRow & RowDataPacket)[]>(
      `SELECT * FROM channelorder
        WHERE state IN ('needs_mapping', 'pending_acceptance') AND staleAlertedAt IS NULL
          AND ((acceptBy IS NOT NULL AND acceptBy < ?) OR (acceptBy IS NULL AND receivedAt < ?))
        ORDER BY receivedAt ASC LIMIT ?`,
      [now, fallback, BATCH],
    );
    let alerted = 0;
    for (const co of overdue) {
      if (await this.reconcileOne(co)) continue;
      // Claim and enqueue in ONE transaction: a failed enqueue rolls the claim
      // back (the next tick tries again), and a lost claim sends nothing.
      const to = await this.notifications.resolveMerchantAlertRecipient(
        co.shopId,
        co.outletId,
      );
      const sent = await this.db.transaction(async (tx) => {
        const [claim] = await tx.query(
          `UPDATE channelorder SET staleAlertedAt = ?, updatedAt = ?
            WHERE id = ? AND shopId = ? AND staleAlertedAt IS NULL AND state IN ('needs_mapping', 'pending_acceptance')`,
          [now, now, co.id, co.shopId],
        );
        if ((claim as { affectedRows: number }).affectedRows === 0)
          return false;
        if (to) {
          await this.jobs.enqueue(
            co.shopId,
            'send_merchant_whatsapp_alert',
            {
              to,
              body: `${co.provider} order ${co.displayId ?? co.externalOrderId} passed its acceptance deadline and is still waiting. Open Requital to accept or reject it.`,
            },
            `channelorder:${co.id}:stale-alert`,
            { tx },
          );
        }
        return true;
      });
      if (sent) alerted += 1;
    }

    const stuck = await this.db.query<(ChannelorderRow & RowDataPacket)[]>(
      `SELECT co.* FROM channelorder co JOIN \`order\` o ON o.id = co.orderId AND o.shopId = co.shopId
        WHERE co.state = 'accepted' AND o.status = 'pending' AND co.updatedAt < ?
        LIMIT ?`,
      [new Date(now.getTime() - CONFIRM_REPAIR_AFTER_MINUTES * 60_000), BATCH],
    );
    let repaired = 0;
    for (const co of stuck) {
      await this.ingestion.confirmOrder(co);
      repaired += 1;
    }

    // Mirror of the confirm repair: a link the marketplace closed whose order is
    // still live (the cancel failed after the state moved) is finished here.
    const live = await this.db.query<(ChannelorderRow & RowDataPacket)[]>(
      `SELECT co.* FROM channelorder co JOIN \`order\` o ON o.id = co.orderId AND o.shopId = co.shopId
        WHERE co.state IN ('rejected', 'cancelled_upstream')
          AND o.status IN ('pending', 'confirmed', 'preparing', 'out_for_delivery')
          AND co.updatedAt < ?
        LIMIT ?`,
      [new Date(now.getTime() - 60_000), BATCH],
    );
    for (const co of live) {
      try {
        await this.ingestion.cancelOrderOfClosedLink(co.id, co.shopId);
        repaired += 1;
      } catch (e) {
        logger.warn('cancel repair failed', {
          channelOrderId: co.id,
          error: e instanceof Error ? e.message.slice(0, 200) : String(e),
        });
      }
    }
    return { alerted, repaired };
  }

  // Asks the marketplace what became of an overdue order, if it can say. True =
  // the answer settled it (no alert needed).
  private async reconcileOne(co: ChannelorderRow): Promise<boolean> {
    const provider = this.registry.find(co.provider);
    if (!provider?.capabilities.fetchOrderStatus || !provider.fetchOrderStatus)
      return false;
    const connRow = await this.connections.findById(co.connectionId);
    if (!connRow || connRow.shopId !== co.shopId) return false;
    try {
      const s = await provider.fetchOrderStatus(
        this.connections.bind(connRow),
        co.externalOrderId,
      );
      if (!s) return false;
      if (s.status === 'accepted') {
        await this.ingestion.markAcceptedExternally(co, s.externalStatus);
        return true;
      }
      if (s.status === 'rejected' || s.status === 'cancelled') {
        await this.ingestion.closeUpstream(
          co,
          s.status === 'rejected' ? 'rejected' : 'cancelled_upstream',
          s.externalStatus,
        );
        return true;
      }
    } catch (e) {
      logger.warn('fetchOrderStatus failed', {
        channelOrderId: co.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
    return false;
  }

  // Stored delivery bodies hold customer details. Processed ones go after the
  // retention period; failed and dead ones too (they are replayable only inside
  // the same window), measured from when they arrived.
  async purgePayloads(): Promise<number> {
    const cutoff = new Date(Date.now() - PAYLOAD_RETENTION_DAYS * 86_400_000);
    const res = await this.db.execute(
      `UPDATE channelinboundevent SET payload = NULL, payloadPurgedAt = ?
        WHERE payloadPurgedAt IS NULL AND payload IS NOT NULL
          AND ((status = 'processed' AND processedAt < ?)
               OR (status IN ('failed', 'dead') AND receivedAt < ?))`,
      [new Date(), cutoff, cutoff],
    );
    return res.affectedRows;
  }

  // Retention for the order itself: once a marketplace order has been delivered
  // or cancelled for PAYLOAD_RETENTION_DAYS, the customer's name, phone,
  // address and notes are blanked. The order, its lines and totals stay (they
  // are the merchant's sales record). Idempotent: an already blanked order does
  // not match. "Closed at" is the last status change in the audit log (an order
  // cannot move after delivered/cancelled), falling back to its creation.
  async scrubClosedOrders(): Promise<number> {
    const cutoff = new Date(Date.now() - PAYLOAD_RETENTION_DAYS * 86_400_000);
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT o.id, o.shopId FROM \`order\` o
        WHERE o.channel IN (${MARKETPLACE_ORDER_CHANNELS.map(() => '?').join(', ')})
          AND o.status IN ('delivered', 'cancelled')
          AND (o.customerName <> '' OR o.customerPhone <> '' OR o.customerAddress <> ''
               OR o.deliveryNotes IS NOT NULL OR o.receiverMessage IS NOT NULL)
          AND COALESCE((SELECT MAX(a.createdAt) FROM auditlog a
                         WHERE a.shopId = o.shopId AND a.entityType = 'order'
                           AND a.entityId = o.id AND a.action = 'order.status_changed'),
                       o.createdAt) < ?
        LIMIT ?`,
      [...MARKETPLACE_ORDER_CHANNELS, cutoff, BATCH],
    );
    for (const r of rows) {
      await this.db.transaction(async (c) => {
        await c.query(
          `UPDATE \`order\` SET customerName = '', customerPhone = '', customerAddress = '',
                  deliveryNotes = NULL, receiverMessage = NULL
            WHERE id = ? AND shopId = ?`,
          [r.id, r.shopId],
        );
        await c.query(`UPDATE orderitem SET note = NULL WHERE orderId = ?`, [
          r.id,
        ]);
      });
    }
    return rows.length;
  }
}
