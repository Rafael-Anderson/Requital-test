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
import { loadOrderEmailData } from '../src/orders/order-email-data';
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
function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(90000);

// The customer's order confirmation email: what it carries, that the Track link
// is an unguessable token on the shop's OWN host, and that the token opens that
// shop's order and nothing else.
describe('Order confirmation email (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let worker: JobsWorkerService;
  let logSpy: jest.SpyInstance;
  const runId = Date.now();
  const savedStorefrontUrl = process.env.STOREFRONT_URL;

  interface Shop {
    slug: string;
    shopId: number;
    adminToken: string;
    outletId: number;
    productId: number;
  }

  beforeAll(async () => {
    // The test env points STOREFRONT_URL at localhost, where the dev branch emits
    // a path-shaped URL. Deleted so the real production shape (a host per shop)
    // is what is asserted.
    delete process.env.STOREFRONT_URL;
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
  });

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  afterAll(async () => {
    if (savedStorefrontUrl !== undefined) {
      process.env.STOREFRONT_URL = savedStorefrontUrl;
    }
    await app.close();
  });

  async function setupShop(prefix: string): Promise<Shop> {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Email Admin',
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
        sku: `EM-${slug}`,
        collectionIds: [body<IdRow>(collection).id],
        trackInventory: false,
      })
      .expect(201);
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

  interface Placed {
    id: number;
    shopOrderNumber: number;
  }
  async function place(shop: Shop, overrides: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Sara Customer',
        customerPhone: '0500000001',
        customerEmail: `sara-${shop.slug}@test.com`,
        customerAddress: 'Villa 3, Palm Street',
        outletId: shop.outletId,
        items: [{ productId: shop.productId, quantity: 2 }],
        ...overrides,
      })
      .expect(201);
    return body<Placed>(res);
  }

  const trackLink = (html: string) =>
    /href="(https:\/\/[^"]+\/orders\/([0-9A-F]{32}))"/.exec(html);

  it('carries the order, the bill, the details and a Track button with the plain URL', async () => {
    const shop = await setupShop('em-content');
    const order = await place(shop);
    const email = await emailFor(`order:${order.id}:confirmed-email`);

    expect(email.subject).toBe(`Order confirmation #${order.shopOrderNumber}`);
    expect(email.html).toContain('Track your order</a>');
    expect(email.html).toContain(`#${order.shopOrderNumber}`);
    expect(email.html).toContain(`Roses ${shop.slug}`);
    expect(email.html).toContain('2 &times; 25.00 AED');
    expect(email.html).toContain('Subtotal');
    expect(email.html).toContain('50.00 AED');
    expect(email.html).toContain('Villa 3, Palm Street');
    expect(email.html).toContain('0500000001');
    expect(email.html).toContain('&copy; 2026 Requital');
    const link = trackLink(email.html);
    expect(link).not.toBeNull();
    // The plain URL is beneath the button, and the text part carries it too.
    expect(email.html).toContain(`>${link![1]}</a></p>`);
    expect(email.bodyText).toContain(`Track your order: ${link![1]}`);
    expect(email.bodyText).toContain('Roses');
  });

  it('the link is the shop own host and an unguessable token, never the order id', async () => {
    const shop = await setupShop('em-host');
    const order = await place(shop);
    const link = trackLink(
      (await emailFor(`order:${order.id}:confirmed-email`)).html,
    )!;
    expect(link[1]).toBe(`https://${shop.slug}.requital.io/orders/${link[2]}`);
    expect(link[2]).toHaveLength(32);
    expect(link[1]).not.toContain(`/orders/${order.id}`);
    const stored = await db.query<RowDataPacket[]>(
      `SELECT trackingToken FROM \`order\` WHERE id = ?`,
      [order.id],
    );
    expect(stored[0].trackingToken).toBe(link[2]);
  });

  it('a verified custom domain is used; an unverified claim is not', async () => {
    const shop = await setupShop('em-domain');
    await db.execute(
      `UPDATE shop SET domainType = 'custom', customDomain = ?, customDomainStatus = 'pending' WHERE id = ?`,
      [`pending-${shop.slug}.example.com`, shop.shopId],
    );
    const a = await place(shop);
    const pending = trackLink(
      (await emailFor(`order:${a.id}:confirmed-email`)).html,
    )!;
    expect(pending[1].startsWith(`https://${shop.slug}.requital.io/`)).toBe(
      true,
    );

    await db.execute(
      `UPDATE shop SET customDomainStatus = 'verified', customDomainVerifiedAt = NOW() WHERE id = ?`,
      [shop.shopId],
    );
    const b = await place(shop);
    const verified = trackLink(
      (await emailFor(`order:${b.id}:confirmed-email`)).html,
    )!;
    expect(
      verified[1].startsWith(`https://pending-${shop.slug}.example.com/`),
    ).toBe(true);
  });

  it('the token opens its own shop order and cannot open another shop order', async () => {
    const shopA = await setupShop('em-tok-a');
    const shopB = await setupShop('em-tok-b');
    const orderA = await place(shopA);
    const link = trackLink(
      (await emailFor(`order:${orderA.id}:confirmed-email`)).html,
    )!;
    const token = link[2];

    const own = await request(app.getHttpServer())
      .get(`/public/orders/lookup?token=${token}&shop=${shopA.slug}`)
      .expect(200);
    expect(body<{ shopOrderNumber: number }>(own).shopOrderNumber).toBe(
      orderA.shopOrderNumber,
    );

    // The same token asked through the OTHER shop is indistinguishable from an
    // unknown token.
    const cross = await request(app.getHttpServer())
      .get(`/public/orders/lookup?token=${token}&shop=${shopB.slug}`)
      .expect(404);
    const unknown = await request(app.getHttpServer())
      .get(
        `/public/orders/lookup?token=${'0'.repeat(32)}&shop=${shopB.slug}`,
      )
      .expect(404);
    expect(JSON.stringify(cross.body)).toBe(JSON.stringify(unknown.body));

    // A sequential id or the per-shop number opens nothing, anywhere.
    for (const guess of [String(orderA.id), String(orderA.shopOrderNumber)]) {
      await request(app.getHttpServer())
        .get(`/public/orders/lookup?token=${guess}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/public/orders/lookup?token=${guess}&shop=${shopA.slug}`)
        .expect(404);
    }
  });

  it("another shop cannot load this shop's order for an email (the loader is shop pinned)", async () => {
    const shopA = await setupShop('em-pin-a');
    const shopB = await setupShop('em-pin-b');
    const orderA = await place(shopA);
    expect(await loadOrderEmailData(db, shopB.shopId, orderA.id)).toBeNull();
    expect(await loadOrderEmailData(db, shopA.shopId, orderA.id)).not.toBeNull();
  });

  it('shows the figures the order froze, not today prices', async () => {
    const shop = await setupShop('em-frozen');
    const order = await place(shop);
    const email = await emailFor(`order:${order.id}:confirmed-email`);
    expect(email.html).toContain('2 &times; 25.00 AED');

    await request(app.getHttpServer())
      .patch(`/products/${shop.productId}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ price: 99 })
      .expect(200);

    const again = await loadOrderEmailData(db, shop.shopId, order.id);
    expect(again!.lines[0].unitPrice).toMatch(/^25(\.0+)?$/);
    expect(again!.total).toMatch(/^50(\.0+)?$/);
  });

  it('hostile customer text is escaped in the real email', async () => {
    const shop = await setupShop('em-esc');
    const order = await place(shop, {
      customerName: '<script>alert(1)</script> Eve',
      customerAddress: '"><img src=x onerror=alert(1)>',
      deliveryNotes: '<b>bold</b>',
    });
    const email = await emailFor(`order:${order.id}:confirmed-email`);
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Eve');
  });

  it('the out-for-delivery email carries the same Track button', async () => {
    const shop = await setupShop('em-ofd');
    const order = await place(shop, { orderType: 'delivery' });
    for (const status of ['confirmed', 'preparing', 'out_for_delivery']) {
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ status })
        .expect(200);
    }
    const email = await emailFor(`order:${order.id}:out-for-delivery-email`);
    expect(email.html).toContain('on its way to you now');
    expect(email.html).toContain('Track your order</a>');
    const link = trackLink(email.html)!;
    expect(link[1]).toBe(`https://${shop.slug}.requital.io/orders/${link[2]}`);
    expect(email.bodyText).toContain(`Track your order: ${link[1]}`);
  });

  it('an order with no customer email sends no email at all', async () => {
    const shop = await setupShop('em-none');
    const order = await place(shop, { customerEmail: undefined });
    await new Promise((r) => setTimeout(r, 300));
    expect(await findJob(`order:${order.id}:confirmed-email`)).toBeNull();
  });
});
