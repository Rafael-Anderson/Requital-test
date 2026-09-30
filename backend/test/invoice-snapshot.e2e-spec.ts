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
  total: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Customer sessions are httpOnly cookies. The test-only bearer fallback in
// AuthGuard is the STAFF tier's alone, so a customer route needs the real
// cookie header - same helper shape as customer-auth.e2e-spec.ts.
function cookieHeaderFrom(res: Response): string {
  const lines = res.get('Set-Cookie') ?? [];
  return lines
    .map((line) => line.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

jest.setTimeout(180000);

// Phase 2c / C1. An invoice that changes after it was issued is not an invoice:
// everything the document printed except the money was being read LIVE from the
// order and the shop at render time, so editing the order (or renaming the shop)
// silently rewrote a document a customer already had.
//
// The packing slip is the deliberate exception and is tested as such - it is a
// picking and cash-collection document, and freezing its "CASH TO COLLECT" is
// what would send a rider to collect a stale amount.
describe('Invoice snapshots (e2e)', () => {
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
        name: 'Snapshot Admin',
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
      .send({
        active: true,
        emirate: 'Dubai',
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
      .send({ name: 'Snapshot Goods' })
      .expect(201);
    const collectionId = body<IdRow>(collection).id;

    async function product(name: string, price: number) {
      const res = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name,
          price,
          thumbnail: 'https://example.com/t.jpg',
          sku: `${name}-${runId}`.replace(/\s+/g, '-'),
          collectionIds: [collectionId],
        })
        .expect(201);
      return body<IdRow>(res).id;
    }

    const firstId = await product(`Snap First ${prefix}`, 100);
    const secondId = await product(`Snap Second ${prefix}`, 250);
    // Orders are placed through the storefront: an admin-created order carries no
    // paymentMethod at all (it is not on CreateOrderDto), and the packing slip's
    // CASH TO COLLECT block only renders for a cash_on_delivery order.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);
    return { adminToken, slug, outletId, firstId, secondId };
  }

  function createOrder(
    shop: { slug: string; outletId: number },
    items: { productId: number; quantity: number }[],
    extra: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'Snapshot Customer',
        customerPhone: '0501234567',
        customerAddress: 'Somewhere in Dubai',
        emirate: 'Dubai',
        orderType: 'delivery',
        paymentMethod: 'cash_on_delivery',
        // The outlet has a delivery radius, so the address has to prove it is
        // inside it (PublicService.resolveDeliveryFee).
        latitude: 25.2048,
        longitude: 55.2708,
        items,
        ...extra,
      });
  }

  // The storefront wraps its response as { order: ... }.
  function orderIdOf(res: Response) {
    return body<{ order: OrderResponse }>(res).order.id;
  }

  function generate(
    token: string,
    orderId: number,
    type: 'INVOICE' | 'PACKING_SLIP',
  ) {
    return request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId, type });
  }

  function pdf(token: string, invoiceId: number) {
    return request(app.getHttpServer())
      .get(`/invoices/${invoiceId}/pdf`)
      .set('Authorization', `Bearer ${token}`);
  }

  it('captures a snapshot at issue, with a version', async () => {
    const shop = await setupShop('snap-a');
    const order = await createOrder(shop, [
      { productId: shop.firstId, quantity: 1 },
    ]).expect(201);
    const invoice = await generate(
      shop.adminToken,
      orderIdOf(order),
      'INVOICE',
    ).expect(201);

    const rows = await db.query<RowDataPacket[]>(
      `SELECT snapshotJson, snapshotVersion FROM invoice WHERE id = ?`,
      [body<IdRow>(invoice).id],
    );
    expect(rows[0].snapshotVersion).toBe(1);
    // A real JSON column, so mysql2 hands it back parsed rather than as a string.
    const snap = rows[0].snapshotJson as Record<string, unknown>;
    expect(typeof snap).toBe('object');
    // Everything the document reads has to be in there.
    for (const key of [
      'orderitem',
      'deliveryFee',
      'discountAmount',
      'discountCode',
      'giftCardAmount',
      'paymentMethod',
      'paymentStatus',
      'shopOrderNumber',
      'customerName',
      'customerPhone',
      'customerAddress',
      'emirate',
      'shopName',
      'shopAddress',
      'shopEmail',
      'shopCurrency',
      'total',
    ]) {
      expect(Object.keys(snap)).toContain(key);
    }
  });

  // THE test this feature exists for.
  it('an issued invoice does not change when the order is edited afterwards', async () => {
    const shop = await setupShop('snap-b');
    const order = await createOrder(shop, [
      { productId: shop.firstId, quantity: 1 },
    ]).expect(201);
    const orderId = orderIdOf(order);
    const invoiceId = body<IdRow>(
      await generate(shop.adminToken, orderId, 'INVOICE').expect(201),
    ).id;

    const before = (await pdf(shop.adminToken, invoiceId).expect(200)).text;
    expect(before).toContain('Snap First snap-b');

    // Replace the line item entirely, and change the delivery fee.
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ items: [{ productId: shop.secondId, quantity: 3 }] })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/delivery-fee`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ deliveryFee: 99 })
      .expect(200);

    const after = (await pdf(shop.adminToken, invoiceId).expect(200)).text;
    // Still the document that was issued: the original item, not the new one.
    expect(after).toContain('Snap First snap-b');
    expect(after).not.toContain('Snap Second snap-b');
    // Byte-identical, which is the real property and strictly stronger than
    // checking for the new fee's digits - a bare "99" also matches an invoice
    // number or an order id that happens to contain it, which is exactly how an
    // earlier version of this assertion passed one run and failed the next.
    expect(after).toBe(before);
  });

  it('an issued invoice keeps the shop name it was issued under', async () => {
    const shop = await setupShop('snap-c');
    const order = await createOrder(shop, [
      { productId: shop.firstId, quantity: 1 },
    ]).expect(201);
    const invoiceId = body<IdRow>(
      await generate(shop.adminToken, orderIdOf(order), 'INVOICE').expect(201),
    ).id;

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ displayName: 'Renamed After Issue' })
      .expect(200);

    const html = (await pdf(shop.adminToken, invoiceId).expect(200)).text;
    expect(html).not.toContain('Renamed After Issue');
  });

  // The deliberate exception. A slip is a live document.
  it('a packing slip DOES follow the order, and its cash-to-collect is the CURRENT total', async () => {
    const shop = await setupShop('snap-d');
    const order = await createOrder(shop, [
      { productId: shop.firstId, quantity: 1 },
    ]).expect(201);
    const orderId = orderIdOf(order);
    const slipId = body<IdRow>(
      await generate(shop.adminToken, orderId, 'PACKING_SLIP').expect(201),
    ).id;

    // Never snapshotted in the first place.
    const rows = await db.query<RowDataPacket[]>(
      `SELECT snapshotJson, snapshotVersion FROM invoice WHERE id = ?`,
      [slipId],
    );
    expect(rows[0].snapshotJson).toBeNull();
    expect(rows[0].snapshotVersion).toBeNull();

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ items: [{ productId: shop.secondId, quantity: 2 }] })
      .expect(200);

    const html = (await pdf(shop.adminToken, slipId).expect(200)).text;
    // The picker must see what is in the box NOW.
    expect(html).toContain('Snap Second snap-d');
    expect(html).not.toContain('Snap First snap-d');
    // And the rider must collect what is owed NOW. The storefront resolves the
    // delivery fee itself, so the expected figure is read from the order rather
    // than assumed - what matters is that the slip shows the CURRENT total and
    // not the one frozen on the invoice row when the slip was generated.
    const live = await db.query<RowDataPacket[]>(
      `SELECT total FROM \`order\` WHERE id = ?`,
      [orderId],
    );
    const liveTotal = Number(live[0].total);
    // 2 x 250 goods; the original slip was generated against a 100 order.
    expect(liveTotal).toBeGreaterThanOrEqual(500);
    expect(html).toContain('CASH TO COLLECT');
    expect(html).toContain(liveTotal.toFixed(2));
    const frozen = await db.query<RowDataPacket[]>(
      `SELECT total FROM invoice WHERE id = ?`,
      [slipId],
    );
    // The frozen figure is genuinely different, so this assertion has teeth.
    expect(Number(frozen[0].total)).toBeLessThan(liveTotal);
    expect(html).not.toContain(Number(frozen[0].total).toFixed(2));
  });

  // No backfill: the 12 invoices that already exist keep rendering live, because
  // what they looked like at issue was never captured and cannot be invented.
  it('an invoice with no snapshot falls back to live rendering', async () => {
    const shop = await setupShop('snap-e');
    const order = await createOrder(shop, [
      { productId: shop.firstId, quantity: 1 },
    ]).expect(201);
    const orderId = orderIdOf(order);
    const invoiceId = body<IdRow>(
      await generate(shop.adminToken, orderId, 'INVOICE').expect(201),
    ).id;

    // Simulate a pre-C1 row.
    await db.execute(
      `UPDATE invoice SET snapshotJson = NULL, snapshotVersion = NULL WHERE id = ?`,
      [invoiceId],
    );
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ items: [{ productId: shop.secondId, quantity: 1 }] })
      .expect(200);

    const html = (await pdf(shop.adminToken, invoiceId).expect(200)).text;
    // Renders live, exactly as it did before this feature existed.
    expect(html).toContain('Snap Second snap-e');
  });

  it('an unrecognised snapshot version falls back to live rather than being misread', async () => {
    const shop = await setupShop('snap-f');
    const order = await createOrder(shop, [
      { productId: shop.firstId, quantity: 1 },
    ]).expect(201);
    const orderId = orderIdOf(order);
    const invoiceId = body<IdRow>(
      await generate(shop.adminToken, orderId, 'INVOICE').expect(201),
    ).id;

    await db.execute(`UPDATE invoice SET snapshotVersion = 99 WHERE id = ?`, [
      invoiceId,
    ]);
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ items: [{ productId: shop.secondId, quantity: 1 }] })
      .expect(200);

    const html = (await pdf(shop.adminToken, invoiceId).expect(200)).text;
    expect(html).toContain('Snap Second snap-f');
  });

  // The customer's own download has to be the same frozen document the merchant
  // sees, not a live re-render.
  it('the customer route renders from the same snapshot as the staff route', async () => {
    const shop = await setupShop('snap-g');
    // A storefront order, so there is a customer to authenticate as.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ published: true })
      .expect(200);
    const phone = `05011${String(runId).slice(-5)}`;
    const placed = await request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'Snapshot Shopper',
        customerPhone: phone,
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        items: [{ productId: shop.firstId, quantity: 1 }],
      })
      .expect(201);
    const orderId = body<{ order: OrderResponse }>(placed).order.id;

    const invoiceId = body<IdRow>(
      await generate(shop.adminToken, orderId, 'INVOICE').expect(201),
    ).id;
    const staffHtml = (await pdf(shop.adminToken, invoiceId).expect(200)).text;

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ items: [{ productId: shop.secondId, quantity: 4 }] })
      .expect(200);

    const registered = await request(app.getHttpServer())
      .post(`/public/${shop.slug}/auth/register`)
      .send({ phone, password: 'shopper123', name: 'Snapshot Shopper' })
      .expect(201);

    const customerHtml = (
      await request(app.getHttpServer())
        .get(`/public/${shop.slug}/account/orders/${orderId}/invoice`)
        .set('Cookie', cookieHeaderFrom(registered))
        .expect(200)
    ).text;

    // Both frozen, both identical, neither showing the post-issue edit.
    expect(customerHtml).toContain('Snap First snap-g');
    expect(customerHtml).not.toContain('Snap Second snap-g');
    expect(customerHtml).toBe(staffHtml);
  });
});
