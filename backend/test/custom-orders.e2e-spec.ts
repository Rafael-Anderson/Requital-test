import 'dotenv/config';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { NomodClient } from '../src/payments/nomod/nomod-client';
import { verifySignupEmail } from './helpers/verify-signup-email';

// JOB B: admin custom orders (draft orders + payment link). Nomod's HTTP is a
// fake (no network); the order is marked paid only through the real webhook and
// confirm paths.

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface Bill {
  currency: string;
  subtotal: string;
  discount: { amount: string; source: string | null };
  deliveryFee: string | null;
  deliveryError: string | null;
  taxAmount: string | null;
  total: string | null;
  lines: { name: string; unitPrice: string; custom: boolean }[];
  stockWarnings: { name: string; requested: number; available: number }[];
}
interface Draft {
  id: number;
  status: string;
  bill: Bill | null;
  payLink: { url: string } | null;
  cardAvailable: boolean;
  convertedOrderId: number | null;
  orders: {
    id: number;
    status: string;
    paymentStatus: string;
    adminSource: string;
  }[];
}
interface PaySummary {
  state: string;
  bill: Bill;
  fulfilment: Record<string, unknown>;
  order: { shopOrderNumber: number; trackingToken: string } | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(240000);

interface FakeCheckout {
  status: string;
  amount: string;
  currency: string;
}
const fakeCheckouts = new Map<string, FakeCheckout>();
let seq = 0;
let failCreate = false;
const fakeClient = {
  createCheckout: jest.fn(
    (
      _c: unknown,
      input: {
        referenceId: string;
        amounts: { amount: string; currency: string };
      },
    ) => {
      if (failCreate) return Promise.reject(new Error('gateway down'));
      seq += 1;
      const id = `chk_co_${process.pid}_${seq}`;
      fakeCheckouts.set(id, {
        status: 'created',
        amount: input.amounts.amount,
        currency: input.amounts.currency,
      });
      return Promise.resolve({
        id,
        url: `https://pay.nomod.test/${id}`,
        status: 'created',
        amount: input.amounts.amount,
        currency: input.amounts.currency,
        referenceId: input.referenceId,
      });
    },
  ),
  getCheckout: jest.fn((_c: unknown, id: string) => {
    const c = fakeCheckouts.get(id);
    if (!c) return Promise.reject(new Error('unknown checkout'));
    return Promise.resolve({
      id,
      url: null,
      status: c.status,
      amount: c.amount,
      currency: c.currency,
      referenceId: null,
    });
  }),
  refund: jest.fn(),
  testConnection: jest
    .fn()
    .mockResolvedValue({ ok: true, rejected: false, message: 'ok' }),
};

describe('Custom orders (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  const E = (name: string) => `${name}-${runId}`;

  interface Shop {
    slug: string;
    token: string;
    shopId: number;
    outletId: number;
    productId: number;
    regionId: number;
    secret: string;
    webhookPath: string;
  }
  let a: Shop;
  let b: Shop;

  const http = () => app.getHttpServer();
  const auth = (s: Shop) => ({ Authorization: `Bearer ${s.token}` });

  async function setupShop(prefix: string): Promise<Shop> {
    const slug = `co-${prefix}-${runId}`;
    const signup = await request(http())
      .post('/auth/signup')
      .send({
        name: 'Custom Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const token = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      http(),
      body<AuthResponse>(signup).devVerificationLink,
    );
    const h = { Authorization: `Bearer ${token}` };
    const outlets = await request(http()).get('/outlets').set(h).expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(http())
      .patch(`/outlets/${outletId}`)
      .set(h)
      .send({
        active: true,
        deliveryEnabled: true,
        pickupEnabled: true,
        latitude: 25.2048,
        longitude: 55.2708,
        deliveryRadiusKm: 50,
      })
      .expect(200);
    await request(http())
      .patch('/shop')
      .set(h)
      .send({
        taxRate: 5,
        taxInclusive: false,
        defaultDeliveryFee: 9,
        deliveryPaymentCashOnDelivery: true,
        pickupPaymentCashOnPickup: true,
        deliveryPaymentCardOnline: true,
      })
      .expect(200);
    await db.execute(`UPDATE shop SET countryCode = 'AE' WHERE subdomain = ?`, [
      slug,
    ]);
    const collection = await request(http())
      .post('/collections')
      .set(h)
      .send({ name: 'Custom Goods' })
      .expect(201);
    const product = await request(http())
      .post('/products')
      .set(h)
      .send({
        name: 'Custom Rose',
        price: 50,
        thumbnail: 'https://example.com/r.jpg',
        sku: `CO-${prefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);
    await request(http())
      .patch('/shop')
      .set(h)
      .send({ published: true })
      .expect(200);
    const shopRow = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    const region = await db.query<RowDataPacket[]>(
      `SELECT id, nameEn FROM region WHERE countryCode = 'AE' ORDER BY sortOrder LIMIT 1`,
    );
    await db.execute(
      `INSERT INTO deliveryzone (outletId, name, fee, minOrderAmount, isActive) VALUES (?, ?, 15, 0, 1)`,
      [outletId, region[0].nameEn as string],
    );
    // Nomod as the card processor (granted by default), with a signing secret.
    const secret = `whsec_${randomBytes(24).toString('base64')}`;
    await request(http())
      .patch('/payment-settings/stripe')
      .set(h)
      .send({ enabled: false })
      .expect(200);
    const nomod = await request(http())
      .patch('/payment-settings/nomod')
      .set(h)
      .send({
        enabled: true,
        credentials: { apiKey: `key${prefix}${runId}`, webhookSecret: secret },
      })
      .expect(200);
    const webhookPath = body<{ provider: string; webhookPath: string }[]>(
      nomod,
    ).find((r) => r.provider === 'nomod')!.webhookPath;
    return {
      slug,
      token,
      shopId: shopRow[0].id as number,
      outletId,
      productId: body<IdRow>(product).id,
      regionId: region[0].id as number,
      secret,
      webhookPath,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(NomodClient)
      .useValue(fakeClient)
      .compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DatabaseService);
    a = await setupShop('a');
    b = await setupShop('b');
  });

  afterAll(async () => {
    await db.execute(
      `UPDATE \`order\` o JOIN shop s ON s.id = o.shopId
          SET o.paymentSessionId = NULL, o.paymentSessionGateway = NULL
        WHERE s.subdomain LIKE ?`,
      [`co-%-${runId}`],
    );
    await app.close();
  });

  beforeEach(() => {
    failCreate = false;
  });

  const baseDraft = (s: Shop, over: Record<string, unknown> = {}) => ({
    outletId: s.outletId,
    customerName: 'Layla Custom',
    customerPhone: '0501112233',
    customerEmail: 'layla@example.com',
    customerAddress: 'Villa 7, Street 3',
    regionId: s.regionId,
    orderType: 'delivery',
    items: [{ productId: s.productId, quantity: 2 }],
    ...over,
  });

  async function createDraft(s: Shop, over: Record<string, unknown> = {}) {
    const res = await request(http())
      .post('/shop/draft-orders')
      .set(auth(s))
      .send(baseDraft(s, over))
      .expect(201);
    return body<Draft>(res);
  }
  async function getDraft(s: Shop, id: number) {
    return body<Draft>(
      await request(http())
        .get(`/shop/draft-orders/${id}`)
        .set(auth(s))
        .expect(200),
    );
  }
  async function sendLink(s: Shop, id: number) {
    const d = body<Draft>(
      await request(http())
        .post(`/shop/draft-orders/${id}/payment-link`)
        .set(auth(s))
        .expect(201),
    );
    return { draft: d, token: d.payLink!.url.split('/pay/')[1] };
  }
  const paySummary = (s: Shop, token: string) =>
    request(http()).get(`/public/${s.slug}/custom-orders/pay/${token}`);
  const pay = (s: Shop, token: string) =>
    request(http()).post(
      `/public/${s.slug}/custom-orders/pay/${token}/session`,
    );

  async function orderRow(id: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT * FROM \`order\` WHERE id = ?`,
      [id],
    );
    return rows[0];
  }
  async function latestCheckout(orderId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT * FROM nomodcheckout WHERE orderId = ? ORDER BY id DESC LIMIT 1`,
      [orderId],
    );
    return rows[0];
  }
  function deliver(s: Shop, payload: unknown) {
    const raw = JSON.stringify(payload);
    const id = `msg_${randomUUID()}`;
    const ts = Math.floor(Date.now() / 1000);
    const key = Buffer.from(s.secret.replace(/^whsec_/, ''), 'base64');
    const sig = createHmac('sha256', key)
      .update(`${id}.${ts}.${raw}`)
      .digest('base64');
    return request(http())
      .post(s.webhookPath)
      .set('Content-Type', 'application/json')
      .set('svix-id', id)
      .set('svix-timestamp', String(ts))
      .set('svix-signature', `v1,${sig}`)
      .send(raw);
  }
  const completed = (eventId: string, referenceId: string, total: string) => ({
    type: 'charge.completed',
    eventId,
    objectId: `chg_${eventId}`,
    data: { total, currency: 'AED', status: 'paid', referenceId },
  });
  async function paidTxCount(orderId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM paymenttransaction WHERE orderId = ? AND status = 'paid'`,
      [orderId],
    );
    return Number(rows[0].n);
  }

