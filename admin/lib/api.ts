import type {
  AbandonedCart,
  AdjustmentReason,
  CustomDomainStatus,
  AffiliateCodeListItem,
  AffiliateListItem,
  AffiliateOrderListItem,
  AffiliateSummary,
  PaginatedAffiliateCodes,
  PaginatedAffiliateOrders,
  PaginatedAffiliates,
  RegionsResponse,
  ZoneMappingProposal,
  AuthUser,
  StaffSession,
  TwoFactorStatus,
  BranchRole,
  BranchRoleAssignment,
  Permission,
  BioLink,
  BioLinkSocialPlatform,
  BioLinkType,
  BioPageConfig,
  BusinessHours,
  Collection,
  Brand,
  BrandInput,
  TaxClass,
  PurchaseOrderDetail,
  PurchaseOrderInput,
  PurchaseOrderLineInput,
  PurchaseOrderListItem,
  ReceivePurchaseOrderInput,
  SupplierContactInput,
  SupplierDetail,
  SupplierInput,
  SupplierItemInput,
  SupplierListItem,
  SupplierSuggestion,
  UrlRedirect,
  UrlRedirectInput,
  UrlRedirectList,
  RedirectImportReport,
  NotFoundLogList,
  ShopifyImportOptions,
  ShopifyImportReport,
  TaxClassInput,
  MetafieldDefinition,
  MetafieldDefinitionInput,
  MetafieldEntry,
  MetafieldOwnerType,
  MetafieldValidation,
  Template,
  TemplateRules,
  TemplateType,
  Discount,
  DiscountInput,
  DraftOrder,
  DraftOrderInput,
  ValidateDiscountResult,
  CustomerDetail,
  CustomerTag,
  CustomerTagWithCount,
  CustomerNote,
  CustomerConsent,
  CustomerSegment,
  ConsentChannel,
  ConsentStatus,
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
  CreditNote,
  CreditNoteReason,
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
  PaginatedNewsletterSubscribers,
  PaginatedReviews,
  MarginDimension,
  MarginRow,
  MarginSummary,
  PrepTimeReport,
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
  SliderSettings,
  SliderQuote,
  WebhookEvent,
  WhatsAppSettings,
  AnalyticsSettings,
  AnalyticsSettingsUpdate,
  AttributionModel,
  AttributionReport,
  PaginatedAuditLog,
  PaginatedStockMovements,
  FailedJob,
  Shop,
  ShopDomainConfig,
  VerifyDomainResult,
  StockMovementType,
  ThemeSettings,
  Theme,
  ThemeListItem,
  ThemeTemplateMeta,
  ThemeConfig,


  InventoryMovementReport,
  TodaySnapshot,
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
// Information's "Your store is live at", the outlet QR code (printed for
// customers), TopBar's "View store" link and the theme builder's preview
// iframe. Mirrors the backend's resolveCanonicalOrigin: a custom domain
// counts only once its DNS-TXT ownership check has passed
// (customDomainStatus === 'verified'). Anything else (pending/verifying/
// failed, or a missing status) resolves to the shop's own
// {subdomain}.requital.io, because an unverified claimed domain is not served
// by us and may point at someone else's site. The Settings > Domain page does
// NOT use this: it shows the claimed domain beside its status badge straight
// from GET /shop/domain.
export function storefrontUrlFor(shop: {
  subdomain: string;
  domainType: "subdomain" | "custom";
  customDomain: string | null;
  customDomainStatus?: CustomDomainStatus | null;
}) {
  if (shop.domainType === "custom" && shop.customDomain && shop.customDomainStatus === "verified") {
    return `https://${shop.customDomain}`;
  }
  return `https://${shop.subdomain}.${STOREFRONT_ROOT_DOMAIN}`;
}
// Uploaded images are stored as paths relative to the backend
// (/uploads/products/..., /uploads/collections/...), but the admin app runs
// on its own origin/port — a bare relative <img src> resolves against the
// admin origin and 404s. Absolute URLs (seed data uses some) and blob:
// object-URLs (fresh local previews) are left untouched.
export function resolveImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith("/") ? `${API_URL}${path}` : path;
}

