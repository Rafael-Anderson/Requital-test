import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JobsWorkerService } from '../src/jobs/jobs.worker.service';
import type { JobRow } from '../src/db/types';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface IdRow {
  id: number;
}
interface EmailPayload {
  to: string;
  subject: string;
  bodyText: string;
  html: string;
}
interface PlacedBody {
  order: { id: number; trackingToken: string | null };
}
function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(120000);

// A separate RECEIVER (the person who gets the order): stored on the order next to the
// customer, NULL/NULL when the customer is the receiver, returned wherever the order
// is shown, and never reachable from another shop.
describe('Order receiver (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let worker: JobsWorkerService;
  let logSpy: jest.SpyInstance;
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

  const RECEIVER = { receiverName: 'Omar Receiver', receiverPhone: '+971 50 111 2222' };

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
    worker = app.get(JobsWorkerService);
    shopA = await setupShop('rcv-a');
    shopB = await setupShop('rcv-b');
  });

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());
  afterAll(async () => {
    await app.close();
  });

  async function setupShop(prefix: string): Promise<Shop> {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Receiver Admin',
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
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notifyEmail: true })
      .expect(200);
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        active: true,
        deliveryEnabled: true,
        pickupEnabled: true,
        latitude: 25.2048,
        longitude: 55.2708,
        deliveryRadiusKm: 5,
      })
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
        name: `Roses ${slug}`,
        price: 25,
        thumbnail: 'https://example.com/x.jpg',
        sku: `RC-${slug}`,
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

  // Storefront checkout (pickup + cash, so no radius or gateway is involved).
  function publicPayload(shop: Shop, over: Record<string, unknown> = {}) {
    return {
      outletId: shop.outletId,
      orderType: 'pickup',
      paymentMethod: 'cash_on_pickup',
      customerName: 'Sara Customer',
      customerPhone: '0500000001',
      customerAddress: 'Pickup at outlet',
      items: [{ productId: shop.productId, quantity: 1 }],
      ...over,
    };
  }
  async function placePublic(shop: Shop, over: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send(publicPayload(shop, over))
      .expect(201);
    return body<PlacedBody>(res).order;
  }
  async function dbOrder(id: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT receiverName, receiverPhone, customerName, customerPhone, trackingToken FROM \`order\` WHERE id = ?`,
      [id],
    );
    return rows[0];
  }
  const lookup = (token: string, slug: string) =>
    request(app.getHttpServer()).get(
      `/public/orders/lookup?token=${token}&shop=${slug}`,
    );

  it('saves the receiver on the order, beside the customer, trimmed', async () => {
    const order = await placePublic(shopA, {
      receiverName: '  Omar Receiver  ',
      receiverPhone: RECEIVER.receiverPhone,
    });
    const row = await dbOrder(order.id);
    expect(row.receiverName).toBe('Omar Receiver');
    expect(row.receiverPhone).toBe(RECEIVER.receiverPhone);
    // The customer columns are untouched.
    expect(row.customerName).toBe('Sara Customer');
    expect(row.customerPhone).toBe('0500000001');
  });

  it('stores NULL (never a copy of the customer) when no receiver is sent', async () => {
    const order = await placePublic(shopA);
    const row = await dbOrder(order.id);
    expect(row.receiverName).toBeNull();
    expect(row.receiverPhone).toBeNull();
  });

  it('returns the receiver on the public tracking lookup, and null when not set', async () => {
    const withR = await placePublic(shopA, RECEIVER);
    const a = await lookup(withR.trackingToken as string, shopA.slug).expect(200);
    expect(body<{ receiverName: string; receiverPhone: string }>(a)).toMatchObject(RECEIVER);

    const without = await placePublic(shopA);
    const b = await lookup(without.trackingToken as string, shopA.slug).expect(200);
    expect(body<{ receiverName: unknown }>(b).receiverName).toBeNull();
    expect(body<{ receiverPhone: unknown }>(b).receiverPhone).toBeNull();
  });

  it('returns the receiver in admin order detail and the orders list', async () => {
    const order = await placePublic(shopA, RECEIVER);
    const detail = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    expect(body<{ receiverName: string; receiverPhone: string }>(detail)).toMatchObject(RECEIVER);

    const list = await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    const found = body<{ data: { id: number; receiverName: string | null }[] }>(list).data.find(
      (o) => o.id === order.id,
    );
    expect(found?.receiverName).toBe(RECEIVER.receiverName);
  });

  it('orders search matches the receiver name and the receiver phone', async () => {
    const order = await placePublic(shopA, {
      receiverName: `Zainab Unique${runId}`,
      receiverPhone: '+971 55 987 6543',
    });
    for (const term of [`Unique${runId}`, '987 6543']) {
      const res = await request(app.getHttpServer())
        .get(`/orders?search=${encodeURIComponent(term)}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      expect(body<{ data: { id: number }[] }>(res).data.map((o) => o.id)).toContain(order.id);
    }
    // The global search palette finds it too.
    const global = await request(app.getHttpServer())
      .get(`/search?q=${encodeURIComponent(`Unique${runId}`)}`)
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    expect(JSON.stringify(global.body)).toContain(`"id":${order.id}`);
  });

  it('is scoped to the shop: another shop cannot read it, search it or open its token', async () => {
    const order = await placePublic(shopA, {
      receiverName: `Hidden Receiver${runId}`,
      receiverPhone: '+971 50 333 4444',
    });
    await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(404);
    const res = await request(app.getHttpServer())
      .get(`/orders?search=${encodeURIComponent(`Hidden Receiver${runId}`)}`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(200);
    expect(body<{ data: unknown[] }>(res).data).toHaveLength(0);
    await lookup(order.trackingToken as string, shopB.slug).expect(404);
  });

  describe('validation (same rules as the customer name and phone)', () => {
    const bad = async (over: Record<string, unknown>) => {
      const before = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM \`order\` WHERE shopId = ?`,
        [shopA.shopId],
      );
      await request(app.getHttpServer())
        .post(`/public/${shopA.slug}/orders`)
        .send(publicPayload(shopA, over))
        .expect(400);
      const after = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM \`order\` WHERE shopId = ?`,
        [shopA.shopId],
      );
      // Nothing was created.
      expect(after[0].c).toBe(before[0].c);
    };
    it('rejects a bad receiverPhone', async () => {
      await bad({ receiverName: 'Omar', receiverPhone: 'abc<script>' });
      await bad({ receiverName: 'Omar', receiverPhone: '123' });
    });
    it('rejects a name without a phone, and a phone without a name', async () => {
      await bad({ receiverName: 'Omar' });
      await bad({ receiverPhone: '0501112222' });
    });
    it('rejects an empty or over-long receiverName', async () => {
      await bad({ receiverName: '', receiverPhone: '0501112222' });
      await bad({ receiverName: 'x'.repeat(192), receiverPhone: '0501112222' });
    });
    it('rejects a whitespace-only name paired with a phone (no half receiver)', async () => {
      await bad({ receiverName: '   ', receiverPhone: '0501112222' });
    });
  });

  describe('admin-created orders carry it too', () => {
    async function adminOrder(over: Record<string, unknown> = {}) {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          customerName: 'Sara Customer',
          customerPhone: '0500000001',
          customerEmail: `sara-${shopA.slug}@test.com`,
          customerAddress: 'Villa 3, Palm Street',
          outletId: shopA.outletId,
          items: [{ productId: shopA.productId, quantity: 1 }],
          ...over,
        });
      return res;
    }
    it('saves it, and rejects half a receiver', async () => {
      const ok = await adminOrder(RECEIVER).then((r) => {
        expect(r.status).toBe(201);
        return body<IdRow>(r);
      });
      expect((await dbOrder(ok.id)).receiverName).toBe(RECEIVER.receiverName);
      expect((await adminOrder({ receiverName: 'Omar' })).status).toBe(400);
    });
  });

  describe('documents and emails', () => {
    async function findJob(key: string): Promise<JobRow | null> {
      const rows = await db.query<(JobRow & RowDataPacket)[]>(
        'SELECT * FROM job WHERE idempotencyKey = ?',
        [key],
      );
      return rows[0] ?? null;
    }
    async function emailFor(key: string): Promise<EmailPayload> {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const job = await findJob(key);
        if (job) {
          if (job.status === 'pending') await worker.processJobById(job.id);
          return (await findJob(key))!.payload as EmailPayload;
        }
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error(`no email job for ${key}`);
    }
    async function adminOrder(over: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          customerName: 'Sara Customer',
          customerPhone: '0500000001',
          customerEmail: `sara-${shopA.slug}@test.com`,
          customerAddress: 'Villa 3, Palm Street',
          outletId: shopA.outletId,
          items: [{ productId: shopA.productId, quantity: 1 }],
          ...over,
        })
        .expect(201);
      return body<IdRow>(res).id;
    }

    it('the confirmation email shows Customer and Receiver when set, and only the customer when not', async () => {
      const withId = await adminOrder(RECEIVER);
      const email = await emailFor(`order:${withId}:confirmed-email`);
      expect(email.html).toContain('Receiver');
      expect(email.html).toContain('Omar Receiver');
      expect(email.html).toContain('+971 50 111 2222');
      expect(email.html).toContain('Sara Customer');
      expect(email.bodyText).toContain('RECEIVER');

      const noId = await adminOrder({});
      const plain = await emailFor(`order:${noId}:confirmed-email`);
      expect(plain.html).not.toContain('Receiver');
      expect(plain.bodyText).not.toContain('RECEIVER');
    });

    it('a hostile receiver name is escaped in the email', async () => {
      const id = await adminOrder({
        receiverName: '<img src=x onerror=alert(1)>',
        receiverPhone: '+971 50 111 2222',
      });
      const email = await emailFor(`order:${id}:confirmed-email`);
      expect(email.html).not.toContain('<img src=x');
      expect(email.html).toContain('&lt;img src=x');
    });

    it('the out-for-delivery email carries the Receiver when set', async () => {
      const id = await adminOrder({ ...RECEIVER, orderType: 'delivery' });
      for (const status of ['confirmed', 'preparing', 'out_for_delivery']) {
        const res = await request(app.getHttpServer())
          .patch(`/orders/${id}/status`)
          .set('Authorization', `Bearer ${shopA.adminToken}`)
          .send({ status });
        if (res.status !== 200) {
          throw new Error(
            `status ${status} -> ${res.status} ${JSON.stringify(res.body)}`,
          );
        }
      }
      const email = await emailFor(`order:${id}:out-for-delivery-email`);
      expect(email.html).toContain('Receiver');
      expect(email.html).toContain('Omar Receiver');
      expect(email.bodyText).toContain('RECEIVER');
    });

    it('the packing slip and the invoice print the receiver when set, and not otherwise', async () => {
      const withId = await adminOrder(RECEIVER);
      const noId = await adminOrder({});
      for (const type of ['PACKING_SLIP', 'INVOICE']) {
        const doc = async (orderId: number) => {
          const created = await request(app.getHttpServer())
            .post('/invoices')
            .set('Authorization', `Bearer ${shopA.adminToken}`)
            .send({ orderId, type })
            .expect(201);
          return request(app.getHttpServer())
            .get(`/invoices/${body<IdRow>(created).id}/pdf`)
            .set('Authorization', `Bearer ${shopA.adminToken}`)
            .expect(200);
        };
        const a = await doc(withId);
        expect(a.text).toContain('Receiver');
        expect(a.text).toContain('Omar Receiver');
        expect(a.text).toContain('+971 50 111 2222');
        const b = await doc(noId);
        expect(b.text).not.toContain('Receiver');
      }
    });

    it('an invoice keeps the receiver it was issued with', async () => {
      const id = await adminOrder(RECEIVER);
      const created = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ orderId: id, type: 'INVOICE' })
        .expect(201);
      // Even if the live row were changed later, the frozen document is unchanged.
      await db.execute(
        `UPDATE \`order\` SET receiverName = 'Changed Later' WHERE id = ?`,
        [id],
      );
      const pdf = await request(app.getHttpServer())
        .get(`/invoices/${body<IdRow>(created).id}/pdf`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      expect(pdf.text).toContain('Omar Receiver');
      expect(pdf.text).not.toContain('Changed Later');
    });
  });
});
