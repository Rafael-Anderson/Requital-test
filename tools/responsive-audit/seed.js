// Seeds one fresh shop through the real backend API (never production) with enough
// data that list pages have rows: products, collections, orders, a discount, a
// draft order. Best-effort for the optional pieces (logged, never fatal).
// Usage: node tools/responsive-audit/seed.js  -> prints the fixture JSON.
const API = process.env.AUDIT_API_URL || 'http://localhost:3000';

function jar(res) {
  const cookie = res.headers.getSetCookie().map((l) => l.split(';')[0]).join('; ');
  return { cookie, csrf: res.headers.get('X-CSRF-Token') || '' };
}

async function call(path, init = {}, s) {
  const method = (init.method || 'GET').toUpperCase();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(s ? { Cookie: s.cookie } : {}),
      ...(s && method !== 'GET' ? { 'X-CSRF-Token': s.csrf } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function optional(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[seed] optional step skipped (${label}): ${e.message}`);
    return null;
  }
}

async function seed() {
  const runId = Date.now().toString();
  const subdomain = `audit-${runId}`;
  const email = `audit-${runId}@test.com`;
  const password = 'Zx9!audit-Fixture-pw';
  const signupRes = await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Audit Admin', email, password, shopName: `Audit Shop ${runId}`, subdomain }),
  });
  if (!signupRes.ok) throw new Error(`signup ${signupRes.status} ${await signupRes.text()}`);
  const s = jar(signupRes);
  const signup = await signupRes.json();
  if (signup.devVerificationLink) {
    const token = new URL(signup.devVerificationLink).searchParams.get('token');
    await call('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
  }
  // Advanced mode shows the full dashboard/orders UI (filters, extra columns); simple mode is the signup default.
  await call('/shop', { method: 'PATCH', body: JSON.stringify({ productEditorMode: process.env.AUDIT_MODE || 'advanced' }) }, s);
  const outlets = await call('/outlets', {}, s);
  const outletId = outlets[0].id;
  await call(`/outlets/${outletId}`, { method: 'PATCH', body: JSON.stringify({ pickupEnabled: true, active: true }) }, s);

  const collections = [];
  for (const name of ['Flowers', 'Gift boxes', 'Plants']) {
    collections.push(await call('/collections', { method: 'POST', body: JSON.stringify({ name }) }, s));
  }
  const products = [];
  const names = ['Rose Bouquet', 'Tulip Bunch', 'Orchid Pot', 'Luxury Gift Box', 'Peony Arrangement', 'Succulent Trio'];
  for (let i = 0; i < names.length; i++) {
    products.push(
      await call(
        '/products',
        {
          method: 'POST',
          body: JSON.stringify({
            name: names[i],
            price: 40 + i * 15,
            thumbnail: process.env.AUDIT_IMAGE_BASE ? `${process.env.AUDIT_IMAGE_BASE}/audit-${i}.svg` : 'https://placehold.co/400x400.png',
            sku: `AUD-${runId}-${i}`,
            status: 'Available',
            collectionIds: [collections[i % collections.length].id],
            trackInventory: true,
          }),
        },
        s,
      ),
    );
  }
  await call(
    '/products/stock/bulk-adjust',
    { method: 'PATCH', body: JSON.stringify({ outletId, adjustments: products.map((p) => ({ productId: p.id, delta: 50 })) }) },
    s,
  );
  await call('/shop', { method: 'PATCH', body: JSON.stringify({ published: true }) }, s);
  // AUDIT_IMAGE_BASE also sets a wide image logo (320x64): a real logo is what squeezes a header, a text name truncates.
  if (process.env.AUDIT_IMAGE_BASE && process.env.AUDIT_LOGO !== '0') {
    await optional('logo', () => call('/shop', { method: 'PATCH', body: JSON.stringify({ logoUrl: `${process.env.AUDIT_IMAGE_BASE}/audit-logo.svg` }) }, s));
  }
  // AUDIT_CART_LAYOUT=drawer opens the cart in a drawer instead of the cart page (drawer open-state audit).
  if (process.env.AUDIT_CART_LAYOUT) {
    await call('/theme', { method: 'PATCH', body: JSON.stringify({ cartLayout: process.env.AUDIT_CART_LAYOUT }) }, s);
  }

  // AUDIT_TEMPLATE=atelier|market|bloom|heritage: create that starter template as a Sections theme and
  // publish it (so the storefront renders the theme-driven chrome and homepage instead of the legacy
  // layout), plus brands so a template that shows a brands strip has something to show.
  let themeId = null;
  let brandIds = [];
  const template = process.env.AUDIT_TEMPLATE || '';
  if (template) {
    for (const name of ['Maison Fleur', 'Petal & Co', 'Green Atelier']) {
      const b = await optional(`brand ${name}`, () => call('/brands', { method: 'POST', body: JSON.stringify({ name }) }, s));
      if (b) brandIds.push(b.id);
    }
    for (let i = 0; i < products.length && brandIds.length; i++) {
      await optional(`brand on product ${i}`, () =>
        call(`/products/${products[i].id}`, { method: 'PATCH', body: JSON.stringify({ brandId: brandIds[i % brandIds.length] }) }, s),
      );
    }
    const theme = await call('/themes', { method: 'POST', body: JSON.stringify({ name: `Audit ${template}`, fromTemplate: template }) }, s);
    await call(`/themes/${theme.id}/publish`, { method: 'POST', body: JSON.stringify({}) }, s);
    themeId = theme.id;
  }

  const orders = [];
  for (let i = 0; i < 4; i++) {
    const r = await optional(`order ${i}`, () =>
      call(`/public/${subdomain}/orders`, {
        method: 'POST',
        body: JSON.stringify({
          outletId,
          orderType: 'pickup',
          paymentMethod: 'cash_on_pickup',
          customerName: ['Amira Khalid', 'Omar Haddad', 'Layla Nasser', 'Yousef Karim'][i],
          customerPhone: `05012345${60 + i}`,
          customerAddress: 'Pickup',
          items: [{ productId: products[i].id, quantity: 1 + i }],
        }),
      }),
    );
    if (r && r.order) orders.push(r.order);
  }
  if (orders[0]) {
    await optional('confirm order', () =>
      call(`/orders/${orders[0].id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }) }, s),
    );
  }
  const discount = await optional('discount', () =>
    call(
      '/shop/discounts',
      { method: 'POST', body: JSON.stringify({ code: `WELCOME${runId.slice(-4)}`, type: 'PERCENTAGE', value: 10, appliesTo: 'ALL_PRODUCTS', discountType: 'code' }) },
      s,
    ),
  );

  return {
    runId,
    api: API,
    subdomain,
    email,
    password,
    outletId,
    collectionIds: collections.map((c) => c.id),
    collectionSlugs: collections.map((c) => c.slug),
    products: products.map((p) => ({ id: p.id, slug: p.slug, name: p.name })),
    orderIds: orders.map((o) => o.id),
    orderTrackingTokens: orders.map((o) => o.trackingToken).filter(Boolean),
    discountId: discount && discount.id,
    template: template || null,
    themeId,
    brandIds,
  };
}

module.exports = { seed, call, jar, optional };

if (require.main === module) {
  seed().then(
    (f) => console.log(JSON.stringify(f, null, 2)),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
