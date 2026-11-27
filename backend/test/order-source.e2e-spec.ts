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
interface ListedOrder {
  id: number;
  source: string;
  createdAt: string;
}
interface ListBody {
  data: ListedOrder[];
  total: number;
}
function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(120000);

// Order source (orders/order-sources.ts): written for new orders, DERIVED at read
// time for older rows (source NULL, never rewritten), filterable and sortable on
// the orders list, and never reaching across shops.
describe('Order source (e2e)', () => {
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
  let shopA: Shop;
  let shopB: Shop;
  // Shop A's orders, by what they should read as.
  const ids: Record<string, number> = {};

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
    shopA = await setupShop('src-a');
    shopB = await setupShop('src-b');

    ids.website = await placePublic(shopA);
    ids.custom = await placeAdmin(shopA);
    // Older rows: written before the column existed, so source is NULL and the
    // effective source comes from the columns that were there.
    ids.legacyNull = await legacy(await placePublic(shopA), { channel: null });
    ids.legacyStorefront = await legacy(await placePublic(shopA), { channel: 'storefront' });
    ids.legacyWalkIn = await legacy(await placeAdmin(shopA), { channel: 'Walk-in' });
    ids.legacyDraft = await legacy(await placeAdmin(shopA), { channel: 'draft_order' });
    ids.legacyAdminSource = await legacy(await placeAdmin(shopA), {
      channel: null,
      adminSource: 'cod',
    });
    // A hand-typed marketplace name with no channelorder link is staff-made.
    ids.legacyUnlinkedTalabat = await legacy(await placeAdmin(shopA), { channel: 'talabat' });
    ids.legacyTalabat = await legacy(await placeAdmin(shopA), { channel: 'talabat' });
    ids.legacyDeliveroo = await legacy(await placeAdmin(shopA), { channel: 'deliveroo' });
    await linkToMarketplace(shopA, ids.legacyTalabat, 'talabat');
    await linkToMarketplace(shopA, ids.legacyDeliveroo, 'deliveroo');

    // Shop B has one order of every kind too, so a leak would show.
    await placePublic(shopB);
    await placeAdmin(shopB);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(prefix: string): Promise<Shop> {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Source Admin',
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
        name: `Tulips ${slug}`,
        price: 20,
        thumbnail: 'https://example.com/x.jpg',
        sku: `SRC-${slug}`,
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

  async function placePublic(shop: Shop): Promise<number> {
    const res = await request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName: 'Web Customer',
        customerPhone: '0500000011',
        customerAddress: 'Pickup at outlet',
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);
    return body<{ order: IdRow }>(res).order.id;
  }

  async function placeAdmin(shop: Shop): Promise<number> {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Phone Customer',
        customerPhone: '0500000022',
        customerAddress: '1 Test St',
        orderType: 'pickup',
        outletId: shop.outletId,
        deliveryFee: 0,
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);
    return body<IdRow>(res).id;
  }

  // Turns a fresh order into what an older row looks like: source NULL.
  async function legacy(
    id: number,
    cols: { channel: string | null; adminSource?: string },
  ): Promise<number> {
    await db.execute(
      `UPDATE \`order\` SET source = NULL, channel = ?, adminSource = ? WHERE id = ?`,
      [cols.channel, cols.adminSource ?? null, id],
    );
    return id;
  }

  async function linkToMarketplace(shop: Shop, orderId: number, provider: string) {
    const conn = await db.execute(
      `INSERT INTO channelconnection (shopId, outletId, provider) VALUES (?, ?, ?)`,
      [shop.shopId, shop.outletId, provider],
    );
    await db.execute(
      `INSERT INTO channelorder (shopId, connectionId, outletId, provider, externalOrderId, orderId,
         state, externalStatus, currency, payloadHash)
       VALUES (?, ?, ?, ?, ?, ?, 'accepted', 'accepted', 'AED', ?)`,
      [
        shop.shopId,
        conn.insertId,
        shop.outletId,
        provider,
        `ext-${runId}-${orderId}`,
        orderId,
        'a'.repeat(64),
      ],
    );
  }

  async function list(shop: Shop, query: string) {
    const res = await request(app.getHttpServer())
      .get(`/orders?pageSize=100${query}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    return body<ListBody>(res);
  }

  it('writes the source on new orders: storefront = website, staff = custom', async () => {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT id, source FROM \`order\` WHERE id IN (?, ?)`,
      [ids.website, ids.custom],
    );
    const byId = new Map(rows.map((r) => [r.id as number, r.source as string]));
    expect(byId.get(ids.website)).toBe('website');
    expect(byId.get(ids.custom)).toBe('custom');
  });

  it('derives the source of older rows at read time and never rewrites them', async () => {
    const { data } = await list(shopA, '');
    const src = new Map(data.map((o) => [o.id, o.source]));
    expect(src.get(ids.website)).toBe('website');
    expect(src.get(ids.custom)).toBe('custom');
    expect(src.get(ids.legacyNull)).toBe('website');
    expect(src.get(ids.legacyStorefront)).toBe('website');
    expect(src.get(ids.legacyWalkIn)).toBe('custom');
    expect(src.get(ids.legacyDraft)).toBe('custom');
    expect(src.get(ids.legacyAdminSource)).toBe('custom');
    expect(src.get(ids.legacyUnlinkedTalabat)).toBe('custom');
    expect(src.get(ids.legacyTalabat)).toBe('talabat');
    expect(src.get(ids.legacyDeliveroo)).toBe('deliveroo');
    // Reading never wrote: the legacy rows are still NULL.
    const stored = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM \`order\` WHERE shopId = ? AND source IS NULL`,
      [shopA.shopId],
    );
    expect(Number(stored[0].c)).toBe(8);
    // The detail carries the same answer.
    const detail = await request(app.getHttpServer())
      .get(`/orders/${ids.legacyTalabat}`)
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    expect(body<{ source: string }>(detail).source).toBe('talabat');
  });

  it('filters by one source and by several, on the effective source', async () => {
    const one = await list(shopA, '&sources=talabat');
    expect(one.data.map((o) => o.id)).toEqual([ids.legacyTalabat]);
    expect(one.total).toBe(1);

    const several = await list(shopA, '&sources=talabat,deliveroo,website');
    expect(new Set(several.data.map((o) => o.id))).toEqual(
      new Set([
        ids.legacyTalabat,
        ids.legacyDeliveroo,
        ids.website,
        ids.legacyNull,
        ids.legacyStorefront,
      ]),
    );
    expect(several.total).toBe(5);

    const custom = await list(shopA, '&sources=custom');
    expect(custom.data.every((o) => o.source === 'custom')).toBe(true);
    expect(custom.total).toBe(5);
  });

  it('combines the source filter with pagination', async () => {
    const res = await request(app.getHttpServer())
      .get('/orders?sources=custom&pageSize=4&page=2')
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    const b = body<ListBody>(res);
    expect(b.total).toBe(5);
    expect(b.data).toHaveLength(1);
  });

  it('rejects a source that is not in the registry, and an unknown sort', async () => {
    await request(app.getHttpServer())
      .get('/orders?sources=careem')
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/orders?sort=total')
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(400);
  });

  it('sorts by source in registry order, newest first within a source, stably', async () => {
    const first = await list(shopA, '&sort=source');
    const order = ['website', 'custom', 'talabat', 'deliveroo'];
    const ranks = first.data.map((o) => order.indexOf(o.source));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // Within one source: the default (newest first), ties broken by id.
    for (const key of order) {
      const group = first.data.filter((o) => o.source === key);
      for (let i = 1; i < group.length; i++) {
        const prev = group[i - 1];
        const cur = group[i];
        const t0 = new Date(prev.createdAt).getTime();
        const t1 = new Date(cur.createdAt).getTime();
        expect(t0 > t1 || (t0 === t1 && prev.id > cur.id)).toBe(true);
      }
    }
    // Asking again gives the same order, and paging walks it without a gap or repeat.
    const again = await list(shopA, '&sort=source');
    expect(again.data.map((o) => o.id)).toEqual(first.data.map((o) => o.id));
    const paged: number[] = [];
    for (let page = 1; page <= 4; page++) {
      const res = await request(app.getHttpServer())
        .get(`/orders?sort=source&pageSize=3&page=${page}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      paged.push(...body<ListBody>(res).data.map((o) => o.id));
    }
    expect(paged).toEqual(first.data.map((o) => o.id));
  });

  it("never returns another shop's orders through the source filter or sort", async () => {
    const a = await list(shopA, '&sources=website,custom,talabat,deliveroo&sort=source');
    expect(a.total).toBe(10);
    const b = await list(shopB, '&sources=website,custom,talabat,deliveroo&sort=source');
    expect(b.total).toBe(2);
    const aIds = new Set(a.data.map((o) => o.id));
    expect(b.data.some((o) => aIds.has(o.id))).toBe(false);
  });
});
