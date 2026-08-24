import type {
  AbandonedCart,
  AdjustmentReason,
  AffiliateCodeListItem,
  AffiliateListItem,
  AffiliateOrderListItem,
  AffiliateSummary,
  PaginatedAffiliateCodes,
  PaginatedAffiliateOrders,
  PaginatedAffiliates,
  AuthUser,
  BranchRole,
  BranchRoleAssignment,
  Permission,
  BioLink,
  BioLinkSocialPlatform,
  BioLinkType,
  BioPageConfig,
  BusinessHours,
  Collection,
  Template,
  TemplateRules,
  TemplateType,
  Discount,
  DiscountInput,
  DraftOrder,
  DraftOrderInput,
  ValidateDiscountResult,
  CustomerDetail,
  DailyRevenuePoint,
  DashboardSummary,
  DeliveryZone,
  ExternalDelivery,
  GeneralReportSummary,
  GiftCard,
  GiftCardStatus,
  ImportConfirmResult,
  ImportPreviewResult,
  Ingredient,
  Invoice,
  InvoiceType,
  IngredientCategory,
  MenuItem,
  MenuItemType,
  MenuItemStyle,
  MenuColumnLinkType,
  MonthlyReportFilters,
  Order,
  Outlet,
  OrderHistoryEntry,
  OrderNote,
  OrderReturn,
  OrderStatus,
  PaginatedCustomers,
  PaginatedExternalDeliveries,
  PaginatedGeneralReportOrders,
  PaginatedOrders,
  PaginatedProductSales,
  PaymentProviderSettings,
  PolicyPage,
  PolicyPageType,
  Product,
  ProductInput,
  ProductVariant,
  UpdateVariantInput,
  PublishReadiness,
  ReportsFilters,
  ScanCommitItem,
  ScanCommitResult,
  ScanPreviewResult,
  ScanSettings,
  SeoSettings,
  WhatsAppSettings,
  PaginatedAuditLog,
  PaginatedStockMovements,
  FailedJob,
  Shop,
  ShopDomainConfig,
  StockMovementType,
  ThemeSettings,
  Theme,
  ThemeListItem,
  ThemeConfig,
  TopProduct,
  UserRole,
} from "./types";

// Exported so pages can build backend-hosted URLs the merchant needs to see
// verbatim (e.g. the Payment Gateways page's per-shop Stripe webhook URL) —
// not just for this file's own fetch calls.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
// Public storefront origin — mirrors backend PublicService's own
// STOREFRONT_URL fallback (http://localhost:3002) so admin's internal
// storefront navigation (order/payment links, none of which are exposed to
// the merchant as "your store's address") points at the same place the
// backend already builds those against. NOT used by storefrontUrlFor below —
// see its own comment for why that one resolves differently.
export const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3002";
// Mirrors backend ShopService's own STOREFRONT_ROOT_DOMAIN fallback
// ('requital.io') — the domain a shop's own subdomain hangs off of.
const STOREFRONT_ROOT_DOMAIN = process.env.NEXT_PUBLIC_STOREFRONT_ROOT_DOMAIN ?? "requital.io";

// The merchant-facing "your store's public address" — shown on Business
// Information's "Your store is live at", the outlet QR code, and TopBar's
// "View store" link. Mirrors ShopService.getDomainConfig's own
// storefrontUrl computation exactly (see that method's comment): a shop on
// a connected custom domain resolves to it directly, everyone else resolves
// to their own {subdomain}.requital.io — never the old bare-path
// {STOREFRONT_URL}/{subdomain} shape, which stopped being this shop's real
// public address once per-shop domains shipped.
export function storefrontUrlFor(shop: {
  subdomain: string;
  domainType: "subdomain" | "custom";
  customDomain: string | null;
}) {
  if (shop.domainType === "custom" && shop.customDomain) {
    return `https://${shop.customDomain}`;
  }
  return `https://${shop.subdomain}.${STOREFRONT_ROOT_DOMAIN}`;
}
const ACCESS_TOKEN_KEY = "requital_admin_access_token";
const REFRESH_TOKEN_KEY = "requital_admin_refresh_token";

// Uploaded images are stored as paths relative to the backend
// (/uploads/products/..., /uploads/collections/...), but the admin app runs
// on its own origin/port — a bare relative <img src> resolves against the
// admin origin and 404s. Absolute URLs (seed data uses some) and blob:
// object-URLs (fresh local previews) are left untouched.
export function resolveImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith("/") ? `${API_URL}${path}` : path;
}

// localStorage isn't available during SSR/build — every call site here runs
// client-side only (this admin app has no server-rendered authenticated
// pages), but guard anyway since Next may still evaluate modules on the server.
export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(tokens: { accessToken: string; refreshToken: string }) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

// clearTokens() above only touches localStorage — it doesn't tell
// AuthProvider's `user` state that the session just died. Without this,
// RequireAuth's own (already-correct) `if (!user) redirect to /login` logic
// never fires when a 401 happens mid-session (refresh token expired,
// revoked, or a JWT_SECRET rotation invalidated every outstanding token at
// once): `user` stays stale-truthy in React state, so the merchant is left
// staring at whatever partial/broken page they were on instead of being
// bounced to /login, until they manually navigate somewhere that happens to
// re-run AuthProvider's mount check. AuthProvider subscribes to this so a
// 401-triggered clearTokens() call also flips `user` to null immediately,
// letting RequireAuth's existing redirect do its job without a page reload.
let unauthorizedListeners: Array<() => void> = [];
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.push(listener);
  return () => {
    unauthorizedListeners = unauthorizedListeners.filter((l) => l !== listener);
  };
}
function notifyUnauthorized() {
  unauthorizedListeners.forEach((listener) => listener());
}

