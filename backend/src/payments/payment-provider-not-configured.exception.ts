import { InternalServerErrorException } from '@nestjs/common';

// Thrown by a provider's own createCheckoutSession/parseWebhookEvent when
// its credentials are missing or empty — see the "toggle-bypass guard"
// comment on TabbyPaymentProvider/TamaraPaymentProvider for why this check
// must live inside the provider itself, not only in whatever caller
// resolved credentials/checked the enabled flag first.
export class PaymentProviderNotConfiguredException extends InternalServerErrorException {
  constructor(provider: string) {
    super(
      `${provider} is not configured for this shop — missing or empty credentials`,
    );
  }
}