// Session-cookie migration (security audit finding #1), phase 2 — the
// staff access/refresh tokens are httpOnly cookies now, set by the backend
// on login/signup/refresh and never readable here. `credentials: "include"`
// (in apiFetch below) is what makes the browser send/accept them
// automatically; there is no client-side token left to get/set/clear.
//
// CSRF token distribution — held in memory, never localStorage (that would
// reintroduce the exact XSS-exposure problem this whole migration exists to
// close). Originally read via `document.cookie` off a non-httpOnly CSRF
// cookie; that only ever worked in local dev, where every app shares the
// bare `localhost` hostname (cookies aren't port-scoped) — in any real
// deployment admin.requital.io can never read a cookie set by
// api.requital.io via document.cookie, cookies don't cross hostnames
// regardless of the httpOnly attribute. The backend now instead echoes the
// token on the X-CSRF-Token *response* header of every request that mints
// or refreshes one (login/signup/refresh/accept-invite, and me() below) —
// see backend common/csrf.ts's own CSRF_RESPONSE_HEADER comment, and
// lib/platform-api.ts's identical mechanism for the platform tier.
let staffCsrfToken: string | null = null;

// Exported for the one call site that can't go through apiFetch itself —
// useThemeEditor.ts's beforeunload/pagehide flush, a raw fetch(keepalive)
// call that still needs the CSRF header attached by hand.
export function getStaffCsrfToken(): string | null {
  return staffCsrfToken;
}

// clearTokens() used to be what told AuthProvider's `user` state the
// session just died on a 401 (both the access token and its refresh
// attempt rejected). There's no local token to clear anymore, but the same
// signal is still needed — RequireAuth's `if (!user) redirect to /login`
// logic still depends on `user` flipping to null immediately, not staying
// stale-truthy until a manual reload happens to re-run AuthProvider's mount
// check. AuthProvider subscribes to this directly now.
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
    // Stable machine-readable reason some endpoints add (for example
    // "mfa_locked", "mfa_enrollment_required"). Absent on most errors.
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The access token is short-lived (15min) by design — this is the shared
// in-flight refresh so N requests that all 401 around the same moment
// trigger exactly one POST /auth/refresh (and one rotation), not N racing
// attempts to redeem the same refresh token, which would trip the backend's
// reuse-detection and log the whole session out over a false alarm. No
// tokens to return anymore — cookies are set directly by the response, so
// this just resolves once that's done.
let refreshPromise: Promise<void> | null = null;

async function refreshAccessToken(): Promise<void> {
  if (!refreshPromise) {
    // The (still-present, if not yet expired) access cookie is what makes
    // this a CSRF-checked request server-side (see backend's
    // skipIfNoAccessCookie) even though the access token itself may be
    // dead — same double-submit header every other non-GET call attaches.
    refreshPromise = fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "X-CSRF-Token": staffCsrfToken ?? "",
      },
    })
      .then((res) => {
        const freshCsrfToken = res.headers.get("X-CSRF-Token");
        if (freshCsrfToken) staffCsrfToken = freshCsrfToken;
        if (!res.ok) throw new ApiError("Refresh failed", res.status);
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
  const method = (init?.method ?? "GET").toUpperCase();
  const csrfToken = method !== "GET" && method !== "HEAD" ? staffCsrfToken : null;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...init?.headers,
    },
  });
  const freshCsrfToken = res.headers.get("X-CSRF-Token");
  if (freshCsrfToken) staffCsrfToken = freshCsrfToken;
  if (!res.ok) {
    // A 401 on anything other than the refresh call itself means the access
    // token expired mid-session (expected — it only lives 15min) — try a
    // silent refresh and retry this request exactly once before giving up.
    // Only after the refresh attempt *also* fails do we notify listeners and
    // let the next render's auth check redirect to /login.
    if (res.status === 401 && !isRetry && path !== "/auth/refresh") {
      try {
        await refreshAccessToken();
        return apiFetch<T>(path, init, true);
      } catch {
        notifyUnauthorized();
      }
    } else if (res.status === 401) {
      notifyUnauthorized();
    }
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.message ?? `Request failed (${res.status})`, res.status, body?.code);
  }
  if (res.status === 204) return undefined as T;
  // A 200 with an empty body (no Content-Length, or 0) isn't valid JSON —
  // res.json() throws "Unexpected end of JSON input" on it. Read as text
  // first and only parse if there's actually something there.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// Twin of apiFetch above for the one endpoint that returns text/html rather
