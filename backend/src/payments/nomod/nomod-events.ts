import { createHash } from 'crypto';
import { minorUnitDecimals } from '../../common/currency-minor-units';

// Only charge.completed has a published example payload, so everything here is
// parsed defensively: a field that is absent or the wrong type becomes null and is
// named in `missing`, never a thrown error and never a guessed value.

export const NOMOD_EVENT_TYPES = [
  'charge.created',
  'charge.authorised',
  'charge.completed',
  'charge.failed',
  'charge.cancelled',
  'charge.refunded',
  'charge.partially_refunded',
  'charge.dispute.created',
] as const;
export type NomodEventType = (typeof NOMOD_EVENT_TYPES)[number];

export interface NomodEvent {
  eventId: string;
  // The raw type string. May be a type we do not know (it is then ignored).
  type: string;
  objectId: string | null;
  referenceId: string | null;
  currency: string | null;
  // data.total as exact integer minor units of `currency`, or null when absent,
  // unreadable, or carrying more precision than the currency has.
  totalMinor: number | null;
  refundTotalMinor: number | null;
  status: string | null;
  // Names of the fields that were expected for this event type and not usable.
  missing: string[];
}

// An exact decimal -> minor units: no rounding. "45.00" and "45" are 4500 AED
// minor units; "45.005" is null (a payment is never matched on a rounded figure).
export function exactMinor(
  value: unknown,
  currency: string | null,
): number | null {
  if (!currency) return null;
  let text: string;
  if (typeof value === 'string') text = value.trim();
  else if (typeof value === 'number' && Number.isFinite(value))
    text = String(value);
  else return null;
  const m = /^(\d{1,15})(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const decimals = minorUnitDecimals(currency);
  const frac = m[2] ?? '';
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) return null;
  const minor = BigInt(m[1] + frac.slice(0, decimals).padEnd(decimals, '0'));
  return minor > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(minor);
}

function str(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

// Parses a verified delivery body. Returns null for a body that is not a JSON
// object (the caller answers 200 and ignores it: Nomod must not be made to retry
// something we will never understand).
export function parseNomodEvent(raw: Buffer): NomodEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const root = json as Record<string, unknown>;
  const data =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : {};

  const type = str(root.type, 64);
  if (!type) return null;
  // No eventId: key the dedupe on the body itself, so the SAME delivery repeated
  // still dedupes and a different one does not.
  const eventId =
    str(root.eventId, 100) ??
    `body:${createHash('sha256').update(raw).digest('hex').slice(0, 40)}`;

  const currencyRaw = str(data.currency, 3);
  const currency = currencyRaw ? currencyRaw.toUpperCase() : null;
  const totalMinor = exactMinor(data.total, currency);
  const refundTotalMinor = exactMinor(data.refundTotal, currency);

  const missing: string[] = [];
  const referenceId = str(data.referenceId, 100);
  if (!referenceId) missing.push('data.referenceId');
  if (type === 'charge.completed') {
    if (!currency) missing.push('data.currency');
    if (totalMinor === null) missing.push('data.total');
  }
  if (
    (type === 'charge.refunded' || type === 'charge.partially_refunded') &&
    refundTotalMinor === null
  ) {
    missing.push('data.refundTotal');
  }

  return {
    eventId,
    type,
    objectId: str(root.objectId, 100),
    referenceId,
    currency,
    totalMinor,
    refundTotalMinor,
    status: str(data.status, 40),
    missing,
  };
}
