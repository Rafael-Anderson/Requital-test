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
interface TaxClass {
  id: number;
  name: string;
  rate: string;
  type: string;
  isDefault: boolean;
}
interface OrderResponse {
  id: number;
  total: string;
  taxAmount: string | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(180000);

// Phase 2b / B2. Two things are asserted throughout:
//
//   1. Tax is computed PER LINE against each product's own class, so a
//      zero-rated item in a basket is not charged the shop rate. That is the
//      wrong-VAT-return bug this phase exists to fix.
//   2. The capture (orderitem.taxClassId/taxRate/taxAmount) is written on all
//      three write paths, and the per-line amounts reconcile to order.taxAmount.
describe('Per-line tax computation and capture (e2e)', () => {
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

  // A shop at 5% exclusive with one standard-rated and one zero-rated product,
  // which is the configuration the whole feature is about.
  async function setupShop(prefix: string, taxInclusive = false) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Tax Admin',
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

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ taxRate: 5, taxInclusive })
      .expect(200);

    const classesRes = await request(app.getHttpServer())
      .get('/tax-classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const classes = body<TaxClass[]>(classesRes);
    const standard = classes.find((c) => c.type === 'standard')!;
    const zero = classes.find((c) => c.type === 'zero')!;
    // B1 seeds the standard class at the shop's rate AT SIGNUP, which was 0
    // before the PATCH above - bring it up to the shop's real rate.
    await request(app.getHttpServer())
      .patch(`/tax-classes/${standard.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rate: 5 })
      .expect(200);

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Goods' })
      .expect(201);
    const collectionId = body<IdRow>(collection).id;

    async function product(name: string, price: number, taxClassId: number) {
      const res = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name,
          price,
          thumbnail: 'https://example.com/t.jpg',
          sku: `${name}-${runId}`.replace(/\s+/g, '-'),
          collectionIds: [collectionId],
          taxClassId,
        })
        .expect(201);
      return body<IdRow>(res).id;
    }

    const taxedId = await product(`Taxed ${prefix}`, 100, standard.id);
    const zeroRatedId = await product(`ZeroRated ${prefix}`, 100, zero.id);

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    return {
      adminToken,
      slug,
      outletId,
      taxedId,
      zeroRatedId,
      standardClassId: standard.id,
      zeroClassId: zero.id,
    };
  }

  function lineCaptures(orderId: number) {
    return db.query<RowDataPacket[]>(
      `SELECT productName, quantity, priceAtPurchase, taxClassId, taxRate, taxAmount
         FROM orderitem WHERE orderId = ? ORDER BY id`,
      [orderId],
    );
  }

  function orderRow(orderId: number) {
    return db
      .query<RowDataPacket[]>(
        `SELECT total, taxAmount, discountAmount, deliveryFee FROM \`order\` WHERE id = ?`,
        [orderId],
      )
      .then((r) => r[0]);
  }

  // ── Write path 1: storefront checkout ─────────────────────────────────────
  it('storefront checkout taxes only the standard-rated line and captures both', async () => {
    const shop = await setupShop('tax2a');

    const res = await request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'Tax Customer',
        customerPhone: '0501234567',
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        items: [
          { productId: shop.taxedId, quantity: 1 },
          { productId: shop.zeroRatedId, quantity: 1 },
        ],
      })
      .expect(201);
    const orderId = body<{ order: OrderResponse }>(res).order.id;

    // 5% of the taxed 100 only. Before B2 this was 5% of 200.
    const order = await orderRow(orderId);
    expect(Number(order.taxAmount)).toBeCloseTo(5, 2);
    expect(Number(order.total)).toBeCloseTo(205, 2);

    const lines = await lineCaptures(orderId);
    expect(lines).toHaveLength(2);
    const taxed = lines.find((l) => Number(l.taxRate) === 5)!;
    const zeroRated = lines.find((l) => Number(l.taxRate) === 0)!;
    expect(taxed.taxClassId).toBe(shop.standardClassId);
    expect(Number(taxed.taxAmount)).toBeCloseTo(5, 2);
    expect(zeroRated.taxClassId).toBe(shop.zeroClassId);
    expect(Number(zeroRated.taxAmount)).toBeCloseTo(0, 2);

