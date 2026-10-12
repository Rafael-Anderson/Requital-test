import 'dotenv/config';
import * as nodeCrypto from 'crypto';
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
function body<T>(res: Response): T {
  return res.body as T;
}

// crypto's exports are non-configurable, so spyOn cannot patch randomBytes;
// swap the module for a pass-through jest.fn the collision test can steer.
jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return { ...actual, randomBytes: jest.fn(actual.randomBytes) };
});

jest.setTimeout(60000);

const NEW_SHAPE = /^[0-9A-F]{32}$/;

// order.trackingToken is a bearer capability for the public tracking page. New
// orders get 128 bits (32 hex) on EVERY creation path; the 10-hex tokens
// already printed on confirmation pages and in emails keep resolving, and
// anything else is the same 404 as an unknown token.
describe('Order tracking token width (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();

  interface Shop {
    slug: string;
    shopId: number;
    adminToken: string;
    outletId: number;
    productId: number;
  }

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

  async function setupShop(prefix: string): Promise<Shop> {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Track Admin',
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
    const adminToken = (signup.body as { accessToken: string }).accessToken;
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, pickupEnabled: true })
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
        name: `Track Item ${slug}`,
        price: 25,
        thumbnail: 'https://example.com/x.jpg',
        sku: `TRK-${slug}`,
        collectionIds: [body<IdRow>(collection).id],
        trackInventory: false,
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);
    const rows = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    return {
      slug,
      shopId: rows[0].id as number,
      adminToken,
      outletId,
      productId: body<IdRow>(product).id,
    };
  }

  const lookup = (token: string) =>
    request(app.getHttpServer()).get(
      `/public/orders/lookup?token=${encodeURIComponent(token)}`,
    );

  async function tokenOf(orderId: number): Promise<string> {
    const rows = await db.query<RowDataPacket[]>(
      'SELECT trackingToken FROM `order` WHERE id = ?',
      [orderId],
    );
    return rows[0].trackingToken as string;
  }

  async function storefrontOrder(shop: Shop) {
    const res = await request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'Track Customer',
        customerPhone: '0501234567',
        customerAddress: '1 Main St',
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);
    return body<{ order: { id: number; trackingToken: string } }>(res).order;
  }

  async function adminOrder(shop: Shop): Promise<number> {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Phone Customer',
        customerPhone: '0500000004',
        customerAddress: '77 Private Street',
        outletId: shop.outletId,
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);
    return body<IdRow>(res).id;
  }

  async function draftOrder(shop: Shop): Promise<number> {
    const draft = await request(app.getHttpServer())
      .post('/shop/draft-orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        outletId: shop.outletId,
        customerName: 'Draft Customer',
        customerPhone: '0500000005',
        customerAddress: '5 Draft Rd',
        orderType: 'pickup',
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);
    const done = await request(app.getHttpServer())
      .post(`/shop/draft-orders/${body<IdRow>(draft).id}/complete`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(201);
    const rows = await db.query<RowDataPacket[]>(
      'SELECT convertedOrderId FROM draftorder WHERE id = ?',
      [body<IdRow>(draft).id],
    );
    void done;
    return rows[0].convertedOrderId as number;
  }

  it('every creation path issues a 128-bit token that resolves its own order', async () => {
    const shop = await setupShop('trk-new');
    const sf = await storefrontOrder(shop);
    const adminId = await adminOrder(shop);
    const draftId = await draftOrder(shop);

    const tokens = [
      sf.trackingToken,
      await tokenOf(adminId),
      await tokenOf(draftId),
    ];
    for (const t of tokens) expect(t).toMatch(NEW_SHAPE);
    expect(new Set(tokens).size).toBe(3);
    // The checkout response carries the same value that was stored.
    expect(sf.trackingToken).toBe(await tokenOf(sf.id));

    const ids = [sf.id, adminId, draftId];
    for (let i = 0; i < 3; i++) {
      const res = await lookup(tokens[i]).expect(200);
      expect(body<IdRow>(res).id).toBe(ids[i]);
    }
    // Hex case does not matter (case-insensitive column), it is still one token.
    await lookup(tokens[0].toLowerCase()).expect(200);
  });

  it('a legacy 10-hex token keeps resolving, in either case', async () => {
    const shop = await setupShop('trk-old');
    const o = await storefrontOrder(shop);
    const legacy = nodeCrypto.randomBytes(5).toString('hex').toUpperCase();
    await db.execute('UPDATE `order` SET trackingToken = ? WHERE id = ?', [
      legacy,
      o.id,
    ]);
    expect(body<IdRow>(await lookup(legacy).expect(200)).id).toBe(o.id);
    expect(body<IdRow>(await lookup(legacy.toLowerCase()).expect(200)).id).toBe(
      o.id,
    );
  });

  it('wrong, truncated, over-long and non-hex tokens are all the same 404', async () => {
    const shop = await setupShop('trk-bad');
    const o = await storefrontOrder(shop);
    const good = o.trackingToken;
    const bad = [
      'A'.repeat(32), // right shape, unknown
      'A'.repeat(10),
      good.slice(0, 31),
      good.slice(0, 9),
      good.slice(0, 11),
      good.slice(0, 20),
      good + 'A',
      good + good,
      good.slice(0, 31) + 'Z', // one non-hex character
      'G'.repeat(32),
      `${good} `, // trailing space: PAD SPACE collations would equate it
      `${good.slice(0, 31)}Ａ`, // full-width A: unicode_ci equates it with A
      'null',
      '0',
      '%',
    ];
    const bodies = new Set<string>();
    for (const t of bad) {
      const res = await lookup(t).expect(404);
      bodies.add(JSON.stringify(res.body));
    }
    // Uniform: not distinguishable by status or message.
    expect(bodies.size).toBe(1);
    // An empty token stays the existing 400.
    await request(app.getHttpServer()).get('/public/orders/lookup').expect(400);
    await lookup('   ').expect(400);
    await lookup(good).expect(200);
  });

  it('tokens do not cross tenants', async () => {
    const a = await setupShop('trk-xa');
    const b = await setupShop('trk-xb');
    const oa = await storefrontOrder(a);
    const ob = await storefrontOrder(b);
    expect(oa.trackingToken).not.toBe(ob.trackingToken);
    const ra = body<IdRow>(await lookup(oa.trackingToken).expect(200));
    const rb = body<IdRow>(await lookup(ob.trackingToken).expect(200));
    expect(ra.id).toBe(oa.id);
    expect(rb.id).toBe(ob.id);
    const owner = await db.query<RowDataPacket[]>(
      'SELECT shopId FROM `order` WHERE id = ?',
      [ra.id],
    );
    expect(owner[0].shopId).toBe(a.shopId);
  });

  it('a token collision on insert is retried with a fresh token, not a failed order', async () => {
    const shop = await setupShop('trk-col');
    const first = await storefrontOrder(shop);
    const taken = Buffer.from(first.trackingToken, 'hex');
    const mocked = nodeCrypto.randomBytes as unknown as jest.Mock;
    const real = jest.requireActual<typeof import('crypto')>('crypto')
      .randomBytes;
    // Hand out the already-used token as the next 16-byte value, once.
    let served = false;
    mocked.mockImplementation((size: number) => {
      if (size === 16 && !served) {
        served = true;
        return taken;
      }
      return real(size);
    });
    let second: { id: number; trackingToken: string };
    try {
      second = await storefrontOrder(shop);
    } finally {
      mocked.mockImplementation(real);
    }
    expect(served).toBe(true);
    expect(second.trackingToken).toMatch(NEW_SHAPE);
    expect(second.trackingToken).not.toBe(first.trackingToken);
    expect(body<IdRow>(await lookup(first.trackingToken).expect(200)).id).toBe(
      first.id,
    );
  });
});
