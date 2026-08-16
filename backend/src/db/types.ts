// AUTO-GENERATED ONCE from prisma/schema.prisma by scripts/generate-db-types.ts.
// schema.prisma has since been removed — this file is now the source of
// truth for row shapes. Edit by hand going forward.

export interface OrderRow {
  id: number;
  shopId: number;
  outletId: number;
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerAddress: string;
  emirate: string;
  area: string | null;
  deliveryDate: Date | null;
  deliveryTimeSlot: string | null;
  deliveryNotes: string | null;
  receiverMessage: string | null;
  channel: string | null;
  orderType: string | null;
  paymentMethod: string | null;
  status: string;
  paymentStatus: string;
  deliveryFee: string | null;
  taxAmount: string | null;
  discountId: number | null;
  discountCode: string | null;
  discountAmount: string | null;
  giftCardId: number | null;
  giftCardCode: string | null;
  giftCardAmount: string | null;
  total: string;
  createdAt: Date;
  paymentLinkToken: string | null;
  paymentLinkExpiresAt: Date | null;
  trackingToken: string | null;
  ingredientsConsumedAt: Date | null;
}

export interface OrdernoteRow {
  id: number;
  orderId: number;
  authorUserId: number;
  note: string;
  createdAt: Date;
}

export interface AuditlogRow {
  id: number;
  shopId: number;
  actorUserId: number;
  action: string;
  entityType: string;
  entityId: number | null;
  before: unknown | null;
  after: unknown | null;
  metadata: unknown | null;
  createdAt: Date;
}

export interface ExternaldeliveryRow {
  id: number;
  orderId: number;
  carrier: string;
  vehicleType: string | null;
  price: string;
  destination: string;
  status: string;
  createdAt: Date;
}

export interface SurveyresponseRow {
  id: number;
  shopId: number;
  orderId: number;
  token: string;
  rating: number | null;
  comment: string | null;
  respondedAt: Date | null;
  createdAt: Date;
}

export interface OrderitemRow {
  id: number;
  orderId: number;
  productId: number;
  productName: string;
  variantId: number | null;
  variantLabel: string | null;
  quantity: number;
  priceAtPurchase: string;
  note: string | null;
}

export interface OrderreturnRow {
  id: number;
  orderId: number;
  reason: string;
  refundAmount: string;
  refundMethod: string;
  providerRefundReference: string | null;
  giftCardRefundAmount: string;
  restocked: boolean;
  status: string;
  staffUserId: number;
  createdAt: Date;
}

export interface OrderreturnitemRow {
  id: number;
  orderReturnId: number;
  orderItemId: number;
  quantity: number;
}

export interface InvoiceRow {
  id: number;
  orderId: number;
  shopId: number;
  type: string;
  invoiceNumber: string;
  issuedAt: Date;
  subtotal: string;
  taxAmount: string;
  total: string;
  notes: string | null;
}

export interface InvoicecounterRow {
  shopId: number;
  type: string;
  lastNumber: number;
}

export interface PaymenttransactionRow {
  id: number;
  orderId: number;
  gateway: string;
  gatewayReference: string;
  providerChargeReference: string | null;
  amount: string;
  status: string;
  createdAt: Date;
}

export interface ProductRow {
  id: number;
  shopId: number;
  name: string;
  description: string | null;
  shortSummary: string | null;
  longSummary: string | null;
  thumbnail: string;
  price: string;
  compareAtPrice: string | null;
  costPrice: string | null;
  sku: string;
  barcode: string | null;
  status: string;
  trackInventory: boolean;
  continueSellingOutOfStock: boolean;
  usesIngredients: boolean;
  chargeTax: boolean;
  isCheckoutAddon: boolean;
  showVariants: boolean;
  showAttributes: boolean;
  showFaqs: boolean;
  isGiftCard: boolean;
  giftCardDenominations: unknown | null;
  giftCardCustomAmountMin: string | null;
  giftCardCustomAmountMax: string | null;
  vendor: string | null;
  productType: string | null;
  physicalProduct: boolean;
  weight: string | null;
  weightUnit: string;
  dimensions: string | null;
  createdAt: Date;
  slug: string;
  metaTitle: string | null;
  metaDescription: string | null;
}

export interface NotifysubscriptionRow {
  id: number;
  shopId: number;
  productId: number;
  variantId: number | null;
  email: string;
  createdAt: Date;
  notifiedAt: Date | null;
}

export interface ProductimageRow {
  id: number;
  productId: number;
  url: string;
  order: number;
}

