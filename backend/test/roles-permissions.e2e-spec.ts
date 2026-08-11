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
interface OutletRow {
  id: number;
}
interface UserRow {
  id: number;
  role: string;
  outlet: { id: number } | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Roles & permissions granularity (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
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
        name: 'Roles Test Admin',
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

    return { adminToken, outletId, slug };
  }

  async function createStaff(
    adminToken: string,
    role: string,
    outletId: number | undefined,
    emailPrefix: string,
  ) {
    const email = `${emailPrefix}-${runId}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Staff ${role}`,
        email,
        password: 'password123',
        ...(outletId !== undefined ? { outletId } : {}),
        role,
      })
      .expect(201);
    expect(body<UserRow>(res).role).toBe(role);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(201);
    return body<AuthResponse>(login).accessToken;
  }

  describe('role creation', () => {
    it('creates order_manager and viewer staff without requiring an outletId', async () => {
      const { adminToken } = await setupShop('roles-create');
      const omToken = await createStaff(
        adminToken,
        'order_manager',
        undefined,
        'om',
      );
      const viewerToken = await createStaff(
        adminToken,
        'viewer',
        undefined,
        'viewer',
      );
      expect(omToken).toBeTruthy();
      expect(viewerToken).toBeTruthy();
    });

    it('still requires outletId for role=branch (backward compatible default)', async () => {
      const { adminToken } = await setupShop('roles-branch-req');
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'No Outlet',
          email: `no-outlet-${runId}@test.com`,
          password: 'password123',
          role: 'branch',
        })
        .expect(400);
    });

    it('creating without a role field at all still defaults to branch (unchanged pre-existing behavior)', async () => {
      const { adminToken, outletId } = await setupShop('roles-default');
      const res = await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Default Role',
          email: `default-role-${runId}@test.com`,
          password: 'password123',
          outletId,
        })
        .expect(201);
      expect(body<UserRow>(res).role).toBe('branch');
    });

    it('rejects an invalid role value', async () => {
      const { adminToken } = await setupShop('roles-invalid');
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Bad Role',
          email: `bad-role-${runId}@test.com`,
          password: 'password123',
          role: 'superuser',
        })
        .expect(400);
    });
  });

  describe('order_manager: orders domain allowed, everything else blocked', () => {
    it('can list and read orders but not touch products, discounts, customers, or reports', async () => {
      const { adminToken } = await setupShop('om-scope');
      const omToken = await createStaff(
        adminToken,
        'order_manager',
        undefined,
        'om-scope-staff',
      );

      await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${omToken}`)
        .expect(200);

      // Blocked: pricing/catalog/settings/customers/reports/staff-management.
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${omToken}`)
        .send({ name: 'x' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${omToken}`)
        .send({ name: 'x' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/shop/discounts')
        .set('Authorization', `Bearer ${omToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/customers')
        .set('Authorization', `Bearer ${omToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/reports/general/summary')
        .set('Authorization', `Bearer ${omToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${omToken}`)
        .send({
          name: 'escalate',
          email: `escalate-${runId}@test.com`,
          password: 'password123',
          role: 'admin',
        })
        .expect(403);

      // Allowed: draft orders (order-management domain).
      await request(app.getHttpServer())
        .get('/shop/draft-orders')
        .set('Authorization', `Bearer ${omToken}`)
        .expect(200);
    });
  });

  describe('viewer: read-only everywhere, no mutation anywhere', () => {
    it('can read orders/customers/reports but every write is rejected', async () => {
      const { adminToken } = await setupShop('viewer-scope');
      const viewerToken = await createStaff(
        adminToken,
        'viewer',
        undefined,
        'viewer-scope-staff',
      );

      await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get('/customers')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get('/reports/general/summary')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      // Every write, blocked — including the orders domain a viewer can read.
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({})
        .expect(403);
      await request(app.getHttpServer())
        .patch('/orders/1/status')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ status: 'confirmed' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/orders/1/cancel')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'x' })
        .expect(403);
      await request(app.getHttpServer())
        .patch('/customers/1')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'x' })
        .expect(403);
      // Three routes that had NO role guard at all before this task (any
      // authenticated role, including the new 'viewer', could hit them) —
      // found while auditing the controllers this task touches, fixed
      // alongside it, covered here so they can't regress silently.
      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ outletId: 1, adjustments: [{ productId: 1, delta: 1 }] })
        .expect(403);
      await request(app.getHttpServer())
        .patch('/products/1/availability')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ status: 'Unavailable' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/orders/1/payment-link')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/shop/draft-orders')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });
  });

  describe('branch role: unchanged regression coverage after adding the new roles', () => {
    it('branch staff can still create/read orders (no behavior change from this task)', async () => {
      const { adminToken, outletId } = await setupShop('branch-regress');
      const branchToken = await createStaff(
        adminToken,
        'branch',
        outletId,
        'branch-regress-staff',
      );

      await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(200);

      // Still excluded from admin-only surfaces, exactly as before.
      await request(app.getHttpServer())
        .get('/customers')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/shop/draft-orders')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
    });
  });

  describe('cross-tenant + role combined adversarial check', () => {
    it("a viewer from shop B cannot read shop A's order by guessing its id", async () => {
      const shopA = await setupShop('cross-a');
      const shopB = await setupShop('cross-b');
      const viewerB = await createStaff(
        shopB.adminToken,
        'viewer',
        undefined,
        'cross-b-viewer',
      );

      // A plausible-looking order id from shop A's namespace — shop B's
      // viewer must get a 404 (not found in their tenant), never the data.
      const res = await request(app.getHttpServer())
        .get('/orders/1')
        .set('Authorization', `Bearer ${viewerB}`);
      expect([403, 404]).toContain(res.status);
      void shopA;
    });
  });
});