// Carries the HTTP status alongside the message so callers can distinguish
// e.g. a 404 "not found" from a genuine failure without string-matching
// error text.
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// The access token is short-lived (15min) by design — this is the shared
// in-flight refresh so N requests that all 401 around the same moment
// trigger exactly one POST /auth/refresh (and one rotation), not N racing
// attempts to redeem the same refresh token, which would trip the backend's
// reuse-detection and log the whole session out over a false alarm.
let refreshPromise: Promise<TokenPair> | null = null;

async function refreshAccessToken(): Promise<TokenPair> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new ApiError("No refresh token", 401);
  }
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) throw new ApiError("Refresh failed", res.status);
        const data = (await res.json()) as TokenPair;
        setTokens(data);
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function apiFetch<T>(path: string, init?: RequestInit, isRetry = false): Promise<T> {
  // FormData sets its own multipart boundary in the Content-Type header —
  // forcing application/json here would break the upload endpoint.
  const isFormData = init?.body instanceof FormData;
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // A 401 on anything other than the refresh call itself means the access
    // token expired mid-session (expected — it only lives 15min) — try a
    // silent refresh and retry this request exactly once before giving up.
    // Only after the refresh attempt *also* fails do we clear everything and
    // let the next render's auth check redirect to /login.
    if (res.status === 401 && !isRetry && path !== "/auth/refresh") {
      try {
        await refreshAccessToken();
        return apiFetch<T>(path, init, true);
      } catch {
        clearTokens();
        notifyUnauthorized();
      }
    } else if (res.status === 401) {
      clearTokens();
      notifyUnauthorized();
    }
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.message ?? `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  // A 200 with an empty body (no Content-Length, or 0) isn't valid JSON —
  // res.json() throws "Unexpected end of JSON input" on it. Read as text
  // first and only parse if there's actually something there.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// Twin of apiFetch above for the one endpoint that returns text/html rather
// than JSON (the invoice HTML preview) — same auth-header/401-refresh-retry
// contract, just without the JSON parse apiFetch always does on its
// response body.
async function apiFetchText(path: string, isRetry = false): Promise<string> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    if (res.status === 401 && !isRetry) {
      try {
        await refreshAccessToken();
        return apiFetchText(path, true);
      } catch {
        clearTokens();
        notifyUnauthorized();
      }
    } else if (res.status === 401) {
      clearTokens();
      notifyUnauthorized();
    }
    throw new ApiError(`Request failed (${res.status})`, res.status);
  }
  return res.text();
}

export function login(email: string, password: string) {
  return apiFetch<TokenPair & { user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function signup(data: {
  name: string;
  email: string;
  password: string;
  shopName: string;
  subdomain: string;
  phone?: string;
  businessType?: string;
  trn?: string;
  websiteUrl?: string;
  address?: string;
  operatingModel?: string[];
  branchCount?: string;
  country?: string;
  productEditorMode?: "simple" | "advanced";
}) {
  return apiFetch<TokenPair & { user: AuthUser; devVerificationLink?: string }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function logout() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return Promise.resolve();
  // Best-effort — the tokens are cleared client-side regardless of whether
  // this round-trip succeeds (see auth-context.tsx), so a network failure
  // here shouldn't block logging out locally.
  return apiFetch<{ success: boolean }>("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  }).catch(() => undefined);
}

export function me() {
  return apiFetch<AuthUser>("/auth/me");
}

export function listShopUsers() {
  return apiFetch<AuthUser[]>("/auth/users");
}

export function createBranchUser(data: {
  name: string;
  email: string;
  // Omitted means "email a real invite link and let the staff member set
  // their own password" — see AuthService.createBranchUser.
  password?: string;
  role: UserRole;
  outletId?: number;
}) {
  return apiFetch<AuthUser & { devVerificationLink?: string; devInviteLink?: string }>(
    "/auth/branch-users",
    { method: "POST", body: JSON.stringify(data) },
  );
}

export function acceptInvite(data: { token: string; password: string }) {
  return apiFetch<TokenPair & { user: AuthUser }>("/auth/accept-invite", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function changePassword(data: { currentPassword: string; newPassword: string }) {
  return apiFetch<{ success: boolean }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function forgotPassword(email: string) {
  return apiFetch<{ success: boolean; devResetLink?: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(data: { token: string; newPassword: string }) {
  return apiFetch<{ success: boolean }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function verifyEmail(token: string) {
  return apiFetch<{ success: boolean }>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function resendVerification() {
  return apiFetch<{ success: boolean; alreadyVerified: boolean; devVerificationLink?: string }>(
    "/auth/resend-verification",
    { method: "POST" },
  );
}

export function updateStaffUser(id: number, data: { name?: string; role?: UserRole; outletId?: number }) {
  return apiFetch<AuthUser>(`/auth/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteStaffUser(id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/auth/users/${id}`, { method: "DELETE" });
}

export function listBranchRoles() {
  return apiFetch<BranchRole[]>("/shop/branch-roles");
}

export function createBranchRole(data: { name: string; permissions: Permission[] }) {
  return apiFetch<BranchRole>("/shop/branch-roles", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateBranchRole(id: number, data: { name?: string; permissions?: Permission[] }) {
  return apiFetch<BranchRole>(`/shop/branch-roles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteBranchRole(id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/shop/branch-roles/${id}`, { method: "DELETE" });
}

export function listBranchRoleAssignments() {
  return apiFetch<BranchRoleAssignment[]>("/shop/branch-roles/assignments");
}

export function assignBranchRole(data: { userId: number; outletId: number; branchRoleId: number }) {
  return apiFetch<BranchRoleAssignment>("/shop/branch-roles/assignments", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function unassignBranchRole(userId: number, outletId: number) {
  return apiFetch<{ userId: number; outletId: number; deleted: boolean }>(
    `/shop/branch-roles/assignments/${userId}/${outletId}`,
    { method: "DELETE" },
  );
}

export function listOutlets() {
  return apiFetch<Outlet[]>("/outlets");
}

export function getOutlet(id: number) {
  return apiFetch<Outlet>(`/outlets/${id}`);
}

export interface OutletInput {
  name: string;
  nameAr?: string;
  email?: string;
  whatsapp?: string;
  active?: boolean;
  emirate?: string;
  area?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
  businessHours?: Partial<BusinessHours>;
  closedOverride?: boolean;
  pickupEnabled?: boolean;
  deliveryEnabled?: boolean;
  deliveryRadiusKm?: number;
}

export function createOutlet(data: OutletInput) {
  return apiFetch<Outlet>("/outlets", { method: "POST", body: JSON.stringify(data) });
}

export function updateOutlet(id: number, data: Partial<OutletInput>) {
  return apiFetch<Outlet>(`/outlets/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteOutlet(id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/outlets/${id}`, { method: "DELETE" });
}

// Narrower than updateOutlet — backs the Orders > Branch Status tab, which
// only needs to flip the two accepting-orders toggles and is reachable by
// branch/order_manager, not just admin (see PATCH /outlets/:id/status).
export function updateOutletStatus(
  id: number,
  data: Partial<{ pickupEnabled: boolean; deliveryEnabled: boolean }>,
) {
  return apiFetch<Outlet>(`/outlets/${id}/status`, { method: "PATCH", body: JSON.stringify(data) });
}

export interface DeliveryZoneInput {
  name: string;
  fee: number;
  minOrderAmount?: number;
  isActive?: boolean;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

export function listDeliveryZones(outletId: number) {
  return apiFetch<DeliveryZone[]>(`/outlets/${outletId}/delivery-zones`);
}

export function createDeliveryZone(outletId: number, data: DeliveryZoneInput) {
  return apiFetch<DeliveryZone>(`/outlets/${outletId}/delivery-zones`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateDeliveryZone(outletId: number, zoneId: number, data: Partial<DeliveryZoneInput>) {
  return apiFetch<DeliveryZone>(`/outlets/${outletId}/delivery-zones/${zoneId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteDeliveryZone(outletId: number, zoneId: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/outlets/${outletId}/delivery-zones/${zoneId}`, {
    method: "DELETE",
  });
}

export function getShop() {
  return apiFetch<Shop>("/shop");
}

export function getPublishReadiness() {
  return apiFetch<PublishReadiness>("/shop/publish-readiness");
}

export function updateShop(
  data: Partial<Omit<Shop, "id" | "subdomain" | "defaultDeliveryFee" | "taxRate">> & {
    defaultDeliveryFee?: number;
    taxRate?: number;
  },
) {
  return apiFetch<Shop>("/shop", { method: "PATCH", body: JSON.stringify(data) });
}

export function getShopDomain() {
  return apiFetch<ShopDomainConfig>("/shop/domain");
}

export function updateShopDomain(
  data: { type: "subdomain" } | { type: "custom"; customDomain: string },
) {
  return apiFetch<ShopDomainConfig>("/shop/domain", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function uploadShopLogo(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/shop/upload", { method: "POST", body: formData });
}

export function getTheme() {
  return apiFetch<ThemeSettings>("/theme");
}

export function updateTheme(data: Partial<Omit<ThemeSettings, "shopId" | "updatedAt">>) {
  return apiFetch<ThemeSettings>("/theme", { method: "PATCH", body: JSON.stringify(data) });
}

export function uploadThemeImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/theme/upload", { method: "POST", body: formData });
}

// --- New visual theme builder (deliberately separate `/themes` endpoints —
// see backend/src/themes/themes.controller.ts's own header comment for why
// this doesn't reuse the legacy `/theme` singular routes above). ---

export function listThemes() {
  return apiFetch<ThemeListItem[]>("/themes");
}

// Named getThemeBuilder, not getTheme, to avoid clobbering the legacy
// singular getTheme() above — same theme/themes naming split as the backend.
export function getThemeBuilder(id: number) {
  return apiFetch<Theme>(`/themes/${id}`);
}

export function createTheme(data: { name: string; duplicateFromId?: number }) {
  return apiFetch<Theme>("/themes", { method: "POST", body: JSON.stringify(data) });
}

export function updateThemeDraft(id: number, data: { name?: string; config?: ThemeConfig }) {
  return apiFetch<Theme>(`/themes/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function publishTheme(id: number) {
  return apiFetch<Theme>(`/themes/${id}/publish`, { method: "POST" });
}

export function deleteTheme(id: number) {
  return apiFetch<{ success: boolean }>(`/themes/${id}`, { method: "DELETE" });
}

// --- Menu (Phase C) — the storefront top bar's merchant-configured nav. ---

export function listMenuItems() {
  return apiFetch<MenuItem[]>("/menu-items");
}

export interface MenuColumnLinkInput {
  label: string;
  linkType: MenuColumnLinkType;
  collectionId?: number;
  productId?: number;
  customUrl?: string;
  featured?: boolean;
  sortOrder: number;
}

export interface MenuColumnInput {
  title: string;
  sortOrder: number;
  links: MenuColumnLinkInput[];
}

export interface MenuItemInput {
  label: string;
  type: MenuItemType;
  collectionId?: number;
  collections?: { collectionId: number; sortOrder: number }[];
  columns?: MenuColumnInput[];
  displayOrder?: number;
  style?: MenuItemStyle;
}

export function createMenuItem(data: MenuItemInput) {
  return apiFetch<MenuItem>("/menu-items", { method: "POST", body: JSON.stringify(data) });
}

export function updateMenuItem(id: number, data: Partial<MenuItemInput>) {
  return apiFetch<MenuItem>(`/menu-items/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteMenuItem(id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/menu-items/${id}`, { method: "DELETE" });
}

export function reorderMenuItems(ids: number[]) {
  return apiFetch<MenuItem[]>("/menu-items/reorder", { method: "PATCH", body: JSON.stringify({ ids }) });
}

export function getSeo() {
  return apiFetch<SeoSettings>("/seo");
}

export function updateSeo(data: Partial<Omit<SeoSettings, "shopId">>) {
  return apiFetch<SeoSettings>("/seo", { method: "PATCH", body: JSON.stringify(data) });
}

export function uploadSeoImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/seo/upload", { method: "POST", body: formData });
}

export function getPolicyPages() {
  return apiFetch<PolicyPage[]>("/shop/policy-pages");
}

export function updatePolicyPage(type: PolicyPageType, content: string) {
  return apiFetch<PolicyPage>(`/shop/policy-pages/${type}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

export function getPaymentSettings() {
  return apiFetch<PaymentProviderSettings[]>("/payment-settings");
}

export function updatePaymentProvider(
  provider: string,
  data: { enabled?: boolean; credentials?: Record<string, string> },
) {
  return apiFetch<PaymentProviderSettings[]>(`/payment-settings/${provider}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function getWhatsAppSettings() {
  return apiFetch<WhatsAppSettings>("/whatsapp-settings");
}

export function setWhatsAppCredentials(data: { phoneNumberId: string; accessToken: string }) {
  return apiFetch<WhatsAppSettings>("/whatsapp-settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function clearWhatsAppCredentials() {
  return apiFetch<WhatsAppSettings>("/whatsapp-settings", { method: "DELETE" });
}

export interface ListOrdersParams {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  statuses?: OrderStatus[];
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  // Admin-only ("all branches" is just omitting this); a branch account is
  // always forced to its own outlet server-side regardless of this value.
  outletId?: number;
}

export function listOrders(params: ListOrdersParams = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // Array.toString() comma-joins, matching the backend's ?statuses=a,b format.
    if (value && (!Array.isArray(value) || value.length)) query.set(key, String(value));
  }
  return apiFetch<PaginatedOrders>(`/orders?${query.toString()}`);
}

export function getOrder(id: number) {
  return apiFetch<Order>(`/orders/${id}`);
}

export function getOrderHistory(id: number) {
  return apiFetch<OrderHistoryEntry[]>(`/orders/${id}/history`);
}

export function updateOrderStatus(id: number, status: OrderStatus) {
  return apiFetch<Order>(`/orders/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// Orders that can't legally make this jump (per the same state machine
// single-order updateStatus enforces) are skipped, not forced — see
// `results` for which ids succeeded/failed and why.
export interface GlobalSearchResult {
  products: { id: number; name: string; sku: string; price: string; thumbnail: string }[];
  orders: { id: number; customerName: string; status: string; total: string }[];
  customers: { id: number; name: string; phone: string; email: string | null }[];
}

export function globalSearch(q: string) {
  return apiFetch<GlobalSearchResult>(`/search?q=${encodeURIComponent(q)}`);
}

export function bulkUpdateOrderStatus(orderIds: number[], status: OrderStatus) {
  return apiFetch<BulkResult>("/orders/bulk-status", {
    method: "PATCH",
    body: JSON.stringify({ orderIds, status }),
  });
}

// Full desired item list, not a patch — see UpdateOrderItemsDto on the
// backend. `discountDropped` on the response means an attached discount no
// longer qualified against the edited items/subtotal and was removed.
// `ingredientStockWarnings` lists BOM ingredient names whose outlet stock
// went negative from this edit's quantity increase — the save still
// succeeds (never blocked), this is warning-only.
export function updateOrderItems(
  id: number,
  items: { productId: number; variantId?: number; quantity: number }[],
) {
  return apiFetch<Order & { discountDropped: boolean; ingredientStockWarnings: string[] }>(`/orders/${id}/items`, {
    method: "PATCH",
    body: JSON.stringify({ items }),
  });
}

export function addOrderNote(id: number, note: string) {
  return apiFetch<OrderNote>(`/orders/${id}/notes`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function cancelOrder(id: number) {
  return apiFetch<Order>(`/orders/${id}/cancel`, { method: "POST" });
}

export function updateOrderDeliveryFee(id: number, deliveryFee: number) {
  return apiFetch<Order>(`/orders/${id}/delivery-fee`, {
    method: "PATCH",
    body: JSON.stringify({ deliveryFee }),
  });
}

export function getOrderReturns(orderId: number) {
  return apiFetch<OrderReturn[]>(`/orders/${orderId}/returns`);
}

export function createOrderReturn(
  orderId: number,
  input: {
    items: { orderItemId: number; quantity: number }[];
    reason: OrderReturn["reason"];
    restock?: boolean;
    refundAmount?: number;
  },
) {
  return apiFetch<OrderReturn>(`/orders/${orderId}/returns`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listInvoicesForOrder(orderId: number) {
  return apiFetch<Invoice[]>(`/invoices?orderId=${orderId}`);
}

export function generateInvoice(orderId: number, type: InvoiceType) {
  return apiFetch<Invoice>("/invoices", {
    method: "POST",
    body: JSON.stringify({ orderId, type }),
  });
}

export function getInvoiceHtml(id: number) {
  return apiFetchText(`/invoices/${id}/pdf`);
}

export function generatePaymentLink(orderId: number) {
  return apiFetch<{ url: string; token: string; expiresAt: string }>(
    `/orders/${orderId}/payment-link`,
    { method: "POST" },
  );
}

// outletId picks whose stock counts to attach to each product (see
// Product.stockQuantity) — omit it and every product comes back with null
// stock figures rather than a shop-wide number that no longer exists.
export function listProducts(outletId?: number) {
  const query = outletId ? `?outletId=${outletId}` : "";
  return apiFetch<Product[]>(`/products${query}`);
}

export function adjustStock(
  adjustments: { productId: number; variantId?: number; delta: number }[],
  outletId?: number,
) {
  return apiFetch<{
    products: { productId: number; stockQuantity: number }[];
    variants: { variantId: number; stockQuantity: number }[];
  }>("/products/stock/bulk-adjust", {
    method: "PATCH",
    body: JSON.stringify({ outletId, adjustments }),
  });
}

interface StockSnapshot {
  products?: { outletId: number; productId: number; stockQuantity: number }[];
  variants?: { outletId: number; variantId: number; stockQuantity: number }[];
  ingredients?: { outletId: number; ingredientId: number; stockQuantity: number }[];
}

// productId (+ optional variantId) OR ingredientId — exactly one, never
// both, enforced server-side (see ProductsService.assertStockTarget).
export function transferStock(data: {
  productId?: number;
  variantId?: number;
  ingredientId?: number;
  fromOutletId: number;
  toOutletId: number;
  quantity: number;
  note?: string;
}) {
  return apiFetch<StockSnapshot>("/products/stock/transfer", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function adjustStockWithReason(data: {
  productId?: number;
  variantId?: number;
  ingredientId?: number;
  outletId?: number;
  delta: number;
  reason: AdjustmentReason;
  note?: string;
}) {
  return apiFetch<StockSnapshot>("/products/stock/adjust", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function setLowStockThreshold(data: {
  productId?: number;
  variantId?: number;
  ingredientId?: number;
  outletId?: number;
  lowStockThreshold: number | null;
}) {
  return apiFetch<StockSnapshot>("/products/stock/threshold", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function listAuditLog(params: {
  entityType?: string;
  actorUserId?: number;
  page?: number;
  pageSize?: number;
} = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return apiFetch<PaginatedAuditLog>(`/audit-log${query ? `?${query}` : ""}`);
}

export function listAuditLogActors() {
  return apiFetch<{ id: number; name: string }[]>("/audit-log/actors");
}

export function listFailedJobs() {
  return apiFetch<FailedJob[]>("/jobs/failed");
}

export function retryFailedJob(id: number) {
  return apiFetch<void>(`/jobs/${id}/retry`, { method: "POST" });
}

export function dismissFailedJob(id: number) {
  return apiFetch<void>(`/jobs/${id}`, { method: "DELETE" });
}

export function listStockMovements(params: {
  productId?: number;
  variantId?: number;
  ingredientId?: number;
  outletId?: number;
  type?: StockMovementType;
  page?: number;
  pageSize?: number;
} = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return apiFetch<PaginatedStockMovements>(`/products/stock/movements${query ? `?${query}` : ""}`);
}

export interface IngredientInput {
  name: string;
  unit: string;
  trackInventory?: boolean;
  image?: string | null;
  description?: string | null;
  costPerUnit?: number | null;
  supplier?: string | null;
  categoryId?: number | null;
}

export function listIngredients(outletId?: number, categoryId?: number) {
  const search = new URLSearchParams();
  if (outletId) search.set("outletId", String(outletId));
  if (categoryId) search.set("categoryId", String(categoryId));
  const query = search.toString();
  return apiFetch<Ingredient[]>(`/shop/ingredients${query ? `?${query}` : ""}`);
}

export function createIngredient(data: IngredientInput) {
  return apiFetch<Ingredient>("/shop/ingredients", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateIngredient(id: number, data: Partial<IngredientInput>) {
  return apiFetch<Ingredient>(`/shop/ingredients/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteIngredient(id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/shop/ingredients/${id}`, {
    method: "DELETE",
  });
}

export function uploadIngredientImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/shop/ingredients/upload", {
    method: "POST",
    body: formData,
  });
}

export function listIngredientCategories() {
  return apiFetch<IngredientCategory[]>("/shop/ingredient-categories");
}

export function createIngredientCategory(name: string) {
  return apiFetch<IngredientCategory>("/shop/ingredient-categories", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateIngredientCategory(id: number, name: string) {
  return apiFetch<IngredientCategory>(`/shop/ingredient-categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function deleteIngredientCategory(id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/shop/ingredient-categories/${id}`, {
    method: "DELETE",
  });
}

export function previewImportIngredients(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<ImportPreviewResult>("/shop/ingredients/import/preview", { method: "POST", body: formData });
}

export function confirmImportIngredients(file: File, outletId?: number) {
  const formData = new FormData();
  formData.append("file", file);
  const query = outletId ? `?outletId=${outletId}` : "";
  return apiFetch<ImportConfirmResult>(`/shop/ingredients/import/confirm${query}`, { method: "POST", body: formData });
}

export function createProduct(data: ProductInput) {
  return apiFetch<Product>("/products", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateProduct(id: number, data: Partial<ProductInput>) {
  return apiFetch<Product>(`/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// Separate from updateProduct/PATCH /products/:id, which is admin-only —
// this one endpoint stays open to branch users (their outlet's day-to-day
// availability call), and its DTO server-side accepts nothing but `status`
// so a branch request can't smuggle a name/price change through it.
export function updateProductAvailability(id: number, status: string) {
  return apiFetch<Product>(`/products/${id}/availability`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// allOutlets attaches a per-outlet stock breakdown (product- and, if
// variants exist, variant-level) instead of the single `outletId` figure —
// used by the edit form's inventory table, which needs every outlet's
// quantity at once.
export function getProduct(id: number, options: { outletId?: number; allOutlets?: boolean } = {}) {
  const params = new URLSearchParams();
  if (options.outletId) params.set("outletId", String(options.outletId));
  if (options.allOutlets) params.set("allOutlets", "true");
  const query = params.toString();
  return apiFetch<Product>(`/products/${id}${query ? `?${query}` : ""}`);
}

export function deleteProduct(id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/products/${id}`, {
    method: "DELETE",
  });
}

export function bulkUpdateProductStatus(productIds: number[], status: string) {
  return apiFetch<{ updated: number; requested: number }>("/products/bulk-status", {
    method: "PATCH",
    body: JSON.stringify({ productIds, status }),
  });
}

export interface BulkResultRow {
  id?: number;
  orderId?: number;
  success: boolean;
  error?: string;
}
export interface BulkResult {
  results: BulkResultRow[];
  succeeded: number;
}

export function bulkDeleteProducts(productIds: number[]) {
  return apiFetch<BulkResult>("/products/bulk-delete", {
    method: "DELETE",
    body: JSON.stringify({ productIds }),
  });
}

export interface BulkPriceResultRow {
  id: number;
  name: string;
  oldPrice: string | null;
  newPrice?: string;
  success: boolean;
  error?: string;
}
export interface BulkPriceResult {
  results: BulkPriceResultRow[];
  succeeded: number;
}

export function bulkUpdateProductPrice(data: {
  productIds: number[];
  field: "price" | "compareAtPrice";
  mode: "percentage" | "fixed";
  value: number;
}) {
  return apiFetch<BulkPriceResult>("/products/bulk-price", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// Deep-copies everything but sku/barcode/slug (regenerated to avoid unique
// collisions) and stock (a copy always starts untracked/zero) — lands as
// status "Unavailable" (shown as "Draft") so it never goes live by accident.
export function duplicateProduct(id: number) {
  return apiFetch<Product>(`/products/${id}/duplicate`, {
    method: "POST",
  });
}

export function uploadProductImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/products/upload", {
    method: "POST",
    body: formData,
  });
}

// Confirm re-submits the same File the merchant already picked (rather than
// a preview id) — see backend ProductsService.confirmImportProducts for why
// this pair is stateless.
export function previewImportProducts(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<ImportPreviewResult>("/products/import/preview", { method: "POST", body: formData });
}

export function confirmImportProducts(file: File, outletId?: number) {
  const formData = new FormData();
  formData.append("file", file);
  const query = outletId ? `?outletId=${outletId}` : "";
  return apiFetch<ImportConfirmResult>(`/products/import/confirm${query}`, { method: "POST", body: formData });
}

// Full replace of the option/value set — see backend ProductsService.updateOptions
// for the reconciliation rules that keep already-edited variants intact.
export function updateProductOptions(productId: number, options: { name: string; values: string[] }[]) {
  return apiFetch<Product>(`/products/${productId}/options`, {
    method: "PUT",
    body: JSON.stringify({ options }),
  });
}

export function updateVariant(productId: number, variantId: number, data: UpdateVariantInput) {
  return apiFetch<ProductVariant>(`/products/${productId}/variants/${variantId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function listCollections() {
  return apiFetch<Collection[]>("/collections");
}

export interface CollectionInput {
  name: string;
  slug?: string;
  parentCollectionId?: number | null;
  displayOrder?: number;
  image?: string | null;
  isFeatured?: boolean;
  description?: string;
}

export function uploadCollectionImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/collections/upload", {
    method: "POST",
    body: formData,
  });
}

export function createCollection(data: CollectionInput) {
  return apiFetch<Collection>("/collections", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateCollection(id: number, data: Partial<CollectionInput>) {
  return apiFetch<Collection>(`/collections/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteCollection(id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/collections/${id}`, {
    method: "DELETE",
  });
}

export function reorderCollections(ids: number[]) {
  return apiFetch<Collection[]>("/collections/reorder", {
    method: "PATCH",
    body: JSON.stringify({ ids }),
  });
}

export function listTemplates() {
  return apiFetch<Template[]>("/templates");
}

export function getTemplate(id: number) {
  return apiFetch<Template>(`/templates/${id}`);
}

export interface TemplateInput {
  title: string;
  slug?: string;
  description?: string;
  image?: string | null;
  type: TemplateType;
  rules?: TemplateRules;
  isActive?: boolean;
  displayOrder?: number;
}

export function uploadTemplateImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/templates/upload", {
    method: "POST",
    body: formData,
  });
}

export function createTemplate(data: TemplateInput) {
  return apiFetch<Template>("/templates", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateTemplate(id: number, data: Partial<TemplateInput>) {
  return apiFetch<Template>(`/templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteTemplate(id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/templates/${id}`, {
    method: "DELETE",
  });
}

export function setTemplateProducts(id: number, products: { productId: number; sortOrder: number }[]) {
  return apiFetch<Template>(`/templates/${id}/products`, {
    method: "PUT",
    body: JSON.stringify({ products }),
  });
}

export function setTemplateCollections(id: number, collections: { collectionId: number; sortOrder: number }[]) {
  return apiFetch<Template>(`/templates/${id}/collections`, {
    method: "PUT",
    body: JSON.stringify({ collections }),
  });
}

export interface DashboardRangeParams {
  from?: string;
  to?: string;
  // Admin drill-down into one branch; omitted means aggregated across every
  // outlet. A branch account is always forced to its own outlet server-side.
  outletId?: number;
}

export function getDashboardSummary(params: DashboardRangeParams = {}) {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.outletId) query.set("outletId", String(params.outletId));
  return apiFetch<DashboardSummary>(`/dashboard/summary?${query.toString()}`);
}

export function getDailyRevenue(params: DashboardRangeParams = {}) {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.outletId) query.set("outletId", String(params.outletId));
  return apiFetch<DailyRevenuePoint[]>(`/dashboard/revenue-daily?${query.toString()}`);
}

export function getTopProducts(params: DashboardRangeParams & { limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.outletId) query.set("outletId", String(params.outletId));
  return apiFetch<TopProduct[]>(`/dashboard/top-products?${query.toString()}`);
}

export interface ListCustomersParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: "name" | "phone" | "orderCount" | "lifetimeValue" | "lastOrderDate";
  sortDir?: "asc" | "desc";
}

// Admin-only endpoint server-side — see backend CustomersController.
export function listCustomers(params: ListCustomersParams = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);
  if (params.sortBy) query.set("sortBy", params.sortBy);
  if (params.sortDir) query.set("sortDir", params.sortDir);
  return apiFetch<PaginatedCustomers>(`/customers?${query.toString()}`);
}

export function getCustomer(id: number) {
  return apiFetch<CustomerDetail>(`/customers/${id}`);
}

export function updateCustomer(
  id: number,
  data: Partial<{ name: string; phone: string; email: string; birthday: string }>,
) {
  return apiFetch<CustomerDetail>(`/customers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

function reportsFilterQuery(filters: ReportsFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.dateFrom) query.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) query.set("dateTo", filters.dateTo);
  if (filters.outletId) query.set("outletId", String(filters.outletId));
  if (filters.orderType) query.set("orderType", filters.orderType);
  if (filters.status) query.set("status", filters.status);
  if (filters.paymentMode) query.set("paymentMode", filters.paymentMode);
  if (filters.channel) query.set("channel", filters.channel);
  return query;
}

// Every reports endpoint is admin-only server-side — see backend ReportsController.
export function getGeneralReportSummary(filters: ReportsFilters) {
  return apiFetch<GeneralReportSummary>(`/reports/general/summary?${reportsFilterQuery(filters).toString()}`);
}

export function listGeneralReportOrders(
  filters: ReportsFilters,
  params: { page?: number; pageSize?: number; search?: string } = {},
) {
  const query = reportsFilterQuery(filters);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);
  return apiFetch<PaginatedGeneralReportOrders>(`/reports/general/orders?${query.toString()}`);
}

export function listProductSales(
  filters: ReportsFilters,
  params: {
    page?: number;
    pageSize?: number;
    search?: string;
    sortBy?: "name" | "currentPrice" | "orderCount" | "totalQuantity" | "totalSalePrice";
    sortDir?: "asc" | "desc";
  } = {},
) {
  const query = reportsFilterQuery(filters);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);
  if (params.sortBy) query.set("sortBy", params.sortBy);
  if (params.sortDir) query.set("sortDir", params.sortDir);
  return apiFetch<PaginatedProductSales>(`/reports/product-sales?${query.toString()}`);
}

function monthlyReportFilterQuery(filters: MonthlyReportFilters): URLSearchParams {
  const query = new URLSearchParams();
  query.set("month", filters.month);
  if (filters.outletId) query.set("outletId", String(filters.outletId));
  if (filters.orderType) query.set("orderType", filters.orderType);
  if (filters.status) query.set("status", filters.status);
  if (filters.paymentMode) query.set("paymentMode", filters.paymentMode);
  if (filters.channel) query.set("channel", filters.channel);
  return query;
}

// Monthly Report is General Report's own endpoints with `month` translated
// server-side into a date range — see backend ReportsService.resolveMonthRange.
export function getMonthlyReportSummary(filters: MonthlyReportFilters) {
  return apiFetch<GeneralReportSummary>(`/reports/monthly/summary?${monthlyReportFilterQuery(filters).toString()}`);
}

export function listMonthlyReportOrders(
  filters: MonthlyReportFilters,
  params: { page?: number; pageSize?: number; search?: string } = {},
) {
  const query = monthlyReportFilterQuery(filters);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);
  return apiFetch<PaginatedGeneralReportOrders>(`/reports/monthly/orders?${query.toString()}`);
}

export function listExternalDeliveryReport(
  filters: ReportsFilters,
  params: { page?: number; pageSize?: number; search?: string } = {},
) {
  const query = reportsFilterQuery(filters);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);
  return apiFetch<PaginatedExternalDeliveries>(`/reports/external-delivery?${query.toString()}`);
}

// Manual courier-handoff log — no real courier API integration exists (see
// backend externaldelivery model comment). Admin-only server-side.
export function createExternalDelivery(
  orderId: number,
  data: { carrier: string; vehicleType?: string; price: number; destination: string },
) {
  return apiFetch<ExternalDelivery>(`/orders/${orderId}/external-delivery`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateExternalDelivery(
  orderId: number,
  data: Partial<{ status: ExternalDelivery["status"]; carrier: string; vehicleType: string; price: number; destination: string }>,
) {
  return apiFetch<ExternalDelivery>(`/orders/${orderId}/external-delivery`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// --- Affiliate — admin-only server-side, see backend AffiliateController. ---

export function getAffiliateSummary() {
  return apiFetch<AffiliateSummary>("/affiliates/summary");
}

export function listAffiliates(params: { page?: number; pageSize?: number; search?: string } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);
  return apiFetch<PaginatedAffiliates>(`/affiliates?${query.toString()}`);
}

export function createAffiliate(data: { name: string; mobile: string }) {
  return apiFetch<AffiliateListItem>("/affiliates", { method: "POST", body: JSON.stringify(data) });
}

export function updateAffiliate(id: number, data: Partial<{ name: string; mobile: string; status: string }>) {
  return apiFetch<AffiliateListItem>(`/affiliates/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function listAffiliateCodes(params: { page?: number; pageSize?: number; search?: string } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);
  return apiFetch<PaginatedAffiliateCodes>(`/affiliates/codes?${query.toString()}`);
}

export function createAffiliateCode(data: {
  affiliateId: number;
  code: string;
  promotionFor?: string;
  commissionType: string;
  commissionValue: number;
  validFrom?: string;
  validUntil?: string;
}) {
  return apiFetch<AffiliateCodeListItem>("/affiliates/codes", { method: "POST", body: JSON.stringify(data) });
}

export function updateAffiliateCode(
  id: number,
  data: Partial<{
    promotionFor: string;
    status: string;
    commissionType: string;
    commissionValue: number;
    validFrom: string;
    validUntil: string;
  }>,
) {
  return apiFetch<AffiliateCodeListItem>(`/affiliates/codes/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function listAffiliateOrders(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  return apiFetch<PaginatedAffiliateOrders>(`/affiliates/orders?${query.toString()}`);
}

export function updateAffiliateOrderStatus(id: number, status: "approved" | "blocked") {
  return apiFetch<AffiliateOrderListItem>(`/affiliates/orders/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// --- Bio Links — admin-only server-side, see backend BioLinksController. ---

export function listBioLinks() {
  return apiFetch<BioLink[]>("/shop/bio-links");
}

export interface BioLinkInput {
  type: BioLinkType;
  label?: string;
  url?: string;
  productId?: number;
  collectionId?: number;
  templateId?: number;
  socialPlatform?: BioLinkSocialPlatform;
  active?: boolean;
}

export function createBioLink(data: BioLinkInput) {
  return apiFetch<BioLink>("/shop/bio-links", { method: "POST", body: JSON.stringify(data) });
}

export function updateBioLink(id: number, data: Partial<BioLinkInput>) {
  return apiFetch<BioLink>(`/shop/bio-links/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteBioLink(id: number) {
  return apiFetch<{ success: boolean }>(`/shop/bio-links/${id}`, { method: "DELETE" });
}

export function reorderBioLinks(ids: number[]) {
  return apiFetch<BioLink[]>("/shop/bio-links/reorder", { method: "PATCH", body: JSON.stringify({ ids }) });
}

export function getBioPageConfig() {
  return apiFetch<BioPageConfig>("/shop/bio-links/page-config");
}

export function updateBioPageConfig(data: Partial<BioPageConfig>) {
  return apiFetch<BioPageConfig>("/shop/bio-links/page-config", { method: "PATCH", body: JSON.stringify(data) });
}

export function uploadBioLinkImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/shop/bio-links/upload", { method: "POST", body: formData });
}

// --- Discounts / Promo Codes ---

export function listDiscounts() {
  return apiFetch<Discount[]>("/shop/discounts");
}

export function getDiscount(id: number) {
  return apiFetch<Discount>(`/shop/discounts/${id}`);
}

export function createDiscount(data: DiscountInput) {
  return apiFetch<Discount>("/shop/discounts", { method: "POST", body: JSON.stringify(data) });
}

export function updateDiscount(id: number, data: Partial<DiscountInput>) {
  return apiFetch<Discount>(`/shop/discounts/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteDiscount(id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/shop/discounts/${id}`, { method: "DELETE" });
}

// --- Abandoned Cart Recovery ---

export function listAbandonedCarts() {
  return apiFetch<AbandonedCart[]>("/abandoned-carts");
}

// --- Gift Cards ---

export function listGiftCards() {
  return apiFetch<GiftCard[]>("/gift-cards");
}

export function createGiftCard(data: { initialValue: number; expiresAt?: string }) {
  return apiFetch<GiftCard>("/gift-cards", { method: "POST", body: JSON.stringify(data) });
}

export function updateGiftCard(id: number, data: { status?: GiftCardStatus; expiresAt?: string }) {
  return apiFetch<GiftCard>(`/gift-cards/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function validateDiscount(data: {
  code: string;
  cartSubtotal: number;
  productIds?: number[];
  collectionIds?: number[];
  customerId?: number;
}) {
  return apiFetch<ValidateDiscountResult>("/shop/discounts/validate", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// --- Draft Orders ---

export function listDraftOrders() {
  return apiFetch<DraftOrder[]>("/shop/draft-orders");
}

export function getDraftOrder(id: number) {
  return apiFetch<DraftOrder>(`/shop/draft-orders/${id}`);
}

export function createDraftOrder(data: DraftOrderInput) {
  return apiFetch<DraftOrder>("/shop/draft-orders", { method: "POST", body: JSON.stringify(data) });
}

export function updateDraftOrder(id: number, data: Partial<DraftOrderInput>) {
  return apiFetch<DraftOrder>(`/shop/draft-orders/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function cancelDraftOrder(id: number) {
  return apiFetch<DraftOrder>(`/shop/draft-orders/${id}/cancel`, { method: "PATCH" });
}

export function completeDraftOrder(id: number) {
  return apiFetch<DraftOrder>(`/shop/draft-orders/${id}/complete`, { method: "POST" });
}

export function sendDraftOrderInvoice(id: number) {
  return apiFetch<{ draftOrder: DraftOrder; paymentLink: { url: string; token: string; expiresAt: string } }>(
    `/shop/draft-orders/${id}/send-invoice`,
    { method: "POST" },
  );
}

export function getScanSettings() {
  return apiFetch<ScanSettings>("/scan/settings");
}

export function updateScanSettings(data: Partial<ScanSettings>) {
  return apiFetch<ScanSettings>("/scan/settings", { method: "PATCH", body: JSON.stringify(data) });
}

// Read-only — parses the uploaded photo via OCR and returns candidate line
// items; nothing is saved except the image itself (needed either way for
// the audit trail if the merchant goes on to confirm — see previewScan's
// imageUrl, which commitScan references rather than re-uploading).
export function previewScan(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<ScanPreviewResult>("/scan/preview", { method: "POST", body: formData });
}

export function commitScan(imageUrl: string, items: ScanCommitItem[]) {
  return apiFetch<ScanCommitResult>("/scan/commit", {
    method: "POST",
    body: JSON.stringify({ imageUrl, items }),
  });
}
