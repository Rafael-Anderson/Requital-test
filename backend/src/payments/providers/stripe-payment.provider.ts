import { Injectable, InternalServerErrorException } from '@nestjs/common';
import Stripe from 'stripe';
import {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
  WebhookResult,
} from '../payment-provider.interface';

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  private readonly webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  private client: Stripe | null = null;

  // Constructed lazily so a shop that hasn't configured Stripe yet doesn't
  // take the whole app down — the failure surfaces only when payments are
  // actually used, as a normal request error instead of a boot crash.
  private get stripe(): Stripe {
    if (!this.client) {
      const secretKey = process.env.STRIPE_SECRET_KEY;
      if (!secretKey) {
        throw new InternalServerErrorException(
          'STRIPE_SECRET_KEY is not configured',
        );
      }
      this.client = new Stripe(secretKey);
    }
    return this.client;
  }

  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create({
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
  ): WebhookResult | null {
    const event = this.stripe.webhooks.constructEvent(
      payload,
      signatureHeader,
      this.webhookSecret,
    );

    // Keyed on event.id, not session.id — Stripe retries a delivery under
    // the same event.id, so that's the field that identifies "have we
    // already handled this exact webhook delivery", not the checkout
    // session it happens to be about.
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = Number(session.metadata?.orderId);
      if (!orderId) return null;
      return { providerReference: event.id, orderId, status: 'paid' };
    }
    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object;
      const orderId = Number(session.metadata?.orderId);
      if (!orderId) return null;
      return { providerReference: event.id, orderId, status: 'failed' };
    }
    return null;
  }
}
