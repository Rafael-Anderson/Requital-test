import type {
  AbandonedCartItemInput,
  AutoDiscount,
  BioLink,
  BioPageConfig,
  Brand,
  Collection,
  CollectionDetail,
  HomepageTemplateSection,
  MenuItem,
  TemplateDetail,
  TemplateSummary,
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
  SearchResponse,
  Shop,
  SurveyLookupResult,
  ValidateDiscountResult,
  ValidateGiftCardResult,
} from "./types";
import type { ThemeConfig } from "./theme-config-types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Base for every browser `fetch()` to the backend.
//   Browser  -> "/api": a relative, same-origin path. next.config rewrites
//     `/api/*` to the real backend server-side (docs/plans/custom-domain-
//     resolver.md Phase 5), so the request is same-origin with the storefront
//     host and SameSite=Strict customer cookies are actually sent — the whole
//     point of the custom-domain auth fix.
//   Server (RSC/SSR) -> the absolute backend origin: a relative URL has no
//     origin there, and the rewrite doesn't apply to fetches the Next server
//     itself makes.
const apiBase = () => (typeof window === "undefined" ? API_URL : "/api");

// Uploaded theme/product images are stored backend-relative (/uploads/...),
// but the storefront runs on its own origin (:3002) — a bare relative <img
// src> or Metadata icon URL resolves against the storefront origin and
// 404s. Same fix as admin/lib/api.ts's resolveImageUrl. Absolute URLs
// (seed/test data, or a merchant who pastes an external image URL) are left
// untouched. Stays on the absolute backend origin (not `/api`): images are
// unauthenticated, cross-origin `<img>` loads are fine, and SSR needs a real
// URL in the rendered HTML.
export function resolveImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith("/") ? `${API_URL}${path}` : path;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, data: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
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

// Back-in-stock notify-me — not shop-slug-scoped (the backend derives shopId
// from productId itself), same as its own route shape.
export function subscribeNotifyMe(productId: number, email: string, variantId?: number) {
  return post<{ alreadySubscribed: boolean }>(`/notify-subscriptions`, {
    productId,
    variantId,
    email,
  });
}

export function searchProducts(shopSlug: string, query: string, cursor?: string) {
  const qs = new URLSearchParams({ q: query });
  if (cursor) qs.set("cursor", cursor);
  return get<SearchResponse>(`/public/${shopSlug}/search?${qs.toString()}`);
}

