import type {
  AbandonedCartItemInput,
  BioLink,
  BioPageConfig,
  Category,
  CollectionDetail,
  CollectionSummary,
  CreateOrderPayload,
  CreateOrderResponse,
  Customer,
  CustomerAddress,
  CustomerAuthResult,
  CustomerOrderSummary,
  DeliveryZone,
  OrderLookupResult,
  Outlet,
  PolicyPage,
  Product,
  Shop,
  SurveyLookupResult,
  ValidateDiscountResult,
  ValidateGiftCardResult,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Uploaded theme/product images are stored backend-relative (/uploads/...),
// but the storefront runs on its own origin (:3002) — a bare relative <img
// src> or Metadata icon URL resolves against the storefront origin and
// 404s. Same fix as admin/lib/api.ts's resolveImageUrl. Absolute URLs
// (seed/test data, or a merchant who pastes an external image URL) are left
// untouched.
export function resolveImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith("/") ? `${API_URL}${path}` : path;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, data: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      Array.isArray(body?.message) ? body.message.join(", ") : (body?.message ?? `Request failed (${res.status})`),
    );
  }
  return res.json() as Promise<T>;
}

export function getShop(shopSlug: string) {
  return get<Shop>(`/public/${shopSlug}`);
}

export function getPolicyPage(shopSlug: string, type: string) {
  return get<PolicyPage>(`/public/${shopSlug}/policy-pages/${type}`);
}

// Backs the platform-wide sitemap (app/sitemap.xml/route.ts) — not
// shop-scoped, so it doesn't go through /public/:shopSlug/....
export function listShopsForSitemap() {
  return get<{ slug: string; updatedAt: string }[]>(`/public/shops/sitemap`);
}

export function listCategories(shopSlug: string) {
  return get<Category[]>(`/public/${shopSlug}/categories`);
}

export function listCollections(shopSlug: string) {
  return get<CollectionSummary[]>(`/public/${shopSlug}/collections`);
}

export async function getCollection(shopSlug: string, slug: string, outletId?: number) {
  const qs = outletId !== undefined ? `?outletId=${outletId}` : "";
  const collection = await get<CollectionDetail>(`/public/${shopSlug}/collections/${slug}${qs}`);
  return { ...collection, products: collection.products.map(resolveProductImage) };
}

export function getBioLinks(shopSlug: string) {
  return get<BioLink[]>(`/public/${shopSlug}/bio-links`);
}

export function getBioPageConfig(shopSlug: string) {
  return get<BioPageConfig>(`/public/${shopSlug}/bio-page-config`);
}

// Every rendered bio-link href points here (not straight to the external
// URL / product page / social URL) so clicks are tracked server-side before
// the redirect — see backend PublicBioLinksController.
export function bioLinkClickUrl(id: number): string {
  return `${API_URL}/public/bio-links/${id}/click`;
}

// Resolved once here, at the single point products enter the app — every
// render site (grid/list cards, product detail, cart, which persists the
// thumbnail it's given into localStorage via addItem) just uses
// product.thumbnail directly rather than each needing its own
// resolveImageUrl call.
function resolveProductImage(p: Product): Product {
  return {
    ...p,
    thumbnail: resolveImageUrl(p.thumbnail) ?? p.thumbnail,
    images: (p.images ?? []).map((img) => ({ ...img, url: resolveImageUrl(img.url) ?? img.url })),
    variants: (p.variants ?? []).map((v) => ({ ...v, imageUrl: resolveImageUrl(v.imageUrl) })),
  };
}

export async function listProducts(
  shopSlug: string,
  outletId?: number,
  categoryId?: number,
  isCheckoutAddon?: boolean,
) {
  const params = new URLSearchParams();
  if (outletId !== undefined) params.set("outletId", String(outletId));
  if (categoryId !== undefined) params.set("categoryId", String(categoryId));
  if (isCheckoutAddon !== undefined) params.set("isCheckoutAddon", String(isCheckoutAddon));
  const qs = params.toString();
  const products = await get<Product[]>(`/public/${shopSlug}/products${qs ? `?${qs}` : ""}`);
  return products.map(resolveProductImage);
}