export interface ProductattributeRow {
  id: number;
  productId: number;
  name: string;
  value: string;
  order: number;
}

export interface ProductfaqRow {
  id: number;
  productId: number;
  question: string;
  answer: string;
  order: number;
}

export interface ProductoptionRow {
  id: number;
  productId: number;
  name: string;
  order: number;
}

export interface ProductoptionvalueRow {
  id: number;
  optionId: number;
  value: string;
  order: number;
}

export interface CollectionRow {
  id: number;
  shopId: number;
  name: string;
  slug: string;
  displayOrder: number;
  image: string | null;
  isFeatured: boolean;
  parentCollectionId: number | null;
  createdAt: Date;
}

export interface ProductcollectionRow {
  productId: number;
  collectionId: number;
}

export interface TagRow {
  id: number;
  shopId: number;
  name: string;
}

export interface ProducttagRow {
  productId: number;
  tagId: number;
}

export interface ProductvariantRow {
  id: number;
  productId: number;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compareAtPrice: string | null;
  weight: string | null;
  imageId: number | null;
  order: number;
  optionValue1Id: number | null;
  optionValue2Id: number | null;
  optionValue3Id: number | null;
  createdAt: Date;
}

export interface ShopRow {
  id: number;
  name: string;
  subdomain: string;
  currency: string;
  createdAt: Date;
  published: boolean;
  updatedAt: Date;
  displayName: string | null;
  legalName: string | null;
  trademarkFormat: string;
  logoUrl: string | null;
  email: string | null;
  whatsappCountryCode: string | null;
  whatsappNumber: string | null;
  description: string | null;
  country: string | null;
  address: string | null;
  timezone: string;
  notifyWhatsapp: boolean;
  notifyCustomersWhatsapp: boolean;
  notifyEmail: boolean;
  notifyAbandonedCart: boolean;
  abandonedCartWindowMinutes: number;
  notifyLowStockDigest: boolean;
  lowStockDigestLastSentAt: Date | null;
  autoDeductIngredientStock: boolean;
  whatsappCredentials: string | null;
  trn: string | null;
  websiteUrl: string | null;
  customDomain: string | null;
  domainType: string;
  operatingModel: string | null;
  branchCount: string | null;
  businessType: string | null;
  defaultLanguage: string;
  defaultDeliveryFee: string;
  taxDisplayText: string | null;
  productDisplayOrientation: string;
  productImageZoomEnabled: boolean;
  showCollectionMenu: boolean;
  allowPreOrders: boolean;
  customerConfirmationRequired: boolean;
  externalDeliveryEnabled: boolean;
  asapDeliveryEnabled: boolean;
  deliveryCalendarEnabled: boolean;
  businessHours: string | null;
  whatsappFloatingButtonEnabled: boolean;
  birthdayDiscountEnabled: boolean;
  productEditorMode: string;
  customerSurveyEnabled: boolean;
  disableStoreCart: boolean;
  cartDisabledMode: string;
  dynamicThemeBuilderEnabled: boolean;
  socialLinks: unknown | null;
  paymentGateway: string;
  deliveryPaymentCardOnline: boolean;
  deliveryPaymentCashOnDelivery: boolean;
  deliveryPaymentCardOnDelivery: boolean;
  pickupPaymentCardOnline: boolean;
  pickupPaymentCashOnPickup: boolean;
  pickupPaymentCardOnPickup: boolean;
  deliveryHours: unknown | null;
  pickupHours: unknown | null;
  deliveryTimeSlotGapMinutes: number;
  deliveryPreparationTimeMinutes: number;
  deliveryPreparationPlusDeliveryTimeMinutes: number;
  estimatedDeliveryTimeFrom: number;
  estimatedDeliveryTimeTo: number;
  estimatedDeliveryTimeUnit: string;
  pickupTimeSlotGapMinutes: number;
  pickupPreparationTimeMinutes: number;
  pickupPreparationPlusTimeMinutes: number;
  allowSameDayOrders: boolean;
  allowNextDayOrders: boolean;
  taxRate: string;
  taxInclusive: boolean;
}

export interface PolicypageRow {
  id: number;
  shopId: number;
  type: string;
  content: string;
  updatedAt: Date;
}

export interface BannerimageRow {
  id: number;
  shopId: number;
  url: string;
  linkUrl: string | null;
  order: number;
}

