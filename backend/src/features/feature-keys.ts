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
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURE_KEYS;

export const FEATURE_KEY_LIST = Object.keys(FEATURE_KEYS) as FeatureKey[];

export function isFeatureKey(key: string): key is FeatureKey {
  return (FEATURE_KEY_LIST as string[]).includes(key);
}
