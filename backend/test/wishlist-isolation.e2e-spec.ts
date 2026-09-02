import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import { verifySignupEmail } from './helpers/verify-signup-email';

// Adversarial multi-tenant isolation for the wishlist, per the
// security-outlet-isolation convention: a customer can only ever touch
// their own wishlist, scoped to their own shop; another customer's id or
// another shop's product id in any request position changes nothing;
// unauthenticated access is rejected; CSRF is enforced on the mutations.

interface AdminAuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface CustomerResponseBody {
  customer: { id: number; shopId: number };
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Same extractCookies/cookieHeader/sessionFromResponse pattern as
// customer-data-privacy.e2e-spec.ts (see that file for the full reasoning,
// incl. why supertest's lack of Path-aware cookie matching doesn't weaken
// the cross-shop-rejection tests).
function extractCookies(res: Response): Record<string, string> {
  const lines = res.get('Set-Cookie') ?? [];
  const cookies: Record<string, string> = {};
  for (const line of lines) {
    const pair = line.split(';')[0];
    const idx = pair.indexOf('=');
    cookies[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return cookies;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

interface CustomerSession {
  cookieHeaderStr: string;
  csrfToken: string;
  customer: CustomerResponseBody['customer'];
}

function sessionFromResponse(res: Response): CustomerSession {
  const cookies = extractCookies(res);
  return {
    cookieHeaderStr: cookieHeader(cookies),
    csrfToken: cookies['req-customer-csrf'],
    customer: body<CustomerResponseBody>(res).customer,
  };
}

jest.setTimeout(40000);

describe('Wishlist multi-tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(slugPrefix: string) {
    const shopSlug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Shop Admin',
        email: `${shopSlug}@test.com`,
        password: 'password123',
        shopName: `${shopSlug} Shop`,
        subdomain: shopSlug,
      })
      .expect(201);
    const adminToken = body<AdminAuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AdminAuthResponse>(signup).devVerificationLink,
    );

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const collectionId = body<IdRow>(collection).id;

    // Publish readiness needs at least one product (shop.service.ts).
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'seed',
        price: 50,
        thumbnail: 'https://example.com/x.jpg',
        sku: `WL-SEED-${shopSlug}`,
        collectionIds: [collectionId],
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    return { shopSlug, adminToken, outletId, collectionId };
  }