export async function unsubscribeNotifyMe(email: string, productId: number) {
  const res = await fetch(
    `${apiBase()}/notify-subscriptions?email=${encodeURIComponent(email)}&productId=${productId}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<{ success: boolean }>;
}

// Backs the platform-wide sitemap (app/sitemap.xml/route.ts) — not
// shop-scoped, so it doesn't go through /public/:shopSlug/....
export function listShopsForSitemap() {
  return get<{ slug: string; updatedAt: string }[]>(`/public/shops/sitemap`);
}

export function listCollections(shopSlug: string, previewToken?: string) {
  const qs = previewToken ? `?previewToken=${encodeURIComponent(previewToken)}` : "";
  return get<Collection[]>(`/public/${shopSlug}/collections${qs}`);
}

// Brands with at least one Available product — backs the collection page's
// brand filter. Empty when the shop has no brands (or none in use).
export function listBrands(shopSlug: string, previewToken?: string) {
  const qs = previewToken ? `?previewToken=${encodeURIComponent(previewToken)}` : "";
  return get<Brand[]>(`/public/${shopSlug}/brands${qs}`);
}

// Collection (taxonomy node) detail page — /[shop]/collections/[slug].
// Bug 3 QA-sweep fix: this hit the backend's getCollectionBySlug, which
// used to have no preview bypass at all (unlike its sibling
// listCollections just above) - an unpublished shop's own collection pages
// always 404'd in the theme builder's preview, previewToken or not. Fixed
// on both sides; see public.service.ts's own comment on that method.
export async function getCollectionBySlug(shopSlug: string, slug: string, outletId?: number, previewToken?: string) {
  const params = new URLSearchParams();
  if (outletId !== undefined) params.set("outletId", String(outletId));
  if (previewToken) params.set("previewToken", previewToken);
  const qs = params.size > 0 ? `?${params.toString()}` : "";
  const collection = await get<CollectionDetail>(`/public/${shopSlug}/collections/${slug}${qs}`);
  return { ...collection, products: collection.products.map(resolveProductImage) };
}

export function listTemplates(shopSlug: string) {
  return get<TemplateSummary[]>(`/public/${shopSlug}/templates`);
}

export async function getTemplate(shopSlug: string, slug: string, outletId?: number) {
  const qs = outletId !== undefined ? `?outletId=${outletId}` : "";
  const template = await get<TemplateDetail>(`/public/${shopSlug}/templates/${slug}${qs}`);
  return { ...template, products: template.products.map(resolveProductImage) };
}

// Storefront Home tab, 'templates' mode.
export async function getHomepageTemplates(shopSlug: string, outletId?: number) {
  const qs = outletId !== undefined ? `?outletId=${outletId}` : "";
  const sections = await get<HomepageTemplateSection[]>(`/public/${shopSlug}/homepage-templates${qs}`);
  return sections.map((s) => ({ ...s, products: s.products.map(resolveProductImage) }));
}

// Storefront top-bar "Menu" — direct Collection links + Dropdowns.
export function getMenu(shopSlug: string, previewToken?: string) {
  const qs = previewToken ? `?previewToken=${encodeURIComponent(previewToken)}` : "";
  return get<MenuItem[]>(`/public/${shopSlug}/menu${qs}`);
}

// New visual theme builder's storefront-facing config read. Returns null
// when the shop has no published new-system theme — callers fall back to
// the legacy homepageLayout/topBarLayout/etc. dispatch in that case (see
// shop-context.tsx's own ThemeConfig fetch, and app/[shop]/page.tsx,
// TopBar.tsx, Footer.tsx).
export function getThemeConfig(
  shopSlug: string,
  opts: { preview: boolean; themeId?: number },
) {
  const params = new URLSearchParams();
  if (opts.preview) params.set("preview", "true");
  if (opts.themeId !== undefined) params.set("themeId", String(opts.themeId));
  const qs = params.toString();
  return get<ThemeConfig | null>(`/public/${shopSlug}/theme-config${qs ? `?${qs}` : ""}`);
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
  collectionId?: number,
  isCheckoutAddon?: boolean,
  previewToken?: string,
  brandId?: number,
) {
  const params = new URLSearchParams();
  if (outletId !== undefined) params.set("outletId", String(outletId));
  if (collectionId !== undefined) params.set("collectionId", String(collectionId));
  if (isCheckoutAddon !== undefined) params.set("isCheckoutAddon", String(isCheckoutAddon));
  if (previewToken) params.set("previewToken", previewToken);
  if (brandId !== undefined) params.set("brandId", String(brandId));
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

// Bug 3 QA-sweep fix: same missing preview-bypass gap as getCollectionBySlug
// above, on the product detail read.
export async function getProductBySlug(shopSlug: string, slug: string, outletId?: number, previewToken?: string) {
  const params = new URLSearchParams();
  if (outletId !== undefined) params.set("outletId", String(outletId));
  if (previewToken) params.set("previewToken", previewToken);
  const qs = params.size > 0 ? `?${params.toString()}` : "";
  const product = await get<Product>(`/public/${shopSlug}/products/slug/${slug}${qs}`);
  return resolveProductImage(product);
}

// Template-first, same-collection fallback — see RelatedProducts.tsx and
// the backend's PublicService.getRelatedProducts (Phase 8.4).
export async function getRelatedProducts(shopSlug: string, slug: string, outletId?: number) {
  const qs = outletId !== undefined ? `?outletId=${outletId}` : "";
  const products = await get<Product[]>(`/public/${shopSlug}/products/slug/${slug}/related${qs}`);
  return products.map(resolveProductImage);
}

export function listOutlets(shopSlug: string, previewToken?: string) {
  const qs = previewToken ? `?previewToken=${encodeURIComponent(previewToken)}` : "";
  return get<Outlet[]>(`/public/${shopSlug}/outlets${qs}`);
}

export function listDeliveryZones(shopSlug: string, outletId: number) {
  return get<DeliveryZone[]>(`/public/${shopSlug}/outlets/${outletId}/delivery-zones`);
}

export function createOrder(shopSlug: string, payload: CreateOrderPayload) {
  return post<CreateOrderResponse>(`/public/${shopSlug}/orders`, payload);
}

export function validateDiscount(
  shopSlug: string,
  data: { code: string; cartSubtotal: number; productIds?: number[]; collectionIds?: number[] },
) {
  return post<ValidateDiscountResult>(`/public/${shopSlug}/discounts/validate`, data);
}

// Every live auto-apply discount for this shop — no code, no cart-total
// round trip. See lib/auto-discounts.ts for how product cards/PDP turn this
// into a struck-through price.
export function listActiveAutoDiscounts(shopSlug: string) {
  return get<AutoDiscount[]>(`/public/${shopSlug}/discounts/auto`);
}

export function validateGiftCard(shopSlug: string, code: string) {
  return post<ValidateGiftCardResult>(`/public/${shopSlug}/gift-cards/validate`, { code });
}

// A 409 (email already subscribed) reads as success to the shopper — they
// asked to be on the list and they already are — so it's folded into the
// resolved value rather than thrown like a real failure. Doesn't reuse the
// generic post() helper since that always throws on a non-2xx status.
export async function subscribeNewsletter(shopSlug: string, email: string): Promise<{ alreadySubscribed: boolean }> {
  const res = await fetch(`${apiBase()}/public/${shopSlug}/newsletter-subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.status === 409) return { alreadySubscribed: true };
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      Array.isArray(body?.message) ? body.message.join(", ") : (body?.message ?? `Request failed (${res.status})`),
    );
  }
  return { alreadySubscribed: false };
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
// Session-cookie migration (security audit finding #1), phase 3 — the
// customer session is an httpOnly cookie now, Path-scoped per shop by the
// backend (see backend/src/customer-auth/customer-auth.constants.ts), not a
// bearer token in localStorage. `getStoredAuth`/`setStoredAuth`/
// StoredCustomerAuth are gone entirely — there is no client-side token to
// store; per-shop isolation now comes from the cookie's own Path scoping
// instead of a per-shop localStorage key.
//
// CSRF token distribution — held in memory only (never localStorage, same
// reasoning as the token itself), one variable per loaded page — a real
// browser page is always exactly one shop's storefront at a time, so there
// is no cross-shop confusion risk the way the old per-shop localStorage key
// had to guard against. Originally going to be read via `document.cookie`
// off a non-httpOnly CSRF cookie; that would only ever have worked in local
// dev, where every app shares the bare `localhost` hostname — in
// production {shop}.requital.io can never read a cookie set by
// api.requital.io via document.cookie, cookies don't cross hostnames. The
// backend instead echoes the token on the X-CSRF-Token *response* header of
// every request that mints or refreshes one (register/login/refresh, and
// getMyProfile below) — see backend common/csrf.ts's own
// CSRF_RESPONSE_HEADER comment, and admin/lib/api.ts's identical mechanism.
let customerCsrfToken: string | null = null;

