export interface Shop {
  // Every other storefront-facing endpoint (products/categories/outlets/
  // checkout) 404s for an unpublished shop — this field alone is what's
  // still exposed, specifically so ShopLayoutClient can render a branded
  // "Coming soon" placeholder instead of a dead end. See backend
  // PublicService.assertPublished.
  published: boolean;
  name: string;
  displayName: string | null;
  legalName: string | null;
  trademarkFormat: "brand" | "legal";
  email: string | null;
  logoUrl: string | null;
  description: string | null;
  currency: string;
  defaultLanguage: string;
  whatsappCountryCode: string | null;
  whatsappNumber: string | null;
  whatsappFloatingButtonEnabled: boolean;
  disableStoreCart: boolean;
  cartDisabledMode: "buy_now" | "contact_to_order";
  socialLinks: Record<string, string> | null;
  productDisplayOrientation: "grid" | "list";
  productImageZoomEnabled: boolean;
  showCategoryMenu: boolean;
  taxRate: string;
  taxInclusive: boolean;
  taxDisplayText: string | null;
  allowSameDayOrders: boolean;
  allowNextDayOrders: boolean;
  defaultDeliveryFee: string;
  deliveryTimeSlotGapMinutes: number;
  pickupTimeSlotGapMinutes: number;
  estimatedDeliveryTimeFrom: number;
  estimatedDeliveryTimeTo: number;
  estimatedDeliveryTimeUnit: string;
  pickupPreparationTimeMinutes: number;
  deliveryPreparationTimeMinutes: number;
  businessHours: DayHours | null;
  deliveryHours: DayHours | null;
  pickupHours: DayHours | null;
  deliveryPaymentCardOnline: boolean;
  deliveryPaymentCashOnDelivery: boolean;
  deliveryPaymentCardOnDelivery: boolean;
  pickupPaymentCardOnline: boolean;
  pickupPaymentCashOnPickup: boolean;
  pickupPaymentCardOnPickup: boolean;
  brandColor: string | null;
  secondaryColor: string | null;
  bannerUrl: string | null;
  heroText: string | null;
  faviconUrl: string | null;
  fontFamily: FontChoice | null;
  metaTitle: string | null;
  metaDescription: string | null;
  // Falls back to Theme's banner/logo server-side (see backend
  // PublicService.getShop) — never null on a shop with any branding set.
  ogImage: string | null;
  keywords: string | null;
  // Rendered in the footer's brand column — see components/Footer.tsx.
  footerLogoUrl: string | null;
  footerDescription: string | null;
  notificationText: string[] | null;
  announcementBarEnabled: boolean;
  announcementBarScrolling: boolean;
  contactNumbers: string[] | null;
  // Real multi-image slideshow banners — see components/home-layouts/
  // SlideshowHero.tsx. bannerUrl below is still used by non-slideshow
  // layouts (ClassicHero) that only ever wanted one image.
  banners: { id: number; url: string; linkUrl: string | null; order: number }[];
  // Which policy types a merchant has actually written content for — the
  // footer only links to types in this list (see components/Footer.tsx).
  policyPageTypes: string[];
  // Raw per-key overrides — see lib/theme-colors.ts for the full key list,
  // CSS var mapping, and defaults; applied in shop-context.tsx's applyTheme.
  colors: Record<string, string> | null;
  // Advanced tab — see HomepageLayout below. Always a real value (defaults
  // to "classic" server-side even for a shop that's never touched Theme).
  homepageLayout: HomepageLayout;
  // Theme Customizer v2 — see the enum exports below. Every field here is
  // always a real, non-null value (defaults server-side to the pre-this-
  // task behavior), same rule as homepageLayout above.
  topBarLayout: TopBarLayout;
  iconStyle: IconStyle;
  buttonRadius: ButtonRadius;
  buttonFill: ButtonFill;
  pdpLayout: PdpLayout;
  cartLayout: CartLayout;
  checkoutLayout: CheckoutLayout;
  footerLayout: FooterLayout;
  headerDensity: Density;
  footerDensity: Density;
  // Whether the shop's active card processor (Nomod/Stripe — see admin
  // Settings > Payment Gateways) is actually enabled, not just whether
  // card_online is offered as a payment method type at all
  // (deliveryPaymentCardOnline/pickupPaymentCardOnline above already cover
  // that). Both must be true for "Pay online" to actually work — a merchant
  // who's explicitly disabled their only card processor still has
  // deliveryPaymentCardOnline=true by default, so this second check is what
  // actually hides the option in that case.
  cardProcessorEnabled: boolean;
  // Independent online providers (PayPal/Tabby/Tamara) currently enabled
  // for this shop — see backend PublicService.getShop /
  // PaymentSettingsService.isEnabled. Each becomes its own selectable
  // payment method at checkout, available for both delivery and pickup.
  enabledPaymentProviders: string[];
}

