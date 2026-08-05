import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
  WebhookResult,
} from '../payment-provider.interface';
import { createLogger } from '../../common/logging/logger';

const logger = createLogger('TelrPaymentProvider');

// STRUCTURAL STUB — not a real integration. Telr's actual Hosted Payment
// Page order-creation and webhook payload shapes weren't guessed at here
// (per instruction: don't invent a gateway's API shape from memory without
// real docs/sandbox credentials in hand). TELR_STORE_ID/TELR_AUTH_KEY exist
// in .env as placeholders for whoever wires up the real integration.
@Injectable()
export class TelrPaymentProvider implements PaymentProvider {
  readonly name = 'telr';

  createCheckoutSession(
    _params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    throw new InternalServerErrorException(
      'Telr integration is a structural stub — no real checkout-session API call is implemented yet',
    );
  }

  parseWebhookEvent(
    _payload: Buffer,
    _signatureHeader: string,
  ): WebhookResult | null {
    // Safe no-op, not a throw: an unrecognized/test webhook delivery should
    // 200 as "received, nothing to do" (same as Stripe's unhandled-event
    // branch) rather than 500 the caller's retry loop.
    logger.warn('webhook received but parseWebhookEvent is a stub — ignoring');
    return null;
  }
}
