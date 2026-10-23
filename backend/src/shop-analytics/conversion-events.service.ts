import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { JobsWorkerService } from '../jobs/jobs.worker.service';
import type { SendConversionEventJobPayload } from '../jobs/jobs.types';
import { createLogger } from '../common/logging/logger';
import { trimDecimal } from '../database/decimal.util';
import { storefrontUrl } from '../common/storefront-url';
import { isMarketplaceChannel } from '../channels/marketplace-channels';
import { hasMarketingConsent, parseAttribution } from './attribution';
import { ShopAnalyticsService } from './shop-analytics.service';
import type { MetaCapiCredentials } from './shop-analytics.service';
import { MetaCapiClient } from './meta-capi.client';
import { TiktokEventsClient, buildTiktokPurchaseEvent } from './tiktok-events';
import { SnapCapiClient, buildSnapPurchaseEvent } from './snap-capi';
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

// One key per platform. Meta's stays exactly as it was (jobs already queued
// under it must still dedupe); the others are namespaced by platform.
export type ConversionPlatform = SendConversionEventJobPayload['platform'];
export function conversionIdempotencyKey(platform: ConversionPlatform, orderId: number): string {
  return platform === 'meta'
    ? capiPurchaseIdempotencyKey(orderId)
    : `capi:${platform}:purchase:${orderId}`;
}

// Where Meta is told the conversion happened: the shop's own storefront home.
// Never an order URL: neither the sequential order id nor the tracking token
// (a bearer capability) belongs in a request to a third party.
export function capiEventSourceUrl(order: Record<string, unknown>): string {
  return storefrontUrl(
    {
      subdomain: order.shopSubdomain as string,
      domainType: order.shopDomainType as string | null,
      customDomain: order.shopCustomDomain as string | null,
      customDomainStatus: order.shopCustomDomainStatus as string | null,
    },
    '/',
  );
}

@Injectable()
export class ConversionEventsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobsService: JobsService,
    private readonly jobsWorkerService: JobsWorkerService,
    private readonly shopAnalyticsService: ShopAnalyticsService,
    private readonly metaCapiClient: MetaCapiClient,
    private readonly tiktokEventsClient: TiktokEventsClient,
    private readonly snapCapiClient: SnapCapiClient,
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
  //
  // `paid: true` is passed ONLY by the paid-transition call sites in
  // PaymentsService. TikTok and Snap are queued only then: for a pay-on-delivery
  // / pickup order the browser still sends its own purchase from the checkout
  // page, and a server event too would count it twice. An online-payment order
  // is the one whose browser purchase is skipped (the confirmation URL carries a
  // bearer token), so the server event is its only record.
  async enqueuePurchase(
    orderId: number,
    opts: { paid?: boolean } = {},
  ): Promise<number | null> {
    try {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id, shopId, channel, total, currency, attributionJson
           FROM \`order\` WHERE id = ?`,
        [orderId],
      );
      const order = rows[0];
      if (!order) return null;
      // A marketplace customer is the marketplace's, never ours to report to an
      // ad platform (also checked at send time below).
      if (isMarketplaceChannel(order.channel as string | null)) return null;
      if (!hasMarketingConsent(order.attributionJson)) return null;
      const shopId = order.shopId as number;
      const currency = order.currency as string;
      const base = {
        shopId,
        orderId,
        eventId: purchaseEventId(orderId),
        eventTime: Math.floor(Date.now() / 1000),
        value: conversionValue(trimDecimal(order.total as string), currency),
        currency,
      };
      const wanted: ConversionPlatform[] = opts.paid
        ? ['meta', 'tiktok', 'snap']
        : ['meta'];
      // The Meta job id is returned for compatibility (null when Meta is not
      // configured); the other platforms are queued independently so one
      // platform's failure cannot block another.
      let metaJobId: number | null = null;
      for (const platform of wanted) {
        try {
          if (!(await this.resolveCredentials(platform, shopId))) continue;
          const job = await this.jobsService.enqueue(
            shopId,
            'send_conversion_event',
            { platform, ...base } satisfies SendConversionEventJobPayload,
            conversionIdempotencyKey(platform, orderId),
          );
          if (platform === 'meta') metaJobId = job.id;
        } catch (error) {
          logger.error('failed to enqueue conversion event', {
            orderId,
            platform,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return metaJobId;
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

  private resolveCredentials(platform: ConversionPlatform, shopId: number) {
    switch (platform) {
      case 'meta':
        return this.shopAnalyticsService.resolveMetaCapiCredentials(shopId);
      case 'tiktok':
        return this.shopAnalyticsService.resolveTiktokCredentials(shopId);
      case 'snap':
        return this.shopAnalyticsService.resolveSnapCredentials(shopId);
    }
  }

  // The job handler. Throws on a real delivery failure so the worker retries with
  // backoff and eventually dead-letters; returns quietly when there is simply
  // nothing (any longer) to send.
  async sendConversion(payload: SendConversionEventJobPayload): Promise<void> {
    const platform = payload.platform;
    if (platform !== 'meta' && platform !== 'tiktok' && platform !== 'snap') return;
    if (!Number.isInteger(payload.shopId) || !Number.isInteger(payload.orderId)) {
      return;
    }
    // Tenant check: the order must belong to the shop the job was queued for.
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT o.id, o.channel, o.customerEmail, o.customerPhone, o.attributionJson,
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
    if (isMarketplaceChannel(order.channel as string | null)) return;

    // Re-checked at send time, not just at enqueue: the guard has to hold on the
    // path that actually talks to the third party.
    if (!hasMarketingConsent(order.attributionJson)) return;
    const creds = await this.resolveCredentials(platform, payload.shopId);
    if (!creds) return;

    const items = await this.db.query<RowDataPacket[]>(
      `SELECT productId, quantity, priceAtPurchase FROM orderitem WHERE orderId = ?`,
      [payload.orderId],
    );

    const input = {
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
      eventSourceUrl: capiEventSourceUrl(order),
    };

    if (platform === 'meta') {
      const meta = creds as MetaCapiCredentials;
      await this.metaCapiClient.send({
        pixelId: meta.pixelId,
        accessToken: meta.accessToken,
        events: [buildMetaPurchaseEvent(input)],
        testEventCode: meta.testEventCode,
      });
      return;
    }
    // TikTok / Snap: queued from the paid transition alone (see enqueuePurchase).
    if (platform === 'tiktok') {
      await this.tiktokEventsClient.send({
        pixelCode: creds.pixelId,
        accessToken: creds.accessToken,
        events: [buildTiktokPurchaseEvent(input)],
      });
    } else {
      await this.snapCapiClient.send({
        pixelId: creds.pixelId,
        accessToken: creds.accessToken,
        events: [buildSnapPurchaseEvent(input)],
      });
    }
  }
}