// Kept alongside getProductBySlug (not replaced by it) — the id-based
// product route still needs to resolve a product by id to find its slug
// and redirect, so old shared links don't break.
export async function getProduct(shopSlug: string, id: number, outletId?: number) {
  const qs = outletId !== undefined ? `?outletId=${outletId}` : "";
  const product = await get<Product>(`/public/${shopSlug}/products/${id}${qs}`);
  return resolveProductImage(product);
}

export async function getProductBySlug(shopSlug: string, slug: string, outletId?: number) {
  const qs = outletId !== undefined ? `?outletId=${outletId}` : "";
  const product = await get<Product>(`/public/${shopSlug}/products/slug/${slug}${qs}`);
  return resolveProductImage(product);
}

export function listOutlets(shopSlug: string) {
  return get<Outlet[]>(`/public/${shopSlug}/outlets`);
}

export function listDeliveryZones(shopSlug: string, outletId: number) {
  return get<DeliveryZone[]>(`/public/${shopSlug}/outlets/${outletId}/delivery-zones`);
}

export function geocode(shopSlug: string, query: string) {
  return get<{ latitude: number; longitude: number; displayName: string }>(
    `/public/${shopSlug}/geocode?q=${encodeURIComponent(query)}`,
  );
}

// MapPicker's pin-drag flow — lat/lng -> address.
export function reverseGeocode(shopSlug: string, latitude: number, longitude: number) {
  return get<{ displayName: string }>(`/public/${shopSlug}/reverse-geocode?lat=${latitude}&lon=${longitude}`);
}

export function createOrder(shopSlug: string, payload: CreateOrderPayload) {
  return post<CreateOrderResponse>(`/public/${shopSlug}/orders`, payload);
}

export function validateDiscount(
  shopSlug: string,
  data: { code: string; cartSubtotal: number; productIds?: number[]; categoryIds?: number[] },
) {
  return post<ValidateDiscountResult>(`/public/${shopSlug}/discounts/validate`, data);
}

export function validateGiftCard(shopSlug: string, code: string) {
  return post<ValidateGiftCardResult>(`/public/${shopSlug}/gift-cards/validate`, { code });
}

// Fired once name+phone are both filled in at checkout — see
// AbandonedCartsService.capture. Never surfaced to the shopper; call sites
// fire-and-forget this.
export function captureAbandonedCart(
  shopSlug: string,
  data: {
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    outletId?: number;
    cartItems: AbandonedCartItemInput[];
  },
) {
  return post<{ id: number }>(`/public/${shopSlug}/abandoned-carts`, data);
}

// Not shop-scoped — same reasoning as lookupOrder above (recoverToken is
// globally unique and self-sufficient).
export function recoverAbandonedCart(token: string) {
  return get<{ cartItems: AbandonedCartItemInput[]; outletId: number | null }>(
    `/public/abandoned-carts/recover?token=${encodeURIComponent(token)}`,
  );
}

// Not shop-scoped — the tracking token alone identifies the order (see
// backend PublicOrderLookupController), so this hits /public/orders/lookup
// directly rather than /public/:shopSlug/....
export function lookupOrder(token: string) {
  return get<OrderLookupResult>(`/public/orders/lookup?token=${encodeURIComponent(token)}`);
}

// Not shop-scoped — same reasoning as lookupOrder above (the token alone is
// globally unique and self-sufficient, see backend PublicSurveyController).
export function lookupSurvey(token: string) {
  return get<SurveyLookupResult>(`/public/surveys/lookup?token=${encodeURIComponent(token)}`);
}

export function submitSurvey(token: string, data: { rating: number; comment?: string }) {
  return post<{ success: boolean }>(`/public/surveys/submit?token=${encodeURIComponent(token)}`, data);
}