// than JSON (the invoice HTML preview) — same cookie/401-refresh-retry
// contract, just without the JSON parse apiFetch always does on its
// response body.
async function apiFetchText(path: string, isRetry = false): Promise<string> {
  const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
  if (!res.ok) {
    if (res.status === 401 && !isRetry) {
      try {
        await refreshAccessToken();
        return apiFetchText(path, true);
      } catch {
        notifyUnauthorized();
      }
    } else if (res.status === 401) {
      notifyUnauthorized();
    }
    throw new ApiError(`Request failed (${res.status})`, res.status);
  }
  return res.text();
}

// ANL-11: pulls a report from the server's streaming CSV endpoint and hands it
// to the browser as a download. Same cookie / 401-refresh-retry contract as
// apiFetch and apiFetchText above.
//
// The server streams; this buffers the whole response into a Blob before
// saving, which is the trade for keeping auth handling identical to every
// other call. The point of the server endpoint is that the FILE contains every
// row rather than whichever page was on screen - the old in-page exporters
// could only ever serialise the rows React had already loaded. Streaming still
// matters on the server side, where a 50k-row export must not be built as one
// string in memory.
export function getTodaySnapshot(outletId?: number) {
  const query = outletId ? `?outletId=${outletId}` : "";
  return apiFetch<TodaySnapshot>(`/dashboard/today${query}`);
}

export function getInventoryMovement(params: {
  days?: number;
  deadStockDays?: number;
  outletId?: number;
} = {}) {
  const query = new URLSearchParams();
  if (params.days) query.set("days", String(params.days));
  if (params.deadStockDays) query.set("deadStockDays", String(params.deadStockDays));
  if (params.outletId) query.set("outletId", String(params.outletId));
  const qs = query.toString();
  return apiFetch<InventoryMovementReport>(`/reports/inventory/movement${qs ? `?${qs}` : ""}`);
}

