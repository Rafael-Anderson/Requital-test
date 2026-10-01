// Seeds two shops through the real backend API. Usage: node seed.js > state.json
const API = 'http://localhost:4000';
async function call(path, { method = 'GET', body, s } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(s ? { Cookie: s.cookie } : {}), ...(s && method !== 'GET' ? { 'X-CSRF-Token': s.csrf } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${await res.text()}`);
  return { json: await res.json().catch(() => ({})), res };
}
async function seedShop(tag, template) {
  const sub = `wcvis2-${tag}`;
  const email = `${sub}@test.com`, password = 'Password123!';
  const su = await call('/auth/signup', { method: 'POST', body: { name: 'Vis Admin', email, password, shopName: `Vis Shop ${tag}`, subdomain: sub } });
  const s = { cookie: su.res.headers.getSetCookie().map((l) => l.split(';')[0]).join('; '), csrf: su.res.headers.get('X-CSRF-Token') ?? '' };
  if (su.json.devVerificationLink) {
    const token = new URL(su.json.devVerificationLink).searchParams.get('token');
    await call('/auth/verify-email', { method: 'POST', body: { token } });
  }
  const outlets = (await call('/outlets', { s })).json;
  const outletId = outlets[0].id;
  await call(`/outlets/${outletId}`, { method: 'PATCH', body: { pickupEnabled: true, active: true }, s });
  const col = (await call('/collections', { method: 'POST', body: { name: 'Flowers' }, s })).json;
  const col2 = (await call('/collections', { method: 'POST', body: { name: 'Gifts' }, s })).json;
  const mk = async (name, price, cols, extra = {}) => (await call('/products', { method: 'POST', body: { name, price, thumbnail: 'https://placehold.co/400x400.png', sku: `${sub}-${name.replace(/\s/g, '')}`, status: 'Available', collectionIds: cols, trackInventory: true, ...extra }, s })).json;
  const p1 = await mk('Rose Bouquet', 50, [col.id], { description: '<p>Fresh roses, hand tied.</p>' });
  const p2 = await mk('Tulip Bunch', 40, [col.id]);
  const p3 = await mk('Gift Box', 120, [col2.id]);
  await call(`/products/${p2.id}/options`, { method: 'PUT', body: { options: [{ name: 'Color', values: ['Red', 'White'] }] }, s });
  const full = (await call(`/products/${p2.id}`, { s })).json;
  await call('/products/stock/bulk-adjust', { method: 'PATCH', body: { outletId, adjustments: [{ productId: p1.id, delta: 100 }, { productId: p3.id, delta: 100 }, ...full.variants.map((v) => ({ productId: p2.id, variantId: v.id, delta: 100 }))] }, s });
  await call('/shop', { method: 'PATCH', body: { published: true }, s });
  if (template) {
    const t = (await call('/themes', { method: 'POST', body: { name: 'T', fromTemplate: template }, s })).json;
    await call(`/themes/${t.id}/publish`, { method: 'POST', s });
  }
  await call('/theme', { method: 'PATCH', body: { checkoutLayout: template ? 'step_by_step' : 'single_page' }, s });
  const phone = '0501234567';
  const ord = (await call(`/public/${sub}/orders`, { method: 'POST', body: { outletId, orderType: 'pickup', paymentMethod: 'cash_on_pickup', customerName: 'Vis Customer', customerPhone: phone, customerAddress: 'Pickup', items: [{ productId: p1.id, quantity: 2 }, { productId: p3.id, quantity: 1 }] } })).json;
  await call(`/public/${sub}/auth/register`, { method: 'POST', body: { name: 'Vis Customer', phone, email: `cust-${sub}@test.com`, password } });
  return { sub, email, password, phone, outletId, collection: col, p1, p2, p3, orderId: ord.order.id, trackingToken: ord.order.trackingToken };
}
(async () => {
  const out = { legacy: await seedShop('legacy', null), themed: await seedShop('themed', 'market') };
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
