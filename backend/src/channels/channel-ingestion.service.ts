import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError, isLockConflict } from '../database/mysql-errors';
import { decrypt } from '../common/crypto';
import { createLogger } from '../common/logging/logger';
import type { TenantContext } from '../common/tenant-context';
import { minorUnitFactor } from '../common/currency-minor-units';
import { minorToDecimal } from '../drivers/cash';
import { CurrencyRatesService } from '../currency-rates/currency-rates.service';
import { ProductsService } from '../products/products.service';
import type { ConsumedRow } from '../products/product-order-items.service';
import { OrdersService } from '../orders/orders.service';
import { withShopOrderNumber } from '../orders/order-number';
import { OrderNotificationsService } from '../orders/order-notifications.service';
import { JobsService } from '../jobs/jobs.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type {
  ChannelconnectionRow,
  ChannelinboundeventRow,
  ChannelitemmappingRow,
  ChannelorderRow,
} from '../db/types';
import { ChannelConnectionsService } from './channel-connections.service';
import { ChannelProviderRegistry } from './channel-provider.registry';
import { assertCanonicalOrder } from './canonical-order';
import {
  ChannelParseError,
  type CanonicalChannelOrder,
  type ParsedChannelEvent,
} from './channel.types';

const logger = createLogger('ChannelIngestion');

// Inbox retry policy. The marketplace's own acceptance window is short (Deliveroo
// documents 7 minutes in the UAE), so the first retries are fast; the tail is
// long because a row that is still failing after that is an operations problem,
// and `dead` rows are alerted on and replayable (see replay()).
export const INBOX_MAX_ATTEMPTS = 12;
const BACKOFF_SECONDS = [5, 15, 30, 60, 120, 300, 600, 900];
export const INBOX_LOCK_STALE_SECONDS = 300;
const MAX_BODY_BYTES = 1024 * 1024;

export function inboxBackoffSeconds(attempts: number): number {
  return (
    BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)] ?? 900
  );
}

// One response for EVERY way an inbound delivery can be refused: unknown
// provider, unparseable routing key, unknown location, disabled connection, no
// usable secret, bad signature. Same class, same body, so the sender learns
// nothing about which tenants or locations exist.
export class ChannelWebhookRejectedException extends UnauthorizedException {}

export interface ReceiveInput {
  provider: string;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  // Tests drive processing themselves; the webhook controller leaves this off
  // and the row is processed right after the response is on its way.
  processInline?: boolean;
}

export interface ReceiveResult {
  inboxId: number;
  duplicate: boolean;
}

type MappedLine = {
  lineIndex: number;
  productId: number;
  variantId: number | null;
};

interface LinePlan {
  // Per canonical line, in order. null = no usable mapping.
  mapped: (MappedLine | null)[];
  unmapped: { externalItemId: string; externalName: string | null }[];
  resolved: Awaited<ReturnType<ProductsService['resolveOrderItems']>> | null;
  priceMismatch: unknown[] | null;
}

