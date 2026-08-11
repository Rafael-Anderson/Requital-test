import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

interface AuthResponse {
  accessToken: string;
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface OrderRow {
  id: number;
  status: string;
}
interface HistoryEntry {
  status: string | null;
  timestamp: string;
  actorName: string | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Regression-tests the timeline built off the CAS order state machine's real
// transitions (OrdersService.updateStatus/.cancel), sourced from the audit
// log rather than a new parallel status-history table — see
// OrdersService.getHistory. Also covers the gap this feature caught and
// fixed: cancel() previously wrote no audit-log entry at all.
describe('Order status history/timeline (e2e)', () => {
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

  async function setupShop(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'History Test Admin',
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
    const outletA = body<OutletRow[]>(outlets)[0].id;

    const outletBRes = await request(app.getHttpServer())
      .post('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `History Outlet B ${slug}` })
      .expect(201);
    const outletB = body<IdRow>(outletBRes).id;

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
        name: `History Item ${Math.random()}`,
        price: 10,
        thumbnail: 'https://example.com/x.jpg',
        sku: `HIST-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        collectionIds: [collectionId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    return { adminToken, outletA, outletB, slug, productId };
  }

  async function createOrder(
    adminToken: string,
    outletId: number,
    productId: number,
  ) {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'History Customer',
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        orderType: 'pickup',
        outletId,
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);
    return body<OrderRow>(res);
  }

  it('a freshly placed order has a single "pending" entry timestamped at creation', async () => {
    const { adminToken, outletA, productId } =
      await setupShop('history-placed');
    const order = await createOrder(adminToken, outletA, productId);

    const res = await request(app.getHttpServer())
      .get(`/orders/${order.id}/history`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const history = body<HistoryEntry[]>(res);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('pending');
    expect(history[0].timestamp).toBeTruthy();
  });

  it('records one entry per real transition, in order, with the acting staff member', async () => {
    const { adminToken, outletA, productId } = await setupShop(
      'history-transitions',
    );
    const order = await createOrder(adminToken, outletA, productId);

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

    const res = await request(app.getHttpServer())
      .get(`/orders/${order.id}/history`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const history = body<HistoryEntry[]>(res);
    expect(history.map((h) => h.status)).toEqual([
      'pending',
      'confirmed',
      'preparing',
    ]);
    expect(history[1].actorName).toBe('History Test Admin');
    expect(history[2].actorName).toBe('History Test Admin');
    // Strictly increasing timestamps, oldest first.
    const times = history.map((h) => new Date(h.timestamp).getTime());
    expect(times[0]).toBeLessThanOrEqual(times[1]);
    expect(times[1]).toBeLessThanOrEqual(times[2]);
  });

  // The actual bug this feature found and fixed: cancel() is a separate
  // method/endpoint from updateStatus() and previously wrote no audit-log
  // entry at all, which would have silently dropped every cancellation from
  // this timeline.
  it('a cancellation appears in the timeline, not just the live status', async () => {
    const { adminToken, outletA, productId } =
      await setupShop('history-cancel');
    const order = await createOrder(adminToken, outletA, productId);

    await request(app.getHttpServer())
      .post(`/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/orders/${order.id}/history`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const history = body<HistoryEntry[]>(res);
    expect(history.map((h) => h.status)).toEqual(['pending', 'cancelled']);
    expect(history[1].actorName).toBe('History Test Admin');
  });

  it('viewer can read the timeline (same read access as the order detail fetch)', async () => {
    const { adminToken, outletA, productId } =
      await setupShop('history-viewer');
    const order = await createOrder(adminToken, outletA, productId);

    const staffEmail = `history-viewer-staff-${runId}@test.com`;
    await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Viewer',
        email: staffEmail,
        password: 'password123',
        role: 'viewer',
      })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password: 'password123' })
      .expect(201);
    const viewerToken = body<AuthResponse>(login).accessToken;

    const res = await request(app.getHttpServer())
      .get(`/orders/${order.id}/history`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(body<HistoryEntry[]>(res)).toHaveLength(1);
  });

  it('adversarial: a branch user pinned to outlet A gets 404 for an order placed at outlet B', async () => {
    const { adminToken, outletA, outletB, productId } = await setupShop(
      'history-branch-scope',
    );
    const orderAtB = await createOrder(adminToken, outletB, productId);

    const staffEmail = `history-branch-scope-staff-${runId}@test.com`;
    await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Branch A Staff',
        email: staffEmail,
        password: 'password123',
        role: 'branch',
        outletId: outletA,
      })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password: 'password123' })
      .expect(201);
    const branchToken = body<AuthResponse>(login).accessToken;

    await request(app.getHttpServer())
      .get(`/orders/${orderAtB.id}/history`)
      .set('Authorization', `Bearer ${branchToken}`)
      .expect(404);
  });

  it("adversarial: cannot read another shop's order history by spoofing its id", async () => {
    const shopA = await setupShop('history-tenant-a');
    const shopB = await setupShop('history-tenant-b');
    const orderA = await createOrder(
      shopA.adminToken,
      shopA.outletA,
      shopA.productId,
    );

    await request(app.getHttpServer())
      .get(`/orders/${orderA.id}/history`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(404);
  });
});