// Curated list — kept in sync by hand with backend/src/theme/constants.ts
// and admin/lib/types.ts. Each value doubles as the next/font/google family
// this app preloads (see app/layout.tsx) — no arbitrary font upload.
export const FONT_CHOICES = ["inter", "poppins", "playfair-display", "roboto"] as const;
export type FontChoice = (typeof FONT_CHOICES)[number];

// Mirrors backend/src/theme/constants.ts's HOMEPAGE_LAYOUTS by hand.
// 'custom' is reserved for a future full drag-and-drop builder — the admin
// UI can't select it yet, but the storefront's dispatch still needs a safe
// fallback for it (see app/[shop]/page.tsx) rather than assuming it can
// never appear.
export const HOMEPAGE_LAYOUTS = ["classic", "slideshow", "featured_grid", "grid_first", "custom"] as const;
export type HomepageLayout = (typeof HOMEPAGE_LAYOUTS)[number];

// Theme Customizer v2 — mirrors backend/src/theme/constants.ts by hand (same
// no-shared-package tradeoff as everything else on this page). See
// lib/layout.tsx (top bar/PDP/cart/checkout dispatch), lib/icon-style.ts,
// and lib/button-style.ts for where each one is actually consumed.
export const TOP_BAR_LAYOUTS = ["logo_left", "logo_center", "minimal"] as const;
export type TopBarLayout = (typeof TOP_BAR_LAYOUTS)[number];

export const ICON_STYLES = ["outline", "solid"] as const;
export type IconStyle = (typeof ICON_STYLES)[number];

export const BUTTON_RADII = ["sharp", "rounded", "pill"] as const;
export type ButtonRadius = (typeof BUTTON_RADII)[number];

export const BUTTON_FILLS = ["solid", "outline"] as const;
export type ButtonFill = (typeof BUTTON_FILLS)[number];

export const PDP_LAYOUTS = ["gallery_left", "gallery_top"] as const;
export type PdpLayout = (typeof PDP_LAYOUTS)[number];

export const CART_LAYOUTS = ["full_page", "drawer"] as const;
export type CartLayout = (typeof CART_LAYOUTS)[number];

export const CHECKOUT_LAYOUTS = ["single_page", "step_by_step"] as const;
export type CheckoutLayout = (typeof CHECKOUT_LAYOUTS)[number];

export const FOOTER_LAYOUTS = ["columns", "centered"] as const;
export type FooterLayout = (typeof FOOTER_LAYOUTS)[number];

export const DENSITY_OPTIONS = ["compact", "regular", "spacious"] as const;
export type Density = (typeof DENSITY_OPTIONS)[number];

export type DayHours = Record<string, { open: string; close: string; closed: boolean }>;

export interface Category {
  id: number;
  name: string;
  slug: string;
  displayOrder: number;
  image: string | null;
  isFeatured: boolean;
  parentCategoryId: number | null;
}

export interface CollectionSummary {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  image: string | null;
  type: "MANUAL" | "RULE_BASED";
}

export interface CollectionDetail {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  image: string | null;
  products: Product[];
}

export interface ProductImage {
  id: number;
  url: string;
  order: number;
}

export interface ProductAttribute {
  id: number;
  name: string;
  value: string;
  order: number;
}

export interface ProductFaq {
  id: number;
  question: string;
  answer: string;
  order: number;
}

export interface ProductOptionValue {
  id: number;
  value: string;
  order: number;
}

export interface ProductOption {
  id: number;
  name: string;
  order: number;
  values: ProductOptionValue[];
}

// price/compareAtPrice null only for malformed/legacy data — every variant
// generated by ProductsService.updateOptions gets a real price at creation
// time (copied from the parent product), so the storefront can treat these
// as effectively always-set once hasVariants is true.
export interface ProductVariant {
  id: number;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compareAtPrice: string | null;
  imageUrl: string | null;
  optionValue1Id: number | null;
  optionValue2Id: number | null;
  optionValue3Id: number | null;
  label: string | null;
  stockQuantity: number | null; // null = no outlet context; not "unlimited" the way product-level null can mean
}

