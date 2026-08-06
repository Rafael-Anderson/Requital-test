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
interface ProductRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface OrderRow {
  id: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Notify subscriptions (e2e)', () => {
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

  async function setupShopWithProduct(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Notify Test Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Rose Bouquet',
        price: 50,
        thumbnail: 'https://example.com/p.jpg',
        sku: `NOTIFY-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        trackInventory: true,
        categoryIds: [body<IdRow>(category).id],
      })
      .expect(201);

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    return {
      adminToken,
      productId: body<ProductRow>(product).id,
      outletId: body<OutletRow[]>(outlets)[0].id,
      slug,
    };
  }

  it('subscribes, is idempotent on a duplicate, and unsubscribes', async () => {
    const { productId } = await setupShopWithProduct('e2e-notify');
    const email = `shopper-${runId}@example.com`;

    const first = await request(app.getHttpServer())
      .post('/notify-subscriptions')
      .send({ productId, email })
      .expect(201);
    expect(body<{ alreadySubscribed: boolean }>(first).alreadySubscribed).toBe(
      false,
    );

    const second = await request(app.getHttpServer())
      .post('/notify-subscriptions')
      .send({ productId, email })
      .expect(201);
    expect(body<{ alreadySubscribed: boolean }>(second).alreadySubscribed).toBe(
      true,
    );

    await request(app.getHttpServer())
      .delete('/notify-subscriptions')
      .query({ email, productId })
      .expect(200);

    const row = await prisma.notifysubscription.findFirst({
      where: { productId, email },
    });
    expect(row).toBeNull();
  });

  it('rejects a subscribe for a productId that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/notify-subscriptions')
      .send({ productId: 999999999, email: 'nobody@example.com' })
      .expect(404);
  });

  it('rejects an unsubscribe with a non-numeric productId rather than 500ing', async () => {
    await request(app.getHttpServer())
      .delete('/notify-subscriptions')
      .query({ email: 'nobody@example.com', productId: 'not-a-number' })
      .expect(400);
  });

  it("a product from shop B cannot be used to enumerate or delete shop A's subscription", async () => {
    const shopA = await setupShopWithProduct('e2e-notify-a');
    const shopB = await setupShopWithProduct('e2e-notify-b');
    const email = `shopper-${runId}@example.com`;

    await request(app.getHttpServer())
      .post('/notify-subscriptions')
      .send({ productId: shopA.productId, email })
      .expect(201);

    // Unsubscribing using shop B's product id must not touch shop A's row.
    await request(app.getHttpServer())
      .delete('/notify-subscriptions')
      .query({ email, productId: shopB.productId })
      .expect(200);

    const stillThere = await prisma.notifysubscription.findFirst({
      where: { productId: shopA.productId, email },
    });
    expect(stillThere).not.toBeNull();
  });

  // Phase 8.3 — NotifySubscriptionsService.triggerForProduct fires (not
  // awaited) from 5 real 0->positive stock-crossing points: manual stock
  // adjust, outlet transfer, order-cancellation restock (all pre-existing),
  // plus CSV import and scan-to-stock (wired in this phase — see
  // ProductsService.confirmImportProducts/applyImportStock and
  // ScanService.commit). Verified end-to-end via the real HTTP endpoints
  // rather than a mock, checking the one side effect the trigger itself
  // guarantees: notifysubscription.notifiedAt gets set once a queued email
  // is enqueued for it (see triggerForProduct's own comment on why it marks
  // notified at enqueue time, not delivery time).
  describe('restock trigger — all 5 paths', () => {
    async function subscribeTo(productId: number, email: string) {
      await request(app.getHttpServer())
        .post('/notify-subscriptions')
        .send({ productId, email })
        .expect(201);
    }

    async function waitForNotified(productId: number, email: string) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const row = await prisma.notifysubscription.findFirst({
          where: { productId, email },
        });
        if (row?.notifiedAt) return row;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(
        `notifysubscription for product ${productId}/${email} was never marked notified`,
      );
    }

    // Explicit 15s timeout on all 5 of these below: waitForNotified's own
    // 5s polling deadline already eats Jest's 5s default per-test timeout
    // with zero slack left for the setup requests that precede it.
    it('1. manual stock adjust (PATCH /products/stock/bulk-adjust)', async () => {
      const { adminToken, productId, outletId } =
        await setupShopWithProduct('restock-manual');
      const email = `manual-${runId}@example.com`;
      await subscribeTo(productId, email);

      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ outletId, adjustments: [{ productId, delta: 5 }] })
        .expect(200);

      await waitForNotified(productId, email);
    }, 15000);

    it('2. outlet-to-outlet transfer (POST /products/stock/transfer)', async () => {
      const { adminToken, productId, outletId } =
        await setupShopWithProduct('restock-transfer');
      const secondOutlet = await request(app.getHttpServer())
        .post('/outlets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Second Branch', active: true, emirate: 'Dubai', pickupEnabled: true })
        .expect(201);
      const outletB = body<OutletRow>(secondOutlet).id;

      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ outletId, adjustments: [{ productId, delta: 3 }] })
        .expect(200);

      const email = `transfer-${runId}@example.com`;
      await subscribeTo(productId, email);

      await request(app.getHttpServer())
        .post('/products/stock/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productId,
          fromOutletId: outletId,
          toOutletId: outletB,
          quantity: 1,
        })
        .expect(201);

      await waitForNotified(productId, email);
    }, 15000);

    it('3. order-cancellation restock (POST /orders/:id/cancel)', async () => {
      const { adminToken, productId, outletId } =
        await setupShopWithProduct('restock-cancel');
      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ outletId, adjustments: [{ productId, delta: 1 }] })
        .expect(200);

      const created = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerName: 'Restock Customer',
          customerPhone: '0501234567',
          customerAddress: 'Pickup',
          emirate: 'Dubai',
          outletId,
          orderType: 'pickup',
          items: [{ productId, quantity: 1 }],
        })
        .expect(201);
      const orderId = body<OrderRow>(created).id;

      // Confirming drains the last unit to 0 — subscribing only now proves
      // the trigger fires on the *cancel* restock, not on this decrement.
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200);

      const email = `cancel-${runId}@example.com`;
      await subscribeTo(productId, email);

      await request(app.getHttpServer())
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      await waitForNotified(productId, email);
    }, 15000);

    it('4. CSV import (POST /products/import/confirm)', async () => {
      const { adminToken, productId, outletId } =
        await setupShopWithProduct('restock-csv');
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { sku: true, name: true },
      });

      const email = `csv-${runId}@example.com`;
      await subscribeTo(productId, email);

      // Name is required on every row regardless of create/update action
      // (see classifyImportRows) — SKU/Stock alone isn't a valid row.
      const csv = ['Name,SKU,Stock', `${product.name},${product.sku},8`].join('\r\n');
      await request(app.getHttpServer())
        .post(`/products/import/confirm?outletId=${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from(csv), {
          filename: 'restock.csv',
          contentType: 'text/csv',
        })
        .expect(201);

      await waitForNotified(productId, email);
    }, 15000);

    it('5. scan-to-stock (POST /scan/commit)', async () => {
      const { adminToken, productId, outletId } =
        await setupShopWithProduct('restock-scan');
      const email = `scan-${runId}@example.com`;
      await subscribeTo(productId, email);

      await request(app.getHttpServer())
        .post('/scan/commit')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          imageUrl: '/uploads/scans/test-fixture.png',
          items: [
            {
              targetType: 'product',
              matchedId: productId,
              outletId,
              quantity: 6,
            },
          ],
        })
        .expect(201);

      await waitForNotified(productId, email);
    }, 15000);
  });
});
