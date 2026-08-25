// Platform-admin API client — deliberately separate from lib/api.ts's
// merchant client. Own token storage key, own fetch wrapper, no refresh-
// token dance (platform sessions are a single 12h token, see
// PlatformAuthService). Never imports or touches the merchant
// ACCESS_TOKEN_KEY/REFRESH_TOKEN_KEY — the two auth spaces must stay
// structurally incapable of bleeding into each other on the frontend too,
// matching the backend's separate JWT scope.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const PLATFORM_TOKEN_KEY = "requital_platform_access_token";

export function getPlatformToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PLATFORM_TOKEN_KEY);
}

export function setPlatformToken(token: string) {
  localStorage.setItem(PLATFORM_TOKEN_KEY, token);
}

export function clearPlatformToken() {
  localStorage.removeItem(PLATFORM_TOKEN_KEY);
}

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
  const token = getPlatformToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // 404 here can mean either "route genuinely not found" or "not
    // authenticated" (PlatformAdminGuard collapses both — see CLAUDE.md).
    // Either way the session is unusable; treat it the same as a real 401.
    if (res.status === 401 || res.status === 404) {
      clearPlatformToken();
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
  return platformFetch<{ accessToken: string; admin: PlatformAdmin }>(
    "/platform-auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
  );
}

export function platformMe() {
  return platformFetch<PlatformAdmin>("/platform-auth/me");
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

export interface ImpersonationSession {
  accessToken: string;
  refreshToken: string | null;
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
