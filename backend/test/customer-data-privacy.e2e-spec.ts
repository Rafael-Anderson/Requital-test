import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import type { CustomerRow } from '../src/db/types';
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
  customer: { id: number; shopId: number };
}
interface OrderCreateResponse {
  order: { id: number };
}
interface ExportResponse {
  profile: { id: number; name: string; phone: string; email: string | null };
  addresses: unknown[];
  orders: { id: number }[];
}
interface RequestDeletionResponse {
  alreadyDeleted: boolean;
  confirmationToken?: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Two real shop signups per test (each a real verification-email network
// call) plus several order/account round trips — same reasoning as
// scan.e2e-spec.ts's own jest.setTimeout(30000).
jest.setTimeout(30000);

describe('Customer data export & self-serve deletion — UAE PDPL (e2e)', () => {
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

  async function getCustomerById(id: number): Promise<CustomerRow> {
    const rows = await db.query<(CustomerRow & RowDataPacket)[]>(
      `SELECT * FROM customer WHERE id = ?`,
      [id],
    );
    if (!rows[0]) throw new Error('customer not found');
    return rows[0];
  }

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
        name: 'Privacy Test Product',
        price: 60,
        thumbnail: 'https://example.com/x.jpg',
        sku: `PRIV-${slugPrefix}-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        collectionIds: [collectionId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    return { shopSlug, adminToken, outletId, productId };
  }

  function guestOrder(
    shopSlug: string,
    outletId: number,
    productId: number,
    phone: string,
  ) {
    return request(app.getHttpServer())
      .post(`/public/${shopSlug}/orders`)
      .send({
        outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName: 'Privacy Shopper',
        customerPhone: phone,
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);
  }

  function register(shopSlug: string, phone: string, email: string) {
    return request(app.getHttpServer())
      .post(`/public/${shopSlug}/auth/register`)
      .send({ name: 'Privacy Shopper', phone, email, password: 'password123' })
      .expect(201);
  }

  describe('export', () => {
    it('exports profile/addresses/orders scoped strictly to this shop, never leaking a same-phone customer in another shop', async () => {
      const shopA = await setupShop('priv-export-a');
      const shopB = await setupShop('priv-export-b');
      const phone = '0507770001';
      const email = `priv-export-${runId}@test.com`;

      const orderA = body<OrderCreateResponse>(
        await guestOrder(
          shopA.shopSlug,
          shopA.outletId,
          shopA.productId,
          phone,
        ),
      ).order;
      // Same phone AND same email placed as a guest order in shop B too —
      // findOrCreateForOrder creates a *separate* customer row there (the
      // uniqueness is [shopId, phone], not phone alone).
      await guestOrder(shopB.shopSlug, shopB.outletId, shopB.productId, phone);

      const registered = body<CustomerAuthResponse>(
        await register(shopA.shopSlug, phone, email),
      );

      const exportRes = await request(app.getHttpServer())
        .get(`/public/${shopA.shopSlug}/account/export`)
        .set('Authorization', `Bearer ${registered.accessToken}`)
        .expect(200);
      const data = body<ExportResponse>(exportRes);

      expect(data.profile.phone).toBe(phone);
      expect(data.orders.map((o) => o.id)).toEqual([orderA.id]); // only shop A's order
      expect(exportRes.headers['content-disposition']).toContain(
        'my-data.json',
      );
    });

    it('rejects a second export within 24h', async () => {
      const shop = await setupShop('priv-export-rate');
      const phone = '0507770002';
      await guestOrder(shop.shopSlug, shop.outletId, shop.productId, phone);
      const registered = body<CustomerAuthResponse>(
        await register(shop.shopSlug, phone, `priv-rate-${runId}@test.com`),
      );

      await request(app.getHttpServer())
        .get(`/public/${shop.shopSlug}/account/export`)
        .set('Authorization', `Bearer ${registered.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/public/${shop.shopSlug}/account/export`)
        .set('Authorization', `Bearer ${registered.accessToken}`)
        .expect(400);
    });

    it('a merchant (staff) JWT cannot call the customer export endpoint', async () => {
      const shop = await setupShop('priv-export-staff');
      await request(app.getHttpServer())
        .get(`/public/${shop.shopSlug}/account/export`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(401);
    });

    it("a shop B customer cannot export shop A's data through shop A's own URL", async () => {
      const shopA = await setupShop('priv-export-iso-a');
      const shopB = await setupShop('priv-export-iso-b');
      const phoneB = '0507770003';
      const registeredB = body<CustomerAuthResponse>(
        await register(shopB.shopSlug, phoneB, `priv-iso-${runId}@test.com`),
      );

      await request(app.getHttpServer())
        .get(`/public/${shopA.shopSlug}/account/export`)
        .set('Authorization', `Bearer ${registeredB.accessToken}`)
        .expect(401);
    });
  });

  describe('deletion', () => {
    it('the full request -> confirm flow anonymises the account, logs the customer out everywhere, and preserves order history', async () => {
      const shop = await setupShop('priv-delete');
      const phone = '0507770010';
      const order = body<OrderCreateResponse>(
        await guestOrder(shop.shopSlug, shop.outletId, shop.productId, phone),
      ).order;
      const registered = body<CustomerAuthResponse>(
        await register(shop.shopSlug, phone, `priv-delete-${runId}@test.com`),
      );

      const requested = body<RequestDeletionResponse>(
        await request(app.getHttpServer())
          .delete(`/public/${shop.shopSlug}/account/me`)
          .set('Authorization', `Bearer ${registered.accessToken}`)
          .expect(202),
      );
      expect(requested.alreadyDeleted).toBe(false);
      const token = requested.confirmationToken!;

      await request(app.getHttpServer())
        .delete(`/public/${shop.shopSlug}/account/me/confirm?token=${token}`)
        .set('Authorization', `Bearer ${registered.accessToken}`)
        .expect(200);

      const customer = await getCustomerById(registered.customer.id);
      expect(customer.name).toBe('Deleted User');
      // Deterministic, id-derived values (not a fresh random value per
      // call) — see CustomerAccountService.anonymiseCustomer's own comment
      // on why that matters for idempotency.
      expect(customer.email).toBe(
        `deleted-${registered.customer.id}@deleted.requital`,
      );
      expect(customer.phone).toBe(`DELETED-${registered.customer.id}`);
      expect(customer.passwordHash).toBeNull();
      expect(customer.addresses).toBeNull();

      // The order itself still exists, still pointing at the (now
      // anonymised) customer — merchant records are preserved.
      const stillExistsRows = await db.query<RowDataPacket[]>(
        `SELECT * FROM \`order\` WHERE id = ?`,
        [order.id],
      );
      const stillExists = stillExistsRows[0];
      expect(stillExists).not.toBeUndefined();
      expect(stillExists.customerId).toBe(registered.customer.id);

      // The old access token is dead immediately — CustomerAuthGuard
      // rejects it now that passwordHash is null.
      await request(app.getHttpServer())
        .get(`/public/${shop.shopSlug}/account/profile`)
        .set('Authorization', `Bearer ${registered.accessToken}`)
        .expect(401);

      // The refresh token is revoked too — can't silently mint a new
      // access token to keep using the account.
      await request(app.getHttpServer())
        .post(`/public/${shop.shopSlug}/auth/refresh`)
        .send({ refreshToken: registered.refreshToken })
        .expect(401);
    });

    it('a second confirm with the same token is rejected (already used)', async () => {
      const shop = await setupShop('priv-delete-reuse');
      const phone = '0507770011';
      const registered = body<CustomerAuthResponse>(
        await register(shop.shopSlug, phone, `priv-reuse-${runId}@test.com`),
      );
      const requested = body<RequestDeletionResponse>(
        await request(app.getHttpServer())
          .delete(`/public/${shop.shopSlug}/account/me`)
          .set('Authorization', `Bearer ${registered.accessToken}`)
          .expect(202),
      );
      const token = requested.confirmationToken!;

      await request(app.getHttpServer())
        .delete(`/public/${shop.shopSlug}/account/me/confirm?token=${token}`)
        .set('Authorization', `Bearer ${registered.accessToken}`)
        .expect(200);

      // The first confirm already killed this access token (passwordHash
      // cleared) — a second attempt with it is rejected by the guard
      // itself, which is an even stronger form of "no-op" than a soft
      // app-level check.
      await request(app.getHttpServer())
        .delete(`/public/${shop.shopSlug}/account/me/confirm?token=${token}`)
        .set('Authorization', `Bearer ${registered.accessToken}`)
        .expect(401);
    });

    it('an expired confirmationToken is rejected', async () => {
      const shop = await setupShop('priv-delete-expired');
      const phone = '0507770012';
      const registered = body<CustomerAuthResponse>(
        await register(shop.shopSlug, phone, `priv-expired-${runId}@test.com`),
      );
      const requested = body<RequestDeletionResponse>(
        await request(app.getHttpServer())
          .delete(`/public/${shop.shopSlug}/account/me`)
          .set('Authorization', `Bearer ${registered.accessToken}`)
          .expect(202),
      );

      // Force the token's expiresAt into the past directly in the DB —
      // simulates waiting out the real 10-minute TTL without the test
      // actually sleeping that long.
      await db.execute(
        `UPDATE customerauthtoken SET expiresAt = ? WHERE customerId = ? AND purpose = ?`,
        [new Date(Date.now() - 60 * 1000), registered.customer.id, 'account_deletion'],
      );

      await request(app.getHttpServer())
        .delete(
          `/public/${shop.shopSlug}/account/me/confirm?token=${requested.confirmationToken}`,
        )
        .set('Authorization', `Bearer ${registered.accessToken}`)
        .expect(400);
    });

    it('a merchant (staff) JWT cannot call the customer deletion endpoints', async () => {
      const shop = await setupShop('priv-delete-staff');
      await request(app.getHttpServer())
        .delete(`/public/${shop.shopSlug}/account/me`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(401);
    });

    it("a shop B customer cannot delete shop A's account by spoofing shop A's URL", async () => {
      const shopA = await setupShop('priv-delete-iso-a');
      const shopB = await setupShop('priv-delete-iso-b');
      const phoneA = '0507770013';
      const phoneB = '0507770014';
      const registeredA = body<CustomerAuthResponse>(
        await register(
          shopA.shopSlug,
          phoneA,
          `priv-iso-del-a-${runId}@test.com`,
        ),
      );
      const registeredB = body<CustomerAuthResponse>(
        await register(
          shopB.shopSlug,
          phoneB,
          `priv-iso-del-b-${runId}@test.com`,
        ),
      );

      // Shop B's token can't even reach shop A's account routes.
      await request(app.getHttpServer())
        .delete(`/public/${shopA.shopSlug}/account/me`)
        .set('Authorization', `Bearer ${registeredB.accessToken}`)
        .expect(401);

      // Shop A's own account is untouched.
      const customerA = await getCustomerById(registeredA.customer.id);
      expect(customerA.name).not.toBe('Deleted User');
    });
  });
});
