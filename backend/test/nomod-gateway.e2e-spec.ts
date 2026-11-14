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
import { NomodPaymentService } from '../src/payments/nomod/nomod-payment.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface OrderResponse {
  order: { id: number; trackingToken: string; total: string };
  checkoutUrl: string | null;
}
interface ProviderRow {
  provider: string;
  enabled: boolean;
  webhookPath?: string | null;
  maskedCredentials: Record<string, string> | null;
}

interface CheckoutRow {
  id: number;
  orderId: number;
  referenceId: string;
  checkoutId: string;
  amountMinor: string | number;
  status: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(180000);

// Nomod's HTTP layer is replaced by a fake: no test here ever contacts Nomod.
interface FakeCheckout {
  status: string;
  amount: string;
  currency: string;
}
const fakeCheckouts = new Map<string, FakeCheckout>();
let checkoutSeq = 0;
const fakeClient = {
  createCheckout: jest.fn(
    (
      _creds: unknown,
      input: {
        referenceId: string;
        amounts: { amount: string; currency: string };
      },
    ) => {
      checkoutSeq += 1;
      const id = `chk_e2e_${process.pid}_${checkoutSeq}`;
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
  getCheckout: jest.fn((_creds: unknown, id: string) => {
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
  testConnection: jest.fn().mockResolvedValue({ ok: true, message: 'ok' }),
};

describe('Nomod gateway (e2e, Nomod HTTP faked)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  // Event ids are unique per run: paymenttransaction's unique index is global.
  const E = (name: string) => `${name}-${runId}`;

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
  });

  afterAll(async () => {
    // Leave nothing for the reconciliation sweep: it looks at every shop's unpaid
    // orders that hold a session id.
    await db.execute(
      `UPDATE \`order\` o JOIN shop s ON s.id = o.shopId
          SET o.paymentSessionId = NULL, o.paymentSessionGateway = NULL
        WHERE s.subdomain LIKE ?`,
      [`nm-%-${runId}`],
    );
    await app.close();
  });

  beforeEach(() => {
    fakeClient.createCheckout.mockClear();
    fakeClient.getCheckout.mockClear();
    fakeClient.refund.mockReset();
  });

  interface Shop {
    adminToken: string;
    outletId: number;
    productId: number;
    shopId: number;
    slug: string;
    secret: string;
    webhookPath: string | null;
  }

  async function setupShop(prefix: string): Promise<Shop> {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Nomod Admin',
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
      .send({ active: true, pickupEnabled: true })
      .expect(200);
    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nomod Collection' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Nomod Rose',
        price: 50,
        thumbnail: 'https://example.com/r.jpg',
        sku: `NM-${prefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);
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
      secret: `whsec_${randomBytes(24).toString('base64')}`,
      webhookPath: null,
    };
  }

  const grant = (shopId: number, enabled = 1) =>
    db.execute(
      `INSERT INTO shopfeatureoverride (shopId, featureKey, enabled) VALUES (?, 'nomod_payments', ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
      [shopId, enabled],
    );

  // Granted by the platform, keyed by the merchant, switched on.
  async function enableNomod(shop: Shop) {
    await grant(shop.shopId);
    await request(app.getHttpServer())
      .patch('/payment-settings/stripe')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ enabled: false })
      .expect(200);
    const res = await request(app.getHttpServer())
      .patch('/payment-settings/nomod')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        enabled: true,
        credentials: { apiKey: `key-${shop.slug}`, webhookSecret: shop.secret },
      })
      .expect(200);
    shop.webhookPath =
      body<ProviderRow[]>(res).find((r) => r.provider === 'nomod')
        ?.webhookPath ?? null;
    expect(shop.webhookPath).toMatch(
      /^\/payments\/webhook\/nomod\/[0-9a-f]{64}$/,
    );
  }