  async function createProduct(
    adminToken: string,
    collectionId: number,
    name: string,
  ): Promise<number> {
    const res = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name,
        price: 50,
        thumbnail: 'https://example.com/x.jpg',
        sku: `WL-${name}-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        collectionIds: [collectionId],
      })
      .expect(201);
    return body<IdRow>(res).id;
  }

  function register(shopSlug: string, phone: string, email: string) {
    return request(app.getHttpServer())
      .post(`/public/${shopSlug}/auth/register`)
      .send({ name: 'Wishlist Shopper', phone, email, password: 'password123' })
      .expect(201);
  }

  function addToWishlist(
    session: CustomerSession,
    shopSlug: string,
    productId: number,
  ) {
    return request(app.getHttpServer())
      .post(`/public/${shopSlug}/account/wishlist`)
      .set('Cookie', session.cookieHeaderStr)
      .set('X-CSRF-Token', session.csrfToken)
      .send({ productId });
  }

  function getWishlist(session: CustomerSession, shopSlug: string) {
    return request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/wishlist`)
      .set('Cookie', session.cookieHeaderStr)
      .set('X-CSRF-Token', session.csrfToken);
  }

  it('a customer reads and writes only their own wishlist; another customer in the same shop is unaffected', async () => {
    const shop = await setupShop('wl-own');
    const p1 = await createProduct(shop.adminToken, shop.collectionId, 'own1');
    const p2 = await createProduct(shop.adminToken, shop.collectionId, 'own2');

    const a = sessionFromResponse(
      await register(shop.shopSlug, `05011${runId % 100000}`, `wl-own-a-${runId}@t.com`),
    );
    const b = sessionFromResponse(
      await register(shop.shopSlug, `05012${runId % 100000}`, `wl-own-b-${runId}@t.com`),
    );

    await addToWishlist(a, shop.shopSlug, p1).expect(201);
    expect(body<number[]>(await getWishlist(a, shop.shopSlug).expect(200))).toEqual([p1]);

    // B's own list is empty and B's writes never touch A's.
    expect(body<number[]>(await getWishlist(b, shop.shopSlug).expect(200))).toEqual([]);
    await request(app.getHttpServer())
      .delete(`/public/${shop.shopSlug}/account/wishlist/${p1}`)
      .set('Cookie', b.cookieHeaderStr)
      .set('X-CSRF-Token', b.csrfToken)
      .expect(200);
    await addToWishlist(b, shop.shopSlug, p2).expect(201);

    expect(body<number[]>(await getWishlist(a, shop.shopSlug).expect(200))).toEqual([p1]);
    expect(body<number[]>(await getWishlist(b, shop.shopSlug).expect(200))).toEqual([p2]);
  });

  it('a customer authenticated on shop A cannot touch shop B, and a shop-B product id cannot enter a shop-A wishlist', async () => {
    const shopA = await setupShop('wl-xshop-a');
    const shopB = await setupShop('wl-xshop-b');
    const pA = await createProduct(shopA.adminToken, shopA.collectionId, 'xa');
    const pB = await createProduct(shopB.adminToken, shopB.collectionId, 'xb');

    const a = sessionFromResponse(
      await register(shopA.shopSlug, `05013${runId % 100000}`, `wl-xa-${runId}@t.com`),
    );
    await addToWishlist(a, shopA.shopSlug, pA).expect(201);

    // Same session cookie, shop B's URL — the guard rejects (customer's
    // shopId != resolved shop) on every verb.
    await request(app.getHttpServer())
      .get(`/public/${shopB.shopSlug}/account/wishlist`)
      .set('Cookie', a.cookieHeaderStr)
      .set('X-CSRF-Token', a.csrfToken)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/public/${shopB.shopSlug}/account/wishlist`)
      .set('Cookie', a.cookieHeaderStr)
      .set('X-CSRF-Token', a.csrfToken)
      .send({ productId: pB })
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/public/${shopB.shopSlug}/account/wishlist/${pA}`)
      .set('Cookie', a.cookieHeaderStr)
      .set('X-CSRF-Token', a.csrfToken)
      .expect(401);

    // Shop B's product id, posted to shop A's own wishlist route — not an
    // Available product in shop A, so 404, and A's list is untouched.
    await addToWishlist(a, shopA.shopSlug, pB).expect(404);
    expect(body<number[]>(await getWishlist(a, shopA.shopSlug).expect(200))).toEqual([pA]);
  });

  it('rejects unauthenticated access on every verb', async () => {
    const shop = await setupShop('wl-noauth');
    const p = await createProduct(shop.adminToken, shop.collectionId, 'na');
    await request(app.getHttpServer())
      .get(`/public/${shop.shopSlug}/account/wishlist`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/public/${shop.shopSlug}/account/wishlist`)
      .send({ productId: p })
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/public/${shop.shopSlug}/account/wishlist/${p}`)
      .expect(401);
  });

  it('enforces CSRF on the mutating routes (session cookie present, token header missing)', async () => {
    const shop = await setupShop('wl-csrf');
    const p = await createProduct(shop.adminToken, shop.collectionId, 'csrf');
    const s = sessionFromResponse(
      await register(shop.shopSlug, `05014${runId % 100000}`, `wl-csrf-${runId}@t.com`),
    );

    await request(app.getHttpServer())
      .post(`/public/${shop.shopSlug}/account/wishlist`)
      .set('Cookie', s.cookieHeaderStr)
      .send({ productId: p })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/public/${shop.shopSlug}/account/wishlist/${p}`)
      .set('Cookie', s.cookieHeaderStr)
      .expect(403);

    // A GET is exempt (no state change) and still works without the header.
    await getWishlist({ ...s, csrfToken: '' }, shop.shopSlug).expect(200);
  });

  it('caps the wishlist at 100 items with a 409, never a silent drop', async () => {
    const shop = await setupShop('wl-cap');
    // 100 minimal Available products inserted directly — this test is about
    // the cap, not product creation, and 100 API round trips would blow the
    // timeout. addToWishlist only checks product id/shopId/status, so no
    // shadow ingredient / relations are needed.
    const shopRow = await db.query<(IdRow & RowDataPacket)[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [shop.shopSlug],
    );
    const shopId = shopRow[0].id;
    const values: string[] = [];
    const params: (string | number)[] = [];
    for (let i = 0; i < 100; i++) {
      values.push('(?, ?, ?, ?, ?, ?, ?)');
      params.push(
        shopId,
        `cap-${i}`,
        50,
        `WL-CAP-${runId}-${i}`,
        'https://example.com/x.jpg',
        `wl-cap-${runId}-${i}`,
        'Available',
      );
    }
    await db.execute(
      `INSERT INTO product (shopId, name, price, sku, thumbnail, slug, status) VALUES ${values.join(', ')}`,
      params,
    );
    const rows = await db.query<(IdRow & RowDataPacket)[]>(
      `SELECT id FROM product WHERE shopId = ? AND sku LIKE ? ORDER BY id ASC`,
      [shopId, `WL-CAP-${runId}-%`],
    );
    const ids = rows.map((r) => r.id);
    expect(ids.length).toBe(100);

    const s = sessionFromResponse(
      await register(shop.shopSlug, `05015${runId % 100000}`, `wl-cap-${runId}@t.com`),
    );
    for (const id of ids) {
      await addToWishlist(s, shop.shopSlug, id).expect(201);
    }
    // The 101st product — a genuinely new, valid, Available id — is rejected.
    const extra = await createProduct(shop.adminToken, shop.collectionId, 'capextra');
    await addToWishlist(s, shop.shopSlug, extra).expect(409);
    expect(
      body<number[]>(await getWishlist(s, shop.shopSlug).expect(200)).length,
    ).toBe(100);
  });

  it('resolves a later-deleted product out of the account view without pruning the stored array', async () => {
    const shop = await setupShop('wl-del');
    const keep = await createProduct(shop.adminToken, shop.collectionId, 'keep');
    const gone = await createProduct(shop.adminToken, shop.collectionId, 'gone');
    const s = sessionFromResponse(
      await register(shop.shopSlug, `05016${runId % 100000}`, `wl-del-${runId}@t.com`),
    );
    await addToWishlist(s, shop.shopSlug, keep).expect(201);
    await addToWishlist(s, shop.shopSlug, gone).expect(201);

    await request(app.getHttpServer())
      .delete(`/products/${gone}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);

    // Raw ids: untouched (no sync).
    expect(
      body<number[]>(await getWishlist(s, shop.shopSlug).expect(200)).sort(),
    ).toEqual([keep, gone].sort());
    // Resolved cards: the deleted product is silently gone, no error.
    const products = body<{ id: number }[]>(
      await request(app.getHttpServer())
        .get(`/public/${shop.shopSlug}/account/wishlist/products`)
        .set('Cookie', s.cookieHeaderStr)
        .set('X-CSRF-Token', s.csrfToken)
        .expect(200),
    );
    expect(products.map((p) => p.id)).toEqual([keep]);
  });
});
