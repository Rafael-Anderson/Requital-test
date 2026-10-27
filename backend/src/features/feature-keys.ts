import type { ShopRow } from '../db/types';

// The typed registry of per-shop features (PLT-11). Every key says where its
// value lives and what it is when nothing says otherwise.
//
//   source: 'column' - an existing boolean on `shop`, read through the adapter
//                      in FeaturesService. No data moved; the merchant keeps
//                      editing the same column they always did.
//   source: 'table'  - no shop column. Value is the override row, else
//                      `default`. New features land here.
//
// `default` is what applies when nothing else decides. For a column-backed key
// it mirrors the column's own DB default (the column is NOT NULL, so it is a
// documented statement of intent, not a value any read path currently reaches).
//
// WHAT IS NOT HERE, on purpose (see docs/handoff/w1.md for the audit):
//   - tax/money booleans (taxInclusive, taxOnDelivery), payment-method toggles,
//     `published`, `disableStoreCart`, allowSameDay/NextDayOrders: merchant
//     policy or state that changes what is charged or reachable, not a
//     capability a platform grants. A platform override on those would be a
//     way to silently change someone's money.
//   - the eight booleans nothing reads (notifyWhatsapp, allowPreOrders,
//     customerConfirmationRequired, externalDeliveryEnabled,
//     asapDeliveryEnabled, deliveryCalendarEnabled, birthdayDiscountEnabled,
//     dynamicThemeBuilderEnabled). Register one together with its consumer.
type BooleanShopColumn = {
  [K in keyof ShopRow]-?: ShopRow[K] extends boolean ? K : never;
}[keyof ShopRow];

export type FeatureDef =
  | {
      source: 'column';
      column: BooleanShopColumn;
      default: boolean;
      description: string;
    }
  | { source: 'table'; default: boolean; description: string };

export const FEATURE_KEYS = {
  slider: {
    source: 'column',
    column: 'sliderEnabled',
    default: false,
    description: 'Slider on-demand courier dispatch',
  },
  customer_survey: {
    source: 'column',
    column: 'customerSurveyEnabled',
    default: false,
    description: 'Post-delivery customer survey email',
  },
  notify_email: {
    source: 'column',
    column: 'notifyEmail',
    default: false,
    description: 'Order status emails to customers',
  },
  notify_customers_whatsapp: {
    source: 'column',
    column: 'notifyCustomersWhatsapp',
    default: false,
    description: 'Order status WhatsApp messages to customers',
  },
  abandoned_cart_recovery: {
    source: 'column',
    column: 'notifyAbandonedCart',
    default: false,
    description: 'Abandoned cart recovery emails',
  },
  low_stock_digest: {
    source: 'column',
    column: 'notifyLowStockDigest',
    default: false,
    description: 'Daily low stock digest email',
  },
  auto_deduct_ingredient_stock: {
    source: 'column',
    column: 'autoDeductIngredientStock',
    default: true,
    description: 'Deduct ingredient stock when an order is confirmed',
  },
  whatsapp_floating_button: {
    source: 'column',
    column: 'whatsappFloatingButtonEnabled',
    default: false,
    description: 'Storefront WhatsApp floating button',
  },
  product_image_zoom: {
    source: 'column',
    column: 'productImageZoomEnabled',
    default: true,
    description: 'Storefront product image zoom',
  },
  collection_menu: {
    source: 'column',
    column: 'showCollectionMenu',
    default: true,
    description: 'Storefront collection menu bar',
  },
  // E1. Gates creating and enabling marketplace (Deliveroo / Talabat) channel
  // connections, so the platform grants it per shop. Deliberately NOT consulted
  // when a webhook arrives for an already-enabled connection: switching the flag
  // off must not make the platform drop orders the marketplace has accepted.
  marketplace_channels: {
    source: 'table',
    default: false,
    description: 'Marketplace channels (Deliveroo, Talabat) order intake',
  },
  // Phone OTP on customer register-claim. Gates the send/verify routes and makes
  // register demand a proof of control of the phone. Ships off with a stub delivery
  // channel. BEFORE enabling it for any shop:
  //   - a real OtpChannel (SMS/WhatsApp provider, approved templates, sender-ID
  //     registration per country) must exist: with the stub nothing is delivered
  //     and registration is impossible for that shop;
  //   - TRUST_PROXY=loopback must be set (it is in production), or every per-IP
  //     throttle is one shared bucket;
  //   - know that the per-phone (1/60s, 5/h, 10/day) and per-shop (daily cap)
  //     send caps are also a denial-of-registration lever: someone can burn a
  //     number's or a shop's quota to stop real customers getting a code;
  //   - the allowed country is read live from shop.countryCode, so changing a
  //     shop's country changes which numbers may receive a code (and E.164
  //     normalisation for numbers already stored).
  phone_otp_register: {
    source: 'table',
    default: false,
    description:
      'Phone one-time code required to register a storefront account',
  },
  // MKT-1. Gates the campaign admin routes, the send itself (re-checked by every
  // batch, so switching it off stops an in-flight campaign) and the newsletter
  // double opt-in email. Ships off; the platform turns it on per shop. BEFORE
  // enabling it for a shop: the shop needs a VERIFIED sending domain (the only
  // way a campaign is sent), and the merchant should know that unconfirmed
  // newsletter rows and customers with no recorded email consent are never mailed.
  // Enabling it ALSO requires TRUST_PROXY=loopback (set in production): the public
  // unsubscribe and newsletter-confirm routes are throttled per client IP (20/min),
  // and without it every caller shares one bucket behind the proxy.
  email_campaigns: {
    source: 'table',
    default: false,
    description: 'Consent-gated email campaigns and newsletter confirmation',
  },
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURE_KEYS;

export const FEATURE_KEY_LIST = Object.keys(FEATURE_KEYS) as FeatureKey[];

export function isFeatureKey(key: string): key is FeatureKey {
  return (FEATURE_KEY_LIST as string[]).includes(key);
}
