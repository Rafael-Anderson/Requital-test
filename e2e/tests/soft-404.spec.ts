import { test, expect, type APIRequestContext } from '@playwright/test';
import { STOREFRONT_URL } from '../urls';
import { api, seedShop, type SeedState } from '../seed';

// A missing storefront URL must answer 404 with the branded not-found body and a noindex
// robots meta, never a streamed 200 (a soft 404 that search engines index). The server
// render of every storefront page is the loading skeleton (ShopProvider fetches in an effect),
// so a notFound() thrown by the route is only seen by the server render if ShopLayoutClient
// renders the route's children; see app/[shop]/ShopLayoutClient.tsx (SSR_STATUS_PARAMS).
// Plain HTTP (request.get), no browser: the status line and the HTML are what a crawler reads.
// Next answers a notFound() raised during the server render with the 404 status, the noindex meta and
// a bare error shell (<html id="__next_error__">); the branded not-found UI is then rendered by the
// client, so its text is asserted in a real browser at the end, not in the HTTP body.
test.describe.configure({ mode: 'serial' });
// CI serves the storefront with `next dev`, which compiles each route on first visit.
test.setTimeout(120_000);

let seed: SeedState;
test.beforeAll(async () => {
  seed = await seedShop();
  // A real redirect for the host-mode 301 check (proxy.ts; the path-mode proxy skips redirects).
  await api(
    '/url-redirects',
    {
      method: 'POST',
      body: JSON.stringify({ fromPath: '/old-rose', toTarget: `/products/${seed.simpleProduct.slug}`, statusCode: 301 }),
    },
    seed.session,
  );
});

const NOINDEX = /<meta name="robots" content="noindex"/;

async function get(request: APIRequestContext, path: string, host?: string) {
  const res = await request.get(`${STOREFRONT_URL}${path}`, {
    maxRedirects: 0,
    headers: host ? { Host: host } : undefined,
  });
  return { res, body: await res.text() };
}

test.describe('path mode (/<shop>/...)', () => {
  const missing = (s: SeedState) => [
    ['an unknown path', `/${s.subdomain}/nope`],
    ['an unknown deep path', `/${s.subdomain}/a/b/c`],
    ['an unknown product', `/${s.subdomain}/products/no-such-product`],
    ['an unknown collection', `/${s.subdomain}/collections/no-such-collection`],
    ['an unknown brand', `/${s.subdomain}/brands/999999`],
    ['an unknown policy type', `/${s.subdomain}/policies/bogus`],
    ['a policy this shop has not written', `/${s.subdomain}/policies/terms`],
  ];

  for (let i = 0; i < 7; i++) {
    test(`missing URL #${i} answers 404 with noindex`, async ({ request }) => {
      const [label, path] = missing(seed)[i];
      const { res, body } = await get(request, path);
      expect(res.status(), `${label}: ${path}`).toBe(404);
      expect(body, `${label}: noindex`).toMatch(NOINDEX);
    });
  }

  test('an unknown shop answers 404 with the store-not-found state and noindex', async ({ request }) => {
    const { res, body } = await get(request, '/no-such-shop-xyz/products/x');
    expect(res.status()).toBe(404);
    expect(body).toMatch(NOINDEX);
  });

  test('real pages still answer 200 and are not noindexed', async ({ request }) => {
    for (const path of [`/${seed.subdomain}`, `/${seed.subdomain}/products/${seed.simpleProduct.slug}`, `/${seed.subdomain}/collections/flowers`]) {
      const { res, body } = await get(request, path);
      expect(res.status(), path).toBe(200);
      expect(body, path).not.toMatch(NOINDEX);
      expect(body, path).not.toContain('__next_error__');
    }
  });

});

test.describe('the branded not-found state (rendered by the client after the 404 response)', () => {
  test('a missing page shows the shop-chromed not-found, an unknown shop the store-not-found state', async ({ page }) => {
    const missing = await page.goto(`${STOREFRONT_URL}/${seed.subdomain}/nope`);
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.locator('header')).toBeVisible();

    const product = await page.goto(`${STOREFRONT_URL}/${seed.subdomain}/products/no-such-product`);
    expect(product?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    const unknown = await page.goto(`${STOREFRONT_URL}/no-such-shop-xyz`);
    expect(unknown?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Store not found' })).toBeVisible();
  });

  test('in-app navigation to a missing product shows the not-found state and a real one still renders', async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/${seed.subdomain}`);
    await page.evaluate((s) => (window as unknown as { next: { router: { push(u: string): void } } }).next.router.push(`/${s}/products/no-such-product`), seed.subdomain);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.evaluate((a) => (window as unknown as { next: { router: { push(u: string): void } } }).next.router.push(`/${a.s}/products/${a.p}`), { s: seed.subdomain, p: seed.simpleProduct.slug });
    await expect(page.getByRole('heading', { name: seed.simpleProduct.name })).toBeVisible();
  });
});

test.describe('host mode (<shop>.requital.io, resolved by proxy.ts)', () => {
  test('a missing path and a missing product answer 404 with noindex', async ({ request }) => {
    const host = `${seed.subdomain}.requital.io`;
    for (const path of ['/nope', '/products/no-such-product']) {
      const { res, body } = await get(request, path, host);
      expect(res.status(), path).toBe(404);
      expect(body, path).toMatch(NOINDEX);
    }
  });

  test('a real page is 200 and a configured redirect is a 301', async ({ request }) => {
    const host = `${seed.subdomain}.requital.io`;
    const real = await get(request, `/products/${seed.simpleProduct.slug}`, host);
    expect(real.res.status()).toBe(200);
    const redirected = await get(request, '/old-rose', host);
    expect(redirected.res.status()).toBe(301);
    expect(redirected.res.headers()['location']).toBe(`/products/${seed.simpleProduct.slug}`);
  });
});
