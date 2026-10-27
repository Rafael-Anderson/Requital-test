import { minorUnitFactor } from '../common/currency-minor-units';

// Loyalty arithmetic, all in integers (BigInt where a product can pass 2^53).
// Rates are exact decimal strings with at most 4 places, read as value * 10000.

// Safe ceilings. 1000 points per currency unit is far above any real program, and
// a single order can never earn more than MAX_ORDER_POINTS, so a ledger row can
// never leave the INT range (2,147,483,647) whatever the order size or the rate.
export const MAX_EARN_RATE = 1000;
export const MAX_REDEEM_POINTS_PER_UNIT = 1_000_000;
export const MAX_ORDER_POINTS = 1_000_000_000;

export const EARN_BASES = ['net_paid', 'items_after_discount'] as const;
export type EarnBase = (typeof EARN_BASES)[number];

// "1.5" -> 15000n. Returns null for anything that is not a plain non-negative
// decimal with at most 4 places and 8 whole digits (so no exponent, no sign).
export function parseRate(raw: unknown): bigint | null {
  const text =
    typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw;
  if (typeof text !== 'string') return null;
  const m = /^(\d{1,8})(?:\.(\d{1,4}))?$/.exec(text.trim());
  if (!m) return null;
  return BigInt(m[1]) * 10000n + BigInt((m[2] ?? '').padEnd(4, '0'));
}

// Order money as it is stored (DECIMAL(65,30)) -> integer minor units.
export function toMinor(value: unknown, currency: string): number {
  return Math.round(Number(value ?? 0) * minorUnitFactor(currency));
}

export interface EarnOrderFigures {
  total: unknown;
  deliveryFee: unknown;
  taxAmount: unknown;
  giftCardAmount: unknown;
  storeCreditAmount: unknown;
  currency: string;
}

// THE EARN BASE (documented rule, in minor units, never negative):
//   net_paid             total - delivery fee - tax - gift-card tender - store-credit tender
//   items_after_discount total - delivery fee - tax
// `total` is what the customer owes for the order, already net of any discount
// and (on a tax-inclusive shop) containing the tax; gift card and store credit are
// payment instruments, not price reductions, so they sit inside `total` and the
// default base takes them back out: points follow money the shop actually
// received, not money it paid itself.
export function earnBaseMinor(o: EarnOrderFigures, base: EarnBase): number {
  const c = o.currency;
  let minor =
    toMinor(o.total, c) - toMinor(o.deliveryFee, c) - toMinor(o.taxAmount, c);
  if (base === 'net_paid') {
    minor -= toMinor(o.giftCardAmount, c) + toMinor(o.storeCreditAmount, c);
  }
  return Math.max(0, minor);
}

// Points for a base: floor(base in major units * rate). Rounded DOWN, always.
export function earnPoints(
  baseMinor: number,
  rate10000: bigint,
  currency: string,
): number {
  if (baseMinor <= 0 || rate10000 <= 0n) return 0;
  const pts =
    (BigInt(baseMinor) * rate10000) /
    (BigInt(minorUnitFactor(currency)) * 10000n);
  return Math.min(Number(pts), MAX_ORDER_POINTS);
}

// Cumulative points to have taken back once `refundedMinor` of an order's
// refundable money has gone back: floor(earned * refunded / refundable), capped at
// everything earned. The per-return amount is this minus what earlier returns
// already took (gross, shortfall included), so partial returns sum EXACTLY and
// the return that completes the refund takes the remainder.
export function clawbackTarget(
  earned: number,
  refundedMinor: number,
  refundableMinor: number,
): number {
  if (earned <= 0 || refundedMinor <= 0 || refundableMinor <= 0) return 0;
  const ref = Math.min(refundedMinor, refundableMinor);
  return Number((BigInt(earned) * BigInt(ref)) / BigInt(refundableMinor));
}

// Store credit (minor units) that `points` buy at `pointsPerUnit10000`
// (points per ONE currency unit, *10000). Rounded down.
export function redeemCreditMinor(
  points: number,
  pointsPerUnit10000: bigint,
  currency: string,
): number {
  if (points <= 0 || pointsPerUnit10000 <= 0n) return 0;
  return Number(
    (BigInt(points) * BigInt(minorUnitFactor(currency)) * 10000n) /
      pointsPerUnit10000,
  );
}
