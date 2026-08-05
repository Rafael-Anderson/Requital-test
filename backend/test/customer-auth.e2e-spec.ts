import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
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
interface CustomerAuthResponse {
  accessToken: string;
  refreshToken: string;
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

describe('Customer storefront accounts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
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
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

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
    await verifySignupEmail(app.getHttpServer(), body<AdminAuthResponse>(signup).devVerificationLink);

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

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test Product',
        price: 50,
        thumbnail: 'https://example.com/x.jpg',
        sku: `CUST-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        trackInventory: true,
        categoryIds: [categoryId],
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

    return { shopSlug, adminToken, outletId, categoryId, productId };
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
    const guestCountBefore = await prisma.customer.count({
      where: {
        shopId: (
          await prisma.shop.findUniqueOrThrow({
            where: { subdomain: shopSlug },
          })
        ).id,
      },
    });
    expect(guestCountBefore).toBe(1);

    const res = await register(shopSlug, {
      phone,
      name: 'Now Registered',
    }).expect(201);
    const registered = body<CustomerAuthResponse>(res);

    const shop = await prisma.shop.findUniqueOrThrow({
      where: { subdomain: shopSlug },
    });
    const countAfter = await prisma.customer.count({
      where: { shopId: shop.id },
    });
    expect(countAfter).toBe(1); // still one row — claimed, not duplicated
    const dbCustomer = await prisma.customer.findUniqueOrThrow({
      where: { shopId_phone: { shopId: shop.id, phone } },
    });
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

    const registered = await register(shopSlug, { phone }).expect(201);
    const { accessToken } = body<CustomerAuthResponse>(registered);

    const orders = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/orders`)
      .set('Authorization', `Bearer ${accessToken}`)
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
    const regA = await register(shopSlug, {
      phone: '0505555551',
      name: 'Customer A',
    }).expect(201);
    const regB = await register(shopSlug, {
      phone: '0505555552',
      name: 'Customer B',
    }).expect(201);
    const tokenA = body<CustomerAuthResponse>(regA).accessToken;
    const tokenB = body<CustomerAuthResponse>(regB).accessToken;

    const orderA = await guestCheckout(shopSlug, outletId, productId, {
      customerPhone: '0505555551',
    });
    const orderAId = body<OrderCreateResponse>(orderA).order.id;

    const listB = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/orders`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(body<OrderSummary[]>(listB).map((o) => o.id)).not.toContain(
      orderAId,
    );

    // Adversarial: B tries to fetch A's order directly by (guessed/known) id.
    const detailAttempt = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/orders/${orderAId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(detailAttempt.status).toBe(404);

    // A can see it themselves, for sanity.
    const detailOwn = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/orders/${orderAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
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
    const custA = body<CustomerAuthResponse>(regA).customer;
    const custB = body<CustomerAuthResponse>(regB).customer;
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

  it("a customer session token for Shop A is rejected on Shop B's account endpoints", async () => {
    const shopA = await setupShop('acct-tokenxshop-a');
    const shopB = await setupShop('acct-tokenxshop-b');
    const regA = await register(shopA.shopSlug, { phone: '0507777777' }).expect(
      201,
    );
    const tokenA = body<CustomerAuthResponse>(regA).accessToken;

    const attempt = await request(app.getHttpServer())
      .get(`/public/${shopB.shopSlug}/account/orders`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(attempt.status).toBe(401);

    // Same token still works fine against its own shop.
    await request(app.getHttpServer())
      .get(`/public/${shopA.shopSlug}/account/orders`)
      .set('Authorization', `Bearer ${tokenA}`)
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
    const reg = await register(shopSlug, { phone: '0509999999' }).expect(201);
    const token = body<CustomerAuthResponse>(reg).accessToken;

    const created = await request(app.getHttpServer())
      .post(`/public/${shopSlug}/account/addresses`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Home', address: '1 Test St', emirate: 'Dubai' })
      .expect(201);
    const addressId = body<AddressRow>(created).id;

    const updated = await request(app.getHttpServer())
      .patch(`/public/${shopSlug}/account/addresses/${addressId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Home (updated)' })
      .expect(200);
    expect(body<AddressRow>(updated).label).toBe('Home (updated)');

    const list = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/addresses`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(body<AddressRow[]>(list)).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/public/${shopSlug}/account/addresses/${addressId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const listAfter = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/addresses`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(body<AddressRow[]>(listAfter)).toHaveLength(0);
  });

  it('a staff (admin) token is rejected on customer account endpoints, and a customer token is rejected on staff endpoints', async () => {
    const { shopSlug, adminToken } = await setupShop('acct-crossauth');
    const reg = await register(shopSlug, { phone: '0501230000' }).expect(201);
    const customerToken = body<CustomerAuthResponse>(reg).accessToken;

    const staffOnCustomerRoute = await request(app.getHttpServer())
      .get(`/public/${shopSlug}/account/orders`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(staffOnCustomerRoute.status).toBe(401);

    const customerOnStaffRoute = await request(app.getHttpServer())
      .get('/products')
      .set('Authorization', `Bearer ${customerToken}`);
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
});
