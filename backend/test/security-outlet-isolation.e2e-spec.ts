import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// supertest types response bodies as `any` — these describe just enough of
// each JSON shape this file reads to satisfy the strict no-unsafe-* lint
// rules without duplicating the full backend response DTOs.
interface OrderRow {
  id: number;
  outletId: number;
  status: string;
}
interface OrderListBody {
  data: OrderRow[];
}
interface RevenuePoint {
  revenue: number;
}
interface OutletBreakdown {
  outletId: number;
  orderCount: number;
}
interface DashboardSummaryBody {
  outlets: OutletBreakdown[];
}
interface OutletRow {
  id: number;
}
interface IdRow {
  id: number;
}
interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: { role: string; outletId: number | null };
}
interface SignupResponse extends AuthResponse {
  devVerificationLink?: string;
}

// The dev-only devVerificationLink/devResetLink in non-production auth
// responses (see auth.service.ts — no real email infra exists) carries the
// raw token as a query param; tests that need to actually verify/reset pull
// it out this way instead of querying the DB directly for the token hash.
function tokenFromDevLink(link: string): string {
  return new URL(link).searchParams.get('token')!;
}
interface DeliveryZoneRow {
  id: number;
  outletId: number;
  name: string;
  isActive: boolean;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Proves the branch-user outlet-override rule actually holds server-side,
// not just by reasoning about the code: a branch account assigned to one
// outlet must never be able to read or mutate a sibling outlet's data (or
// another shop's data entirely) no matter what outletId/shopId it supplies
// on the request — every outlet-scoped endpoint either silently re-scopes
// the request to the caller's own outlet, or rejects it outright.
describe('Outlet & shop isolation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  // Unique per run so repeated executions don't collide on shop.subdomain's
  // unique constraint.
  const runId = Date.now();

  let shopAAdminToken: string;
  let shopABranchToken: string; // scoped to outletA1
  let outletA1Id: number;
  let outletA2Id: number;
  let productAId: number;
  let orderA1Id: number; // belongs to outletA1
  let orderA2Id: number; // belongs to outletA2 — the branch user must never reach this

  let outletA1ZoneId: number; // belongs to outletA1
  let outletA2ZoneId: number; // belongs to outletA2 — the branch user must never reach this

  let shopBAdminToken: string;
  let outletB1Id: number;
  let outletB1ZoneId: number; // belongs to a different shop entirely
  let orderB1Id: number; // belongs to a different shop entirely

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors main.ts's global pipe exactly — the real request-validation
    // behavior, not a relaxed test stand-in.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    // --- Shop A: two outlets, an admin, and a branch user pinned to outletA1 ---
    const signupA = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Admin A',
        email: `admin-a-${runId}@test.com`,
        password: 'password123',
        shopName: 'Security Test Shop A',
        subdomain: `sec-test-a-${runId}`,
      })
      .expect(201);
    shopAAdminToken = body<AuthResponse>(signupA).accessToken;

    // Signup auto-creates one default outlet — that's outletA1.
    const outletsA = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${shopAAdminToken}`)
      .expect(200);
    outletA1Id = body<OutletRow[]>(outletsA)[0].id;

    const outletA2Res = await request(app.getHttpServer())
      .post('/outlets')
      .set('Authorization', `Bearer ${shopAAdminToken}`)
      .send({ name: 'Outlet A2' })
      .expect(201);
    outletA2Id = body<IdRow>(outletA2Res).id;

    const branchUserRes = await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${shopAAdminToken}`)
      .send({
        name: 'Branch A1',
        email: `branch-a1-${runId}@test.com`,
        password: 'password123',
        outletId: outletA1Id,
      })
      .expect(201);
    expect(body<{ outletId: number }>(branchUserRes).outletId).toBe(outletA1Id);

    const branchLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `branch-a1-${runId}@test.com`, password: 'password123' })
      .expect(201);
    const branchAuth = body<AuthResponse>(branchLogin);
    shopABranchToken = branchAuth.accessToken;
    expect(branchAuth.user.role).toBe('branch');
    expect(branchAuth.user.outletId).toBe(outletA1Id);

    const categoryA = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${shopAAdminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);

    const productA = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shopAAdminToken}`)
      .send({
        name: 'Rose Bouquet',
        price: 100,
        thumbnail: 'https://example.com/rose.jpg',
        sku: `ROSE-${runId}`,
        trackInventory: true,
        categoryIds: [body<IdRow>(categoryA).id],
      })
      .expect(201);
    productAId = body<IdRow>(productA).id;

    const orderPayload = (outletId: number) => ({
      customerName: 'Test Customer',
      customerPhone: '0501234567',
      customerAddress: '1 Sheikh Zayed Rd',
      emirate: 'Dubai',
      outletId,
      items: [{ productId: productAId, quantity: 1 }],
    });

    const orderA1 = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shopAAdminToken}`)
      .send(orderPayload(outletA1Id))
      .expect(201);
    orderA1Id = body<IdRow>(orderA1).id;

    const orderA2 = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shopAAdminToken}`)
      .send(orderPayload(outletA2Id))
      .expect(201);
    orderA2Id = body<IdRow>(orderA2).id;

    // Give outletA2 a known, distinct stock baseline so the spoofed
    // bulk-adjust test can prove it was never touched.
    await request(app.getHttpServer())
      .patch('/products/stock/bulk-adjust')
      .set('Authorization', `Bearer ${shopAAdminToken}`)
      .send({
        outletId: outletA2Id,
        adjustments: [{ productId: productAId, delta: 50 }],
      })
      .expect(200);

    const zoneA1 = await request(app.getHttpServer())
      .post(`/outlets/${outletA1Id}/delivery-zones`)
      .set('Authorization', `Bearer ${shopAAdminToken}`)
      .send({ name: 'Dubai', fee: 10, minOrderAmount: 50 })
      .expect(201);
    outletA1ZoneId = body<IdRow>(zoneA1).id;

    const zoneA2 = await request(app.getHttpServer())
      .post(`/outlets/${outletA2Id}/delivery-zones`)
      .set('Authorization', `Bearer ${shopAAdminToken}`)
      .send({ name: 'Sharjah', fee: 15, minOrderAmount: 75 })
      .expect(201);
    outletA2ZoneId = body<IdRow>(zoneA2).id;

    // --- Shop B: an entirely separate tenant, for the cross-shop checks ---
    const signupB = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Admin B',
        email: `admin-b-${runId}@test.com`,
        password: 'password123',
        shopName: 'Security Test Shop B',
        subdomain: `sec-test-b-${runId}`,
      })
      .expect(201);
    shopBAdminToken = body<AuthResponse>(signupB).accessToken;

    const outletsB = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${shopBAdminToken}`)
      .expect(200);
    outletB1Id = body<OutletRow[]>(outletsB)[0].id;

    const zoneB1 = await request(app.getHttpServer())
      .post(`/outlets/${outletB1Id}/delivery-zones`)
      .set('Authorization', `Bearer ${shopBAdminToken}`)
      .send({ name: 'Abu Dhabi', fee: 20, minOrderAmount: 100 })
      .expect(201);
    outletB1ZoneId = body<IdRow>(zoneB1).id;

    const categoryB = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${shopBAdminToken}`)
      .send({ name: 'Gifts' })
      .expect(201);
    const productB = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shopBAdminToken}`)
      .send({
        name: 'Gift Box',
        price: 50,
        thumbnail: 'https://example.com/gift.jpg',
        sku: `GIFT-${runId}`,
        categoryIds: [body<IdRow>(categoryB).id],
      })
      .expect(201);

    // Note: orderPayload() above defaults to productAId, which belongs to
    // Shop A — Shop B's order must reference Shop B's own product instead,
    // or the create endpoint's cross-tenant product check rejects it.
    const orderB1 = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shopBAdminToken}`)
      .send({
        customerName: 'Test Customer B',
        customerPhone: '0509999999',
        customerAddress: '1 Corniche Rd',
        emirate: 'Abu Dhabi',
        outletId: outletB1Id,
        items: [{ productId: body<IdRow>(productB).id, quantity: 1 }],
      })
      .expect(201);
    orderB1Id = body<IdRow>(orderB1).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('Spoofing attempts from the outletA1 branch account', () => {
    it('GET /orders?outletId=<A2> silently re-scopes to A1, never returns A2 orders', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders?outletId=${outletA2Id}&pageSize=100`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(200);
      const ids = body<OrderListBody>(res).data.map((o) => o.id);
      expect(ids).not.toContain(orderA2Id);
      expect(ids).toContain(orderA1Id);
    });

    it('GET /orders/:id for an A2 order returns 404, not the order', async () => {
      await request(app.getHttpServer())
        .get(`/orders/${orderA2Id}`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(404);
    });

    it('PATCH /orders/:id/status on an A2 order returns 404, does not mutate it', async () => {
      await request(app.getHttpServer())
        .patch(`/orders/${orderA2Id}/status`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .send({ status: 'confirmed' })
        .expect(404);

      // Confirm directly against the DB that A2's order was left untouched.
      const untouched = await prisma.order.findUniqueOrThrow({
        where: { id: orderA2Id },
      });
      expect(untouched.status).toBe('pending');
    });

    it('POST /orders/:id/cancel on an A2 order returns 404, does not cancel it', async () => {
      await request(app.getHttpServer())
        .post(`/orders/${orderA2Id}/cancel`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(404);
    });

    it('POST /orders with a spoofed outletId=A2 in the body is ignored — order is created under A1', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .send({
          customerName: 'Spoof Attempt',
          customerPhone: '0501111111',
          customerAddress: '1 Sheikh Zayed Rd',
          emirate: 'Dubai',
          outletId: outletA2Id, // the branch user is trying to place an order at a branch they don't run
          items: [{ productId: productAId, quantity: 1 }],
        })
        .expect(201);
      expect(body<OrderRow>(res).outletId).toBe(outletA1Id);
      expect(body<OrderRow>(res).outletId).not.toBe(outletA2Id);
    });

    it('PATCH /products/stock/bulk-adjust with outletId=A2 never touches A2 stock', async () => {
      const before = await prisma.outletstock.findUniqueOrThrow({
        where: {
          outletId_productId: { outletId: outletA2Id, productId: productAId },
        },
      });

      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .send({
          outletId: outletA2Id,
          adjustments: [{ productId: productAId, delta: 1000 }],
        })
        .expect(200);

      const after = await prisma.outletstock.findUniqueOrThrow({
        where: {
          outletId_productId: { outletId: outletA2Id, productId: productAId },
        },
      });
      // A2's stock must be exactly what it was before this request — the
      // +1000 delta must have landed on A1 (or been rejected), never A2.
      expect(after.stockQuantity).toBe(before.stockQuantity);
    });

    it('GET /dashboard/summary?outletId=<A2> returns A1-scoped numbers, not A2 aggregated data', async () => {
      const res = await request(app.getHttpServer())
        .get(`/dashboard/summary?outletId=${outletA2Id}`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(200);
      // Exactly one outlet in the breakdown, and it's A1 — not A2, and not
      // an aggregate spanning both.
      const summary = body<DashboardSummaryBody>(res);
      expect(summary.outlets).toHaveLength(1);
      expect(summary.outlets[0].outletId).toBe(outletA1Id);
    });

    // Rather than hardcode an expected revenue figure (fragile — it'd have
    // to track exactly how many orders earlier tests in this file created),
    // these compare the branch user's spoofed-outletId result against
    // authoritative admin-fetched baselines for each real outlet. A2's
    // baseline being nonzero is what makes the equality check meaningful —
    // if it leaked, the branch result would land between the two, not
    // exactly match A1's.
    async function revenueTotalAsAdmin(outletId: number): Promise<number> {
      const res = await request(app.getHttpServer())
        .get(`/dashboard/revenue-daily?outletId=${outletId}`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(200);
      return body<RevenuePoint[]>(res).reduce(
        (sum, point) => sum + point.revenue,
        0,
      );
    }

    it("GET /dashboard/revenue-daily?outletId=<A2> sums to A1's true revenue only, not A1+A2 combined", async () => {
      const [adminA1Total, adminA2Total] = await Promise.all([
        revenueTotalAsAdmin(outletA1Id),
        revenueTotalAsAdmin(outletA2Id),
      ]);
      expect(adminA2Total).toBeGreaterThan(0); // otherwise this test can't distinguish leakage from coincidence

      const res = await request(app.getHttpServer())
        .get(`/dashboard/revenue-daily?outletId=${outletA2Id}`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(200);
      const branchTotal = body<RevenuePoint[]>(res).reduce(
        (sum, point) => sum + point.revenue,
        0,
      );
      expect(branchTotal).toBe(adminA1Total);
      expect(branchTotal).not.toBe(adminA1Total + adminA2Total);
    });

    it("GET /dashboard/top-products?outletId=<A2> reflects A1's sales only", async () => {
      const adminA1 = await request(app.getHttpServer())
        .get(`/dashboard/top-products?outletId=${outletA1Id}`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(200);
      const adminA1Total = body<RevenuePoint[]>(adminA1).reduce(
        (sum, p) => sum + p.revenue,
        0,
      );

      const branchRes = await request(app.getHttpServer())
        .get(`/dashboard/top-products?outletId=${outletA2Id}`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(200);
      const branchTotal = body<RevenuePoint[]>(branchRes).reduce(
        (sum, p) => sum + p.revenue,
        0,
      );
      expect(branchTotal).toBe(adminA1Total);
    });

    it("GET /outlets/:id for A2 returns 404 — a branch user can't even read a sibling outlet's info", async () => {
      await request(app.getHttpServer())
        .get(`/outlets/${outletA2Id}`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(404);
    });

    it("GET /outlets (list) only ever contains the branch user's own outlet", async () => {
      const res = await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(200);
      const outlets = body<OutletRow[]>(res);
      expect(outlets).toHaveLength(1);
      expect(outlets[0].id).toBe(outletA1Id);
    });

    it('PATCH /outlets/:id on A2 (admin-only route) is rejected — role guard, not just outlet scoping', async () => {
      await request(app.getHttpServer())
        .patch(`/outlets/${outletA2Id}`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .send({ name: 'Renamed by branch user' })
        .expect(403);
    });

    it("GET /outlets/:A2/delivery-zones returns 404 — a branch user can't list a sibling outlet's zones", async () => {
      await request(app.getHttpServer())
        .get(`/outlets/${outletA2Id}/delivery-zones`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(404);
    });

    it('POST /outlets/:A1/delivery-zones (admin-only, even for their own outlet) is rejected for a branch user', async () => {
      await request(app.getHttpServer())
        .post(`/outlets/${outletA1Id}/delivery-zones`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .send({ name: 'Sneaky Zone', fee: 1 })
        .expect(403);
    });

    it("PATCH /outlets/:A2/delivery-zones/:zoneA2 is rejected for a branch user (403 role guard, not 404) and does not mutate the zone", async () => {
      await request(app.getHttpServer())
        .patch(`/outlets/${outletA2Id}/delivery-zones/${outletA2ZoneId}`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .send({ name: 'Renamed by branch user' })
        .expect(403);

      const untouched = await prisma.deliveryzone.findUniqueOrThrow({
        where: { id: outletA2ZoneId },
      });
      expect(untouched.name).toBe('Sharjah');
    });

    it('DELETE /outlets/:A1/delivery-zones/:zoneA1 is rejected for a branch user, zone still exists', async () => {
      await request(app.getHttpServer())
        .delete(`/outlets/${outletA1Id}/delivery-zones/${outletA1ZoneId}`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(403);

      await expect(
        prisma.deliveryzone.findUniqueOrThrow({ where: { id: outletA1ZoneId } }),
      ).resolves.toBeTruthy();
    });
  });

  describe("The same branch account's unspoofed requests still work correctly", () => {
    it("GET /orders (no outletId) returns A1's order", async () => {
      const res = await request(app.getHttpServer())
        .get('/orders?pageSize=100')
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(200);
      const ids = body<OrderListBody>(res).data.map((o) => o.id);
      expect(ids).toContain(orderA1Id);
    });

    it('GET /orders/:id for the A1 order returns 200 with correct data', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderA1Id}`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(200);
      const order = body<OrderRow>(res);
      expect(order.id).toBe(orderA1Id);
      expect(order.outletId).toBe(outletA1Id);
    });

    it('PATCH /orders/:id/status on the A1 order succeeds', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderA1Id}/status`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .send({ status: 'confirmed' })
        .expect(200);
      expect(body<OrderRow>(res).status).toBe('confirmed');
    });

    it("PATCH /products/stock/bulk-adjust with no outletId adjusts A1's stock", async () => {
      const before = await prisma.outletstock.findUnique({
        where: {
          outletId_productId: { outletId: outletA1Id, productId: productAId },
        },
      });
      const beforeQty = before?.stockQuantity ?? 0;

      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .send({ adjustments: [{ productId: productAId, delta: 7 }] })
        .expect(200);

      const after = await prisma.outletstock.findUniqueOrThrow({
        where: {
          outletId_productId: { outletId: outletA1Id, productId: productAId },
        },
      });
      expect(after.stockQuantity).toBe(beforeQty + 7);
    });

    it('GET /dashboard/summary (no outletId) reflects A1, not an empty/wrong scope', async () => {
      const res = await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(200);
      const summary = body<DashboardSummaryBody>(res);
      expect(summary.outlets).toHaveLength(1);
      expect(summary.outlets[0].outletId).toBe(outletA1Id);
      expect(summary.outlets[0].orderCount).toBeGreaterThanOrEqual(1);
    });

    it("GET /outlets/:A1/delivery-zones (own outlet) succeeds and returns only A1's zone", async () => {
      const res = await request(app.getHttpServer())
        .get(`/outlets/${outletA1Id}/delivery-zones`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(200);
      const zones = body<DeliveryZoneRow[]>(res);
      expect(zones.map((z) => z.id)).toEqual([outletA1ZoneId]);
      expect(zones[0].name).toBe('Dubai');
    });
  });

  describe('Admin (unlike branch) legitimately can drill into any of their own outlets', () => {
    it("GET /orders?outletId=<A2> as admin returns A2's order", async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders?outletId=${outletA2Id}&pageSize=100`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(200);
      const ids = body<OrderListBody>(res).data.map((o) => o.id);
      expect(ids).toContain(orderA2Id);
    });

    it('GET /orders/:id for the A2 order as admin returns 200', async () => {
      await request(app.getHttpServer())
        .get(`/orders/${orderA2Id}`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(200);
    });

    it('Admin can create, edit, and delete a delivery zone on A2 — full CRUD cycle', async () => {
      const created = await request(app.getHttpServer())
        .post(`/outlets/${outletA2Id}/delivery-zones`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .send({ name: 'Temp Zone', fee: 5, minOrderAmount: 20 })
        .expect(201);
      const zoneId = body<IdRow>(created).id;

      const updated = await request(app.getHttpServer())
        .patch(`/outlets/${outletA2Id}/delivery-zones/${zoneId}`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .send({ isActive: false })
        .expect(200);
      expect(body<DeliveryZoneRow>(updated).isActive).toBe(false);

      await request(app.getHttpServer())
        .delete(`/outlets/${outletA2Id}/delivery-zones/${zoneId}`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(200);

      await expect(
        prisma.deliveryzone.findUnique({ where: { id: zoneId } }),
      ).resolves.toBeNull();
    });
  });

  describe('Cross-shop isolation (Shop A vs Shop B)', () => {
    it("Shop A admin cannot reach Shop B's order by id", async () => {
      await request(app.getHttpServer())
        .get(`/orders/${orderB1Id}`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(404);
    });

    it("Shop A branch user cannot reach Shop B's order by id", async () => {
      await request(app.getHttpServer())
        .get(`/orders/${orderB1Id}`)
        .set('Authorization', `Bearer ${shopABranchToken}`)
        .expect(404);
    });

    it("Shop A admin cannot reach Shop B's outlet by id", async () => {
      await request(app.getHttpServer())
        .get(`/outlets/${outletB1Id}`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(404);
    });

    it("Shop A admin's outlet list never contains Shop B's outlet", async () => {
      const res = await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(200);
      const ids = body<OutletRow[]>(res).map((o) => o.id);
      expect(ids).not.toContain(outletB1Id);
    });

    it("Shop A admin's dashboard summary never includes Shop B's orders", async () => {
      const res = await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(200);
      const outletIds = body<DashboardSummaryBody>(res).outlets.map(
        (o) => o.outletId,
      );
      expect(outletIds).not.toContain(outletB1Id);
    });

    it("Shop A admin trying to drill into Shop B's outletId gets Shop A data, not Shop B's (resolveOutletFilter never crosses shopId)", async () => {
      // outletB1Id belongs to a different shop entirely — Shop A's admin
      // supplying it as a query param must not leak Shop B's numbers.
      const res = await request(app.getHttpServer())
        .get(`/dashboard/summary?outletId=${outletB1Id}`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(200);
      // The outlet.findMany in getSummary is scoped by shopId first, so an
      // out-of-shop outletId simply matches nothing — an empty breakdown,
      // never Shop B's real numbers.
      expect(body<DashboardSummaryBody>(res).outlets).toHaveLength(0);
    });

    it("Shop A admin cannot list Shop B's outlet's delivery zones", async () => {
      await request(app.getHttpServer())
        .get(`/outlets/${outletB1Id}/delivery-zones`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(404);
    });

    it("Shop A admin cannot create a delivery zone on Shop B's outlet", async () => {
      await request(app.getHttpServer())
        .post(`/outlets/${outletB1Id}/delivery-zones`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .send({ name: 'Cross-tenant zone', fee: 1 })
        .expect(404);
    });

    it("Shop A admin using their own outletA1Id in the URL cannot edit Shop B's zone by guessing its id — 404, and the zone is untouched", async () => {
      // outletA1Id passes the outlet-belongs-to-shop check, but zoneB1
      // belongs to a different outlet entirely — assertZoneBelongsToOutlet
      // must catch this even though the outlet-level check alone would pass.
      await request(app.getHttpServer())
        .patch(`/outlets/${outletA1Id}/delivery-zones/${outletB1ZoneId}`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .send({ name: 'Hijacked' })
        .expect(404);

      const untouched = await prisma.deliveryzone.findUniqueOrThrow({
        where: { id: outletB1ZoneId },
      });
      expect(untouched.name).toBe('Abu Dhabi');
    });

    it("Shop A admin cannot delete Shop B's zone via the same id-guessing path", async () => {
      await request(app.getHttpServer())
        .delete(`/outlets/${outletA1Id}/delivery-zones/${outletB1ZoneId}`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(404);

      await expect(
        prisma.deliveryzone.findUniqueOrThrow({ where: { id: outletB1ZoneId } }),
      ).resolves.toBeTruthy();
    });
  });

  describe('Profile: name + change password', () => {
    it('rejects admin signup with a missing name', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          email: `no-name-${runId}@test.com`,
          password: 'password123',
          shopName: 'No Name Shop',
          subdomain: `no-name-${runId}`,
        })
        .expect(400);
    });

    it('rejects admin signup with an empty name', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          name: '',
          email: `empty-name-${runId}@test.com`,
          password: 'password123',
          shopName: 'Empty Name Shop',
          subdomain: `empty-name-${runId}`,
        })
        .expect(400);
    });

    it('rejects branch user creation with a missing name', async () => {
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .send({
          email: `branch-no-name-${runId}@test.com`,
          password: 'password123',
          outletId: outletA1Id,
        })
        .expect(400);
    });

    it('change-password rejects a wrong current password and leaves the original login working', async () => {
      const email = `pw-wrong-${runId}@test.com`;
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          name: 'PW Test',
          email,
          password: 'original123',
          shopName: 'PW Test Shop',
          subdomain: `pw-wrong-${runId}`,
        })
        .expect(201);
      // change-password requires a verified email — verify via the dev-only
      // link before exercising the actual current-password check.
      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: tokenFromDevLink(body<SignupResponse>(signup).devVerificationLink!) })
        .expect(201);

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'original123' })
        .expect(201);
      const token = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'wrong-password', newPassword: 'newpassword123' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'original123' })
        .expect(201);
    });

    it('change-password updates the hash used by login — old password stops working, new one works', async () => {
      const email = `pw-change-${runId}@test.com`;
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          name: 'PW Change',
          email,
          password: 'original123',
          shopName: 'PW Change Shop',
          subdomain: `pw-change-${runId}`,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: tokenFromDevLink(body<SignupResponse>(signup).devVerificationLink!) })
        .expect(201);

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'original123' })
        .expect(201);
      const token = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'original123', newPassword: 'newpassword123' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'original123' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'newpassword123' })
        .expect(201);
    });
  });
});