  describe('pricing parity', () => {
    it('the same cart is priced identically by the builder, the storefront quote, a storefront order and a COD conversion', async () => {
      const code = `CODISC${runId % 100000}`;
      await request(http())
        .post('/shop/discounts')
        .set(auth(a))
        .send({ code, type: 'FIXED_AMOUNT', value: 7 })
        .expect(201);
      const cart = { items: [{ productId: a.productId, quantity: 3 }] };

      const preview = body<Bill>(
        await request(http())
          .post('/shop/draft-orders/preview')
          .set(auth(a))
          .send(baseDraft(a, { ...cart, discountCode: code }))
          .expect(200),
      );
      const quote = body<{
        total: string;
        deliveryFee: string;
        taxAmount: string;
        discountAmount: string;
      }>(
        await request(http())
          .post(`/public/${a.slug}/delivery-quote`)
          .send({
            outletId: a.outletId,
            orderType: 'delivery',
            regionId: a.regionId,
            latitude: 25.21,
            longitude: 55.28,
            discountCode: code,
            ...cart,
          })
          .expect(201),
      );
      const storefront = body<{
        order: { total: string; taxAmount: string; deliveryFee: string };
      }>(
        await request(http())
          .post(`/public/${a.slug}/orders`)
          .send({
            outletId: a.outletId,
            orderType: 'delivery',
            paymentMethod: 'cash_on_delivery',
            customerName: 'Parity Shopper',
            customerPhone: '0507778899',
            customerAddress: 'Villa 9',
            regionId: a.regionId,
            latitude: 25.21,
            longitude: 55.28,
            discountCode: code,
            ...cart,
          })
          .expect(201),
      );
      const draft = await createDraft(a, { ...cart, discountCode: code });
      await request(http())
        .post(`/shop/draft-orders/${draft.id}/cod`)
        .set(auth(a))
        .expect(201);
      const converted = await getDraft(a, draft.id);
      const order = await orderRow(converted.convertedOrderId!);

      // 150 - 7 = 143 goods; delivery 15 (the zone, not the default 9);
      // tax 5% of 143 = 7.15; total 165.15.
      expect(preview.total).toBe('165.15');
      expect(Number(quote.total)).toBe(165.15);
      expect(Number(storefront.order.total)).toBe(165.15);
      expect(Number(order.total)).toBe(165.15);
      expect(preview.deliveryFee).toBe('15');
      expect(Number(order.deliveryFee)).toBe(15);
      expect(Number(order.taxAmount)).toBe(Number(preview.taxAmount));
      expect(order.adminSource).toBe('cod');
      expect(order.paymentMethod).toBe('cash_on_delivery');
      expect(order.paymentStatus).toBe('unpaid');
      expect(order.draftOrderId).toBe(draft.id);
    });
  });

