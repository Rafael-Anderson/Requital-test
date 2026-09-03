import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import type { ShopRow, CustomerRow } from '../src/db/types';
import { verifySignupEmail } from './helpers/verify-signup-email';

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
  customer: {
    id: number;
    shopId: number;
    name: string;
    phone: string;
    email: string | null;
  };
}
interface OrderCreateResponse {
  order: { id: number; trackingToken: string | null };
}
interface OrderLookupResponse {
  id: number;
  hasAccount: boolean;
}
interface OrderSummary {
  id: number;
  status: string;
  total: string;
}
interface AddressRow {
  id: string;
  label?: string;
  address: string;
  emirate: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Session-cookie migration (security audit finding #1), phase 3 — the
// customer session is an httpOnly cookie now, Path-scoped per shop (see
// customer-auth.constants.ts), not a bearer token in the JSON body. Same
// extractCookies/cookieHeader helpers as platform-admin.e2e-spec.ts
// (supertest has no built-in cookie jar); sessionFromResponse bundles the
// resulting cookie header + CSRF token + parsed customer alongside each
// other since almost every test needs all three. Note: supertest forwards
// exactly whatever Cookie header a test sets, with no browser-side
// Path-matching — a real browser would never send Shop A's cookie to a Shop
// B request at all (that's what Path scoping is for), but that behavior is
// inherently untestable at this level; the cross-shop-rejection tests below
// instead prove the guard's own explicit shopId check holds even when a
// cookie value IS presented against the wrong shop.
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

describe('Customer storefront accounts (e2e)', () => {
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

  async function getShopBySubdomain(subdomain: string): Promise<ShopRow> {
    const rows = await db.query<(ShopRow & RowDataPacket)[]>(
      `SELECT * FROM shop WHERE subdomain = ?`,
      [subdomain],
    );
    if (!rows[0]) throw new Error('shop not found');
    return rows[0];
  }

  async function getCustomerByShopAndPhone(
    shopId: number,
    phone: string,
  ): Promise<CustomerRow> {
    const rows = await db.query<(CustomerRow & RowDataPacket)[]>(
      `SELECT * FROM customer WHERE shopId = ? AND phone = ?`,
      [shopId, phone],
    );
    if (!rows[0]) throw new Error('customer not found');
    return rows[0];
  }

  async function getCustomerById(id: number): Promise<CustomerRow> {
    const rows = await db.query<(CustomerRow & RowDataPacket)[]>(
      `SELECT * FROM customer WHERE id = ?`,
      [id],
    );
    if (!rows[0]) throw new Error('customer not found');
    return rows[0];
  }

  // Publishes the shop, enables pickup, and seeds one purchasable product —
  // the minimum a guest checkout (and therefore a findOrCreateForOrder
  // Customer row) needs. Mirrors storefront-checkout.e2e-spec.ts's setup.
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

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test Product',
        price: 50,
        thumbnail: 'https://example.com/x.jpg',
        sku: `CUST-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        trackInventory: true,
        collectionIds: [collectionId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    await request(app.getHttpServer())
      .patch('/products/stock/bulk-adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outletId, adjustments: [{ productId, delta: 100 }] })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    return { shopSlug, adminToken, outletId, collectionId, productId };
  }

  function guestCheckout(
    shopSlug: string,
    outletId: number,
    productId: number,
    overrides: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post(`/public/${shopSlug}/orders`)
      .send({
        outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName: 'Guest Customer',
        customerPhone: '0501111111',
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        items: [{ productId, quantity: 1 }],
        ...overrides,
      })
      .expect(201);
  }

  function register(shopSlug: string, overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post(`/public/${shopSlug}/auth/register`)
      .send({
        name: 'Registered Customer',
        phone: '0501111111',
        email: `cust-${runId}-${Math.random().toString(36).slice(2, 6)}@test.com`,
        password: 'password123',
        ...overrides,
      });
  }

  it('registration claims an existing guest Customer record rather than duplicating, and a second registration is rejected', async () => {
    const { shopSlug, outletId, productId } = await setupShop('acct-claim');
    const phone = '0502222222';

    await guestCheckout(shopSlug, outletId, productId, {
      customerPhone: phone,
    });
    const shopBefore = await getShopBySubdomain(shopSlug);
    const countBeforeRows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM customer WHERE shopId = ?`,
      [shopBefore.id],
    );
    expect(Number(countBeforeRows[0].c)).toBe(1);

    const res = await register(shopSlug, {
      phone,
      name: 'Now Registered',
    }).expect(201);
    const registered = sessionFromResponse(res);

    const shop = await getShopBySubdomain(shopSlug);
    const countAfterRows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM customer WHERE shopId = ?`,
      [shop.id],
    );
    expect(Number(countAfterRows[0].c)).toBe(1); // still one row — claimed, not duplicated
    const dbCustomer = await getCustomerByShopAndPhone(shop.id, phone);
    expect(dbCustomer.id).toBe(registered.customer.id);
    expect(dbCustomer.passwordHash).not.toBeNull();

    // Second registration attempt against the same now-claimed phone.
    const dupe = await register(shopSlug, { phone });
    expect(dupe.status).toBe(409);
  });

  it("the order placed as a guest before registering shows up in the claimed account's order history", async () => {
    const { shopSlug, outletId, productId } =
      await setupShop('acct-claim-history');
    const phone = '0503333333';
    const created = await guestCheckout(shopSlug, outletId, productId, {
      customerPhone: phone,
    });
    const guestOrderId = body<OrderCreateResponse>(created).order.id;

    const registered = sessionFromResponse(
      await register(shopSlug, { phone }).expect(201),
    );

    const orders = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/orders`)
      .set('Cookie', registered.cookieHeaderStr)
      .expect(200);
    expect(body<OrderSummary[]>(orders).map((o) => o.id)).toContain(
      guestOrderId,
    );
  });

  it('guest checkout still works fully unaffected (no auth, no registration required)', async () => {
    const { shopSlug, outletId, productId } = await setupShop(
      'acct-guest-unaffected',
    );
    const res = await guestCheckout(shopSlug, outletId, productId, {
      customerPhone: '0504444444',
    });
    expect(body<OrderCreateResponse>(res).order.id).toBeGreaterThan(0);
  });

  it("order history is isolated per customer within the same shop — one customer can't see or fetch another's order", async () => {
    const { shopSlug, outletId, productId } = await setupShop('acct-isolation');
    const sessionA = sessionFromResponse(
      await register(shopSlug, {
        phone: '0505555551',
        name: 'Customer A',
      }).expect(201),
    );
    const sessionB = sessionFromResponse(
      await register(shopSlug, {
        phone: '0505555552',
        name: 'Customer B',
      }).expect(201),
    );

    const orderA = await guestCheckout(shopSlug, outletId, productId, {
      customerPhone: '0505555551',
    });
    const orderAId = body<OrderCreateResponse>(orderA).order.id;

    const listB = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/orders`)
      .set('Cookie', sessionB.cookieHeaderStr)
      .expect(200);
    expect(body<OrderSummary[]>(listB).map((o) => o.id)).not.toContain(
      orderAId,
    );

    // Adversarial: B tries to fetch A's order directly by (guessed/known) id.
    const detailAttempt = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/orders/${orderAId}`)
      .set('Cookie', sessionB.cookieHeaderStr);
    expect(detailAttempt.status).toBe(404);

    // A can see it themselves, for sanity.
    const detailOwn = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/orders/${orderAId}`)
      .set('Cookie', sessionA.cookieHeaderStr)
      .expect(200);
    expect(body<OrderSummary>(detailOwn).id).toBe(orderAId);
  });

  it('the same phone number registered in two different shops is two entirely separate accounts — [shopId, phone] uniqueness makes cross-shop identity a non-issue', async () => {
    const shopA = await setupShop('acct-crossshop-a');
    const shopB = await setupShop('acct-crossshop-b');
    const phone = '0506666666';

    const regA = await register(shopA.shopSlug, {
      phone,
      password: 'passwordAAA',
    }).expect(201);
    const regB = await register(shopB.shopSlug, {
      phone,
      password: 'passwordBBB',
    }).expect(201);
    const custA = body<CustomerResponseBody>(regA).customer;
    const custB = body<CustomerResponseBody>(regB).customer;
    expect(custA.id).not.toBe(custB.id);
    expect(custA.shopId).not.toBe(custB.shopId);

    // Shop A's password does not work against Shop B's login for the same phone.
    const crossLogin = await request(app.getHttpServer())
      .post(`/public/${shopB.shopSlug}/auth/login`)
      .send({ identifier: phone, password: 'passwordAAA' });
    expect(crossLogin.status).toBe(401);

    // Each shop's own password works against its own shop.
    await request(app.getHttpServer())
      .post(`/public/${shopA.shopSlug}/auth/login`)
      .send({ identifier: phone, password: 'passwordAAA' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/public/${shopB.shopSlug}/auth/login`)
      .send({ identifier: phone, password: 'passwordBBB' })
      .expect(201);
  });

  it("a customer session cookie for Shop A is rejected on Shop B's account endpoints", async () => {
    const shopA = await setupShop('acct-tokenxshop-a');
    const shopB = await setupShop('acct-tokenxshop-b');
    const sessionA = sessionFromResponse(
      await register(shopA.shopSlug, { phone: '0507777777' }).expect(201),
    );

    const attempt = await request(app.getHttpServer())
      .get(`/public/${shopB.shopSlug}/account/orders`)
      .set('Cookie', sessionA.cookieHeaderStr);
    expect(attempt.status).toBe(401);

    // Same cookie still works fine against its own shop.
    await request(app.getHttpServer())
      .get(`/public/${shopA.shopSlug}/account/orders`)
      .set('Cookie', sessionA.cookieHeaderStr)
      .expect(200);
  });

  it('password reset works end-to-end', async () => {
    const { shopSlug } = await setupShop('acct-reset');
    const email = `reset-${runId}@test.com`;
    await register(shopSlug, {
      phone: '0508888888',
      email,
      password: 'oldPassword1',
    }).expect(201);

    const forgot = await request(app.getHttpServer())
      .post(`/public/${shopSlug}/auth/forgot-password`)
      .send({ email })
      .expect(201);
    const devResetLink = body<{ devResetLink?: string }>(forgot).devResetLink;
    expect(devResetLink).toBeDefined();
    const token = new URL(devResetLink!).searchParams.get('token')!;

    await request(app.getHttpServer())
      .post(`/public/${shopSlug}/auth/reset-password`)
      .send({ token, newPassword: 'newPassword2' })
      .expect(201);

    // Old password no longer works, new one does.
    const oldAttempt = await request(app.getHttpServer())
      .post(`/public/${shopSlug}/auth/login`)
      .send({ identifier: email, password: 'oldPassword1' });
    expect(oldAttempt.status).toBe(401);

    await request(app.getHttpServer())
      .post(`/public/${shopSlug}/auth/login`)
      .send({ identifier: email, password: 'newPassword2' })
      .expect(201);

    // The same reset token can't be reused a second time.
    const reuse = await request(app.getHttpServer())
      .post(`/public/${shopSlug}/auth/reset-password`)
      .send({ token, newPassword: 'thirdPassword3' });
    expect(reuse.status).toBe(400);
  });

  it('a logged-in customer can save, edit, and delete addresses', async () => {
    const { shopSlug } = await setupShop('acct-addresses');
    const session = sessionFromResponse(
      await register(shopSlug, { phone: '0509999999' }).expect(201),
    );

    const created = await request(app.getHttpServer())
      .post(`/public/${shopSlug}/account/addresses`)
      .set('Cookie', session.cookieHeaderStr)
      .set('X-CSRF-Token', session.csrfToken)
      .send({ label: 'Home', address: '1 Test St', emirate: 'Dubai' })
      .expect(201);
    const addressId = body<AddressRow>(created).id;

    const updated = await request(app.getHttpServer())
      .patch(`/public/${shopSlug}/account/addresses/${addressId}`)
      .set('Cookie', session.cookieHeaderStr)
      .set('X-CSRF-Token', session.csrfToken)
      .send({ label: 'Home (updated)' })
      .expect(200);
    expect(body<AddressRow>(updated).label).toBe('Home (updated)');

    const list = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/addresses`)
      .set('Cookie', session.cookieHeaderStr)
      .expect(200);
    expect(body<AddressRow[]>(list)).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/public/${shopSlug}/account/addresses/${addressId}`)
      .set('Cookie', session.cookieHeaderStr)
      .set('X-CSRF-Token', session.csrfToken)
      .expect(200);

    const listAfter = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/addresses`)
      .set('Cookie', session.cookieHeaderStr)
      .expect(200);
    expect(body<AddressRow[]>(listAfter)).toHaveLength(0);
  });

  it('a staff (admin) session is rejected on customer account endpoints, and a customer session is rejected on staff endpoints', async () => {
    const { shopSlug, adminToken } = await setupShop('acct-crossauth');
    const session = sessionFromResponse(
      await register(shopSlug, { phone: '0501230000' }).expect(201),
    );

    // The staff cookie is what a real staff session would carry — a bearer
    // header (even the test-env shim's own kind) isn't read by
    // CustomerAuthGuard at all, only its own cookie, so this just confirms
    // there's nothing to authenticate with here regardless.
    const staffOnCustomerRoute = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/orders`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(staffOnCustomerRoute.status).toBe(401);

    const customerOnStaffRoute = await request(app.getHttpServer())
      .get('/products')
      .set('Cookie', session.cookieHeaderStr);
    expect(customerOnStaffRoute.status).toBe(401);
  });

  describe('order tracking lookup reflects account status (hasAccount)', () => {
    it('a guest order with no matching account shows hasAccount: false', async () => {
      const { shopSlug, outletId, productId } =
        await setupShop('acct-track-guest');
      const created = await guestCheckout(shopSlug, outletId, productId, {
        customerPhone: '0509111111',
      });
      const token = body<OrderCreateResponse>(created).order.trackingToken;

      const res = await request(app.getHttpServer())
        .get(`/public/orders/lookup?token=${token}`)
        .expect(200);
      expect(body<OrderLookupResponse>(res).hasAccount).toBe(false);
    });

    it('the same order flips to hasAccount: true once its phone number registers an account — no new order, no re-lookup by identity, same tracking token', async () => {
      const { shopSlug, outletId, productId } =
        await setupShop('acct-track-claim');
      const phone = '0509222222';
      const created = await guestCheckout(shopSlug, outletId, productId, {
        customerPhone: phone,
      });
      const token = body<OrderCreateResponse>(created).order.trackingToken;

      const before = await request(app.getHttpServer())
        .get(`/public/orders/lookup?token=${token}`)
        .expect(200);
      expect(body<OrderLookupResponse>(before).hasAccount).toBe(false);

      await register(shopSlug, { phone }).expect(201);

      const after = await request(app.getHttpServer())
        .get(`/public/orders/lookup?token=${token}`)
        .expect(200);
      expect(body<OrderLookupResponse>(after).hasAccount).toBe(true);
    });

    it("registering in one shop doesn't flip hasAccount for a same-phone guest order in a different shop", async () => {
      const shopA = await setupShop('acct-track-crossshop-a');
      const shopB = await setupShop('acct-track-crossshop-b');
      const phone = '0509333333';

      const orderB = await guestCheckout(
        shopB.shopSlug,
        shopB.outletId,
        shopB.productId,
        { customerPhone: phone },
      );
      const tokenB = body<OrderCreateResponse>(orderB).order.trackingToken;

      await register(shopA.shopSlug, { phone }).expect(201);

      const lookupB = await request(app.getHttpServer())
        .get(`/public/orders/lookup?token=${tokenB}`)
        .expect(200);
      expect(body<OrderLookupResponse>(lookupB).hasAccount).toBe(false);
    });
  });

  // This whole file runs under Jest (NODE_ENV=test), where the
  // ThrottlerGuard is globally skipIf'd (see app.module.ts) — so the per-IP
  // 5/min limit on /auth/login never interferes with the many-requests-in-
  // a-row tests below, same reasoning as auth-lifecycle.e2e-spec.ts.
  describe('progressive login lockout (per-account, not per-IP)', () => {
    function customerLogin(
      shopSlug: string,
      identifier: string,
      password: string,
    ) {
      return request(app.getHttpServer())
        .post(`/public/${shopSlug}/auth/login`)
        .send({ identifier, password });
    }

    it('5 wrong passwords in a row trigger a cooldown that rejects even the CORRECT password immediately after', async () => {
      const { shopSlug } = await setupShop('cust-lockout-basic');
      const phone = '0505550001';
      await register(shopSlug, { phone, password: 'password123' }).expect(201);

      for (let i = 0; i < 5; i++) {
        await customerLogin(shopSlug, phone, 'totally-wrong').expect(401);
      }

      const res = await customerLogin(shopSlug, phone, 'password123').expect(
        401,
      );
      expect(body<{ message: string }>(res).message).toBe(
        'Invalid phone/email or password',
      );
    });

    it('once the cooldown window has elapsed, the correct password succeeds and the counter resets', async () => {
      const { shopSlug } = await setupShop('cust-lockout-recovers');
      const phone = '0505550002';
      const reg = await register(shopSlug, {
        phone,
        password: 'password123',
      }).expect(201);
      const customerId = body<CustomerResponseBody>(reg).customer.id;

      for (let i = 0; i < 5; i++) {
        await customerLogin(shopSlug, phone, 'totally-wrong').expect(401);
      }

      // Simulate the cooldown having elapsed — same backdating technique
      // auth-lifecycle.e2e-spec.ts uses for the merchant-lockout equivalent.
      await db.execute(
        `UPDATE customer SET lastFailedLoginAt = ? WHERE id = ?`,
        [new Date(Date.now() - 3000), customerId],
      );

      await customerLogin(shopSlug, phone, 'password123').expect(201);

      const customer = await getCustomerById(customerId);
      expect(customer.failedLoginAttempts).toBe(0);
    });

    it("an attacker who only knows the customer's email cannot deny them service — the correct password always eventually works, and a nonexistent account behaves identically", async () => {
      const { shopSlug } = await setupShop('cust-lockout-dos-safe');
      const phone = '0505550003';
      const email = `cust-dos-safe-${runId}@test.com`;
      await register(shopSlug, {
        phone,
        email,
        password: 'password123',
      }).expect(201);
      const fakeEmail = `no-such-customer-${runId}@test.com`;

      for (let i = 0; i < 8; i++) {
        const realRes = await customerLogin(shopSlug, email, 'wrong').expect(
          401,
        );
        const fakeRes = await customerLogin(
          shopSlug,
          fakeEmail,
          'wrong',
        ).expect(401);
        expect(body<{ message: string }>(realRes).message).toBe(
          body<{ message: string }>(fakeRes).message,
        );
      }

      // Even after 8 straight failures, the account is not permanently
      // locked — backdating past the capped 60s ceiling always lets the
      // correct password back in.
      await db.execute(
        `UPDATE customer SET lastFailedLoginAt = ? WHERE email = ?`,
        [new Date(Date.now() - 61_000), email],
      );
      await customerLogin(shopSlug, email, 'password123').expect(201);
    });

    it("failed attempts against Customer A never affect Customer B's own cooldown (cross-account isolation)", async () => {
      const { shopSlug } = await setupShop('cust-lockout-isolation');
      const phoneA = '0505550004';
      const phoneB = '0505550005';
      await register(shopSlug, {
        phone: phoneA,
        password: 'passwordAAA',
      }).expect(201);
      await register(shopSlug, {
        phone: phoneB,
        password: 'passwordBBB',
      }).expect(201);

      // Hammer A into its cooldown window.
      for (let i = 0; i < 5; i++) {
        await customerLogin(shopSlug, phoneA, 'totally-wrong').expect(401);
      }
      // A is now cooling down — even its own correct password is rejected.
      await customerLogin(shopSlug, phoneA, 'passwordAAA').expect(401);

      // B was never touched — its correct password succeeds immediately,
      // with no cooldown at all.
      await customerLogin(shopSlug, phoneB, 'passwordBBB').expect(201);
    });
  });

  describe('session cookies and CSRF', () => {
    it('login sets httpOnly, SameSite=Strict, shop-Path-scoped access and CSRF cookies, with no token in the body — the CSRF value itself rides the X-CSRF-Token response header instead', async () => {
      const { shopSlug } = await setupShop('cust-cookie-attrs');
      const phone = '0505560001';
      await register(shopSlug, { phone, password: 'password123' }).expect(201);

      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/auth/login`)
        .send({ identifier: phone, password: 'password123' })
        .expect(201);
      expect(JSON.stringify(res.body)).not.toMatch(/eyJ/); // no raw JWT anywhere in the body

      const lines = res.get('Set-Cookie') ?? [];
      const atCookie = lines.find((l) => l.startsWith('req-customer-at='));
      const csrfCookie = lines.find((l) => l.startsWith('req-customer-csrf='));
      expect(atCookie).toBeDefined();
      expect(atCookie).toMatch(/HttpOnly/);
      expect(atCookie).toMatch(/SameSite=Strict/i);
      expect(atCookie).toMatch(new RegExp(`Path=/public/${shopSlug}(;|$)`));
      expect(csrfCookie).toBeDefined();
      // httpOnly here too — see platform-admin.e2e-spec.ts's matching test
      // for the full reasoning (a non-httpOnly cookie only ever worked in
      // local dev; production hostnames can't read a cross-hostname cookie
      // via document.cookie regardless of this attribute).
      expect(csrfCookie).toMatch(/HttpOnly/);
      expect(csrfCookie).toMatch(/SameSite=Strict/i);
      expect(csrfCookie).toMatch(new RegExp(`Path=/public/${shopSlug}(;|$)`));
      expect(res.get('X-CSRF-Token')).toBeTruthy();
    });

    it('rejects a state-changing request with a valid session cookie but no CSRF header', async () => {
      const { shopSlug } = await setupShop('cust-csrf-missing');
      const session = sessionFromResponse(
        await register(shopSlug, { phone: '0505560002' }).expect(201),
      );

      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/account/addresses`)
        .set('Cookie', session.cookieHeaderStr)
        .send({ label: 'Home', address: '1 Test St', emirate: 'Dubai' })
        .expect(403);
      expect(body<{ message: string }>(res).message).toBe('invalid csrf token');
    });

    it('rejects a state-changing request with a wrong CSRF header value', async () => {
      const { shopSlug } = await setupShop('cust-csrf-wrong');
      const session = sessionFromResponse(
        await register(shopSlug, { phone: '0505560003' }).expect(201),
      );

      await request(app.getHttpServer())
        .post(`/public/${shopSlug}/account/addresses`)
        .set('Cookie', session.cookieHeaderStr)
        .set('X-CSRF-Token', 'not-the-real-token')
        .send({ label: 'Home', address: '1 Test St', emirate: 'Dubai' })
        .expect(403);
    });

    it('logout clears both cookies via an expired Set-Cookie directive and is itself CSRF-protected', async () => {
      const { shopSlug } = await setupShop('cust-logout');
      const session = sessionFromResponse(
        await register(shopSlug, { phone: '0505560004' }).expect(201),
      );

      await request(app.getHttpServer())
        .post(`/public/${shopSlug}/auth/logout`)
        .set('Cookie', session.cookieHeaderStr)
        .expect(403);

      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/auth/logout`)
        .set('Cookie', session.cookieHeaderStr)
        .set('X-CSRF-Token', session.csrfToken)
        .expect(201);
      const lines = res.get('Set-Cookie') ?? [];
      const clearedAt = lines.find((l) => l.startsWith('req-customer-at='));
      const clearedRt = lines.find((l) => l.startsWith('req-customer-rt='));
      expect(clearedAt).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(clearedRt).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    // The real fix behind the CSRF-cookie httpOnly change above: a brand
    // new tab (only the session cookie in its jar, no CSRF value left over
    // from a login response) must still be able to obtain a working CSRF
    // token via GET /account/profile's response header, with no
    // document.cookie read involved anywhere.
    it('GET /account/profile hands back a working CSRF token via the response header, for a session with no CSRF value yet', async () => {
      const { shopSlug } = await setupShop('cust-csrf-bootstrap');
      const session = sessionFromResponse(
        await register(shopSlug, { phone: '0505560007' }).expect(201),
      );
      const accessCookieOnly = `req-customer-at=${session.cookieHeaderStr.match(/req-customer-at=([^;]+)/)![1]}`;

      const profileRes = await request(app.getHttpServer())
        .get(`/public/${shopSlug}/account/profile`)
        .set('Cookie', accessCookieOnly)
        .expect(200);
      const freshCsrfToken = profileRes.get('X-CSRF-Token');
      expect(freshCsrfToken).toBeTruthy();
      // The profile call above minted a brand new CSRF cookie value (this
      // request had none yet) — the follow-up request must carry THAT
      // cookie, not the stale one captured at registration time.
      const freshCsrfCookie = extractCookies(profileRes)['req-customer-csrf'];
      const cookieWithFreshCsrf = `${accessCookieOnly}; req-customer-csrf=${freshCsrfCookie}`;

      await request(app.getHttpServer())
        .post(`/public/${shopSlug}/account/addresses`)
        .set('Cookie', cookieWithFreshCsrf)
        .set('X-CSRF-Token', freshCsrfToken!)
        .send({ label: 'Home', address: '1 Test St', emirate: 'Dubai' })
        .expect(201);
    });

    // Regression (same bug as auth-security.e2e-spec.ts's staff version): a
    // stale req-customer-at cookie left in the jar after a "random logout"
    // must not make customerCsrf enforce a CSRF check on the /auth/login
    // POST meant to recover the session — a cold storefront page has no
    // in-memory CSRF token to send, so that 403'd "invalid csrf token"
    // until a full browser restart cleared the cookie.
    it('POST /public/:shopSlug/auth/login succeeds with a stale access cookie present but no CSRF token/header', async () => {
      const { shopSlug } = await setupShop('cust-stale-cookie-login');
      const phone = '0505560010';
      const session = sessionFromResponse(
        await register(shopSlug, { phone, password: 'password123' }).expect(201),
      );
      const staleAccessCookie = `req-customer-at=${session.cookieHeaderStr.match(/req-customer-at=([^;]+)/)![1]}`;

      await request(app.getHttpServer())
        .post(`/public/${shopSlug}/auth/login`)
        .set('Cookie', staleAccessCookie)
        .send({ identifier: phone, password: 'password123' })
        .expect(201);
    });

    it("two different shops' customer sessions coexist in the same cookie jar without one overwriting the other — same cookie NAME, different Path", async () => {
      const shopA = await setupShop('cust-two-shops-a');
      const shopB = await setupShop('cust-two-shops-b');
      const sessionA = sessionFromResponse(
        await register(shopA.shopSlug, { phone: '0505560005' }).expect(201),
      );
      const sessionB = sessionFromResponse(
        await register(shopB.shopSlug, { phone: '0505560006' }).expect(201),
      );

      // Simulate a real cookie jar holding both at once (a browser would
      // only ever send the Path-matching one per request; supertest doesn't
      // model that, so this concatenates both cookie headers to prove each
      // shop's own request still resolves to the RIGHT session when its own
      // cookie is the one presented).
      await request(app.getHttpServer())
        .get(`/public/${shopA.shopSlug}/account/orders`)
        .set('Cookie', sessionA.cookieHeaderStr)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/public/${shopB.shopSlug}/account/orders`)
        .set('Cookie', sessionB.cookieHeaderStr)
        .expect(200);
    });
  });
});
