import { BadRequestException } from '@nestjs/common';

// One source for how big a single order may be. Mirrored by hand in
// storefront/lib/cart.tsx (the apps share no code; change both together).
// A per-shop override is a follow-up: nothing here reads a shop setting.
export const MAX_LINE_QUANTITY = 999; // units of one line (DTO @Max)
export const MAX_ORDER_LINES = 100; // lines in one request (DTO @ArrayMaxSize)
export const MAX_ORDER_UNITS = 1000; // units across the whole order
// Gift cards are issued one INSERT per unit inside the order transaction
// (GiftCardsService.issueForOrder) and emailed in one message, so this caps
// the transaction itself, across every gift-card line of the order.
export const MAX_GIFT_CARD_UNITS = 20;

// Called with the RESOLVED lines (after ProductsService.resolveOrderItems, so
// the product's own isGiftCard flag is trusted, never the client's) by every
// path that prices or writes an order: public createOrder, the delivery quote,
// public discount validate, admin create, updateItems, draft-order create and
// update (a draft completes through OrdersService.create). Deliberately NOT
// inside resolveOrderItems: marketplace ingestion also uses it, and an order
// the marketplace already accepted must not be refused on size.
export function assertOrderWithinLimits(
  lines: { quantity: number; product?: object }[],
): void {
  if (lines.length > MAX_ORDER_LINES) {
    throw new BadRequestException(
      `Maximum ${MAX_ORDER_LINES} different items per order`,
    );
  }
  let units = 0;
  let giftCards = 0;
  for (const l of lines) {
    if (l.quantity > MAX_LINE_QUANTITY) {
      throw new BadRequestException(
        `Maximum ${MAX_LINE_QUANTITY} per item per order`,
      );
    }
    units += l.quantity;
    if ((l.product as { isGiftCard?: unknown } | undefined)?.isGiftCard)
      giftCards += l.quantity;
  }
  if (units > MAX_ORDER_UNITS) {
    throw new BadRequestException(
      `Maximum ${MAX_ORDER_UNITS} items per order`,
    );
  }
  if (giftCards > MAX_GIFT_CARD_UNITS) {
    throw new BadRequestException(
      `Maximum ${MAX_GIFT_CARD_UNITS} gift cards per order`,
    );
  }
}
