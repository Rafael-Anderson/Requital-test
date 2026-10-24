import { Injectable } from '@nestjs/common';
import type { PurchaseEventInput } from './meta-capi';
import {
  TIKTOK_ASSUMPTIONS as A,
  hashEmailForAdPlatform,
  hashPhoneForAdPlatform,
} from './conversion-platform-assumptions';

const TIMEOUT_MS = 10_000;

// One TikTok Events API purchase event (wire shape UNVERIFIED, see
// conversion-platform-assumptions.ts). Only hashes of contact fields leave this
// process. ttclid / user agent are present only when attribution carries them,
// i.e. only when marketing consent was recorded. NO client IP, deliberately.
export function buildTiktokPurchaseEvent(input: PurchaseEventInput) {
  const user: Record<string, unknown> = {};
  const email = hashEmailForAdPlatform(input.customerEmail);
  const phone = hashPhoneForAdPlatform(
    input.customerPhone,
    input.shopCountryCode,
    A.phoneIncludesPlus,
  );
  if (email) user.email = email;
  if (phone) user.phone = phone;
  const ttclid = input.attribution?.lastTouch?.ttclid ?? input.attribution?.firstTouch?.ttclid;
  if (ttclid) user.ttclid = ttclid;
  if (input.attribution?.clientUserAgent) user.user_agent = input.attribution.clientUserAgent;
  return {
    event: A.eventName,
    event_time: input.eventTimeSeconds,
    event_id: input.eventId,
    user,
    page: { url: input.eventSourceUrl },
    properties: {
      currency: input.currency,
      value: Number(input.value),
      order_id: String(input.orderId),
      content_type: 'product',
      contents: input.items.map((i) => ({
        content_id: String(i.productId),
        quantity: i.quantity,
        price: Number(i.unitPrice),
      })),
    },
  };
}

// The single place a request to TikTok is made; an injectable class so tests
// replace it and no test ever calls the real API.
//
// SECRET HANDLING (same as MetaCapiClient). The token goes in a request header,
// never the URL or body; a thrown error carries the HTTP status and TikTok's
// numeric error code only, never the response body or the original error, so the
// token cannot reach a job's lastError, a log line or a dead-letter view.
@Injectable()
export class TiktokEventsClient {
  async send(params: {
    pixelCode: string;
    accessToken: string;
    events: unknown[];
  }): Promise<void> {
    let res: Response;
    try {
      res = await fetch(A.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [A.tokenHeader]: params.accessToken,
        },
        body: JSON.stringify({
          event_source: A.eventSource,
          event_source_id: params.pixelCode,
          data: params.events,
        }),
        // A custom auth header would survive a cross-origin redirect.
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error('TikTok Events API request failed (network error)');
    }
    // UNVERIFIED: TikTok may answer HTTP 200 with a non-zero `code` in the body.
    let code = '';
    let bodyFailed = false;
    try {
      const json = (await res.json()) as { code?: number };
      if (typeof json.code === 'number') {
        code = ` code=${json.code}`;
        bodyFailed = json.code !== 0;
      }
    } catch {
      // unparseable body: status alone is enough
    }
    if (!res.ok || bodyFailed) {
      throw new Error(`TikTok Events API request failed (HTTP ${res.status})${code}`);
    }
  }
}
