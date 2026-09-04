export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Mirrors the linear flow + CAS transition rules in backend/src/orders/constants.ts
// (isValidStatusTransition) — keep in sync by hand, same as the rest of this file.
const STATUS_FLOW: OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
];

export function getValidNextStatuses(current: OrderStatus): OrderStatus[] {
  if (current === "delivered" || current === "cancelled") return [];
  const next = STATUS_FLOW[STATUS_FLOW.indexOf(current) + 1];
  return next ? [next, "cancelled"] : ["cancelled"];
}

// Single forward action for a status, with the label used on kanban cards
// and the detail modal — same underlying transition, one place to name it.
const NEXT_ACTION: Partial<Record<OrderStatus, { next: OrderStatus; label: string }>> = {
  pending: { next: "confirmed", label: "Accept" },
  confirmed: { next: "preparing", label: "Start preparing" },
  preparing: { next: "out_for_delivery", label: "Mark out for delivery" },
  out_for_delivery: { next: "delivered", label: "Mark delivered" },
};

export function getNextAction(status: OrderStatus) {
  return NEXT_ACTION[status] ?? null;
}

export interface OrderItem {
  id: number;
  productId: number;
  productName: string;
  variantId?: number | null;
  variantLabel?: string | null;
  quantity: number;
  priceAtPurchase: string;
  // Optional note the customer typed on the storefront PDP at add-to-cart
  // time — staff-facing display only, distinct from any merchant note.
  note?: string | null;
  // Only populated on the single-order detail fetch (GET /orders/:id).
  product?: { thumbnail: string } | null;
}

export interface PaymentTransaction {
  id: number;
  gateway: string;
  status: string;
  amount: string;
  createdAt: string;
}

export interface Order {
  id: number;
  outletId: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerAddress: string;
  emirate: string;
  area: string | null;
  deliveryDate: string | null;
  deliveryTimeSlot: string | null;
  deliveryNotes: string | null;
  receiverMessage: string | null;
  channel: string | null;
  orderType: string | null;
  status: OrderStatus;
  paymentStatus: "unpaid" | "paid" | "refunded";
  paymentMethod: string | null;
  // Null until POST /orders/:id/collect-cash marks a COD order's cash as
  // collected. cashCollectedByName is only populated when cashCollectedAt
  // is set (joined server-side, see OrdersService.loadOrdersWithRelations).
  cashCollectedAt: string | null;
  cashCollectedBy: number | null;
  cashCollectedByName: string | null;
  // Null only for orders created before this field existed — falls back to
  // deriving it from total - subtotal for display in that case.
  deliveryFee: string | null;
  total: string;
  createdAt: string;
  // Null for admin-created orders — only storefront checkout generates one,
  // for the customer-facing order-tracking page (see PublicOrderLookupController).
  trackingToken: string | null;
  paymentLinkToken: string | null;
  paymentLinkExpiresAt: string | null;
  orderitem: OrderItem[];
  // Only populated on the single-order detail fetch (GET /orders/:id).
  paymenttransaction?: PaymentTransaction[];
  customerOrderCount?: number;
  // Only populated on the single-order detail fetch — null until a merchant
  // logs a courier handoff (see ExternalDelivery, components/OrderDetailModal.tsx).
  externaldelivery?: ExternalDelivery | null;
  // Only populated on the single-order detail fetch — staff-only, never
  // present on anything the storefront/public tracking page reads.
  ordernote?: OrderNote[];
  // Only populated on the single-order detail fetch — null until the
  // customer actually submits the survey (or the order never reached
  // 'delivered' with the toggle on, in which case no row exists at all).
  // Read-only here — responses are customer-submitted only, see
  // PublicSurveyController.
  surveyresponse?: SurveyResponse | null;
}

export interface SurveyResponse {
  id: number;
  rating: number | null;
  comment: string | null;
  respondedAt: string | null;
  createdAt: string;
}

// One entry per real status transition (plus a synthesized "pending" entry
// for order creation, which is never itself a logged transition) — backs
// the order detail modal's timeline. See backend OrdersService.getHistory.
export interface OrderHistoryEntry {
  status: OrderStatus | null;
  timestamp: string;
  actorName: string | null;
}

export interface OrderReturnItem {
  id: number;
  orderItemId: number;
  quantity: number;
}

export interface OrderReturn {
  id: number;
  orderId: number;
  reason: "damaged" | "wrong_item" | "changed_mind" | "other";
  refundAmount: string;
  refundMethod: "provider" | "manual";
  providerRefundReference: string | null;
  restocked: boolean;
  status: string;
  staff: { id: number; name: string };
  orderreturnitem: OrderReturnItem[];
  createdAt: string;
}

export interface OrderNote {
  id: number;
  note: string;
  author: { id: number; name: string };
  createdAt: string;
}

export interface PaginatedOrders {
  data: Order[];
  page: number;
  pageSize: number;
  total: number;
}

