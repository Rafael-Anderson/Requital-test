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
  quantity: number;
  priceAtPurchase: string;
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
  // Null only for orders created before this field existed — falls back to
  // deriving it from total - subtotal for display in that case.
  deliveryFee: string | null;
  total: string;
  createdAt: string;
  paymentLinkToken: string | null;
  paymentLinkExpiresAt: string | null;
  orderitem: OrderItem[];
  // Only populated on the single-order detail fetch (GET /orders/:id).
  paymenttransaction?: PaymentTransaction[];
  customerOrderCount?: number;
}

export interface PaginatedOrders {
  data: Order[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  displayOrder: number;
  image: string | null;
  isFeatured: boolean;
  parentCategoryId: number | null;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
  depth: number;
}

// Builds a tree from the flat list the API returns. Ignores a
// parentCategoryId that doesn't resolve to another row in the list (treats
// it as root) rather than dropping the category — the backend already
// guarantees valid parents, but this keeps the client-side tree from
// silently losing a category if it ever doesn't.
export function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const byId = new Map<number, CategoryNode>(
    categories.map((c) => [c.id, { ...c, children: [], depth: 0 }]),
  );
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentCategoryId !== null ? byId.get(node.parentCategoryId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortAndSetDepth = (nodes: CategoryNode[], depth: number) => {
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
export function flattenCategoryTree(nodes: CategoryNode[]): CategoryNode[] {
  return nodes.flatMap((node) => [node, ...flattenCategoryTree(node.children)]);
}

// A category's full descendant id set, used to keep the parent-reassign
// dropdown cycle-safe on the client (the backend re-checks this too).
export function descendantIds(categoryId: number, categories: Category[]): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const c of categories) {
    if (c.parentCategoryId !== null) {
      childrenOf.set(c.parentCategoryId, [...(childrenOf.get(c.parentCategoryId) ?? []), c.id]);
    }
  }
  const result = new Set<number>();
  const stack = [...(childrenOf.get(categoryId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return result;
}

// Shape accepted by POST/PATCH /products — distinct from Product (the API
// response) because category assignment is written as categoryIds, not the
// expanded Category[] the response returns. Stock is no longer set here —
// it's per-outlet now (see PATCH /products/stock/bulk-adjust).
export interface ProductInput {
  name: string;
  price: number;
  thumbnail: string;
  sku: string;
  description?: string;
  trackInventory?: boolean;
  status?: string;
  categoryIds: number[];
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  price: string;
  sku: string;
  status: string;
  trackInventory: boolean;
  // null when no outlet was resolved for this request (e.g. an admin
  // viewing the catalog without picking a branch) — distinct from 0, which
  // means "this outlet genuinely has none in stock". Always resolved for a
  // branch user (forced to their own outlet server-side).
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  thumbnail: string;
  categories: Category[];
  tags: string[];
}

export type UserRole = "admin" | "branch";

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

  // Store Configuration — functional
  businessType: string | null;
  defaultLanguage: ShopLanguage;
  defaultDeliveryFee: string;
  taxDisplayText: string | null;
  productDisplayOrientation: ProductDisplayOrientation;
  productImageZoomEnabled: boolean;
  showCategoryMenu: boolean;
  allowPreOrders: boolean;
  customerConfirmationRequired: boolean;
  externalDeliveryEnabled: boolean;
  asapDeliveryEnabled: boolean;
  deliveryCalendarEnabled: boolean;
  // JSON string, see BusinessHours for the parsed shape.
  businessHours: string | null;
  whatsappFloatingButtonEnabled: boolean;
  birthdayDiscountEnabled: boolean;

  // Store Configuration — placeholder preferences (no feature behind them yet)
  productVariantsEnabled: boolean;
  productAttributesEnabled: boolean;
  productFaqsEnabled: boolean;
  customerSurveyEnabled: boolean;
  dynamicThemeBuilderEnabled: boolean;
  disableStoreCart: boolean;
  disableGoogleMaps: boolean;

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
}

export interface DeliveryZone {
  id: number;
  outletId: number;
  name: string;
  fee: string;
  minOrderAmount: string;
  isActive: boolean;
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
