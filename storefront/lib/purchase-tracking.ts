// The browser half of the purchase conversion.
//
// A pay-on-delivery / pickup order is a conversion the moment checkout returns, so
// the event is sent there. An ONLINE-payment order leaves the site for the
// gateway's page, so the data for the event is parked in sessionStorage, and sent
// when the customer lands back on /orders/<trackingToken> and the SERVER reports
// the order paid (the stash is taken, so a reload cannot send it twice). That URL
// carries a bearer token, so lib/analytics.ts sends it to GA4 / Google Ads only
// (redacted) and SKIPS Meta, TikTok and Snap. The authoritative record of an online
// payment for those three is the server-side event (Meta Conversions API, TikTok
// Events API, Snap Conversions API), queued when the payment webhook (or the
// reconciliation sweep) marks the order paid. Every event carries purchaseEventId
// so a platform can deduplicate a pair when both do arrive (UNVERIFIED for TikTok
// and Snap).
import { purchaseEventId, type AnalyticsItem, type AnalyticsPayload } from "./analytics";

function key(orderId: number | string): string {
  return `requital_purchase:${orderId}`;
}

export function buildPurchasePayload(
  order: { id: number; total: string; currency: string },
  items: AnalyticsItem[],
): AnalyticsPayload {
  return {
    transactionId: String(order.id),
    eventId: purchaseEventId(order.id),
    // The order's own captured total and currency, never recomputed here.
    value: Number(order.total),
    currency: order.currency,
    items,
  };
}

export function stashPurchase(orderId: number, payload: AnalyticsPayload): void {
  try {
    sessionStorage.setItem(key(orderId), JSON.stringify(payload));
  } catch {
    // best effort: the server-side event does not depend on this
  }
}

// Returns and removes the stashed payload (null if none, or already taken).
export function takeStashedPurchase(orderId: number | string): AnalyticsPayload | null {
  try {
    const raw = sessionStorage.getItem(key(orderId));
    if (!raw) return null;
    sessionStorage.removeItem(key(orderId));
    return JSON.parse(raw) as AnalyticsPayload;
  } catch {
    return null;
  }
}
