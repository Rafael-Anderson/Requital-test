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
import { NomodClient } from '../src/payments/nomod/nomod-client';
import { CredentialHealthService } from '../src/payments/credential-health.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

// JOB A (credential safeguards). Nomod's HTTP is replaced by a real NomodClient
// over a fake fetch, so the client's own 401 handling is exercised and nothing
// ever reaches Nomod. A key is "good" or "bad" per the `badKeys` set below.

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface ProviderRow {
  provider: string;
  credentialStatus?: 'rejected' | null;
  credentialStatusAt?: string | null;
  connectionTest?: { ok: boolean; rejected: boolean; message: string };
}
interface PublicShop {
  cardProcessorEnabled: boolean;
  cardProcessor: string | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(180000);

const badKeys = new Set<string>();
let checkoutSeq = 0;
const fakeFetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const key = headers['X-API-KEY'];
  const json = (status: number, payload: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  if (badKeys.has(key)) return json(401, { code: 'not_authenticated' });
  const path = new URL(url instanceof Request ? url.url : url).pathname;
  if (init?.method === 'POST' && path === '/v1/checkout') {
    checkoutSeq += 1;
    const id = `chk_health_${process.pid}_${checkoutSeq}`;
    return json(200, {
      id,
      url: `https://pay.nomod.test/${id}`,
      status: 'created',
    });
  }
  // The test-connection probe asks for a checkout that does not exist.
  return json(404, {});
});