    // The captures reconcile to the order's own figure, which is the property a
    // VAT document depends on.
    const sum = lines.reduce((s, l) => s + Number(l.taxAmount), 0);
    expect(sum).toBeCloseTo(Number(order.taxAmount), 2);
  });

  it('storefront checkout on an INCLUSIVE shop backs the tax out of the taxed line only', async () => {
    const shop = await setupShop('tax2b', true);

    const res = await request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'Tax Customer',
        customerPhone: '0501234567',
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        items: [
          { productId: shop.taxedId, quantity: 1 },
          { productId: shop.zeroRatedId, quantity: 1 },
        ],
      })
      .expect(201);
    const orderId = body<{ order: OrderResponse }>(res).order.id;

    const order = await orderRow(orderId);
    // Inclusive: the customer pays 200, of which 100/1.05 is net on the taxed
    // line, so the tax inside it is ~4.76. The zero line contains none.
    expect(Number(order.total)).toBeCloseTo(200, 2);
    expect(Number(order.taxAmount)).toBeCloseTo(4.76, 2);
    const lines = await lineCaptures(orderId);
    expect(Number(lines.find((l) => Number(l.taxRate) === 5)!.taxAmount)).toBeCloseTo(4.76, 2);
    expect(Number(lines.find((l) => Number(l.taxRate) === 0)!.taxAmount)).toBeCloseTo(0, 2);
  });

  // ── Write path 2: OrdersService.create (admin / phone order) ──────────────
  it('an admin-created order captures per-line tax the same way', async () => {
    const shop = await setupShop('tax2c');

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Phone Customer',
        customerPhone: '0509998887',
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId: shop.outletId,
        orderType: 'pickup',
        deliveryFee: 0,
        items: [
          { productId: shop.taxedId, quantity: 2 },
          { productId: shop.zeroRatedId, quantity: 1 },
        ],
      })
      .expect(201);
    const orderId = body<OrderResponse>(res).id;

    const order = await orderRow(orderId);
    // 5% of 200, not of 300.
    expect(Number(order.taxAmount)).toBeCloseTo(10, 2);
    expect(Number(order.total)).toBeCloseTo(310, 2);

    const lines = await lineCaptures(orderId);
    expect(Number(lines.find((l) => Number(l.taxRate) === 5)!.taxAmount)).toBeCloseTo(10, 2);
    expect(Number(lines.find((l) => Number(l.taxRate) === 0)!.taxAmount)).toBeCloseTo(0, 2);
    const sum = lines.reduce((s, l) => s + Number(l.taxAmount), 0);
    expect(sum).toBeCloseTo(Number(order.taxAmount), 2);
  });

  // ── Write path 3: updateItems ─────────────────────────────────────────────
  it('editing items recomputes and recaptures per-line tax', async () => {
    const shop = await setupShop('tax2d');

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Edit Customer',
        customerPhone: '0501112223',
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId: shop.outletId,
        orderType: 'pickup',
        deliveryFee: 0,
        items: [{ productId: shop.taxedId, quantity: 1 }],
      })
      .expect(201);
    const orderId = body<OrderResponse>(created).id;
    expect(Number((await orderRow(orderId)).taxAmount)).toBeCloseTo(5, 2);

    // Swap the taxed item for the zero-rated one: the tax must fall to zero,
    // which is only possible if the edit path is per-line too.
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ items: [{ productId: shop.zeroRatedId, quantity: 1 }] })
      .expect(200);

    const after = await orderRow(orderId);
    expect(Number(after.taxAmount)).toBeCloseTo(0, 2);
    expect(Number(after.total)).toBeCloseTo(100, 2);

    const lines = await lineCaptures(orderId);
    expect(lines).toHaveLength(1);
    expect(lines[0].taxClassId).toBe(shop.zeroClassId);
    expect(Number(lines[0].taxRate)).toBe(0);
    expect(Number(lines[0].taxAmount)).toBeCloseTo(0, 2);
  });

  // The fourth caller. Its items do not change, so it must re-tax them at the
  // rate each line was ORIGINALLY captured at, not at today's class.
  it('editing the delivery fee keeps the captured line tax and still reconciles', async () => {
    const shop = await setupShop('tax2e');

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Fee Customer',
        customerPhone: '0504445556',
        customerAddress: 'Somewhere',
        emirate: 'Dubai',
        outletId: shop.outletId,
        orderType: 'delivery',
        deliveryFee: 10,
        items: [
          { productId: shop.taxedId, quantity: 1 },
          { productId: shop.zeroRatedId, quantity: 1 },
        ],
      })
      .expect(201);
    const orderId = body<OrderResponse>(created).id;

    // Move the product onto the zero class AFTER the order exists. The fee edit
    // must not retroactively re-rate the line.
    await request(app.getHttpServer())
      .patch(`/products/${shop.taxedId}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ taxClassId: shop.zeroClassId })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/delivery-fee`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ deliveryFee: 25 })
      .expect(200);

    const after = await orderRow(orderId);
    // Still 5% of the taxed line, at the rate captured at order time.
    expect(Number(after.taxAmount)).toBeCloseTo(5, 2);
    expect(Number(after.total)).toBeCloseTo(230, 2);
    const lines = await lineCaptures(orderId);
    const sum = lines.reduce((s, l) => s + Number(l.taxAmount), 0);
    expect(sum).toBeCloseTo(Number(after.taxAmount), 2);
  });

  // shop.taxOnDelivery, which B1 added and nothing read until now.
  it('taxes the delivery fee only when the shop opts in', async () => {
    const shop = await setupShop('tax2f');

    async function place() {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          customerName: 'Delivery Customer',
          customerPhone: '0507778889',
          customerAddress: 'Somewhere',
          emirate: 'Dubai',
          outletId: shop.outletId,
          orderType: 'delivery',
          deliveryFee: 100,
          items: [{ productId: shop.taxedId, quantity: 1 }],
        })
        .expect(201);
      return orderRow(body<OrderResponse>(res).id);
    }

    const off = await place();
    expect(Number(off.taxAmount)).toBeCloseTo(5, 2); // goods only

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ taxOnDelivery: true })
      .expect(200);

    const on = await place();
    // 5% of the 100 goods plus 5% of the 100 fee.
    expect(Number(on.taxAmount)).toBeCloseTo(10, 2);
    expect(Number(on.total)).toBeCloseTo(210, 2);
  });

  // An order-level discount has no single base once rates differ.
  it('apportions a discount across lines so only the taxed share reduces the tax', async () => {
    const shop = await setupShop('tax2g');
    const code = `TAX2G${runId % 100000}`;
    await request(app.getHttpServer())
      .post('/shop/discounts')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ code, type: 'FIXED_AMOUNT', value: 50 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'Discount Customer',
        customerPhone: '0502223334',
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        discountCode: code,
        items: [
          { productId: shop.taxedId, quantity: 1 },
          { productId: shop.zeroRatedId, quantity: 1 },
        ],
      })
      .expect(201);
    const orderId = body<{ order: OrderResponse }>(res).order.id;

    const order = await orderRow(orderId);
    // 50 off a 200 basket splits 25/25, so the taxed line's base is 75 and the
    // tax is 3.75 - not 5% of 150 (7.50), and not 5% of 200 (10).
    expect(Number(order.discountAmount)).toBeCloseTo(50, 2);
    expect(Number(order.taxAmount)).toBeCloseTo(3.75, 2);
    expect(Number(order.total)).toBeCloseTo(153.75, 2);
  });

  // The bug the existing suite caught during B2, kept as a regression test.
  // `shop.taxRate` is the Business Settings "Tax Rate (%)" field. Once the rate
  // charged comes from the line's tax class, writing only the shop column would
  // make that field inert - a merchant sets 5% and is charged whatever their
  // default class was seeded with at signup (0%).
  it('changing shop.taxRate re-rates the default standard class, so the setting is not inert', async () => {
    const slug = `tax2i-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Rate Admin',
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

    // Seeded from the shop's rate at signup, which is 0.
    const before = body<TaxClass[]>(
      await request(app.getHttpServer())
        .get('/tax-classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200),
    );
    expect(Number(before.find((c) => c.isDefault)!.rate)).toBe(0);

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ taxRate: 7.5 })
      .expect(200);

    const after = body<TaxClass[]>(
      await request(app.getHttpServer())
        .get('/tax-classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200),
    );
    const def = after.find((c) => c.isDefault)!;
    expect(def.type).toBe('standard');
    expect(Number(def.rate)).toBeCloseTo(7.5, 2);
    // The zero class is untouched - it is not "the shop's rate".
    expect(Number(after.find((c) => c.type === 'zero')!.rate)).toBe(0);
  });

  it('editing the default class writes the rate back to shop.taxRate', async () => {
    const shop = await setupShop('tax2j');
    const classes = body<TaxClass[]>(
      await request(app.getHttpServer())
        .get('/tax-classes')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200),
    );
    const def = classes.find((c) => c.isDefault)!;

    await request(app.getHttpServer())
      .patch(`/tax-classes/${def.id}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ rate: 12 })
      .expect(200);

    const shopRes = await request(app.getHttpServer())
      .get('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    // Otherwise Business Settings would display one rate while orders charge
    // another, and a taxed delivery fee would use the stale figure.
    expect(Number(body<{ taxRate: string }>(shopRes).taxRate)).toBeCloseTo(12, 2);
  });

  // B3: the document has to SHOW the tax it captured.
  it('renders a per-line Tax column and a breakdown by rate on the invoice', async () => {
    const shop = await setupShop('tax3a');
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Breakdown Customer',
        customerPhone: '0506667778',
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId: shop.outletId,
        orderType: 'pickup',
        deliveryFee: 0,
        items: [
          { productId: shop.taxedId, quantity: 2 },
          { productId: shop.zeroRatedId, quantity: 1 },
        ],
      })
      .expect(201);
    const orderId = body<OrderResponse>(created).id;

    const invoice = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ orderId, type: 'INVOICE' })
      .expect(201);
    const invoiceId = body<IdRow>(invoice).id;

    const html = (
      await request(app.getHttpServer())
        .get(`/invoices/${invoiceId}/pdf`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200)
    ).text;

    // Per-line column, with the captured rate beside the amount.
    expect(html).toContain('<th class="num">Tax</th>');
    expect(html).toContain('(5%)');
    // Breakdown by rate: the taxed lines and the zero-rated one, which is just
    // as reportable on a return.
    expect(html).toContain('Tax summary');
    expect(html).toContain('Taxable at 5%');
    expect(html).toContain('Taxable at 0%');
  });

  it('omits the Tax column on a packing slip, which hides pricing by design', async () => {
    const shop = await setupShop('tax3b');
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Slip Customer',
        customerPhone: '0508889990',
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId: shop.outletId,
        orderType: 'pickup',
        deliveryFee: 0,
        items: [{ productId: shop.taxedId, quantity: 1 }],
      })
      .expect(201);
    const slip = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ orderId: body<OrderResponse>(created).id, type: 'PACKING_SLIP' })
      .expect(201);
    const html = (
      await request(app.getHttpServer())
        .get(`/invoices/${body<IdRow>(slip).id}/pdf`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200)
    ).text;
    expect(html).not.toContain('<th class="num">Tax</th>');
    expect(html).not.toContain('Tax summary');
  });

  // The invoice is what a merchant files against, so its stored snapshot has to
  // record how the order was priced.
  it('freezes taxInclusive on the invoice at issue', async () => {
    const shop = await setupShop('tax2h', true);
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Invoice Customer',
        customerPhone: '0503334445',
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId: shop.outletId,
        orderType: 'pickup',
        deliveryFee: 0,
        items: [{ productId: shop.taxedId, quantity: 1 }],
      })
      .expect(201);
    const orderId = body<OrderResponse>(created).id;

    const invoice = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ orderId, type: 'INVOICE' })
      .expect(201);
    const invoiceId = body<IdRow>(invoice).id;

    const rows = await db.query<RowDataPacket[]>(
      `SELECT taxInclusive FROM invoice WHERE id = ?`,
      [invoiceId],
    );
    expect(Boolean(rows[0].taxInclusive)).toBe(true);

    // Flipping the shop afterwards must not rewrite the issued document.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ taxInclusive: false })
      .expect(200);
    const after = await db.query<RowDataPacket[]>(
      `SELECT taxInclusive FROM invoice WHERE id = ?`,
      [invoiceId],
    );
    expect(Boolean(after[0].taxInclusive)).toBe(true);
  });
});
