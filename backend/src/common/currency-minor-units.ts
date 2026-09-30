// How many minor units make one major unit, per currency.
//
// This exists because an amount handed to a payment gateway is usually
// denominated in MINOR units (fils, halalas, cents) while everything in this
// codebase carries major units - see PaymentProvider's own note that amounts are
// "Major currency units (e.g. AED, not fils)". Converting between the two needs
// the currency's exponent, and it is NOT always 2.
//
// The Gulf currencies this platform targets are split across both:
//   AED, SAR, QAR, USD -> 2 decimals, factor 100
//   KWD, BHD, OMR      -> 3 decimals, factor 1000   (ISO 4217 exponent 3)
//
// StripePaymentProvider previously multiplied by 100 unconditionally. That is
// correct for AED and wrong by a factor of 10 for KWD/BHD/OMR - a 10.500 KWD
// charge would have been submitted as 1050 minor units (1.050 KWD) rather than
// 10500. The admin's currency dropdown offered all three of those currencies,
// so the combination was reachable through the UI.
//
// That was closed at the other end too while the money layer was being built:
// UpdateShopDto restricted shop.currency to AED only. Phase 2a/A6 widened it to
// all seven, and this module having been correct for all of them in advance is
// exactly what made that a list change rather than an audit of every amount
// conversion in the codebase. It remains deliberately independent of
// SUPPORTED_CURRENCIES: an unrecognised code falls back to factor 100 rather
// than throwing.
//
// Phase 2a/A3 widened this file's remit from "how many minor units in a major
// one" to also owning the ROUNDING POLICY derived from that answer, because the
// two cannot be allowed to drift: a site that rounds to 2 decimals while the
// gateway converts with factor 1000 produces a charge that disagrees with the
// stored total. They key off one map, here, or they eventually disagree.
//
// Still deliberately NOT here: display formatting (a currency symbol/locale
// concern, and admin has its own helper for it) and exchange rates (see
// currency-rates/).

const MINOR_UNIT_FACTORS: Readonly<Record<string, number>> = {
  AED: 100,
  SAR: 100,
  QAR: 100,
  USD: 100,
  KWD: 1000,
  BHD: 1000,
  OMR: 1000,
};

// The safe default for an unrecognised code. 2 decimals covers the large
// majority of world currencies, and it is what every amount in this codebase
// already assumes, so an unknown code behaves exactly as it does today rather
// than in some new way.
export const DEFAULT_MINOR_UNIT_FACTOR = 100;

export function minorUnitFactor(currency: string | null | undefined): number {
  if (!currency) return DEFAULT_MINOR_UNIT_FACTOR;
  return (
    MINOR_UNIT_FACTORS[currency.trim().toUpperCase()] ??
    DEFAULT_MINOR_UNIT_FACTOR
  );
}

// Major units -> integer minor units, for a gateway that wants them.
//
// Rounds rather than truncates: truncation silently loses a fils on every
// fractional amount, always in the merchant's disfavour. The result is an
// integer because that is what the gateways' APIs require - a fractional minor
// unit is not a representable amount.
export function toMinorUnits(
  amount: number,
  currency: string | null | undefined,
): number {
  return Math.round(amount * minorUnitFactor(currency));
}

// How many decimal places the currency actually has. Derived from the factor
// rather than stored in a second map, so the two can never disagree: every
// factor here is a power of ten, and 100 -> 2, 1000 -> 3, 1 -> 0.
export function minorUnitDecimals(currency: string | null | undefined): number {
  return Math.round(Math.log10(minorUnitFactor(currency)));
}

// THE ROUNDING POLICY for this codebase, in one place.
//
// Rounds a computed amount to the smallest unit the currency genuinely has, so
// 2 decimals for AED and 3 for KWD. Every site that persists a money value
// routes through this instead of a hardcoded `.toFixed(2)`.
//
// WHY ONE FUNCTION AND NOT A CONVENTION. Before this, rounding was inconsistent
// in a way that had nothing to do with currency: the storefront checkout rounded
// its total and tax to 2dp before persisting, while the admin order paths wrote
// raw floats straight into DECIMAL(65,30). The same basket could therefore be
// stored as 4.999999999999999 or 5.00 depending on which screen touched it last.
// Multi-currency makes that worse rather than better, because the correct number
// of places stops being a constant.
//
// WHERE TO APPLY IT: compute at full precision, then round ONCE per stored
// column at the moment of persisting. Not per intermediate step, and not per
// line before summing - rounding each of three lines to 2dp and then adding them
// gives a different answer than rounding the sum, and the sum is the figure the
// customer is actually charged.
export function roundMoney(
  amount: number,
  currency: string | null | undefined,
): number {
  const factor = minorUnitFactor(currency);
  return Math.round(amount * factor) / factor;
}

// Fixed-decimal string for a gateway whose API wants a decimal string rather
// than integer minor units (Tabby, Tamara, PayPal all do). Replaces the
// hardcoded `.toFixed(2)` in those providers: a 10.5 KWD charge has to serialise
// as "10.500", not "10.50", or the provider reads it as a different amount.
export function toMajorUnitString(
  amount: number,
  currency: string | null | undefined,
): string {
  return roundMoney(amount, currency).toFixed(minorUnitDecimals(currency));
}
