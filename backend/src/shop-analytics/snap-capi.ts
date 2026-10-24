import { Injectable } from '@nestjs/common';
import type { PurchaseEventInput } from './meta-capi';
import {
  SNAP_ASSUMPTIONS as A,
  hashEmailForAdPlatform,
  hashPhoneForAdPlatform,
} from './conversion-platform-assumptions';

const TIMEOUT_MS = 10_000;

// One Snap Conversions API purchase event (wire shape UNVERIFIED, see
// conversion-platform-assumptions.ts). Hashes only; user agent only under
// recorded marketing consent; NO client IP, deliberately. A Snap click id is not
// captured by the storefront yet (follow-up), so none is sent.
export function buildSnapPurchaseEvent(input: PurchaseEventInput) {
  const userData: Record<string, unknown> = {};
  const em = hashEmailForAdPlatform(input.customerEmail);
  const ph = hashPhoneForAdPlatform(input.customerPhone, input.shopCountryCode, A.phoneIncludesPlus);
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (input.attribution?.clientUserAgent) userData.client_user_agent = input.attribution.clientUserAgent;
  return {
    event_name: A.eventName,
    action_source: A.actionSource,
    event_time: input.eventTimeSeconds,
    event_id: input.eventId,
    event_source_url: input.eventSourceUrl,
    user_data: userData,
    custom_data: {
      value: Number(input.value),
      currency: input.currency,
      order_id: String(input.orderId),
      content_ids: input.items.map((i) => String(i.productId)),
      num_items: input.items.reduce((n, i) => n + i.quantity, 0),
    },
  };
}

// Same secret handling as TiktokEventsClient / MetaCapiClient: token in a header
// only, errors built from HTTP status plus Snap's reason code only.
@Injectable()
export class SnapCapiClient {
  async send(params: {
    pixelId: string;
    accessToken: string;
    events: unknown[];
  }): Promise<void> {
    let res: Response;
    try {
      res = await fetch(A.endpoint.replace('{pixelId}', encodeURIComponent(params.pixelId)), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [A.tokenHeader]: `Bearer ${params.accessToken}`,
        },
        body: JSON.stringify({ data: params.events }),
        // A custom auth header would survive a cross-origin redirect.
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error('Snap Conversions API request failed (network error)');
    }
    if (!res.ok) {
      let code = '';
      try {
        // UNVERIFIED error body shape.
        const json = (await res.json()) as { status?: string; reason?: string; error?: { code?: string | number } };
        const c = json.error?.code ?? json.status;
        if (c !== undefined && /^[A-Za-z0-9_.-]{1,40}$/.test(String(c))) code = ` code=${String(c)}`;
      } catch {
        // unparseable body: status alone is enough
      }
      throw new Error(`Snap Conversions API request failed (HTTP ${res.status})${code}`);
    }
  }
}
