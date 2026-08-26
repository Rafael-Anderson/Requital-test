// Platform-admin API client — deliberately separate from lib/api.ts's
// merchant client. Own fetch wrapper, no refresh-token dance (platform
// sessions are a single 12h token, see PlatformAuthService). Never imports
// or touches merchant auth state — the two auth spaces must stay
// structurally incapable of bleeding into each other on the frontend too,
// matching the backend's separate JWT scope and separate cookie name.
//
// Session-cookie migration (security audit finding #1): the access token
// itself is an httpOnly cookie now, set by the backend on login and never
// readable here — there is no client-side token to store, read, or clear.
// `credentials: "include"` is what makes the browser send it automatically
// on every request to API_URL; see main.ts's CORS `credentials: true` for
// the other half of that.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// CSRF token distribution — held in memory, never localStorage (that would
// reintroduce the exact XSS-exposure problem this whole migration exists to
// close). Originally read via `document.cookie` off a non-httpOnly CSRF
// cookie; that only ever worked in local dev, where every app shares the
// bare `localhost` hostname (cookies aren't port-scoped) — in any real
// deployment admin.requital.io can never read a cookie set by
// api.requital.io via document.cookie, cookies don't cross hostnames
// regardless of the httpOnly attribute. The backend now instead echoes the
// token on the X-CSRF-Token *response* header of every request that mints
// or refreshes one (login, and platformMe() below) — see backend
// common/csrf.ts's own CSRF_RESPONSE_HEADER comment. main.ts's CORS
// `exposedHeaders` is what makes a custom response header readable by
// fetch() at all cross-origin.
let platformCsrfToken: string | null = null;

export class PlatformApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "PlatformApiError";
  }
}

let unauthorizedListeners: Array<() => void> = [];
export function onPlatformUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.push(listener);
  return () => {
    unauthorizedListeners = unauthorizedListeners.filter((l) => l !== listener);
  };
}

async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  // The double-submit CSRF header is only attached for state-changing
  // requests — a GET can't be forged into doing anything, and there's no
  // token yet on the very first request of a session anyway.
  const csrfToken =
    method !== "GET" && method !== "HEAD" ? platformCsrfToken : null;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...init?.headers,
    },
  });
  const freshCsrfToken = res.headers.get("X-CSRF-Token");
  if (freshCsrfToken) platformCsrfToken = freshCsrfToken;
  if (!res.ok) {
    // 404 here can mean either "route genuinely not found" or "not
    // authenticated" (PlatformAdminGuard collapses both — see CLAUDE.md).
    // Either way the session is unusable; treat it the same as a real 401.
    // Nothing local to clear anymore — the httpOnly cookie can only be
    // cleared server-side (see platformLogout) — just notify listeners so
    // AuthProvider-equivalent state flips to logged-out.
    if (res.status === 401 || res.status === 404) {
      unauthorizedListeners.forEach((l) => l());
    }
    const errBody = await res.json().catch(() => null);
    throw new PlatformApiError(
      errBody?.message ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface PlatformAdmin {
  id: number;
  email: string;
  name: string;
}

export function platformLogin(email: string, password: string) {
  return platformFetch<{ admin: PlatformAdmin }>("/platform-auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function platformMe() {
  return platformFetch<PlatformAdmin>("/platform-auth/me");
}

// httpOnly cookies can't be cleared by client JS — this is a real network
// call now, not a synchronous local-storage removal.
export function platformLogout() {
  return platformFetch<{ success: boolean }>("/platform-auth/logout", {
    method: "POST",
  });
}

export type ShopStatus = "active" | "suspended";

export interface PlatformShopListItem {
  id: number;
  name: string;
  subdomain: string;
  status: ShopStatus;
  published: boolean;
  createdAt: string;
  orderCount: number;
  lastActivityAt: string;
}

export interface PlatformShopDetail {
  id: number;
  name: string;
  subdomain: string;
  status: ShopStatus;
  published: boolean;
  createdAt: string;
  owner: { name: string; email: string; phone: string | null } | null;
  outlets: { id: number; name: string; active: boolean }[];
  orderCount: number;
  lastActivityAt: string;
  integrations: {
    slider: { enabled: boolean; accountId: string | null; status: string };
    paymentProviders: string[];
    whatsappConfigured: boolean;
  };
}

export function listPlatformShops(query: { q?: string; status?: ShopStatus }) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  const qs = params.toString();
  return platformFetch<PlatformShopListItem[]>(
    `/platform-admin/shops${qs ? `?${qs}` : ""}`,
  );
}

export function getPlatformShop(shopId: number) {
  return platformFetch<PlatformShopDetail>(`/platform-admin/shops/${shopId}`);
}

export function suspendShop(shopId: number) {
  return platformFetch<PlatformShopDetail>(`/platform-admin/shops/${shopId}/suspend`, {
    method: "POST",
  });
}

export function unsuspendShop(shopId: number) {
  return platformFetch<PlatformShopDetail>(
    `/platform-admin/shops/${shopId}/unsuspend`,
    { method: "POST" },
  );
}

// Session-cookie migration (security audit finding #1), phase 2 — the
// staff session cookies are set directly on this response now (see
// PlatformAdminController.impersonate); there's no token left in the body
// for the caller to do anything with beyond confirming success.
export interface ImpersonationSession {
  success: boolean;
  accessTokenExpiresIn: number;
}

export function impersonateShop(shopId: number) {
  return platformFetch<ImpersonationSession>(
    `/platform-admin/shops/${shopId}/impersonate`,
    { method: "POST" },
  );
}

export function setShopSliderAccountId(shopId: number, accountId: string) {
  return platformFetch(`/platform-admin/shops/${shopId}/slider-account-id`, {
    method: "PATCH",
    body: JSON.stringify({ accountId }),
  });
}

export interface SliderQuoteVehicle {
  vehicleType: string;
  deliveryFee: number;
  isAvailable: boolean;
  unavailableReason: string | null;
}

export function sliderTestDispatch(shopId: number) {
  return platformFetch<{
    distanceKm: number;
    durationMinutes: number;
    vehicles: SliderQuoteVehicle[];
  }>(`/platform-admin/shops/${shopId}/slider-test-dispatch`, { method: "POST" });
}

export interface PlatformSettings {
  envVars: { name: string; configured: boolean }[];
  webhookUrls: Record<string, string>;
}

export function getPlatformSettings() {
  return platformFetch<PlatformSettings>("/platform-admin/settings");
}

export interface PlatformWebhookEvent {
  id: number;
  shopId: number;
  source: string;
  eventType: string;
  result: "success" | "duplicate" | "rejected" | "failed";
  createdAt: string;
}

export function listPlatformWebhookLog(filters: {
  shopId?: number;
  source?: string;
  result?: string;
}) {
  const params = new URLSearchParams();
  if (filters.shopId) params.set("shopId", String(filters.shopId));
  if (filters.source) params.set("source", filters.source);
  if (filters.result) params.set("result", filters.result);
  const qs = params.toString();
  return platformFetch<PlatformWebhookEvent[]>(
    `/platform-admin/webhook-log${qs ? `?${qs}` : ""}`,
  );
}

export interface PlatformAuditLogEntry {
  id: number;
  platformAdminId: number;
  action: string;
  shopId: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export function listPlatformAuditLog(shopId?: number) {
  const qs = shopId ? `?shopId=${shopId}` : "";
  return platformFetch<PlatformAuditLogEntry[]>(`/platform-admin/audit-log${qs}`);
}
