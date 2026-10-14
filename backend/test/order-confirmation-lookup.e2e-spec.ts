import 'dotenv/config';
import { randomBytes } from 'crypto';
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

jest.setTimeout(90000);

// The order confirmation page reads the order with its tracking token through
// the public lookup, in ONE narrow, explicitly-typed shape. This spec pins:
//  - the token reads its own order and nothing else; a sequential numeric id
//    opens nothing anywhere on the public surface
//  - the exact field whitelist, and that no internal value can appear in it
//  - a token of shop A is the same 404 as an unknown token when asked through
//    shop B
//  - the per-shop number is what is shown, the global id is not
//  - payment fields come from the order's own paymentStatus
describe('Order confirmation lookup (e2e)', () => {
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
        name: 'Confirm Admin',
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
      .send({
        active: true,
        pickupEnabled: true,
        deliveryEnabled: true,
        latitude: 25.2,
        longitude: 55.27,
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
        name: `Confirm Item ${slug}`,
        price: 25,
        costPrice: 7.77,
        thumbnail: 'https://example.com/x.jpg',
        sku: `CNF-${slug}`,
        collectionIds: [body<IdRow>(collection).id],
        trackInventory: false,
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true, defaultDeliveryFee: 12 })
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

  interface Placed {
    id: number;
    shopOrderNumber: number;
    trackingToken: string;
  }
  async function place(
    shop: Shop,
    over: Record<string, unknown> = {},
  ): Promise<Placed> {
    const res = await request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'Confirm Customer',
        customerPhone: '0501234567',
        customerEmail: 'confirm@customer.test',
        customerAddress: '1 Main St',
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        items: [{ productId: shop.productId, quantity: 2 }],
        ...over,
      })
      .expect(201);
    return body<{ order: Placed }>(res).order;
  }

  const lookup = (token: string, shop?: string) =>
    request(app.getHttpServer()).get(
      `/public/orders/lookup?token=${encodeURIComponent(token)}${
        shop === undefined ? '' : `&shop=${encodeURIComponent(shop)}`
      }`,
    );

  type View = Record<string, unknown> & {
    items: Record<string, unknown>[];
  };

  const EXPECTED_KEYS = [
    'amountDue',
    'area',
    'createdAt',
    'currency',
    'customerName',
    'deliveryAddress',
    'deliveryDate',
    'deliveryFee',
    'deliveryTimeSlot',
    'discountAmount',
    'discountCode',
    'estimatedTime',
    'giftCardAmount',
    'hasAccount',
    'id',
    'items',
    'onlinePayment',
    'orderType',
    'outletName',
    'paymentFailed',
    'paymentMethod',
    'paymentStatus',
    'pickupLocation',
    'region',
    'shopName',
    'shopOrderNumber',
    'status',
    'storeCreditAmount',
    'subtotal',
    'taxAmount',
    'taxInclusive',
    'total',
  ];
  const EXPECTED_ITEM_KEYS = [
    'imageUrl',
    'lineTotal',
    'note',
    'priceAtPurchase',
    'productName',
    'quantity',
    'variantLabel',
  ];

  it('the token reads its own order in exactly the whitelisted shape, with nothing internal in it', async () => {
    const shop = await setupShop('cnf-shape');
    const secretNote = `INTERNAL-NOTE-${runId}`;
    const o = await place(shop, { customerEmail: 'secret-mail@customer.test' });
    // Everything an internal reader could have put on the order or around it.
    await request(app.getHttpServer())
      .post(`/orders/${o.id}/notes`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ note: secretNote })
      .expect(201);
    await db.execute(
      `UPDATE \`order\` SET paymentSessionId = 'cs_secret_session',
              deliveryNotes = 'SECRET-DELIVERY-NOTES',
              attributionJson = JSON_OBJECT('utmSource', 'SECRET-ATTRIBUTION')
        WHERE id = ?`,
      [o.id],
    );

    const res = await lookup(o.trackingToken).expect(200);
    const view = body<View>(res);
    expect(Object.keys(view).sort()).toEqual(EXPECTED_KEYS);
    for (const item of view.items) {
      expect(Object.keys(item).sort()).toEqual(EXPECTED_ITEM_KEYS);
    }
    const raw = JSON.stringify(res.body);
    for (const leak of [
      secretNote,
      'cs_secret_session',
      'SECRET-DELIVERY-NOTES',
      'SECRET-ATTRIBUTION',
      '0501234567', // customer phone
      'secret-mail@customer.test', // customer email
      '7.77', // product cost price
      o.trackingToken, // the token is not echoed back
      'paymentLinkToken',
      'shopId',
      'outletId',
      'unitCost',
    ]) {
      expect(raw).not.toContain(leak);
    }
    expect(view.shopOrderNumber).toBe(o.shopOrderNumber);
    expect(view.status).toBe('pending');
    expect(view.customerName).toBe('Confirm Customer');
  });

  it('is never cached', async () => {
    const shop = await setupShop('cnf-cache');
    const o = await place(shop);
    const ok = await lookup(o.trackingToken).expect(200);
    expect(ok.headers['cache-control']).toBe('no-store');
  });

  it('a legacy 10-hex token reads status, items and totals but not the address, region or item notes', async () => {
    const shop = await setupShop('cnf-legacy');
    const o = await place(shop, {
      orderType: 'delivery',
      paymentMethod: 'cash_on_delivery',
      customerAddress: '9 Palm Street',
      latitude: 25.2,
      longitude: 55.27,
      items: [{ productId: shop.productId, quantity: 1, note: 'ring the bell' }],
    });
    // The full token still shows them.
    const full = body<View>(await lookup(o.trackingToken).expect(200));
    expect(full.deliveryAddress).toBe('9 Palm Street');
    expect(full.items[0].note).toBe('ring the bell');

    // Random: the column is unique and the dev DB outlives a run.
    const legacy = randomBytes(5).toString('hex');
    await db.execute(
      "UPDATE `order` SET trackingToken = ?, area = ?, discountCode = 'SAVE10' WHERE id = ?",
      [legacy, 'Marina', o.id],
    );
    const v = body<View>(await lookup(legacy).expect(200));
    expect(v.deliveryAddress).toBeNull();
    expect(v.area).toBeNull();
    expect(v.region).toBeNull();
    expect(v.items[0].note).toBeNull();
    expect(v.customerName).toBe('');
    expect(v.discountCode).toBeNull();
    expect(JSON.stringify(v)).not.toContain('Confirm Customer');
    expect(JSON.stringify(v)).not.toContain('9 Palm Street');
    expect(JSON.stringify(v)).not.toContain('ring the bell');
    // Status, items and totals are still there.
    expect(v.items[0].productName).toBeDefined();
    expect(Number(v.total)).toBeGreaterThan(0);
    expect(v.shopOrderNumber).toBe(o.shopOrderNumber);
  });

  it('shows the per-shop number, and the global id is a different value', async () => {
    const a = await setupShop('cnf-num-a');
    const b = await setupShop('cnf-num-b');
    await place(a);
    await place(a);
    const ob = await place(b); // first order of shop B
    const view = body<View>(await lookup(ob.trackingToken).expect(200));
    expect(view.shopOrderNumber).toBe(1);
    expect(view.shopOrderNumber).toBe(ob.shopOrderNumber);
    expect(view.id).toBe(ob.id);
    expect(view.id).not.toBe(view.shopOrderNumber);
    const rows = await db.query<RowDataPacket[]>(
      'SELECT shopOrderNumber FROM `order` WHERE id = ?',
      [ob.id],
    );
    expect(rows[0].shopOrderNumber).toBe(1);
  });

  it('an enumerated numeric order id opens nothing, on every public path', async () => {
    const a = await setupShop('cnf-enum-a');
    const b = await setupShop('cnf-enum-b');
    const oa = await place(a);
    const ob = await place(b);

    const unknown = await lookup('A'.repeat(32)).expect(404);

    // The id itself, its neighbours, zero-padded to 10 (which is the legacy
    // token SHAPE), and as a path: none of them is an order.
    const probes = new Set<string>();
    for (const id of [oa.id, ob.id, oa.id - 1, oa.id + 1, ob.id + 1, 1]) {
      probes.add(String(id));
      probes.add(String(id).padStart(10, '0'));
      probes.add(String(id).padStart(32, '0'));
    }
    for (const p of probes) {
      const res = await lookup(p).expect(404);
      expect(res.body).toEqual(unknown.body);
      // ...nor through either shop's slug
      await lookup(p, a.slug).expect(404);
      await lookup(p, b.slug).expect(404);
    }
    for (const id of [oa.id, ob.id]) {
      await request(app.getHttpServer())
        .get(`/public/${a.slug}/orders/${id}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/public/${b.slug}/orders/${id}`)
        .expect(404);
      await request(app.getHttpServer()).get(`/public/orders/${id}`).expect(404);
      // The customer-scoped id route needs a signed-in customer.
      await request(app.getHttpServer())
        .get(`/public/${a.slug}/account/orders/${id}`)
        .expect(401);
    }
  });

  it('a token of shop A through shop B is the same 404 as an unknown token', async () => {
    const a = await setupShop('cnf-x-a');
    const b = await setupShop('cnf-x-b');
    const oa = await place(a);
    const unknown = await lookup('B'.repeat(32), b.slug).expect(404);

    const viaB = await lookup(oa.trackingToken, b.slug).expect(404);
    expect(viaB.body).toEqual(unknown.body);

    // Through its own shop, and un-slugged (the tracking page), it resolves.
    expect(body<View>(await lookup(oa.trackingToken, a.slug).expect(200)).id).toBe(
      oa.id,
    );
    await lookup(oa.trackingToken).expect(200);
    // An unknown shop slug is also just a 404.
    await lookup(oa.trackingToken, 'no-such-shop-xyz').expect(404);
    // Repeated query params are not coerced into something that matches.
    await request(app.getHttpServer())
      .get(
        `/public/orders/lookup?token=${oa.trackingToken}&shop=${b.slug}&shop=${a.slug}`,
      )
      .expect(404);
    await request(app.getHttpServer())
      .get(
        `/public/orders/lookup?token=${oa.trackingToken}&token=${oa.trackingToken}`,
      )
      .expect(404); // coerced to a non-token string by the global pipe
  });

  it('pickup carries the outlet location and no address; delivery carries the address, fee and slot', async () => {
    const shop = await setupShop('cnf-where');
    const pickup = await place(shop);
    const pv = body<View>(await lookup(pickup.trackingToken).expect(200));
    expect(pv.orderType).toBe('pickup');
    expect(pv.deliveryAddress).toBeNull();
    expect(pv.pickupLocation).toEqual(
      expect.objectContaining({ name: expect.any(String) as string }),
    );
    expect(Number(pv.deliveryFee)).toBe(0);

    const delivery = await place(shop, {
      orderType: 'delivery',
      paymentMethod: 'cash_on_delivery',
      customerAddress: '9 Palm Street',
      latitude: 25.2,
      longitude: 55.27,
    });
    await db.execute(
      `UPDATE \`order\` SET deliveryDate = '2026-10-20', deliveryTimeSlot = '10:00 - 11:00' WHERE id = ?`,
      [delivery.id],
    );
    const dv = body<View>(await lookup(delivery.trackingToken).expect(200));
    expect(dv.orderType).toBe('delivery');
    expect(dv.deliveryAddress).toBe('9 Palm Street');
    expect(dv.pickupLocation).toBeNull();
    expect(Number(dv.deliveryFee)).toBe(12);
    // A date, not a timezone-ambiguous instant.
    expect(dv.deliveryDate).toBe('2026-10-20');
    expect(dv.deliveryTimeSlot).toBe('10:00 - 11:00');
    expect(dv.paymentMethod).toBe('cash_on_delivery');
    expect(dv.onlinePayment).toBe(false);
  });

  it('payment fields follow the order paymentStatus, and a failed gateway report is visible only while unpaid', async () => {
    const shop = await setupShop('cnf-pay');
    const o = await place(shop);
    const set = (sql: string, params: unknown[] = []) =>
      db.execute(
        `UPDATE \`order\` SET ${sql} WHERE id = ?`,
        [...params, o.id] as never,
      );

    // Pay on pickup, unpaid: nothing online to wait for.
    let v = body<View>(await lookup(o.trackingToken).expect(200));
    expect(v.paymentStatus).toBe('unpaid');
    expect(v.onlinePayment).toBe(false);
    expect(v.paymentFailed).toBe(false);

    // An online method that has not been paid yet.
    await set(`paymentMethod = 'card_online'`);
    v = body<View>(await lookup(o.trackingToken).expect(200));
    expect(v.onlinePayment).toBe(true);
    expect(v.paymentStatus).toBe('unpaid');
    expect(v.paymentFailed).toBe(false);

    // The gateway reported a failure.
    await db.execute(
      `INSERT INTO paymenttransaction (orderId, gateway, gatewayReference, amount, status, currency)
       VALUES (?, 'stripe', ?, 50, 'failed', 'AED')`,
      [o.id, `evt_failed_${runId}`],
    );
    v = body<View>(await lookup(o.trackingToken).expect(200));
    expect(v.paymentFailed).toBe(true);

    // A retry whose latest gateway report is not a failure: no longer failed,
    // even though an older failed row exists.
    await db.execute(
      `INSERT INTO paymenttransaction (orderId, gateway, gatewayReference, amount, status, currency)
       VALUES (?, 'stripe', ?, 50, 'paid', 'AED')`,
      [o.id, `evt_retry_${runId}`],
    );
    v = body<View>(await lookup(o.trackingToken).expect(200));
    expect(v.paymentFailed).toBe(false);
    await db.execute(
      `INSERT INTO paymenttransaction (orderId, gateway, gatewayReference, amount, status, currency)
       VALUES (?, 'stripe', ?, 50, 'failed', 'AED')`,
      [o.id, `evt_failed_again_${runId}`],
    );
    v = body<View>(await lookup(o.trackingToken).expect(200));
    expect(v.paymentFailed).toBe(true);

    // It was paid after all: the server's paymentStatus wins.
    await set(`paymentStatus = 'paid'`);
    v = body<View>(await lookup(o.trackingToken).expect(200));
    expect(v.paymentStatus).toBe('paid');
    expect(v.paymentFailed).toBe(false);
  });

  it('money is in the ORDER currency to its own minor unit, with exact line totals and the amount due', async () => {
    const shop = await setupShop('cnf-kwd');
    const o = await place(shop);
    // The shop stays AED; only the order is KWD, three decimals.
    await db.execute(`UPDATE \`order\` SET currency = 'KWD', total = ?, giftCardAmount = ?, storeCreditAmount = ?, discountAmount = ?, deliveryFee = ? WHERE id = ?`, [
      '32.015',
      '2.000',
      '5.500',
      '1.000',
      '1.500',
      o.id,
    ]);
    await db.execute(
      `UPDATE orderitem SET priceAtPurchase = '10.505', quantity = 3 WHERE orderId = ?`,
      [o.id],
    );
    const v = body<View>(await lookup(o.trackingToken).expect(200));
    expect(v.currency).toBe('KWD');
    expect(v.items[0].priceAtPurchase).toBe('10.505');
    expect(v.items[0].lineTotal).toBe('31.515');
    expect(v.subtotal).toBe('31.515');
    expect(v.total).toBe('32.015');
    // total - gift card - store credit = 32.015 - 2 - 5.5
    expect(v.amountDue).toBe('24.515');
    expect(v.giftCardAmount).toBe('2');
    expect(v.storeCreditAmount).toBe('5.5');
  });

  it('an item image is the variant image or the product first image, resolved inside the order shop', async () => {
    const a = await setupShop('cnf-img-a');
    const b = await setupShop('cnf-img-b');
    await db.execute(
      `INSERT INTO productimage (productId, url, \`order\`) VALUES (?, '/uploads/second.jpg', 2), (?, '/uploads/first.jpg', 1)`,
      [a.productId, a.productId],
    );
    await db.execute(
      `INSERT INTO productimage (productId, url, \`order\`) VALUES (?, '/uploads/b-only.jpg', 0)`,
      [b.productId],
    );
    const oa = await place(a);
    const va = body<View>(await lookup(oa.trackingToken).expect(200));
    expect(va.items[0].imageUrl).toBe('/uploads/first.jpg');

    // A line pointing at another shop's product (forced via SQL) must not
    // surface that shop's image.
    await db.execute(`UPDATE orderitem SET productId = ? WHERE orderId = ?`, [
      b.productId,
      oa.id,
    ]);
    const forced = body<View>(await lookup(oa.trackingToken).expect(200));
    expect(forced.items[0].imageUrl).toBeNull();
  });
});
