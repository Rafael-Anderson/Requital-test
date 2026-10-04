import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface IdRow {
  id: number;
}
interface RatingSummary {
  experienceRating: { average: number | null; count: number };
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(60000);

// The dashboard "Experience Rating" is computed from real answered surveys of
// orders placed in the selected period (the order's createdAt, UTC+4 day
// boundaries, the same basis as every other figure on the dashboard) and the
// selected outlet. Reads back only the rows this spec created.
describe('Dashboard experience rating (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  let seq = 0;

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

  interface Shop {
    shopId: number;
    adminToken: string;
    outletId: number;
    productId: number;
  }

  async function setupShop(prefix: string): Promise<Shop> {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Rating Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    await verifySignupEmail(
      app.getHttpServer(),
      (signup.body as { devVerificationLink?: string }).devVerificationLink,
    );
    const adminToken = body<{ accessToken: string }>(signup).accessToken;
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Rated Item ${slug}`,
        price: 25,
        thumbnail: 'https://example.com/x.jpg',
        sku: `RT-${slug}`,
        collectionIds: [body<IdRow>(collection).id],
        trackInventory: false,
      })
      .expect(201);
    const rows = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    return {
      shopId: rows[0].id as number,
      adminToken,
      outletId: body<IdRow[]>(outlets)[0].id,
      productId: body<IdRow>(product).id,
    };
  }

  async function addOrder(
    shop: Shop,
    outletId: number,
    createdAt: string,
  ): Promise<number> {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Rate Er',
        customerPhone: '0500000009',
        customerAddress: '1 Road',
        outletId,
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);
    const orderId = body<IdRow>(res).id;
    await db.execute(`UPDATE \`order\` SET createdAt = ? WHERE id = ?`, [
      new Date(createdAt),
      orderId,
    ]);
    return orderId;
  }

  async function addSurvey(
    surveyShopId: number,
    orderId: number,
    rating: number | null,
    respondedAt: string | null,
  ) {
    await db.execute(
      `INSERT INTO surveyresponse (shopId, orderId, token, rating, respondedAt)
       VALUES (?, ?, ?, ?, ?)`,
      [
        surveyShopId,
        orderId,
        `dash-${runId}-${++seq}`,
        rating,
        respondedAt === null ? null : new Date(respondedAt),
      ],
    );
  }

