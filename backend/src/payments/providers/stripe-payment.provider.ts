import { Injectable, InternalServerErrorException } from '@nestjs/common';
import Stripe from 'stripe';
import {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
  RefundPaymentParams,
  RefundResult,
  WebhookResult,
} from '../payment-provider.interface';

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  // Platform-level fallback only — see the class comment below on why
  // webhook verification can't yet be fully per-shop.
  private readonly webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

  // One Stripe client per secret key, not a single shared instance — a
  // merchant's own secretKey (Shopify-style bring-your-own-keys, see
  // PaymentSettingsService) means each shop's checkout session must be
  // created against *their* Stripe account, not the platform's. Keyed by
  // key value so repeated calls for the same shop (or the platform default,
  // when a shop hasn't configured its own) don't reconstruct a client every
  // time. Falls back to the platform's STRIPE_SECRET_KEY env var when no
  // per-shop credentials were resolved — preserves the original behavior
  // for every shop that predates per-shop credential storage.
  private readonly clients = new Map<string, Stripe>();

  private clientFor(secretKey: string | undefined): Stripe {
    const key = secretKey ?? process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new InternalServerErrorException(
        "No Stripe secret key configured — set it on the shop's Payment Gateways settings, or STRIPE_SECRET_KEY as a platform fallback",
      );
    }
    let client = this.clients.get(key);
    if (!client) {
      client = new Stripe(key);
      this.clients.set(key, client);
    }
    return client;
  }

  // FIXED (was a KNOWN GAP): webhook signature verification is now genuinely
  // per-shop. A merchant using their own Stripe account points their
  // Stripe Dashboard webhook config at /payments/webhook/stripe/:shopId
  // (see PaymentsWebhookController) instead of the platform-wide route —
  // the shop is known from the URL itself, before signature verification
  // even starts, so PaymentsService.handleWebhook can resolve *that shop's*
  // stored webhookSecret credential and pass it in here. The legacy
  // /payments/webhook/stripe route (no shopId) still works exactly as
  // before, verifying against the platform's STRIPE_WEBHOOK_SECRET — for
  // shops that never configured their own Stripe credentials and stayed on
  // the platform account.
  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    const stripe = this.clientFor(params.credentials?.secretKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            product_data: { name: `Order #${params.orderId}` },
            unit_amount: Math.round(params.amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: { orderId: String(params.orderId) },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });

    if (!session.url) {
      throw new InternalServerErrorException(
        'Stripe did not return a checkout URL',
      );
    }
    return { providerReference: session.id, checkoutUrl: session.url };
  }

  parseWebhookEvent(
    payload: Buffer,
    signatureHeader: string,
    webhookSecret?: string,
  ): WebhookResult | null {
    const secret = webhookSecret ?? this.webhookSecret;
    if (!secret) {
      throw new InternalServerErrorException(
        "No Stripe webhook secret configured — set one on the shop's Payment Gateways settings, or STRIPE_WEBHOOK_SECRET as a platform fallback",
      );
    }
    // Stripe.webhooks (static, not this.clientFor(...).webhooks) — pure
    // local HMAC verification against `secret`, no API key and no network
    // call involved at all. Using clientFor(undefined) here was a latent
    // bug: it throws whenever neither a per-shop secretKey nor the
    // platform's STRIPE_SECRET_KEY is configured, even though verifying a
    // webhook never actually needed a checkout-session-capable client in
    // the first place.
    const event = Stripe.webhooks.constructEvent(
      payload,
      signatureHeader,
      secret,
    );

    // Keyed on event.id, not session.id — Stripe retries a delivery under
    // the same event.id, so that's the field that identifies "have we
    // already handled this exact webhook delivery", not the checkout
    // session it happens to be about.
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = Number(session.metadata?.orderId);
      if (!orderId) return null;
      const chargeReference =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;
      return {
        providerReference: event.id,
        orderId,
        status: 'paid',
        chargeReference,
      };
    }
    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object;
      const orderId = Number(session.metadata?.orderId);
      if (!orderId) return null;
      return { providerReference: event.id, orderId, status: 'failed' };
    }
    return null;
  }

  async refundPayment(params: RefundPaymentParams): Promise<RefundResult> {
    const stripe = this.clientFor(params.credentials?.secretKey);
    const refund = await stripe.refunds.create({
      payment_intent: params.chargeReference,
      amount: Math.round(params.amount * 100),
    });
    return { providerReference: refund.id };
  }
}
