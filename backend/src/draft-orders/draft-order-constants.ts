// Plain strings, not a Prisma enum — matches every other discriminated
// field in this schema (order.status, discount.type, etc).
//
// OPEN             a draft being built.
// INVOICE_SENT     a payment link was created ("link sent"); the draft is
//                  still a draft: no order, no stock held, not on the kanban.
// AWAITING_PAYMENT the customer pressed Pay: the draft converted into a pending,
//                  unpaid card order (convertedOrderId) waiting for the gateway.
// COMPLETED        converted for good: paid by link, COD, or marked paid.
// CANCELLED        cancelled by staff.
export const DRAFT_ORDER_STATUSES = [
  'OPEN',
  'INVOICE_SENT',
  'AWAITING_PAYMENT',
  'COMPLETED',
  'CANCELLED',
] as const;
export type DraftOrderStatus = (typeof DRAFT_ORDER_STATUSES)[number];

// The list filters the admin offers, mapped onto statuses.
export const DRAFT_ORDER_FILTERS: Record<string, DraftOrderStatus[]> = {
  open: ['OPEN'],
  link_sent: ['INVOICE_SENT', 'AWAITING_PAYMENT'],
  converted: ['COMPLETED'],
  cancelled: ['CANCELLED'],
};

export const MANUAL_PAYMENT_METHODS = [
  'cash',
  'bank_transfer',
  'card_terminal',
  'other',
] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

// How long a payment link stays payable.
export const PAY_LINK_EXPIRY_DAYS = 30;

// A Pay press holds the draft for this long while it converts and asks the
// gateway; a crashed request cannot block the link for longer.
export const CONVERSION_LEASE_SECONDS = 120;

// /pay/<token>: 128 random bits as 32 hex characters.
export const PAY_TOKEN_SHAPE = /^[0-9a-f]{32}$/i;

export const MAX_REASON_LENGTH = 255;