// --- Customer accounts ---
//
// Same per-shop-namespaced localStorage convention as lib/cart.tsx and
// lib/referral.ts (`requital_storefront_<thing>:${shopSlug}`) — a logged-in
// session on Shop A's storefront must never leak into Shop B's, same
// tenant-isolation guarantee those two already give the cart/referral code.
export interface StoredCustomerAuth {
  accessToken: string;
  refreshToken: string;
  customer: Customer;
}

function authStorageKey(shopSlug: string) {
  return `requital_storefront_auth:${shopSlug}`;
}

export function getStoredAuth(shopSlug: string): StoredCustomerAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(authStorageKey(shopSlug));
    return raw ? (JSON.parse(raw) as StoredCustomerAuth) : null;
  } catch {
    return null;
  }
}

export function setStoredAuth(shopSlug: string, auth: StoredCustomerAuth | null) {
  if (typeof window === "undefined") return;
  try {
    if (auth) localStorage.setItem(authStorageKey(shopSlug), JSON.stringify(auth));
    else localStorage.removeItem(authStorageKey(shopSlug));
  } catch {
    // corrupt/blocked storage — same guard as cart.tsx, nothing to do
  }
}

// Authenticated fetch wrapper — mirrors admin/lib/api.ts's apiFetch (bearer
// header injection + one silent refresh-and-retry on 401), scaled down to
// this app's simpler get/post shape rather than a full copy. Reads the
// token from localStorage directly (not React state) so plain functions
// like getMyOrders below don't need a hook/context to call.
async function authedFetch<T>(shopSlug: string, path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
  const stored = getStoredAuth(shopSlug);
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(stored ? { Authorization: `Bearer ${stored.accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401 && stored && !isRetry) {
    try {
      const refreshed = await post<CustomerAuthResult>(`/public/${shopSlug}/auth/refresh`, {
        refreshToken: stored.refreshToken,
      });
      setStoredAuth(shopSlug, refreshed);
      return authedFetch<T>(shopSlug, path, init, true);
    } catch {
      setStoredAuth(shopSlug, null);
      throw new Error("Your session has expired — please log in again");
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      Array.isArray(body?.message) ? body.message.join(", ") : (body?.message ?? `Request failed (${res.status})`),
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function registerCustomer(
  shopSlug: string,
  data: { name: string; phone: string; email?: string; password: string },
) {
  return post<CustomerAuthResult>(`/public/${shopSlug}/auth/register`, data);
}

export function loginCustomer(shopSlug: string, data: { identifier: string; password: string }) {
  return post<CustomerAuthResult>(`/public/${shopSlug}/auth/login`, data);
}

// Clears the local session either way, even if the server call fails (a
// network hiccup shouldn't leave the storefront looking logged-in) — same
// best-effort-server-call-but-always-clear-locally reasoning as the admin
// app's own logout (see admin/lib/api.ts's logout).
export async function logoutCustomer(shopSlug: string) {
  const stored = getStoredAuth(shopSlug);
  if (stored) {
    await post(`/public/${shopSlug}/auth/logout`, { refreshToken: stored.refreshToken }).catch(() => undefined);
  }
  setStoredAuth(shopSlug, null);
}

export function forgotCustomerPassword(shopSlug: string, email: string) {
  return post<{ success: boolean; devResetLink?: string }>(`/public/${shopSlug}/auth/forgot-password`, { email });
}

export function resetCustomerPassword(shopSlug: string, token: string, newPassword: string) {
  return post<{ success: boolean }>(`/public/${shopSlug}/auth/reset-password`, { token, newPassword });
}

export function getMyProfile(shopSlug: string) {
  return authedFetch<Customer>(shopSlug, `/public/${shopSlug}/account/profile`);
}

export function updateMyProfile(shopSlug: string, data: Partial<{ name: string; email: string; phone: string }>) {
  return authedFetch<Customer>(shopSlug, `/public/${shopSlug}/account/profile`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function getMyOrders(shopSlug: string) {
  return authedFetch<CustomerOrderSummary[]>(shopSlug, `/public/${shopSlug}/account/orders`);
}

export function getMyOrder(shopSlug: string, id: number) {
  return authedFetch<CustomerOrderSummary>(shopSlug, `/public/${shopSlug}/account/orders/${id}`);
}

// UAE PDPL: full export of the shopper's own data on this shop (profile,
// addresses, orders) as a plain object — the caller (Privacy card) turns
// this into a downloadable file client-side, same reasoning as
// getMyInvoiceHtml not just navigating the browser to the URL directly:
// the endpoint needs the customer's bearer token attached, which a plain
// `<a href>`/browser navigation can't do.
export function exportMyData(shopSlug: string) {
  return authedFetch<Record<string, unknown>>(shopSlug, `/public/${shopSlug}/account/export`);
}

export interface RequestDeletionResult {
  alreadyDeleted: boolean;
  confirmationToken?: string;
  expiresInMinutes?: number;
}

// Step 1 of 2 — see backend CustomerAccountService.requestDeletion. The
// returned confirmationToken is only ever held in memory for the few
// seconds between this call and confirmMyAccountDeletion below, both fired
// back-to-back from the same confirmation-modal click — never persisted,
// never shown to the user as a value they'd need to copy/paste.
export function requestMyAccountDeletion(shopSlug: string) {
  return authedFetch<RequestDeletionResult>(shopSlug, `/public/${shopSlug}/account/me`, {
    method: "DELETE",
  });
}

// Step 2 of 2 — executes the anonymisation.
export function confirmMyAccountDeletion(shopSlug: string, token: string) {
  return authedFetch<{ success: boolean }>(
    shopSlug,
    `/public/${shopSlug}/account/me/confirm?token=${encodeURIComponent(token)}`,
    { method: "DELETE" },
  );
}

// Text-returning twin of authedFetch above — the invoice endpoint responds
// with text/html (a printable document), not JSON, so it can't go through
// authedFetch's always-JSON-parse response handling. Same
// bearer-header/401-refresh-retry contract otherwise.
async function authedFetchText(shopSlug: string, path: string, isRetry = false): Promise<string> {
  const stored = getStoredAuth(shopSlug);
  const res = await fetch(`${API_URL}${path}`, {
    headers: stored ? { Authorization: `Bearer ${stored.accessToken}` } : {},
  });
  if (res.status === 401 && stored && !isRetry) {
    try {
      const refreshed = await post<CustomerAuthResult>(`/public/${shopSlug}/auth/refresh`, {
        refreshToken: stored.refreshToken,
      });
      setStoredAuth(shopSlug, refreshed);
      return authedFetchText(shopSlug, path, true);
    } catch {
      setStoredAuth(shopSlug, null);
      throw new Error("Your session has expired — please log in again");
    }
  }
  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  return res.text();
}

export function getMyInvoiceHtml(shopSlug: string, orderId: number) {
  return authedFetchText(shopSlug, `/public/${shopSlug}/account/orders/${orderId}/invoice`);
}

export function listMyAddresses(shopSlug: string) {
  return authedFetch<CustomerAddress[]>(shopSlug, `/public/${shopSlug}/account/addresses`);
}

export function createMyAddress(shopSlug: string, data: Omit<CustomerAddress, "id">) {
  return authedFetch<CustomerAddress>(shopSlug, `/public/${shopSlug}/account/addresses`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateMyAddress(shopSlug: string, addressId: string, data: Partial<Omit<CustomerAddress, "id">>) {
  return authedFetch<CustomerAddress>(shopSlug, `/public/${shopSlug}/account/addresses/${addressId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteMyAddress(shopSlug: string, addressId: string) {
  return authedFetch<{ id: string; deleted: boolean }>(shopSlug, `/public/${shopSlug}/account/addresses/${addressId}`, {
    method: "DELETE",
  });
}
