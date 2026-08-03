// Plain strings, not a Prisma enum — matches every other discriminated
// field in this schema (order.status, discount.type, etc).
export const DRAFT_ORDER_STATUSES = [
  'OPEN',
  'INVOICE_SENT',
  'COMPLETED',
  'CANCELLED',
] as const;
export type DraftOrderStatus = (typeof DRAFT_ORDER_STATUSES)[number];
