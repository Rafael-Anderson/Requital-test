import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
  WebhookResult,
} from '../payment-provider.interface';

// STRUCTURAL STUB — not a real integration. Also a genuinely new provider
// for this task. PayPal's REST Orders v2 API shape is well-documented in
// general, but this app has no sandbox credentials to actually verify a
// request/response/webhook-verification implementation against — same
// conservative standard as every other stub in this codebase (Telr/
// PayTabs/Tabby/Tamara/Nomod): credential *field names* (clientId/
// clientSecret, the standard OAuth2 client-credentials shape) are a
// confident guess, but the actual token-exchange + order-create + capture +
// webhook-signature-verification calls are not implemented without real
// docs/sandbox creds to check them against.
@Injectable()
export class PayPalPaymentProvider implements PaymentProvider {
  readonly name = 'paypal';

  createCheckoutSession(
    _params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    throw new InternalServerErrorException(
      'PayPal integration is a structural stub — no real checkout-session API call is implemented yet',
    );
  }

  parseWebhookEvent(
    _payload: Buffer,
    _signatureHeader: string,
  ): WebhookResult | null {
    console.warn(
      '[payments] paypal webhook received but parseWebhookEvent is a stub — ignoring',
    );
    return null;
  }
}