export interface Product {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  shortSummary: string | null;
  longSummary: string | null;
  thumbnail: string;
  price: string;
  sku: string;
  status: string;
  trackInventory: boolean;
  categories: { id: number; name: string }[];
  stockQuantity: number | null; // null = unlimited/unknown (no outlet context or not tracked)
  images: ProductImage[];
  attributes: ProductAttribute[];
  faqs: ProductFaq[];
  // Per-product opt-in gating whether the Attributes/FAQs sections below
  // render on the PDP at all — replaces the old shop-wide
  // productAttributesEnabled/productFaqsEnabled toggles. See ProductDetailClient.
  showAttributes: boolean;
  showFaqs: boolean;
  hasVariants: boolean;
  options: ProductOption[];
  variants: ProductVariant[];
  // Already fallback-resolved server-side (name / truncated description) —
  // never null, see backend PublicService.toProductResponse.
  metaTitle: string;
  metaDescription: string | null;
  // Gift Cards — when true, `price` is a placeholder; the shopper picks a
  // denomination (or a custom amount within min/max) instead. See
  // ProductDetailClient's gift-card branch.
  isGiftCard: boolean;
  giftCardDenominations: number[] | null;
  giftCardCustomAmountMin: string | null;
  giftCardCustomAmountMax: string | null;
  // Offered in the checkout add-ons popup for carts that don't already
  // contain this product.
  isCheckoutAddon: boolean;
}

export interface Outlet {
  id: number;
  name: string;
  nameAr: string | null;
  emirate: string | null;
  area: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryRadiusKm: number | null;
  businessHours: DayHours | null;
  isOpen: boolean;
}

export interface DeliveryZone {
  id: number;
  name: string;
  fee: string;
  minOrderAmount: string;
}

export type OrderType = "delivery" | "pickup";
export type PaymentMethod =
  | "card_online"
  | "cash_on_delivery"
  | "card_on_delivery"
  | "cash_on_pickup"
  | "card_on_pickup"
  // Independent online providers (Payment Gateways settings) — available
  // for both delivery and pickup once enabled, unlike card_online's
  // separate delivery/pickup toggles. See shop.enabledPaymentProviders.
  | "paypal"
  | "tabby"
  | "tamara";

export interface CreateOrderPayload {
  outletId: number;
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress: string;
  emirate: string;
  area?: string;
  latitude?: number;
  longitude?: number;
  deliveryDate?: string;
  deliveryTimeSlot?: string;
  deliveryNotes?: string;
  receiverMessage?: string;
  // Captured from ?ref=<code> and persisted — see lib/referral.ts. An
  // unknown/expired/blocked code is silently ignored server-side, never
  // blocks checkout.
  referralCode?: string;
  // Re-validated and atomically claimed server-side — unlike referralCode,
  // an invalid/expired/exhausted discount code rejects the whole checkout
  // rather than being silently dropped (see backend PublicService.createOrder).
  discountCode?: string;
  // Re-validated and atomically claimed server-side, same discipline as
  // discountCode — applies up to min(remainingBalance, order total),
  // combines with whichever paymentMethod covers any remainder.
  giftCardCode?: string;
  items: { productId: number; variantId?: number; quantity: number; giftCardAmount?: number; note?: string }[];
}

export interface OrderResult {
  id: number;
  channel: string | null;
  orderType: string | null;
  paymentMethod: string | null;
  deliveryFee: string | null;
  taxAmount: string | null;
  discountCode: string | null;
  discountAmount: string | null;
  total: string;
  status: string;
  customerName: string;
  // Short code the customer needs to look their order up later — there's no
  // login system, so this (not the sequential order id) is the credential.
  trackingToken: string | null;
}

export interface CreateOrderResponse {
  order: OrderResult;
  checkoutUrl: string | null;
}

export interface OrderLookupResult {
  id: number;
  shopName: string;
  outletName: string;
  customerName: string;
  status: string;
  orderType: string | null;
  paymentStatus: string;
  deliveryDate: string | null;
  deliveryTimeSlot: string | null;
  items: { productName: string; variantLabel: string | null; quantity: number; priceAtPurchase: string }[];
  deliveryFee: string | null;
  taxAmount: string | null;
  total: string;
  currency: string;
  createdAt: string;
  estimatedTime: string | null;
  // Whether this order's contact info belongs to a registered (has ever set
  // a password) customer account — not whether anyone is currently signed
  // in. Drives the light "sign in to see all your orders" prompt on the
  // tracking page for a guest visitor holding the link.
  hasAccount: boolean;
}

export interface SurveyLookupResult {
  shopName: string;
  rating: number | null;
  comment: string | null;
  respondedAt: string | null;
}

// Mirrors backend/src/bio-links/bio-link-constants.ts by hand.
export type BioLinkType = "EXTERNAL_URL" | "PRODUCT" | "CATEGORY" | "COLLECTION" | "SOCIAL_ICON";
export type BioLinkSocialPlatform =
  | "instagram"
  | "facebook"
  | "x"
  | "tiktok"
  | "whatsapp"
  | "youtube"
  | "snapchat"
  | "pinterest";

