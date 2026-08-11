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
interface OrderRow {
  id: number;
}
interface AuditLogRow {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  actorName: string;
  createdAt: string;
}
interface AuditLogList {
  data: AuditLogRow[];
  total: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Audit log (e2e)', () => {
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
        name: 'Audit Test Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;
    const adminEmail = `${slug}@test.com`;

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

    return { adminToken, adminEmail, outletId, collectionId };
  }

  async function createProduct(
    adminToken: string,
    collectionId: number,
    price = 50,
  ) {
    const res = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Audit Item ${Math.random()}`,
        price,
        thumbnail: 'https://example.com/x.jpg',
        sku: `AUDIT-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        collectionIds: [collectionId],
      })
      .expect(201);
    return body<ProductRow>(res);
  }

  it('logs a staff login', async () => {
    const { adminToken, adminEmail } = await setupShop('audit-login');
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: 'password123' })
      .expect(201);

    const logs = await request(app.getHttpServer())
      .get('/audit-log?entityType=auth')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      body<AuditLogList>(logs).data.some((l) => l.action === 'auth.login'),
    ).toBe(true);
  });

  it('logs a product price change with before/after', async () => {
    const { adminToken, collectionId } = await setupShop('audit-price');
    const product = await createProduct(adminToken, collectionId, 50);

    await request(app.getHttpServer())
      .patch(`/products/${product.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ price: 75 })
      .expect(200);

    const logs = await request(app.getHttpServer())
      .get(`/audit-log?entityType=product`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const entry = body<AuditLogList>(logs).data.find(
      (l) => l.action === 'product.price_changed' && l.entityId === product.id,
    );
    expect(entry).toBeTruthy();
    expect((entry!.before as { price: string }).price).toBe('50');
    expect((entry!.after as { price: string }).price).toBe('75');
  });

  it('does NOT log an update that leaves price unchanged', async () => {
    const { adminToken, collectionId } = await setupShop('audit-price-unchanged');
    const product = await createProduct(adminToken, collectionId, 50);

    await request(app.getHttpServer())
      .patch(`/products/${product.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Renamed only' })
      .expect(200);

    const logs = await request(app.getHttpServer())
      .get(`/audit-log?entityType=product`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      body<AuditLogList>(logs).data.some(
        (l) => l.action === 'product.price_changed',
      ),
    ).toBe(false);
  });

  it('logs a product delete and a product status change', async () => {
    const { adminToken, collectionId } = await setupShop('audit-delete-status');
    const product = await createProduct(adminToken, collectionId);

    await request(app.getHttpServer())
      .patch(`/products/${product.id}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Unavailable' })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/products/${product.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const logs = await request(app.getHttpServer())
      .get(`/audit-log?entityType=product`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const actions = body<AuditLogList>(logs)
      .data.filter((l) => l.entityId === product.id)
      .map((l) => l.action);
    expect(actions).toContain('product.status_changed');
    expect(actions).toContain('product.deleted');
  });

  it('logs bulk status, bulk delete, and bulk price actions as one summary row each', async () => {
    const { adminToken, collectionId } = await setupShop('audit-bulk');
    const p1 = await createProduct(adminToken, collectionId);
    const p2 = await createProduct(adminToken, collectionId);
    const p3 = await createProduct(adminToken, collectionId);

    await request(app.getHttpServer())
      .patch('/products/bulk-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productIds: [p1.id, p2.id], status: 'Unavailable' })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/products/bulk-price')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        productIds: [p1.id, p2.id],
        field: 'price',
        mode: 'percentage',
        value: 10,
      })
      .expect(200);
    await request(app.getHttpServer())
      .delete('/products/bulk-delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productIds: [p3.id] })
      .expect(200);

    const logs = await request(app.getHttpServer())
      .get(`/audit-log?entityType=product`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const data = body<AuditLogList>(logs).data;
    const bulkStatusEntries = data.filter(
      (l) => l.action === 'product.bulk_status_changed',
    );
    const bulkPriceEntries = data.filter(
      (l) => l.action === 'product.bulk_price_changed',
    );
    const deleteEntries = data.filter(
      (l) => l.action === 'product.deleted' && l.entityId === p3.id,
    );
    expect(bulkStatusEntries).toHaveLength(1); // ONE summary row, not one per product
    expect(bulkPriceEntries).toHaveLength(1);
    expect(deleteEntries).toHaveLength(1); // bulkRemove logs via remove() per item
    expect(
      (bulkStatusEntries[0].metadata as { productIds: number[] }).productIds,
    ).toEqual([p1.id, p2.id]);
  });

  it('logs an order status change', async () => {
    const { adminToken, collectionId, outletId } =
      await setupShop('audit-order-status');
    const product = await createProduct(adminToken, collectionId);
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Audit Customer',
        customerPhone: '0501234567',
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        orderType: 'delivery',
        outletId,
        items: [{ productId: product.id, quantity: 1 }],
      })
      .expect(201);
    const orderId = body<OrderRow>(order).id;

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'confirmed' })
      .expect(200);

    const logs = await request(app.getHttpServer())
      .get(`/audit-log?entityType=order`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const entry = body<AuditLogList>(logs).data.find(
      (l) => l.entityId === orderId,
    );
    expect(entry?.action).toBe('order.status_changed');
  });

  it('logs a collection delete, a discount delete, and a bio link delete', async () => {
    const { adminToken, collectionId } = await setupShop('audit-other-deletes');

    // Collection delete (needs its own, unassigned collection to avoid the
    // "has products assigned" guard).
    const cat2 = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Deletable Collection' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/collections/${body<IdRow>(cat2).id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Discount delete.
    const discount = await request(app.getHttpServer())
      .post('/shop/discounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: `AUDIT${runId}`,
        type: 'PERCENTAGE',
        value: 10,
        appliesTo: 'ALL_PRODUCTS',
      })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/shop/discounts/${body<IdRow>(discount).id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Bio link delete.
    const bioLink = await request(app.getHttpServer())
      .post('/shop/bio-links')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'EXTERNAL_URL',
        label: 'Audit Link',
        url: 'https://example.com',
      })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/shop/bio-links/${body<IdRow>(bioLink).id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const logs = await request(app.getHttpServer())
      .get(`/audit-log`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const actions = body<AuditLogList>(logs).data.map((l) => l.action);
    expect(actions).toContain('collection.deleted');
    expect(actions).toContain('discount.deleted');
    expect(actions).toContain('biolink.deleted');
    void collectionId;
  });

  describe('list endpoint: filters, pagination, tenant isolation, role gate', () => {
    it('filters by actorUserId and paginates', async () => {
      const { adminToken, collectionId } = await setupShop('audit-filter-actor');
      for (let i = 0; i < 3; i++) {
        const p = await createProduct(adminToken, collectionId);
        await request(app.getHttpServer())
          .delete(`/products/${p.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      }

      const actorsRes = await request(app.getHttpServer())
        .get('/audit-log/actors')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const actorId = body<{ id: number; name: string }[]>(actorsRes)[0].id;

      const page1 = await request(app.getHttpServer())
        .get(`/audit-log?actorUserId=${actorId}&pageSize=2&page=1`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const result = body<AuditLogList>(page1);
      expect(result.data).toHaveLength(2);
      expect(result.total).toBeGreaterThanOrEqual(3);
    });

    it("adversarial: shop B never sees shop A's audit log entries", async () => {
      const shopA = await setupShop('audit-tenant-a');
      const shopB = await setupShop('audit-tenant-b');
      const product = await createProduct(shopA.adminToken, shopA.collectionId);
      await request(app.getHttpServer())
        .delete(`/products/${product.id}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/audit-log')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(
        body<AuditLogList>(res).data.some(
          (l) => l.action === 'product.deleted',
        ),
      ).toBe(false);
    });

    it('branch and order_manager cannot view the audit log', async () => {
      const { adminToken, outletId } = await setupShop('audit-role-gate');

      const branchEmail = `audit-role-gate-branch-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Branch',
          email: branchEmail,
          password: 'password123',
          role: 'branch',
          outletId,
        })
        .expect(201);
      const branchLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: branchEmail, password: 'password123' })
        .expect(201);
      await request(app.getHttpServer())
        .get('/audit-log')
        .set(
          'Authorization',
          `Bearer ${body<AuthResponse>(branchLogin).accessToken}`,
        )
        .expect(403);

      const omEmail = `audit-role-gate-om-${runId}@test.com`;
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
        .get('/audit-log')
        .set(
          'Authorization',
          `Bearer ${body<AuthResponse>(omLogin).accessToken}`,
        )
        .expect(403);
    });

    it('viewer can view the audit log', async () => {
      const { adminToken } = await setupShop('audit-role-viewer');
      const viewerEmail = `audit-role-viewer-staff-${runId}@test.com`;
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
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: viewerEmail, password: 'password123' })
        .expect(201);
      await request(app.getHttpServer())
        .get('/audit-log')
        .set('Authorization', `Bearer ${body<AuthResponse>(login).accessToken}`)
        .expect(200);
    });
  });
});
