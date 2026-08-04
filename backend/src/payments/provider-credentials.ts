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
//   apiUrl/apiToken/notificationToken respectively, matching those
//   providers' own env var fallbacks (TABBY_PUBLIC_KEY/TABBY_SECRET_KEY/
//   TABBY_WEBHOOK_SECRET, TAMARA_API_URL/TAMARA_TOKEN/TAMARA_NOTIFICATION_TOKEN).
//   Was a single-field placeholder from the earlier structural-stub task.
// - paypal: standard PayPal REST API OAuth2 client-credentials shape — a
//   reasonable, well-known field shape even though createCheckoutSession
//   itself is a structural stub (see providers/paypal-payment.provider.ts).
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
  ],
  tabby: [
    { key: 'publicKey', label: 'Public Key' },
    { key: 'secretKey', label: 'Secret Key' },
    { key: 'webhookSecret', label: 'Webhook Secret' },
  ],
  tamara: [
    { key: 'apiUrl', label: 'API URL' },
    { key: 'apiToken', label: 'API Token' },
    { key: 'notificationToken', label: 'Notification Token' },
  ],
};