export const INVOICE_TYPES = ["INVOICE", "PACKING_SLIP"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export interface Invoice {
  id: number;
  orderId: number;
  shopId: number;
  type: InvoiceType;
  invoiceNumber: string;
  issuedAt: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  notes: string | null;
}

export interface ReportsFilters {
  dateFrom?: string;
  dateTo?: string;
  outletId?: number;
  orderType?: string;
  status?: OrderStatus;
  // Free-text, not a closed enum — see backend ReportsFilterQueryDto:
  // paymentMethod is only ever set by storefront orders today, and channel
  // has no real multi-channel attribution system behind it yet.
  paymentMode?: string;
  channel?: string;
}

export interface GeneralReportSummary {
  totalOrders: number;
  grandTotal: number;
  totalPayments: number;
  totalDeliveryFee: number;
}

export interface GeneralReportOrderRow {
  id: number;
  outletName: string;
  status: OrderStatus;
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  orderType: string | null;
  paymentMethod: string | null;
  total: string;
  channel: string | null;
  createdAt: string;
}

export interface PaginatedGeneralReportOrders {
  data: GeneralReportOrderRow[];
  page: number;
  pageSize: number;
  total: number;
}

// Same non-date filters as ReportsFilters — Monthly Report swaps
// dateFrom/dateTo for a single month, everything else is identical.
export interface MonthlyReportFilters {
  month: string; // "YYYY-MM"
  outletId?: number;
  orderType?: string;
  status?: OrderStatus;
  paymentMode?: string;
  channel?: string;
}

// Manual carrier logging's own 4 statuses, plus Slider's 9 (some names
// overlap, e.g. 'picked_up'/'delivered' — reused, not duplicated). Mirrors
// backend EXTERNAL_DELIVERY_STATUSES exactly.
export type ExternalDeliveryStatus =
  | "pending"
  | "picked_up"
  | "delivered"
  | "failed"
  | "searching_rider"
  | "rider_assigned"
  | "heading_to_pickup"
  | "at_pickup"
  | "in_transit"
  | "return_trip_started"
  | "cancelled";

export interface ExternalDeliveryRow {
  id: number;
  orderId: number;
  outletName: string;
  customerName: string;
  customerPhone: string;
  carrier: string;
  vehicleType: string | null;
  price: string;
  destination: string;
  status: ExternalDeliveryStatus;
  createdAt: string;
  provider: "manual" | "slider";
  trackingUrl: string | null;
  driverName: string | null;
  driverPhone: string | null;
}

export interface PaginatedExternalDeliveries {
  data: ExternalDeliveryRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ExternalDelivery {
  id: number;
  orderId: number;
  carrier: string;
  vehicleType: string | null;
  price: string;
  destination: string;
  status: ExternalDeliveryStatus;
  createdAt: string;
  provider: "manual" | "slider";
  sliderOrderNumber: number | null;
  trackingUrl: string | null;
  driverName: string | null;
  driverPhone: string | null;
  driverLat: string | null;
  driverLng: string | null;
  estimatedDeliveryMinutes: number | null;
}

export interface ProductSalesRow {
  productId: number;
  name: string;
  thumbnail: string;
  currentPrice: string;
  orderCount: number;
  totalQuantity: number;
  totalSalePrice: number;
  deliveryFee: number;
}

export interface PaginatedProductSales {
  data: ProductSalesRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CustomerListItem {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  createdAt: string;
  // Cancelled orders are excluded from both — see backend CustomersService.
  orderCount: number;
  lifetimeValue: number;
  lastOrderDate: string | null;
}

export interface PaginatedCustomers {
  data: CustomerListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CustomerDetail {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  birthday: string | null;
  createdAt: string;
  orderCount: number;
  lifetimeValue: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  // Full history, including cancelled orders (only excluded from the
  // orderCount/lifetimeValue aggregates above, not from this list).
  orders: Order[];
}

export interface Collection {
  id: number;
  name: string;
  slug: string;
  displayOrder: number;
  image: string | null;
  isFeatured: boolean;
  parentCollectionId: number | null;
  description: string | null;
}

export interface CollectionNode extends Collection {
  children: CollectionNode[];
  depth: number;
}

export interface Brand {
  id: number;
  name: string;
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandInput {
  name: string;
  logoUrl?: string | null;
}

// Builds a tree from the flat list the API returns. Ignores a
// parentCollectionId that doesn't resolve to another row in the list (treats
// it as root) rather than dropping the collection — the backend already
// guarantees valid parents, but this keeps the client-side tree from
// silently losing a collection if it ever doesn't.
export function buildCollectionTree(collections: Collection[]): CollectionNode[] {
  const byId = new Map<number, CollectionNode>(
    collections.map((c) => [c.id, { ...c, children: [], depth: 0 }]),
  );
  const roots: CollectionNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentCollectionId !== null ? byId.get(node.parentCollectionId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortAndSetDepth = (nodes: CollectionNode[], depth: number) => {
    nodes.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
    for (const node of nodes) {
      node.depth = depth;
      sortAndSetDepth(node.children, depth + 1);
    }
  };
  sortAndSetDepth(roots, 0);
  return roots;
}

// Flattens a tree back to depth-ordered rows, for rendering an indented list.
export function flattenCollectionTree(nodes: CollectionNode[]): CollectionNode[] {
  return nodes.flatMap((node) => [node, ...flattenCollectionTree(node.children)]);
}

// A collection's full descendant id set, used to keep the parent-reassign
// dropdown cycle-safe on the client (the backend re-checks this too).
export function descendantIds(collectionId: number, collections: Collection[]): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const c of collections) {
    if (c.parentCollectionId !== null) {
      childrenOf.set(c.parentCollectionId, [...(childrenOf.get(c.parentCollectionId) ?? []), c.id]);
    }
  }
  const result = new Set<number>();
  const stack = [...(childrenOf.get(collectionId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return result;
}

export const WEIGHT_UNITS = ["kg", "g", "lb"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

// Cosmetic relabel only — the underlying stored values (Available/
// Unavailable/Archived) are unchanged, see backend PRODUCT_STATUSES. Reusing
// the existing lifecycle values rather than adding a real "Draft" concept
// that doesn't otherwise exist in this schema.
export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  Available: "Active",
  Unavailable: "Draft",
  Archived: "Archived",
};

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

// Product page "Additional information" accordion blocks (storefront-v2
// Phase 3D) — admin-authored, ordered, individually hideable. id is
// client-generated (crypto.randomUUID()), opaque to the backend.
export interface ProductAdditionalInfoBlock {
  id: string;
  title: string;
  body: string;
  visible: boolean;
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

export interface StockByOutlet {
  outletId: number;
  outletName: string;
  stockQuantity: number;
}

// price/compareAtPrice/weight null = not overridden on this variant, falls
// back to the parent product's own field until a merchant edits it — see
// backend ProductsService.updateOptions (new variants inherit the current
// product price at generation time, so this is rarely actually null).
//
// Bill of Materials — one recipe row, ingredient name/unit resolved
// server-side for display (not just the bare id) since the editing UI
// always needs the label anyway. Shared shape for both a product's
// default recipe (Product.ingredients) and a variant's own override list
// (ProductVariant.ingredientOverrides).
export interface ProductIngredientLink {
  id: number;
  ingredientId: number;
  ingredientName: string;
  ingredientUnit: string;
  quantityPerUnit: number;
}

export interface ProductVariant {
  id: number;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compareAtPrice: string | null;
  weight: string | null;
  imageId: number | null;
  imageUrl: string | null;
  order: number;
  optionValue1Id: number | null;
  optionValue2Id: number | null;
  optionValue3Id: number | null;
  label: string | null;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  // Only present when fetched with allOutlets: true (the product edit page)
  // — see getProduct.
  stockByOutlet?: StockByOutlet[];
  // Bill of Materials — this variant's own override rows only; empty means
  // it inherits the product's default recipe wholesale (see
  // Product.ingredients). makeableQuantity/limitedByIngredient are computed
  // from the *effective* recipe (override if set, else the product
  // default) — informational only, doesn't gate cart/checkout, null when
  // no recipe applies or no outlet was resolved for this request.
  ingredientOverrides: ProductIngredientLink[];
  makeableQuantity: number | null;
  limitedByIngredient: string | null;
}

// Shape accepted by POST/PATCH /products — distinct from Product (the API
// response) because collection assignment is written as collectionIds, not the
// expanded Collection[] the response returns. Stock is no longer set here —
// it's per-outlet now (see PATCH /products/stock/bulk-adjust).
export interface ProductInput {
  name: string;
  price: number;
  thumbnail: string;
  sku: string;
  description?: string;
  compareAtPrice?: number;
  barcode?: string;
  chargeTax?: boolean;
  isCheckoutAddon?: boolean;
  // Not the same concept as the standalone GiftCard entity (a purchased,
  // redeemable code — see lib/api.ts's listGiftCards/createGiftCard). This
  // is the catalog-level config for *selling* a gift-card product; buying
  // one issues real GiftCard rows, one per unit, at order time.
  isGiftCard?: boolean;
  giftCardDenominations?: number[];
  // Per-product opt-in for the Variants/Attributes/FAQs sections — see Product.
  showVariants?: boolean;
  showAttributes?: boolean;
  showFaqs?: boolean;
  continueSellingOutOfStock?: boolean;
  vendor?: string;
  productType?: string;
  // Optional brand. `null` clears an existing assignment on update.
  brandId?: number | null;
  physicalProduct?: boolean;
  weight?: number;
  weightUnit?: WeightUnit;
  dimensions?: string;
  trackInventory?: boolean;
  // false (default, omitted): this product auto-mirrors as its own shadow
  // Ingredient — the Inventory card's stock table is what's editable. true:
  // stock/availability is computed from `ingredients` below against real
  // Ingredient stock instead — requires at least one row. See Product's own
  // comment for the toggle-flip semantics.
  usesIngredients?: boolean;
  status?: string;
  collectionIds: number[];
  tags?: string[];
  // Replaces the full gallery when provided — images[0] (by `order`)
  // becomes the canonical thumbnail server-side. Omitted leaves the
  // existing gallery/thumbnail untouched on update.
  images?: { url: string; order?: number }[];
  // Informational, non-purchasable attributes (e.g. Material: Cotton) —
  // distinct from options/variants. Replaces the full list when provided,
  // same convention as images. See ProductAttribute.
  attributes?: { name: string; value: string; order?: number }[];
  // Per-product FAQ list. Same "replaces the full set" convention. See ProductFaq.
  faqs?: { question: string; answer: string; order?: number }[];
  // Storefront SEO — all optional, sensible fallbacks computed server-side
  // (see backend PublicService) when left unset. slug is auto-generated
  // from name on create if omitted; editing it after publish is a deliberate
  // choice (see products.service.ts), not something the form does silently.
  slug?: string;
  metaTitle?: string;
  metaDescription?: string;
  // Bill of Materials — product-level default recipe. Replaces the full
  // set on update when provided (same convention as images/collectionIds);
  // omitted leaves it untouched. See ProductIngredientLink.
  ingredients?: { ingredientId: number; quantityPerUnit: number }[];
  // Product page "Additional information" accordion blocks. Replaces the
  // full set when provided, same convention as attributes/faqs above.
  additionalInfo?: { id: string; title: string; body: string; visible: boolean }[];
}

export interface UpdateVariantInput {
  sku?: string;
  barcode?: string;
  price?: number;
  compareAtPrice?: number;
  weight?: number;
  imageId?: number | null;
  // Bill of Materials — this variant's override recipe, replacing the
  // product default for exactly this variant when provided.
  ingredients?: { ingredientId: number; quantityPerUnit: number }[];
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  price: string;
  compareAtPrice: string | null;
  // Returned by the API (toResponse spreads every scalar product column) but
  // not previously declared here — used by the CSV export/import round trip.
  costPrice: string | null;
  sku: string;
  barcode: string | null;
  status: string;
  trackInventory: boolean;
  continueSellingOutOfStock: boolean;
  // Phase A (Ingredient-Based Stock) — false (default): this product IS its
  // own atomic stock unit, auto-mirrored as an invisible shadow Ingredient
  // (see the Inventory card / OutletQuantityTable, unchanged UI). true:
  // stock/availability is computed from `ingredients` (the recipe) against
  // real Ingredient stock instead — the Inventory card is replaced by the
  // Recipe section, and lowStockThreshold below is always null (no single
  // number across a multi-ingredient recipe; set thresholds per-ingredient
  // on the Ingredients page instead).
  usesIngredients: boolean;
  chargeTax: boolean;
  isCheckoutAddon: boolean;
  isGiftCard: boolean;
  giftCardDenominations: number[];
  // Per-product opt-in gating the Variants/Attributes/FAQs sections of the
  // product form (ProductForm.tsx) — replaces the old shop-wide
  // productVariantsEnabled/productAttributesEnabled/productFaqsEnabled toggles.
  showVariants: boolean;
  showAttributes: boolean;
  showFaqs: boolean;
  vendor: string | null;
  productType: string | null;
  // Optional brand (see the Brands page). `brandId` is the raw column;
  // `brand` is the resolved row, null when unset.
  brandId: number | null;
  brand: { id: number; name: string; logoUrl: string | null } | null;
  physicalProduct: boolean;
  weight: string | null;
  weightUnit: WeightUnit;
  dimensions: string | null;
  slug: string;
  metaTitle: string | null;
  metaDescription: string | null;
  // null when no outlet was resolved for this request (e.g. an admin
  // viewing the catalog without picking a branch) — distinct from 0, which
  // means "this outlet genuinely has none in stock". Always resolved for a
  // branch user (forced to their own outlet server-side).
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  // Only present when fetched with allOutlets: true — see getProduct.
  stockByOutlet?: StockByOutlet[];
  // All-time units sold across non-cancelled orders, shop-wide (not
  // outlet-filtered — unlike stockQuantity, which is per-selected-branch).
  totalSold: number;
  thumbnail: string;
  images: ProductImage[];
  attributes: ProductAttribute[];
  faqs: ProductFaq[];
  additionalInfo: ProductAdditionalInfoBlock[] | null;
  hasVariants: boolean;
  options: ProductOption[];
  variants: ProductVariant[];
  collections: Collection[];
  tags: string[];
  // Bill of Materials — this product's own default recipe (applies
  // directly when hasVariants is false; each variant either overrides it
  // or inherits it, see ProductVariant.ingredientOverrides).
  // makeableQuantity/limitedByIngredient mirror the variant-level fields'
  // own doc comment.
  ingredients: ProductIngredientLink[];
  makeableQuantity: number | null;
  limitedByIngredient: string | null;
}

// Shared by products' and ingredients' CSV import preview/confirm — see
// backend's products-import.ts for the header/type contract this mirrors.
export interface ImportRowResult {
  rowNumber: number;
  kind: "product" | "variant" | "ingredient";
  identifier: string;
  action: "create" | "update" | "reject";
  errors: string[];
}
export interface ImportPreviewResult {
  rows: ImportRowResult[];
}
export interface ImportConfirmResult {
  rows: ImportRowResult[];
  created: number;
  updated: number;
  skipped: number;
}

// "Scan to Stock" — see backend/src/scan for the OCR/parsing pipeline this
// mirrors.
export interface ScanSettings {
  excludeKeywords: string[];
  includeKeywords: string[];
  defaultOutletId: number | null;
  unmatchedBehavior: "ask" | "create";
}

export interface ScanMatchSuggestion {
  id: number;
  type: "product" | "ingredient";
  name: string;
  score: number;
}

export interface ScanPreviewItem {
  rawLine: string;
  name: string;
  quantity: number;
  price: number | null;
  suggestions: ScanMatchSuggestion[];
}

export interface ScanPreviewResult {
  imageUrl: string;
  rawText: string;
  items: ScanPreviewItem[];
  defaultOutletId: number | null;
  unmatchedBehavior: "ask" | "create";
}

export interface ScanCommitNewItem {
  name: string;
  price?: number;
  collectionId?: number;
  unit?: string;
}

export interface ScanCommitItem {
  targetType: "product" | "ingredient";
  matchedId?: number;
  // Required whenever matchedId resolves to a variant-carrying product —
  // scanned stock has to land on one specific variant's shadow ingredient.
  variantId?: number;
  outletId: number;
  quantity: number;
  // OCR-parsed and merchant-confirmed/edited cost — persisted to the
  // target's own cost field (product.costPrice / ingredient.costPerUnit)
  // on commit. Optional — omitted skips price capture for that line.
  price?: number;
  createNew?: ScanCommitNewItem;
}

export interface ScanCommitResult {
  batchId: number;
  created: number;
  updated: number;
  total: number;
}

export type UserRole = "admin" | "branch" | "order_manager" | "viewer";

export const STAFF_ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin (full access)",
  branch: "Branch (one outlet, day-to-day orders/inventory)",
  order_manager: "Order manager (orders only, no pricing/settings)",
  viewer: "Viewer (read-only — reports, orders, customers)",
};

export interface AuthUser {
  id: number;
  shopId: number;
  outletId: number | null;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  createdAt: string;
  // Only populated by GET /auth/users (the outlet management page's user list).
  outlet?: { id: number; name: string } | null;
  shopName?: string;
  // Set only on a token a platform admin minted via "Impersonate" (see
  // PlatformAdminService.impersonate) — drives ImpersonationBanner. Absent
  // (not merely false) on every normal merchant session.
  impersonating?: boolean;
}

// Fixed vocabulary — mirrors backend/src/common/permissions.ts exactly.
// Kept as a plain union (not admin-extensible) so every value here is
// guaranteed to correspond to a real enforcement point.
export const ALL_PERMISSIONS = [
  "orders.view",
  "orders.manage",
  "dashboard.view",
  "products.view",
  "products.manage_stock",
  "ingredients.view",
  "search.use",
  "outlets.view_own",
  "delivery_zones.view",
  "payments.generate_link",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "orders.view": "View orders",
  "orders.manage": "Manage orders (create, update status, cancel, notes)",
  "dashboard.view": "View dashboard",
  "products.view": "View product catalog",
  "products.manage_stock": "Manage stock (adjust, transfer, thresholds)",
  "ingredients.view": "View ingredients",
  "search.use": "Use search",
  "outlets.view_own": "View own outlet details",
  "delivery_zones.view": "View delivery zones",
  "payments.generate_link": "Generate payment links",
};

// A named, admin-defined bundle of permissions that can be assigned to a
// staff member at a specific outlet — layered on top of (never replacing)
// the shop-wide role above. See BranchRoleAssignment.
export interface BranchRole {
  id: number;
  shopId: number;
  name: string;
  permissions: Permission[];
  createdAt: string;
}

// One row per (user, outlet): "at this outlet, this user's effective
// permissions come from this branch role instead of their shop-wide role."
// Restrict-only — can never grant more than the user's shop-wide role
// already permits (enforced server-side by intersection, not by this
// shape or the UI).
export interface BranchRoleAssignment {
  id: number;
  userId: number;
  outletId: number;
  branchRoleId: number;
  user: { id: number; name: string; email: string; role: UserRole };
  outlet: { id: number; name: string };
  branchrole: { id: number; name: string; permissions: Permission[] };
}

export interface Outlet {
  id: number;
  shopId: number;
  name: string;
  nameAr: string | null;
  email: string | null;
  whatsapp: string | null;
  // Top-level enable/disable switch, independent of the hours-derived
  // isOpen status.
  active: boolean;
  emirate: string | null;
  area: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  // Per-branch schedule, independent of Shop's — null means no schedule set
  // yet (server treats that as always-open, not always-closed).
  businessHours: Partial<BusinessHours> | null;
  closedOverride: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryRadiusKm: number | null;
  createdAt: string;
  // Server-computed from businessHours + closedOverride + Shop.timezone —
  // not a stored field, always reflects "now" at read time.
  isOpen: boolean;
}

export type TrademarkFormat = "brand" | "legal";
export type ProductDisplayOrientation = "grid" | "list";
export type ShopLanguage = "en" | "ar";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type BusinessHours = Record<Weekday, { open: string; close: string; closed: boolean }>;

export interface Shop {
  id: number;
  name: string;
  subdomain: string;
  // See ShopDomainConfig below for the full picture — this is just the
  // stored raw column, kept here since GET /shop returns the whole row.
  domainType: "subdomain" | "custom";
  customDomain: string | null;
  // Gates storefront visibility + the platform sitemap — see the "Publish
  // your store" action on this page (Settings > Business Information) and
  // backend PublicService.assertPublished.
  published: boolean;
  currency: string;
  displayName: string | null;
  legalName: string | null;
  trademarkFormat: TrademarkFormat;
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
  autoDeductIngredientStock: boolean;

  // Store Configuration — functional
  businessType: string | null;
  defaultLanguage: ShopLanguage;
  defaultDeliveryFee: string;
  taxDisplayText: string | null;
  productDisplayOrientation: ProductDisplayOrientation;
  productImageZoomEnabled: boolean;
  showCollectionMenu: boolean;
  allowPreOrders: boolean;
  customerConfirmationRequired: boolean;
  externalDeliveryEnabled: boolean;
  asapDeliveryEnabled: boolean;
  deliveryCalendarEnabled: boolean;
  // JSON string, see BusinessHours for the parsed shape.
  businessHours: string | null;
  whatsappFloatingButtonEnabled: boolean;
  birthdayDiscountEnabled: boolean;

  // Which admin product-form experience this shop's merchants get — set on
  // the Account Setup wizard's Review step, editable in Settings > Business
  // Information. Only controls the product form's starting state — see
  // Product.showVariants/showAttributes/showFaqs for the actual per-product
  // opt-in this replaced (the old shop-wide productVariantsEnabled/
  // productAttributesEnabled/productFaqsEnabled toggles).
  productEditorMode: "simple" | "advanced";
  customerSurveyEnabled: boolean;
  disableStoreCart: boolean;
  cartDisabledMode: "buy_now" | "contact_to_order";

  // Store Configuration — placeholder preference (no feature behind it yet)
  dynamicThemeBuilderEnabled: boolean;

  // Online Presence — platform -> URL, only toggled-on platforms have a key.
  // No storefront exists yet to render these into.
  socialLinks: Partial<Record<SocialPlatform, string>> | null;

  // --- Delivery & Pickup: business-level, shared across every outlet ---
  deliveryPaymentCardOnline: boolean;
  deliveryPaymentCashOnDelivery: boolean;
  deliveryPaymentCardOnDelivery: boolean;
  pickupPaymentCardOnline: boolean;
  pickupPaymentCashOnPickup: boolean;
  pickupPaymentCardOnPickup: boolean;
  // Independent of businessHours (store hours) and of each other.
  deliveryHours: Partial<BusinessHours> | null;
  pickupHours: Partial<BusinessHours> | null;
  deliveryTimeSlotGapMinutes: number;
  deliveryPreparationTimeMinutes: number;
  deliveryPreparationPlusDeliveryTimeMinutes: number;
  estimatedDeliveryTimeFrom: number;
  estimatedDeliveryTimeTo: number;
  estimatedDeliveryTimeUnit: "minutes" | "hours";
  pickupTimeSlotGapMinutes: number;
  pickupPreparationTimeMinutes: number;
  pickupPreparationPlusTimeMinutes: number;

  // --- Order Setting ---
  allowSameDayOrders: boolean;
  allowNextDayOrders: boolean;
  taxRate: string;
  taxInclusive: boolean;
}

// Backs the Publish toggle's disabled/tooltip state — see
// backend ShopService.getPublishReadiness, the single source of truth this
// mirrors (also enforced server-side on the PATCH /shop transition itself,
// so this is a UX nicety on top of a real check, not the only guard).
export interface PublishReadiness {
  ready: boolean;
  missing: string[];
}

// Custom-domain DNS-TXT ownership state — see docs/plans/custom-domain-resolver.md
// Phase 2 (backend CustomDomainVerificationService).
export type CustomDomainStatus = "pending" | "verifying" | "verified" | "failed";

// GET/PATCH /shop/domain's response shape — see backend ShopService.getDomainConfig.
export interface ShopDomainConfig {
  type: "subdomain" | "custom";
  subdomain: string;
  customDomain: string | null;
  // null for a subdomain-only shop; otherwise the ownership-verification state.
  status: CustomDomainStatus | null;
  // The TXT record the merchant adds to prove control. Present while a
  // custom-domain claim exists and is not yet verified (so also on "failed").
  verification: { recordName: string; recordValue: string } | null;
  storefrontUrl: string;
}

// POST /shop/domain/verify — runs the DNS-TXT check for the current claim now,
// rather than waiting for the backend's periodic sweep.
export interface VerifyDomainResult {
  status: CustomDomainStatus | null;
  verified: boolean;
  message?: string;
}

export const FONT_CHOICES = ["inter", "poppins", "playfair-display", "roboto"] as const;
export type FontChoice = (typeof FONT_CHOICES)[number];

export interface BannerImage {
  id?: number;
  url: string;
  linkUrl?: string | null;
  order: number;
}

export interface ThemeSettings {
  shopId: number;
  brandColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  faviconUrl: string | null;
  // Rendered in the storefront footer's brand column (see
  // storefront/components/Footer.tsx).
  footerLogoUrl: string | null;
  // Merchant-written blurb for the footer's brand column.
  footerDescription: string | null;
  heroText: string | null;
  fontFamily: FontChoice | null;
  // Announcement-bar messages, rendered above the storefront header.
  notificationText: string[] | null;
  // Off by default even with saved text — see the field's own schema
  // comment (backend/prisma/schema.prisma).
  announcementBarEnabled: boolean;
  // Static (joined with "•") vs. a continuously scrolling marquee.
  announcementBarScrolling: boolean;
  // Real multi-image homepage slideshow — see BannerImage above. Ordered.
  images: BannerImage[];
  // Storefront-facing contact number(s) — distinct from shop.whatsappNumber.
  contactNumbers: string[] | null;
  // Record<ThemeColorKey, hex> — see THEME_COLOR_FIELDS below for the full
  // key list, grouping, and which ones the storefront actually applies.
  colors: Record<string, string> | null;
  // Layout tab — see HOMEPAGE_LAYOUTS below.
  homepageLayout: HomepageLayout;
  // Phase C — what the storefront Home tab renders. Always a real value,
  // same rule as homepageLayout.
  homeTabMode: HomeTabMode;
  // Theme Customizer v2 — see the enum exports below. Always a real value,
  // same rule as homepageLayout.
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
  // Home tab "collections" mode's own grid settings — always a real value,
  // same rule as homepageLayout above.
  collectionsGridColumns: number;
  collectionsGridGap: string;
  collectionsGridShowTitle: boolean;
  collectionsGridImageAspectRatio: string;
  // Null only for a shop that's never saved any theme field yet (no row
  // exists) — used for the Theme library page's "last saved" timestamp.
  updatedAt: string | null;
}

// --- New visual theme builder (Theme library + /theme/[id]/builder) ---
// Deliberately a separate model from ThemeSettings above (a real `theme`
// table, not `themesettings`) — mirrors backend/src/themes/theme-config.
// types.ts by hand, same no-shared-package convention as everything else
// in this file. See that file's own header comment for why Header/Footer
// are separate global-chrome slots, not members of `sections[]`.

export type ThemeSectionType =
  | "announcement_bar"
  | "hero"
  | "featured_collections"
  | "product_grid"
  | "testimonials"
  | "rich_text"
  | "image_text"
  | "newsletter"
  | "brands"
  // Tabbed product carousel — pill toggles swap the product set client-side
  // (theme-builder-expansion Phase 2). Mirrors backend
  // theme-config.types.ts. settings.tabs: { id, label, collectionId }[].
  | "product_tabs"
  // Trust / social-proof strip (Phase 6) — trust_item + rating_badge blocks.
  | "trust_bar";

export const SECTION_TYPES: ThemeSectionType[] = [
  "announcement_bar",
  "hero",
  "featured_collections",
  "product_grid",
  "testimonials",
  "rich_text",
  "image_text",
  "newsletter",
  "brands",
  "product_tabs",
  "trust_bar",
];

export const SECTION_TYPE_LABELS: Record<ThemeSectionType, string> = {
  announcement_bar: "Announcement Bar",
  hero: "Hero",
  featured_collections: "Featured Collections",
  product_grid: "Product Grid",
  testimonials: "Testimonials",
  rich_text: "Rich Text",
  image_text: "Image + Text",
  newsletter: "Newsletter Signup",
  brands: "Brands",
  product_tabs: "Tabbed Products",
  trust_bar: "Trust Bar",
};

export type ScrollAnimation = "none" | "fade-in" | "slide-up" | "slide-left" | "slide-right";
// Phase A (motion foundation) — section-entrance vocabulary extension, additive
// to the legacy ScrollAnimation values. Mirrors backend theme-config.types.ts.
export type SectionEntrance = ScrollAnimation | "scale-in" | "blur-in" | "mask-reveal";
export type SectionVisibility = "desktop" | "mobile" | "both";

// Phase B1 (design-token foundation) — mirrors backend theme-config.types.ts.
export type RadiusPreset = "sharp" | "subtle" | "rounded" | "soft" | "pill";
export interface RadiusSettings {
  preset?: RadiusPreset;
  applyToButtons?: boolean;
}
// Phase B2 — the density scale. Mirrors backend theme-config.types.ts.
export type DensityPreset = "compact" | "cozy" | "comfortable" | "spacious";
export interface DensitySettings {
  preset?: DensityPreset;
}
export type CardStyle =
  | "minimal"
  | "bordered"
  | "shadowed"
  | "elevated"
  | "outlined-hover"
  | "filled"
  | "polaroid"
  | "overlay";
export type ImageAspect = "square" | "portrait" | "landscape" | "tall";
export type TypographyPairing =
  | "modern-sans"
  | "editorial-serif"
  | "warm-humanist"
  | "grotesque"
  | "classic"
  | "bold-display"
  | "handwritten-accent";
export type TypeScale = "compact" | "default" | "spacious" | "dramatic";

// Phase A — the global motion model (docs/plans/theme-templates-and-motion.md
// §2). Mirrors backend theme-config.types.ts's MotionSettings. OPTIONAL and
// inert when `intensity` is unset — the only true no-op (`intensity: 'standard'`
// is a deliberate near-today baseline, not byte-identical). The admin Motion
// panel (MotionSettings.tsx) exposes intensity/speed/easing/scrollMotion/
// hoverMotion/smoothScroll; the rest are typed for a stable shape but have no
// consumer until Phase E/F.
export interface MotionSettings {
  intensity?: "none" | "subtle" | "standard" | "expressive";
  speed?: number;
  easing?: "standard" | "gentle" | "snappy" | "overshoot" | "linear";
  scrollMotion?: boolean;
  hoverMotion?: boolean;
  smoothScroll?: boolean;
  scrollProgressBar?: boolean;
  snapSections?: boolean;
  decorativeParallax?: boolean;
  customCursor?: boolean;
}

export interface SectionMotionSettings {
  entrance?: SectionEntrance;
  stagger?: boolean;
  animateOnce?: boolean;
  trigger?: "scroll" | "load";
}

// REWORK NOTE (Shopify-parity rework): from-scratch replacement of the flat
// PR #31 shape (ThemeElement -> ThemeBlock, now recursive; GlobalThemeSettings
// expanded from 8 flat fields to 18 nested categories). Mirrors
// backend/src/themes/theme-config.types.ts by hand.
export interface ThemeBlock {
  id: string;
  type: string;
  visible: boolean;
  order: number;
  settings: Record<string, unknown>;
  blocks?: ThemeBlock[];
}

export interface SectionSettings {
  typography?: Record<string, unknown>;
  spacing?: { top?: number; bottom?: number; left?: number; right?: number };
  background?: Record<string, unknown>;
  schemeId?: string;
  scrollAnimation?: ScrollAnimation;
  motion?: SectionMotionSettings;
  imageAspect?: ImageAspect;
  visibility?: SectionVisibility;
  [key: string]: unknown;
}

export interface ThemeSection {
  id: string;
  type: ThemeSectionType;
  visible: boolean;
  order: number;
  settings: SectionSettings;
  blocks: ThemeBlock[];
}

// theme-builder-expansion Phase 3 (TBE1) — mirrors backend
// theme-config.types.ts's HeaderRow. An OPTIONAL grouping over the flat
// blocks[]; `header.settings.rows` absent ⇒ storefront renders today's
// single 3-zone grid unchanged. No structural change.
export interface HeaderRow {
  id: string;
  blockIds: string[];
  align?: "left" | "center" | "right" | "between";
  background?: string;
}

// Phase 5 (TBE3) — persistent chrome announcement bar, at
// `header.settings.announcementBar`. Distinct from the homepage-body
// `announcement_bar` section. Mirrors backend theme-config.types.ts.
export interface AnnouncementBarConfig {
  enabled: boolean;
  messages: string[];
  scrolling?: boolean;
  speed?: "fast" | "medium" | "slow";
  dismissible?: boolean;
  background?: string;
  textColor?: string;
}

export interface HeaderFooterConfig {
  settings: Record<string, unknown>;
  blocks: ThemeBlock[];
}

// --- Theme Settings: 18 categories, matching Shopify Horizon's real
// settings_schema.json, with a deliberate Dawn-style multi-scheme color
// system layered in per the confirmed spec. Mirrors backend's
// theme-config.types.ts field-for-field. ---

export interface LogoSettings {
  defaultLogoUrl?: string;
  inverseLogoUrl?: string;
  desktopHeight: number;
  mobileHeight: number;
  faviconUrl?: string;
}

export interface ColorScheme {
  id: string;
  name: string;
  background: string;
  backgroundGradient?: string;
  text: string;
  button: string;
  buttonLabel: string;
  secondaryButtonLabel: string;
  border?: string;
  shadow?: string;
}

export type TextLineHeight = "tight" | "normal" | "loose";
export type TextLetterSpacing = "tight" | "normal" | "wide";
export type TextCase = "default" | "uppercase";
export type FontRole = "heading" | "accent";

export interface ParagraphTextPreset {
  size: number;
  lineHeight: TextLineHeight;
}

export interface HeadingTextPreset {
  font: FontRole;
  size: number;
  lineHeight: TextLineHeight;
  letterSpacing: TextLetterSpacing;
  case: TextCase;
}

export interface TypographySettings {
  bodyFont: string;
  subheadingFont: string;
  headingFont: string;
  accentFont: string;
  paragraph: ParagraphTextPreset;
  h1: HeadingTextPreset;
  h2: HeadingTextPreset;
  h3: HeadingTextPreset;
  h4: HeadingTextPreset;
  h5: HeadingTextPreset;
  h6: HeadingTextPreset;
  // Phase B1 — optional. `pairing` sources the 4 font roles from a named
  // bundle; `scale` overrides `--text-h*-size` from a per-scale table (the
  // per-heading Size fields grey out while it's set); `baseFontSize` drives
  // `--text-paragraph-size`.
  pairing?: TypographyPairing;
  scale?: TypeScale;
  baseFontSize?: 14 | 15 | 16 | 17;
}

export interface PageLayoutSettings {
  width: "narrow" | "normal" | "wide";
}

export interface AnimationSettings {
  pageTransition: boolean;
  productCardTransition: boolean;
  addToCart: boolean;
  cardHoverEffect: "none" | "zoom" | "rise" | "swap";
}

export interface BadgeSettings {
  position: "top_right" | "top_left" | "bottom_right" | "bottom_left";
  cornerRadius: number;
  saleSchemeId: string;
  soldOutSchemeId: string;
  font: "body" | "accent";
  case: TextCase;
}

export interface ButtonStyleSettings {
  borderThickness: number;
  cornerRadius: number;
  font: "body" | "accent";
  case: TextCase;
}

export interface ButtonSettings {
  primary: ButtonStyleSettings;
  secondary: ButtonStyleSettings;
  pillCornerRadius: number;
}

export interface CartSettings {
  allowNote: boolean;
  allowDiscounts: boolean;
  installments: boolean;
  acceleratedCheckout: boolean;
  emptyCartLink?: string;
  mediaBorderStyle: "none" | "solid";
  mediaCornerRadius: number;
}

export interface DrawerSettings {
  schemeId: string;
  bordersStyle: "none" | "solid";
  dropShadow: boolean;
}

export interface IconSettings {
  stroke: "thin" | "default" | "heavy";
}

export interface InputFieldSettings {
  borderThickness: number;
  cornerRadius: number;
  textPreset: string;
}

export interface PopoverSettings {
  schemeId: string;
  cornerRadius: number;
  borders: "none" | "solid";
  dropShadow: boolean;
}

export interface PriceSettings {
  currencyCode: {
    productPages: boolean;
    productCards: boolean;
    cartItems: boolean;
    cartTotal: boolean;
  };
  // Phase B1 — see backend theme-config.types.ts.
  salePriceColor?: string;
  salePriceStyle?: "color" | "strikethrough-only";
}

export interface ProductCardSettings {
  quickAdd: boolean;
  mobileQuickAdd: boolean;
  quickAddBackground: string;
  quickAddText: string;
  showCarousel: boolean;
  productNameFontSize: number;
  productNameFontWeight: "regular" | "medium" | "bold";
  productNameColor: string;
  showProductDescriptions: boolean;
  // Optional (older published themes lack it) — gates the whole storefront
  // wishlist feature. Toggled from ProductCardsSettings.tsx. Mirrored in
  // backend theme-config.types.ts + storefront theme-config-types.ts.
  showWishlist?: boolean;
  // Phase B1 — all optional. Unset ⇒ minimal / aspect-square / left /
  // comfortable.
  cardStyle?: CardStyle;
  imageAspect?: ImageAspect;
  textAlign?: "left" | "center";
  density?: "comfortable" | "compact";
}

export interface CollectionPageSettings {
  textAboveProducts: string;
  textBelowProducts: string;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  loadMoreStyle: "infinite" | "pagination";
  // Bug 6 fix: merchant-only "products per row" default, replacing what
  // used to be a customer-facing column selector on the live storefront.
  columns: 2 | 3 | 4 | 5 | 6;
  // Undefined = automatic (desktopColumns <= 2 ? 1 : 2).
  mobileColumns?: 1 | 2;
}

// Governs the PDP's stock/delivery/pickup status line — see backend
// theme-config.types.ts's matching interface for the full reasoning.
export interface ProductPageSettings {
  showStockIndicator: boolean;
  showDeliveryIndicator: boolean;
  showPickupIndicator: boolean;
  showBnplWidget: boolean;
  inStockColor: string;
  lowStockColor: string;
  outOfStockColor: string;
  fulfillmentTextColor: string;
}

export interface SearchSettings {
  emptyStateCollectionId?: number;
  productCornerRadius: number;
  cardCornerRadius: number;
  titleCase: TextCase;
}

export interface SwatchSettings {
  variantImages: boolean;
  width: number;
  height: number;
  cornerRadius: number;
  borders: "none" | "solid";
  borderThickness: number;
  borderOpacity: number;
}

export interface VariantPickerSettings {
  borderThickness: number;
  cornerRadius: number;
  width: "fit" | "fill";
}

export interface CustomCssSettings {
  css: string;
}

// Phase 6 (TBE7) — persistent overlay elements. Mirrors backend
// theme-config.types.ts. Nested under globalSettings (no top-level
// allow-list change); OPTIONAL — older published themes lack the key.
export type FloatingPosition = "bottom_right" | "bottom_left";
export interface FloatingCustomButton {
  id: string;
  label: string;
  url: string;
  iconUrl?: string;
  position?: FloatingPosition;
}
export interface FloatingElementsSettings {
  whatsapp: { enabled: boolean; position?: FloatingPosition };
  customButtons: FloatingCustomButton[];
}

export interface GlobalThemeSettings {
  logo: LogoSettings;
  colorSchemes: ColorScheme[];
  typography: TypographySettings;
  pageLayout: PageLayoutSettings;
  radius?: RadiusSettings;
  density?: DensitySettings;
  animations: AnimationSettings;
  motion?: MotionSettings;
  badges: BadgeSettings;
  buttons: ButtonSettings;
  cart: CartSettings;
  drawers: DrawerSettings;
  icons: IconSettings;
  inputFields: InputFieldSettings;
  popovers: PopoverSettings;
  prices: PriceSettings;
  productCards: ProductCardSettings;
  search: SearchSettings;
  swatches: SwatchSettings;
  variantPickers: VariantPickerSettings;
  customCss: CustomCssSettings;
  collectionPage: CollectionPageSettings;
  productPage: ProductPageSettings;
  floatingElements?: FloatingElementsSettings;
}

export interface ThemeConfig {
  globalSettings: GlobalThemeSettings;
  header: HeaderFooterConfig;
  footer: HeaderFooterConfig;
  sections: ThemeSection[];
}

// Mirrors backend/src/themes/constants.ts's BlockContainer/BLOCK_TYPES/
// BLOCK_TYPE_LABELS/CHILD_BLOCK_TYPES/MAX_BLOCK_DEPTH by hand — the "+ Add
// block" modal and the tree's depth guard both read these.
export type BlockContainer = ThemeSectionType | "header" | "footer";

export const BLOCK_TYPE_LABELS: Record<string, string> = {
  logo: "Logo",
  nav_menu: "Menu",
  search_icon: "Search",
  cart_icon: "Cart",
  account_icon: "Account",
  header_text: "Header Text",
  contact_bar_item: "Contact item",
  social_row: "Social links",
  language_switcher: "Language (coming soon)",
  trust_item: "Trust item",
  rating_badge: "Rating badge",
  footer_column: "Column",
  footer_social: "Social Links",
  footer_copyright: "Copyright",
  announcement: "Announcement",
  heading: "Heading",
  subheading: "Subheading",
  cta: "CTA Button",
  collection_header: "Header",
  collection_title: "Collection title",
  view_all_button: "View all button",
  product_card: "Product card",
  product_media: "Media",
  product_title: "Product title",
  product_price: "Price",
  testimonial: "Testimonial",
  text: "Text",
  image: "Image",
  email_form: "Email form",
};

export const BLOCK_TYPES: Record<BlockContainer, string[]> = {
  header: [
    "logo",
    "nav_menu",
    "search_icon",
    "cart_icon",
    "account_icon",
    "header_text",
    "image",
    "contact_bar_item",
    "social_row",
    "language_switcher",
  ],
  footer: ["footer_column", "footer_social", "footer_copyright", "image"],
  announcement_bar: ["announcement"],
  hero: ["heading", "subheading", "cta", "image"],
  featured_collections: ["collection_header", "product_card"],
  product_grid: ["product_card"],
  testimonials: ["heading", "testimonial"],
  rich_text: ["text", "image"],
  image_text: ["image", "text"],
  newsletter: ["heading", "text", "email_form"],
  brands: [],
  product_tabs: [],
  trust_bar: ["heading", "trust_item", "rating_badge"],
};

export const CHILD_BLOCK_TYPES: Record<string, string[]> = {
  collection_header: ["collection_title", "view_all_button"],
  product_card: ["product_media", "product_title", "product_price"],
};

export const MAX_BLOCK_DEPTH = 4;

// parentType null looks up the container's own top-level catalog
// (BLOCK_TYPES); a real block type looks up what can nest inside it
// (CHILD_BLOCK_TYPES) — a type absent from CHILD_BLOCK_TYPES is a leaf.
export function allowedBlockTypesFor(container: BlockContainer, parentType: string | null): string[] {
  if (parentType) return CHILD_BLOCK_TYPES[parentType] ?? [];
  return BLOCK_TYPES[container] ?? [];
}

// GET /themes list item — deliberately lighter than the full Theme shape
// below (no config body), matching every other list-vs-detail split in this
// codebase.
export interface ThemeListItem {
  id: number;
  name: string;
  isPublished: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

export interface Theme extends ThemeListItem {
  config: ThemeConfig;
}

// Mirrors backend/src/theme/constants.ts's HOMEPAGE_LAYOUTS by hand. 'custom'
// exists in the type (forward-compatible with a future full drag-and-drop
// builder slotting in as a fourth option) but is deliberately absent from
// SELECTABLE_HOMEPAGE_LAYOUTS/HOMEPAGE_LAYOUT_OPTIONS below — nothing in the
// admin UI can pick it yet, matching the backend DTO's validator.
export const HOMEPAGE_LAYOUTS = ["classic", "slideshow", "featured_grid", "grid_first", "custom"] as const;
export type HomepageLayout = (typeof HOMEPAGE_LAYOUTS)[number];

// Phase C — mirrors backend/src/theme/constants.ts's HOME_TAB_MODES.
export const HOME_TAB_MODES = ["templates", "collections"] as const;
export type HomeTabMode = (typeof HOME_TAB_MODES)[number];
export const HOME_TAB_MODE_OPTIONS: { value: HomeTabMode; label: string }[] = [
  { value: "templates", label: "Templates" },
  { value: "collections", label: "Collections grid" },
];

export interface HomepageLayoutOption {
  key: Exclude<HomepageLayout, "custom">;
  label: string;
  description: string;
}

export const HOMEPAGE_LAYOUT_OPTIONS: HomepageLayoutOption[] = [
  {
    key: "classic",
    label: "Classic",
    description: "A single hero banner above your product grid — simple and familiar.",
  },
  {
    key: "slideshow",
    label: "Slideshow",
    description: "A rotating hero that cycles through your banner and top products.",
  },
  {
    key: "featured_grid",
    label: "Featured Grid",
    description: "Collection tiles up front, so shoppers can jump straight to what they want.",
  },
  {
    key: "grid_first",
    label: "Grid First",
    description: "Skip the hero — products start right below the header.",
  },
];

// Theme Customizer v2 — mirrors backend/src/theme/constants.ts by hand (same
// tradeoff as HOMEPAGE_LAYOUTS above). Each *_OPTIONS array feeds the preset
// picker cards on the Layout tab; see app/theme/edit/advanced/page.tsx.
export const TOP_BAR_LAYOUTS = ["logo_left", "logo_center", "minimal"] as const;
export type TopBarLayout = (typeof TOP_BAR_LAYOUTS)[number];
export const TOP_BAR_LAYOUT_OPTIONS: { key: TopBarLayout; label: string; description: string }[] = [
  { key: "logo_left", label: "Logo left", description: "Logo on the left, icons on the right — the current default." },
  { key: "logo_center", label: "Logo centered", description: "Logo centered, icons split to either side." },
  { key: "minimal", label: "Minimal", description: "Logo and cart only — everything else tucked into a menu." },
];

export const ICON_STYLES = ["outline", "solid"] as const;
export type IconStyle = (typeof ICON_STYLES)[number];
export const ICON_STYLE_OPTIONS: { key: IconStyle; label: string; description: string }[] = [
  { key: "outline", label: "Outline", description: "Light, stroke-based icons — the current default." },
  { key: "solid", label: "Solid", description: "Bolder, filled icons." },
];

export const BUTTON_RADII = ["sharp", "rounded", "pill"] as const;
export type ButtonRadius = (typeof BUTTON_RADII)[number];
export const BUTTON_RADIUS_OPTIONS: { key: ButtonRadius; label: string }[] = [
  { key: "sharp", label: "Sharp" },
  { key: "rounded", label: "Rounded" },
  { key: "pill", label: "Pill" },
];

export const BUTTON_FILLS = ["solid", "outline"] as const;
export type ButtonFill = (typeof BUTTON_FILLS)[number];
export const BUTTON_FILL_OPTIONS: { key: ButtonFill; label: string }[] = [
  { key: "solid", label: "Solid" },
  { key: "outline", label: "Outline" },
];

export const PDP_LAYOUTS = ["gallery_left", "gallery_top"] as const;
export type PdpLayout = (typeof PDP_LAYOUTS)[number];
export const PDP_LAYOUT_OPTIONS: { key: PdpLayout; label: string; description: string }[] = [
  { key: "gallery_left", label: "Gallery left", description: "Images on the left, details on the right — the current default." },
  { key: "gallery_top", label: "Gallery top", description: "Full-width image gallery, details below." },
];

export const CART_LAYOUTS = ["full_page", "drawer"] as const;
export type CartLayout = (typeof CART_LAYOUTS)[number];
export const CART_LAYOUT_OPTIONS: { key: CartLayout; label: string; description: string }[] = [
  { key: "full_page", label: "Full page", description: "The cart icon opens a dedicated page — the current default." },
  { key: "drawer", label: "Slide-out drawer", description: "The cart icon opens a panel over the current page instead." },
];

export const CHECKOUT_LAYOUTS = ["single_page", "step_by_step"] as const;
export type CheckoutLayout = (typeof CHECKOUT_LAYOUTS)[number];
export const CHECKOUT_LAYOUT_OPTIONS: { key: CheckoutLayout; label: string; description: string }[] = [
  { key: "single_page", label: "Single page", description: "Every field on one page — the current default." },
  { key: "step_by_step", label: "Step by step", description: "Contact, delivery, and payment as separate steps." },
];

export const FOOTER_LAYOUTS = ["columns", "centered"] as const;
export type FooterLayout = (typeof FOOTER_LAYOUTS)[number];
export const FOOTER_LAYOUT_OPTIONS: { key: FooterLayout; label: string; description: string }[] = [
  { key: "columns", label: "Columns", description: "Brand, links, and contact side by side — the current default." },
  { key: "centered", label: "Centered", description: "A single simplified column, centered — a lighter alternative." },
];

// Shared by both headerDensity and footerDensity — same three sizes, two
// independent columns (see schema.prisma's comment on themesettings).
export const DENSITY_OPTIONS = ["compact", "regular", "spacious"] as const;
export type Density = (typeof DENSITY_OPTIONS)[number];
export const HEADER_DENSITY_OPTIONS: { key: Density; label: string; description: string }[] = [
  { key: "compact", label: "Compact", description: "A slimmer header, less vertical padding." },
  { key: "regular", label: "Regular", description: "The current default." },
  { key: "spacious", label: "Spacious", description: "A taller header, more breathing room." },
];
export const FOOTER_DENSITY_OPTIONS: { key: Density; label: string; description: string }[] = [
  { key: "compact", label: "Compact", description: "A slimmer footer, less vertical padding." },
  { key: "regular", label: "Regular", description: "The current default." },
  { key: "spacious", label: "Spacious", description: "A taller footer, more breathing room." },
];

// Mirrors backend/src/theme/constants.ts's THEME_COLOR_GROUPS/THEME_COLOR_FIELDS
// by hand (no shared package between admin/backend/storefront — same
// tradeoff as FONT_CHOICES/color-contrast.ts elsewhere in this codebase).
// `wired` drives the "not yet visible on your storefront" hint shown next to
// unwired fields on the Appearance Color tab — see app/theme/appearance-color/page.tsx.
export const THEME_COLOR_GROUPS = [
  { key: "ui_button_colors", label: "UI/Button Colors" },
  { key: "background_header_colors", label: "Background/Header Colors" },
  { key: "product_collection_colors", label: "Product/Collection Colors" },
] as const;
export type ThemeColorGroupKey = (typeof THEME_COLOR_GROUPS)[number]["key"];

export interface ThemeColorFieldDef {
  key: string;
  label: string;
  group: ThemeColorGroupKey;
  wired: boolean;
}

// Sensible fallbacks (Requital teal-derived / matches the storefront's
// current unstyled appearance) so an unset color never renders as broken —
// same rule as brandColor/secondaryColor. Only used to pre-fill the color
// picker's displayed value here in admin; the storefront applies its own
// identical copy of these defaults (see storefront/lib/theme-colors.ts).
export const THEME_COLOR_DEFAULTS: Record<string, string> = {
  // Storefront now defaults this to the CSS keyword `currentColor` (hover
  // tint derived from the element's own text color, not a fixed hue — see
  // storefront/lib/theme-colors.ts). A <input type="color"> can't display
  // `currentColor`, so this hex stays only as the picker's starting swatch;
  // it takes effect on the storefront only if the merchant actually saves it.
  mouseOverColor: "#057a7a",
  mouseSelectionColor: "#b2e0e0",
  buttonColor: "#069494",
  addToCartTextColor: "#ffffff",
  addToCartButtonColor: "#069494",
  strokeColor: "#e4e4e7",
  homepageInfoBackgroundColor: "#ffffff",
  pageBackgroundColor: "#ffffff",
  headerBackgroundColor: "#ffffff",
  headerTextColor: "#171717",
  footerBackgroundColor: "#18181b",
  footerTextColor: "#f4f4f5",
  featuredBackgroundColor: "#f4f4f5",
  productNameColor: "#171717",
  priceMainColor: "#71717a",
  priceSecondaryColor: "#a1a1aa",
  collectionSliderArrowColor: "#069494",
  collectionSliderArrowActiveColor: "#057a7a",
  featuredProductTextColor: "#171717",
  brandBackgroundColor: "#f4f4f5",
  homeSliderBackgroundColor: "#f4f4f5",
  homeSliderColor: "#171717",
};

export const THEME_COLOR_FIELDS: ThemeColorFieldDef[] = [
  { key: "mouseOverColor", label: "Mouse Over Color", group: "ui_button_colors", wired: true },
  { key: "mouseSelectionColor", label: "Mouse Selection Color", group: "ui_button_colors", wired: true },
  { key: "buttonColor", label: "Button Color", group: "ui_button_colors", wired: true },
  { key: "addToCartTextColor", label: "Add to Cart Text", group: "ui_button_colors", wired: true },
  { key: "addToCartButtonColor", label: "Add to Cart Button Color", group: "ui_button_colors", wired: true },
  { key: "strokeColor", label: "Stroke Color", group: "ui_button_colors", wired: true },
  { key: "homepageInfoBackgroundColor", label: "Homepage Info Background Color", group: "background_header_colors", wired: true },
  { key: "pageBackgroundColor", label: "Page Background Color", group: "background_header_colors", wired: true },
  { key: "headerBackgroundColor", label: "Header Background Color", group: "background_header_colors", wired: true },
  { key: "headerTextColor", label: "Header Text Color", group: "background_header_colors", wired: true },
  { key: "footerBackgroundColor", label: "Footer Background Color", group: "background_header_colors", wired: true },
  { key: "footerTextColor", label: "Footer Text Color", group: "background_header_colors", wired: true },
  { key: "featuredBackgroundColor", label: "Featured Background Color", group: "background_header_colors", wired: true },
  { key: "productNameColor", label: "Product Name Color", group: "product_collection_colors", wired: true },
  { key: "priceMainColor", label: "Price Main Color", group: "product_collection_colors", wired: true },
  { key: "priceSecondaryColor", label: "Price Secondary Color", group: "product_collection_colors", wired: true },
  { key: "collectionSliderArrowColor", label: "Collection Slider Arrow Color (mobile view)", group: "product_collection_colors", wired: true },
  { key: "collectionSliderArrowActiveColor", label: "Collection Slider Arrow Active Color (mobile view)", group: "product_collection_colors", wired: true },
  { key: "featuredProductTextColor", label: "Featured Product Text Color", group: "product_collection_colors", wired: true },
  { key: "brandBackgroundColor", label: "Brand Background Color", group: "product_collection_colors", wired: true },
  { key: "homeSliderBackgroundColor", label: "Home Slider Background Color", group: "product_collection_colors", wired: true },
  { key: "homeSliderColor", label: "Home Slider Color", group: "product_collection_colors", wired: true },
];

export interface SeoSettings {
  shopId: number;
  metaTitle: string | null;
  metaDescription: string | null;
  // Falls back to Theme's banner/logo on the storefront when unset — see
  // backend PublicService.getShop.
  ogImage: string | null;
  keywords: string | null;
}

export interface DeliveryZone {
  id: number;
  outletId: number;
  name: string;
  fee: string;
  minOrderAmount: string;
  isActive: boolean;
  lat: string | null;
  lng: string | null;
  radiusKm: string | null;
  createdAt: string;
}

export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "telegram",
  "snapchat",
  "x",
  "threads",
  "youtube",
  // Added so Bio Links' SOCIAL_ICON option for Pinterest has somewhere to
  // actually be configured — mirrors backend/src/shop/constants.ts
  // SOCIAL_PLATFORM_DOMAINS, which already includes it.
  "pinterest",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

interface PeriodMetric {
  current: number;
  previous: number;
  changePct: number | null;
}

export interface DashboardSummary {
  period: { from: string; to: string };
  revenue: PeriodMetric;
  avgBasketValue: PeriodMetric;
  totalOrders: number;
  customerGrowth: PeriodMetric;
  ordersByStage: {
    placed: number;
    accepted: number;
    preparing: number;
    shipped: number;
    delivered: number;
  };
  // One entry when a specific outlet is in view (100%); the full per-branch
  // breakdown when an admin is viewing all outlets aggregated.
  outlets: { outletId: number; name: string; orderCount: number; percentage: number }[];
  channels: { channel: string; count: number; percentage: number }[];
}

export interface DailyRevenuePoint {
  date: string;
  revenue: number;
}

export interface TopProduct {
  productId: number;
  name: string;
  thumbnail: string | null;
  revenue: number;
  unitsSold: number;
}

// Mirrors backend/src/payments/provider-credentials.ts by hand (no shared
// package between admin and backend — same tradeoff as every other mirrored
// constant in this codebase, e.g. theme/constants.ts). Cash on Delivery
// ('cod') isn't in this list — it has no credentials and isn't part of
// PaymentProviderRegistry, just a visibility toggle on existing shop
// booleans — but it IS one of the rows PaymentSettingsResponse returns.
export const PAYMENT_GATEWAY_PROVIDERS = ["nomod", "stripe", "paypal", "tabby", "tamara"] as const;
export type PaymentGatewayProvider = (typeof PAYMENT_GATEWAY_PROVIDERS)[number];

// "Card processing" — mutually exclusive, pick one (radio, not independent
// toggles) — enforced server-side in PaymentSettingsService; this list only
// drives which UI section a provider's card renders in.
export const CARD_PROCESSOR_PROVIDERS: PaymentGatewayProvider[] = ["nomod", "stripe"];

// Providers with real backend stub plumbing (PaymentProviderRegistry entry,
// platform-level env fallback credentials) but no real checkout-session API
// call implemented yet — createCheckoutSession unconditionally throws. Never
// let a merchant select one without knowing that, since it means every real
// checkout fails at runtime with zero warning in settings. Rendered
// disabled/"Coming soon" in the Payment Providers card-processor list
// (admin/app/integrations/payments/page.tsx) rather than hidden
// entirely, so a merchant can see it's planned. Loosely typed (not
// PaymentGatewayProvider[]) since a display-only entry like "telr"/"paytabs"
// isn't a real, submittable card-processor option and shouldn't need
// PROVIDER_CREDENTIAL_FIELDS/PAYMENT_PROVIDER_LABELS entries just to render
// a disabled row.
// telr/paytabs added 2026-08-22 — two of the most common UAE payment
// gateways, with real backend stub providers and platform-level env
// fallback credentials already documented in CLAUDE.md, but previously
// completely invisible in this admin UI (not even a "coming soon" row) —
// a real competitive gap for a UAE-market product. Deliberately NOT added
// to PAYMENT_GATEWAY_PROVIDERS/CARD_PROCESSOR_PROVIDERS/
// PROVIDER_CREDENTIAL_FIELDS — they're display-only, never a real
// selectable/submittable option, so nothing that maps over those needs new
// entries for them.
export const COMING_SOON_PAYMENT_PROVIDERS: string[] = ["nomod", "telr", "paytabs"];

export interface CredentialFieldDef {
  key: string;
  label: string;
}

export const PROVIDER_CREDENTIAL_FIELDS: Record<PaymentGatewayProvider, CredentialFieldDef[]> = {
  nomod: [
    { key: "apiKey", label: "API Key" },
    { key: "secretKey", label: "Secret Key" },
  ],
  stripe: [
    { key: "secretKey", label: "Secret Key" },
    { key: "webhookSecret", label: "Webhook Secret" },
  ],
  paypal: [
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client Secret" },
    { key: "webhookId", label: "Webhook ID" },
  ],
  tabby: [
    { key: "publicKey", label: "Public Key" },
    { key: "secretKey", label: "Secret Key" },
    { key: "webhookSecret", label: "Webhook Secret" },
  ],
  tamara: [
    // Not used by the real checkout integration (that only needs apiToken,
    // server-side) — feeds the PDP's Tamara installment-promo widget only.
    { key: "publicKey", label: "Public Key" },
    { key: "apiUrl", label: "API URL" },
    { key: "apiToken", label: "API Token" },
    { key: "notificationToken", label: "Notification Token" },
  ],
};

export const PAYMENT_PROVIDER_LABELS: Record<string, string> = {
  nomod: "Nomod",
  stripe: "Stripe",
  paypal: "PayPal",
  tabby: "Tabby",
  tamara: "Tamara",
  cod: "Cash on Delivery",
  telr: "Telr",
  paytabs: "PayTabs",
};

// Response shape for both GET /payment-settings and PATCH /payment-settings/:provider.
export interface PaymentProviderSettings {
  provider: string;
  enabled: boolean;
  isCardProcessor: boolean;
  hasCredentials: boolean;
  // Masked, e.g. { secretKey: "••••1234" } — never the real value. See
  // PaymentSettingsService.maskCredentials on the backend.
  maskedCredentials: Record<string, string> | null;
}

// --- WhatsApp Cloud API credentials — mirrors backend/src/whatsapp/whatsapp-credential-fields.ts by hand. ---

export const WHATSAPP_CREDENTIAL_FIELDS: CredentialFieldDef[] = [
  { key: "phoneNumberId", label: "Phone Number ID" },
  { key: "accessToken", label: "Access Token" },
];

// Response shape for GET/PATCH /whatsapp-settings.
export interface WhatsAppSettings {
  hasCredentials: boolean;
  maskedCredentials: Record<string, string> | null;
}

// --- Slider delivery — mirrors backend/src/delivery-providers/. ---

export const SLIDER_VEHICLE_TYPES = ["bike", "car", "any"] as const;
export type SliderVehicleType = (typeof SLIDER_VEHICLE_TYPES)[number];

// Slider is a platform partnership, not bring-your-own-keys — Requital
// holds the one API key (env vars, never touched by this frontend); a shop
// only ever sees whether it's enabled and its own Slider account status.
// See backend SliderSettingsService's own doc comment for the corrected
// credential model (fixed 2026-08-26 from a wrong first version that stored
// a per-shop encrypted key).
export type SliderStatus = "connected" | "awaiting_setup" | "not_enabled";

export interface SliderSettings {
  enabled: boolean;
  accountId: string | null;
  status: SliderStatus;
}

// --- Webhook diagnostics — mirrors backend/src/webhook-log/. Read-only,
// no URL/token exposed here (those are platform-level, see CLAUDE.md). ---
export interface WebhookEvent {
  id: number;
  shopId: number;
  source: string;
  eventType: string;
  result: "success" | "duplicate" | "rejected" | "failed";
  createdAt: string;
}

export interface SliderQuoteVehicle {
  vehicleType: string;
  deliveryFee: number;
  isAvailable: boolean;
  unavailableReason: string | null;
}

export interface SliderQuote {
  distanceKm: number;
  durationMinutes: number;
  vehicles: SliderQuoteVehicle[];
}

// --- Affiliate (referral marketing) — mirrors backend/src/affiliate/constants.ts by hand. ---

export const AFFILIATE_STATUSES = ["active", "inactive", "blocked"] as const;
export type AffiliateStatus = (typeof AFFILIATE_STATUSES)[number];

export const AFFILIATE_CODE_STATUSES = ["approved", "pending", "blocked"] as const;
export type AffiliateCodeStatus = (typeof AFFILIATE_CODE_STATUSES)[number];

export const COMMISSION_TYPES = ["percentage", "fixed"] as const;
export type CommissionType = (typeof COMMISSION_TYPES)[number];

// Only ever moves out of 'pending' — see AffiliateService.syncOrderStatus.
export const AFFILIATE_ORDER_STATUSES = ["pending", "approved", "blocked"] as const;
export type AffiliateOrderStatus = (typeof AFFILIATE_ORDER_STATUSES)[number];

export interface AffiliateSummary {
  totalCode: number;
  totalAffiliate: number;
  activeAffiliate: number;
  pendingOrders: number;
  approvedOrderRevenue: number;
  codeStatus: { approved: number; pending: number; blocked: number };
}

export interface AffiliateListItem {
  id: number;
  name: string;
  mobile: string;
  status: AffiliateStatus;
  createdAt: string;
  codesCount: number;
  ordersCount: number;
}

export interface AffiliateCodeListItem {
  id: number;
  code: string;
  affiliateId: number;
  affiliateName: string;
  promotionFor: string;
  url: string;
  status: AffiliateCodeStatus;
  commissionType: CommissionType;
  commissionValue: number;
  validFrom: string | null;
  validUntil: string | null;
  ordersCount: number;
  createdAt: string;
}

export interface AffiliateOrderListItem {
  id: number;
  orderId: number;
  customerName: string;
  orderTotal: number;
  code: string;
  affiliateName: string;
  commissionAmount: number;
  status: AffiliateOrderStatus;
  createdAt: string;
}

export interface PaginatedAffiliates {
  data: AffiliateListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PaginatedAffiliateCodes {
  data: AffiliateCodeListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PaginatedAffiliateOrders {
  data: AffiliateOrderListItem[];
  page: number;
  pageSize: number;
  total: number;
}

// --- Bio Links — mirrors backend/src/bio-links/bio-link-constants.ts by hand. ---

export const BIO_LINK_TYPES = ["EXTERNAL_URL", "PRODUCT", "COLLECTION", "TEMPLATE", "SOCIAL_ICON"] as const;
export type BioLinkType = (typeof BIO_LINK_TYPES)[number];

export const BIO_LINK_TYPE_LABELS: Record<BioLinkType, string> = {
  EXTERNAL_URL: "External URL",
  PRODUCT: "Product",
  COLLECTION: "Collection",
  TEMPLATE: "Template",
  SOCIAL_ICON: "Social Icon",
};

// Deliberately a different set than SOCIAL_PLATFORMS (Online Presence) —
// see the backend constants file for why.
export const BIO_LINK_SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "x",
  "tiktok",
  "whatsapp",
  "youtube",
  "snapchat",
  "pinterest",
] as const;
export type BioLinkSocialPlatform = (typeof BIO_LINK_SOCIAL_PLATFORMS)[number];

export const BIO_LINK_SOCIAL_PLATFORM_LABELS: Record<BioLinkSocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X (Twitter)",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  youtube: "YouTube",
  snapchat: "Snapchat",
  pinterest: "Pinterest",
};

export interface BioLink {
  id: number;
  type: BioLinkType;
  label: string;
  url: string | null;
  productId: number | null;
  productName: string | null;
  collectionId: number | null;
  collectionName: string | null;
  templateId: number | null;
  templateTitle: string | null;
  socialPlatform: BioLinkSocialPlatform | null;
  order: number;
  active: boolean;
  clickCount: number;
  createdAt: string;
}

// Raw overrides only — no fallback-to-Theme resolution here, same as the
// backend response (see BioLinksService.getPageConfig). The admin form just
// edits these fields directly; it doesn't need to know what they'd fall
// back to (that's a storefront-only concern).
export interface BioPageConfig {
  logoUrl: string | null;
  backgroundUrl: string | null;
  description: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

// --- Discounts / Promo Codes — mirrors backend/src/discounts/discount-constants.ts by hand. ---

export const DISCOUNT_TYPES = ["PERCENTAGE", "FIXED_AMOUNT", "FREE_SHIPPING"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];
export const DISCOUNT_TYPE_LABELS: Record<DiscountType, string> = {
  PERCENTAGE: "Percentage",
  FIXED_AMOUNT: "Fixed amount",
  FREE_SHIPPING: "Free shipping",
};

export const DISCOUNT_APPLIES_TO = ["ALL_PRODUCTS", "SPECIFIC_PRODUCTS", "SPECIFIC_COLLECTIONS"] as const;
export type DiscountAppliesTo = (typeof DISCOUNT_APPLIES_TO)[number];
export const DISCOUNT_APPLIES_TO_LABELS: Record<DiscountAppliesTo, string> = {
  ALL_PRODUCTS: "All products",
  SPECIFIC_PRODUCTS: "Specific products",
  SPECIFIC_COLLECTIONS: "Specific collections",
};

// Whether the discount requires the customer to type a code, or applies
// automatically to every matching cart with no code entry.
export const DISCOUNT_KINDS = ["code", "auto"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export interface Discount {
  id: number;
  code: string | null;
  discountType: DiscountKind;
  type: DiscountType;
  value: string | null;
  minPurchaseAmount: string | null;
  appliesTo: DiscountAppliesTo;
  products: { id: number; name: string }[];
  collections: { id: number; name: string }[];
  usageLimit: number | null;
  usageLimitPerCustomer: number | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  timesUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface DiscountInput {
  code?: string;
  discountType?: DiscountKind;
  type: DiscountType;
  value?: number;
  minPurchaseAmount?: number;
  appliesTo?: DiscountAppliesTo;
  productIds?: number[];
  collectionIds?: number[];
  usageLimit?: number;
  usageLimitPerCustomer?: number;
  startsAt?: string;
  endsAt?: string;
  active?: boolean;
}

export interface ValidateDiscountResult {
  valid: boolean;
  reason?: string;
  message?: string;
  discountId?: number;
  code?: string;
  type?: DiscountType;
  discountAmount?: number;
  freeShipping?: boolean;
}

// --- Draft Orders — mirrors backend/src/draft-orders/draft-order-constants.ts by hand. ---

export const DRAFT_ORDER_STATUSES = ["OPEN", "INVOICE_SENT", "COMPLETED", "CANCELLED"] as const;
export type DraftOrderStatus = (typeof DRAFT_ORDER_STATUSES)[number];
export const DRAFT_ORDER_STATUS_LABELS: Record<DraftOrderStatus, string> = {
  OPEN: "Open",
  INVOICE_SENT: "Invoice sent",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export interface DraftOrderItem {
  id: number;
  productId: number;
  productName: string;
  thumbnail: string;
  variantId: number | null;
  variantLabel: string | null;
  quantity: number;
  price: string;
}

export interface DraftOrder {
  id: number;
  status: DraftOrderStatus;
  customerId: number | null;
  customer: { id: number; name: string; phone: string } | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerAddress: string | null;
  emirate: string | null;
  area: string | null;
  orderType: string | null;
  outletId: number;
  outlet: { id: number; name: string };
  discountId: number | null;
  discount: { id: number; code: string; type: DiscountType } | null;
  notes: string | null;
  convertedOrderId: number | null;
  convertedOrder: {
    id: number;
    status: string;
    paymentStatus: string;
    total: string;
    trackingToken: string | null;
  } | null;
  items: DraftOrderItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  createdAt: string;
  updatedAt: string;
}

export interface DraftOrderItemInput {
  productId: number;
  variantId?: number;
  quantity: number;
  price?: number;
}

export interface DraftOrderInput {
  outletId: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress: string;
  emirate: string;
  area?: string;
  orderType?: string;
  discountCode?: string | null;
  notes?: string;
  items?: DraftOrderItemInput[];
}

export const ADJUSTMENT_REASONS = ["received", "damaged", "recount", "other"] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  received: "Received shipment",
  damaged: "Damaged",
  recount: "Recount correction",
  other: "Other",
};

export type StockMovementType = "ADJUSTMENT" | "TRANSFER";

// Exactly one of productId/ingredientId is ever set on a given row — see
// backend/prisma/schema.prisma's comment on the stockmovement model.
export interface StockMovement {
  id: number;
  productId: number | null;
  productName: string | null;
  variantId: number | null;
  variantLabel: string | null;
  ingredientId: number | null;
  ingredientName: string | null;
  ingredientUnit: string | null;
  type: StockMovementType;
  reason: AdjustmentReason | null;
  delta: number;
  outletId: number;
  outletName: string;
  toOutletId: number | null;
  toOutletName: string | null;
  note: string | null;
  actorName: string;
  createdAt: string;
}

// Deliberately a much lighter shape than Product — no sku-for-sale/
// variants/SEO/publishing fields exist on this model at all (see backend
// schema.prisma's comment on `ingredient`). image/description/costPerUnit/
// supplier/collection bring it closer to Product's own level of detail
// without copying fields that genuinely don't apply (no price, no SEO).
export interface Ingredient {
  id: number;
  name: string;
  unit: string;
  trackInventory: boolean;
  image: string | null;
  description: string | null;
  costPerUnit: string | null;
  supplier: string | null;
  categoryId: number | null;
  categoryName: string | null;
  createdAt: string;
  // Only populated when the request specified an outletId (list/detail
  // fetch scoped to one outlet) — null otherwise, same convention as
  // Product's own per-outlet stock fields.
  stockQuantity: number | null;
  lowStockThreshold: number | null;
}

// Flat — no parent/tree, unlike Collection (see backend
// ingredientcategory's schema comment for why).
export interface IngredientCategory {
  id: number;
  name: string;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  actorId: number;
  actorName: string;
  createdAt: string;
}

export interface PaginatedAuditLog {
  data: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

// Phase 5 job queue — mirrors backend/src/jobs/jobs.service.ts's `job` shape
// (dead-letter rows only; this admin view never shows pending/processing
// jobs, just what's actually broken and needs a human).
export interface FailedJob {
  id: number;
  shopId: number;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedStockMovements {
  data: StockMovement[];
  total: number;
  page: number;
  pageSize: number;
}

// --- Templates — mirrors backend/src/templates/template-constants.ts by hand. ---

export const TEMPLATE_TYPES = ["MANUAL", "RULE_BASED", "COLLECTION_GROUP"] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  MANUAL: "Manual (pick products yourself)",
  RULE_BASED: "Rule-based (auto-updates)",
  COLLECTION_GROUP: "Collection group (storefront homepage section)",
};

// Every field ANDed together — see backend TemplatesService.resolveProductIds.
export interface TemplateRules {
  collectionId?: number;
  tagName?: string;
  minPrice?: number;
  maxPrice?: number;
  createdWithinDays?: number;
}

export interface Template {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  image: string | null;
  type: TemplateType;
  rules: TemplateRules | null;
  isActive: boolean;
  displayOrder: number;
  productCount: number;
  createdAt: string;
  // Only present on the single-template detail fetch.
  productIds?: number[];
  // Only present on the single-template detail fetch, COLLECTION_GROUP only.
  collections?: { collectionId: number; sortOrder: number }[];
}

// --- Menu (Phase C) — the storefront top bar's merchant-configured nav. ---

export const MENU_ITEM_TYPES = ["LINK", "DROPDOWN", "MEGA"] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number];

export const MENU_COLUMN_LINK_TYPES = ["COLLECTION", "PRODUCT", "CUSTOM"] as const;
export type MenuColumnLinkType = (typeof MENU_COLUMN_LINK_TYPES)[number];

export interface MenuItemCollectionRef {
  collectionId: number;
  sortOrder: number;
  collection: { id: number; name: string; slug: string } | null;
}

export interface MenuColumnLink {
  id: number;
  label: string;
  linkType: MenuColumnLinkType;
  featured: boolean;
  sortOrder: number;
  collection: { id: number; name: string; slug: string } | null;
  product: { id: number; name: string; slug: string } | null;
  customUrl: string | null;
}

export interface MenuColumn {
  id: number;
  title: string;
  sortOrder: number;
  links: MenuColumnLink[];
}

// Per-nav-item button styling — applies to every type (LINK/DROPDOWN/MEGA),
// it styles the top-level nav trigger itself, not the flyout content.
export interface MenuItemStyle {
  textColor?: string;
  backgroundColor?: string;
  borderRadius?: "none" | "slight" | "pill";
  fontWeight?: "normal" | "medium" | "bold";
  hoverBackgroundColor?: string;
}

export interface MenuItem {
  id: number;
  label: string;
  type: MenuItemType;
  displayOrder: number;
  style: MenuItemStyle | null;
  // LINK only.
  collectionId: number | null;
  collection: { id: number; name: string; slug: string } | null;
  // DROPDOWN only.
  collections: MenuItemCollectionRef[];
  // MEGA only.
  columns: MenuColumn[];
}

export interface AbandonedCart {
  id: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  cartValue: string;
  capturedAt: string;
  recoveryEmailSentAt: string | null;
  recoveredOrderId: number | null;
}

export type GiftCardStatus = "active" | "redeemed" | "expired" | "disabled";

export interface GiftCard {
  id: number;
  code: string;
  initialValue: string;
  remainingBalance: string;
  status: GiftCardStatus;
  expiresAt: string | null;
  purchasedByCustomerId: number | null;
  purchasedByCustomer: { id: number; name: string } | null;
  purchaseOrderId: number | null;
  createdAt: string;
  updatedAt: string;
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

export interface PolicyPage {
  type: PolicyPageType;
  content: string | null;
  updatedAt: string | null;
}
