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

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface OrderResponse {
  id: number;
  shopOrderNumber: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Per-shop order numbering (e2e)', () => {
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

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Numbering Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Numbering Collection' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Numbered Rose',
        price: 20,
        thumbnail: 'https://example.com/n.jpg',
        sku: `NUM-${prefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);

    const shopRows = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    return {
      adminToken,
      outletId,
      productId: body<IdRow>(product).id,
      shopId: shopRows[0].id as number,
    };
  }

  function placeOrder(shop: {
    adminToken: string;
    outletId: number;
    productId: number;
  }) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Numbering Customer',
        customerPhone: `numbering-no-digits-${runId}`,
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId: shop.outletId,
        orderType: 'pickup',
        items: [{ productId: shop.productId, quantity: 1 }],
      });
  }

  it('numbers a shop from 1 upward, independent of the global id', async () => {
    const shop = await setupShop('num-basic');
    const first = body<OrderResponse>(await placeOrder(shop).expect(201));
    const second = body<OrderResponse>(await placeOrder(shop).expect(201));

    expect(first.shopOrderNumber).toBe(1);
    expect(second.shopOrderNumber).toBe(2);
    // The whole point: the global id is a large platform-wide number and the
    // per-shop number is not derived from it.
    expect(first.id).toBeGreaterThan(100);
    expect(first.id).not.toBe(first.shopOrderNumber);
  }, 90000);

  // THE test invoicecounter never had. Its own "concurrent" case proves invoice
  // idempotency via @@unique(orderId, type) - two generates for ONE order yield
  // one invoice - and never races two different orders to prove the counter
  // hands out distinct numbers. This does.
  it('never issues the same number twice under concurrent creation', async () => {
    const shop = await setupShop('num-race');
    const CONCURRENCY = 8;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => placeOrder(shop)),
    );
    for (const res of results) expect(res.status).toBe(201);

    const numbers = results
      .map((r) => body<OrderResponse>(r).shopOrderNumber)
      .sort((a, b) => a - b);

    // Exactly 1..N, no duplicates and no gaps. A collision would surface as a
    // failed insert against UNIQUE (shopId, shopOrderNumber) rather than a
    // silent duplicate, so a non-201 above is also a failure of this property.
    expect(numbers).toEqual(
      Array.from({ length: CONCURRENCY }, (_, i) => i + 1),
    );
    expect(new Set(numbers).size).toBe(CONCURRENCY);
  }, 120000);

  it('keeps each shop on its own sequence', async () => {
    const a = await setupShop('num-iso-a');
    const b = await setupShop('num-iso-b');

    await placeOrder(a).expect(201);
    await placeOrder(a).expect(201);
    const aThird = body<OrderResponse>(await placeOrder(a).expect(201));
    const bFirst = body<OrderResponse>(await placeOrder(b).expect(201));

    expect(aThird.shopOrderNumber).toBe(3);
    // Shop B starts at 1 even though shop A (and every other shop on the
    // platform) already has orders - mirroring invoices.e2e-spec.ts:240.
    expect(bFirst.shopOrderNumber).toBe(1);
    expect(bFirst.id).toBeGreaterThan(aThird.id);
  }, 120000);

  it('continues from an existing counter rather than restarting at 1', async () => {
    const shop = await setupShop('num-continue');
    await placeOrder(shop).expect(201);

    // Stand in for a shop whose history was numbered by the backfill.
    await db.execute(
      `UPDATE ordercounter SET lastNumber = 500 WHERE shopId = ?`,
      [shop.shopId],
    );

    const next = body<OrderResponse>(await placeOrder(shop).expect(201));
    expect(next.shopOrderNumber).toBe(501);
  }, 90000);

  // The storefront creation path shares the same counter. Asserted against the
  // data rather than by rebuilding the public checkout payload here: that path
  // is already exercised end to end by storefront-checkout.e2e-spec, and
  // shopOrderNumber is NOT NULL with no default, so a storefront order that
  // failed to get a number could not have been inserted at all - that suite
  // would fail outright rather than silently producing a gap.
  it('assigns numbers on the storefront creation path too', async () => {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total,
              SUM(shopOrderNumber IS NULL) AS missing
         FROM \`order\` WHERE channel = 'storefront'`,
    );
    expect(Number(rows[0].total)).toBeGreaterThan(0);
    expect(Number(rows[0].missing ?? 0)).toBe(0);
  }, 60000);

  // The counter and the orders it numbered never disagree - a drift here would
  // mean the next order silently reuses a number.
  it('keeps ordercounter in step with the numbers actually issued', async () => {
    const shop = await setupShop('num-counter');
    await placeOrder(shop).expect(201);
    await placeOrder(shop).expect(201);

    const rows = await db.query<RowDataPacket[]>(
      `SELECT c.lastNumber, MAX(o.shopOrderNumber) AS issued
         FROM ordercounter c
         JOIN \`order\` o ON o.shopId = c.shopId
        WHERE c.shopId = ?
        GROUP BY c.lastNumber`,
      [shop.shopId],
    );
    expect(Number(rows[0].lastNumber)).toBe(Number(rows[0].issued));
  }, 90000);

  // Guards the constraint the whole change rests on: the DISPLAY number moved,
  // the IDENTITY did not. If a future edit swapped them, lookups, FKs and every
  // gateway round trip would silently break.
  it('still addresses an order by its real id, not the display number', async () => {
    const shop = await setupShop('num-identity');
    await placeOrder(shop).expect(201);
    const second = body<OrderResponse>(await placeOrder(shop).expect(201));
    expect(second.shopOrderNumber).toBe(2);

    // The detail route takes the real id...
    const byId = await request(app.getHttpServer())
      .get(`/orders/${second.id}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    expect(body<OrderResponse>(byId).shopOrderNumber).toBe(2);

    // ...and the display number is not addressable as one.
    await request(app.getHttpServer())
      .get(`/orders/${second.shopOrderNumber}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(404);
  }, 90000);

  describe('the backfill', () => {
    // Directly covers the finding that made the migration order by
    // (createdAt, id): 99 groups in the real data share an identical
    // millisecond, so createdAt alone numbers them non-deterministically.
    it('numbers historical orders per shop as a contiguous 1..n, ties included', async () => {
      const shop = await setupShop('num-backfill');
      const ids: number[] = [];
      for (let i = 0; i < 4; i++) {
        ids.push(body<OrderResponse>(await placeOrder(shop).expect(201)).id);
      }

      // Force an exact createdAt tie across three of them, then re-run the
      // backfill's own expression against this shop.
      const tie = '2026-01-01 10:00:00.000';
      await db.execute(
        `UPDATE \`order\` SET createdAt = ? WHERE id IN (?, ?, ?)`,
        [tie, ids[0], ids[1], ids[2]],
      );
      await db.execute(
        `UPDATE \`order\` SET createdAt = '2026-01-01 11:00:00.000' WHERE id = ?`,
        [ids[3]],
      );

      await db.execute(
        `UPDATE \`order\` o
         JOIN (
           SELECT id, ROW_NUMBER() OVER (
             PARTITION BY shopId ORDER BY createdAt ASC, id ASC
           ) AS n
           FROM \`order\` WHERE shopId = ?
         ) seq ON seq.id = o.id
         SET o.shopOrderNumber = seq.n
         WHERE o.shopId = ?`,
        [shop.shopId, shop.shopId],
      );

      const rows = await db.query<RowDataPacket[]>(
        `SELECT id, shopOrderNumber FROM \`order\`
          WHERE shopId = ? ORDER BY shopOrderNumber`,
        [shop.shopId],
      );
      expect(rows.map((r) => Number(r.shopOrderNumber))).toEqual([1, 2, 3, 4]);
      // The three tied rows are ordered by id, which within one millisecond is
      // the true insert order - so the result is deterministic rather than
      // merely gap-free.
      expect(rows.slice(0, 3).map((r) => Number(r.id))).toEqual(
        [ids[0], ids[1], ids[2]].sort((a, b) => a - b),
      );
    }, 120000);

    it('left no nulls, duplicates or gaps in the existing data', async () => {
      const nulls = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM \`order\` WHERE shopOrderNumber IS NULL`,
      );
      expect(Number(nulls[0].c)).toBe(0);

      const dupes = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM (
           SELECT shopId FROM \`order\`
            GROUP BY shopId, shopOrderNumber HAVING COUNT(*) > 1
         ) t`,
      );
      expect(Number(dupes[0].c)).toBe(0);
    }, 60000);
  });
});
