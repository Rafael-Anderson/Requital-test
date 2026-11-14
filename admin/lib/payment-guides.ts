// Static "How to get your keys" guides for Settings > Integrations > Payments.
//
// Content only: no network call, no backend. Every field name used below is the label
// the credential form really shows (PROVIDER_CREDENTIAL_FIELDS in lib/types.ts), and
// a test pins that so a renamed field cannot leave a guide pointing at nothing.
//
// LOCALES. The admin has no translation mechanism today (English only, lang="en", no
// dictionary), so this module is keyed by locale from the start but ships "en" only.
// An Arabic entry is added here, reviewed by a native speaker, when the admin gains
// i18n; getPaymentGuide() falls back to English for any locale with no entry, and
// the modal body is `dir="auto"` so an RTL entry reads correctly without a change.
//
// VENDOR STEPS. Menu paths are the vendors' own public documentation as read on
// 2026-11-14. Where a vendor does not publish a stable path (Tabby, Tamara) the step
// stays generic on purpose rather than inventing one.

export type GuideLocale = "en";
export type PaymentGuideId = "nomod" | "stripe" | "paypal" | "tabby" | "tamara" | "cod";

// A step may ask the modal to render this shop's own value under it.
export type GuideSlot = "webhookUrl" | "nomodEvents";

export interface GuideStep {
  text: string;
  slot?: GuideSlot;
}

export interface PaymentGuide {
  title: string;
  intro?: string;
  steps: GuideStep[];
  notes: string[];
}

// The 8 events a Nomod Hosted Checkout webhook must subscribe to.
export const NOMOD_WEBHOOK_EVENTS = [
  "charge.created",
  "charge.authorised",
  "charge.completed",
  "charge.failed",
  "charge.cancelled",
  "charge.refunded",
  "charge.partially_refunded",
  "charge.dispute.created",
] as const;

const KEEP_PRIVATE = "Keep these keys private. Never share them or paste them anywhere except this page.";

