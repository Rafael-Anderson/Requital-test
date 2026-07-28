import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
  WebhookResult,
} from '../payment-provider.interface';

// STRUCTURAL STUB — not a real integration. Tabby is a BNPL (buy-now-pay-
// later) checkout, which likely needs an installment/session flow that
// doesn't map cleanly onto CreateCheckoutSessionParams' flat amount — that's
// exactly the kind of shape question that needs Tabby's real docs, not a
// guess. TABBY_SECRET_KEY exists in .env as a placeholder.
@Injectable()
export class TabbyPaymentProvider implements PaymentProvider {
  readonly name = 'tabby';

  createCheckoutSession(_params: CreateCheckoutSessionParams): Promise<CheckoutSession> {
    throw new InternalServerErrorException(
      'Tabby integration is a structural stub — no real checkout-session API call is implemented yet',
    );
  }

  parseWebhookEvent(_payload: Buffer, _signatureHeader: string): WebhookResult | null {
    console.warn('[payments] tabby webhook received but parseWebhookEvent is a stub — ignoring');
    return null;
  }
}
