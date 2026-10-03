import { roundMoney, minorUnitFactor } from '../common/currency-minor-units';

// The purchase order state machine, as data, so the service's compare-and-swap
// UPDATEs and the unit tests read the same table.
//
//   draft --send--> sent --receive--> partially_received --receive--> received
//   draft|sent --cancel--> cancelled
//
// What is deliberately NOT here: cancelling after any stock has been received.
// Received stock is never reversed in v1 (that would be a supplier return, a
// different document), so partially_received has no path to cancelled, and a
// short-shipped PO simply stays partially_received.
export const PO_STATUSES = [
  'draft',
  'sent',
  'partially_received',
  'received',
  'cancelled',
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const PO_TRANSITIONS: Record<PoStatus, readonly PoStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['partially_received', 'received', 'cancelled'],
  partially_received: ['partially_received', 'received'],
  received: [],
  cancelled: [],
};

export const RECEIVABLE_STATUSES: readonly PoStatus[] = [
  'sent',
  'partially_received',
];
export const CANCELLABLE_STATUSES: readonly PoStatus[] = ['draft', 'sent'];

export function canTransition(from: PoStatus, to: PoStatus): boolean {
  return PO_TRANSITIONS[from].includes(to);
}

// After a receipt: 'received' once every line has arrived in full, otherwise
// 'partially_received'.
export function statusAfterReceipt(
  lines: { quantityOrdered: number; quantityReceived: number }[],
): 'received' | 'partially_received' {
  return lines.every((l) => l.quantityReceived >= l.quantityOrdered)
    ? 'received'
    : 'partially_received';
}

// One line's amount, rounded ONCE to the currency's minor unit (3 decimals for
// KWD/BHD/OMR, 2 otherwise). The unit cost itself is a rate and is not rounded.
export function lineAmount(
  quantity: number,
  unitCost: number,
  currency: string,
): number {
  return roundMoney(quantity * unitCost, currency);
}

// A document total is the sum of its (already rounded) line amounts, added in
// INTEGER minor units so the column reads as an exact sum and float drift can
// never put a stray fils on it. Never sums across currencies: one currency in.
export function sumAmounts(amounts: number[], currency: string): number {
  const factor = minorUnitFactor(currency);
  const minor = amounts.reduce((acc, a) => acc + Math.round(a * factor), 0);
  return minor / factor;
}

export function formatPoNumber(n: number): string {
  return `PO-${String(n).padStart(4, '0')}`;
}

// The DTO regex only checks the shape, and MySQL rejects an impossible date like
// 2026-13-45 with a raw 500. A real calendar date round-trips unchanged.
export function isRealDateKey(value: string): boolean {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
