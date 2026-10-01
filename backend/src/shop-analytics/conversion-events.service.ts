import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { JobsWorkerService } from '../jobs/jobs.worker.service';
import type { SendConversionEventJobPayload } from '../jobs/jobs.types';
import { createLogger } from '../common/logging/logger';
import { trimDecimal } from '../database/decimal.util';
import { storefrontUrl } from '../common/storefront-url';
import { hasMarketingConsent, parseAttribution } from './attribution';
import { ShopAnalyticsService } from './shop-analytics.service';
import { MetaCapiClient } from './meta-capi.client';
import {
  buildMetaPurchaseEvent,
  conversionValue,
  purchaseEventId,
} from './meta-capi';

const logger = createLogger('ConversionEvents');

// One job per order, ever, no matter how many code paths report the order as
// converted (the first webhook, a redelivered webhook, the reconciliation sweep,
// order creation for a pay-on-delivery order). The unique index on
// job.idempotencyKey makes enqueue() return the existing row on a repeat.
export function capiPurchaseIdempotencyKey(orderId: number): string {
  return `capi:purchase:${orderId}`;
}

@Injectable()
export class ConversionEventsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobsService: JobsService,
    private readonly jobsWorkerService: JobsWorkerService,
    private readonly shopAnalyticsService: ShopAnalyticsService,
    private readonly metaCapiClient: MetaCapiClient,
  ) {}

  onModuleInit(): void {
    this.jobsWorkerService.registerHandler('send_conversion_event', (payload) =>
      this.sendConversion(payload as SendConversionEventJobPayload),
    );
  }

  // Called when an order becomes a conversion: created (pay-on-delivery /
  // pickup / fully covered by a gift card) or marked paid (online methods).
  // Never throws: a marketing signal must not be able to fail a checkout or a
  // payment webhook. Returns the job id, or null when nothing was queued.
  //
  // Queues NOTHING unless (a) the shop has a pixel id AND a CAPI token and (b)
  // this order recorded marketing consent. Consent that is NULL (unknown) counts
  // as "no": silence is not permission.
  async enqueuePurchase(orderId: number): Promise<number | null> {
    try {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id, shopId, total, currency, attributionJson
           FROM \`order\` WHERE id = ?`,
        [orderId],
      );
      const order = rows[0];
      if (!order) return null;
      if (!hasMarketingConsent(order.attributionJson)) return null;
      const shopId = order.shopId as number;
      const creds =
        await this.shopAnalyticsService.resolveMetaCapiCredentials(shopId);
      if (!creds) return null;

      const currency = order.currency as string;
      const job = await this.jobsService.enqueue(
        shopId,
        'send_conversion_event',
        {
          platform: 'meta',
          shopId,
          orderId,
          eventId: purchaseEventId(orderId),
          eventTime: Math.floor(Date.now() / 1000),
          value: conversionValue(trimDecimal(order.total as string), currency),
          currency,
        } satisfies SendConversionEventJobPayload,
        capiPurchaseIdempotencyKey(orderId),
      );
      return job.id;
    } catch (error) {
      // Message only: never the error object, which could carry a decrypted
      // value if a future change widens what is in scope above.
      logger.error('failed to enqueue conversion event', {
        orderId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // The job handler. Throws on a real delivery failure so the worker retries with
  // backoff and eventually dead-letters; returns quietly when there is simply
  // nothing (any longer) to send.
  async sendConversion(payload: SendConversionEventJobPayload): Promise<void> {
    if (payload.platform !== 'meta') return;
    if (!Number.isInteger(payload.shopId) || !Number.isInteger(payload.orderId)) {
      return;
    }
    // Tenant check: the order must belong to the shop the job was queued for.
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT o.id, o.customerEmail, o.customerPhone, o.attributionJson,
              s.subdomain AS shopSubdomain, s.domainType AS shopDomainType,
              s.customDomain AS shopCustomDomain,
              s.customDomainStatus AS shopCustomDomainStatus,
              s.countryCode AS shopCountryCode
         FROM \`order\` o JOIN shop s ON s.id = o.shopId
        WHERE o.id = ? AND o.shopId = ?`,
      [payload.orderId, payload.shopId],
    );
    const order = rows[0];
    if (!order) return;

    // Re-checked at send time, not just at enqueue: the guard has to hold on the
    // path that actually talks to the third party.
    if (!hasMarketingConsent(order.attributionJson)) return;
    const creds = await this.shopAnalyticsService.resolveMetaCapiCredentials(
      payload.shopId,
    );
    if (!creds) return;

    const items = await this.db.query<RowDataPacket[]>(
      `SELECT productId, quantity, priceAtPurchase FROM orderitem WHERE orderId = ?`,
      [payload.orderId],
    );

    const event = buildMetaPurchaseEvent({
      eventId: payload.eventId,
      eventTimeSeconds: payload.eventTime,
      value: payload.value,
      currency: payload.currency,
      orderId: payload.orderId,
      customerEmail: order.customerEmail as string | null,
      customerPhone: order.customerPhone as string | null,
      shopCountryCode: order.shopCountryCode as string | null,
      items: items.map((i) => ({
        productId: i.productId as number,
        quantity: i.quantity as number,
        unitPrice: trimDecimal(i.priceAtPurchase as string),
      })),
      attribution: parseAttribution(order.attributionJson),
      eventSourceUrl: storefrontUrl(
        {
          subdomain: order.shopSubdomain as string,
          domainType: order.shopDomainType as string | null,
          customDomain: order.shopCustomDomain as string | null,
          customDomainStatus: order.shopCustomDomainStatus as string | null,
        },
        `/orders/${payload.orderId}`,
      ),
    });

    await this.metaCapiClient.send({
      pixelId: creds.pixelId,
      accessToken: creds.accessToken,
      events: [event],
      testEventCode: creds.testEventCode,
    });
  }
}
