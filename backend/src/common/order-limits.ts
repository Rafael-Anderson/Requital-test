import { BadRequestException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../database/database.service';

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

export interface OrderSize {
  lines: number;
  units: number;
  giftCards: number;
  maxLine: number;
}

export function measureOrder(
  lines: { quantity: number; product?: object }[],
): OrderSize {
  let units = 0;
  let giftCards = 0;
  let maxLine = 0;
  for (const l of lines) {
    units += l.quantity;
    maxLine = Math.max(maxLine, l.quantity);
    if ((l.product as { isGiftCard?: unknown } | undefined)?.isGiftCard) {
      giftCards += l.quantity;
    }
  }
  return { lines: lines.length, units, giftCards, maxLine };
}

// The size an existing order or draft holds today, for an edit that is judged
// against what it replaces. Read by the caller BEFORE its transaction (it uses
// the pool). The id must already have been resolved shop-scoped by the caller.
export async function loadStoredOrderSize(
  db: DatabaseService,
  source:
    | { table: 'orderitem'; fk: 'orderId' }
    | { table: 'draftorderitem'; fk: 'draftOrderId' },
  id: number,
): Promise<OrderSize> {
  const rows = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(i.quantity), 0) AS units,
            COALESCE(MAX(i.quantity), 0) AS maxLine,
            COALESCE(SUM(CASE WHEN p.isGiftCard = 1 THEN i.quantity ELSE 0 END), 0) AS gc
       FROM ${source.table} i LEFT JOIN product p ON p.id = i.productId
      WHERE i.${source.fk} = ?`,
    [id],
  );
  const r = rows[0];
  return {
    lines: Number(r.n),
    units: Number(r.units),
    giftCards: Number(r.gc),
    maxLine: Number(r.maxLine),
  };
}

// Called with the RESOLVED lines (after ProductsService.resolveOrderItems, so
// the product's own isGiftCard flag is trusted, never the client's) by every
// path that prices or writes an order: public createOrder, the delivery quote,
// public discount validate, admin create, updateItems, draft-order create and
// update (a draft completes through OrdersService.create). Deliberately NOT
// inside resolveOrderItems: marketplace ingestion also uses it, and an order
// the marketplace already accepted must not be refused on size.
//
// `previous` is the size of the order or draft being edited. An order that
// predates these limits may already be over one: an edit may still LOWER it, so
// a limit only refuses a result that exceeds it AND is larger than before in
// that same dimension.
export function assertOrderWithinLimits(
  lines: { quantity: number; product?: object }[],
  previous?: OrderSize,
): void {
  const now = measureOrder(lines);
  const over = (value: number, cap: number, was: number | undefined) =>
    value > cap && (was === undefined || value > was);
  if (over(now.lines, MAX_ORDER_LINES, previous?.lines)) {
    throw new BadRequestException(
      `Maximum ${MAX_ORDER_LINES} different items per order`,
    );
  }
  if (over(now.maxLine, MAX_LINE_QUANTITY, previous?.maxLine)) {
    throw new BadRequestException(
      `Maximum ${MAX_LINE_QUANTITY} per item per order`,
    );
  }
  if (over(now.units, MAX_ORDER_UNITS, previous?.units)) {
    throw new BadRequestException(`Maximum ${MAX_ORDER_UNITS} items per order`);
  }
  if (over(now.giftCards, MAX_GIFT_CARD_UNITS, previous?.giftCards)) {
    throw new BadRequestException(
      `Maximum ${MAX_GIFT_CARD_UNITS} gift cards per order`,
    );
  }
}
