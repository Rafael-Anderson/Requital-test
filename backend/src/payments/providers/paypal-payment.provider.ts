import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
  RefundPaymentParams,
  RefundResult,
  WebhookResult,
} from '../payment-provider.interface';
import { PaymentProviderNotConfiguredException } from '../payment-provider-not-configured.exception';
import { createLogger } from '../../common/logging/logger';

const logger = createLogger('PayPalPaymentProvider');
const PAYPAL_API_URL =
  process.env.PAYPAL_API_URL ?? 'https://api-m.sandbox.paypal.com';

interface PayPalOrderResponse {
  id: string;
  links?: { rel: string; href: string }[];
}

interface PayPalVerifyResponse {
  verification_status: string;
}

interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource?: { id?: string; custom_id?: string };
}

interface PayPalHeaders {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

// Cached by clientId — avoids re-authenticating on every checkout/webhook
// call. ponytail: process-local Map, not shared across instances; a token
// re-fetch on a cold instance is cheap (one extra OAuth round-trip), so this
// doesn't need a shared cache to be correct, just to be a little faster.
const tokenCache = new Map<
  string,
  { accessToken: string; expiresAt: number }
>();

async function getAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cached = tokenCache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }
  const res = await fetch(`${PAYPAL_API_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new InternalServerErrorException(
      `PayPal OAuth error (${res.status}): ${await res.text()}`,
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  // 60s safety margin so a cached token doesn't expire mid-flight.
  tokenCache.set(clientId, {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  });
  return data.access_token;
}

// Real integration against PayPal's REST Orders v2 API (hosted checkout,
// create-then-capture) — mirrors TabbyPaymentProvider's MANDATORY GUARD +
// plain-fetch + per-shop-then-env credential fallback shape, adapted for
// PayPal's OAuth2 client-credentials auth. Credentials: { clientId,
// clientSecret, webhookId }, resolved per-shop via PaymentSettingsService
// and falling back to PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET/PAYPAL_WEBHOOK_ID
// for shops that haven't configured their own.
@Injectable()
export class PayPalPaymentProvider implements PaymentProvider {
  readonly name = 'paypal';

  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    // MANDATORY GUARD — do not remove: the "is this provider actually
    // usable" check must live here, inside the provider, not only in
    // whatever caller resolved credentials. An outer-only check has been
    // bypassed 3 times in this codebase's history by some other call path
    // that forgot to repeat it — see CLAUDE.md's "Payment provider
    // toggle-bypass guard" note.
    const clientId =
      params.credentials?.clientId ?? process.env.PAYPAL_CLIENT_ID;
    const clientSecret =
      params.credentials?.clientSecret ?? process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new PaymentProviderNotConfiguredException('PayPal');
    }

    const accessToken = await getAccessToken(clientId, clientSecret);
    const res = await fetch(`${PAYPAL_API_URL}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: String(params.orderId),
            amount: {
              currency_code: params.currency,
              value: params.amount.toFixed(2),
            },
          },
        ],
        application_context: {
          return_url: params.successUrl,
          cancel_url: params.cancelUrl,
        },
      }),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `PayPal API error (${res.status}): ${await res.text()}`,
      );
    }
    const data = (await res.json()) as PayPalOrderResponse;
    const approveLink = data.links?.find((l) => l.rel === 'approve')?.href;
    if (!approveLink) {
      throw new InternalServerErrorException(
        'PayPal did not return an approve checkout URL',
      );
    }
    return { providerReference: data.id, checkoutUrl: approveLink };
  }

  // webhookSecret here is a JSON-encoded bundle of the shop's full
  // credentials ({ clientId, clientSecret, webhookId }), not a single
  // shared secret — see PaymentsService.handleWebhook's `gateway ===
  // 'paypal'` branch for why. Async, unlike every other provider here:
  // PayPal's verification is a remote API call, not a local HMAC
  // computation.
  async parseWebhookEvent(
    payload: Buffer,
    signatureHeader: string,
    webhookSecret?: string,
  ): Promise<WebhookResult | null> {
    const shopCredentials = webhookSecret
      ? (JSON.parse(webhookSecret) as Record<string, string>)
      : null;
    const clientId = shopCredentials?.clientId ?? process.env.PAYPAL_CLIENT_ID;
    const clientSecret =
      shopCredentials?.clientSecret ?? process.env.PAYPAL_CLIENT_SECRET;
    const webhookId =
      shopCredentials?.webhookId ?? process.env.PAYPAL_WEBHOOK_ID;
    // Same MANDATORY GUARD as createCheckoutSession above — a webhook for an
    // unconfigured shop must never be processed just because it arrived on
    // this route.
    if (!clientId || !clientSecret || !webhookId) {
      throw new PaymentProviderNotConfiguredException('PayPal');
    }

    const headers = JSON.parse(signatureHeader) as PayPalHeaders;
    const webhookEvent: unknown = JSON.parse(payload.toString('utf8'));
    const accessToken = await getAccessToken(clientId, clientSecret);
    const verifyRes = await fetch(
      `${PAYPAL_API_URL}/v1/notifications/verify-webhook-signature`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transmission_id: headers.transmissionId,
          transmission_time: headers.transmissionTime,
          cert_url: headers.certUrl,
          auth_algo: headers.authAlgo,
          transmission_sig: headers.transmissionSig,
          webhook_id: webhookId,
          webhook_event: webhookEvent,
        }),
      },
    );
    if (!verifyRes.ok) {
      throw new InternalServerErrorException(
        `PayPal webhook verification API error (${verifyRes.status}): ${await verifyRes.text()}`,
      );
    }
    const verification = (await verifyRes.json()) as PayPalVerifyResponse;
    if (verification.verification_status !== 'SUCCESS') {
      logger.warn('webhook signature verification failed');
      return null;
    }

    const event = webhookEvent as PayPalWebhookEvent;
    const orderId = Number(event.resource?.custom_id);
    if (!orderId) return null;

    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      return {
        providerReference: event.id,
        orderId,
        status: 'paid',
        chargeReference: event.resource?.id,
      };
    }
    if (event.event_type === 'PAYMENT.CAPTURE.DENIED') {
      return { providerReference: event.id, orderId, status: 'failed' };
    }
    // CHECKOUT.ORDER.APPROVED and anything else: not a capture outcome yet,
    // nothing for the order record to reflect.
    return null;
  }

  async refundPayment(params: RefundPaymentParams): Promise<RefundResult> {
    const clientId =
      params.credentials?.clientId ?? process.env.PAYPAL_CLIENT_ID;
    const clientSecret =
      params.credentials?.clientSecret ?? process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new PaymentProviderNotConfiguredException('PayPal');
    }
    const accessToken = await getAccessToken(clientId, clientSecret);
    const res = await fetch(
      `${PAYPAL_API_URL}/v2/payments/captures/${params.chargeReference}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        // ponytail: RefundPaymentParams carries no currency field, and this
        // codebase is single-currency AED throughout (see CLAUDE.md) — hard
        // code it here rather than threading a currency param through every
        // provider's refundPayment for the one gateway that needs it.
        // Revisit if RefundPaymentParams ever carries currency, or if
        // multi-currency ships.
        body: JSON.stringify({
          amount: { currency_code: 'AED', value: params.amount.toFixed(2) },
        }),
      },
    );
    if (!res.ok) {
      throw new InternalServerErrorException(
        `PayPal refund API error (${res.status}): ${await res.text()}`,
      );
    }
    const data = (await res.json()) as { id: string };
    return { providerReference: data.id };
  }
}