  const summary = async (
    token: string,
    from: string,
    to: string,
    outletId?: number,
  ) =>
    body<RatingSummary>(
      await request(app.getHttpServer())
        .get(
          `/dashboard/summary?from=${from}&to=${to}${
            outletId ? `&outletId=${outletId}` : ''
          }`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    ).experienceRating;

  // Period 2026-03-10..2026-03-12 inclusive in UTC+4 is
  // [2026-03-09T20:00:00Z, 2026-03-12T20:00:00Z).
  const FROM = '2026-03-10';
  const TO = '2026-03-12';
  const ANSWERED = '2026-03-20T08:00:00Z';

  let a: Shop;
  let b: Shop;
  let c: Shop;
  let outletA2: number;
  let branchToken: string;

  beforeAll(async () => {
    a = await setupShop('rt-a');
    b = await setupShop('rt-b');
    c = await setupShop('rt-c');
    const o2 = await request(app.getHttpServer())
      .post('/outlets')
      .set('Authorization', `Bearer ${a.adminToken}`)
      .send({ name: 'Outlet A2' })
      .expect(201);
    outletA2 = body<IdRow>(o2).id;
    await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${a.adminToken}`)
      .send({
        name: 'Branch A1',
        email: `rt-branch-${runId}@test.com`,
        password: 'password123',
        outletId: a.outletId,
      })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `rt-branch-${runId}@test.com`, password: 'password123' })
      .expect(201);
    branchToken = body<{ accessToken: string }>(login).accessToken;

    // Counted: A1 5 (inside), A1 4 (first instant of the period), A1 4
    // (answered long after the period: the ORDER's date decides), A2 5 (last
    // instant of the period).
    await addSurvey(
      a.shopId,
      await addOrder(a, a.outletId, '2026-03-10T10:00:00Z'),
      5,
      ANSWERED,
    );
    await addSurvey(
      a.shopId,
      await addOrder(a, a.outletId, '2026-03-09T20:00:00.000Z'),
      4,
      ANSWERED,
    );
    await addSurvey(
      a.shopId,
      await addOrder(a, a.outletId, '2026-03-11T10:00:00Z'),
      4,
      '2027-01-01T00:00:00Z',
    );
    await addSurvey(
      a.shopId,
      await addOrder(a, outletA2, '2026-03-12T19:59:59.999Z'),
      5,
      ANSWERED,
    );
    // Never counted: one millisecond before the period, exactly at its
    // exclusive end (answered INSIDE the period: the answer date is not used),
    // unanswered, answered with no rating.
    await addSurvey(
      a.shopId,
      await addOrder(a, a.outletId, '2026-03-09T19:59:59.999Z'),
      1,
      '2026-03-11T00:00:00Z',
    );
    await addSurvey(
      a.shopId,
      await addOrder(a, a.outletId, '2026-03-12T20:00:00.000Z'),
      1,
      '2026-03-11T00:00:00Z',
    );
    await addSurvey(
      a.shopId,
      await addOrder(a, a.outletId, '2026-03-11T11:00:00Z'),
      null,
      null,
    );
    await addSurvey(
      a.shopId,
      await addOrder(a, a.outletId, '2026-03-11T12:00:00Z'),
      null,
      ANSWERED,
    );

    // Another shop, same period: never counted for A.
    const bOrder = await addOrder(b, b.outletId, '2026-03-11T10:00:00Z');
    await addSurvey(b.shopId, bOrder, 1, ANSWERED);
    // Inconsistent rows inserted directly, one each way across the tenant line.
    await addSurvey(
      b.shopId,
      await addOrder(a, a.outletId, '2026-03-11T13:00:00Z'),
      1,
      ANSWERED,
    ); // survey says shop B, order is shop A's
    await addSurvey(
      a.shopId,
      await addOrder(b, b.outletId, '2026-03-11T14:00:00Z'),
      1,
      ANSWERED,
    ); // survey says shop A, order is shop B's
  });

  it('averages answered surveys of orders in the period, shop-wide, with the count', async () => {
    // (5 + 4 + 4 + 5) / 4 = 4.5
    expect(await summary(a.adminToken, FROM, TO)).toEqual({
      average: 4.5,
      count: 4,
    });
  });

  it('filters by outlet through the order, for an admin', async () => {
    // A1: 5, 4, 4 -> 13 / 3 = 4.333 -> 4.3
    expect(await summary(a.adminToken, FROM, TO, a.outletId)).toEqual({
      average: 4.3,
      count: 3,
    });
    expect(await summary(a.adminToken, FROM, TO, outletA2)).toEqual({
      average: 5,
      count: 1,
    });
  });

  it('pins a branch user to its own outlet whatever outletId it asks for', async () => {
    const own = { average: 4.3, count: 3 };
    expect(await summary(branchToken, FROM, TO)).toEqual(own);
    expect(await summary(branchToken, FROM, TO, a.outletId)).toEqual(own);
    expect(await summary(branchToken, FROM, TO, outletA2)).toEqual(own);
  });

  it('is null with a zero count (never 0.0) when nothing was answered in the period', async () => {
    expect(await summary(a.adminToken, '2026-04-01', '2026-04-05')).toEqual({
      average: null,
      count: 0,
    });
    expect(await summary(c.adminToken, FROM, TO)).toEqual({
      average: null,
      count: 0,
    });
  });

  it("never counts another shop's survey, and the other shop sees only its own", async () => {
    expect(await summary(b.adminToken, FROM, TO)).toEqual({
      average: 1,
      count: 1,
    });
  });

  it('keeps the existing summary figures in the response', async () => {
    const res = await request(app.getHttpServer())
      .get(`/dashboard/summary?from=${FROM}&to=${TO}`)
      .set('Authorization', `Bearer ${a.adminToken}`)
      .expect(200);
    expect(Object.keys(body<object>(res))).toEqual(
      expect.arrayContaining([
        'period',
        'revenue',
        'totalOrders',
        'ordersByStage',
        'experienceRating',
      ]),
    );
  });
});