  describe('builder rules and scoping', () => {
    it('custom items, a price override that needs a reason, a staff discount and a fee override', async () => {
      await request(http())
        .post('/shop/draft-orders')
        .set(auth(a))
        .send(
          baseDraft(a, {
            items: [{ productId: a.productId, quantity: 1, price: 40 }],
          }),
        )
        .expect(400);
      const draft = await createDraft(a, {
        items: [
          {
            productId: a.productId,
            quantity: 1,
            price: 40,
            priceReason: 'Loyal customer',
          },
          {
            customName: 'Hand-written card',
            price: 10,
            quantity: 1,
            taxable: false,
          },
        ],
        orderDiscountType: 'percent',
        orderDiscountValue: 10,
        orderDiscountReason: 'Apology',
        deliveryFeeOverride: 0,
        deliveryFeeOverrideReason: 'Neighbour',
      });
      const bill = draft.bill!;
      // goods 50, discount 10% = 5; card is zero-rated. tax 5% on (40 - 4) = 1.8
      expect(bill.subtotal).toBe('50');
      expect(bill.discount).toMatchObject({ amount: '5', source: 'manual' });
      expect(bill.deliveryFee).toBe('0');
      expect(bill.taxAmount).toBe('1.8');
      expect(bill.total).toBe('46.8');
      expect(bill.lines[1]).toMatchObject({
        name: 'Hand-written card',
        custom: true,
      });
      // the carrier product never shows in the admin product list
      const products = body<{ name: string }[]>(
        await request(http()).get('/products').set(auth(a)).expect(200),
      );
      expect(products.map((p) => p.name)).not.toContain('Custom item (no tax)');
      // Mark as paid: converts once, paid, with the method recorded
      await request(http())
        .post(`/shop/draft-orders/${draft.id}/mark-paid`)
        .set(auth(a))
        .send({ method: 'bank_transfer', reference: 'TRX-1' })
        .expect(201);
      await request(http())
        .post(`/shop/draft-orders/${draft.id}/mark-paid`)
        .set(auth(a))
        .send({ method: 'cash' })
        .expect(400);
      const done = await getDraft(a, draft.id);
      expect(done.status).toBe('COMPLETED');
      expect(done.orders).toHaveLength(1);
      const order = await orderRow(done.convertedOrderId!);
      expect(order).toMatchObject({
        paymentStatus: 'paid',
        adminSource: 'marked_paid',
        manualPaymentMethod: 'bank_transfer',
        manualPaymentReference: 'TRX-1',
      });
      expect(Number(order.total)).toBe(46.8);
      const items = await db.query<RowDataPacket[]>(
        `SELECT productName FROM orderitem WHERE orderId = ? ORDER BY id`,
        [order.id as number],
      );
      expect(items.map((i) => i.productName as string)).toEqual([
        'Custom Rose',
        'Hand-written card',
      ]);
    });

    it('drafts are shop-scoped, paginated, filtered and searchable', async () => {
      const draft = await createDraft(a, {
        customerName: `Search Me ${runId}`,
      });
      await request(http())
        .get(`/shop/draft-orders/${draft.id}`)
        .set(auth(b))
        .expect(404);
      await request(http())
        .patch(`/shop/draft-orders/${draft.id}`)
        .set(auth(b))
        .send({ notes: 'x' })
        .expect(404);
      await request(http())
        .post(`/shop/draft-orders/${draft.id}/cod`)
        .set(auth(b))
        .expect(404);
      const page = body<{
        data: { id: number }[];
        total: number;
        page: number;
        pageSize: number;
      }>(
        await request(http())
          .get(
            `/shop/draft-orders?status=open&search=${encodeURIComponent(`Search Me ${runId}`)}&page=1&pageSize=5`,
          )
          .set(auth(a))
          .expect(200),
      );
      expect(page.data.map((d) => d.id)).toEqual([draft.id]);
      expect(page.total).toBe(1);
      const other = body<{ data: { id: number }[] }>(
        await request(http())
          .get(
            `/shop/draft-orders?search=${encodeURIComponent(`Search Me ${runId}`)}`,
          )
          .set(auth(b))
          .expect(200),
      );
      expect(other.data).toHaveLength(0);
    });
  });