// Authenticated fetch wrapper — mirrors admin/lib/api.ts's apiFetch
// (credentialed fetch + CSRF header + one silent refresh-and-retry on 401),
// scaled down to this app's simpler get/post shape rather than a full copy.
async function authedFetch<T>(shopSlug: string, path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const csrfToken = method !== "GET" && method !== "HEAD" ? customerCsrfToken : null;
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...init.headers,
    },
  });
  const freshCsrfToken = res.headers.get("X-CSRF-Token");
  if (freshCsrfToken) customerCsrfToken = freshCsrfToken;
  if (res.status === 401 && !isRetry) {
    try {
      const refreshRes = await fetch(`${apiBase()}/public/${shopSlug}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": customerCsrfToken ?? "" },
      });
      const refreshedCsrfToken = refreshRes.headers.get("X-CSRF-Token");
      if (refreshedCsrfToken) customerCsrfToken = refreshedCsrfToken;
      if (!refreshRes.ok) throw new Error("Refresh failed");
      return authedFetch<T>(shopSlug, path, init, true);
    } catch {
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

async function credentialedPost<T>(path: string, data: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const freshCsrfToken = res.headers.get("X-CSRF-Token");
  if (freshCsrfToken) customerCsrfToken = freshCsrfToken;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      Array.isArray(body?.message) ? body.message.join(", ") : (body?.message ?? `Request failed (${res.status})`),
    );
  }
  return res.json() as Promise<T>;
}

export function registerCustomer(
  shopSlug: string,
  data: { name: string; phone: string; email?: string; password: string },
) {
  return credentialedPost<CustomerAuthResult>(`/public/${shopSlug}/auth/register`, data);
}

export function loginCustomer(shopSlug: string, data: { identifier: string; password: string }) {
  return credentialedPost<CustomerAuthResult>(`/public/${shopSlug}/auth/login`, data);
}

// httpOnly cookies can't be cleared by client JS — this is a real network
// call now, not a synchronous local-storage removal. Best-effort: the
// caller (lib/auth.tsx) clears local `customer` state regardless of whether
// this round-trip succeeds, same as before.
export async function logoutCustomer(shopSlug: string) {
  await fetch(`${apiBase()}/public/${shopSlug}/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRF-Token": customerCsrfToken ?? "" },
  }).catch(() => undefined);
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
// authedFetch's always-JSON-parse response handling. Same cookie/401-
// refresh-retry contract otherwise (GET-only, so no CSRF header needed on
// the request itself).
async function authedFetchText(shopSlug: string, path: string, isRetry = false): Promise<string> {
  const res = await fetch(`${apiBase()}${path}`, { credentials: "include" });
  if (res.status === 401 && !isRetry) {
    try {
      const refreshRes = await fetch(`${apiBase()}/public/${shopSlug}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": customerCsrfToken ?? "" },
      });
      const refreshedCsrfToken = refreshRes.headers.get("X-CSRF-Token");
      if (refreshedCsrfToken) customerCsrfToken = refreshedCsrfToken;
      if (!refreshRes.ok) throw new Error("Refresh failed");
      return authedFetchText(shopSlug, path, true);
    } catch {
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
