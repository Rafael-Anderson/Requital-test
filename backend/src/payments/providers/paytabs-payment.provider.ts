import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
  WebhookResult,
} from '../payment-provider.interface';
import { createLogger } from '../../common/logging/logger';

const logger = createLogger('PaytabsPaymentProvider');

// STRUCTURAL STUB — not a real integration. PayTabs' actual Hosted Payment
// Page request/response and callback shapes weren't guessed at here (per
// instruction: don't invent a gateway's API shape from memory without real
// docs/sandbox credentials in hand). PAYTABS_PROFILE_ID/PAYTABS_SERVER_KEY
// exist in .env as placeholders for whoever wires up the real integration.
@Injectable()
export class PayTabsPaymentProvider implements PaymentProvider {
  readonly name = 'paytabs';

  createCheckoutSession(
    _params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    throw new InternalServerErrorException(
      'PayTabs integration is a structural stub — no real checkout-session API call is implemented yet',
    );
  }

  parseWebhookEvent(
    _payload: Buffer,
    _signatureHeader: string,
  ): WebhookResult | null {
    logger.warn('webhook received but parseWebhookEvent is a stub — ignoring');
    return null;
  }
}
