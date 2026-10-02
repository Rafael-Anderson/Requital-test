import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { verifySignupEmail } from './helpers/verify-signup-email';

jest.setTimeout(30000);

interface IdRow {
  id: number;
}
interface OrderRow {
  id: number;
  orderitem: { id: number }[];
}
function body<T>(res: Response): T {
  return res.body as T;
}

// Security review SR3 (PR #193/#194 area) repro tests. Both are expected to FAIL on origin/main.
describe('SR3: order stock / branch-role repros (e2e)', () => {
  let app: INestApplication<App>;
  const runId = Date.now();
  const http = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(http())
      .post('/auth/signup')
      .send({
        name: 'SR3 Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    await verifySignupEmail(http(), (signup.body as { devVerificationLink?: string }).devVerificationLink);
    const adminToken = body<{ accessToken: string }>(signup).accessToken;
    const outlets = await request(http()).get('/outlets').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    const col = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const prod = await request(http())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `SR3 Item ${Math.random()}`,
        price: 10,
        thumbnail: 'https://example.com/x.jpg',
        sku: `SR3-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        collectionIds: [body<IdRow>(col).id],
        trackInventory: true,
      })
      .expect(201);
    return { adminToken, outletId, productId: body<IdRow>(prod).id };
  }

  async function newOrder(adminToken: string, outletId: number, productId: number, quantity: number) {
    const res = await request(http())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'SR3 Customer',
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Test St',
        orderType: 'pickup',
        outletId,
        items: [{ productId, quantity }],
      })
      .expect(201);
    return body<OrderRow>(res);
  }

  function setStatus(token: string, orderId: number, status: string) {
    return request(http())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status });
  }

  async function stockAt(token: string, outletId: number, productId: number) {
    const res = await request(http())
      .get(`/products/${productId}?outletId=${outletId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return body<{ stockQuantity: number | null }>(res).stockQuantity ?? 0;
  }

  it('F1: a branch user whose branch role lacks orders.manage cannot create a return (refund + restock)', async () => {
    const { adminToken, outletId, productId } = await setupShop('sr3-ret-perm');
    const order = await newOrder(adminToken, outletId, productId, 1);
    for (const s of ['confirmed', 'preparing', 'out_for_delivery', 'delivered'])
      await setStatus(adminToken, order.id, s).expect(200);

    const email = `sr3-ret-staff-${runId}@test.com`;
    const staff = await request(http())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'View Only Staff', email, password: 'password123', role: 'branch', outletId })
      .expect(201);
    const role = await request(http())
      .post('/shop/branch-roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'View only', permissions: ['orders.view'] })
      .expect(201);
    await request(http())
      .post('/shop/branch-roles/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: body<IdRow>(staff).id, outletId, branchRoleId: body<IdRow>(role).id })
      .expect(201);
    const login = await request(http()).post('/auth/login').send({ email, password: 'password123' }).expect(201);
    const branchToken = body<{ accessToken: string }>(login).accessToken;

    // Control: the same restriction IS enforced on status changes.
    const order2 = await newOrder(adminToken, outletId, productId, 1);
    await setStatus(branchToken, order2.id, 'confirmed').expect(403);

    const detail = await request(http()).get(`/orders/${order.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    const res = await request(http())
      .post(`/orders/${order.id}/returns`)
      .set('Authorization', `Bearer ${branchToken}`)
      .send({ items: [{ orderItemId: body<OrderRow>(detail).orderitem[0].id, quantity: 1 }], reason: 'damaged' });
    expect(res.status).toBe(403); // actual on origin/main: 201 (return, refund and restock recorded)
  });

  it('F2: duplicate-identity lines in PATCH /orders/:id/items desync stock from what the order holds', async () => {
    const { adminToken, outletId, productId } = await setupShop('sr3-dup-lines');
    await request(http())
      .post('/products/stock/adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId, outletId, delta: 10, reason: 'received' })
      .expect(201);
    const order = await newOrder(adminToken, outletId, productId, 2);
    await setStatus(adminToken, order.id, 'confirmed').expect(200);
    expect(await stockAt(adminToken, outletId, productId)).toBe(8);

    // The order now has 6 units (5 + 1), but the diff map keeps only the LAST line per identity.
    await request(http())
      .patch(`/orders/${order.id}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        items: [
          { productId, quantity: 5 },
          { productId, quantity: 1 },
        ],
      })
      .expect(200);
    // 6 units held by the order => 4 left. Actual on origin/main: 9 (only a 1-unit delta was applied, in the wrong direction).
    expect(await stockAt(adminToken, outletId, productId)).toBe(4);
  });
});
