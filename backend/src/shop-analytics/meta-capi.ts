import { createHash } from 'crypto';
import { normalizePhoneToE164 } from '../common/phone';
import { toMajorUnitString } from '../common/currency-minor-units';
import type { AttributionData } from './attribution';

// The id both the browser's purchase event and the server event carry, so Meta
// deduplicates the pair into one conversion. Mirrored by hand in
// storefront/lib/analytics.ts (purchaseEventId): change both together.
export function purchaseEventId(orderId: number): string {
  return `order_${orderId}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// Meta's normalisation rules for matching, applied BEFORE hashing: an email is
// trimmed and lower-cased; a phone is digits only, with the country code and no
// leading zeros or plus. A value that cannot be normalised is omitted, never
// sent raw and never sent as a hash of garbage.
export function hashedEmail(email: string | null | undefined): string | null {
  const normalised = email?.trim().toLowerCase();
  if (!normalised || !normalised.includes('@')) return null;
  return sha256Hex(normalised);
}

export function hashedPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const e164 = normalizePhoneToE164(phone);
  if (!e164) return null;
  return sha256Hex(e164.replace(/\D/g, ''));
}

export interface PurchaseEventInput {
  eventId: string;
  eventTimeSeconds: number;
  // Major units as a decimal string, in `currency`'s own precision.
  value: string;
  currency: string;
  orderId: number;
  customerEmail: string | null;
  customerPhone: string | null;
  items: { productId: number; quantity: number; unitPrice: string }[];
  attribution: AttributionData | null;
  eventSourceUrl: string;
}

// One Conversions API event. Only hashes of the contact fields leave this
// process, and fbp / fbc / user agent are included only when attribution carries
// them (sanitizeAttribution only keeps them when marketing consent was true).
export function buildMetaPurchaseEvent(input: PurchaseEventInput) {
  const userData: Record<string, unknown> = {};
  const em = hashedEmail(input.customerEmail);
  const ph = hashedPhone(input.customerPhone);
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (input.attribution?.fbp) userData.fbp = input.attribution.fbp;
  if (input.attribution?.fbc) userData.fbc = input.attribution.fbc;
  if (input.attribution?.clientUserAgent) {
    userData.client_user_agent = input.attribution.clientUserAgent;
  }
  return {
    event_name: 'Purchase',
    event_time: input.eventTimeSeconds,
    event_id: input.eventId,
    action_source: 'website',
    event_source_url: input.eventSourceUrl,
    user_data: userData,
    custom_data: {
      value: Number(input.value),
      currency: input.currency,
      order_id: String(input.orderId),
      content_type: 'product',
      content_ids: input.items.map((i) => String(i.productId)),
      contents: input.items.map((i) => ({
        id: String(i.productId),
        quantity: i.quantity,
        item_price: Number(i.unitPrice),
      })),
      num_items: input.items.reduce((n, i) => n + i.quantity, 0),
    },
  };
}

// Order total, captured in the order's OWN currency at its own precision (three
// decimals for KWD): never today's shop currency, never a 2dp round.
export function conversionValue(total: string | number, currency: string): string {
  return toMajorUnitString(Number(total), currency);
}