// Cuts to a column's real width in CHARACTERS (code points, as MySQL counts
// them), never in the middle of a surrogate pair, and drops lone surrogates that
// would make the whole insert fail. An accepted order is never rejected for the
// length of a free-text field.
export function clip(value: string | null | undefined, max: number): string {
  if (!value) return '';
  const wf = (value as string & { toWellFormed?: () => string }).toWellFormed
    ? (value as string & { toWellFormed: () => string }).toWellFormed()
    : value;
  const chars = Array.from(wf);
  return chars.length <= max ? wf : chars.slice(0, max).join('');
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

function decimalOrNull(minor: number | null, currency: string): string | null {
  return minor === null ? null : minorToDecimal(minor, currency);
}

@Injectable()
export class ChannelIngestionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: ChannelProviderRegistry,
    private readonly connections: ChannelConnectionsService,
    private readonly products: ProductsService,
    private readonly orders: OrdersService,
    private readonly notifications: OrderNotificationsService,
    private readonly currencyRates: CurrencyRatesService,
    private readonly jobs: JobsService,
    private readonly audit: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------
  // 1. Receive. The only thing that happens before the acknowledgement is: route,
  //    verify, and write the delivery to the DURABLE inbox. Processing is after.
  // ---------------------------------------------------------------------------
  async receive(input: ReceiveInput): Promise<ReceiveResult> {
    const reject = (): never => {
      throw new ChannelWebhookRejectedException();
    };
    const provider = this.registry.find(input.provider);
    if (!provider || input.rawBody.length > MAX_BODY_BYTES) return reject();

    let routingKey: string | null = null;
    try {
      routingKey = provider.extractRoutingKey(input.rawBody, input.headers);
    } catch {
      routingKey = null;
    }
    if (!routingKey || routingKey.length > 191) return reject();

    // routingKey is non-NULL only for an ENABLED connection and UNIQUE, so this
    // finds at most one row, and never a disabled or foreign-provider one.
    const rows = await this.db.query<(ChannelconnectionRow & RowDataPacket)[]>(
      `SELECT * FROM channelconnection WHERE routingKey = ?`,
      [`${provider.name}:${routingKey}`],
    );
    const conn = rows[0];
    if (!conn) return reject();
    // (Ownership was proven when the connection was ENABLED, and its ids cannot
    // change while enabled, so nothing here may reject an enabled connection
    // for a later verification change: that would drop accepted orders.)

    const secrets: string[] = [];
    try {
      if (conn.webhookSecret) secrets.push(decrypt(conn.webhookSecret));
    } catch {
      /* an undecryptable secret is simply not a usable secret */
    }
    if (provider.capabilities.platformWebhookSecret) {
      secrets.push(
        ...(provider.platformWebhookSecrets?.() ?? []).filter(Boolean),
      );
    }
    if (secrets.length === 0) return reject();

    const verified = provider.verifyWebhook({
      rawBody: input.rawBody,
      headers: input.headers,
      secrets,
    });
    if (!verified.valid) return reject();

    // The sender is authenticated from here on, so a precise error is fine.
    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Body is not valid JSON');
    }
    const payloadHash = sha256(input.rawBody);
    const result = await this.writeInbox(conn, {
      eventId: verified.eventId ?? payloadHash,
      source: 'webhook',
      signatureVerified: true,
      payload,
      payloadHash,
    });
    if (input.processInline && !result.duplicate) {
      await this.processInboxEvent(result.inboxId);
    } else if (!result.duplicate) {
      // After the response: a crash here loses nothing, the row is durable and
      // the sweep picks it up.
      setImmediate(() => {
        this.processInboxEvent(result.inboxId).catch((err: unknown) =>
          logger.error('inbox processing crashed', {
            inboxId: result.inboxId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      });
    }
    return result;
  }

  // Shared by the webhook path and the polling fallback. UNIQUE (connectionId,
  // eventId) turns a duplicate delivery (and a concurrent duplicate) into a no-op.
  async writeInbox(
    conn: ChannelconnectionRow,
    e: {
      eventId: string;
      source: 'webhook' | 'poll';
      signatureVerified: boolean;
      payload: unknown;
      payloadHash: string;
    },
  ): Promise<ReceiveResult> {
    try {
      const res = await this.db.execute(
        `INSERT INTO channelinboundevent
           (shopId, connectionId, provider, eventId, source, signatureVerified, payloadHash, payload, receivedAt, nextAttemptAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          conn.shopId,
          conn.id,
          conn.provider,
          e.eventId.slice(0, 191),
          e.source,
          e.signatureVerified,
          e.payloadHash,
          JSON.stringify(e.payload),
          // The JS clock, not the column default: every comparison in this
          // module (claim, backoff, stale sweep) is against Date.now(), and the
          // DB server's clock/timezone can differ (see JobsService.claimNextJob).
          new Date(),
          new Date(),
        ],
      );
      return { inboxId: res.insertId, duplicate: false };
    } catch (err) {
      if (isDuplicateKeyError(err) || isLockConflict(err)) {
        const rows = await this.db.query<RowDataPacket[]>(
          `SELECT id FROM channelinboundevent WHERE connectionId = ? AND eventId = ?`,
          [conn.id, e.eventId.slice(0, 191)],
        );
        if (rows[0]) return { inboxId: rows[0].id as number, duplicate: true };
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Process one inbox row. Claimed by CAS, so a webhook-triggered run, the
  //    sweep and a second instance can never process the same delivery twice.
  // ---------------------------------------------------------------------------
  async processInboxEvent(
    inboxId: number,
  ): Promise<'processed' | 'failed' | 'dead' | 'skipped'> {
    const now = new Date();
    const staleBefore = new Date(
      now.getTime() - INBOX_LOCK_STALE_SECONDS * 1000,
    );
    const claim = await this.db.execute(
      `UPDATE channelinboundevent
          SET status = 'processing', attempts = attempts + 1, lockedAt = ?
        WHERE id = ?
          AND ((status IN ('received', 'failed') AND nextAttemptAt <= ?)
               OR (status = 'processing' AND lockedAt < ?))`,
      [now, inboxId, now, staleBefore],
    );
    if (claim.affectedRows === 0) return 'skipped';

    const rows = await this.db.query<
      (ChannelinboundeventRow & RowDataPacket)[]
    >(`SELECT * FROM channelinboundevent WHERE id = ?`, [inboxId]);
    const row = rows[0];
    const conn = await this.connections.findById(row.connectionId);
    // The shop comes from the inbox row, written by receive() from the verified
    // connection. A payload can never choose it.
    if (!conn || conn.shopId !== row.shopId) {
      return this.settle(row, 'dead', 'connection no longer exists');
    }
    const provider = this.registry.find(row.provider);
    if (!provider) {
      return this.settle(row, 'failed', 'provider is not registered');
    }
    if (row.payload === null || row.payload === undefined) {
      return this.settle(row, 'dead', 'payload was purged');
    }
    let parsed: ParsedChannelEvent;
    try {
      parsed = provider.parseEvent(row.payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Deterministic: retrying the same bytes cannot succeed.
      return this.settle(
        row,
        e instanceof ChannelParseError ? 'dead' : 'failed',
        message,
      );
    }
    try {
      const externalOrderId = await this.applyEvent(conn, row, parsed);
      await this.db.execute(
        `UPDATE channelinboundevent
            SET status = 'processed', processedAt = ?, lastError = NULL, externalOrderId = ?
          WHERE id = ?`,
        [
          new Date(),
          externalOrderId ? clip(externalOrderId, 191) : null,
          inboxId,
        ],
      );
      return 'processed';
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const permanent = e instanceof ChannelParseError;
      return this.settle(row, permanent ? 'dead' : 'failed', message);
    }
  }

  private async settle(
    row: ChannelinboundeventRow,
    outcome: 'failed' | 'dead',
    message: string,
  ): Promise<'failed' | 'dead'> {
    const exhausted = row.attempts >= INBOX_MAX_ATTEMPTS;
    const status = outcome === 'dead' || exhausted ? 'dead' : 'failed';
    await this.db.execute(
      `UPDATE channelinboundevent
          SET status = ?, lastError = ?, nextAttemptAt = ?, lockedAt = NULL
        WHERE id = ?`,
      [
        status,
        clip(message, 500),
        new Date(Date.now() + inboxBackoffSeconds(row.attempts) * 1000),
        row.id,
      ],
    );
    if (status === 'dead') {
      logger.error('channel inbox event is dead', {
        inboxId: row.id,
        shopId: row.shopId,
        provider: row.provider,
        error: message.slice(0, 200),
      });
    }
    return status;
  }

  private async applyEvent(
    conn: ChannelconnectionRow,
    row: ChannelinboundeventRow,
    parsed: ParsedChannelEvent,
  ): Promise<string | null> {
    switch (parsed.kind) {
      case 'ignored':
        return null;
      case 'order_new':
        await this.ingestOrder(conn, parsed.order, row.payloadHash);
        return parsed.order.externalOrderId;
      case 'order_status':
        await this.applyStatus(conn, row, parsed);
        return parsed.externalOrderId;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. A new order.
  // ---------------------------------------------------------------------------
  async ingestOrder(
    conn: ChannelconnectionRow,
    order: CanonicalChannelOrder,
    payloadHash: string,
  ): Promise<'created' | 'needs_mapping' | 'duplicate'> {
    assertCanonicalOrder(order);
    // Cheap short-circuit only. The UNIQUE (connectionId, externalOrderId) insert
    // inside the transaction is the real arbiter.
    const existing = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM channelorder WHERE connectionId = ? AND externalOrderId = ?`,
      [conn.id, order.externalOrderId],
    );
    if (existing.length > 0) return 'duplicate';

    // Pool reads happen BEFORE the transaction (nested-pool rule).
    const plan = await this.planLines(conn, order);
    const alertTo = await this.notifications.resolveMerchantAlertRecipient(
      conn.shopId,
      conn.outletId,
    );
    const complete = plan.unmapped.length === 0 && plan.resolved !== null;
    const acceptBy = order.acceptBy ? new Date(order.acceptBy) : null;

    const outcome = await this.db.transaction(async (c) => {
      let channelOrderId: number;
      try {
        const [res] = await c.query(
          `INSERT INTO channelorder
             (shopId, connectionId, outletId, provider, externalOrderId, displayId, state, externalStatus,
              acceptBy, scheduledFor, currency, commissionAmount, cashDueAmount, priceMismatch, canonical,
              payloadHash, receivedAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            conn.shopId,
            conn.id,
            conn.outletId,
            conn.provider,
            order.externalOrderId,
            order.displayId ? clip(order.displayId, 64) : null,
            complete ? 'pending_acceptance' : 'needs_mapping',
            order.externalStatus.slice(0, 32),
            acceptBy,
            order.scheduledFor ? new Date(order.scheduledFor) : null,
            order.currency,
            decimalOrNull(order.totals.commissionMinor, order.currency),
            decimalOrNull(order.totals.cashDueMinor, order.currency),
            plan.priceMismatch ? JSON.stringify(plan.priceMismatch) : null,
            JSON.stringify(order),
            payloadHash,
            new Date(),
            new Date(),
          ],
        );
        channelOrderId = (res as { insertId: number }).insertId;
      } catch (e) {
        if (isDuplicateKeyError(e)) return 'duplicate' as const;
        throw e;
      }

      if (complete) {
        await this.createOrderRows(c, conn, order, plan, channelOrderId);
      } else {
        await this.recordUnmapped(c, conn, channelOrderId, plan.unmapped);
      }

      if (alertTo) {
        const label = order.displayId ?? order.externalOrderId;
        const body = complete
          ? `New ${conn.provider} order ${label} is waiting for you to accept it.`
          : `New ${conn.provider} order ${label} has items that are not set up yet. Map them in Requital so the order can be accepted.`;
        await this.jobs.enqueue(
          conn.shopId,
          'send_merchant_whatsapp_alert',
          { to: alertTo, body },
          `channelorder:${channelOrderId}:alert`,
          { tx: c },
        );
        await c.query(`UPDATE channelorder SET alertedAt = ? WHERE id = ?`, [
          new Date(),
          channelOrderId,
        ]);
      }
      return complete ? ('created' as const) : ('needs_mapping' as const);
    });

    if (outcome !== 'duplicate') {
      await this.audit.log(
        { shopId: conn.shopId, actorUserId: null, actorLabel: conn.provider },
        {
          action: 'channel_order.received',
          entityType: 'channelorder',
          after: {
            provider: conn.provider,
            externalOrderId: order.externalOrderId,
            state:
              outcome === 'created' ? 'pending_acceptance' : 'needs_mapping',
          },
        },
      );
    }
    return outcome;
  }

  // Looks up mappings and resolves the mapped lines through the same resolver
  // the storefront and admin use (variant label, unit cost capture, product
  // existence per shop). The payload's price always wins: resolveOrderItems is
  // handed it as the override, so a catalogue price or auto-discount can never
  // silently re-price what the marketplace charged.
  private async planLines(
    conn: ChannelconnectionRow,
    order: CanonicalChannelOrder,
  ): Promise<LinePlan> {
    const ids = [...new Set(order.lines.map((l) => l.externalItemId))];
    const maps = await this.db.query<(ChannelitemmappingRow & RowDataPacket)[]>(
      `SELECT * FROM channelitemmapping
        WHERE shopId = ? AND provider = ? AND externalItemId IN (${ids.map(() => '?').join(', ')})`,
      [conn.shopId, conn.provider, ...ids],
    );
    const byId = new Map(maps.map((m) => [m.externalItemId, m]));
    const mapped: (MappedLine | null)[] = order.lines.map((l, lineIndex) => {
      const m = byId.get(l.externalItemId);
      return m
        ? { lineIndex, productId: m.productId, variantId: m.variantId }
        : null;
    });
    const itemFor = (i: number) => ({
      productId: mapped[i]!.productId,
      quantity: order.lines[i].quantity,
      variantId: mapped[i]!.variantId ?? undefined,
      priceOverride: Number(
        minorToDecimal(order.lines[i].unitPriceMinor, order.currency),
      ),
    });
    const markUnmapped = (i: number) => {
      mapped[i] = null;
    };

    // Resolve the mapped lines. A line whose mapping no longer works (product
    // deleted, a variant now required, a gift card) must not hide which lines are
    // fine: it is demoted to "unmapped" and the rest are resolved again.
    let resolved: LinePlan['resolved'] = null;
    for (;;) {
      const idx = mapped.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
      if (idx.length === 0) break;
      try {
        const r = await this.products.resolveOrderItems(
          conn.shopId,
          idx.map(itemFor),
        );
        const gifts = idx.filter((_, k) => r[k].product.isGiftCard);
        if (gifts.length > 0) {
          gifts.forEach(markUnmapped);
          continue;
        }
        resolved = r;
        break;
      } catch (e) {
        let demoted = false;
        for (const i of idx) {
          try {
            await this.products.resolveOrderItems(conn.shopId, [itemFor(i)]);
          } catch {
            markUnmapped(i);
            demoted = true;
          }
        }
        if (!demoted) throw e;
      }
    }

    const unmapped = order.lines
      .map((l, i) => ({ l, i }))
      .filter(({ i }) => mapped[i] === null)
      .map(({ l }) => ({
        externalItemId: l.externalItemId,
        externalName: clip(l.name, 255) || null,
      }));
    const dedup = [
      ...new Map(unmapped.map((u) => [u.externalItemId, u])).values(),
    ];

    return {
      mapped,
      unmapped: dedup,
      resolved,
      priceMismatch: await this.priceMismatch(
        conn.shopId,
        order,
        mapped,
        resolved,
      ),
    };
  }

  // Payload price vs the catalogue price of the mapped product. Only a flag:
  // the order keeps the payload's price. A line price includes modifiers, so a
  // difference is information for the merchant, not an error.
  private async priceMismatch(
    shopId: number,
    order: CanonicalChannelOrder,
    mapped: (MappedLine | null)[],
    resolved: LinePlan['resolved'],
  ): Promise<unknown[] | null> {
    if (!resolved) return null;
    const shop = await this.db.query<RowDataPacket[]>(
      `SELECT currency FROM shop WHERE id = ?`,
      [shopId],
    );
    if ((shop[0]?.currency as string | undefined) !== order.currency)
      return null;
    const factor = minorUnitFactor(order.currency);
    const out: unknown[] = [];
    let k = 0;
    mapped.forEach((m, i) => {
      if (!m) return;
      const r = resolved[k++];
      const catalog =
        (r.variant?.price as string | undefined) ?? (r.product.price as string);
      const catalogMinor = Math.round(Number(catalog) * factor);
      if (catalogMinor !== order.lines[i].unitPriceMinor) {
        out.push({
          externalItemId: order.lines[i].externalItemId,
          productId: m.productId,
          payloadMinor: order.lines[i].unitPriceMinor,
          catalogMinor,
        });
      }
    });
    return out.length > 0 ? out : null;
  }

  private async recordUnmapped(
    c: PoolConnection,
    conn: ChannelconnectionRow,
    channelOrderId: number,
    unmapped: LinePlan['unmapped'],
  ): Promise<void> {
    for (const u of unmapped) {
      await c.query(
        `INSERT INTO channelunmappeditem (shopId, provider, externalItemId, externalName)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE occurrences = occurrences + 1, lastSeenAt = CURRENT_TIMESTAMP(3),
           resolvedAt = NULL, externalName = COALESCE(VALUES(externalName), externalName)`,
        [conn.shopId, conn.provider, u.externalItemId, u.externalName],
      );
      await c.query(
        `INSERT IGNORE INTO channelorderunmapped (channelOrderId, unmappedItemId)
         SELECT ?, id FROM channelunmappeditem WHERE shopId = ? AND provider = ? AND externalItemId = ?`,
        [channelOrderId, conn.shopId, conn.provider, u.externalItemId],
      );
    }
  }

  // The order, its lines, its stock hold and the link, on the caller's
  // transaction. No gateway session, no customer row, no customer notification.
  private async createOrderRows(
    c: PoolConnection,
    conn: ChannelconnectionRow,
    order: CanonicalChannelOrder,
    plan: LinePlan,
    channelOrderId: number,
  ): Promise<void> {
    const resolved = plan.resolved!;
    const lineIdx = plan.mapped
      .map((m, i) => (m ? i : -1))
      .filter((i) => i >= 0);
    const currency = order.currency;
    const captured = await this.currencyRates.resolveForCapture(currency, c);

    // Stock: held from arrival, exactly like checkout (CAS record + ledger), but
    // never refused. The aggregator has already taken the customer's money, and
    // turning an accepted order away because a count is stale would lose a sale
    // (accepted orders are never lost): the merchant sees the negative stock.
    const consumed: ConsumedRow[] = [];
    const ingredientsConsumed = await this.products.consumeForOrderItems(
      c,
      conn.shopId,
      conn.outletId,
      resolved.map(({ product, variant, quantity }) => ({
        productId: product.id as number,
        variantId: (variant?.id as number | undefined) ?? null,
        quantity,
        allowNegative: true,
      })),
      -1,
      { throwOnInsufficientStock: false, actorUserId: null, collect: consumed },
    );

    const t = order.totals;
    const cash = t.cashDueMinor ?? 0;
    const customer = order.customer;
    const [res] = await withShopOrderNumber(c, conn.shopId, (shopOrderNumber) =>
      c.query(
        `INSERT INTO \`order\` (
           shopId, outletId, ingredientsConsumedAt, consumptionRecordedAt, customerId,
           customerName, customerPhone, customerEmail, customerAddress, deliveryNotes,
           channel, orderType, paymentMethod, status, paymentStatus, deliveryFee, taxAmount,
           discountAmount, total, trackingToken, shopOrderNumber, currency, rateBaseCurrency, exchangeRate
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [
          conn.shopId,
          conn.outletId,
          ingredientsConsumed ? new Date() : null,
          new Date(),
          // Minimal personal data: only what the marketplace sent. The NOT NULL
          // columns get '' (never a placeholder that looks like data).
          // Cut to the real column widths (order.customerName/Phone are
          // VARCHAR(191), address and notes TEXT).
          clip(customer.name, 191),
          clip(customer.phone, 191),
          clip(customer.address, 10000),
          customer.notes ? clip(customer.notes, 10000) : null,
          conn.provider,
          order.handover === 'merchant_delivery' ? 'delivery' : 'pickup',
          conn.provider,
          cash > 0 ? 'unpaid' : 'paid',
          decimalOrNull(t.deliveryFeeMinor, currency),
          decimalOrNull(t.taxMinor, currency),
          decimalOrNull(t.discountMinor, currency),
          minorToDecimal(t.totalMinor, currency),
          shopOrderNumber,
          currency,
          captured?.rateBaseCurrency ?? null,
          captured?.exchangeRate ?? null,
        ],
      ),
    );
    const newOrderId = (res as { insertId: number }).insertId;

    const placeholders = resolved
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)')
      .join(', ');
    await c.query(
      `INSERT INTO orderitem (orderId, productId, productName, variantId, variantLabel, quantity, priceAtPurchase, autoDiscountAmount, unitCost, taxClassId, taxRate, taxAmount, note)
       VALUES ${placeholders}`,
      resolved.flatMap((r, k) => {
        const line = order.lines[lineIdx[k]];
        return [
          newOrderId,
          r.product.id as number,
          r.product.name as string,
          (r.variant?.id as number | undefined) ?? null,
          r.variantLabel ?? null,
          r.quantity,
          // What the marketplace charged per unit, never the catalogue price.
          minorToDecimal(line.unitPriceMinor, currency),
          null,
          r.unitCost,
          decimalOrNull(line.taxMinor, currency),
          line.note ? clip(line.note, 255) : null,
        ];
      }),
    );
    await this.products.recordOrderConsumption(
      c,
      conn.shopId,
      newOrderId,
      consumed,
    );

    // Link, and drop the canonical snapshot now that the order holds the data.
    await c.query(
      `UPDATE channelorder SET orderId = ?, canonical = NULL, state = 'pending_acceptance', updatedAt = ?
        WHERE id = ?`,
      [newOrderId, new Date(), channelOrderId],
    );
  }

  // After a mapping is added or changed: try again every needs_mapping order of
  // this shop that was waiting on the item. Returns how many became real orders.
  async reevaluateWaiting(
    shopId: number,
    provider: string,
    externalItemIds: string[],
  ): Promise<number> {
    if (externalItemIds.length === 0) return 0;
    const waiting = await this.db.query<RowDataPacket[]>(
      `SELECT DISTINCT co.id
         FROM channelorder co
         JOIN channelorderunmapped cu ON cu.channelOrderId = co.id
         JOIN channelunmappeditem ui ON ui.id = cu.unmappedItemId
        WHERE co.shopId = ? AND co.provider = ? AND co.state = 'needs_mapping'
          AND ui.shopId = co.shopId
          AND ui.externalItemId IN (${externalItemIds.map(() => '?').join(', ')})`,
      [shopId, provider, ...externalItemIds],
    );
    let created = 0;
    for (const w of waiting) {
      if (await this.retryNeedsMapping(shopId, w.id as number)) created += 1;
    }
    return created;
  }

  async retryNeedsMapping(
    shopId: number,
    channelOrderId: number,
  ): Promise<boolean> {
    const rows = await this.db.query<(ChannelorderRow & RowDataPacket)[]>(
      `SELECT * FROM channelorder WHERE id = ? AND shopId = ? AND state = 'needs_mapping'`,
      [channelOrderId, shopId],
    );
    const co = rows[0];
    if (!co || !co.canonical) return false;
    const conn = await this.connections.findById(co.connectionId);
    if (!conn || conn.shopId !== shopId) return false;
    const order = co.canonical as CanonicalChannelOrder;
    const plan = await this.planLines(conn, order);
    if (plan.unmapped.length > 0 || plan.resolved === null) return false;

    return this.db.transaction(async (c) => {
      // The CAS is the arbiter: an upstream cancel (or a second retry) that got
      // here first leaves nothing to do.
      const [claim] = await c.query(
        `UPDATE channelorder SET priceMismatch = ?, updatedAt = ?
          WHERE id = ? AND shopId = ? AND state = 'needs_mapping' AND orderId IS NULL`,
        [
          plan.priceMismatch ? JSON.stringify(plan.priceMismatch) : null,
          new Date(),
          channelOrderId,
          shopId,
        ],
      );
      if ((claim as { affectedRows: number }).affectedRows === 0) return false;
      await this.createOrderRows(c, conn, order, plan, channelOrderId);
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // 4. A status change from the marketplace.
  // ---------------------------------------------------------------------------
  private async applyStatus(
    conn: ChannelconnectionRow,
    row: ChannelinboundeventRow,
    ev: Extract<ParsedChannelEvent, { kind: 'order_status' }>,
  ): Promise<void> {
    let co = await this.findLink(conn.id, ev.externalOrderId);
    if (!co && ev.order) {
      await this.ingestOrder(conn, ev.order, row.payloadHash);
      co = await this.findLink(conn.id, ev.externalOrderId);
    }
    // Out of order: the status event beat `order.new`. Fail so the inbox retries
    // it shortly (and `dead` after the cap), never drop it.
    if (!co) throw new Error('order is not known yet');

    if (ev.status === 'accepted') {
      await this.markAcceptedExternally(co, ev.externalStatus);
    } else if (ev.status === 'rejected' || ev.status === 'cancelled') {
      await this.closeUpstream(
        co,
        ev.status === 'rejected' ? 'rejected' : 'cancelled_upstream',
        ev.externalStatus,
      );
    } else {
      await this.db.execute(
        `UPDATE channelorder SET externalStatus = ?, updatedAt = ?
          WHERE id = ? AND shopId = ? AND state NOT IN ('rejected', 'cancelled_upstream')`,
        [ev.externalStatus.slice(0, 32), new Date(), co.id, co.shopId],
      );
    }
  }

  private async findLink(connectionId: number, externalOrderId: string) {
    const rows = await this.db.query<(ChannelorderRow & RowDataPacket)[]>(
      `SELECT * FROM channelorder WHERE connectionId = ? AND externalOrderId = ?`,
      [connectionId, externalOrderId],
    );
    return rows[0] ?? null;
  }

  // The marketplace says the order is accepted (accepted on its own tablet, or
  // by us a moment ago). Confirms our order; idempotent.
  async markAcceptedExternally(
    co: ChannelorderRow,
    externalStatus: string,
    actor?: TenantContext,
  ): Promise<void> {
    const res = await this.db.execute(
      `UPDATE channelorder SET state = 'accepted', externalStatus = ?, updatedAt = ?
        WHERE id = ? AND shopId = ? AND state = 'pending_acceptance'`,
      [externalStatus.slice(0, 32), new Date(), co.id, co.shopId],
    );
    if (res.affectedRows === 0) {
      await this.db.execute(
        `UPDATE channelorder SET externalStatus = ?, updatedAt = ?
          WHERE id = ? AND shopId = ? AND state NOT IN ('rejected', 'cancelled_upstream')`,
        [externalStatus.slice(0, 32), new Date(), co.id, co.shopId],
      );
      return;
    }
    await this.confirmOrder(co, actor);
  }

  async confirmOrder(
    co: ChannelorderRow,
    actor?: TenantContext,
  ): Promise<void> {
    if (co.orderId === null) return;
    const ctx = actor ?? (await this.systemContext(co.shopId));
    try {
      await this.orders.updateStatus(
        ctx,
        co.orderId,
        { status: 'confirmed' },
        { channelDesk: true },
      );
    } catch (e) {
      // Already confirmed / moved on / cancelled: the state machine said no,
      // which is the idempotent answer.
      if (!(e instanceof ConflictException || e instanceof BadRequestException))
        throw e;
    }
  }

  // Rejected or cancelled upstream: the state moves by CAS and the order goes
  // through the ordinary cancel path (status CAS + stock release by the
  // consumption record + invoice marker).
  async closeUpstream(
    co: ChannelorderRow,
    newState: 'rejected' | 'cancelled_upstream',
    externalStatus: string,
    actor?: TenantContext,
  ): Promise<void> {
    // canonical is dropped with the close: a never-mapped order that is now
    // finished has no use for the customer details it still holds.
    await this.db.execute(
      `UPDATE channelorder SET state = ?, externalStatus = ?, canonical = NULL, updatedAt = ?
        WHERE id = ? AND shopId = ? AND state IN ('needs_mapping', 'pending_acceptance', 'accepted')`,
      [newState, externalStatus.slice(0, 32), new Date(), co.id, co.shopId],
    );
    await this.cancelOrderOfClosedLink(co.id, co.shopId, actor);
  }

  // Cancels the order behind a link that is closed (rejected / cancelled
  // upstream). Deliberately does NOT depend on whether THIS call won the state
  // CAS: a first attempt that moved the state and then failed to cancel must be
  // finished by the retry (and by the sweep), or the order would be live on a
  // closed link forever. orderId is read AFTER the state is closed, so an order
  // a concurrent mapping retry created in between is seen.
  async cancelOrderOfClosedLink(
    channelOrderId: number,
    shopId: number,
    actor?: TenantContext,
  ): Promise<void> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT orderId, state FROM channelorder WHERE id = ? AND shopId = ?`,
      [channelOrderId, shopId],
    );
    const link = rows[0];
    if (
      !link ||
      link.orderId === null ||
      (link.state !== 'rejected' && link.state !== 'cancelled_upstream')
    )
      return;
    const ctx = actor ?? (await this.systemContext(shopId));
    try {
      await this.orders.cancel(ctx, link.orderId as number, {
        channelDesk: true,
      });
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ConflictException) {
        // Already delivered or already cancelled. Delivered is worth a visible
        // note: the marketplace cancelled something the kitchen already sent.
        await this.db.execute(
          `UPDATE channelorder SET lastError = ?, updatedAt = ? WHERE id = ? AND shopId = ?`,
          [clip(e.message, 500), new Date(), channelOrderId, shopId],
        );
        return;
      }
      throw e;
    }
  }

  // The same synthetic context PaymentsService uses for webhook-driven status
  // changes: every shop has an admin to attribute the audit row to.
  async systemContext(shopId: number): Promise<TenantContext> {
    const adminRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM user WHERE shopId = ? AND role = 'admin' ORDER BY id ASC LIMIT 1`,
      [shopId],
    );
    if (!adminRows[0])
      throw new Error('shop has no admin user to attribute the change to');
    return {
      userId: adminRows[0].id as number,
      shopId,
      role: 'admin',
      outletId: null,
    };
  }

  // ---------------------------------------------------------------------------
  // 5. Operations: replay and the SLO numbers.
  // ---------------------------------------------------------------------------
  // Puts dead or failed rows of ONE shop back in the queue and runs them.
  async replay(
    shopId: number,
    inboxIds?: number[],
  ): Promise<{ requeued: number }> {
    const idClause = inboxIds?.length
      ? `AND id IN (${inboxIds.map(() => '?').join(', ')})`
      : '';
    const res = await this.db.execute(
      `UPDATE channelinboundevent
          SET status = 'failed', attempts = 0, nextAttemptAt = ?, lockedAt = NULL
        WHERE shopId = ? AND status IN ('failed', 'dead') AND payload IS NOT NULL ${idClause}`,
      [new Date(), shopId, ...(inboxIds ?? [])],
    );
    return { requeued: res.affectedRows };
  }

  // SLO hooks: Talabat asks for >= 98.9% order ingestion success and <= 2.5%
  // vendor failure. `delivered` counts what reached a final state; `pending` is
  // still in flight and counts toward neither side.
  async stats(opts: { shopId?: number; sinceMinutes: number }) {
    const since = new Date(Date.now() - opts.sinceMinutes * 60_000);
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT status, COUNT(*) AS n FROM channelinboundevent
        WHERE receivedAt >= ? ${opts.shopId !== undefined ? 'AND shopId = ?' : ''}
        GROUP BY status`,
      opts.shopId !== undefined ? [since, opts.shopId] : [since],
    );
    const by = Object.fromEntries(
      rows.map((r) => [r.status as string, Number(r.n)]),
    );
    const processed = by.processed ?? 0;
    const failed = (by.failed ?? 0) + (by.dead ?? 0);
    const final = processed + failed;
    return {
      sinceMinutes: opts.sinceMinutes,
      received: Object.values(by).reduce((a, b) => a + b, 0),
      processed,
      failed,
      inFlight: (by.received ?? 0) + (by.processing ?? 0),
      // null (never 100) when nothing has finished: no data is not perfect data.
      ingestionSuccessPct:
        final === 0 ? null : Math.round((processed / final) * 1000) / 10,
      failurePct: final === 0 ? null : Math.round((failed / final) * 1000) / 10,
    };
  }
}
