import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { verifySignupEmail } from './helpers/verify-signup-email';
import { LowStockDigestService } from '../src/products/low-stock-digest.service';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface OutletRow {
  id: number;
}
interface IdRow {
  id: number;
}
interface StockSnapshotRow {
  outletId: number;
  productId: number;
  stockQuantity: number;
  lowStockThreshold: number | null;
}
interface StockSnapshot {
  products: StockSnapshotRow[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Low Stock Alerts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let lowStockDigestService: LowStockDigestService;
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
    lowStockDigestService = app.get(LowStockDigestService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function setupShop(slugPrefix: string, outletCount = 1) {
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
    const adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletIds = [body<OutletRow[]>(outlets)[0].id];
    await request(app.getHttpServer())
      .patch(`/outlets/${outletIds[0]}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);

    for (let i = 1; i < outletCount; i += 1) {
      const created = await request(app.getHttpServer())
        .post('/outlets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Branch ${i}`,
          active: true,
          emirate: 'Dubai',
          pickupEnabled: true,
        })
        .expect(201);
      outletIds.push(body<IdRow>(created).id);
    }

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
        sku: `LS-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        trackInventory: true,
        collectionIds: [collectionId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    return {
      shopSlug,
      adminToken,
      outletIds,
      outletId: outletIds[0],
      productId,
    };
  }

  it('defaults to no threshold (off) — never flags a freshly created product', async () => {
    const { adminToken, outletId, productId } = await setupShop('ls-default');
    await request(app.getHttpServer())
      .patch('/products/stock/bulk-adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outletId, adjustments: [{ productId, delta: 0 }] })
      .expect(200);
    const p = await request(app.getHttpServer())
      .get(`/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ outletId })
      .expect(200);
    expect(
      body<{ lowStockThreshold: number | null }>(p).lowStockThreshold,
    ).toBeNull();
  });

  it('setting and clearing the threshold works, and is scoped per outlet — not the product total', async () => {
    const { adminToken, outletIds, productId } = await setupShop(
      'ls-per-outlet',
      2,
    );
    const [outletA, outletB] = outletIds;

    await request(app.getHttpServer())
      .patch('/products/stock/threshold')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId, outletId: outletA, lowStockThreshold: 5 })
      .expect(200);

    // Stock A: 3 (at/below its own threshold of 5 -> low). Stock B: 100, no
    // threshold set at all — must never inherit outlet A's threshold, and a
    // combined-total view would also wrongly call this "fine" (103 units
    // system-wide) when branch A is specifically the one running low.
    await request(app.getHttpServer())
      .patch('/products/stock/bulk-adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outletId: outletA, adjustments: [{ productId, delta: 3 }] })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/products/stock/bulk-adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outletId: outletB, adjustments: [{ productId, delta: 100 }] })
      .expect(200);

    const productA = await request(app.getHttpServer())
      .get(`/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ outletId: outletA })
      .expect(200);
    expect(
      body<{ lowStockThreshold: number | null; stockQuantity: number }>(
        productA,
      ),
    ).toMatchObject({
      lowStockThreshold: 5,
      stockQuantity: 3,
    });

    const productB = await request(app.getHttpServer())
      .get(`/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ outletId: outletB })
      .expect(200);
    expect(
      body<{ lowStockThreshold: number | null; stockQuantity: number }>(
        productB,
      ),
    ).toMatchObject({
      lowStockThreshold: null,
      stockQuantity: 100,
    });

    // Clear it back to off.
    await request(app.getHttpServer())
      .patch('/products/stock/threshold')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId, outletId: outletA, lowStockThreshold: null })
      .expect(200);
    const cleared = await request(app.getHttpServer())
      .get(`/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ outletId: outletA })
      .expect(200);
    expect(
      body<{ lowStockThreshold: number | null }>(cleared).lowStockThreshold,
    ).toBeNull();
  });

  it('crossing at-or-below the threshold via order placement, a manual adjustment, and a transfer-out all reflect correctly on read (live comparison, not a separate flag to fall out of sync)', async () => {
    const { shopSlug, adminToken, outletIds, productId } = await setupShop(
      'ls-crossing',
      2,
    );
    const [outletA, outletB] = outletIds;

    await request(app.getHttpServer())
      .patch('/products/stock/threshold')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId, outletId: outletA, lowStockThreshold: 2 })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/products/stock/bulk-adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outletId: outletA, adjustments: [{ productId, delta: 10 }] })
      .expect(200);

    const isLow = async () => {
      const res = await request(app.getHttpServer())
        .get(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ outletId: outletA })
        .expect(200);
      const p = body<{
        lowStockThreshold: number | null;
        stockQuantity: number;
      }>(res);
      return (
        p.lowStockThreshold !== null && p.stockQuantity <= p.lowStockThreshold
      );
    };

    expect(await isLow()).toBe(false); // 10 > 2

    // Order placement decrements to 8 — still not low.
    await request(app.getHttpServer())
      .post(`/public/${shopSlug}/orders`)
      .send({
        outletId: outletA,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName: 'Buyer',
        customerPhone: '0521111111',
        customerAddress: 'N/A',
        emirate: 'Dubai',
        items: [{ productId, quantity: 2 }],
      })
      .expect(201);
    expect(await isLow()).toBe(false);

    // Manual adjustment (shrinkage) crosses the threshold: 8 -> 2.
    await request(app.getHttpServer())
      .post('/products/stock/adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId, outletId: outletA, delta: -6, reason: 'damaged' })
      .expect(201);
    expect(await isLow()).toBe(true);

    // Transfer-out to the other branch drops it further, stays low.
    await request(app.getHttpServer())
      .post('/products/stock/transfer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        productId,
        fromOutletId: outletA,
        toOutletId: outletB,
        quantity: 1,
      })
      .expect(201);
    expect(await isLow()).toBe(true);
  });

  it('rejects an unknown/invalid threshold target the same way the other stock endpoints do', async () => {
    const { adminToken, outletId } = await setupShop('ls-invalid');
    await request(app.getHttpServer())
      .patch('/products/stock/threshold')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId: 999999999, outletId, lowStockThreshold: 5 })
      .expect(404);
  });

  describe('low-stock digest email', () => {
    async function makeLowStockShop(slugPrefix: string) {
      const { shopSlug, adminToken, outletId, productId } =
        await setupShop(slugPrefix);
      await request(app.getHttpServer())
        .patch('/products/stock/threshold')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, outletId, lowStockThreshold: 5 })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ outletId, adjustments: [{ productId, delta: 2 }] })
        .expect(200);
      return { shopSlug, adminToken };
    }

    it('respects the opt-in toggle (off by default)', async () => {
      const { shopSlug } = await makeLowStockShop('ls-digest-toggle');
      const shop = await prisma.shop.findUniqueOrThrow({
        where: { subdomain: shopSlug },
      });
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const sent = await lowStockDigestService.sendForShop(
        shop.id,
        shop.name,
        shop.email,
        startOfToday,
      );
      expect(sent).toBe(false);
    });

    it('sends once when opted in, and never a second time the same day', async () => {
      const { shopSlug, adminToken } = await makeLowStockShop('ls-digest-once');
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notifyLowStockDigest: true })
        .expect(200);

      const shop = await prisma.shop.findUniqueOrThrow({
        where: { subdomain: shopSlug },
      });
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const first = await lowStockDigestService.sendForShop(
        shop.id,
        shop.name,
        shop.email,
        startOfToday,
      );
      expect(first).toBe(true);

      const second = await lowStockDigestService.sendForShop(
        shop.id,
        shop.name,
        shop.email,
        startOfToday,
      );
      expect(second).toBe(false);

      const updated = await prisma.shop.findUniqueOrThrow({
        where: { id: shop.id },
      });
      expect(updated.lowStockDigestLastSentAt).not.toBeNull();
    });
  });
});
