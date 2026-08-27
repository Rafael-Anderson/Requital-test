// Single source of truth for which gateways have a credential form in the
// admin Payment Gateways settings page, and what fields each one needs.
// Mirrored by hand in admin/lib/types.ts (no shared package between backend
// and admin — same tradeoff as every other admin/backend constant mirror in
// this codebase, e.g. theme/constants.ts).
//
// Cash on Delivery deliberately has no entry here — it has no credentials
// and isn't part of PaymentProviderRegistry; it's a plain visibility toggle
// on the two existing shop.deliveryPaymentCashOnDelivery/
// pickupPaymentCashOnPickup booleans (see PaymentSettingsService).
export const PAYMENT_GATEWAY_PROVIDERS = [
  'nomod',
  'stripe',
  'paypal',
  'tabby',
  'tamara',
] as const;
export type PaymentGatewayProvider = (typeof PAYMENT_GATEWAY_PROVIDERS)[number];

// "Card processing" — mutually exclusive, pick one. Every other provider in
// PAYMENT_GATEWAY_PROVIDERS is independent (of this choice and of each
// other).
export const CARD_PROCESSOR_PROVIDERS: PaymentGatewayProvider[] = [
  'nomod',
  'stripe',
];

export interface CredentialFieldDef {
  key: string;
  label: string;
}

// Field shapes:
// - stripe: matches the real implementation's two existing env vars
//   (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) exactly, now sourceable
//   per-shop instead of only from the platform env var.
// - tabby/tamara: now real integrations (see providers/tabby-payment.provider.ts
//   / tamara-payment.provider.ts) — publicKey/secretKey/webhookSecret and
//   publicKey/apiUrl/apiToken/notificationToken respectively, matching those
//   providers' own env var fallbacks (TABBY_PUBLIC_KEY/TABBY_SECRET_KEY/
//   TABBY_WEBHOOK_SECRET, TAMARA_PUBLIC_KEY/TAMARA_API_URL/TAMARA_TOKEN/
//   TAMARA_NOTIFICATION_TOKEN). Was a single-field placeholder from the
//   earlier structural-stub task. Tamara's publicKey is unused by the real
//   checkout integration (see that field's own comment below) — it's solely
//   for the PDP's client-side installment-promo widget.
// - paypal: standard PayPal REST API OAuth2 client-credentials shape
//   (clientId/clientSecret), plus webhookId — the Webhook ID PayPal issues
//   per registered webhook, required by their remote
//   verify-webhook-signature call (see providers/paypal-payment.provider.ts).
// - nomod: no confirmed real API docs for this specific gateway were
//   available to implement (or even confidently shape credentials) against
//   — this is a placeholder 2-field shape (api key + secret), flagged the
//   same way the field itself is flagged as a structural stub.
export const PROVIDER_CREDENTIAL_FIELDS: Record<
  PaymentGatewayProvider,
  CredentialFieldDef[]
> = {
  nomod: [
    { key: 'apiKey', label: 'API Key' },
    { key: 'secretKey', label: 'Secret Key' },
  ],
  stripe: [
    { key: 'secretKey', label: 'Secret Key' },
    { key: 'webhookSecret', label: 'Webhook Secret' },
  ],
  paypal: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client Secret' },
    { key: 'webhookId', label: 'Webhook ID' },
  ],
  tabby: [
    { key: 'publicKey', label: 'Public Key' },
    { key: 'secretKey', label: 'Secret Key' },
    { key: 'webhookSecret', label: 'Webhook Secret' },
  ],
  tamara: [
    // publicKey has no bearing on the real checkout integration (that only
    // ever needs apiToken, server-side) — it exists purely for
    // PaymentSettingsService.resolvePublicWidgetKey, which feeds Tamara's
    // client-side installment-promo widget on the PDP (a separate, optional
    // feature from actual checkout — see that widget's own component).
    { key: 'publicKey', label: 'Public Key' },
    { key: 'apiUrl', label: 'API URL' },
    { key: 'apiToken', label: 'API Token' },
    { key: 'notificationToken', label: 'Notification Token' },
  ],
};
