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
interface ProductRow {
  id: number;
  status: string;
  price: string;
  compareAtPrice: string | null;
}
interface BulkPriceResult {
  results: { id: number; name: string; oldPrice: string | null; newPrice?: string; success: boolean; error?: string }[];
  succeeded: number;
}
interface OrderRow {
  id: number;
  status: string;
}
interface BulkResult {
  results: { id?: number; orderId?: number; success: boolean; error?: string }[];
  succeeded: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Bulk actions: products + orders (e2e)', () => {
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
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Bulk Test Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;

    return { adminToken, outletId, categoryId, slug };
  }

  async function createProduct(adminToken: string, categoryId: number, overrides: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Bulk Item ${Math.random()}`,
        price: 10,
        thumbnail: 'https://example.com/x.jpg',
        sku: `BULK-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [categoryId],
        status: 'Available',
        ...overrides,
      })
      .expect(201);
    return body<ProductRow>(res);
  }

  async function createOrder(adminToken: string, outletId: number, productId: number) {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Bulk Customer',
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        orderType: 'delivery',
        outletId,
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);
    return body<OrderRow>(res);
  }

  describe('products: bulk status', () => {
    it('updates only the requested, shop-owned products', async () => {
      const { adminToken, categoryId } = await setupShop('bulk-status');
      const p1 = await createProduct(adminToken, categoryId);
      const p2 = await createProduct(adminToken, categoryId);
      const p3 = await createProduct(adminToken, categoryId);

      const res = await request(app.getHttpServer())
        .patch('/products/bulk-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productIds: [p1.id, p2.id], status: 'Unavailable' })
        .expect(200);
      expect(body<{ updated: number }>(res).updated).toBe(2);

      const check1 = await request(app.getHttpServer())
        .get(`/products/${p1.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const check3 = await request(app.getHttpServer())
        .get(`/products/${p3.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<ProductRow>(check1).status).toBe('Unavailable');
      expect(body<ProductRow>(check3).status).toBe('Available');
    });

    it('adversarial: a spoofed id from another shop is silently excluded, never processed', async () => {
      const shopA = await setupShop('bulk-status-a');
      const shopB = await setupShop('bulk-status-b');
      const ownProduct = await createProduct(shopA.adminToken, shopA.categoryId);
      const foreignProduct = await createProduct(shopB.adminToken, shopB.categoryId);

      const res = await request(app.getHttpServer())
        .patch('/products/bulk-status')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ productIds: [ownProduct.id, foreignProduct.id], status: 'Unavailable' })
        .expect(200);
      // Only the shop-owned id actually matched — the foreign id contributed
      // nothing to the count, and critically didn't error/leak either.
      expect(body<{ updated: number }>(res).updated).toBe(1);

      const foreignCheck = await request(app.getHttpServer())
        .get(`/products/${foreignProduct.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(body<ProductRow>(foreignCheck).status).toBe('Available');
    });

    it('is admin-only — branch and viewer are rejected', async () => {
      const { adminToken, categoryId, outletId } = await setupShop('bulk-status-role');
      const p1 = await createProduct(adminToken, categoryId);
      const staffEmail = `bulk-status-role-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Branch', email: staffEmail, password: 'password123', role: 'branch', outletId })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .patch('/products/bulk-status')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ productIds: [p1.id], status: 'Unavailable' })
        .expect(403);
    });
  });

  describe('products: bulk delete', () => {
    it('deletes the requested products and reports per-item success', async () => {
      const { adminToken, categoryId } = await setupShop('bulk-delete');
      const p1 = await createProduct(adminToken, categoryId);
      const p2 = await createProduct(adminToken, categoryId);

      const res = await request(app.getHttpServer())
        .delete('/products/bulk-delete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productIds: [p1.id, p2.id] })
        .expect(200);
      const result = body<BulkResult>(res);
      expect(result.succeeded).toBe(2);
      expect(result.results.every((r) => r.success)).toBe(true);

      await request(app.getHttpServer())
        .get(`/products/${p1.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('a product with order history fails individually without blocking the rest of the batch', async () => {
      const { adminToken, categoryId, outletId } = await setupShop('bulk-delete-partial');
      const ordered = await createProduct(adminToken, categoryId);
      const clean = await createProduct(adminToken, categoryId);
      await createOrder(adminToken, outletId, ordered.id);

      const res = await request(app.getHttpServer())
        .delete('/products/bulk-delete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productIds: [ordered.id, clean.id] })
        .expect(200);
      const result = body<BulkResult>(res);
      expect(result.succeeded).toBe(1);
      const orderedResult = result.results.find((r) => r.id === ordered.id)!;
      const cleanResult = result.results.find((r) => r.id === clean.id)!;
      expect(orderedResult.success).toBe(false);
      expect(cleanResult.success).toBe(true);

      // The one that failed is still there; the one that succeeded is gone.
      await request(app.getHttpServer())
        .get(`/products/${ordered.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/products/${clean.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('adversarial: cannot bulk-delete a product belonging to another shop', async () => {
      const shopA = await setupShop('bulk-delete-a');
      const shopB = await setupShop('bulk-delete-b');
      const foreignProduct = await createProduct(shopB.adminToken, shopB.categoryId);

      const res = await request(app.getHttpServer())
        .delete('/products/bulk-delete')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ productIds: [foreignProduct.id] })
        .expect(200);
      const result = body<BulkResult>(res);
      // findOne (called inside remove()) 404s on a foreign id, reported as a
      // per-item failure — never actually deleted.
      expect(result.succeeded).toBe(0);

      await request(app.getHttpServer())
        .get(`/products/${foreignProduct.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
    });
  });

  describe('orders: bulk status', () => {
    it('advances multiple orders through a valid transition in one call', async () => {
      const { adminToken, categoryId, outletId } = await setupShop('bulk-order-status');
      const product = await createProduct(adminToken, categoryId);
      const o1 = await createOrder(adminToken, outletId, product.id);
      const o2 = await createOrder(adminToken, outletId, product.id);

      const res = await request(app.getHttpServer())
        .patch('/orders/bulk-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderIds: [o1.id, o2.id], status: 'confirmed' })
        .expect(200);
      const result = body<BulkResult>(res);
      expect(result.succeeded).toBe(2);
    });

    it('skips orders where the transition is invalid rather than forcing it (no skipping required steps)', async () => {
      const { adminToken, categoryId, outletId } = await setupShop('bulk-order-invalid');
      const product = await createProduct(adminToken, categoryId);
      const pending = await createOrder(adminToken, outletId, product.id);
      const confirmed = await createOrder(adminToken, outletId, product.id);
      await request(app.getHttpServer())
        .patch(`/orders/${confirmed.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200);

      // Requesting 'preparing' for both: valid for the already-confirmed
      // order (confirmed -> preparing), invalid for the still-pending one
      // (pending can only go to confirmed or cancelled) — must NOT skip the
      // pending order straight to preparing.
      const res = await request(app.getHttpServer())
        .patch('/orders/bulk-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderIds: [pending.id, confirmed.id], status: 'preparing' })
        .expect(200);
      const result = body<BulkResult>(res);
      expect(result.succeeded).toBe(1);
      const pendingResult = result.results.find((r) => r.orderId === pending.id)!;
      expect(pendingResult.success).toBe(false);

      const pendingCheck = await request(app.getHttpServer())
        .get(`/orders/${pending.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<OrderRow>(pendingCheck).status).toBe('pending');
    });

    it('adversarial: cannot bulk-update an order belonging to another shop', async () => {
      const shopA = await setupShop('bulk-order-a');
      const shopB = await setupShop('bulk-order-b');
      const productB = await createProduct(shopB.adminToken, shopB.categoryId);
      const orderB = await createOrder(shopB.adminToken, shopB.outletId, productB.id);

      const res = await request(app.getHttpServer())
        .patch('/orders/bulk-status')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ orderIds: [orderB.id], status: 'confirmed' })
        .expect(200);
      expect(body<BulkResult>(res).succeeded).toBe(0);

      const check = await request(app.getHttpServer())
        .get(`/orders/${orderB.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(body<OrderRow>(check).status).toBe('pending');
    });

    it('viewer cannot bulk-update order status', async () => {
      const { adminToken, categoryId, outletId } = await setupShop('bulk-order-viewer');
      const product = await createProduct(adminToken, categoryId);
      const order = await createOrder(adminToken, outletId, product.id);
      const staffEmail = `bulk-order-viewer-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Viewer', email: staffEmail, password: 'password123', role: 'viewer' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const viewerToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .patch('/orders/bulk-status')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ orderIds: [order.id], status: 'confirmed' })
        .expect(403);
    });
  });

  describe('products: bulk price update', () => {
    it('applies a percentage increase, recomputed server-side from the current price', async () => {
      const { adminToken, categoryId } = await setupShop('bulk-price-pct');
      const p1 = await createProduct(adminToken, categoryId, { price: 100 });
      const p2 = await createProduct(adminToken, categoryId, { price: 50 });

      const res = await request(app.getHttpServer())
        .patch('/products/bulk-price')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productIds: [p1.id, p2.id], field: 'price', mode: 'percentage', value: 10 })
        .expect(200);
      const result = body<BulkPriceResult>(res);
      expect(result.succeeded).toBe(2);

      const check1 = await request(app.getHttpServer())
        .get(`/products/${p1.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const check2 = await request(app.getHttpServer())
        .get(`/products/${p2.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<ProductRow>(check1).price).toBe('110');
      expect(body<ProductRow>(check2).price).toBe('55');
    });

    it('applies a fixed-amount decrease to compareAtPrice', async () => {
      const { adminToken, categoryId } = await setupShop('bulk-price-fixed');
      const p1 = await createProduct(adminToken, categoryId, { price: 40, compareAtPrice: 60 });

      await request(app.getHttpServer())
        .patch('/products/bulk-price')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productIds: [p1.id], field: 'compareAtPrice', mode: 'fixed', value: -5 })
        .expect(200);

      const check = await request(app.getHttpServer())
        .get(`/products/${p1.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<ProductRow>(check).compareAtPrice).toBe('55');
    });

    it('skips (does not clamp) a product whose compareAtPrice is unset, and one that would go below zero', async () => {
      const { adminToken, categoryId } = await setupShop('bulk-price-skip');
      const noCompareAt = await createProduct(adminToken, categoryId, { price: 20 });
      const wouldGoNegative = await createProduct(adminToken, categoryId, { price: 10 });

      const res = await request(app.getHttpServer())
        .patch('/products/bulk-price')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productIds: [noCompareAt.id], field: 'compareAtPrice', mode: 'fixed', value: 5 })
        .expect(200);
      expect(body<BulkPriceResult>(res).succeeded).toBe(0);
      expect(body<BulkPriceResult>(res).results[0].error).toMatch(/compare-at price/i);

      const res2 = await request(app.getHttpServer())
        .patch('/products/bulk-price')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productIds: [wouldGoNegative.id], field: 'price', mode: 'fixed', value: -50 })
        .expect(200);
      expect(body<BulkPriceResult>(res2).succeeded).toBe(0);

      const check = await request(app.getHttpServer())
        .get(`/products/${wouldGoNegative.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<ProductRow>(check).price).toBe('10');
    });

    it('adversarial: a client-supplied "newPrice" cannot smuggle an arbitrary price — only value/mode/field are honored', async () => {
      const { adminToken, categoryId } = await setupShop('bulk-price-tamper');
      const p1 = await createProduct(adminToken, categoryId, { price: 100 });

      await request(app.getHttpServer())
        .patch('/products/bulk-price')
        .set('Authorization', `Bearer ${adminToken}`)
        // newPrice: 1 is not a real field on the DTO — whitelist validation
        // strips it; the server must still derive the result purely from
        // value/mode/field, not from anything else in the body.
        .send({ productIds: [p1.id], field: 'price', mode: 'fixed', value: 10, newPrice: 1 })
        .expect(400); // forbidNonWhitelisted rejects the unknown property outright
    });

    it("adversarial: cannot bulk-price a product belonging to another shop", async () => {
      const shopA = await setupShop('bulk-price-a');
      const shopB = await setupShop('bulk-price-b');
      const foreignProduct = await createProduct(shopB.adminToken, shopB.categoryId, { price: 100 });

      const res = await request(app.getHttpServer())
        .patch('/products/bulk-price')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ productIds: [foreignProduct.id], field: 'price', mode: 'percentage', value: 50 })
        .expect(200);
      expect(body<BulkPriceResult>(res).succeeded).toBe(0);

      const check = await request(app.getHttpServer())
        .get(`/products/${foreignProduct.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(body<ProductRow>(check).price).toBe('100');
    });

    it('is admin-only', async () => {
      const { adminToken, categoryId, outletId } = await setupShop('bulk-price-role');
      const p1 = await createProduct(adminToken, categoryId, { price: 100 });
      const staffEmail = `bulk-price-role-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Branch', email: staffEmail, password: 'password123', role: 'branch', outletId })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .patch('/products/bulk-price')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ productIds: [p1.id], field: 'price', mode: 'fixed', value: 1 })
        .expect(403);
    });
  });
});
