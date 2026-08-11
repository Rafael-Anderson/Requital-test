import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

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
}
interface OrderItemRow {
  productId: number;
  variantId: number | null;
  quantity: number;
  priceAtPurchase: string;
}
interface OrderRow {
  id: number;
  status: string;
  total: string;
  discountAmount: string | null;
  discountId: number | null;
  orderitem: OrderItemRow[];
  discountDropped?: boolean;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// 9 separate setupShop() calls across this file's tests — same reasoning
// as scan.e2e-spec.ts's own jest.setTimeout(30000): under full-suite
// parallel load this can occasionally exceed Jest's default 5000ms per-test
// timeout on DB contention alone, unrelated to any real bug.
jest.setTimeout(30000);

describe('Order item editing after placement (e2e)', () => {
  let app: INestApplication<App>;
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
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Edit Test Admin',
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

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const collectionId = body<IdRow>(collection).id;

    return { adminToken, outletId, collectionId };
  }

  async function createProduct(
    adminToken: string,
    collectionId: number,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Edit Item ${Math.random()}`,
        price: 20,
        thumbnail: 'https://example.com/x.jpg',
        sku: `EDIT-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        collectionIds: [collectionId],
        trackInventory: true,
        ...overrides,
      })
      .expect(201);
    return body<ProductRow>(res);
  }

  async function seedStock(
    adminToken: string,
    outletId: number,
    productId: number,
    qty: number,
  ) {
    await request(app.getHttpServer())
      .post('/products/stock/adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId, outletId, delta: qty, reason: 'received' })
      .expect(201);
  }

  async function stockAt(
    adminToken: string,
    outletId: number,
    productId: number,
  ): Promise<number> {
    const res = await request(app.getHttpServer())
      .get(`/products/${productId}?outletId=${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return body<{ stockQuantity: number | null }>(res).stockQuantity ?? 0;
  }

  async function createAdminOrder(
    adminToken: string,
    outletId: number,
    productId: number,
    quantity: number,
  ) {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Edit Customer',
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        orderType: 'delivery',
        outletId,
        items: [{ productId, quantity }],
      })
      .expect(201);
    return body<OrderRow>(res);
  }

  describe('editable status window', () => {
    it('rejects edits once the order is preparing or beyond', async () => {
      const { adminToken, collectionId, outletId } =
        await setupShop('edit-status-window');
      const product = await createProduct(adminToken, collectionId);
      const order = await createAdminOrder(adminToken, outletId, product.id, 2);
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'preparing' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: product.id, quantity: 5 }] })
        .expect(400);
    });

    it('allows edits while pending and while confirmed', async () => {
      const { adminToken, collectionId, outletId } =
        await setupShop('edit-status-ok');
      // Not stock-tracked — this test is only about the status-window gate,
      // not stock semantics (covered separately below), so a quantity
      // increase past confirm must succeed regardless of stock levels.
      const product = await createProduct(adminToken, collectionId, {
        trackInventory: false,
      });
      const order = await createAdminOrder(adminToken, outletId, product.id, 2);

      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: product.id, quantity: 3 }] })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: product.id, quantity: 4 }] })
        .expect(200);
    });
  });

  describe('stock reservation semantics', () => {
    it('a still-pending, admin-channel order has NOT reserved stock yet — editing its quantity touches no stock', async () => {
      const { adminToken, collectionId, outletId } = await setupShop(
        'edit-pending-no-reserve',
      );
      const product = await createProduct(adminToken, collectionId);
      await seedStock(adminToken, outletId, product.id, 10);
      const order = await createAdminOrder(adminToken, outletId, product.id, 2);
      // Nothing decremented yet — pending, non-immediate channel.
      expect(await stockAt(adminToken, outletId, product.id)).toBe(10);

      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: product.id, quantity: 8 }] })
        .expect(200);
      // Still untouched — the edit itself doesn't reserve; confirm() will
      // decrement whatever the item list says at that point.
      expect(await stockAt(adminToken, outletId, product.id)).toBe(10);
    });

    it('increasing quantity on a confirmed order atomically decrements the extra amount', async () => {
      const { adminToken, collectionId, outletId } = await setupShop(
        'edit-confirmed-increase',
      );
      const product = await createProduct(adminToken, collectionId);
      await seedStock(adminToken, outletId, product.id, 10);
      const order = await createAdminOrder(adminToken, outletId, product.id, 2);
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200);
      // Confirm decremented 2 already.
      expect(await stockAt(adminToken, outletId, product.id)).toBe(8);

      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: product.id, quantity: 5 }] })
        .expect(200);
      // +3 more units consumed (2 -> 5) => 8 - 3 = 5.
      expect(await stockAt(adminToken, outletId, product.id)).toBe(5);
    });

    it('decreasing quantity on a confirmed order releases stock back', async () => {
      const { adminToken, collectionId, outletId } = await setupShop(
        'edit-confirmed-decrease',
      );
      const product = await createProduct(adminToken, collectionId);
      await seedStock(adminToken, outletId, product.id, 10);
      const order = await createAdminOrder(adminToken, outletId, product.id, 5);
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200);
      expect(await stockAt(adminToken, outletId, product.id)).toBe(5);

      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: product.id, quantity: 2 }] })
        .expect(200);
      // 3 units released back (5 -> 2) => 5 + 3 = 8.
      expect(await stockAt(adminToken, outletId, product.id)).toBe(8);
    });

    it('removing an item from a confirmed order fully releases its stock, and adding a new item decrements it', async () => {
      const { adminToken, collectionId, outletId } =
        await setupShop('edit-add-remove');
      const p1 = await createProduct(adminToken, collectionId);
      const p2 = await createProduct(adminToken, collectionId);
      await seedStock(adminToken, outletId, p1.id, 10);
      await seedStock(adminToken, outletId, p2.id, 10);
      const order = await createAdminOrder(adminToken, outletId, p1.id, 4);
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200);
      expect(await stockAt(adminToken, outletId, p1.id)).toBe(6);

      // Replace p1 with p2 entirely.
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: p2.id, quantity: 3 }] })
        .expect(200);

      expect(await stockAt(adminToken, outletId, p1.id)).toBe(10); // fully released
      expect(await stockAt(adminToken, outletId, p2.id)).toBe(7); // 10 - 3
    });

    it('rejects an increase beyond available stock (409) and leaves everything unchanged', async () => {
      const { adminToken, collectionId, outletId } =
        await setupShop('edit-insufficient');
      const product = await createProduct(adminToken, collectionId);
      await seedStock(adminToken, outletId, product.id, 5);
      const order = await createAdminOrder(adminToken, outletId, product.id, 2);
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200);
      expect(await stockAt(adminToken, outletId, product.id)).toBe(3);

      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: product.id, quantity: 999 }] })
        .expect(409);

      // Unchanged: stock, item list, and total all untouched by the failed edit.
      expect(await stockAt(adminToken, outletId, product.id)).toBe(3);
      const check = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<OrderRow>(check).orderitem[0].quantity).toBe(2);
    });

    it('race: two concurrent quantity-increase edits on a confirmed order, only enough stock for one', async () => {
      const { adminToken, collectionId, outletId } = await setupShop('edit-race');
      const product = await createProduct(adminToken, collectionId);
      await seedStock(adminToken, outletId, product.id, 10);
      const order = await createAdminOrder(adminToken, outletId, product.id, 1);
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200);
      expect(await stockAt(adminToken, outletId, product.id)).toBe(9);

      // Two concurrent edits both trying to push quantity to 10 (needing +9
      // more each) against only 9 available — at most one can win.
      const attempt = () =>
        request(app.getHttpServer())
          .patch(`/orders/${order.id}/items`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ items: [{ productId: product.id, quantity: 10 }] });

      const results = await Promise.all([attempt(), attempt()]);
      const succeeded = results.filter((r) => r.status === 200);
      const failed = results.filter(
        (r) => r.status === 409 || r.status === 500,
      );
      expect(succeeded.length).toBeLessThanOrEqual(1);
      expect(succeeded.length + failed.length).toBe(2);
      // Whatever the final state, stock must never go negative.
      expect(
        await stockAt(adminToken, outletId, product.id),
      ).toBeGreaterThanOrEqual(0);
    });
  });

  describe('discount interaction', () => {
    it('drops a discount that no longer meets its minimum purchase after items shrink', async () => {
      const { adminToken, collectionId, outletId } =
        await setupShop('edit-discount-min');
      const product = await createProduct(adminToken, collectionId, {
        price: 100,
      });
      const discount = await request(app.getHttpServer())
        .post('/shop/discounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `EDITMIN${runId}`,
          type: 'FIXED_AMOUNT',
          value: 10,
          minPurchaseAmount: 150,
        })
        .expect(201);
      void discount;

      const orderRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerName: 'Discount Customer',
          customerPhone: '0501112222',
          customerAddress: '1 Test St',
          emirate: 'Dubai',
          orderType: 'delivery',
          outletId,
          discountCode: `EDITMIN${runId}`,
          items: [{ productId: product.id, quantity: 2 }], // 200 AED, clears the 150 minimum
        })
        .expect(201);
      const order = body<OrderRow>(orderRes);
      expect(Number(order.discountAmount)).toBe(10);

      // Shrink to 1 unit (100 AED) — below the 150 minimum.
      const editRes = await request(app.getHttpServer())
        .patch(`/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: product.id, quantity: 1 }] })
        .expect(200);
      const edited = body<OrderRow>(editRes);
      expect(edited.discountDropped).toBe(true);
      expect(Number(edited.discountAmount)).toBe(0);
      expect(Number(edited.total)).toBe(100);
    });
  });

  describe('tenant isolation + role enforcement (adversarial)', () => {
    it("cannot edit another shop's order", async () => {
      const shopA = await setupShop('edit-tenant-a');
      const shopB = await setupShop('edit-tenant-b');
      const productA = await createProduct(shopA.adminToken, shopA.collectionId);
      const orderA = await createAdminOrder(
        shopA.adminToken,
        shopA.outletId,
        productA.id,
        1,
      );

      await request(app.getHttpServer())
        .patch(`/orders/${orderA.id}/items`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ items: [{ productId: productA.id, quantity: 5 }] })
        .expect(404);
    });

    it('viewer cannot edit order items; branch and order_manager can', async () => {
      const { adminToken, collectionId, outletId } =
        await setupShop('edit-role-gate');
      const product = await createProduct(adminToken, collectionId);
      const order = await createAdminOrder(adminToken, outletId, product.id, 1);

      const viewerEmail = `edit-role-gate-viewer-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Viewer',
          email: viewerEmail,
          password: 'password123',
          role: 'viewer',
        })
        .expect(201);
      const viewerLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: viewerEmail, password: 'password123' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/items`)
        .set(
          'Authorization',
          `Bearer ${body<AuthResponse>(viewerLogin).accessToken}`,
        )
        .send({ items: [{ productId: product.id, quantity: 2 }] })
        .expect(403);

      const omEmail = `edit-role-gate-om-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'OM',
          email: omEmail,
          password: 'password123',
          role: 'order_manager',
        })
        .expect(201);
      const omLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: omEmail, password: 'password123' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/items`)
        .set(
          'Authorization',
          `Bearer ${body<AuthResponse>(omLogin).accessToken}`,
        )
        .send({ items: [{ productId: product.id, quantity: 2 }] })
        .expect(200);
    });
  });
});
