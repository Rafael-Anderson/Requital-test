// Adds rows to every admin list page of a fixture shop (ingredients, suppliers, purchase
// orders, gift cards, templates, users, newsletter, affiliates, bio links, abandoned carts,
// external delivery, redirects, brands...) so a list audit measures real rows, not empty states.
// Best-effort: a step that fails is logged and skipped. Never run against production.
const { call, jar, optional } = require('./seed');

async function seedLists(fx) {
  const API = fx.api;
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: fx.email, password: fx.password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  const s = jar(res);
  const post = (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) }, s);
  const out = {};
  const cat = await optional('ingredient category', () => post('/shop/ingredient-categories', { name: 'Fresh flowers' }));
  out.ingredients = [];
  for (const [i, name] of ['Red roses (stem)', 'Eucalyptus bunch', 'Ribbon, satin 25mm'].entries()) {
    const r = await optional('ingredient', () => post('/shop/ingredients', { name, unit: i === 2 ? 'm' : 'pcs', trackInventory: true, costPerUnit: 1.5 + i, supplier: 'Al Quoz Flower Market', categoryId: cat ? cat.id : undefined }));
    if (r) out.ingredients.push(r);
  }
  for (const name of ['Garden Co', 'Petal House']) await optional('brand', () => post('/brands', { name }));
  await optional('tax class', () => post('/tax-classes', { name: 'Reduced 2%', rate: 2, type: 'standard' }));
  await optional('discount', () => post('/shop/discounts', { code: `SPRING${fx.runId.slice(-4)}`, type: 'FIXED_AMOUNT', value: 15, appliesTo: 'ALL_PRODUCTS', discountType: 'code', usageLimit: 100 }));
  for (const v of [100, 250]) await optional('gift card', () => post('/gift-cards', { initialValue: v }));
  for (const title of ['Mother day picks', 'Best sellers']) await optional('template', () => post('/templates', { title, type: 'MANUAL' }));
  out.suppliers = [];
  for (const [i, name] of ['Al Quoz Flower Market', 'Dutch Bulbs Trading'].entries()) {
    const sp = await optional('supplier', () => post('/suppliers', { name, paymentTerms: 'Net 30', leadTimeDays: 3 + i, currency: 'AED', minimumOrderAmount: 200 }));
    if (sp) {
      out.suppliers.push(sp);
      await optional('supplier contact', () => post(`/suppliers/${sp.id}/contacts`, { name: 'Hamad Al Mansoori', email: 'hamad@example.com', phone: '0501234567', isPrimary: true }));
    }
  }
  out.purchaseOrders = [];
  for (const sp of out.suppliers) {
    if (!out.ingredients[0]) break;
    const po = await optional('purchase order', () => post('/purchase-orders', { supplierId: sp.id, outletId: fx.outletId, currency: 'AED', lines: [{ ingredientId: out.ingredients[0].id, quantity: 20, unitCost: 1.25 }, { ingredientId: out.ingredients[1].id, quantity: 10, unitCost: 3 }] }));
    if (po) out.purchaseOrders.push(po);
  }
  const pwd = 'Zx9!audit-Staff-pw-7';
  await optional('user viewer', () => post('/auth/branch-users', { name: 'Noor Viewer', email: `viewer-${fx.runId}@test.com`, password: pwd, role: 'viewer' }));
  await optional('user branch', () => post('/auth/branch-users', { name: 'Salem Branch', email: `branch-${fx.runId}@test.com`, password: pwd, role: 'branch', outletId: fx.outletId }));
  for (const e of ['a', 'b', 'c']) await optional('newsletter', () => post(`/public/${fx.subdomain}/newsletter-subscribe`, { email: `sub-${e}-${fx.runId}@example.com` }));
  for (const [i, n] of ['Reem Al Suwaidi', 'Khalid Mubarak'].entries()) {
    const a = await optional('affiliate', () => post('/affiliates', { name: n, mobile: `05055500${i}1` }));
    if (a) await optional('affiliate code', () => post('/affiliates/codes', { affiliateId: a.id, code: `REF${i}${fx.runId.slice(-3)}`, promotionFor: 'Instagram', commissionType: 'percentage', commissionValue: 10 }));
  }
  for (const [i, label] of ['Our Instagram', 'WhatsApp us'].entries()) await optional('bio link', () => post('/shop/bio-links', { type: 'EXTERNAL_URL', label, url: `https://example.com/${i}` }));
  const item = { productId: fx.products[0].id, name: fx.products[0].name, price: 40, quantity: 1, thumbnail: 'https://placehold.co/100.png' };
  for (const [i, n] of ['Mariam Saeed', 'Tariq Anwar'].entries()) await optional('abandoned cart', () => post(`/public/${fx.subdomain}/abandoned-carts`, { customerName: n, customerPhone: `05077700${i}1`, customerEmail: `cart${i}-${fx.runId}@example.com`, outletId: fx.outletId, cartItems: [item] }));
  if (fx.orderIds[1]) await optional('external delivery', () => post(`/orders/${fx.orderIds[1]}/external-delivery`, { carrier: 'Careem Box', vehicleType: 'bike', price: 18, destination: 'Dubai Marina' }));
  await optional('redirect', () => post('/url-redirects', { fromPath: '/old-roses', toTarget: '/products/rose-bouquet', statusCode: 301 }));
  await optional('metafield def', () => post('/metafield-definitions', { ownerType: 'product', namespace: 'custom', key: 'care_tips', name: 'Care tips', type: 'text' }));
  return out;
}

module.exports = { seedLists };
