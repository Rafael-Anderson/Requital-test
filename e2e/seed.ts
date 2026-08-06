import { API_URL } from './urls';

// Deterministic in *shape*, not in exact ids/subdomain — every run gets a
// fresh shop (subdomain suffixed with the run's own timestamp) so repeated
// CI runs against the same long-lived MySQL instance never collide on a
// unique subdomain/SKU/email. The fixture graph itself (1 category, 1
// simple product, 1 variant product with 2 variants, the default outlet
// from signup, 1 customer + 1 pending order) is identical every run.
export interface SeedVariant {
  id: number;
  label: string;
}

export interface SeedState {
  runId: string;
  subdomain: string;
  shopName: string;
  adminEmail: string;
  adminPassword: string;
  outletId: number;
  categoryId: number;
  simpleProduct: { id: number; slug: string; name: string; sku: string };
  variantProduct: {
    id: number;
    slug: string;
    name: string;
    sku: string;
    variants: SeedVariant[];
  };
  customerName: string;
  customerPhone: string;
  seededOrderId: number;
}

async function api<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `seed: ${init.method ?? 'GET'} ${path} -> ${res.status}: ${text}`,
    );
  }
  return (await res.json()) as T;
}

export async function seedShop(): Promise<SeedState> {
  const runId = Date.now().toString();
  const subdomain = `pw-e2e-${runId}`;
  const adminEmail = `pw-e2e-${runId}@test.com`;
  const adminPassword = 'Password123!';
  const shopName = `Playwright E2E Shop ${runId}`;

  const signup = await api<{
    accessToken: string;
    devVerificationLink?: string;
  }>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Playwright Admin',
      email: adminEmail,
      password: adminPassword,
      shopName,
      subdomain,
    }),
  });
  const accessToken = signup.accessToken;

  // Publishing requires a verified admin email (Phase 3 auth lifecycle) —
  // same dev-link flow backend/test/helpers/verify-signup-email.ts uses.
  if (signup.devVerificationLink) {
    const token = new URL(signup.devVerificationLink).searchParams.get(
      'token',
    );
    await api('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  // Signup already creates one default outlet in the same transaction (see
  // AuthService.signup) — just enable pickup on it so publish readiness and
  // the seeded pickup order both have somewhere to fulfil against.
  const outlets = await api<{ id: number }[]>('/outlets', {}, accessToken);
  const outletId = outlets[0].id;
  await api(
    `/outlets/${outletId}`,
    { method: 'PATCH', body: JSON.stringify({ pickupEnabled: true, active: true }) },
    accessToken,
  );

  const category = await api<{ id: number }>(
    '/categories',
    { method: 'POST', body: JSON.stringify({ name: 'Flowers' }) },
    accessToken,
  );
  const categoryId = category.id;

  const simpleProductRaw = await api<{
    id: number;
    slug: string;
    name: string;
    sku: string;
  }>(
    '/products',
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Rose Bouquet',
        price: 50,
        thumbnail: 'https://placehold.co/400x400.png',
        sku: `PW-SIMPLE-${runId}`,
        status: 'Available',
        categoryIds: [categoryId],
        trackInventory: true,
      }),
    },
    accessToken,
  );

  const variantBase = await api<{
    id: number;
    slug: string;
    name: string;
    sku: string;
  }>(
    '/products',
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Tulip Bunch',
        price: 40,
        thumbnail: 'https://placehold.co/400x400.png',
        sku: `PW-VARIANT-${runId}`,
        status: 'Available',
        categoryIds: [categoryId],
        trackInventory: true,
      }),
    },
    accessToken,
  );

  await api(
    `/products/${variantBase.id}/options`,
    {
      method: 'PUT',
      body: JSON.stringify({ options: [{ name: 'Color', values: ['Red', 'White'] }] }),
    },
    accessToken,
  );
  // Re-fetched rather than trusting updateOptions' own return shape — the
  // variant `label` field (e.g. "Red") is what the storefront PDP renders
  // on its option buttons, and GET /products/:id is the one response shape
  // every spec/tool in this app already relies on for that.
  const variantProductFull = await api<{
    variants: { id: number; label: string }[];
  }>(`/products/${variantBase.id}`, {}, accessToken);
  const variants: SeedVariant[] = variantProductFull.variants.map((v) => ({
    id: v.id,
    label: v.label,
  }));

  await api(
    '/products/stock/bulk-adjust',
    {
      method: 'PATCH',
      body: JSON.stringify({
        outletId,
        adjustments: [
          { productId: simpleProductRaw.id, delta: 100 },
          ...variants.map((v) => ({
            productId: variantBase.id,
            variantId: v.id,
            delta: 100,
          })),
        ],
      }),
    },
    accessToken,
  );

  await api(
    '/shop',
    { method: 'PATCH', body: JSON.stringify({ published: true }) },
    accessToken,
  );

  // A customer + one pending order (for the kanban spec) via a real guest
  // checkout through the public API — this is also how a customer row
  // actually gets created in this app (see CLAUDE.md's customers module
  // note: upserted at order-creation time, no direct admin "create customer").
  const customerName = 'Playwright Customer';
  const customerPhone = '0501234567';
  const orderResult = await api<{ order: { id: number } }>(
    `/public/${subdomain}/orders`,
    {
      method: 'POST',
      body: JSON.stringify({
        outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName,
        customerPhone,
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        items: [{ productId: simpleProductRaw.id, quantity: 1 }],
      }),
    },
  );

  return {
    runId,
    subdomain,
    shopName,
    adminEmail,
    adminPassword,
    outletId,
    categoryId,
    simpleProduct: {
      id: simpleProductRaw.id,
      slug: simpleProductRaw.slug,
      name: simpleProductRaw.name,
      sku: simpleProductRaw.sku,
    },
    variantProduct: {
      id: variantBase.id,
      slug: variantBase.slug,
      name: variantBase.name,
      sku: variantBase.sku,
      variants,
    },
    customerName,
    customerPhone,
    seededOrderId: orderResult.order.id,
  };
}
