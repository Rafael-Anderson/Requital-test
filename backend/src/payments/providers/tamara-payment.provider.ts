import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
  WebhookResult,
} from '../payment-provider.interface';
import { PaymentProviderNotConfiguredException } from '../payment-provider-not-configured.exception';
import { verifyHmacSha256 } from '../webhook-signature';

const DEFAULT_TAMARA_API_URL = 'https://api-sandbox.tamara.co';

interface TamaraCheckoutResponse {
  order_id: string;
  checkout_id: string;
  checkout_url: string;
}

// Tamara's webhook payload — order_reference_id is what we supplied as
// our own orderId at checkout creation (see createCheckoutSession).
interface TamaraWebhookPayload {
  order_id: string;
  order_reference_id: string;
  event_type:
    'order_expired' | 'order_approved' | 'order_declined' | 'order_canceled';
}

// Real BNPL integration against Tamara's Checkout API. Credentials:
// { apiUrl, apiToken, notificationToken } — apiToken is a static bearer
// token (Tamara doesn't use a full OAuth2 client-credentials dance, just a
// long-lived merchant token, hence "OAuth bearer" meaning "Authorization:
// Bearer <token>", not a token-exchange flow), notificationToken is the
// shared secret webhook deliveries are HMAC-signed against. Falls back to
// the platform-level TAMARA_API_URL/TAMARA_TOKEN/TAMARA_NOTIFICATION_TOKEN
// env vars for shops that haven't configured their own, same
// bring-your-own-keys pattern as every other provider here.
@Injectable()
export class TamaraPaymentProvider implements PaymentProvider {
  readonly name = 'tamara';

  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    // MANDATORY GUARD — do not remove: same reasoning as
    // TabbyPaymentProvider's own copy of this comment. This check must
    // live inside the provider itself, not only in the caller that
    // resolved credentials — an outer-only check has been bypassed 3 times
    // in this codebase's history by some other call path forgetting to
    // repeat it. See CLAUDE.md's "Payment provider toggle-bypass guard" note.
    const apiToken = params.credentials?.apiToken ?? process.env.TAMARA_TOKEN;
    if (!apiToken) {
      throw new PaymentProviderNotConfiguredException('Tamara');
    }
    const apiUrl =
      params.credentials?.apiUrl ??
      process.env.TAMARA_API_URL ??
      DEFAULT_TAMARA_API_URL;

    const res = await fetch(`${apiUrl}/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order_reference_id: String(params.orderId),
        total_amount: {
          amount: params.amount.toFixed(2),
          currency: params.currency,
        },
        merchant_url: {
          success: params.successUrl,
          failure: params.cancelUrl,
          cancel: params.cancelUrl,
          notification: params.successUrl,
        },
      }),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Tamara API error (${res.status}): ${await res.text()}`,
      );
    }
    const data = (await res.json()) as TamaraCheckoutResponse;
    if (!data.checkout_url) {
      throw new InternalServerErrorException(
        'Tamara did not return a checkout URL',
      );
    }
    return {
      providerReference: data.checkout_id,
      checkoutUrl: data.checkout_url,
    };
  }

  parseWebhookEvent(
    payload: Buffer,
    signatureHeader: string,
    webhookSecret?: string,
  ): WebhookResult | null {
    // Same MANDATORY GUARD as createCheckoutSession above.
    const secret = webhookSecret ?? process.env.TAMARA_NOTIFICATION_TOKEN;
    if (!secret) {
      throw new PaymentProviderNotConfiguredException('Tamara');
    }
    if (!verifyHmacSha256(payload, signatureHeader, secret)) {
      console.warn('[payments] tamara webhook: signature verification failed');
      return null;
    }

    const event = JSON.parse(payload.toString('utf8')) as TamaraWebhookPayload;
    const orderId = Number(event.order_reference_id);
    if (!orderId) return null;

    if (event.event_type === 'order_approved') {
      return {
        providerReference: event.order_id,
        orderId,
        status: 'paid',
        chargeReference: event.order_id,
        advanceOrderStatus: 'confirmed',
      };
    }
    if (
      event.event_type === 'order_declined' ||
      event.event_type === 'order_expired'
    ) {
      return {
        providerReference: event.order_id,
        orderId,
        status: 'failed',
        advanceOrderStatus: 'cancelled',
      };
    }
    // order_canceled: the merchant/customer already cancelled through some
    // other path — nothing further for this webhook to drive.
    return null;
  }
}