export async function downloadExport(
  kind: string,
  params: Record<string, string | number | undefined> = {},
  isRetry = false,
): Promise<void> {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const res = await fetch(
    `${API_URL}/exports/${encodeURIComponent(kind)}${query ? `?${query}` : ""}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    if (res.status === 401 && !isRetry) {
      try {
        await refreshAccessToken();
        return downloadExport(kind, params, true);
      } catch {
        notifyUnauthorized();
      }
    } else if (res.status === 401) {
      notifyUnauthorized();
    }
    throw new ApiError(`Export failed (${res.status})`, res.status);
  }

  // Prefer the server's own filename (it carries the report name and date) and
  // fall back only if the header is missing.
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `${kind}-${new Date().toISOString().slice(0, 10)}.csv`;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Password step. When the account has two-factor on, there is NO session yet:
// the response is a short-lived pending token for loginMfa() instead.
export function login(email: string, password: string) {
  return apiFetch<{ user: AuthUser } | { mfaRequired: true; mfaToken: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function loginMfa(mfaToken: string, code: string) {
  return apiFetch<{ user: AuthUser }>("/auth/login/mfa", {
    method: "POST",
    body: JSON.stringify({ mfaToken, code }),
  });
}

// STF-3: own second factor + the shop-wide requirement.
export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  const s = await apiFetch<Omit<TwoFactorStatus, "required"> & { shopRequired: boolean }>("/auth/2fa");
  return { enabled: s.enabled, pendingEnrollment: s.pendingEnrollment, recoveryCodesRemaining: s.recoveryCodesRemaining, required: s.shopRequired };
}

export function startTwoFactorEnrollment(currentPassword: string) {
  return apiFetch<{ secret: string; otpauthUri: string }>("/auth/2fa/enroll/start", {
    method: "POST",
    body: JSON.stringify({ currentPassword }),
  });
}

export function confirmTwoFactorEnrollment(code: string) {
  return apiFetch<{ recoveryCodes: string[] }>("/auth/2fa/enroll/confirm", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function disableTwoFactor(code: string) {
  return apiFetch<{ success: boolean }>("/auth/2fa/disable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function regenerateRecoveryCodes(currentPassword: string, code: string) {
  return apiFetch<{ recoveryCodes: string[] }>("/auth/2fa/recovery-codes", {
    method: "POST",
    body: JSON.stringify({ currentPassword, code }),
  });
}

export function setShopTwoFactorPolicy(required: boolean, code?: string) {
  return apiFetch<{ shopRequired: boolean }>("/auth/2fa/shop-policy", {
    method: "PUT",
    body: JSON.stringify(code ? { required, code } : { required }),
  });
}

export function resetUserTwoFactor(userId: number) {
  return apiFetch<{ success: boolean }>(`/auth/2fa/users/${userId}/reset`, { method: "POST" });
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
  return apiFetch<{ user: AuthUser; devVerificationLink?: string }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// httpOnly cookies can't be cleared by client JS — this is a real network
// call now, not a synchronous local-storage removal (see auth-context.tsx's
// own logout, which awaits this before assuming the session is gone).
// Best-effort: caught by the caller so a network failure here doesn't block
// logging out locally.
export function logout() {
  return apiFetch<{ success: boolean }>("/auth/logout", { method: "POST" }).catch(
    () => undefined,
  );
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
  return apiFetch<{ user: AuthUser }>("/auth/accept-invite", {
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

// STF-4: active sessions. `userId` (admin only) lists a colleague's sessions.
export function listSessions(userId?: number) {
  return apiFetch<StaffSession[]>(`/auth/sessions${userId ? `?userId=${userId}` : ""}`);
}

export function revokeSession(id: string) {
  return apiFetch<{ success: boolean }>(`/auth/sessions/${id}`, { method: "DELETE" });
}

export function revokeOtherSessions() {
  return apiFetch<{ success: boolean; revoked: number }>("/auth/sessions", { method: "DELETE" });
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

export function getRegions() {
  return apiFetch<RegionsResponse>("/regions");
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
  regionId?: number;
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
  regionIds?: number[];
}

export function getZoneMappingProposal(outletId: number) {
  return apiFetch<ZoneMappingProposal>(`/outlets/${outletId}/delivery-zones/mapping-proposal`);
}

// Saves the zone's region set AND marks it reviewed.
export function setZoneMapping(outletId: number, zoneId: number, regionIds: number[]) {
  return apiFetch<DeliveryZone>(`/outlets/${outletId}/delivery-zones/${zoneId}/mapping`, {
    method: "PUT",
    body: JSON.stringify({ regionIds }),
  });
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

// Runs the DNS-TXT ownership check for the shop's current custom-domain claim
// right now (Settings > Domain's "Verify now"). Throws ApiError with status 409
// when the domain has been verified by another account.
export function verifyShopDomain() {
  return apiFetch<VerifyDomainResult>("/shop/domain/verify", { method: "POST" });
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

export function createTheme(data: { name: string; duplicateFromId?: number; fromTemplate?: string }) {
  return apiFetch<Theme>("/themes", { method: "POST", body: JSON.stringify(data) });
}

// Phase G0 — the built-in starter templates for the library picker (preview
// metadata only; the full config only ever exists server-side).
export function listThemeTemplates() {
  return apiFetch<ThemeTemplateMeta[]>("/themes/templates");
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

// Session-cookie migration (security audit finding #1), phase 2 —
// PreviewFrame.tsx used to embed this staff member's own real access token
// (read straight out of localStorage) in the storefront preview iframe's
// URL. It's an httpOnly cookie now and can't be read into a URL at all, so
// this mints a separate, narrow, short-lived theme_preview token instead —
// see ThemesService.issuePreviewToken's own comment for the full reasoning.
export function getThemePreviewToken(id: number) {
  return apiFetch<{ previewToken: string }>(`/themes/${id}/preview-token`, {
    method: "POST",
  });
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

// MKT-4 analytics & pixels. The Meta token is write-only: send it to set or
// replace it (null clears it); it is never returned.
export function getAnalyticsSettings() {
  return apiFetch<AnalyticsSettings>("/analytics-settings");
}

export function updateAnalyticsSettings(data: AnalyticsSettingsUpdate) {
  return apiFetch<AnalyticsSettings>("/analytics-settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// MKT-14: orders and revenue by source / medium / campaign.
export function getAttributionReport(filters: ReportsFilters, model: AttributionModel) {
  const query = reportsFilterQuery(filters);
  query.set("model", model);
  return apiFetch<AttributionReport>(`/reports/attribution?${query.toString()}`);
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

// Sends a real WhatsApp message via this shop's own configured credentials,
// so a merchant can verify them without waiting for a real order.
export function sendWhatsAppTestMessage(phoneNumber: string) {
  return apiFetch<{ sent: boolean }>("/whatsapp-settings/test", {
    method: "POST",
    body: JSON.stringify({ phoneNumber }),
  });
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
  orders: { id: number; shopOrderNumber: number; customerName: string; status: string; total: string }[];
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

export function collectCash(id: number) {
  return apiFetch<Order>(`/orders/${id}/collect-cash`, { method: "POST" });
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

export function listCreditNotesForOrder(orderId: number) {
  return apiFetch<CreditNote[]>(`/credit-notes?orderId=${orderId}`);
}

export function issueCreditNote(input: {
  orderId: number;
  reason: CreditNoteReason;
  returnId?: number;
}) {
  return apiFetch<CreditNote>("/credit-notes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCreditNoteHtml(id: number) {
  return apiFetchText(`/credit-notes/${id}/pdf`);
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

// ONB-1: the Shopify column mapper on the same stateless preview/confirm pair.
// Confirm re-uploads the file and the server re-parses and re-validates it.
function shopifyImportQuery(options: ShopifyImportOptions) {
  const qs = new URLSearchParams({ source: "shopify", onExisting: options.onExisting });
  if (options.collectionId) qs.set("collectionId", String(options.collectionId));
  if (options.outletId) qs.set("outletId", String(options.outletId));
  return qs.toString();
}

export function previewShopifyImport(file: File, options: ShopifyImportOptions) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<ShopifyImportReport>(`/products/import/preview?${shopifyImportQuery(options)}`, {
    method: "POST",
    body: formData,
  });
}

export function confirmShopifyImport(file: File, options: ShopifyImportOptions) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ created: number; updated: number; skipped: number; errors: number; report: ShopifyImportReport }>(
    `/products/import/confirm?${shopifyImportQuery(options)}`,
    { method: "POST", body: formData },
  );
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

export function listBrands() {
  return apiFetch<Brand[]>("/brands");
}

export function uploadBrandImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/brands/upload", {
    method: "POST",
    body: formData,
  });
}

export function createBrand(data: BrandInput) {
  return apiFetch<Brand>("/brands", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateBrand(id: number, data: Partial<BrandInput>) {
  return apiFetch<Brand>(`/brands/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteBrand(id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/brands/${id}`, {
    method: "DELETE",
  });
}

export function listTaxClasses() {
  return apiFetch<TaxClass[]>("/tax-classes");
}

export function createTaxClass(data: TaxClassInput) {
  return apiFetch<TaxClass>("/tax-classes", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateTaxClass(id: number, data: Partial<TaxClassInput>) {
  return apiFetch<TaxClass>(`/tax-classes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// Returns how many products were unassigned, which is the one consequence the
// list view cannot show.
export function deleteTaxClass(id: number) {
  return apiFetch<{ id: number; deleted: boolean; productsUnassigned: number }>(
    `/tax-classes/${id}`,
    { method: "DELETE" },
  );
}

export function listMetafieldDefinitions(ownerType?: MetafieldOwnerType) {
  return apiFetch<MetafieldDefinition[]>(
    `/metafield-definitions${ownerType ? `?ownerType=${ownerType}` : ""}`,
  );
}

export function createMetafieldDefinition(data: MetafieldDefinitionInput) {
  return apiFetch<MetafieldDefinition>("/metafield-definitions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// Type, owner and key are fixed at creation, so they are not editable here.
export function updateMetafieldDefinition(
  id: number,
  data: {
    name?: string;
    validation?: MetafieldValidation;
    displayOrder?: number;
    visibleOnStorefront?: boolean;
  },
) {
  return apiFetch<MetafieldDefinition>(`/metafield-definitions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// A definition that still has values answers 409; deleteValues removes them in
// the same step.
export function deleteMetafieldDefinition(id: number, deleteValues = false) {
  return apiFetch<{ id: number; deleted: boolean; valuesDeleted: number }>(
    `/metafield-definitions/${id}${deleteValues ? "?deleteValues=true" : ""}`,
    { method: "DELETE" },
  );
}

export function getMetafields(ownerType: MetafieldOwnerType, ownerId: number) {
  return apiFetch<MetafieldEntry[]>(`/metafields/${ownerType}/${ownerId}`);
}

// A null value clears that field for the record.
export function setMetafields(
  ownerType: MetafieldOwnerType,
  ownerId: number,
  values: { definitionId: number; value: unknown }[],
) {
  return apiFetch<MetafieldEntry[]>(`/metafields/${ownerType}/${ownerId}`, {
    method: "PUT",
    body: JSON.stringify({ values }),
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
  tagId?: number;
  segmentId?: number;
}

// Admin-only endpoint server-side — see backend CustomersController.
export function listCustomers(params: ListCustomersParams = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);
  if (params.sortBy) query.set("sortBy", params.sortBy);
  if (params.sortDir) query.set("sortDir", params.sortDir);
  if (params.tagId) query.set("tagId", String(params.tagId));
  if (params.segmentId) query.set("segmentId", String(params.segmentId));
  return apiFetch<PaginatedCustomers>(`/customers?${query.toString()}`);
}

export interface ListNewsletterSubscribersParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

// Admin + viewer server-side (see backend NewsletterController). The matching
// write is the public storefront widget, not an admin action - there is no
// create/delete here on purpose.
export function listNewsletterSubscribers(params: ListNewsletterSubscribersParams = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);
  return apiFetch<PaginatedNewsletterSubscribers>(`/newsletter-subscribers?${query.toString()}`);
}

// Admin-only server-side (see backend ReviewsController).
export function listReviews(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  return apiFetch<PaginatedReviews>(`/reviews?${query.toString()}`);
}

export function setReviewFeatured(id: number, featured: boolean) {
  return apiFetch<{ id: number; featured: boolean }>(`/reviews/${id}/featured`, {
    method: "PATCH",
    body: JSON.stringify({ featured }),
  });
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

// Gross margin from the cost captured at order time (orderitem.unitCost).
// Two calls, not one: the stat cards want a single total and the table wants
// a grouping, and a page should not fetch a breakdown it is not showing.
export function getMarginSummary(filters: ReportsFilters) {
  return apiFetch<MarginSummary>(`/reports/margin/summary?${reportsFilterQuery(filters).toString()}`);
}

export function getMarginBreakdown(filters: ReportsFilters, dimension: MarginDimension) {
  const query = reportsFilterQuery(filters);
  query.set("dimension", dimension);
  return apiFetch<MarginRow[]>(`/reports/margin/breakdown?${query.toString()}`);
}

// NOV-12 prep-time truth: what orders actually took, next to the configured
// constant. Same filter bar as every other report.
export function getPrepTimeReport(filters: ReportsFilters) {
  return apiFetch<PrepTimeReport>(`/reports/prep-time?${reportsFilterQuery(filters).toString()}`);
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

// Manual courier-handoff log — for a courier with no real API integration
// (see the Slider functions below for the one that has one). Admin-only
// server-side.
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

// --- Slider delivery — real courier API integration, see backend
// delivery-providers/. Settings are admin-only; quote/dispatch/cancel are
// reachable by the same roles as every other order-mutation route
// (admin/branch/order_manager). ---

export function getSliderSettings() {
  return apiFetch<SliderSettings>("/slider-settings");
}

// The only thing a merchant can change — Slider's account id is set by a
// platform admin (they have no access to Slider's own dashboard), see
// CLAUDE.md.
export function setSliderEnabled(enabled: boolean) {
  return apiFetch<SliderSettings>("/slider-settings", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export function getSliderQuote(orderId: number) {
  return apiFetch<SliderQuote>(`/orders/${orderId}/slider-delivery/quote`, { method: "POST" });
}

export function dispatchSliderDelivery(
  orderId: number,
  data: { vehicleType: "bike" | "car" | "any"; scheduleAt?: string; driverTip?: number },
) {
  return apiFetch<Order>(`/orders/${orderId}/slider-delivery`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function cancelSliderDelivery(orderId: number) {
  return apiFetch<Order>(`/orders/${orderId}/slider-delivery`, { method: "DELETE" });
}

// Integrations > Incoming Webhooks — read-only diagnostics, last 20 for this shop.
export function getWebhookLog() {
  return apiFetch<WebhookEvent[]>("/webhook-log");
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
  // The cart's lines; the server prices them so a scoped code's amount is
  // the amount charged.
  items?: { productId: number; variantId?: number; quantity: number; priceOverride?: number }[];
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

// ---- Suppliers (INV-1) ----

export function listSuppliers(status?: "active" | "archived") {
  return apiFetch<SupplierListItem[]>(`/suppliers${status ? `?status=${status}` : ""}`);
}

export function getSupplier(id: number) {
  return apiFetch<SupplierDetail>(`/suppliers/${id}`);
}

export function createSupplier(data: SupplierInput) {
  return apiFetch<SupplierDetail>("/suppliers", { method: "POST", body: JSON.stringify(data) });
}

export function updateSupplier(id: number, data: SupplierInput) {
  return apiFetch<SupplierDetail>(`/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteSupplier(id: number) {
  return apiFetch<{ id: number; deleted: boolean; archived: boolean }>(`/suppliers/${id}`, { method: "DELETE" });
}

export function addSupplierContact(id: number, data: SupplierContactInput) {
  return apiFetch<SupplierDetail>(`/suppliers/${id}/contacts`, { method: "POST", body: JSON.stringify(data) });
}

export function updateSupplierContact(id: number, contactId: number, data: SupplierContactInput) {
  return apiFetch<SupplierDetail>(`/suppliers/${id}/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteSupplierContact(id: number, contactId: number) {
  return apiFetch<SupplierDetail>(`/suppliers/${id}/contacts/${contactId}`, { method: "DELETE" });
}

export function saveSupplierItem(id: number, ingredientId: number, data: SupplierItemInput) {
  return apiFetch<SupplierDetail>(`/suppliers/${id}/items/${ingredientId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteSupplierItem(id: number, ingredientId: number) {
  return apiFetch<SupplierDetail>(`/suppliers/${id}/items/${ingredientId}`, { method: "DELETE" });
}

export function listSupplierSuggestions() {
  return apiFetch<SupplierSuggestion[]>("/suppliers/suggestions/free-text");
}

// ---- Purchase orders (INV-2) ----

export function listPurchaseOrders(params: { status?: string; supplierId?: number; outletId?: number; page?: number; pageSize?: number }) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") search.set(k, String(v));
  const query = search.toString();
  return apiFetch<{ data: PurchaseOrderListItem[]; page: number; pageSize: number; total: number }>(
    `/purchase-orders${query ? `?${query}` : ""}`,
  );
}

export function getPurchaseOrder(id: number) {
  return apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}`);
}

export function createPurchaseOrder(data: PurchaseOrderInput) {
  return apiFetch<PurchaseOrderDetail>("/purchase-orders", { method: "POST", body: JSON.stringify(data) });
}

export function updatePurchaseOrder(id: number, data: { expectedAt?: string | null; notes?: string | null }) {
  return apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function replacePurchaseOrderLines(id: number, lines: PurchaseOrderLineInput[]) {
  return apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}/lines`, {
    method: "PUT",
    body: JSON.stringify({ lines }),
  });
}

export function sendPurchaseOrder(id: number) {
  return apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}/send`, { method: "POST" });
}

export function cancelPurchaseOrder(id: number) {
  return apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}/cancel`, { method: "POST" });
}

export function receivePurchaseOrder(id: number, data: ReceivePurchaseOrderInput) {
  return apiFetch<{ receiptId: number; replayed: boolean; purchaseOrder: PurchaseOrderDetail }>(
    `/purchase-orders/${id}/receive`,
    { method: "POST", body: JSON.stringify(data) },
  );
}

// ---- URL redirects and the 404 report (ONB-4) ----

export function listUrlRedirects(params: { search?: string; sort?: "hits" | "recent"; page?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.sort) qs.set("sort", params.sort);
  if (params.page) qs.set("page", String(params.page));
  const query = qs.toString();
  return apiFetch<UrlRedirectList>(`/url-redirects${query ? `?${query}` : ""}`);
}

export function createUrlRedirect(data: UrlRedirectInput) {
  return apiFetch<UrlRedirect>("/url-redirects", { method: "POST", body: JSON.stringify(data) });
}

export function updateUrlRedirect(id: number, data: Partial<UrlRedirectInput>) {
  return apiFetch<UrlRedirect>(`/url-redirects/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteUrlRedirect(id: number) {
  return apiFetch<{ deleted: boolean }>(`/url-redirects/${id}`, { method: "DELETE" });
}

// Same stateless pair as the product import: confirm re-uploads the file and
// the server re-validates it, nothing from the preview is trusted.
export function previewUrlRedirectImport(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<RedirectImportReport>("/url-redirects/import/preview", { method: "POST", body: formData });
}

export function confirmUrlRedirectImport(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<RedirectImportReport>("/url-redirects/import/confirm", { method: "POST", body: formData });
}

export function listNotFoundLog(params: { search?: string; sort?: "hits" | "recent"; page?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.sort) qs.set("sort", params.sort);
  if (params.page) qs.set("page", String(params.page));
  const query = qs.toString();
  return apiFetch<NotFoundLogList>(`/url-redirects/not-found-log${query ? `?${query}` : ""}`);
}

export function dismissNotFoundEntry(id: number) {
  return apiFetch<{ deleted: boolean }>(`/url-redirects/not-found-log/${id}`, { method: "DELETE" });
}

export function clearNotFoundLog() {
  return apiFetch<{ cleared: number }>("/url-redirects/not-found-log", { method: "DELETE" });
}

// ---- Customer CRM: tags, notes, consent (CUS-2 / CUS-3 / CUS-11) ----
// Reads are admin + viewer server-side, writes admin only; branch and
// order_manager have no access to any of it.
export function listCustomerTags() {
  return apiFetch<CustomerTagWithCount[]>("/customer-tags");
}

export function createCustomerTag(data: { name: string; color?: string }) {
  return apiFetch<CustomerTagWithCount>("/customer-tags", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateCustomerTag(id: number, data: { name?: string; color?: string }) {
  return apiFetch<CustomerTag>(`/customer-tags/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteCustomerTag(id: number) {
  return apiFetch<{ deleted: boolean }>(`/customer-tags/${id}`, { method: "DELETE" });
}

export function assignCustomerTags(customerIds: number[], tagIds: number[]) {
  return apiFetch<{ customers: number }>("/customer-tags/assign", {
    method: "POST",
    body: JSON.stringify({ customerIds, tagIds }),
  });
}

export function unassignCustomerTags(customerIds: number[], tagIds: number[]) {
  return apiFetch<{ removed: number }>("/customer-tags/unassign", {
    method: "POST",
    body: JSON.stringify({ customerIds, tagIds }),
  });
}

export function getCustomerTags(customerId: number) {
  return apiFetch<CustomerTag[]>(`/customers/${customerId}/tags`);
}

export function listCustomerNotes(customerId: number) {
  return apiFetch<CustomerNote[]>(`/customers/${customerId}/notes`);
}

export function addCustomerNote(customerId: number, body: string) {
  return apiFetch<CustomerNote>(`/customers/${customerId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function deleteCustomerNote(customerId: number, noteId: number) {
  return apiFetch<{ deleted: boolean }>(`/customers/${customerId}/notes/${noteId}`, {
    method: "DELETE",
  });
}

export function getCustomerConsent(customerId: number) {
  return apiFetch<CustomerConsent>(`/customers/${customerId}/consent`);
}

export function recordCustomerConsent(
  customerId: number,
  data: { channel: ConsentChannel; status: ConsentStatus; note?: string },
) {
  return apiFetch<CustomerConsent>(`/customers/${customerId}/consent`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ---- Customer segments (CUS-1). Reads admin + viewer, writes admin only. ----
export function listCustomerSegments() {
  return apiFetch<CustomerSegment[]>("/customer-segments");
}

export function createCustomerSegment(data: { name: string; rules: unknown }) {
  return apiFetch<CustomerSegment>("/customer-segments", { method: "POST", body: JSON.stringify(data) });
}

export function updateCustomerSegment(id: number, data: { name: string; rules: unknown }) {
  return apiFetch<CustomerSegment>(`/customer-segments/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteCustomerSegment(id: number) {
  return apiFetch<{ deleted: boolean }>(`/customer-segments/${id}`, { method: "DELETE" });
}

export function previewCustomerSegment(rules: unknown) {
  return apiFetch<{ count: number }>("/customer-segments/preview", { method: "POST", body: JSON.stringify({ rules }) });
}