  describe('payment link', () => {
    it('another shop’s slug, an unknown token and a bad shape are the same 404', async () => {
      const draft = await createDraft(a);
      const { token } = await sendLink(a, draft.id);
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      await paySummary(a, token).expect(200);
      await paySummary(b, token).expect(404);
      await pay(b, token).expect(404);
      await paySummary(a, randomBytes(16).toString('hex')).expect(404);
      await paySummary(a, 'not-a-token').expect(404);
    });

    it('sending the link creates no order; Pay converts once, a second Pay reuses the order, the webhook pays it exactly once', async () => {
      const draft = await createDraft(a);
      const { token } = await sendLink(a, draft.id);
      expect((await getDraft(a, draft.id)).convertedOrderId).toBeNull();
      const summary = body<PaySummary>(await paySummary(a, token).expect(200));
      expect(summary.state).toBe('payable');
      expect(summary.bill.total).toBe('120');
      expect(JSON.stringify(summary)).not.toContain('notes');

      // two presses at once: one order
      const [r1, r2] = await Promise.all([pay(a, token), pay(a, token)]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses[0]).toBe(200);
      const after = await getDraft(a, draft.id);
      expect(after.status).toBe('AWAITING_PAYMENT');
      expect(after.orders).toHaveLength(1);
      const orderId = after.convertedOrderId!;
      let order = await orderRow(orderId);
      expect(order).toMatchObject({
        status: 'pending',
        paymentStatus: 'unpaid',
        adminSource: 'payment_link',
        paymentMethod: 'card_online',
      });
      expect(Number(order.total)).toBe(120);
      // a later press reuses the same order with a fresh session
      const again = body<{ checkoutUrl: string }>(
        await pay(a, token).expect(200),
      );
      expect(again.checkoutUrl).toMatch(/^https:\/\/pay\.nomod\.test\//);
      expect((await getDraft(a, draft.id)).orders).toHaveLength(1);

      const checkout = await latestCheckout(orderId);
      await deliver(
        a,
        completed(E('co-paid'), checkout.referenceId as string, '120.00'),
      ).expect(201);
      await deliver(
        a,
        completed(E('co-paid'), checkout.referenceId as string, '120.00'),
      ).expect(201);
      await deliver(
        a,
        completed(E('co-paid-2'), checkout.referenceId as string, '120.00'),
      ).expect(201);
      order = await orderRow(orderId);
      expect(order.paymentStatus).toBe('paid');
      expect(await paidTxCount(orderId)).toBe(1);
      const final = await getDraft(a, draft.id);
      expect(final.status).toBe('COMPLETED');
      const paid = body<PaySummary>(await paySummary(a, token).expect(200));
      expect(paid.state).toBe('paid');
      expect(paid.order?.shopOrderNumber).toBe(order.shopOrderNumber);
      // a paid link cannot be paid again
      expect(
        body<{ alreadyPaid: boolean }>(await pay(a, token).expect(200))
          .alreadyPaid,
      ).toBe(true);
    });

    it('a confirm poll racing the webhook still pays once', async () => {
      const draft = await createDraft(a);
      const { token } = await sendLink(a, draft.id);
      await pay(a, token).expect(200);
      const orderId = (await getDraft(a, draft.id)).convertedOrderId!;
      const order = await orderRow(orderId);
      const checkout = await latestCheckout(orderId);
      fakeCheckouts.get(checkout.checkoutId as string)!.status = 'paid';
      await Promise.all([
        request(http()).get(
          `/public/orders/lookup?token=${order.trackingToken as string}&shop=${a.slug}`,
        ),
        deliver(
          a,
          completed(E('co-race'), checkout.referenceId as string, '120.00'),
        ),
      ]);
      expect((await orderRow(orderId)).paymentStatus).toBe('paid');
      expect(await paidTxCount(orderId)).toBe(1);
    });

    it('a cancelled pending order lets the same link be paid again, into a new order', async () => {
      const draft = await createDraft(a);
      const { token } = await sendLink(a, draft.id);
      await pay(a, token).expect(200);
      const first = (await getDraft(a, draft.id)).convertedOrderId!;
      await request(http())
        .post(`/orders/${first}/cancel`)
        .set(auth(a))
        .expect(201);
      const back = await getDraft(a, draft.id);
      expect(back.status).toBe('INVOICE_SENT');
      expect(
        body<PaySummary>(await paySummary(a, token).expect(200)).state,
      ).toBe('payable');
      await pay(a, token).expect(200);
      const now = await getDraft(a, draft.id);
      expect(now.convertedOrderId).not.toBe(first);
      expect(now.orders.map((o) => o.id).sort()).toEqual(
        [first, now.convertedOrderId].sort(),
      );
    });

    it('a gateway failure cancels the order it created and the link works again', async () => {
      const draft = await createDraft(a);
      const { token } = await sendLink(a, draft.id);
      failCreate = true;
      await pay(a, token).expect(503);
      failCreate = false;
      const d = await getDraft(a, draft.id);
      expect(d.status).toBe('INVOICE_SENT');
      expect(d.orders[0].status).toBe('cancelled');
      await pay(a, token).expect(200);
    });

    it('an edit after the link re-locks the amount on the same URL; the amount guard still parks a mismatched payment', async () => {
      const draft = await createDraft(a);
      const { token } = await sendLink(a, draft.id);
      await pay(a, token).expect(200);
      const oldOrder = (await getDraft(a, draft.id)).convertedOrderId!;
      const oldCheckout = await latestCheckout(oldOrder);

      // staff edit: 3 roses now. The pending order is cancelled, the link re-locked.
      const edited = body<Draft>(
        await request(http())
          .patch(`/shop/draft-orders/${draft.id}`)
          .set(auth(a))
          .send({ items: [{ productId: a.productId, quantity: 3 }] })
          .expect(200),
      );
      expect(edited.status).toBe('INVOICE_SENT');
      expect(edited.bill!.total).toBe('172.5');
      expect(
        body<PaySummary>(await paySummary(a, token).expect(200)).bill.total,
      ).toBe('172.5');
      expect((await orderRow(oldOrder)).status).toBe('cancelled');

      // the new order asks for the new amount; a payment of the OLD amount is parked
      await pay(a, token).expect(200);
      const newOrder = (await getDraft(a, draft.id)).convertedOrderId!;
      expect(newOrder).not.toBe(oldOrder);
      const newCheckout = await latestCheckout(newOrder);
      expect(Number(newCheckout.amountMinor)).toBe(17250);
      await deliver(
        a,
        completed(
          E('co-mismatch'),
          newCheckout.referenceId as string,
          '120.00',
        ),
      ).expect(201);
      expect((await orderRow(newOrder)).paymentStatus).toBe('unpaid');
      expect((await latestCheckout(newOrder)).status).toBe('review');

      // a payment on the OLD session lands on a cancelled order: never paid,
      // parked for the shop, and the link then refuses to take a second payment
      await deliver(
        a,
        completed(E('co-old'), oldCheckout.referenceId as string, '120.00'),
      ).expect(201);
      expect((await orderRow(oldOrder)).paymentStatus).not.toBe('paid');
      expect((await orderRow(oldOrder)).status).toBe('cancelled');
      expect(
        body<PaySummary>(await paySummary(a, token).expect(200)).state,
      ).toBe('review');
      await pay(a, token).expect(409);
    });

    it('cancelling a draft while the customer is paying cancels its pending order and returns the stock', async () => {
      await db.execute(`UPDATE product SET trackInventory = 1 WHERE id = ?`, [
        a.productId,
      ]);
      const stockOf = async () => {
        const rows = await db.query<RowDataPacket[]>(
          `SELECT s.stockQuantity FROM outletingredientstock s
             JOIN ingredient i ON i.id = s.ingredientId
            WHERE i.shadowProductId = ? AND s.outletId = ?`,
          [a.productId, a.outletId],
        );
        return Number(rows[0]?.stockQuantity ?? 0);
      };
      await request(http())
        .patch('/products/stock/bulk-adjust')
        .set(auth(a))
        .send({
          outletId: a.outletId,
          adjustments: [{ productId: a.productId, delta: 10 }],
        })
        .expect(200);
      // the product's stock is tracked (its shadow ingredient)
      await db.execute(
        `UPDATE ingredient SET trackInventory = 1 WHERE shadowProductId = ?`,
        [a.productId],
      );
      const before = await stockOf();
      const draft = await createDraft(a);
      const { token } = await sendLink(a, draft.id);
      expect(await stockOf()).toBe(before); // a sent link holds nothing
      await pay(a, token).expect(200);
      const orderId = (await getDraft(a, draft.id)).convertedOrderId!;
      expect(await stockOf()).toBe(before - 2); // held like a storefront card checkout
      await request(http())
        .patch(`/shop/draft-orders/${draft.id}/cancel`)
        .set(auth(a))
        .expect(200);
      expect((await orderRow(orderId)).status).toBe('cancelled');
      expect(await stockOf()).toBe(before);
      await db.execute(
        `UPDATE ingredient SET trackInventory = 0 WHERE shadowProductId = ?`,
        [a.productId],
      );
    });

    it('a cancelled draft refuses payment and says so', async () => {
      const draft = await createDraft(a);
      const { token } = await sendLink(a, draft.id);
      await request(http())
        .patch(`/shop/draft-orders/${draft.id}/cancel`)
        .set(auth(a))
        .expect(200);
      expect(
        body<PaySummary>(await paySummary(a, token).expect(200)).state,
      ).toBe('cancelled');
      await pay(a, token).expect(409);
      expect((await getDraft(a, draft.id)).orders).toHaveLength(0);
    });

    it('the card link is refused while the processor’s keys are rejected, and the pay page says card is unavailable', async () => {
      const draft = await createDraft(b);
      const { token } = await sendLink(b, draft.id);
      await db.execute(
        `UPDATE shoppaymentprovider SET credentialStatus = 'rejected', credentialStatusAt = NOW(3)
          WHERE shopId = ? AND provider = 'nomod'`,
        [b.shopId],
      );
      try {
        expect((await getDraft(b, draft.id)).cardAvailable).toBe(false);
        const other = await createDraft(b);
        await request(http())
          .post(`/shop/draft-orders/${other.id}/payment-link`)
          .set(auth(b))
          .expect(403);
        expect(
          body<PaySummary>(await paySummary(b, token).expect(200)).state,
        ).toBe('unavailable');
        await pay(b, token).expect(503);
        expect((await getDraft(b, draft.id)).orders).toHaveLength(0);
        // COD still converts
        await request(http())
          .post(`/shop/draft-orders/${other.id}/cod`)
          .set(auth(b))
          .expect(201);
      } finally {
        await db.execute(
          `UPDATE shoppaymentprovider SET credentialStatus = NULL, credentialStatusAt = NULL
            WHERE shopId = ? AND provider = 'nomod'`,
          [b.shopId],
        );
      }
    });

    it('records audit entries for create, link sent, edit and convert', async () => {
      const draft = await createDraft(a);
      await sendLink(a, draft.id);
      await request(http())
        .patch(`/shop/draft-orders/${draft.id}`)
        .set(auth(a))
        .send({ customerNote: 'Ring twice' })
        .expect(200);
      await request(http())
        .post(`/shop/draft-orders/${draft.id}/cod`)
        .set(auth(a))
        .expect(201);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT action FROM auditlog WHERE shopId = ? AND entityType = 'draft_order' AND entityId = ? ORDER BY id`,
        [a.shopId, draft.id],
      );
      expect(rows.map((r) => r.action as string)).toEqual([
        'draft_order.created',
        'draft_order.link_sent',
        'draft_order.edited',
        'draft_order.converted',
      ]);
      const order = await orderRow(
        (await getDraft(a, draft.id)).convertedOrderId!,
      );
      expect(order.deliveryNotes).toBe('Ring twice');
    });
  });
});
