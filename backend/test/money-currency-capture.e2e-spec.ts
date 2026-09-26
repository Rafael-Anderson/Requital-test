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
  currency: string;
  total: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(60000);

// Phase 2a / A1. Every money-bearing row now records the currency its amounts
// are denominated in, instead of that being re-derived from the mutable
// `shop.currency` at read time.
//
// The property under test is FREEZE, not merely presence: a row written while
// the shop was on one currency must keep that currency forever. A test that
// only asserted `currency === 'AED'` would pass just as happily against the old
// behaviour of reading shop.currency live, since every shop is AED today — so
// each case here changes the shop's currency AFTER the write and re-reads.
//
// shop.currency is locked to AED at the DTO level (the temporary Fix 1
// allowlist, removed in A6), so these tests move it with a direct UPDATE. That
// is deliberate: it simulates exactly what A6 will make reachable through the
// API, and it keeps this suite meaningful before A6 lands.
describe('Money currency capture and freeze (e2e)', () => {
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
        name: 'Currency Admin',
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

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Currency Collection' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Currency Rose',
        price: 50,
        thumbnail: 'https://example.com/c.jpg',
        sku: `CUR-${prefix}-${runId}`,
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
      slug,
    };
  }

  function createOrder(shop: {
    adminToken: string;
    outletId: number;
    productId: number;
  }) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Currency Customer',
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Currency St',
        emirate: 'Dubai',
        orderType: 'pickup',
        outletId: shop.outletId,
        deliveryFee: 0,
        items: [{ productId: shop.productId, quantity: 1 }],
      });
  }

  // Stands in for what A6 will make reachable through PATCH /shop.
  async function forceShopCurrency(shopId: number, currency: string) {
    await db.execute(`UPDATE shop SET currency = ? WHERE id = ?`, [
      currency,
      shopId,
    ]);
  }

  async function columnOf(
    table: string,
    where: string,
    params: unknown[],
  ): Promise<string> {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT currency FROM \`${table}\` WHERE ${where}`,
      params as never[],
    );
    return rows[0].currency as string;
  }

  it('captures the currency on an admin-created order and never re-derives it', async () => {
    const shop = await setupShop('cur-admin');
    const order = body<OrderResponse>(await createOrder(shop).expect(201));
    expect(order.currency).toBe('AED');

    await forceShopCurrency(shop.shopId, 'KWD');

    // The shop is now KWD; this order was priced, quoted and charged in AED and
    // must stay AED. Under the old behaviour there was no column to read at all
    // and every display resolved the shop's CURRENT value, so this order would
    // have silently started reading as 50 KWD.
    expect(await columnOf('order', 'id = ?', [order.id])).toBe('AED');

    const refetched = body<OrderResponse>(
      await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200),
    );
    expect(refetched.currency).toBe('AED');
  });

  it('captures it on a storefront order too', async () => {
    const shop = await setupShop('cur-storefront');
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total, SUM(currency IS NULL OR currency = '') AS bad
         FROM \`order\` WHERE channel = 'storefront'`,
    );
    // NOT NULL with no default means a storefront order that failed to supply a
    // currency could not have been inserted at all — storefront-checkout's own
    // suite would fail outright rather than silently producing a blank. This
    // asserts the data-level consequence of that.
    expect(Number(rows[0].total)).toBeGreaterThan(0);
    expect(Number(rows[0].bad ?? 0)).toBe(0);
    expect(shop.shopId).toBeGreaterThan(0);
  });

  it('freezes it on a draft order, independent of the shop changing later', async () => {
    const shop = await setupShop('cur-draft');
    const draft = body<IdRow>(
      await request(app.getHttpServer())
        .post('/shop/draft-orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          customerName: 'Draft Currency',
          customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
          customerAddress: '2 Draft St',
          emirate: 'Dubai',
          outletId: shop.outletId,
          orderType: 'delivery',
          items: [{ productId: shop.productId, quantity: 1 }],
        })
        .expect(201),
    );

    await forceShopCurrency(shop.shopId, 'SAR');
    // A quote is a promise about a price. It has to remember what it promised.
    expect(await columnOf('draftorder', 'id = ?', [draft.id])).toBe('AED');
  });

  it('freezes it on a gift card, which is a stored balance not a one-off amount', async () => {
    const shop = await setupShop('cur-giftcard');
    const card = body<IdRow>(
      await request(app.getHttpServer())
        .post('/gift-cards')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ initialValue: 100 })
        .expect(201),
    );

    await forceShopCurrency(shop.shopId, 'BHD');
    // 100 AED of stored value must not become 100 BHD (~10x) because someone
    // changed a dropdown.
    expect(await columnOf('giftcard', 'id = ?', [card.id])).toBe('AED');
  });

  it('freezes it on an invoice, taken from the order rather than the shop', async () => {
    const shop = await setupShop('cur-invoice');
    const order = body<OrderResponse>(await createOrder(shop).expect(201));
    const invoice = body<IdRow>(
      await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ orderId: order.id, type: 'INVOICE' })
        .expect(201),
    );

    await forceShopCurrency(shop.shopId, 'OMR');

    // invoice-html.ts still formats with a live shop join today — that is A5's
    // job. What this asserts is that the invoice ROW now carries the truth, so
    // A5 has something correct to read instead of the mutable setting.
    expect(await columnOf('invoice', 'id = ?', [invoice.id])).toBe('AED');
  });

  it('leaves no row in any money table without a currency', async () => {
    // A sweep rather than a per-table assertion: the point of NOT NULL with no
    // default is that this can only ever be 0, so if a future write path forgets
    // the column it fails at the database instead of writing a blank. This is
    // the belt for that braces.
    for (const table of [
      'order',
      'draftorder',
      'giftcard',
      'invoice',
      'paymenttransaction',
      'externaldelivery',
      'dailyshopmetrics',
      'dailyproductmetrics',
      'customermetrics',
    ]) {
      const rows = await db.query<RowDataPacket[]>(
        `SELECT SUM(currency IS NULL OR currency = '') AS bad FROM \`${table}\``,
      );
      expect(Number(rows[0].bad ?? 0)).toBe(0);
    }
  });

  it('kept the affiliate commission columns at full precision', async () => {
    // These two were the only scaled money columns in the schema, DECIMAL(10,2),
    // which silently truncates the third minor digit that KWD/BHD/OMR need.
    const rows = await db.query<RowDataPacket[]>(
      `SELECT table_name AS t, numeric_scale AS s
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND ((table_name = 'affiliatecode' AND column_name = 'commissionValue')
            OR (table_name = 'affiliateorder' AND column_name = 'commissionAmount'))`,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(Number(r.s)).toBe(30);
  });
});
