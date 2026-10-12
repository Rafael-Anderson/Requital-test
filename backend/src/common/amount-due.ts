import { decimalToMinor, minorToDecimal } from '../drivers/cash';

// What is still to be collected for an order: total - gift card - store credit,
// in integer minor units of the ORDER's own currency, exact decimal parsing (no
// float multiply), never below zero. The one definition every "how much do we
// ask for" reader shares (gateway session, /pay summary, packing slip, driver
// cash, webhook transaction row), so none of them can drift back to order.total.
//
// A figure that cannot be parsed counts as 0 for the two deductions (NULL means
// "none used") but as 0 due for the total, which is the safe direction for a
// reader that would otherwise ask for money.
// Reads total, giftCardAmount, storeCreditAmount and currency off any order-shaped
// row (DB row or plain object).
export type AmountDueOrder = Record<string, unknown>;

export function amountDueMinor(order: AmountDueOrder): number {
  const currency = order.currency as string | null | undefined;
  const minor = (v: unknown) =>
    typeof v === 'string' || typeof v === 'number'
      ? (decimalToMinor(String(v), currency) ?? 0)
      : 0;
  return Math.max(
    minor(order.total) -
      minor(order.giftCardAmount) -
      minor(order.storeCreditAmount),
    0,
  );
}

// The same figure as a decimal string in the currency's own width ("12.500" KWD).
export function amountDueDecimal(order: AmountDueOrder): string {
  return minorToDecimal(
    amountDueMinor(order),
    order.currency as string | null | undefined,
  );
}
