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
// Today that path is closed at the other end too: UpdateShopDto restricts
// shop.currency to SUPPORTED_CURRENCIES (AED only) until real multi-currency
// ships. This module is deliberately NOT limited to that list - it is the
// groundwork that has to be correct before the lock can be widened, and having
// it right in advance is what makes widening a small change rather than an
// audit of every amount conversion in the codebase.
//
// Deliberately NOT here: rounding policy, display formatting, exchange rates.
// This answers exactly one question - how many minor units in a major one.

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
