// Mirrors backend/src/payments/blocked-gateway-currencies.ts by hand (the apps
// share no code): Stripe card checkout is blocked for the three-decimal
// currencies until the owner decides the handling. Change both together.
const STRIPE_BLOCKED_CURRENCIES = ["KWD", "BHD", "OMR"];

export function stripeBlockedForCurrency(currency: string | null | undefined): boolean {
  return !!currency && STRIPE_BLOCKED_CURRENCIES.includes(currency.toUpperCase());
}

export const STRIPE_CURRENCY_WARNING =
  "Card payments through Stripe are unavailable for KWD, BHD and OMR. Customers will not be offered Pay online, and card payment links cannot be created. Cash on delivery or pickup, Tabby, Tamara and PayPal are not affected.";
