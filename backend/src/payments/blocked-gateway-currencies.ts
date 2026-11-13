import { BadRequestException } from '@nestjs/common';
import { NOMOD_CURRENCIES } from './nomod/nomod-money';

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

// Gateway -> the ONLY currencies it accepts. The mirror image of the blocklist
// above, for a gateway whose supported set is short and fixed: Nomod takes AED,
// USD, EUR, GBP and SAR and nothing else. A currency outside the list is treated
// exactly like a blocked one, at every place the blocklist is already enforced.
export const GATEWAY_ALLOWED_CURRENCIES: Readonly<
  Record<string, readonly string[]>
> = { nomod: NOMOD_CURRENCIES };

// Does this gateway restrict currencies at all (either way)?
export function gatewayHasCurrencyRule(gateway: string): boolean {
  return (
    !!STRIPE_BLOCKED_CURRENCIES[gateway] ||
    !!GATEWAY_ALLOWED_CURRENCIES[gateway]
  );
}

export function isGatewayCurrencyBlocked(
  gateway: string,
  currency: string,
): boolean {
  const code = currency.toUpperCase();
  const allowed = GATEWAY_ALLOWED_CURRENCIES[gateway];
  if (allowed && !allowed.includes(code)) return true;
  return !!STRIPE_BLOCKED_CURRENCIES[gateway]?.includes(code);
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
