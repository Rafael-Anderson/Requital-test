import { ChannelParseError } from './channel.types';
import type { CanonicalChannelOrder } from './channel.types';

// The ingestion core validates every canonical order a provider hands it, so a
// buggy provider fails loudly in the inbox (status `dead`) instead of writing a
// wrong figure into an order. Providers may call it on their own output too.

const MAX_LINES = 200;
const HANDOVERS = [
  'marketplace_courier',
  'merchant_delivery',
  'customer_pickup',
];

function fail(message: string): never {
  throw new ChannelParseError(message);
}

function isMinor(n: unknown, allowNegative = false): n is number {
  return (
    typeof n === 'number' &&
    Number.isSafeInteger(n) &&
    (allowNegative || n >= 0)
  );
}

function nullableMinor(n: unknown, field: string): void {
  if (n !== null && !isMinor(n))
    fail(`${field} must be a non-negative integer or null`);
}

function nullableText(v: unknown, field: string, max: number): void {
  if (v !== null && (typeof v !== 'string' || v.length > max))
    fail(`${field} must be a string up to ${max} characters or null`);
}

function nullableIso(v: unknown, field: string): void {
  if (v === null) return;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v)))
    fail(`${field} must be an ISO date string or null`);
}

export function assertCanonicalOrder(o: CanonicalChannelOrder): void {
  if (!o || typeof o !== 'object') fail('order missing');
  if (
    typeof o.externalOrderId !== 'string' ||
    o.externalOrderId.length < 1 ||
    o.externalOrderId.length > 191
  )
    fail('externalOrderId must be 1 to 191 characters');
  nullableText(o.displayId, 'displayId', 64);
  if (
    typeof o.externalStatus !== 'string' ||
    o.externalStatus.length < 1 ||
    o.externalStatus.length > 32
  )
    fail('externalStatus must be 1 to 32 characters');
  nullableIso(o.placedAt, 'placedAt');
  nullableIso(o.acceptBy, 'acceptBy');
  nullableIso(o.scheduledFor, 'scheduledFor');
  if (typeof o.currency !== 'string' || !/^[A-Z]{3}$/.test(o.currency))
    fail('currency must be a 3-letter upper-case ISO code');
  if (!HANDOVERS.includes(o.handover)) fail('handover is not recognised');
  if (
    !Array.isArray(o.lines) ||
    o.lines.length < 1 ||
    o.lines.length > MAX_LINES
  )
    fail(`an order needs 1 to ${MAX_LINES} lines`);
  for (const [i, l] of o.lines.entries()) {
    if (
      typeof l.externalItemId !== 'string' ||
      l.externalItemId.length < 1 ||
      l.externalItemId.length > 191
    )
      fail(`lines[${i}].externalItemId must be 1 to 191 characters`);
    if (typeof l.name !== 'string' || l.name.length > 255)
      fail(`lines[${i}].name must be a string up to 255 characters`);
    if (
      !Number.isSafeInteger(l.quantity) ||
      l.quantity < 1 ||
      l.quantity > 10000
    )
      fail(`lines[${i}].quantity must be an integer from 1 to 10000`);
    if (!isMinor(l.unitPriceMinor))
      fail(`lines[${i}].unitPriceMinor must be a non-negative integer`);
    nullableMinor(l.discountMinor, `lines[${i}].discountMinor`);
    nullableMinor(l.taxMinor, `lines[${i}].taxMinor`);
    nullableText(l.note, `lines[${i}].note`, 1000);
  }
  const t = o.totals;
  if (!t || typeof t !== 'object') fail('totals missing');
  if (!isMinor(t.totalMinor))
    fail('totals.totalMinor must be a non-negative integer');
  for (const k of [
    'subtotalMinor',
    'deliveryFeeMinor',
    'discountMinor',
    'taxMinor',
    'commissionMinor',
    'cashDueMinor',
  ] as const)
    nullableMinor(t[k], `totals.${k}`);
  const c = o.customer;
  if (!c || typeof c !== 'object') fail('customer missing');
  nullableText(c.name, 'customer.name', 255);
  nullableText(c.phone, 'customer.phone', 64);
  nullableText(c.address, 'customer.address', 1000);
  nullableText(c.notes, 'customer.notes', 1000);
}