describe('Payment credential safeguards (e2e, Nomod HTTP faked)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  const SECRET = `whsec_${randomBytes(24).toString('base64')}`;

  beforeAll(async () => {
    process.env.PAYMENT_AUTOTEST_IN_TESTS = '1';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(NomodClient)
      .useValue(new NomodClient(fakeFetch, () => Promise.resolve()))
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
    delete process.env.PAYMENT_AUTOTEST_IN_TESTS;
    await db.execute(
      `UPDATE \`order\` o JOIN shop s ON s.id = o.shopId
          SET o.paymentSessionId = NULL, o.paymentSessionGateway = NULL
        WHERE s.subdomain LIKE ?`,
      [`ch-%-${runId}`],
    );
    await app.close();
  });

  interface Shop {
    token: string;
    outletId: number;
    productId: number;
    shopId: number;
    slug: string;
    key: string;
  }

  async function setupShop(prefix: string): Promise<Shop> {
    const slug = `ch-${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Health Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const token = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: true, pickupEnabled: true, whatsapp: '0501234567' })
      .expect(200);
    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Health Collection' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Health Rose',
        price: 50,
        thumbnail: 'https://example.com/r.jpg',
        sku: `CH-${prefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${token}`)
      .send({
        published: true,
        pickupPaymentCashOnPickup: true,
        pickupPaymentCardOnline: true,
      })
      .expect(200);
    const rows = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    return {
      token,
      outletId,
      productId: body<IdRow>(product).id,
      shopId: rows[0].id as number,
      slug,
      key: `nomodkey${prefix}${runId}`,
    };
  }

  async function enableNomod(shop: Shop) {
    await request(app.getHttpServer())
      .patch('/payment-settings/stripe')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({ enabled: false })
      .expect(200);
    const res = await request(app.getHttpServer())
      .patch('/payment-settings/nomod')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({
        enabled: true,
        credentials: { apiKey: shop.key, webhookSecret: SECRET },
      })
      .expect(200);
    return body<ProviderRow[]>(res).find((r) => r.provider === 'nomod')!;
  }

  async function publicShop(shop: Shop) {
    const res = await request(app.getHttpServer())
      .get(`/public/${shop.slug}`)
      .expect(200);
    return body<PublicShop>(res);
  }

  function order(shop: Shop, paymentMethod: string) {
    return request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'Health Customer',
        customerPhone: '0501234567',
        customerAddress: 'Pickup at outlet',
        orderType: 'pickup',
        paymentMethod,
        items: [{ productId: shop.productId, quantity: 1 }],
      });
  }

  async function nomodRow(shop: Shop) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT credentialStatus, credentialStatusAt, credentialAlertedAt
         FROM shoppaymentprovider WHERE shopId = ? AND provider = 'nomod'`,
      [shop.shopId],
    );
    return rows[0];
  }

  async function alertCount(shop: Shop) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM job
        WHERE shopId = ? AND type = 'send_merchant_whatsapp_alert'
          AND idempotencyKey LIKE 'payment-creds:nomod:rejected:%'`,
      [shop.shopId],
    );
    return Number(rows[0].n);
  }

  describe('A1 validation', () => {
    it('refuses a webhook URL pasted into the Nomod API key and secret, per field', async () => {
      const shop = await setupShop('val');
      const res = await request(app.getHttpServer())
        .patch('/payment-settings/nomod')
        .set('Authorization', `Bearer ${shop.token}`)
        .send({
          credentials: {
            apiKey: `https://api.requital.io/payments/webhook/nomod/${'a'.repeat(64)}`,
            webhookSecret: `https://api.requital.io/payments/webhook/nomod/${'a'.repeat(64)}`,
          },
        })
        .expect(400);
      const b = body<{ message: string; fieldErrors: Record<string, string> }>(
        res,
      );
      expect(b.message).toBe(
        'This looks like a webhook URL. Paste the API key from your Nomod dashboard instead.',
      );
      expect(Object.keys(b.fieldErrors).sort()).toEqual([
        'apiKey',
        'webhookSecret',
      ]);
      // Nothing was stored.
      const rows = await db.query<RowDataPacket[]>(
        `SELECT credentials FROM shoppaymentprovider WHERE shopId = ? AND provider = 'nomod'`,
        [shop.shopId],
      );
      expect(rows[0]?.credentials ?? null).toBeNull();
    });

    it('refuses a Stripe publishable key as the secret key', async () => {
      const shop = await setupShop('vals');
      const res = await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${shop.token}`)
        .send({
          credentials: { secretKey: 'pk_live_abc', webhookSecret: 'whsec_a' },
        })
        .expect(400);
      expect(
        body<{ fieldErrors: Record<string, string> }>(res).fieldErrors,
      ).toHaveProperty('secretKey');
    });
  });

  describe('A2 rejected credentials', () => {
    it('saving a key Nomod rejects shows the test result and pauses card payment; COD still works; a good key clears it', async () => {
      const shop = await setupShop('save');
      badKeys.add(shop.key);
      const nomod = await enableNomod(shop);
      expect(nomod.connectionTest).toEqual({
        ok: false,
        rejected: true,
        message: 'Nomod rejected the API key.',
      });
      expect(nomod.credentialStatus).toBe('rejected');
      expect(nomod.credentialStatusAt).toBeTruthy();
      // Saving was not blocked.
      const row = await nomodRow(shop);
      expect(row.credentialStatus).toBe('rejected');
      // The merchant is looking at the answer: no WhatsApp alert for a save.
      expect(await alertCount(shop)).toBe(0);

      expect((await publicShop(shop)).cardProcessorEnabled).toBe(false);
      await order(shop, 'card_online').expect(400);
      await order(shop, 'cash_on_pickup').expect(201);

      // Fixed on Nomod's side: Test connection clears it.
      badKeys.delete(shop.key);
      const test = await request(app.getHttpServer())
        .post('/payment-settings/nomod/test-connection')
        .set('Authorization', `Bearer ${shop.token}`)
        .expect(201);
      expect(body<{ ok: boolean }>(test).ok).toBe(true);
      expect((await nomodRow(shop)).credentialStatus).toBeNull();
      expect((await publicShop(shop)).cardProcessorEnabled).toBe(true);
    });

    it('a 401 at checkout marks the shop rejected, hides card, alerts once; shop B is unaffected', async () => {
      const a = await setupShop('cka');
      const b = await setupShop('ckb');
      await enableNomod(a);
      await enableNomod(b);
      expect((await publicShop(a)).cardProcessorEnabled).toBe(true);

      // The key is revoked on Nomod's side after it was saved.
      badKeys.add(a.key);
      await order(a, 'card_online').expect((r) => {
        expect(r.status).toBeGreaterThanOrEqual(400);
      });
      const row = await nomodRow(a);
      expect(row.credentialStatus).toBe('rejected');
      expect(row.credentialAlertedAt).toBeTruthy();
      expect(await alertCount(a)).toBe(1);

      // Card is no longer offered or accepted; COD still works.
      expect((await publicShop(a)).cardProcessorEnabled).toBe(false);
      await order(a, 'card_online').expect(400);
      await order(a, 'cash_on_pickup').expect(201);

      // A second failure within 24h (the reconciliation path, for example) does
      // not alert again.
      const health = app.get(CredentialHealthService);
      await health.markRejected(a.shopId, 'nomod', { alert: true });
      expect(await alertCount(a)).toBe(1);

      // Shop B never saw any of it.
      expect((await nomodRow(b)).credentialStatus).toBeNull();
      expect((await publicShop(b)).cardProcessorEnabled).toBe(true);
      await order(b, 'card_online').expect(201);

      // Saving new credentials clears the status (and re-tests them).
      a.key = `${a.key}new`;
      const saved = await request(app.getHttpServer())
        .patch('/payment-settings/nomod')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ credentials: { apiKey: a.key } })
        .expect(200);
      const nomod = body<ProviderRow[]>(saved).find(
        (r) => r.provider === 'nomod',
      )!;
      expect(nomod.connectionTest?.ok).toBe(true);
      expect(nomod.credentialStatus).toBeNull();
      expect((await publicShop(a)).cardProcessorEnabled).toBe(true);
    });

    it('the admin settings list reports the status', async () => {
      const shop = await setupShop('list');
      badKeys.add(shop.key);
      await enableNomod(shop);
      const res = await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shop.token}`)
        .expect(200);
      const nomod = body<ProviderRow[]>(res).find(
        (r) => r.provider === 'nomod',
      )!;
      expect(nomod.credentialStatus).toBe('rejected');
      const stripe = body<ProviderRow[]>(res).find(
        (r) => r.provider === 'stripe',
      )!;
      expect(stripe.credentialStatus).toBeNull();
    });
  });
});