const EN: Record<PaymentGuideId, PaymentGuide> = {
  nomod: {
    title: "Connect Nomod",
    steps: [
      { text: "Sign in to a verified Nomod account." },
      { text: "Go to Settings > Tools & customisations > Apps & APIs." },
      {
        text:
          "Tap Nomod Hosted Checkout, then Create API key. Copy the key straight away, because Nomod never shows it again. Paste it into the API Key field on this page.",
      },
      {
        text:
          "In the same place, open Webhooks and choose Create webhook. Set the integration type to Nomod Hosted Checkout and select all 8 events:",
        slot: "nomodEvents",
      },
      {
        text:
          "For the endpoint URL, use this shop's webhook address. It is the same value as the webhook box under the card form.",
        slot: "webhookUrl",
      },
      {
        text:
          "Copy the signing secret Nomod shows you (it starts with whsec_) and paste it into the Webhook Signing Secret field on this page.",
      },
      { text: "Save, then press Test connection under the form." },
      { text: "Switch Card processing to Nomod and save. Stripe turns off when you do." },
    ],
    notes: [
      KEEP_PRIVATE,
      "If a key is ever exposed, revoke it in Nomod and create a new one.",
      "Nomod accepts AED, USD, EUR, GBP and SAR.",
      "Apple Pay, Google Pay, cards, Tabby and Tamara appear on Nomod's own hosted payment page.",
      "Payouts and fees are handled by Nomod.",
    ],
  },
  stripe: {
    title: "Connect Stripe",
    intro: "These steps use your own Stripe account. Use test mode keys first if you want to try a payment safely.",
    steps: [
      { text: "Sign in to the Stripe Dashboard." },
      {
        text:
          "Open Developers, then API keys. Reveal your Secret key (it starts with sk_) and paste it into the Secret Key field on this page. Do not use the Publishable key.",
      },
      {
        text:
          "In Developers, open Webhooks and add an endpoint. Use this shop's Stripe webhook address as the endpoint URL:",
        slot: "webhookUrl",
      },
      {
        text:
          "Select these events: checkout.session.completed and checkout.session.async_payment_failed. Save the endpoint.",
      },
      {
        text:
          "Open the new endpoint and reveal its Signing secret (it starts with whsec_). Paste it into the Webhook Secret field on this page.",
      },
      { text: "Choose Stripe under Card processing and press Save card processor." },
    ],
    notes: [KEEP_PRIVATE, "If a key is ever exposed, roll it in the Stripe Dashboard and paste the new one here."],
  },
  paypal: {
    title: "Connect PayPal",
    steps: [
      { text: "Sign in to the PayPal Developer Dashboard with your business account." },
      { text: "Open Apps & Credentials and create an app (or open an existing one). Choose Live for real payments." },
      { text: "Copy the app's Client ID into the Client ID field on this page." },
      { text: "Reveal the app's Secret and copy it into the Client Secret field." },
      {
        text:
          "In the same app, find Webhooks and choose Add Webhook. Use this shop's PayPal webhook address as the URL and select the payment capture events (completed and denied):",
        slot: "webhookUrl",
      },
      { text: "Copy the Webhook ID PayPal shows for that webhook into the Webhook ID field on this page." },
      { text: "Turn PayPal on, then press Save." },
    ],
    notes: [KEEP_PRIVATE, "Sandbox and Live use different credentials. Make sure all three values come from the same one."],
  },
  tabby: {
    title: "Connect Tabby",
    intro: "Tabby gives you your keys when it approves your merchant account.",
    steps: [
      { text: "Sign in to the Tabby merchant dashboard, or ask your Tabby account manager for your keys." },
      { text: "Copy your Public Key into the Public Key field on this page." },
      { text: "Copy your Secret Key into the Secret Key field." },
      { text: "Paste the Webhook Secret Tabby gave you for webhook signing into the Webhook Secret field." },
      {
        text:
          "If you show the Tabby widget on product pages, paste your Merchant Code into the Merchant Code field. Leave it blank to reuse the Public Key.",
      },
      { text: "Turn Tabby on, then press Save." },
    ],
    notes: [
      KEEP_PRIVATE,
      "Tabby sends its payment updates to Requital's shared Tabby webhook address, so there is no shop-specific URL to register. If Tabby asks you for a webhook URL, ask Requital support for it.",
      "Use Tabby's test credentials first and switch to live ones when Tabby approves your account.",
    ],
  },
  tamara: {
    title: "Connect Tamara",
    intro: "Tamara gives you your credentials when it approves your merchant account.",
    steps: [
      { text: "Sign in to your Tamara merchant account, or ask your Tamara contact for your credentials." },
      { text: "Choose the API URL: https://api-sandbox.tamara.co for testing or https://api.tamara.co for live payments. Enter it in the API URL field." },
      { text: "Copy your API Token into the API Token field." },
      { text: "Copy your Notification Token into the Notification Token field. It is used to check that updates really come from Tamara." },
      { text: "If you show the Tamara widget on product pages, copy your Public Key into the Public Key field." },
      { text: "Turn Tamara on, then press Save." },
    ],
    notes: [
      KEEP_PRIVATE,
      "Tamara sends its payment updates to Requital's shared Tamara webhook address, so there is no shop-specific URL to register. If Tamara asks you for a webhook URL, ask Requital support for it.",
      "The API Token and the API URL must belong to the same environment, sandbox or live.",
    ],
  },
  cod: {
    title: "Cash on Delivery",
    intro: "Cash on Delivery needs no keys.",
    steps: [
      { text: "Turn the Cash on Delivery switch on. Customers can then choose to pay in cash." },
      { text: "The switch controls delivery and pickup together: it enables Cash on Delivery for delivery orders and Cash on Pickup for pickup orders." },
      { text: "For finer control, such as allowing cash for one outlet only, open Outlets and adjust that outlet's payment options." },
      { text: "Cash is recorded as collected when it is handed over: staff record it on the order, or the driver records it in the driver app." },
    ],
    notes: [
      "Slider and other courier handoffs have their own cash limits, which are checked before a delivery is booked.",
      "Turn the switch off at any time. Orders already placed are not affected.",
    ],
  },
};

const GUIDES: Record<GuideLocale, Record<PaymentGuideId, PaymentGuide>> = { en: EN };

export function getPaymentGuide(id: PaymentGuideId, locale: string = "en"): PaymentGuide {
  const table = (GUIDES as Record<string, Record<PaymentGuideId, PaymentGuide>>)[locale] ?? GUIDES.en;
  return table[id] ?? GUIDES.en[id];
}

export const PAYMENT_GUIDE_IDS: PaymentGuideId[] = ["nomod", "stripe", "paypal", "tabby", "tamara", "cod"];
