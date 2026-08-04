import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
  WebhookResult,
} from '../payment-provider.interface';
import { PaymentProviderNotConfiguredException } from '../payment-provider-not-configured.exception';
import { verifyHmacSha256 } from '../webhook-signature';

const TABBY_API_URL = 'https://api.tabby.ai/api/v2';

interface TabbyCheckoutResponse {
  id: string;
  status: string;
  configuration?: {
    available_products?: {
      installments?: { web_url?: string }[];
    };
  };
}

// Tabby's webhook payload — the checkout was created with
// `order.reference_id` set to our own orderId (see createCheckoutSession),
// so the webhook hands it straight back rather than needing a lookup.
interface TabbyWebhookPayload {
  id: string;
  event:
    | 'payment.created'
    | 'payment.authorized'
    | 'payment.approved'
    | 'payment.closed'
    | 'payment.expired'
    | 'payment.rejected';
  payment?: {
    id?: string;
    order?: { reference_id?: string };
  };
}

// Real BNPL integration against Tabby's Checkout API — mirrors
// StripePaymentProvider's shape (createCheckoutSession /
// parseWebhookEvent), just against a redirect-based checkout instead of a
// hosted session. Credentials: { publicKey, secretKey, webhookSecret },
// resolved per-shop via PaymentSettingsService (same bring-your-own-keys
// pattern as Stripe) and falling back to the platform-level
// TABBY_PUBLIC_KEY/TABBY_SECRET_KEY/TABBY_WEBHOOK_SECRET env vars for shops
// that haven't configured their own.
@Injectable()
export class TabbyPaymentProvider implements PaymentProvider {
  readonly name = 'tabby';

  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    // MANDATORY GUARD — do not remove: the "is this provider actually
    // usable" check must live here, inside the provider, not only in
    // whatever caller resolved credentials (PublicService.createOrder /
    // PaymentsService.getCheckoutSession). An outer-only check has been
    // bypassed 3 times in this codebase's history by some other call path
    // that forgot to repeat it — see CLAUDE.md's "Payment provider
    // toggle-bypass guard" note. A missing/empty key means Tabby is not
    // really configured for this shop no matter what shoppaymentprovider.enabled
    // says.
    const secretKey = params.credentials?.secretKey ?? process.env.TABBY_SECRET_KEY;
    const publicKey = params.credentials?.publicKey ?? process.env.TABBY_PUBLIC_KEY;
    if (!secretKey || !publicKey) {
      throw new PaymentProviderNotConfiguredException('Tabby');
    }

    const res = await fetch(`${TABBY_API_URL}/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        payment: {
          amount: params.amount.toFixed(2),
          currency: params.currency,
          buyer: {},
          order: { reference_id: String(params.orderId) },
        },
        merchant_code: publicKey,
        merchant_urls: {
          success: params.successUrl,
          cancel: params.cancelUrl,
          failure: params.cancelUrl,
        },
      }),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Tabby API error (${res.status}): ${await res.text()}`,
      );
    }
    const data = (await res.json()) as TabbyCheckoutResponse;
    const webUrl =
      data.configuration?.available_products?.installments?.[0]?.web_url;
    if (!webUrl) {
      throw new InternalServerErrorException(
        'Tabby did not return an installments checkout URL',
      );
    }
    return { providerReference: data.id, checkoutUrl: webUrl };
  }

  parseWebhookEvent(
    payload: Buffer,
    signatureHeader: string,
    webhookSecret?: string,
  ): WebhookResult | null {
    // Same MANDATORY GUARD as createCheckoutSession above — a webhook for
    // an unconfigured shop must never be processed just because it arrived
    // on this route.
    const secret = webhookSecret ?? process.env.TABBY_WEBHOOK_SECRET;
    if (!secret) {
      throw new PaymentProviderNotConfiguredException('Tabby');
    }
    if (!verifyHmacSha256(payload, signatureHeader, secret)) {
      console.warn('[payments] tabby webhook: signature verification failed');
      return null;
    }

    const event = JSON.parse(payload.toString('utf8')) as TabbyWebhookPayload;
    const orderId = Number(event.payment?.order?.reference_id);
    if (!orderId) return null;
    const paymentId = event.payment?.id ?? event.id;

    if (event.event === 'payment.approved') {
      return {
        providerReference: event.id,
        orderId,
        status: 'paid',
        chargeReference: paymentId,
        advanceOrderStatus: 'confirmed',
      };
    }
    if (event.event === 'payment.expired' || event.event === 'payment.closed') {
      return {
        providerReference: event.id,
        orderId,
        status: 'failed',
        advanceOrderStatus: 'cancelled',
      };
    }
    // payment.created / payment.authorized / payment.rejected: recorded by
    // no one yet — 'authorized' precedes 'approved' in Tabby's own flow
    // (funds not actually captured until approved), and 'rejected' needs no
    // order-side effect (the customer never got to a captured payment, so
    // there's nothing here to unwind).
    return null;
  }
}