  function placeOrder(shop: Shop) {
    return request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'Nomod Customer',
        customerPhone: '0501234567',
        customerAddress: 'Pickup at outlet',
        orderType: 'pickup',
        paymentMethod: 'card_online',
        items: [{ productId: shop.productId, quantity: 1 }],
      });
  }

  async function placedOrder(shop: Shop) {
    const res = await placeOrder(shop).expect(201);
    const r = body<OrderResponse>(res);
    const checkout = await db.query<RowDataPacket[]>(
      `SELECT * FROM nomodcheckout WHERE orderId = ? ORDER BY id DESC LIMIT 1`,
      [r.order.id],
    );
    return { ...r, row: checkout[0] as unknown as CheckoutRow };
  }

  function sign(
    secret: string,
    id: string,
    ts: number,
    raw: string,
    key?: Buffer,
  ) {
    const k = key ?? Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    return createHmac('sha256', k)
      .update(`${id}.${ts}.${raw}`)
      .digest('base64');
  }

  function deliver(
    path: string,
    secret: string,
    payload: unknown,
    opts: {
      id?: string;
      ts?: number;
      badSig?: boolean;
      header?: 'svix' | 'webhook';
    } = {},
  ) {
    const raw = JSON.stringify(payload);
    const id = opts.id ?? `msg_${randomUUID()}`;
    const ts = opts.ts ?? Math.floor(Date.now() / 1000);
    const sig = opts.badSig ? 'AAAA' : sign(secret, id, ts, raw);
    const prefix = opts.header === 'webhook' ? 'webhook' : 'svix';
    return request(app.getHttpServer())
      .post(path)
      .set('Content-Type', 'application/json')
      .set(`${prefix}-id`, id)
      .set(`${prefix}-timestamp`, String(ts))
      .set(`${prefix}-signature`, `v1,${sig}`)
      .send(raw);
  }

  const completed = (
    eventId: string,
    referenceId: string,
    total: string,
    currency = 'AED',
  ) => ({
    type: 'charge.completed',
    eventId,
    objectId: `chg_${eventId}`,
    data: { total, currency, status: 'paid', referenceId },
  });

  async function orderState(orderId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT status, paymentStatus FROM \`order\` WHERE id = ?`,
      [orderId],
    );
    return rows[0];
  }
  async function txCount(orderId: number, status?: string) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM paymenttransaction WHERE orderId = ? AND gateway = 'nomod' ${
        status ? "AND status = '" + status + "'" : ''
      }`,
      [orderId],
    );
    return Number(rows[0].n);
  }

  describe('off by default', () => {
    it('a shop with no override is granted Nomod (platform-wide grant) but has it OFF and Stripe untouched', async () => {
      const shop = await setupShop('nm-default');
      const settings = await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const rows = body<(ProviderRow & { available?: boolean })[]>(settings);
      const nomod = rows.find((r) => r.provider === 'nomod')!;
      expect(nomod.available).toBe(true);
      expect(nomod.enabled).toBe(false);
      const pub = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      expect(
        body<{ cardProcessor: string | null }>(pub).cardProcessor,
      ).not.toBe('nomod');
    });

    it('cannot be enabled when the platform revokes the grant for the shop, and is never offered', async () => {
      const shop = await setupShop('nm-off');
      await grant(shop.shopId, 0);
      const res = await request(app.getHttpServer())
        .patch('/payment-settings/nomod')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          enabled: true,
          credentials: { apiKey: 'k', webhookSecret: 'whsec_x' },
        })
        .expect(403);
      expect(JSON.stringify(res.body)).toContain('not available');

      const settings = await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const nomod = body<(ProviderRow & { available?: boolean })[]>(
        settings,
      ).find((r) => r.provider === 'nomod')!;
      expect(nomod.enabled).toBe(false);
      expect(nomod.available).toBe(false);

      const pub = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      expect(
        body<{ cardProcessor: string | null }>(pub).cardProcessor,
      ).not.toBe('nomod');
    });

    it('a granted shop still has Nomod OFF until the merchant turns it on', async () => {
      const shop = await setupShop('nm-granted');
      await grant(shop.shopId);
      const settings = await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const nomod = body<ProviderRow[]>(settings).find(
        (r) => r.provider === 'nomod',
      )!;
      expect(nomod.enabled).toBe(false);
    });

    it('enabling needs BOTH the API key and the signing secret', async () => {
      const shop = await setupShop('nm-halfkeys');
      await grant(shop.shopId);
      await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: false })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/payment-settings/nomod')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: true, credentials: { apiKey: 'only-a-key' } })
        .expect(400);
    });
  });

  describe('write-only credentials', () => {
    it('no API ever returns the key or the signing secret', async () => {
      const shop = await setupShop('nm-secrets');
      await enableNomod(shop);
      const responses = [
        await request(app.getHttpServer())
          .get('/payment-settings')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
        await request(app.getHttpServer())
          .post('/payment-settings/nomod/test-connection')
          .set('Authorization', `Bearer ${shop.adminToken}`),
        await request(app.getHttpServer())
          .post('/payment-settings/nomod/webhook-url')
          .set('Authorization', `Bearer ${shop.adminToken}`),
        await request(app.getHttpServer())
          .get('/payment-settings/nomod/pending')
          .set('Authorization', `Bearer ${shop.adminToken}`),
      ];
      for (const res of responses) {
        const text = JSON.stringify(res.body);
        expect(text).not.toContain(`key-${shop.slug}`);
        expect(text).not.toContain(shop.secret);
        expect(text).not.toContain(shop.secret.replace('whsec_', ''));
      }
      const nomod = body<ProviderRow[]>(responses[0]).find(
        (r) => r.provider === 'nomod',
      )!;
      expect(nomod.maskedCredentials?.apiKey).toMatch(/^••••/);
      expect(nomod.maskedCredentials?.webhookSecret).toMatch(/^••••/);
    });

    it('saving one setting does not wipe the saved secrets', async () => {
      const shop = await setupShop('nm-merge');
      await enableNomod(shop);
      const res = await request(app.getHttpServer())
        .patch('/payment-settings/nomod')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ credentials: { allowPartialRefunds: 'true' } })
        .expect(200);
      const nomod = body<
        (ProviderRow & { publicValues?: Record<string, string> })[]
      >(res).find((r) => r.provider === 'nomod')!;
      expect(nomod.maskedCredentials?.apiKey).toBeDefined();
      expect(nomod.maskedCredentials?.webhookSecret).toBeDefined();
      expect(nomod.publicValues?.allowPartialRefunds).toBe('true');
      expect(JSON.stringify(nomod.publicValues)).not.toContain('key-');
    });

    it('refuses a base URL outside the allow-list', async () => {
      const shop = await setupShop('nm-baseurl');
      await enableNomod(shop);
      for (const baseUrl of [
        'https://evil.example.com',
        'http://api.nomod.com',
        'https://169.254.169.254',
      ]) {
        await request(app.getHttpServer())
          .patch('/payment-settings/nomod')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ credentials: { baseUrl } })
          .expect(400);
      }
      await request(app.getHttpServer())
        .patch('/payment-settings/nomod')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ credentials: { baseUrl: 'https://api.nomod.dev' } })
        .expect(200);
    });
  });

  describe('checkout', () => {
    it('creates a pending order and a Nomod checkout whose amount reconciles', async () => {
      const shop = await setupShop('nm-checkout');
      await enableNomod(shop);
      const { order, checkoutUrl, row } = await placedOrder(shop);

      expect(checkoutUrl).toMatch(/^https:\/\/pay\.nomod\.test\/chk_e2e_/);
      expect(await orderState(order.id)).toMatchObject({
        status: 'pending',
        paymentStatus: 'unpaid',
      });
      expect(fakeClient.createCheckout).toHaveBeenCalledTimes(1);
      const [, input] = fakeClient.createCheckout.mock.calls[0] as unknown as [
        unknown,
        {
          referenceId: string;
          amounts: {
            amount: string;
            currency: string;
            items: { total_amount: string }[];
            discount?: string;
          };
          successUrl: string;
          failureUrl: string;
          cancelledUrl: string;
        },
      ];
      expect(input.referenceId).toBe(String(order.id));
      expect(input.amounts.currency).toBe('AED');
      // Nomod's own invariant: amount = sum(items) - discount.
      const sum = input.amounts.items.reduce(
        (s, i) => s + Math.round(Number(i.total_amount) * 100),
        0,
      );
      const discount = input.amounts.discount
        ? Math.round(Number(input.amounts.discount) * 100)
        : 0;
      expect(sum - discount).toBe(
        Math.round(Number(input.amounts.amount) * 100),
      );
      expect(Number(input.amounts.amount)).toBe(Number(order.total));
      expect(input.successUrl).toContain(`/orders/${order.trackingToken}`);
      expect(input.failureUrl).toContain('payment=failed');
      expect(input.cancelledUrl).toContain('payment=cancelled');
      expect(row).toMatchObject({
        shopId: shop.shopId,
        referenceId: String(order.id),
        status: 'created',
        currency: 'AED',
      });
      expect(Number(row.amountMinor)).toBe(
        Math.round(Number(order.total) * 100),
      );
    });

    it('a retry after a failed checkout gets a fresh reference', async () => {
      const shop = await setupShop('nm-retry');
      await enableNomod(shop);
      const { order } = await placedOrder(shop);
      const service = app.get(NomodPaymentService);
      const params = {
        shopId: shop.shopId,
        orderId: order.id,
        orderNumber: 1,
        amount: Number(order.total),
        currency: 'AED',
        successUrl: 'https://x.test/s',
        cancelUrl: 'https://x.test/c?orderId=1',
        credentials: { apiKey: 'k', webhookSecret: 'whsec_x' },
      };
      await service.createCheckout(params);
      const refs = await db.query<RowDataPacket[]>(
        `SELECT referenceId, attempt FROM nomodcheckout WHERE orderId = ? ORDER BY attempt`,
        [order.id],
      );
      expect(refs.map((r) => r.referenceId as string)).toEqual([
        String(order.id),
        `${order.id}-2`,
      ]);
    });

    it('refuses to create a checkout when the platform grant is off', async () => {
      const shop = await setupShop('nm-flagoff');
      await enableNomod(shop);
      const { order } = await placedOrder(shop);
      await grant(shop.shopId, 0);
      fakeClient.createCheckout.mockClear();
      const service = app.get(NomodPaymentService);
      await expect(
        service.createCheckout({
          shopId: shop.shopId,
          orderId: order.id,
          orderNumber: 1,
          amount: Number(order.total),
          currency: 'AED',
          successUrl: 'https://x.test/s',
          cancelUrl: 'https://x.test/c?orderId=1',
          credentials: { apiKey: 'k', webhookSecret: 'whsec_x' },
        }),
      ).rejects.toThrow(/not configured|Nomod/i);
      expect(fakeClient.createCheckout).not.toHaveBeenCalled();
    });
  });

  describe('webhook', () => {
    it('charge.completed marks the order paid and confirmed, once', async () => {
      const shop = await setupShop('nm-paid');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      const evt = completed(E('evt-paid-1'), row.referenceId, '50.00');

      await deliver(shop.webhookPath!, shop.secret, evt).expect(201);
      expect(await orderState(order.id)).toMatchObject({
        status: 'confirmed',
        paymentStatus: 'paid',
      });
      expect(await txCount(order.id, 'paid')).toBe(1);
      const stored = await db.query<RowDataPacket[]>(
        `SELECT status, chargeId FROM nomodcheckout WHERE id = ?`,
        [row.id],
      );
      expect(stored[0].status).toBe('paid');
      expect(stored[0].chargeId).toBe(`chg_${E('evt-paid-1')}`);
      const txRows = await db.query<RowDataPacket[]>(
        `SELECT providerChargeReference FROM paymenttransaction WHERE orderId = ? AND gateway = 'nomod'`,
        [order.id],
      );
      expect(txRows[0].providerChargeReference).toBe(row.checkoutId);
    });

    it('accepts the webhook-* header names too', async () => {
      const shop = await setupShop('nm-hdr');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      await deliver(
        shop.webhookPath!,
        shop.secret,
        completed(E('evt-hdr-1'), row.referenceId, '50.00'),
        { header: 'webhook' },
      ).expect(201);
      expect((await orderState(order.id)).paymentStatus).toBe('paid');
    });

    it('a duplicate eventId changes nothing', async () => {
      const shop = await setupShop('nm-dup');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      const evt = completed(E('evt-dup-1'), row.referenceId, '50.00');
      await deliver(shop.webhookPath!, shop.secret, evt).expect(201);
      await deliver(shop.webhookPath!, shop.secret, evt).expect(201);
      await deliver(shop.webhookPath!, shop.secret, evt).expect(201);
      expect(await txCount(order.id)).toBe(1);
      const events = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM nomodwebhookevent WHERE shopId = ? AND eventId = ?`,
        [shop.shopId, E('evt-dup-1')],
      );
      expect(Number(events[0].n)).toBe(1);
    });

    it('charge.completed delivered twice under DIFFERENT event ids still pays once', async () => {
      const shop = await setupShop('nm-twice');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      await deliver(
        shop.webhookPath!,
        shop.secret,
        completed(E('evt-a'), row.referenceId, '50.00'),
      ).expect(201);
      await deliver(
        shop.webhookPath!,
        shop.secret,
        completed(E('evt-b'), row.referenceId, '50.00'),
      ).expect(201);
      expect(await txCount(order.id, 'paid')).toBe(1);
      expect((await orderState(order.id)).paymentStatus).toBe('paid');
    });

    it('an amount mismatch is NOT marked paid and is parked for review', async () => {
      const shop = await setupShop('nm-mismatch');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      await deliver(
        shop.webhookPath!,
        shop.secret,
        completed(E('evt-mm-1'), row.referenceId, '49.99'),
      ).expect(201);
      expect(await orderState(order.id)).toMatchObject({
        status: 'pending',
        paymentStatus: 'unpaid',
      });
      const stored = await db.query<RowDataPacket[]>(
        `SELECT status, reviewReason FROM nomodcheckout WHERE id = ?`,
        [row.id],
      );
      expect(stored[0]).toMatchObject({
        status: 'review',
        reviewReason: 'amount_mismatch',
      });
      expect(await txCount(order.id, 'paid')).toBe(0);
    });

    it('a currency mismatch is NOT marked paid', async () => {
      const shop = await setupShop('nm-curmm');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      await deliver(
        shop.webhookPath!,
        shop.secret,
        completed(E('evt-cm-1'), row.referenceId, '50.00', 'USD'),
      ).expect(201);
      expect((await orderState(order.id)).paymentStatus).toBe('unpaid');
    });

    it('charge.failed and charge.cancelled are recorded and leave the order unpaid', async () => {
      const shop = await setupShop('nm-failed');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      for (const [type, eventId] of [
        ['charge.failed', E('evt-f-1')],
        ['charge.cancelled', E('evt-c-1')],
      ]) {
        await deliver(shop.webhookPath!, shop.secret, {
          type,
          eventId,
          objectId: `chg_${eventId}`,
          data: {
            referenceId: row.referenceId,
            currency: 'AED',
            total: '50.00',
          },
        }).expect(201);
      }
      expect(await orderState(order.id)).toMatchObject({
        status: 'pending',
        paymentStatus: 'unpaid',
      });
      expect(await txCount(order.id, 'failed')).toBe(2);
      const lookup = await request(app.getHttpServer())
        .get(`/public/orders/lookup?token=${order.trackingToken}`)
        .expect(200);
      expect(body<{ paymentFailed: boolean }>(lookup).paymentFailed).toBe(true);
    });

    it('a failure event after the order is paid never undoes it', async () => {
      const shop = await setupShop('nm-stale');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      await deliver(
        shop.webhookPath!,
        shop.secret,
        completed(E('evt-s-1'), row.referenceId, '50.00'),
      ).expect(201);
      await deliver(shop.webhookPath!, shop.secret, {
        type: 'charge.failed',
        eventId: E('evt-s-2'),
        data: { referenceId: row.referenceId },
      }).expect(201);
      expect((await orderState(order.id)).paymentStatus).toBe('paid');
    });

    it('refund events record the total and settle a pending refund; unknown events are ignored', async () => {
      const shop = await setupShop('nm-refevt');
      await enableNomod(shop);
      const { row } = await placedOrder(shop);
      await deliver(shop.webhookPath!, shop.secret, {
        type: 'charge.partially_refunded',
        eventId: E('evt-r-1'),
        data: {
          referenceId: row.referenceId,
          currency: 'AED',
          total: '50.00',
          refundTotal: '20.00',
        },
      }).expect(201);
      let stored = await db.query<RowDataPacket[]>(
        `SELECT refundedMinor FROM nomodcheckout WHERE id = ?`,
        [row.id],
      );
      expect(Number(stored[0].refundedMinor)).toBe(2000);
      // an older event arriving late never lowers it
      await deliver(shop.webhookPath!, shop.secret, {
        type: 'charge.refunded',
        eventId: E('evt-r-0'),
        data: {
          referenceId: row.referenceId,
          currency: 'AED',
          refundTotal: '10.00',
        },
      }).expect(201);
      stored = await db.query<RowDataPacket[]>(
        `SELECT refundedMinor FROM nomodcheckout WHERE id = ?`,
        [row.id],
      );
      expect(Number(stored[0].refundedMinor)).toBe(2000);

      await deliver(shop.webhookPath!, shop.secret, {
        type: 'charge.something_new',
        eventId: E('evt-x-1'),
        data: {},
      }).expect(201);
    });

    it('a dispute flags the checkout', async () => {
      const shop = await setupShop('nm-dispute');
      await enableNomod(shop);
      const { row } = await placedOrder(shop);
      await deliver(shop.webhookPath!, shop.secret, {
        type: 'charge.dispute.created',
        eventId: E('evt-d-1'),
        data: { referenceId: row.referenceId },
      }).expect(201);
      const stored = await db.query<RowDataPacket[]>(
        `SELECT disputedAt FROM nomodcheckout WHERE id = ?`,
        [row.id],
      );
      expect(stored[0].disputedAt).not.toBeNull();
      const pending = await request(app.getHttpServer())
        .get('/payment-settings/nomod/pending')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(
        body<{ orderId: number; disputed: boolean }[]>(pending).some(
          (p) => p.orderId === row.orderId && p.disputed,
        ),
      ).toBe(true);
    });
  });

  describe('webhook authentication', () => {
    it('rejects a bad signature, a tampered body and an old timestamp', async () => {
      const shop = await setupShop('nm-auth');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      const evt = completed(E('evt-au-1'), row.referenceId, '50.00');

      await deliver(shop.webhookPath!, shop.secret, evt, {
        badSig: true,
      }).expect(401);
      await deliver(shop.webhookPath!, shop.secret, evt, {
        ts: Math.floor(Date.now() / 1000) - 600,
      }).expect(401);

      // signed for one body, sent with another
      const raw = JSON.stringify(evt);
      const id = 'msg_tamper';
      const ts = Math.floor(Date.now() / 1000);
      await request(app.getHttpServer())
        .post(shop.webhookPath!)
        .set('Content-Type', 'application/json')
        .set('svix-id', id)
        .set('svix-timestamp', String(ts))
        .set('svix-signature', `v1,${sign(shop.secret, id, ts, raw)}`)
        .send(JSON.stringify({ ...evt, data: { ...evt.data, total: '1.00' } }))
        .expect(401);

      expect((await orderState(order.id)).paymentStatus).toBe('unpaid');
    });

    it('accepts any one of several v1 signatures (secret rotation)', async () => {
      const shop = await setupShop('nm-rotate');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      const evt = completed(E('evt-ro-1'), row.referenceId, '50.00');
      const raw = JSON.stringify(evt);
      const id = 'msg_rot';
      const ts = Math.floor(Date.now() / 1000);
      const old = sign(
        'x',
        id,
        ts,
        raw,
        Buffer.from('an-old-rotated-signing-key-123'),
      );
      await request(app.getHttpServer())
        .post(shop.webhookPath!)
        .set('Content-Type', 'application/json')
        .set('svix-id', id)
        .set('svix-timestamp', String(ts))
        .set('svix-signature', `v1,${old} v1,${sign(shop.secret, id, ts, raw)}`)
        .send(raw)
        .expect(201);
      expect((await orderState(order.id)).paymentStatus).toBe('paid');
    });

    it('an unknown or malformed token is a uniform 404', async () => {
      const shop = await setupShop('nm-token');
      await enableNomod(shop);
      for (const token of [
        'a'.repeat(64),
        'short',
        '../../etc/passwd',
        'A'.repeat(64),
        '0'.repeat(63),
      ]) {
        await deliver(
          `/payments/webhook/nomod/${token}`,
          shop.secret,
          completed(E('evt-t'), '1', '1.00'),
        ).expect(404);
      }
    });

    it("shop A's token can never touch shop B's order", async () => {
      const a = await setupShop('nm-scope-a');
      const b = await setupShop('nm-scope-b');
      await enableNomod(a);
      await enableNomod(b);
      const orderB = await placedOrder(b);

      // 1. A delivery for A, signed with A's secret, that names B's reference:
      //    the (shopId, referenceId) lookup finds nothing in A.
      await deliver(
        a.webhookPath!,
        a.secret,
        completed(E('evt-x-1'), orderB.row.referenceId, '50.00'),
      ).expect(201);
      // 2. A delivery on B's token signed with A's secret: signature fails.
      await deliver(
        b.webhookPath!,
        a.secret,
        completed(E('evt-x-2'), orderB.row.referenceId, '50.00'),
      ).expect(401);
      // 3. A delivery on A's token signed with B's secret: signature fails.
      await deliver(
        a.webhookPath!,
        b.secret,
        completed(E('evt-x-3'), orderB.row.referenceId, '50.00'),
      ).expect(401);

      expect(await orderState(orderB.order.id)).toMatchObject({
        status: 'pending',
        paymentStatus: 'unpaid',
      });
      const ghost = await db.query<RowDataPacket[]>(
        `SELECT outcome FROM nomodwebhookevent WHERE shopId = ? AND eventId = ?`,
        [a.shopId, E('evt-x-1')],
      );
      expect(ghost[0].outcome).toBe('unknown_reference');
      // and B's own token still works
      await deliver(
        b.webhookPath!,
        b.secret,
        completed(E('evt-x-4'), orderB.row.referenceId, '50.00'),
      ).expect(201);
      expect((await orderState(orderB.order.id)).paymentStatus).toBe('paid');
    });

    it('a rotated webhook URL stops the old one working', async () => {
      const shop = await setupShop('nm-rotateurl');
      await enableNomod(shop);
      const { row } = await placedOrder(shop);
      const rotated = await request(app.getHttpServer())
        .post('/payment-settings/nomod/webhook-url/rotate')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(201);
      const next = body<{ webhookPath: string }>(rotated).webhookPath;
      expect(next).not.toBe(shop.webhookPath);
      await deliver(
        shop.webhookPath!,
        shop.secret,
        completed(E('evt-ru-1'), row.referenceId, '50.00'),
      ).expect(404);
      await deliver(
        next,
        shop.secret,
        completed(E('evt-ru-2'), row.referenceId, '50.00'),
      ).expect(201);
    });

    it('responds with a processable error (not 200) when handling fails, then handles the retry', async () => {
      const shop = await setupShop('nm-retryevt');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      const service = app.get(NomodPaymentService);
      const spy = jest
        .spyOn(service, 'loadOrderForVerification')
        .mockRejectedValueOnce(new Error('db blip'));
      const evt = completed(E('evt-rt-1'), row.referenceId, '50.00');
      await deliver(shop.webhookPath!, shop.secret, evt).expect(500);
      spy.mockRestore();
      // same eventId, now handled (the first attempt left it unprocessed)
      await deliver(shop.webhookPath!, shop.secret, evt).expect(201);
      expect((await orderState(order.id)).paymentStatus).toBe('paid');
    });
  });

  describe('return page is not proof of payment', () => {
    it('with no webhook, an unpaid order stays unpaid while Nomod says created', async () => {
      const shop = await setupShop('nm-ret-unpaid');
      await enableNomod(shop);
      const { order } = await placedOrder(shop);
      const res = await request(app.getHttpServer())
        .get(
          `/public/orders/lookup?token=${order.trackingToken}&shop=${shop.slug}`,
        )
        .expect(200);
      expect(body<{ paymentStatus: string }>(res).paymentStatus).toBe('unpaid');
    });

    it('with no webhook, the server confirms by GET and the order becomes paid', async () => {
      const shop = await setupShop('nm-ret-paid');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      fakeCheckouts.get(row.checkoutId)!.status = 'paid';
      const res = await request(app.getHttpServer())
        .get(
          `/public/orders/lookup?token=${order.trackingToken}&shop=${shop.slug}`,
        )
        .expect(200);
      expect(body<{ paymentStatus: string }>(res).paymentStatus).toBe('paid');
      expect((await orderState(order.id)).status).toBe('confirmed');
      // and the webhook arriving later changes nothing
      await deliver(
        shop.webhookPath!,
        shop.secret,
        completed(E('evt-late'), row.referenceId, '50.00'),
      ).expect(201);
      expect(await txCount(order.id, 'paid')).toBe(1);
    });

    it('a GET that reports a different amount is not marked paid', async () => {
      const shop = await setupShop('nm-ret-mm');
      await enableNomod(shop);
      const { order, row } = await placedOrder(shop);
      const c = fakeCheckouts.get(row.checkoutId)!;
      c.status = 'paid';
      c.amount = '1.00';
      const res = await request(app.getHttpServer())
        .get(
          `/public/orders/lookup?token=${order.trackingToken}&shop=${shop.slug}`,
        )
        .expect(200);
      expect(body<{ paymentStatus: string }>(res).paymentStatus).toBe('unpaid');
      const stored = await db.query<RowDataPacket[]>(
        `SELECT status FROM nomodcheckout WHERE id = ?`,
        [row.id],
      );
      expect(stored[0].status).toBe('review');
    });

    it('does not hammer Nomod: a second poll inside the interval makes no second call', async () => {
      const shop = await setupShop('nm-ret-rate');
      await enableNomod(shop);
      const { order } = await placedOrder(shop);
      const url = `/public/orders/lookup?token=${order.trackingToken}&shop=${shop.slug}`;
      await request(app.getHttpServer()).get(url).expect(200);
      await request(app.getHttpServer()).get(url).expect(200);
      await request(app.getHttpServer()).get(url).expect(200);
      expect(fakeClient.getCheckout).toHaveBeenCalledTimes(1);
    });

    it('admin recheck confirms a checkout of its own shop only', async () => {
      const a = await setupShop('nm-rc-a');
      const b = await setupShop('nm-rc-b');
      await enableNomod(a);
      await enableNomod(b);
      const orderB = await placedOrder(b);
      fakeCheckouts.get(orderB.row.checkoutId)!.status = 'paid';
      await request(app.getHttpServer())
        .post(`/payment-settings/nomod/pending/${orderB.row.id}/recheck`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(404);
      expect((await orderState(orderB.order.id)).paymentStatus).toBe('unpaid');
      await request(app.getHttpServer())
        .post(`/payment-settings/nomod/pending/${orderB.row.id}/recheck`)
        .set('Authorization', `Bearer ${b.adminToken}`)
        .expect(201);
      expect((await orderState(orderB.order.id)).paymentStatus).toBe('paid');
    });
  });

  describe('refunds through the existing returns flow', () => {
    // A delivered order that was paid through Nomod: made through the admin API,
    // then the Nomod rows a real payment would have left are written directly.
    async function paidDeliveredOrder(shop: Shop, quantity: number) {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          customerName: 'Refund Customer',
          customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
          customerAddress: '1 Test St',
          orderType: 'delivery',
          outletId: shop.outletId,
          items: [{ productId: shop.productId, quantity }],
        })
        .expect(201);
      const orderId = body<{ id: number }>(res).id;
      for (const status of [
        'confirmed',
        'preparing',
        'out_for_delivery',
        'delivered',
      ]) {
        await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ status })
          .expect(200);
      }
      const detail = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const d = body<{ total: string; orderitem: IdRow[] }>(detail);
      const checkoutId = `chk_ref_${runId}_${orderId}`;
      const amount = Number(d.total).toFixed(2);
      fakeCheckouts.set(checkoutId, {
        status: 'paid',
        amount,
        currency: 'AED',
      });
      await db.execute(
        `INSERT INTO paymenttransaction (orderId, gateway, gatewayReference, providerChargeReference, amount, status, currency)
         VALUES (?, 'nomod', ?, ?, ?, 'paid', 'AED')`,
        [
          orderId,
          `nomod:${shop.shopId}:paid:${checkoutId}`,
          checkoutId,
          amount,
        ],
      );
      await db.execute(
        `UPDATE \`order\` SET paymentStatus = 'paid' WHERE id = ?`,
        [orderId],
      );
      return { orderId, itemId: d.orderitem[0].id, total: d.total, checkoutId };
    }

    function returnItems(
      shop: Shop,
      orderId: number,
      itemId: number,
      quantity: number,
    ) {
      return request(app.getHttpServer())
        .post(`/orders/${orderId}/returns`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          reason: 'damaged',
          items: [{ orderItemId: itemId, quantity }],
        });
    }

    it('a full refund goes to Nomod with a deterministic key and is recorded pending', async () => {
      const shop = await setupShop('nm-refund');
      await enableNomod(shop);
      const o = await paidDeliveredOrder(shop, 1);
      fakeClient.refund.mockResolvedValue({
        refundId: 'rf_e2e_1',
        status: 'pending',
      });

      const res = await returnItems(shop, o.orderId, o.itemId, 1).expect(201);
      const ret = body<{
        refundMethod: string;
        providerRefundReference: string;
        providerRefundStatus: string;
        providerRefundKey?: string;
      }>(res);
      expect(ret).toMatchObject({
        refundMethod: 'provider',
        providerRefundReference: 'rf_e2e_1',
        providerRefundStatus: 'pending',
      });
      // the key is internal: never in a response
      expect(ret.providerRefundKey).toBeUndefined();
      expect(fakeClient.refund).toHaveBeenCalledTimes(1);
      const [, id, input] = fakeClient.refund.mock.calls[0] as [
        unknown,
        string,
        { amount: string; idempotencyKey: string },
      ];
      expect(id).toBe(o.checkoutId);
      expect(input.idempotencyKey).toMatch(/^[0-9a-f]{40}$/);
      expect(Number(input.amount)).toBe(Number(o.total));

      // a charge.refunded event settles it
      await db.execute(
        `INSERT INTO nomodcheckout (shopId, orderId, attempt, referenceId, checkoutId, amountMinor, currency, status)
         VALUES (?, ?, 1, ?, ?, ?, 'AED', 'paid')`,
        [
          shop.shopId,
          o.orderId,
          `ref-${o.orderId}`,
          o.checkoutId,
          Math.round(Number(o.total) * 100),
        ],
      );
      await deliver(shop.webhookPath!, shop.secret, {
        type: 'charge.refunded',
        eventId: `evt-ref-${o.orderId}`,
        data: {
          referenceId: `ref-${o.orderId}`,
          currency: 'AED',
          total: o.total,
          refundTotal: Number(o.total).toFixed(2),
        },
      }).expect(201);
      const stored = await db.query<RowDataPacket[]>(
        `SELECT providerRefundStatus FROM orderreturn WHERE orderId = ?`,
        [o.orderId],
      );
      expect(stored[0].providerRefundStatus).toBe('completed');
    });

    it('a failed refund is retryable with the SAME key and cannot double-refund', async () => {
      const shop = await setupShop('nm-refundretry');
      await enableNomod(shop);
      const o = await paidDeliveredOrder(shop, 1);
      fakeClient.refund.mockRejectedValueOnce(new Error('network down'));

      const first = await returnItems(shop, o.orderId, o.itemId, 1).expect(201);
      const ret = body<{
        id: number;
        refundMethod: string;
        providerRefundStatus: string;
      }>(first);
      expect(ret).toMatchObject({
        refundMethod: 'manual',
        providerRefundStatus: 'failed',
      });
      const firstKey = (
        fakeClient.refund.mock.calls[0] as unknown as [
          unknown,
          string,
          { idempotencyKey: string },
        ]
      )[2].idempotencyKey;

      fakeClient.refund.mockResolvedValueOnce({
        refundId: 'rf_e2e_2',
        status: 'pending',
      });
      const retry = await request(app.getHttpServer())
        .post(`/orders/${o.orderId}/returns/${ret.id}/retry-provider-refund`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(201);
      expect(
        body<{ refundMethod: string; providerRefundStatus: string }>(retry),
      ).toMatchObject({
        refundMethod: 'provider',
        providerRefundStatus: 'pending',
      });
      const secondKey = (
        fakeClient.refund.mock.calls[1] as unknown as [
          unknown,
          string,
          { idempotencyKey: string },
        ]
      )[2].idempotencyKey;
      expect(secondKey).toBe(firstKey);

      // once it succeeded there is nothing left to retry
      await request(app.getHttpServer())
        .post(`/orders/${o.orderId}/returns/${ret.id}/retry-provider-refund`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(400);
      expect(fakeClient.refund).toHaveBeenCalledTimes(2);
    });

    it('a PARTIAL refund is not sent to Nomod while partial refunds are off', async () => {
      const shop = await setupShop('nm-partial');
      await enableNomod(shop);
      const o = await paidDeliveredOrder(shop, 2);
      const res = await returnItems(shop, o.orderId, o.itemId, 1).expect(201);
      expect(
        body<{ refundMethod: string; providerRefundStatus: string | null }>(
          res,
        ),
      ).toMatchObject({ refundMethod: 'manual', providerRefundStatus: null });
      expect(fakeClient.refund).not.toHaveBeenCalled();
    });

    it('a PARTIAL refund is sent once the merchant allows it', async () => {
      const shop = await setupShop('nm-partial-on');
      await enableNomod(shop);
      await request(app.getHttpServer())
        .patch('/payment-settings/nomod')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ credentials: { allowPartialRefunds: 'true' } })
        .expect(200);
      const o = await paidDeliveredOrder(shop, 2);
      fakeClient.refund.mockResolvedValue({
        refundId: 'rf_e2e_p',
        status: 'completed',
      });
      const res = await returnItems(shop, o.orderId, o.itemId, 1).expect(201);
      expect(
        body<{ refundMethod: string; providerRefundStatus: string }>(res),
      ).toMatchObject({
        refundMethod: 'provider',
        providerRefundStatus: 'completed',
      });
      expect(fakeClient.refund).toHaveBeenCalledTimes(1);
    });
  });
});
