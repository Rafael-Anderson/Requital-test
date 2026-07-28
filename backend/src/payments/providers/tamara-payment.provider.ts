import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
  WebhookResult,
} from '../payment-provider.interface';

// STRUCTURAL STUB — not a real integration. Tamara, like Tabby, is a BNPL
// checkout with its own order/webhook shape that wasn't guessed at here —
// needs Tamara's real docs and sandbox credentials, not a memory-based
// guess. TAMARA_API_TOKEN exists in .env as a placeholder.
@Injectable()
export class TamaraPaymentProvider implements PaymentProvider {
  readonly name = 'tamara';

  createCheckoutSession(_params: CreateCheckoutSessionParams): Promise<CheckoutSession> {
    throw new InternalServerErrorException(
      'Tamara integration is a structural stub — no real checkout-session API call is implemented yet',
    );
  }

  parseWebhookEvent(_payload: Buffer, _signatureHeader: string): WebhookResult | null {
    console.warn('[payments] tamara webhook received but parseWebhookEvent is a stub — ignoring');
    return null;
  }
}
