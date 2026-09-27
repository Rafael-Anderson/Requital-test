import { toMajorUnitString } from './currency-minor-units';

// Backend-side display formatting for a money amount that is being written into
// something a human reads: a notification body, an email digest, the invoice
// HTML, a CSV cell.
//
// Deliberately the ISO CODE and not a symbol. The storefront renders the real
// Dirham glyph via <CurrencySymbol> because it controls the font; a WhatsApp
// message, a plain-text email and a CSV opened in Excel do not, and a symbol
// that fails to render is worse than a code that always does. Admin makes the
// same choice (see admin/lib/money.ts) — this mirrors it rather than inventing a
// second convention.
//
// The decimal width comes from the currency, not a hardcoded 2, via
// toMajorUnitString: a KWD total has to read "10.500", because "10.50" is a
// different amount.
export function formatMoney(
  amount: number | string,
  currency: string | null | undefined,
): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  const code = (currency ?? '').trim().toUpperCase();
  if (!Number.isFinite(n)) {
    // Never render "NaN AED" into a customer's email. An empty amount with the
    // code still attached is the least-wrong thing to show, and the caller's own
    // data problem stays visible rather than being masked by a 0.
    return code;
  }
  return code ? `${toMajorUnitString(n, code)} ${code}` : toMajorUnitString(n, code);
}
