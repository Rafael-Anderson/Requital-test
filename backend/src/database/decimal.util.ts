// mysql2 (with decimalNumbers:false) returns DECIMAL columns as JS strings
// carrying the column's full declared scale. Every money/measurement
// DECIMAL column in this schema is DECIMAL(65,30) (see prisma/migrations),
// so a value like 75 round-trips as "75.000000000000000000000000000000"
// instead of Prisma.Decimal's own trimmed "75" — trim it back here so API
// responses keep their pre-migration shape.
export function trimDecimal(value: string): string;
export function trimDecimal(value: string | null): string | null;
export function trimDecimal(value: string | null): string | null {
  if (value === null) return null;
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

// Shared field-list trim for a raw `order` row (plus its raw `orderitem`
// rows) fetched via a plain `SELECT *`, for any call site that assembles
// its own order response without going through OrdersService.findOne's
// already-correct toResponse/toDetailResponse (e.g. CustomersService's own
// order-history query) — same trimmed fields, same untrimmed-DECIMAL(65,30)
// bug class those two guard against, extracted here rather than duplicated
// inline or by injecting OrdersService into a second service just for this.
// Loosely typed on purpose: both callers work with raw mysql2 rows
// (RowDataPacket, effectively `any`-valued per column), not a strongly
// typed assembled order — matching that existing convention rather than
// fighting it.
export function trimOrderRow<
  T extends {
    deliveryFee?: unknown;
    taxAmount?: unknown;
    discountAmount?: unknown;
    giftCardAmount?: unknown;
    total?: unknown;
    orderitem?: { priceAtPurchase?: unknown; autoDiscountAmount?: unknown }[];
  },
>(order: T): T {
  return {
    ...order,
    deliveryFee: trimDecimal(order.deliveryFee as string | null),
    taxAmount: trimDecimal(order.taxAmount as string | null),
    discountAmount: trimDecimal(order.discountAmount as string | null),
    giftCardAmount: trimDecimal(order.giftCardAmount as string | null),
    total: trimDecimal(order.total as string) as string,
    orderitem: order.orderitem?.map((i) => ({
      ...i,
      priceAtPurchase: trimDecimal(i.priceAtPurchase as string),
      autoDiscountAmount: trimDecimal(i.autoDiscountAmount as string | null),
    })),
  };
}
