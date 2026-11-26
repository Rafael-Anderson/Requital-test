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
import { OrdersService } from '../src/orders/orders.service';
import {
  ABANDONED_PAYMENT_HOURS,
  PaymentReconciliationService,
} from '../src/payments/payment-reconciliation.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

// The abandoned card-payment sweep. Nomod's HTTP is a fake (no network): each
// checkout's status is set by the test, and an id in `unreachable` makes the
// GET throw. The sweep is run scoped to one shop, as the cron runs it per row.

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface Draft {
  id: number;
  status: string;
  payLink: { url: string } | null;
  convertedOrderId: number | null;
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
const unreachable = new Set<string>();
let seq = 0;
const fakeClient = {
  createCheckout: jest.fn(
    (
      _c: unknown,
      input: {
        referenceId: string;
        amounts: { amount: string; currency: string };
      },
    ) => {
      seq += 1;
      const id = `chk_ab_${process.pid}_${seq}`;
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
    if (unreachable.has(id)) return Promise.reject(new Error('ECONNRESET'));
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

describe('Abandoned card-payment sweep (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let sweep: PaymentReconciliationService;
  const runId = Date.now();

  interface Shop {
    slug: string;
    token: string;
    shopId: number;
    outletId: number;
    productId: number;
    secret: string;
    webhookPath: string;
  }
  let a: Shop;
  let b: Shop;

  const http = () => app.getHttpServer();
  const auth = (s: Shop) => ({ Authorization: `Bearer ${s.token}` });

  async function setupShop(prefix: string): Promise<Shop> {
    const slug = `ab-${prefix}-${runId}`;
    const signup = await request(http())
      .post('/auth/signup')
      .send({
        name: 'Sweep Admin',
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
      .send({ active: true, pickupEnabled: true })
      .expect(200);
    // So the merchant alert for a late payment has somewhere to go.
    await db.execute(`UPDATE outlet SET phone = '0501112222' WHERE id = ?`, [
      outletId,
    ]);
    await request(http())
      .patch('/shop')
      .set(h)
      .send({ pickupPaymentCashOnPickup: true, pickupPaymentCardOnline: true })
      .expect(200);
    const collection = await request(http())
      .post('/collections')
      .set(h)
      .send({ name: 'Sweep Goods' })
      .expect(201);
    const product = await request(http())
      .post('/products')
      .set(h)
      .send({
        name: 'Sweep Rose',
        price: 50,
        thumbnail: 'https://example.com/r.jpg',
        sku: `AB-${prefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
        trackInventory: true,
      })
      .expect(201);
    const productId = body<IdRow>(product).id;
    await request(http())
      .patch('/products/stock/bulk-adjust')
      .set(h)
      .send({ outletId, adjustments: [{ productId, delta: 20 }] })
      .expect(200);
    await db.execute(
      `UPDATE ingredient SET trackInventory = 1 WHERE shadowProductId = ?`,
      [productId],
    );
    await request(http())
      .patch('/shop')
      .set(h)
      .send({ published: true })
      .expect(200);
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
    const shopRow = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    return {
      slug,
      token,
      shopId: shopRow[0].id as number,
      outletId,
      productId,
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
    sweep = app.get(PaymentReconciliationService);
    a = await setupShop('a');
    b = await setupShop('b');
  });

  afterAll(async () => {
    // Leave nothing for another suite's unscoped sweep to pick up.
    await db.execute(
      `UPDATE \`order\` o JOIN shop s ON s.id = o.shopId
          SET o.paymentSessionId = NULL, o.paymentSessionGateway = NULL
        WHERE s.subdomain LIKE ?`,
      [`ab-%-${runId}`],
    );
    await app.close();
  });

  const stockOf = async (s: Shop) => {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT st.stockQuantity FROM outletingredientstock st
         JOIN ingredient i ON i.id = st.ingredientId
        WHERE i.shadowProductId = ? AND st.outletId = ?`,
      [s.productId, s.outletId],
    );
    return Number(rows[0]?.stockQuantity ?? 0);
  };
  const orderRow = async (id: number) =>
    (
      await db.query<RowDataPacket[]>(`SELECT * FROM \`order\` WHERE id = ?`, [
        id,
      ])
    )[0];
  // Moves the order's CURRENT session start back past the threshold.
  const age = (orderId: number, hours = ABANDONED_PAYMENT_HOURS + 1) =>
    db.execute(
      `UPDATE \`order\` SET paymentSessionStartedAt = DATE_SUB(NOW(3), INTERVAL ? HOUR) WHERE id = ?`,
      [hours, orderId],
    );
  const setCheckout = async (orderId: number, status: string) => {
    const o = await orderRow(orderId);
    fakeCheckouts.get(o.paymentSessionId as string)!.status = status;
    return o.paymentSessionId as string;
  };

  async function payLinkOrder(s: Shop) {
    const draft = body<Draft>(
      await request(http())
        .post('/shop/draft-orders')
        .set(auth(s))
        .send({
          outletId: s.outletId,
          customerName: 'Sweep Customer',
          customerPhone: '0501239876',
          orderType: 'pickup',
          items: [{ productId: s.productId, quantity: 2 }],
        })
        .expect(201),
    );
    const sent = body<Draft>(
      await request(http())
        .post(`/shop/draft-orders/${draft.id}/payment-link`)
        .set(auth(s))
        .expect(201),
    );
    const token = sent.payLink!.url.split('/pay/')[1];
    await request(http())
      .post(`/public/${s.slug}/custom-orders/pay/${token}/session`)
      .expect(200);
    const d = body<Draft>(
      await request(http())
        .get(`/shop/draft-orders/${draft.id}`)
        .set(auth(s))
        .expect(200),
    );
    return { draftId: draft.id, token, orderId: d.convertedOrderId! };
  }

  async function storefrontCardOrder(s: Shop) {
    const res = await request(http())
      .post(`/public/${s.slug}/orders`)
      .send({
        outletId: s.outletId,
        orderType: 'pickup',
        paymentMethod: 'card_online',
        customerName: 'Storefront Sweep',
        customerPhone: '0507654321',
        customerAddress: 'Pickup',
        items: [{ productId: s.productId, quantity: 1 }],
      });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return body<{ order: { id: number } }>(res).order.id;
  }

  function deliverPaid(s: Shop, referenceId: string, total: string) {
    const eventId = `evt_${randomUUID()}`;
    const raw = JSON.stringify({
      type: 'charge.completed',
      eventId,
      objectId: `chg_${eventId}`,
      data: { total, currency: 'AED', status: 'paid', referenceId },
    });
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

  it('an unpaid pay-link order past the threshold is cancelled, its stock released, and the same link works again', async () => {
    const before = await stockOf(a);
    const { draftId, token, orderId } = await payLinkOrder(a);
    expect(await stockOf(a)).toBe(before - 2);
    await setCheckout(orderId, 'created'); // Nomod: still not paid
    // A fresh session is never touched.
    expect(
      (await sweep.runAbandonedSweep({ shopId: a.shopId })).cancelled,
    ).toBe(0);
    expect((await orderRow(orderId)).status).toBe('pending');

    await age(orderId);
    const res = await sweep.runAbandonedSweep({ shopId: a.shopId });
    expect(res.cancelled).toBe(1);
    const o = await orderRow(orderId);
    expect(o.status).toBe('cancelled');
    expect(o.paymentStatus).toBe('unpaid');
    expect(o.paymentAbandonedAt).not.toBeNull();
    expect(await stockOf(a)).toBe(before);
    // Audit row says why, and no email was queued to the customer.
    const audit = await db.query<RowDataPacket[]>(
      `SELECT metadata, actorLabel FROM auditlog WHERE shopId = ? AND entityType = 'order' AND entityId = ? AND action = 'order.status_changed'`,
      [a.shopId, orderId],
    );
    expect(audit.map((r) => r.actorLabel)).toContain(
      'system (payment not completed)',
    );
    expect(JSON.stringify(audit.map((r) => r.metadata))).toContain(
      'payment not completed',
    );

    // The draft is back to "link sent" at once, and the same link pays again.
    const draftRow = await db.query<RowDataPacket[]>(
      `SELECT status FROM draftorder WHERE id = ?`,
      [draftId],
    );
    expect(draftRow[0].status).toBe('INVOICE_SENT');
    const summary = await request(http())
      .get(`/public/${a.slug}/custom-orders/pay/${token}`)
      .expect(200);
    expect((summary.body as { state: string }).state).toBe('payable');
    await request(http())
      .post(`/public/${a.slug}/custom-orders/pay/${token}/session`)
      .expect(200);
    const again = await db.query<RowDataPacket[]>(
      `SELECT convertedOrderId, status FROM draftorder WHERE id = ?`,
      [draftId],
    );
    expect(again[0].status).toBe('AWAITING_PAYMENT');
    expect(again[0].convertedOrderId).not.toBe(orderId);

    // Running again changes nothing (idempotent).
    expect(
      (await sweep.runAbandonedSweep({ shopId: a.shopId })).cancelled,
    ).toBe(0);
  });

  it('a storefront card order the provider says is paid is marked paid, not cancelled', async () => {
    const orderId = await storefrontCardOrder(a);
    const stockHeld = await stockOf(a);
    await setCheckout(orderId, 'paid');
    await age(orderId);
    const res = await sweep.runAbandonedSweep({ shopId: a.shopId });
    expect(res.paid).toBe(1);
    expect(res.cancelled).toBe(0);
    const o = await orderRow(orderId);
    expect(o.paymentStatus).toBe('paid');
    expect(o.status).not.toBe('cancelled');
    expect(o.paymentAbandonedAt).toBeNull();
    expect(await stockOf(a)).toBe(stockHeld);
  });

  it('a provider that cannot be reached is skipped, never cancelled', async () => {
    const orderId = await storefrontCardOrder(a);
    const sessionId = await setCheckout(orderId, 'created');
    unreachable.add(sessionId);
    await age(orderId);
    const res = await sweep.runAbandonedSweep({ shopId: a.shopId });
    expect(res.cancelled).toBe(0);
    expect(res.skipped).toBeGreaterThanOrEqual(1);
    expect((await orderRow(orderId)).status).toBe('pending');
    unreachable.delete(sessionId);
    expect(
      (await sweep.runAbandonedSweep({ shopId: a.shopId })).cancelled,
    ).toBe(1);
    expect((await orderRow(orderId)).status).toBe('cancelled');
  });

  it('an order whose session start is unknown (pre-column) is cancelled only on a definite "expired"', async () => {
    const orderId = await storefrontCardOrder(a);
    await setCheckout(orderId, 'created');
    await db.execute(
      `UPDATE \`order\` SET paymentSessionStartedAt = NULL, paymentSessionAt = NULL,
              createdAt = DATE_SUB(NOW(3), INTERVAL 3 DAY) WHERE id = ?`,
      [orderId],
    );
    expect(
      (await sweep.runAbandonedSweep({ shopId: a.shopId })).cancelled,
    ).toBe(0);
    expect((await orderRow(orderId)).status).toBe('pending');
    await setCheckout(orderId, 'expired');
    expect(
      (await sweep.runAbandonedSweep({ shopId: a.shopId })).cancelled,
    ).toBe(1);
    expect((await orderRow(orderId)).status).toBe('cancelled');
  });

  it('a payment that arrives after the sweep cancelled the order is parked and alerted, never reopened, and the link refuses a second payment', async () => {
    const { token, orderId } = await payLinkOrder(a);
    await setCheckout(orderId, 'created');
    await age(orderId);
    expect(
      (await sweep.runAbandonedSweep({ shopId: a.shopId })).cancelled,
    ).toBe(1);

    // The customer completes the OLD session after all.
    const sessionId = await setCheckout(orderId, 'paid');
    const checkout = await db.query<RowDataPacket[]>(
      `SELECT referenceId FROM nomodcheckout WHERE checkoutId = ?`,
      [sessionId],
    );
    await deliverPaid(
      a,
      checkout[0].referenceId as string,
      fakeCheckouts.get(sessionId)!.amount,
    ).expect((r) => expect(r.status).toBeLessThan(300));

    const o = await orderRow(orderId);
    expect(o.status).toBe('cancelled');
    expect(o.paymentStatus).toBe('unpaid');
    const txns = await db.query<RowDataPacket[]>(
      `SELECT status FROM paymenttransaction WHERE orderId = ?`,
      [orderId],
    );
    expect(txns.map((t) => t.status)).toContain('paid');
    const jobs = await db.query<RowDataPacket[]>(
      `SELECT payload FROM job WHERE idempotencyKey = ?`,
      [`order:${orderId}:late-payment`],
    );
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as { body: string }).body).toMatch(
      /Fulfil it or refund it/,
    );

    const summary = await request(http())
      .get(`/public/${a.slug}/custom-orders/pay/${token}`)
      .expect(200);
    expect((summary.body as { state: string }).state).toBe('review');
    await request(http())
      .post(`/public/${a.slug}/custom-orders/pay/${token}/session`)
      .expect(409);
  });

  it("a sweep of shop A never touches shop B's order", async () => {
    const orderB = await storefrontCardOrder(b);
    await setCheckout(orderB, 'created');
    await age(orderB);
    await sweep.runAbandonedSweep({ shopId: a.shopId });
    expect((await orderRow(orderB)).status).toBe('pending');
    expect(
      (await sweep.runAbandonedSweep({ shopId: b.shopId })).cancelled,
    ).toBe(1);
    expect((await orderRow(orderB)).status).toBe('cancelled');
  });

  it('a session minted after the provider was asked is not cancelled (the cancel is pinned to the session asked about)', async () => {
    const orderId = await storefrontCardOrder(a);
    await setCheckout(orderId, 'created');
    await age(orderId);
    const ordersSvc = app.get(OrdersService);
    expect(
      await ordersSvc.cancelAbandonedPayment(
        a.shopId,
        orderId,
        'a-different-session',
        'nomod',
      ),
    ).toBe(false);
    expect((await orderRow(orderId)).status).toBe('pending');
  });
});