export interface BioLink {
  id: number;
  type: BioLinkType;
  label: string;
  // Present only for PRODUCT/CATEGORY/SOCIAL_ICON respectively — see backend
  // BioLinksService.listPublic, which already excludes anything unresolvable
  // (deleted/unavailable product or category, unconfigured social platform)
  // rather than sending a broken entry.
  product?: { name: string; slug: string; thumbnail: string } | null;
  category?: { name: string; slug: string; image: string | null } | null;
  collection?: { title: string; slug: string; image: string | null } | null;
  socialPlatform?: BioLinkSocialPlatform | null;
}

// Raw bio-specific overrides only — no fallback resolution server-side (see
// backend BioLinksService.getPublicPageConfig). lib/bio-page.ts's
// resolveBioPageDisplay and lib/seo.ts's buildBioPageMetadata do that
// merging here, reusing the Shop fields already fetched via useShop().
export interface BioPageConfig {
  logoUrl: string | null;
  backgroundUrl: string | null;
  description: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

// Mirrors backend DiscountsService.evaluate's return shape by hand.
export interface ValidateDiscountResult {
  valid: boolean;
  reason?: string;
  // Human-readable, specific to the rejection reason (not a generic
  // "invalid code") — see backend DISCOUNT_REJECTION_MESSAGES.
  message?: string;
  discountId?: number;
  code?: string;
  type?: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
  discountAmount?: number;
  freeShipping?: boolean;
}

// Mirrors backend GiftCardsService.validateCode's return shape by hand.
export interface ValidateGiftCardResult {
  valid: boolean;
  reason?: string;
  message?: string;
  giftCardId?: number;
  code?: string;
  remainingBalance?: number;
}

export interface AbandonedCartItemInput {
  productId: number;
  variantId?: number;
  name: string;
  variantLabel?: string;
  price: number;
  quantity: number;
  thumbnail: string;
}

// Customer-facing storefront accounts — mirrors backend
// CustomerAuthService/CustomerAccountService response shapes by hand.
export interface Customer {
  id: number;
  shopId: number;
  name: string;
  phone: string;
  email: string | null;
  emailVerified: boolean;
  registeredAt: string | null;
  createdAt: string;
}

export interface CustomerAuthResult {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  customer: Customer;
}

// Same shape checkout already collects (see CreateOrderPayload) plus a
// server-generated `id` — see backend schema.prisma's comment on
// customer.addresses.
export interface CustomerAddress {
  id: string;
  label?: string;
  address: string;
  emirate: string;
  area?: string;
  latitude?: number;
  longitude?: number;
}

export interface CustomerOrderSummary {
  id: number;
  status: string;
  orderType: string | null;
  paymentStatus: string;
  paymentMethod: string | null;
  outletName: string;
  deliveryDate: string | null;
  deliveryTimeSlot: string | null;
  customerAddress: string;
  items: { productName: string; variantLabel: string | null; quantity: number; priceAtPurchase: string }[];
  deliveryFee: string | null;
  taxAmount: string | null;
  discountAmount: string | null;
  total: string;
  trackingToken: string | null;
  createdAt: string;
  // True once the merchant has generated a real (INVOICE-type) invoice for
  // this order from the admin Order detail modal's Invoice tab — the
  // storefront never generates one itself, only downloads an already-issued
  // one, so this is what gates whether "Download Invoice" renders at all.
  hasInvoice: boolean;
}

// Mirrors backend/src/policy-pages/policy-page-constants.ts by hand.
export const POLICY_PAGE_TYPES = ["TERMS", "PRIVACY", "REFUND", "PAYMENT", "SHIPPING"] as const;
export type PolicyPageType = (typeof POLICY_PAGE_TYPES)[number];
export const POLICY_PAGE_LABELS: Record<PolicyPageType, string> = {
  TERMS: "Terms & Conditions",
  PRIVACY: "Privacy Policy",
  REFUND: "Refund & Return Policy",
  PAYMENT: "Payment Policy",
  SHIPPING: "Shipping & Delivery Policy",
};
export interface SearchResultItem {
  id: number;
  name: string;
  slug: string;
  thumbnail: string;
  price: string;
}

export interface SearchResponse {
  results: SearchResultItem[];
  nextCursor: string | null;
  matchType: "exact" | "fuzzy" | "none";
  suggestion: string | null;
}

export interface PolicyPage {
  type: PolicyPageType;
  content: string;
  updatedAt: string;
}

export const EMIRATES = [
  "Abu Dhabi",
  "Dubai",
  "Sharjah",
  "Ajman",
  "Umm Al Quwain",
  "Ras Al Khaimah",
  "Fujairah",
] as const;
