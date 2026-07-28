export interface CreateCheckoutSessionParams {
  orderId: number;
  amount: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  // Merchant-supplied (Shopify-style bring-your-own-keys) credentials for
  // this shop's configured gateway — see payments/provider-credentials.ts
  // for the field shape each provider expects, and
  // PaymentSettingsService.resolveCredentials for where this comes from
  // (decrypted server-side, never logged). Undefined/null means "no
  // per-shop credentials saved" — providers that read from an env var
  // (Stripe today) fall back to that for backward compatibility with shops
  // that predate per-shop credential storage.
  credentials?: Record<string, string> | null;
}

export interface CheckoutSession {
  providerReference: string;
  checkoutUrl: string;
}

export interface WebhookResult {
  providerReference: string;
  orderId: number;
  status: 'paid' | 'failed';
  // The charge/payment-intent id — distinct from providerReference (which is
  // the webhook *event* id, used for delivery-idempotency, e.g. Stripe's
  // evt_...). This is what a later refund call actually needs (Stripe's
  // Refund API takes a payment_intent or charge id, not an event id).
  // Undefined for providers that don't support refunds at all.
  chargeReference?: string;
}

export interface RefundPaymentParams {
  // The stored paymenttransaction.providerChargeReference, not
  // providerReference/gatewayReference — see WebhookResult's own comment.
  chargeReference: string;
  // Major currency units (e.g. AED, not fils) — same convention as
  // CreateCheckoutSessionParams.amount; each provider implementation
  // converts to its own minor-unit expectation itself.
  amount: number;
  credentials?: Record<string, string> | null;
}

export interface RefundResult {
  providerReference: string;
}

// Strategy interface — Telr/PayTabs/Tabby/Tamara plug in by implementing this
// and being wired up in PaymentsModule's PAYMENT_PROVIDER factory; nothing
// outside providers/ should ever import a gateway SDK directly.
export interface PaymentProvider {
  readonly name: string;
  createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession>;
  // webhookSecret: the shop-specific secret to verify against, resolved by
  // PaymentsService from that shop's own encrypted credentials when the
  // request came in on a per-shop webhook route (see
  // /payments/webhook/stripe/:shopId). Undefined on the legacy platform-wide
  // route — providers that support only a single platform-level secret
  // (Stripe today) fall back to that env var for backward compatibility.
  parseWebhookEvent(
    payload: Buffer,
    signatureHeader: string,
    webhookSecret?: string,
  ): WebhookResult | null;
  // Optional — not every provider supports API-issued refunds (or is even a
  // real integration yet, see Tabby/Tamara/Nomod's structural-stub
  // comments). ReturnsService checks for this method's presence and falls
  // back to a manual (record-only, no API call) refund when it's absent, or
  // when the call itself throws.
  refundPayment?(params: RefundPaymentParams): Promise<RefundResult>;
}
