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
}
interface StockSnapshot {
  products?: { outletId: number; productId: number; stockQuantity: number }[];
  variants?: { outletId: number; variantId: number; stockQuantity: number }[];
}
interface MovementRow {
  id: number;
  productId: number;
  type: string;
  reason: string | null;
  delta: number;
  outletId: number;
  toOutletId: number | null;
  actorName: string;
}
interface MovementList {
  data: MovementRow[];
  total: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Inventory movements: transfer + reason-coded adjustment (e2e)', () => {
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
        name: 'Movements Test Admin',
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
      .send({ name: `Outlet B ${slug}` })
      .expect(201);
    const outletB = body<IdRow>(outletBRes).id;

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Movement Item ${Math.random()}`,
        price: 20,
        thumbnail: 'https://example.com/x.jpg',
        sku: `MOV-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [categoryId],
        trackInventory: true,
      })
      .expect(201);
    const productId = body<ProductRow>(product).id;

    return { adminToken, outletA, outletB, categoryId, productId, slug };
  }

  async function seedStock(adminToken: string, outletId: number, productId: number, qty: number) {
    await request(app.getHttpServer())
      .post('/products/stock/adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId, outletId, delta: qty, reason: 'received' })
      .expect(201);
  }

  async function stockAt(adminToken: string, outletId: number, productId: number): Promise<number> {
    const res = await request(app.getHttpServer())
      .get(`/products/${productId}?outletId=${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return body<{ stockQuantity: number | null }>(res).stockQuantity ?? 0;
  }

  describe('transfer', () => {
    it('moves stock atomically from one outlet to another and logs a TRANSFER movement', async () => {
      const { adminToken, outletA, outletB, productId } = await setupShop('transfer-basic');
      await seedStock(adminToken, outletA, productId, 50);

      const res = await request(app.getHttpServer())
        .post('/products/stock/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, fromOutletId: outletA, toOutletId: outletB, quantity: 20, note: 'rebalancing' })
        .expect(201);
      const snapshot = body<StockSnapshot>(res);
      const byOutlet = new Map(snapshot.products!.map((p) => [p.outletId, p.stockQuantity]));
      expect(byOutlet.get(outletA)).toBe(30);
      expect(byOutlet.get(outletB)).toBe(20);

      expect(await stockAt(adminToken, outletA, productId)).toBe(30);
      expect(await stockAt(adminToken, outletB, productId)).toBe(20);

      const movements = await request(app.getHttpServer())
        .get(`/products/stock/movements?productId=${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const list = body<MovementList>(movements);
      const transferRow = list.data.find((m) => m.type === 'TRANSFER')!;
      expect(transferRow).toBeTruthy();
      expect(transferRow.delta).toBe(20);
      expect(transferRow.outletId).toBe(outletA);
      expect(transferRow.toOutletId).toBe(outletB);
      expect(transferRow.reason).toBeNull();
    });

    it('rejects a transfer that exceeds available stock (409) and mutates nothing', async () => {
      const { adminToken, outletA, outletB, productId } = await setupShop('transfer-insufficient');
      await seedStock(adminToken, outletA, productId, 5);

      await request(app.getHttpServer())
        .post('/products/stock/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, fromOutletId: outletA, toOutletId: outletB, quantity: 999 })
        .expect(409);

      expect(await stockAt(adminToken, outletA, productId)).toBe(5);
      expect(await stockAt(adminToken, outletB, productId)).toBe(0);
    });

    it('rejects fromOutletId === toOutletId', async () => {
      const { adminToken, outletA, productId } = await setupShop('transfer-same');
      await seedStock(adminToken, outletA, productId, 10);
      await request(app.getHttpServer())
        .post('/products/stock/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, fromOutletId: outletA, toOutletId: outletA, quantity: 1 })
        .expect(400);
    });

    it('race: two concurrent transfers of 30 units each from an outlet with only 40 units — exactly one succeeds', async () => {
      const { adminToken, outletA, outletB, productId } = await setupShop('transfer-race');
      await seedStock(adminToken, outletA, productId, 40);

      const attempt = () =>
        request(app.getHttpServer())
          .post('/products/stock/transfer')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ productId, fromOutletId: outletA, toOutletId: outletB, quantity: 30 });

      const results = await Promise.all([attempt(), attempt()]);
      const succeeded = results.filter((r) => r.status === 201);
      const failed = results.filter((r) => r.status === 409 || r.status === 500);
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      // Final stock must reflect exactly ONE 30-unit transfer, never both
      // (which would require -20 at the source) and never neither.
      expect(await stockAt(adminToken, outletA, productId)).toBe(10);
      expect(await stockAt(adminToken, outletB, productId)).toBe(30);
    });
  });

  describe('reason-coded adjustment', () => {
    it('applies a positive adjustment and logs the reason', async () => {
      const { adminToken, outletA, productId } = await setupShop('adjust-received');
      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, outletId: outletA, delta: 15, reason: 'received', note: 'PO #4471' })
        .expect(201);
      expect(await stockAt(adminToken, outletA, productId)).toBe(15);

      const movements = await request(app.getHttpServer())
        .get(`/products/stock/movements?productId=${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const row = body<MovementList>(movements).data[0];
      expect(row.reason).toBe('received');
      expect(row.delta).toBe(15);
      expect(row.type).toBe('ADJUSTMENT');
    });

    it('applies a negative adjustment (damaged) and rejects one that would go below zero', async () => {
      const { adminToken, outletA, productId } = await setupShop('adjust-damaged');
      await seedStock(adminToken, outletA, productId, 10);

      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, outletId: outletA, delta: -3, reason: 'damaged' })
        .expect(201);
      expect(await stockAt(adminToken, outletA, productId)).toBe(7);

      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, outletId: outletA, delta: -100, reason: 'damaged' })
        .expect(409);
      expect(await stockAt(adminToken, outletA, productId)).toBe(7);
    });

    it('rejects an invalid reason value', async () => {
      const { adminToken, outletA, productId } = await setupShop('adjust-bad-reason');
      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, outletId: outletA, delta: 5, reason: 'because I said so' })
        .expect(400);
    });
  });

  describe('tenant isolation + role enforcement (adversarial)', () => {
    it("an admin from shop B cannot transfer or adjust shop A's stock by supplying its ids", async () => {
      const shopA = await setupShop('tenant-a');
      const shopB = await setupShop('tenant-b');
      await seedStock(shopA.adminToken, shopA.outletA, shopA.productId, 50);

      await request(app.getHttpServer())
        .post('/products/stock/transfer')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ productId: shopA.productId, fromOutletId: shopA.outletA, toOutletId: shopA.outletB, quantity: 1 })
        .expect(400);

      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ productId: shopA.productId, outletId: shopA.outletA, delta: 5, reason: 'received' })
        .expect(400);

      // Stock at shop A's outlet must be completely untouched by shop B's attempt.
      expect(await stockAt(shopA.adminToken, shopA.outletA, shopA.productId)).toBe(50);
    });

    it('branch cannot transfer (admin-only) but can adjust with reason at their own outlet', async () => {
      const { adminToken, outletA, outletB, productId } = await setupShop('branch-scope');
      await seedStock(adminToken, outletA, productId, 20);

      const staffEmail = `branch-scope-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Branch', email: staffEmail, password: 'password123', role: 'branch', outletId: outletA })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .post('/products/stock/transfer')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ productId, fromOutletId: outletA, toOutletId: outletB, quantity: 1 })
        .expect(403);

      // Adjust ignores any outletId the branch user sends — always forced
      // onto their own, same rule as bulk-adjust.
      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ productId, outletId: outletB, delta: 5, reason: 'recount' })
        .expect(201);
      expect(await stockAt(adminToken, outletA, productId)).toBe(25);
      expect(await stockAt(adminToken, outletB, productId)).toBe(0);
    });

    it('viewer cannot transfer or adjust', async () => {
      const { adminToken, outletA, outletB, productId } = await setupShop('viewer-scope-mv');
      const staffEmail = `viewer-scope-mv-staff-${runId}@test.com`;
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
        .post('/products/stock/transfer')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ productId, fromOutletId: outletA, toOutletId: outletB, quantity: 1 })
        .expect(403);
      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ productId, outletId: outletA, delta: 1, reason: 'received' })
        .expect(403);
    });

    it("a branch user's movement history only ever shows their own outlet's side of things", async () => {
      const { adminToken, outletA, outletB, productId } = await setupShop('branch-history');
      await seedStock(adminToken, outletA, productId, 30);
      await request(app.getHttpServer())
        .post('/products/stock/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, fromOutletId: outletA, toOutletId: outletB, quantity: 10 })
        .expect(201);

      const staffEmail = `branch-history-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Branch B', email: staffEmail, password: 'password123', role: 'branch', outletId: outletB })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const branchBToken = body<AuthResponse>(login).accessToken;

      const movements = await request(app.getHttpServer())
        .get(`/products/stock/movements?productId=${productId}`)
        .set('Authorization', `Bearer ${branchBToken}`)
        .expect(200);
      const list = body<MovementList>(movements);
      // Branch B receives the transfer (toOutletId = outletB) so it's
      // visible to them, but every row must involve their own outlet.
      expect(list.data.length).toBeGreaterThan(0);
      for (const row of list.data) {
        expect([row.outletId, row.toOutletId]).toContain(outletB);
      }
    });
  });
});
