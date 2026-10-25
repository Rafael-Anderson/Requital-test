// PLT-1 STUBS: interfaces only, no implementation, nothing imports this file yet.
// They record the seams phases 2 to 4 of docs/plans/phase3-billing.md will fill so
// the first slice cannot grow them by accident. Every Stripe behaviour named in the
// plan is INFERRED until confirmed in test mode (plan section 18).
//
// Not built in this slice: Stripe client and webhooks, prices (planprice is empty),
// trials for new signups, dunning, billing suspension and the locked-mode login
// confinement, platform invoices and tax, banners and usage notices.

export interface BillingStripeClient {
  // Never constructed from STRIPE_SECRET_KEY: billing uses its own account/key.
  createCheckoutSession(shopId: number, planPriceId: number): Promise<{ url: string }>;
  createPortalSession(shopId: number): Promise<{ url: string }>;
}

export interface BillingWebhookHandler {
  // Idempotent on the Stripe event id; resolves the shop only through the
  // billingcustomer row, so a legacy shop (no Stripe object) is unreachable.
  handle(rawBody: Buffer, signature: string): Promise<void>;
}

export interface DunningPolicy {
  graceDays: { card: number; noCardTrial: number };
  // CAS: suspends only `suspensionReason IS NULL` shops, with reason 'billing'.
  suspendForNonPayment(shopId: number): Promise<boolean>;
  // CAS: lifts only a suspension whose reason is 'billing'.
  liftOnPayment(shopId: number): Promise<boolean>;
}

export interface TrialStarter {
  // Phase 4: creates a trialing subscription on the tier2 plan inside signup.
  startTrial(shopId: number, now: Date): Promise<void>;
}
