import type {
  AuthUser,
  BusinessHours,
  Category,
  DailyRevenuePoint,
  DashboardSummary,
  DeliveryZone,
  Order,
  Outlet,
  OrderStatus,
  PaginatedOrders,
  Product,
  ProductInput,
  Shop,
  TopProduct,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const TOKEN_STORAGE_KEY = "requital_admin_token";

// Uploaded images are stored as paths relative to the backend
// (/uploads/products/..., /uploads/categories/...), but the admin app runs
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
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData sets its own multipart boundary in the Content-Type header —
  // forcing application/json here would break the upload endpoint.
  const isFormData = init?.body instanceof FormData;
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // A rejected/expired token is never valid again for this session —
    // clear it so the next render's auth check redirects to /login instead
    // of retrying with the same dead token.
    if (res.status === 401) clearToken();
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function login(email: string, password: string) {
  return apiFetch<{ token: string; user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function signup(data: { name: string; email: string; password: string; shopName: string; subdomain: string }) {
  return apiFetch<{ token: string; user: AuthUser }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function me() {
  return apiFetch<AuthUser>("/auth/me");
}

export function listShopUsers() {
  return apiFetch<AuthUser[]>("/auth/users");
}

export function createBranchUser(data: { name: string; email: string; password: string; outletId: number }) {
  return apiFetch<AuthUser>("/auth/branch-users", {
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

export interface DeliveryZoneInput {
  name: string;
  fee: number;
  minOrderAmount?: number;
  isActive?: boolean;
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

export function geocodeAddress(query: string) {
  return apiFetch<{ latitude: number; longitude: number; displayName: string } | null>(
    `/outlets/geocode?q=${encodeURIComponent(query)}`,
  );
}

export function getShop() {
  return apiFetch<Shop>("/shop");
}

export function updateShop(
  data: Partial<Omit<Shop, "id" | "subdomain" | "defaultDeliveryFee">> & {
    defaultDeliveryFee?: number;
  },
) {
  return apiFetch<Shop>("/shop", { method: "PATCH", body: JSON.stringify(data) });
}

export function uploadShopLogo(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/shop/upload", { method: "POST", body: formData });
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

export function updateOrderStatus(id: number, status: OrderStatus) {
  return apiFetch<Order>(`/orders/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
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
  adjustments: { productId: number; delta: number }[],
  outletId?: number,
) {
  return apiFetch<{ productId: number; stockQuantity: number }[]>(
    "/products/stock/bulk-adjust",
    { method: "PATCH", body: JSON.stringify({ outletId, adjustments }) },
  );
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

export function getProduct(id: number, outletId?: number) {
  const query = outletId ? `?outletId=${outletId}` : "";
  return apiFetch<Product>(`/products/${id}${query}`);
}

export function uploadProductImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/products/upload", {
    method: "POST",
    body: formData,
  });
}

export function listCategories() {
  return apiFetch<Category[]>("/categories");
}

export interface CategoryInput {
  name: string;
  slug?: string;
  parentCategoryId?: number | null;
  displayOrder?: number;
  image?: string | null;
  isFeatured?: boolean;
}

export function uploadCategoryImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/categories/upload", {
    method: "POST",
    body: formData,
  });
}

export function createCategory(data: CategoryInput) {
  return apiFetch<Category>("/categories", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateCategory(id: number, data: Partial<CategoryInput>) {
  return apiFetch<Category>(`/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteCategory(id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/categories/${id}`, {
    method: "DELETE",
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
