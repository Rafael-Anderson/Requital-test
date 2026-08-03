import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
  WebhookResult,
} from '../payment-provider.interface';

// STRUCTURAL STUB — not a real integration. Nomod is a genuinely new
// provider for this task (not touched by any earlier stub pass); no
// confident public API documentation for its checkout-session request/
// response shape, auth flow, or webhook signature scheme was available to
// implement against without guessing — same standard applied to Telr/
// PayTabs/Tabby/Tamara earlier: don't invent an API shape from nothing. The
// settings/credential-storage/UI layer (provider-credentials.ts, the admin
// Payment Gateways page, the shoppaymentprovider table) is fully real and
// wired up regardless — only this call is stubbed.
@Injectable()
export class NomodPaymentProvider implements PaymentProvider {
  readonly name = 'nomod';

  createCheckoutSession(
    _params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    throw new InternalServerErrorException(
      'Nomod integration is a structural stub — no real checkout-session API call is implemented yet',
    );
  }

  parseWebhookEvent(
    _payload: Buffer,
    _signatureHeader: string,
  ): WebhookResult | null {
    console.warn(
      '[payments] nomod webhook received but parseWebhookEvent is a stub — ignoring',
    );
    return null;
  }
}
