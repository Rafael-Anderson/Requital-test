// Reproduces the Products page loading states on a 1-product shop: healthy, slow and failing API.
// Usage: node tools/responsive-audit/repro-products-loading.js (AUDIT_API_URL, AUDIT_ADMIN_URL, AUDIT_CHROME)
const { chromium } = require('../../e2e/node_modules/@playwright/test');
const API = process.env.AUDIT_API_URL || 'http://localhost:3000', ADMIN = process.env.AUDIT_ADMIN_URL || 'http://localhost:3001';
async function main() {
  const id = Date.now();
  const email = `one-${id}@test.com`, password = 'Zx9!audit-Fixture-pw';
  const r = await fetch(`${API}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'One', email, password, shopName: `One ${id}`, subdomain: `one-${id}` }) });
  const cookie = r.headers.getSetCookie().map((l) => l.split(';')[0]).join('; '); const csrf = r.headers.get('X-CSRF-Token');
  const j = await r.json();
  if (j.devVerificationLink) await fetch(`${API}/auth/verify-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: new URL(j.devVerificationLink).searchParams.get('token') }) });
  const col = await (await fetch(`${API}/collections`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, body: JSON.stringify({ name: 'Flowers' }) })).json();
  const pr = await fetch(`${API}/products`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, body: JSON.stringify({ name: 'Only Product', price: 25, sku: `ONE-${id}`, status: 'Available', thumbnail: 'https://placehold.co/400x400.png', trackInventory: false, collectionIds: [col.id] }) });
  console.log('create product', pr.status, pr.status>=400? await pr.text():'');
  const b = await chromium.launch({ executablePath: process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const scenarios = {
    normal: async () => {},
    slowCollections: async (ctx) => ctx.route('**/collections', async (rt) => { await new Promise((x) => setTimeout(x, 12000)); rt.continue(); }),
    collectionsFail: async (ctx) => ctx.route('**/collections', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })),
    productsFail: async (ctx) => ctx.route((u) => u.href.startsWith(API) && /\/products(\?.*)?$/.test(u.pathname + u.search), (rt) => rt.request().method() === 'GET' ? rt.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }) : rt.continue()),
    slowProducts: async (ctx) => ctx.route((u) => u.href.startsWith(API) && /\/products(\?.*)?$/.test(u.pathname + u.search), async (rt) => { await new Promise((x) => setTimeout(x, 8000)); rt.continue(); }),
  };
  for (const [name, setup] of Object.entries(scenarios)) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.request.post(`${API}/auth/login`, { data: { email, password } });
    await setup(ctx);
    const page = await ctx.newPage();
    await page.goto(`${ADMIN}/products`);
    const snap = async (t) => {
      await page.waitForTimeout(t);
      return page.evaluate(() => ({ skeleton: document.querySelectorAll('.animate-pulse').length, hasProduct: document.body.innerText.includes('Only Product'), alert: (document.body.innerText.match(/boom|Failed[^\n]*/) || [''])[0] }));
    };
    const a = await snap(3000); const c = await snap(15000);
    console.log(name, 't=3s', JSON.stringify(a), 't=18s', JSON.stringify(c));
    await ctx.close();
  }
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
