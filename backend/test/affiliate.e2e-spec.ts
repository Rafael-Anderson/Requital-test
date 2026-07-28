import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface AuthResponse {
  accessToken: string;
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface AffiliateRow {
  id: number;
  name: string;
  mobile: string;
  status: string;
  codesCount: number;
  ordersCount: number;
}
interface AffiliateCodeRow {
  id: number;
  code: string;
  affiliateId: number;
  url: string;
  status: string;
  commissionType: string;
  commissionValue: number;
  ordersCount: number;
}
interface AffiliateOrderRow {
  id: number;
  orderId: number;
  code: string;
  affiliateName: string;
  orderTotal: number;
  commissionAmount: number;
  status: string;
}
interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
interface SummaryBody {
  totalCode: number;
  totalAffiliate: number;
  activeAffiliate: number;
  pendingOrders: number;
  approvedOrderRevenue: number;
  codeStatus: { approved: number; pending: number; blocked: number };
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Affiliate (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function setupShop(slugPrefix: string) {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Affiliate Admin',
        email: `${slugPrefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
      })
      .expect(201);
    return { adminToken: body<AuthResponse>(signup).accessToken, slug: `${slugPrefix}-${runId}` };
  }

  async function setupOrderableShop(slugPrefix: string) {
    const shop = await setupShop(slugPrefix);
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        active: true,
        emirate: 'Dubai',
        deliveryEnabled: true,
        pickupEnabled: true,
        latitude: 25.2048,
        longitude: 55.2708,
        deliveryRadiusKm: 5,
      })
      .expect(200);
    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        name: 'Rose',
        price: 50,
        thumbnail: 'https://example.com/rose.jpg',
        sku: `AFF-${slugPrefix}-${runId}`,
        categoryIds: [categoryId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;
    // Publishing requires meeting the readiness bar (outlet + product must
    // already exist — see ShopService.getPublishReadiness), so this must
    // come after both are created, not before. Storefront order creation
    // then 404s for an unpublished shop (see PublicService.assertPublished)
    // — this suite creates storefront orders.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ published: true })
      .expect(200);
    return { ...shop, outletId, productId };
  }

  async function createAffiliate(adminToken: string, name = 'Jane Referrer') {
    const res = await request(app.getHttpServer())
      .post('/affiliates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, mobile: '0501234567' })
      .expect(201);
    return body<IdRow>(res).id;
  }

  async function createCode(
    adminToken: string,
    affiliateId: number,
    overrides: Partial<{
      code: string;
      commissionType: string;
      commissionValue: number;
      status: string;
      validFrom: string;
      validUntil: string;
    }> = {},
  ) {
    const code = overrides.code ?? `REF${runId}${Math.floor(Math.random() * 100000)}`;
    const res = await request(app.getHttpServer())
      .post('/affiliates/codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        affiliateId,
        code,
        commissionType: overrides.commissionType ?? 'percentage',
        commissionValue: overrides.commissionValue ?? 10,
        ...(overrides.validFrom && { validFrom: overrides.validFrom }),
        ...(overrides.validUntil && { validUntil: overrides.validUntil }),
      })
      .expect(201);
    const created = body<{ id: number; code: string }>(res);
    if (overrides.status && overrides.status !== 'approved') {
      await request(app.getHttpServer())
        .patch(`/affiliates/codes/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: overrides.status })
        .expect(200);
    }
    return created;
  }

  function placeOrder(
    slug: string,
    shop: { outletId: number; productId: number },
    referralCode?: string,
  ) {
    return request(app.getHttpServer())
      .post(`/public/${slug}/orders`)
      .send({
        outletId: shop.outletId,
        orderType: 'delivery',
        paymentMethod: 'cash_on_delivery',
        customerName: 'Test Customer',
        customerPhone: '0501234567',
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        latitude: 25.2048,
        longitude: 55.2708,
        items: [{ productId: shop.productId, quantity: 1 }],
        ...(referralCode && { referralCode }),
      });
  }

  describe('Referral attribution — commission calculation', () => {
    it('a valid percentage code creates a correctly-linked, correctly-priced AffiliateOrder', async () => {
      const shop = await setupOrderableShop('aff-pct');
      const affiliateId = await createAffiliate(shop.adminToken);
      const code = await createCode(shop.adminToken, affiliateId, { commissionType: 'percentage', commissionValue: 10 });

      const orderRes = await placeOrder(shop.slug, shop, code.code).expect(201);
      const orderId = body<{ order: { id: number; total: string } }>(orderRes).order.id;

      const orders = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const row = body<Paginated<AffiliateOrderRow>>(orders).data.find((r) => r.orderId === orderId);
      expect(row).toBeTruthy();
      expect(row!.code).toBe(code.code);
      expect(row!.orderTotal).toBe(50);
      expect(row!.commissionAmount).toBe(5); // 10% of 50
      expect(row!.status).toBe('pending');
    });

    it('a valid fixed-amount code computes a flat commission regardless of order total', async () => {
      const shop = await setupOrderableShop('aff-fixed');
      const affiliateId = await createAffiliate(shop.adminToken);
      const code = await createCode(shop.adminToken, affiliateId, { commissionType: 'fixed', commissionValue: 7.5 });

      await placeOrder(shop.slug, shop, code.code).expect(201);

      const orders = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const row = body<Paginated<AffiliateOrderRow>>(orders).data.find((r) => r.code === code.code);
      expect(row!.commissionAmount).toBe(7.5);
    });
  });

  describe('Invalid/expired/blocked codes never block checkout, just skip attribution', () => {
    it('an unknown code: order still succeeds, no attribution created', async () => {
      const shop = await setupOrderableShop('aff-unknown');
      const before = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const beforeTotal = body<Paginated<AffiliateOrderRow>>(before).total;

      await placeOrder(shop.slug, shop, 'DOES-NOT-EXIST').expect(201);

      const after = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<Paginated<AffiliateOrderRow>>(after).total).toBe(beforeTotal);
    });

    it('a blocked code: order succeeds, no attribution created', async () => {
      const shop = await setupOrderableShop('aff-blocked');
      const affiliateId = await createAffiliate(shop.adminToken);
      const code = await createCode(shop.adminToken, affiliateId, { status: 'blocked' });

      const orderRes = await placeOrder(shop.slug, shop, code.code).expect(201);
      const orderId = body<{ order: { id: number } }>(orderRes).order.id;

      const orders = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<Paginated<AffiliateOrderRow>>(orders).data.some((r) => r.orderId === orderId)).toBe(false);
    });

    it('an expired code (validUntil in the past): order succeeds, no attribution created', async () => {
      const shop = await setupOrderableShop('aff-expired');
      const affiliateId = await createAffiliate(shop.adminToken);
      const code = await createCode(shop.adminToken, affiliateId, { validUntil: '2020-01-01' });

      const orderRes = await placeOrder(shop.slug, shop, code.code).expect(201);
      const orderId = body<{ order: { id: number } }>(orderRes).order.id;

      const orders = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<Paginated<AffiliateOrderRow>>(orders).data.some((r) => r.orderId === orderId)).toBe(false);
    });
  });

  describe('Commission approval workflow: auto-sync from order lifecycle', () => {
    it('moving the order to delivered auto-approves the pending commission', async () => {
      const shop = await setupOrderableShop('aff-approve');
      const affiliateId = await createAffiliate(shop.adminToken);
      const code = await createCode(shop.adminToken, affiliateId);
      const orderRes = await placeOrder(shop.slug, shop, code.code).expect(201);
      const orderId = body<{ order: { id: number } }>(orderRes).order.id;

      for (const status of ['confirmed', 'preparing', 'out_for_delivery', 'delivered']) {
        await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ status })
          .expect(200);
      }

      const orders = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const row = body<Paginated<AffiliateOrderRow>>(orders).data.find((r) => r.orderId === orderId);
      expect(row!.status).toBe('approved');
    });

    it('cancelling the order auto-blocks the pending commission', async () => {
      const shop = await setupOrderableShop('aff-cancel');
      const affiliateId = await createAffiliate(shop.adminToken);
      const code = await createCode(shop.adminToken, affiliateId);
      const orderRes = await placeOrder(shop.slug, shop, code.code).expect(201);
      const orderId = body<{ order: { id: number } }>(orderRes).order.id;

      await request(app.getHttpServer())
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(201);

      const orders = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const row = body<Paginated<AffiliateOrderRow>>(orders).data.find((r) => r.orderId === orderId);
      expect(row!.status).toBe('blocked');
    });

    it('a manual block is never overwritten by a later auto-approve (only pending is ever auto-synced)', async () => {
      const shop = await setupOrderableShop('aff-manual-block');
      const affiliateId = await createAffiliate(shop.adminToken);
      const code = await createCode(shop.adminToken, affiliateId);
      const orderRes = await placeOrder(shop.slug, shop, code.code).expect(201);
      const orderId = body<{ order: { id: number } }>(orderRes).order.id;

      const orders = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const affiliateOrderId = body<Paginated<AffiliateOrderRow>>(orders).data.find(
        (r) => r.orderId === orderId,
      )!.id;

      await request(app.getHttpServer())
        .patch(`/affiliates/orders/${affiliateOrderId}/status`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ status: 'blocked' })
        .expect(200);

      for (const status of ['confirmed', 'preparing', 'out_for_delivery', 'delivered']) {
        await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ status })
          .expect(200);
      }

      const after = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const row = body<Paginated<AffiliateOrderRow>>(after).data.find((r) => r.id === affiliateOrderId);
      expect(row!.status).toBe('blocked');
    });

    it('the manual approve/block endpoint rejects a commission that is no longer pending', async () => {
      const shop = await setupOrderableShop('aff-double-approve');
      const affiliateId = await createAffiliate(shop.adminToken);
      const code = await createCode(shop.adminToken, affiliateId);
      const orderRes = await placeOrder(shop.slug, shop, code.code).expect(201);
      const orderId = body<{ order: { id: number } }>(orderRes).order.id;
      const orders = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const affiliateOrderId = body<Paginated<AffiliateOrderRow>>(orders).data.find(
        (r) => r.orderId === orderId,
      )!.id;

      await request(app.getHttpServer())
        .patch(`/affiliates/orders/${affiliateOrderId}/status`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ status: 'approved' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/affiliates/orders/${affiliateOrderId}/status`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ status: 'blocked' })
        .expect(400);
    });
  });

  describe('multi-tenant isolation', () => {
    it('shop A cannot see or update shop B\'s affiliate, code, or affiliate order', async () => {
      const shopA = await setupOrderableShop('aff-tenant-a');
      const shopB = await setupOrderableShop('aff-tenant-b');
      const affiliateIdB = await createAffiliate(shopB.adminToken, 'B Referrer');
      const codeB = await createCode(shopB.adminToken, affiliateIdB);
      const orderRes = await placeOrder(shopB.slug, shopB, codeB.code).expect(201);
      const orderIdB = body<{ order: { id: number } }>(orderRes).order.id;
      const ordersB = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      const affiliateOrderIdB = body<Paginated<AffiliateOrderRow>>(ordersB).data.find(
        (r) => r.orderId === orderIdB,
      )!.id;

      // A's lists never contain B's rows.
      const affiliatesA = await request(app.getHttpServer())
        .get('/affiliates')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      expect(
        body<Paginated<AffiliateRow>>(affiliatesA).data.some((r) => r.name === 'B Referrer'),
      ).toBe(false);

      const codesA = await request(app.getHttpServer())
        .get('/affiliates/codes')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      expect(body<Paginated<AffiliateCodeRow>>(codesA).data.some((r) => r.code === codeB.code)).toBe(
        false,
      );

      // A can't reach into B's rows by id even with a valid A token.
      await request(app.getHttpServer())
        .patch(`/affiliates/${affiliateIdB}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ status: 'blocked' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/affiliates/codes/${codeB.id}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ status: 'blocked' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/affiliates/orders/${affiliateOrderIdB}/status`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ status: 'approved' })
        .expect(404);

      // A shop's own ref code never attributes to a different shop's order — same
      // code string wouldn't even resolve, since attribution is looked up by
      // (shopId, code), not code alone.
      const affiliateIdA = await createAffiliate(shopA.adminToken);
      await createCode(shopA.adminToken, affiliateIdA, { code: codeB.code });
      const crossOrderRes = await placeOrder(shopA.slug, shopA, codeB.code).expect(201);
      const crossOrderId = body<{ order: { id: number } }>(crossOrderRes).order.id;
      const ordersAfterA = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      const attributed = body<Paginated<AffiliateOrderRow>>(ordersAfterA).data.find(
        (r) => r.orderId === crossOrderId,
      );
      expect(attributed).toBeTruthy();
      expect(attributed!.affiliateName).not.toBe('B Referrer');
    });
  });

  describe('stat card totals', () => {
    it('summary totals match seeded data', async () => {
      const shop = await setupOrderableShop('aff-stats');
      const affiliate1 = await createAffiliate(shop.adminToken, 'Affiliate One');
      const affiliate2 = await createAffiliate(shop.adminToken, 'Affiliate Two');
      await request(app.getHttpServer())
        .patch(`/affiliates/${affiliate2}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ status: 'inactive' })
        .expect(200);

      const code1 = await createCode(shop.adminToken, affiliate1, { commissionType: 'fixed', commissionValue: 5 });
      await createCode(shop.adminToken, affiliate2, { status: 'blocked' });

      const orderRes = await placeOrder(shop.slug, shop, code1.code).expect(201);
      const orderId = body<{ order: { id: number } }>(orderRes).order.id;
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ status: 'preparing' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ status: 'out_for_delivery' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      const summary = await request(app.getHttpServer())
        .get('/affiliates/summary')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const s = body<SummaryBody>(summary);
      expect(s.totalCode).toBe(2);
      expect(s.totalAffiliate).toBe(2);
      expect(s.activeAffiliate).toBe(1);
      expect(s.pendingOrders).toBe(0);
      expect(s.approvedOrderRevenue).toBe(50);
      expect(s.codeStatus).toEqual({ approved: 1, pending: 0, blocked: 1 });
    });
  });

  describe('permission boundary: affiliate endpoints are admin-only', () => {
    it('a branch user is rejected from every affiliate endpoint', async () => {
      const shop = await setupOrderableShop('aff-perm');
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Branch Staff',
          email: `aff-branch-${runId}@test.com`,
          password: 'password123',
          outletId: shop.outletId,
        })
        .expect(201);
      const branchLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `aff-branch-${runId}@test.com`, password: 'password123' })
        .expect(201);
      const branchToken = body<AuthResponse>(branchLogin).accessToken;

      await request(app.getHttpServer())
        .get('/affiliates')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
    });
  });

  describe('admin-entered orders can also carry a manually-applied referral code', () => {
    it('an admin-created order with a referralCode creates the same attribution', async () => {
      const shop = await setupOrderableShop('aff-admin-order');
      const affiliateId = await createAffiliate(shop.adminToken);
      const code = await createCode(shop.adminToken, affiliateId, { commissionType: 'fixed', commissionValue: 3 });

      const orderRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          customerName: 'Walk-in Customer',
          customerPhone: '0507654321',
          customerAddress: 'Store pickup',
          emirate: 'Dubai',
          outletId: shop.outletId,
          referralCode: code.code,
          items: [{ productId: shop.productId, quantity: 1 }],
        })
        .expect(201);
      const orderId = body<IdRow>(orderRes).id;

      const orders = await request(app.getHttpServer())
        .get('/affiliates/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const row = body<Paginated<AffiliateOrderRow>>(orders).data.find((r) => r.orderId === orderId);
      expect(row).toBeTruthy();
      expect(row!.commissionAmount).toBe(3);
    });
  });
});
