export interface CreateCheckoutSessionParams {
  orderId: number;
  amount: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  providerReference: string;
  checkoutUrl: string;
}

export interface WebhookResult {
  providerReference: string;
  orderId: number;
  status: 'paid' | 'failed';
}

// Strategy interface — Telr/PayTabs/Tabby/Tamara plug in by implementing this
// and being wired up in PaymentsModule's PAYMENT_PROVIDER factory; nothing
// outside providers/ should ever import a gateway SDK directly.
export interface PaymentProvider {
  readonly name: string;
  createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession>;
  parseWebhookEvent(
    payload: Buffer,
    signatureHeader: string,
  ): WebhookResult | null;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