export interface BiolinkRow {
  id: number;
  shopId: number;
  type: string;
  label: string | null;
  url: string | null;
  productId: number | null;
  collectionId: number | null;
  templateId: number | null;
  socialPlatform: string | null;
  order: number;
  active: boolean;
  clickCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BiolinkpageconfigRow {
  id: number;
  shopId: number;
  logoUrl: string | null;
  backgroundUrl: string | null;
  description: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

export interface TemplateRow {
  id: number;
  shopId: number;
  title: string;
  slug: string;
  description: string | null;
  image: string | null;
  type: string;
  rules: unknown | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
}

export interface TemplateproductRow {
  templateId: number;
  productId: number;
  sortOrder: number;
}

export interface TemplatecollectionRow {
  templateId: number;
  collectionId: number;
  sortOrder: number;
}

export interface MenuitemRow {
  id: number;
  shopId: number;
  label: string;
  type: string;
  collectionId: number | null;
  displayOrder: number;
  createdAt: Date;
}

export interface MenuitemcollectionRow {
  menuItemId: number;
  collectionId: number;
  sortOrder: number;
}

export interface AffiliateRow {
  id: number;
  shopId: number;
  name: string;
  mobile: string;
  status: string;
  createdAt: Date;
}

export interface AffiliatecodeRow {
  id: number;
  shopId: number;
  affiliateId: number;
  code: string;
  promotionFor: string;
  status: string;
  commissionType: string;
  commissionValue: string;
  validFrom: Date | null;
  validUntil: Date | null;
  createdAt: Date;
}

export interface AffiliateorderRow {
  id: number;
  shopId: number;
  orderId: number;
  affiliateCodeId: number;
  commissionAmount: string;
  status: string;
  createdAt: Date;
}

export interface ShoppaymentproviderRow {
  id: number;
  shopId: number;
  provider: string;
  enabled: boolean;
  credentials: string | null;
  updatedAt: Date;
}

export interface NewslettersubscriberRow {
  id: number;
  shopId: number;
  email: string;
  source: string;
  createdAt: Date;
}

export interface CustomerRow {
  id: number;
  shopId: number;
  name: string;
  phone: string;
  email: string | null;
  birthday: Date | null;
  addresses: unknown | null;
  createdAt: Date;
  passwordHash: string | null;
  emailVerified: boolean;
  registeredAt: Date | null;
  lastDataExportAt: Date | null;
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
}

export interface CustomerrefreshtokenRow {
  id: number;
  customerId: number;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CustomerauthtokenRow {
  id: number;
  customerId: number;
  purpose: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface OutletRow {
  id: number;
  shopId: number;
  name: string;
  nameAr: string | null;
  email: string | null;
  whatsapp: string | null;
  active: boolean;
  emirate: string | null;
  area: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  businessHours: unknown | null;
  closedOverride: boolean;
  closedOverrideSetAt: Date | null;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryRadiusKm: number | null;
  createdAt: Date;
}

export interface DeliveryzoneRow {
  id: number;
  outletId: number;
  name: string;
  fee: string;
  minOrderAmount: string;
  isActive: boolean;
  createdAt: Date;
}

export interface IngredientRow {
  id: number;
  shopId: number;
  name: string;
  unit: string;
  trackInventory: boolean;
  image: string | null;
  description: string | null;
  costPerUnit: string | null;
  supplier: string | null;
  categoryId: number | null;
  shadowProductId: number | null;
  shadowVariantId: number | null;
  createdAt: Date;
}

export interface IngredientcategoryRow {
  id: number;
  shopId: number;
  name: string;
  createdAt: Date;
}

export interface BranchroleRow {
  id: number;
  shopId: number;
  name: string;
  permissions: unknown;
  createdAt: Date;
}

export interface UseroutletroleRow {
  id: number;
  userId: number;
  outletId: number;
  branchRoleId: number;
  createdAt: Date;
}

export interface OutletingredientstockRow {
  outletId: number;
  ingredientId: number;
  stockQuantity: number;
  lowStockThreshold: number | null;
}

export interface ProductingredientRow {
  id: number;
  shopId: number;
  productId: number;
  variantId: number | null;
  ingredientId: number;
  quantityPerUnit: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockmovementRow {
  id: number;
  shopId: number;
  productId: number | null;
  variantId: number | null;
  ingredientId: number | null;
  type: string;
  reason: string | null;
  delta: number;
  outletId: number;
  toOutletId: number | null;
  note: string | null;
  actorUserId: number | null;
  createdAt: Date;
  scanBatchId: number | null;
}

export interface ScanbatchRow {
  id: number;
  shopId: number;
  imageUrl: string;
  actorUserId: number;
  createdAt: Date;
}

export interface ScansettingsRow {
  id: number;
  shopId: number;
  excludeKeywords: unknown;
  includeKeywords: unknown;
  defaultOutletId: number | null;
  unmatchedBehavior: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThemesettingsRow {
  id: number;
  shopId: number;
  templateId: number | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  brandColor: string | null;
  secondaryColor: string | null;
  heroText: string | null;
  faviconUrl: string | null;
  fontFamily: string | null;
  footerLogoUrl: string | null;
  footerDescription: string | null;
  // Real JSON column as of 20260816130000_fix_notification_text_column (was
  // LONGTEXT — see that migration's comment) — mysql2 now auto-parses it on
  // read, same as every other real JSON column in this schema.
  notificationText: string[] | null;
  announcementBarEnabled: boolean;
  announcementBarScrolling: boolean;
  // Real JSON columns as of 20260816140000_fix_contact_numbers_colors_columns
  // (were LONGTEXT — see that migration's comment) — same fix as
  // notificationText above, just applied one PR later once the sibling bug
  // was confirmed to be live-crashing two real shops.
  contactNumbers: string[] | null;
  colors: Record<string, string> | null;
  homepageLayout: string;
  homeTabMode: string;
  topBarLayout: string;
  iconStyle: string;
  buttonRadius: string;
  buttonFill: string;
  pdpLayout: string;
  cartLayout: string;
  checkoutLayout: string;
  footerLayout: string;
  headerDensity: string;
  footerDensity: string;
  updatedAt: Date;
}

export interface ShopseosettingsRow {
  id: number;
  shopId: number;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImage: string | null;
  keywords: string | null;
}

export interface UserRow {
  id: number;
  shopId: number;
  outletId: number | null;
  email: string;
  name: string;
  passwordHash: string;
  phone: string | null;
  role: string;
  emailVerified: boolean;
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
  createdAt: Date;
}

export interface RefreshtokenRow {
  id: number;
  userId: number;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface AuthtokenRow {
  id: number;
  userId: number;
  purpose: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface DiscountRow {
  id: number;
  shopId: number;
  code: string;
  type: string;
  value: string | null;
  minPurchaseAmount: string | null;
  appliesTo: string;
  usageLimit: number | null;
  usageLimitPerCustomer: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  timesUsed: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscountproductRow {
  discountId: number;
  productId: number;
}

export interface DiscountcollectionRow {
  discountId: number;
  collectionId: number;
}

export interface DiscountredemptionRow {
  id: number;
  discountId: number;
  customerId: number | null;
  orderId: number;
  createdAt: Date;
}

export interface DraftorderRow {
  id: number;
  shopId: number;
  outletId: number;
  status: string;
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerAddress: string | null;
  emirate: string | null;
  area: string | null;
  orderType: string | null;
  discountId: number | null;
  notes: string | null;
  convertedOrderId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DraftorderitemRow {
  id: number;
  draftOrderId: number;
  productId: number;
  variantId: number | null;
  productName: string;
  quantity: number;
  price: string;
}

export interface AbandonedcartRow {
  id: number;
  shopId: number;
  outletId: number | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  cartItems: unknown;
  cartValue: string;
  capturedAt: Date;
  updatedAt: Date;
  recoverToken: string;
  recoveryEmailSentAt: Date | null;
  recoveredOrderId: number | null;
}

export interface GiftcardRow {
  id: number;
  shopId: number;
  code: string;
  initialValue: string;
  remainingBalance: string;
  status: string;
  expiresAt: Date | null;
  purchasedByCustomerId: number | null;
  purchaseOrderId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GiftcardredemptionRow {
  id: number;
  giftCardId: number;
  orderId: number;
  amountUsed: string;
  createdAt: Date;
}

export interface JobRow {
  id: number;
  shopId: number;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

// New visual theme builder — see prisma/migrations/20260812130000_create_theme_table.
// `config`/`publishedConfig` are real JSON columns (auto-parsed by
// DatabaseService), typed `unknown` here and narrowed to `ThemeConfig` at the
// service boundary, same convention as every other JSON column in this file.
export interface ThemeRow {
  id: number;
  shopId: number;
  name: string;
  isPublished: boolean;
  config: unknown;
  publishedConfig: unknown;
  publishedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduledjoblockRow {
  name: string;
  lockedUntil: Date | null;
}
