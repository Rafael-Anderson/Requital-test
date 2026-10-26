import { BadRequestException } from '@nestjs/common';

// Gateway -> currencies it must NOT be asked to charge, until the owner decides
// how Stripe handles them. Stripe's three-decimal currencies (KWD, BHD, OMR) need
// the amount to be a multiple of 10 in minor units (Stripe's own rule for them),
// and a 33.091 KWD order is 33091 minor units, which Stripe would reject or round
// after the order already exists. toMinorUnits stays correct and covered; only the
// live checkout call is blocked. Refunds are NOT blocked: a refund of an order that
// was already charged must still work. Tabby/Tamara/PayPal are not listed.
//
// Enforced in three places that must stay in step: the provider's own
// createCheckoutSession (MANDATORY GUARD, the bypass-proof one), the early
// rejections (PaymentSettingsService.isUsable, PaymentsService.generateLink and
// getCheckoutSession) so no orphan order is created and the shopper gets a clear
// message, and a hand-mirrored constant in admin/lib/blocked-gateway-currencies.ts.
export const STRIPE_BLOCKED_CURRENCIES: Readonly<
  Record<string, readonly string[]>
> = { stripe: ['KWD', 'BHD', 'OMR'] };

export function isGatewayCurrencyBlocked(
  gateway: string,
  currency: string,
): boolean {
  return !!STRIPE_BLOCKED_CURRENCIES[gateway]?.includes(currency.toUpperCase());
}

export const CURRENCY_BLOCKED_MESSAGE =
  'Card payments are not available for this currency yet. Please choose another payment method.';

export class PaymentCurrencyNotSupportedException extends BadRequestException {
  constructor(gateway: string, currency: string) {
    super(
      `${CURRENCY_BLOCKED_MESSAGE} (${gateway} does not support ${currency} checkout)`,
    );
  }
}
