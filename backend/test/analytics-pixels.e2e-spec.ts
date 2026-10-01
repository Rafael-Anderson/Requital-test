import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { PaymentProviderRegistry } from '../src/payments/payment-provider.registry';
import { PaymentReconciliationService } from '../src/payments/payment-reconciliation.service';
import type {
  CheckoutSession,
  CheckoutSessionOutcome,
  CreateCheckoutSessionParams,
  PaymentProvider,
  WebhookResult,
} from '../src/payments/payment-provider.interface';
import { JobsService } from '../src/jobs/jobs.service';
import { JobsWorkerService } from '../src/jobs/jobs.worker.service';
import { MetaCapiClient } from '../src/shop-analytics/meta-capi.client';
import { decrypt } from '../src/common/crypto';
import { CustomerAccountService } from '../src/customer-account/customer-account.service';
import { sha256Hex } from '../src/shop-analytics/meta-capi';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface OrderResponse {
  order: IdRow & Record<string, unknown>;
  checkoutUrl: string | null;
}
interface CapiCall {
  pixelId: string;
  accessToken: string;
  events: Record<string, unknown>[];
  testEventCode?: string | null;
}

interface StoredAttribution {
  consent: { marketing: boolean | null };
  firstTouch: { source: string; gclid?: string; referrer?: string };
  fbp?: string;
}
interface CapiEvent {
  event_name: string;
  event_id: string;
  action_source: string;
  custom_data: { currency: string; value: number };
  user_data: { em: string[]; ph: string[]; fbp: string; fbc: string };
}
interface OrderDetailResponse {
  attribution: unknown;
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(120000);

// Stands in for Stripe: hands back a checkout session, and answers both of the
// payment-outcome paths PaymentsService/PaymentReconciliationService use (the
// webhook parse and the session poll). It only ever reports "paid" for sessions
// THIS suite created, because the sweep it is driven by is not shop-scoped.
class StubStripe implements PaymentProvider {
  readonly name = 'stripe';
  private n = 0;
  createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    this.n += 1;
    return Promise.resolve({
      checkoutUrl: 'https://stub.example/checkout',
      providerReference: `cs_capi_${params.orderId}_${this.n}`,
    });
  }
  parseWebhookEvent(rawBody: Buffer): WebhookResult | null {
    return JSON.parse(rawBody.toString()) as WebhookResult;
  }
  retrieveSessionOutcome(
    sessionId: string,
  ): Promise<CheckoutSessionOutcome | null> {
    return Promise.resolve(
      sessionId.startsWith('cs_capi_')
        ? { status: 'paid', chargeReference: 'pi_capi_recon' }
        : null,
    );
  }
}

const CAPI_TOKEN = 'EAABsbCS1iHgBO' + 'Zz'.repeat(30);
const CONSENTED = {
  consent: { marketing: true },
  firstTouch: {
    source: 'Facebook',
    medium: 'paid_social',
    campaign: 'Spring',
    gclid: 'GCLID-FIRST',
    fbclid: 'FBCLID-FIRST',
    landingPath: '/products/rose',
    referrer: 'https://l.facebook.com/l.php?u=x&secret=1',
  },
  lastTouch: { source: 'facebook', medium: 'paid_social', campaign: 'Spring' },
  fbp: 'fb.1.1700000000000.111',
  fbc: 'fb.1.1700000000000.abc',
  clientUserAgent: 'Mozilla/5.0 (e2e)',
};

describe('Analytics pixels, Meta CAPI and order attribution (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let jobs: JobsService;
  let worker: JobsWorkerService;
  let reconciliation: PaymentReconciliationService;
  const runId = Date.now();
  const capiCalls: CapiCall[] = [];
  const stubMeta = {
    send: jest.fn((p: CapiCall) => {
      capiCalls.push(p);
      return Promise.resolve();
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // No test in this suite ever reaches graph.facebook.com.
      .overrideProvider(MetaCapiClient)
      .useValue(stubMeta)
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
    jobs = app.get(JobsService);
    worker = app.get(JobsWorkerService);
    reconciliation = app.get(PaymentReconciliationService);
    app.get(PaymentProviderRegistry).register(new StubStripe());
  });

  afterAll(async () => {
    // The sweep is platform-wide: do not leave this suite's unpaid sessions
    // behind as candidates for anyone else's run.
    await db.execute(
      `UPDATE \`order\` o JOIN shop s ON s.id = o.shopId
          SET o.paymentSessionId = NULL, o.paymentSessionGateway = NULL
        WHERE s.subdomain LIKE ?`,
      [`pix-%-${runId}`],
    );
    await app.close();
  });

  async function setupShop(prefix: string) {
    const slug = `pix-${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Pixel Admin',
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
      .send({ name: 'Pixel Collection' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Pixel Rose',
        price: 50,
        thumbnail: 'https://example.com/r.jpg',
        sku: `PIX-${prefix}-${runId}`,
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
    };
  }
  type Shop = Awaited<ReturnType<typeof setupShop>>;

  function placeOrder(
    shop: Shop,
    opts: {
      paymentMethod?: string;
      attribution?: unknown;
      email?: string;
    } = {},
  ) {
    return request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'Pixel Customer',
        customerPhone: '0501234567',
        customerEmail: opts.email ?? 'Jane.Doe@Example.com',
        customerAddress: 'Pickup at outlet',
        orderType: 'pickup',
        paymentMethod: opts.paymentMethod ?? 'cash_on_pickup',
        items: [{ productId: shop.productId, quantity: 1 }],
        ...(opts.attribution !== undefined
          ? { attribution: opts.attribution }
          : {}),
      });
  }

  async function configureCapi(shop: Shop, extra: Record<string, unknown> = {}) {
    await request(app.getHttpServer())
      .patch('/analytics-settings')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        metaPixelId: '123456789012345',
        metaCapiToken: CAPI_TOKEN,
        metaTestEventCode: 'TEST4242',
        ...extra,
      })
      .expect(200);
  }

  // Counted by what the job is FOR (type + orderId in its payload), not by the
  // idempotency key, so a regression in the key itself shows up as a second job
  // instead of as a job that merely cannot be found.
  async function jobsFor(orderId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT * FROM job
        WHERE type = 'send_conversion_event'
          AND JSON_EXTRACT(payload, '$.orderId') = ?`,
      [orderId],
    );
    for (const r of rows) {
      expect(r.idempotencyKey).toBe(`capi:purchase:${orderId}`);
    }
    return rows;
  }
  async function runJob(orderId: number) {
    const rows = await jobsFor(orderId);
    expect(rows).toHaveLength(1);
    expect(await worker.processJobById(rows[0].id as number)).toBe(true);
  }
  function orderRow(orderId: number) {
    return db
      .query<RowDataPacket[]>(`SELECT * FROM \`order\` WHERE id = ?`, [orderId])
      .then((r) => r[0]);
  }

  // ---------------------------------------------------------------- settings
  describe('analytics settings', () => {
    it('stores the token encrypted, never returns it, never logs it', async () => {
      const shop = await setupShop('set');
      const patch = await request(app.getHttpServer())
        .patch('/analytics-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          ga4MeasurementId: 'G-ABCD1234',
          metaPixelId: '123456789012345',
          metaCapiToken: CAPI_TOKEN,
          metaTestEventCode: 'TEST4242',
        })
        .expect(200);
      const get = await request(app.getHttpServer())
        .get('/analytics-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);

      for (const res of [patch, get]) {
        expect(JSON.stringify(res.body)).not.toContain(CAPI_TOKEN);
        expect(body<Record<string, unknown>>(res)).toMatchObject({
          ga4MeasurementId: 'G-ABCD1234',
          metaPixelId: '123456789012345',
          metaCapiTokenSet: true,
        });
        // Not even a masked form or a suffix.
        expect(JSON.stringify(res.body)).not.toContain(CAPI_TOKEN.slice(-4));
      }

      const rows = await db.query<RowDataPacket[]>(
        `SELECT metaCapiTokenEnc FROM shopanalytics WHERE shopId = ?`,
        [shop.shopId],
      );
      const stored = rows[0].metaCapiTokenEnc as string;
      expect(stored).not.toContain(CAPI_TOKEN);
      expect(decrypt(stored)).toBe(CAPI_TOKEN);

      // The audit trail names the field, never the value.
      const audit = await db.query<RowDataPacket[]>(
        `SELECT metadata, \`after\`, \`before\` FROM auditlog
          WHERE shopId = ? AND action = 'analytics_settings.updated'`,
        [shop.shopId],
      );
      expect(audit.length).toBeGreaterThan(0);
      expect(JSON.stringify(audit)).not.toContain(CAPI_TOKEN);
      expect(JSON.stringify(audit)).toContain('metaCapiToken');
    });

    it('null clears a field; an absent key leaves it alone', async () => {
      const shop = await setupShop('clr');
      await configureCapi(shop, { tiktokPixelId: 'CABCDEFGHIJKLMNOPQRS' });
      const res = await request(app.getHttpServer())
        .patch('/analytics-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ tiktokPixelId: null, metaCapiToken: null })
        .expect(200);
      expect(body<Record<string, unknown>>(res)).toMatchObject({
        tiktokPixelId: null,
        metaCapiTokenSet: false,
        metaPixelId: '123456789012345',
      });
    });

    it('rejects malformed ids (they end up inside storefront script URLs)', async () => {
      const shop = await setupShop('bad');
      for (const bad of [
        { ga4MeasurementId: '"><script>alert(1)</script>' },
        { metaPixelId: "1'; alert(1);//" },
        { snapPixelId: 'nope' },
        { googleAdsConversionId: 'AW-<x>' },
        { metaCapiToken: 'short' },
        { unknownField: 'x' },
      ]) {
        await request(app.getHttpServer())
          .patch('/analytics-settings')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send(bad)
          .expect(400);
      }
    });

    it('is admin only', async () => {
      const shop = await setupShop('role');
      const mk = async (role: string) => {
        const email = `pix-${role}-${runId}@test.com`;
        await request(app.getHttpServer())
          .post('/auth/branch-users')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ name: role, email, password: 'password123', role })
          .expect(201);
        const login = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: 'password123' })
          .expect(201);
        return body<AuthResponse>(login).accessToken;
      };
      const viewer = await mk('viewer');
      const om = await mk('order_manager');
      for (const token of [viewer, om]) {
        await request(app.getHttpServer())
          .get('/analytics-settings')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        await request(app.getHttpServer())
          .patch('/analytics-settings')
          .set('Authorization', `Bearer ${token}`)
          .send({ ga4MeasurementId: 'G-ABCD1234' })
          .expect(403);
      }
      await request(app.getHttpServer()).get('/analytics-settings').expect(401);
    });

    it('cross-tenant: shop B can neither see nor change shop A settings', async () => {
      const a = await setupShop('xta');
      const b = await setupShop('xtb');
      await configureCapi(a, { ga4MeasurementId: 'G-AAAA1111' });

      const bGet = await request(app.getHttpServer())
        .get('/analytics-settings')
        .set('Authorization', `Bearer ${b.adminToken}`)
        .expect(200);
      expect(body<Record<string, unknown>>(bGet)).toMatchObject({
        ga4MeasurementId: null,
        metaPixelId: null,
        metaCapiTokenSet: false,
      });
      // B's write lands on B's row only.
      await request(app.getHttpServer())
        .patch('/analytics-settings')
        .set('Authorization', `Bearer ${b.adminToken}`)
        .send({ ga4MeasurementId: 'G-BBBB2222' })
        .expect(200);
      const aGet = await request(app.getHttpServer())
        .get('/analytics-settings')
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(200);
      expect(body<Record<string, unknown>>(aGet).ga4MeasurementId).toBe(
        'G-AAAA1111',
      );
      // And B's public payload never carries A's ids.
      const bPublic = await request(app.getHttpServer())
        .get(`/public/${b.slug}`)
        .expect(200);
      expect(JSON.stringify(bPublic.body)).not.toContain('G-AAAA1111');
      expect(JSON.stringify(bPublic.body)).not.toContain('123456789012345');
    });
  });

  // ---------------------------------------------------------- public payload
  describe('public payload', () => {
    it('exposes only configured public ids; no token, no test code, no ciphertext', async () => {
      const shop = await setupShop('pub');
      await configureCapi(shop, { ga4MeasurementId: 'G-PUBL1234' });
      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      const analytics = body<{ analytics: Record<string, unknown> | null }>(res)
        .analytics;
      expect(analytics).toEqual({
        ga4MeasurementId: 'G-PUBL1234',
        metaPixelId: '123456789012345',
      });
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(CAPI_TOKEN);
      expect(text).not.toContain('TEST4242');
      expect(text).not.toMatch(/metaCapiToken|metaTestEventCode/);
      const row = await db.query<RowDataPacket[]>(
        `SELECT metaCapiTokenEnc FROM shopanalytics WHERE shopId = ?`,
        [shop.shopId],
      );
      expect(text).not.toContain(row[0].metaCapiTokenEnc as string);
    });

    it('is null for a shop that configured nothing', async () => {
      const shop = await setupShop('pubnone');
      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      expect(body<{ analytics: unknown }>(res).analytics).toBeNull();
    });
  });

  // ------------------------------------------------------------- attribution
  describe('order attribution', () => {
    it('persists attribution, with click ids / fbp / fbc only under consent', async () => {
      const shop = await setupShop('attr');
      const withConsent = await placeOrder(shop, {
        attribution: CONSENTED,
      }).expect(201);
      const noConsent = await placeOrder(shop, {
        attribution: { ...CONSENTED, consent: { marketing: false } },
      }).expect(201);
      const noneSent = await placeOrder(shop).expect(201);

      const a = await orderRow(body<OrderResponse>(withConsent).order.id);
      const aj = a.attributionJson as StoredAttribution;
      expect(aj.consent).toEqual({ marketing: true });
      expect(aj.firstTouch.source).toBe('facebook');
      expect(aj.firstTouch.gclid).toBe('GCLID-FIRST');
      expect(aj.fbp).toBe(CONSENTED.fbp);
      // query string on the referrer is never stored
      expect(aj.firstTouch.referrer).toBe('https://l.facebook.com/l.php');

      const b = await orderRow(body<OrderResponse>(noConsent).order.id);
      const bText = JSON.stringify(b.attributionJson);
      expect((b.attributionJson as StoredAttribution).consent).toEqual({ marketing: false });
      expect(bText).not.toMatch(/GCLID|FBCLID|fb\.1\.|Mozilla/);
      expect(bText).toContain('paid_social'); // first-party metadata kept

      // Nothing sent: UNKNOWN (NULL), not "{}" and not "direct".
      const c = await orderRow(body<OrderResponse>(noneSent).order.id);
      expect(c.attributionJson).toBeNull();
    });

    it('garbage attribution never blocks the order', async () => {
      const shop = await setupShop('garb');
      for (const attribution of [
        'a string',
        42,
        [],
        { consent: 'yes', firstTouch: 5, lastTouch: { source: { x: 1 } } },
        { consent: { marketing: true }, fbp: 'x'.repeat(10000) },
      ]) {
        await placeOrder(shop, { attribution }).expect(201);
      }
    });

    it('never leaks the raw column, click ids, fbp or the user agent through any response', async () => {
      const shop = await setupShop('leak');
      const created = await placeOrder(shop, {
        attribution: CONSENTED,
      }).expect(201);
      const orderId = body<OrderResponse>(created).order.id;
      const token = (await orderRow(orderId)).trackingToken as string;

      // The customer's own checkout response.
      const needles = /attributionJson|GCLID|FBCLID|fb\.1\.1700|Mozilla\/5\.0 \(e2e\)/;
      expect(JSON.stringify(created.body)).not.toMatch(needles);

      const responses = [
        await request(app.getHttpServer())
          .get(`/orders`)
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
        await request(app.getHttpServer())
          .get(`/orders/${orderId}`)
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
        await request(app.getHttpServer())
          .get(`/public/orders/lookup`)
          .query({ token })
          .expect(200),
      ];
      const custRows = await db.query<RowDataPacket[]>(
        `SELECT customerId FROM \`order\` WHERE id = ?`,
        [orderId],
      );
      responses.push(
        await request(app.getHttpServer())
          .get(`/customers/${custRows[0].customerId as number}`)
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
      );
      for (const res of responses) {
        expect(JSON.stringify(res.body)).not.toMatch(needles);
      }
    });

    it('the order detail shows a Source view (touches + consent, no identifiers) and null for unknown', async () => {
      const shop = await setupShop('src');
      const known = await placeOrder(shop, { attribution: CONSENTED }).expect(201);
      const unknown = await placeOrder(shop).expect(201);
      const k = await request(app.getHttpServer())
        .get(`/orders/${body<OrderResponse>(known).order.id}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<OrderDetailResponse>(k).attribution).toMatchObject({
        consentMarketing: true,
        lastTouch: { source: 'facebook', medium: 'paid_social', campaign: 'Spring' },
      });
      const u = await request(app.getHttpServer())
        .get(`/orders/${body<OrderResponse>(unknown).order.id}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<OrderDetailResponse>(u).attribution).toBeNull();
    });

    it('cross-tenant: another shop cannot read this order or its Source', async () => {
      const a = await setupShop('oxa');
      const b = await setupShop('oxb');
      const created = await placeOrder(a, { attribution: CONSENTED }).expect(201);
      await request(app.getHttpServer())
        .get(`/orders/${body<OrderResponse>(created).order.id}`)
        .set('Authorization', `Bearer ${b.adminToken}`)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------- CAPI
  describe('Meta Conversions API', () => {
    beforeEach(() => {
      capiCalls.length = 0;
      stubMeta.send.mockClear();
    });

    it('pay-on-delivery/pickup: queues exactly one job at creation and sends one hashed event', async () => {
      const shop = await setupShop('cod');
      await configureCapi(shop);
      const res = await placeOrder(shop, { attribution: CONSENTED }).expect(201);
      const orderId = body<OrderResponse>(res).order.id;

      const queued = await jobsFor(orderId);
      expect(queued).toHaveLength(1);
      expect(queued[0].type).toBe('send_conversion_event');
      expect(queued[0].shopId).toBe(shop.shopId);
      // The job row carries no secret and no personal data.
      const payloadText = JSON.stringify(queued[0].payload);
      expect(payloadText).not.toContain(CAPI_TOKEN);
      expect(payloadText).not.toMatch(/jane|example\.com|0501234567/i);

      await runJob(orderId);
      expect(capiCalls).toHaveLength(1);
      const call = capiCalls[0];
      expect(call.pixelId).toBe('123456789012345');
      expect(call.accessToken).toBe(CAPI_TOKEN);
      expect(call.testEventCode).toBe('TEST4242');
      const event = call.events[0] as unknown as CapiEvent;
      expect(event.event_name).toBe('Purchase');
      // Shared with the browser event so Meta deduplicates the pair.
      expect(event.event_id).toBe(`order_${orderId}`);
      expect(event.action_source).toBe('website');
      const row = await orderRow(orderId);
      expect(event.custom_data.currency).toBe(row.currency);
      expect(event.custom_data.value).toBe(Number(row.total));
      expect(event.user_data.em).toEqual([sha256Hex('jane.doe@example.com')]);
      expect(event.user_data.ph).toEqual([sha256Hex('971501234567')]);
      expect(event.user_data.fbp).toBe(CONSENTED.fbp);
      expect(event.user_data.fbc).toBe(CONSENTED.fbc);
      // No raw contact data anywhere in what was handed to Meta.
      const sent = JSON.stringify(call.events);
      expect(sent).not.toMatch(/jane\.doe|example\.com|0501234567/i);
      expect(sent).not.toContain(CAPI_TOKEN);
    });

    it('sends NOTHING without recorded marketing consent (false, absent, or unknown)', async () => {
      const shop = await setupShop('noc');
      await configureCapi(shop);
      for (const attribution of [
        { ...CONSENTED, consent: { marketing: false } },
        { ...CONSENTED, consent: {} },
        undefined,
      ]) {
        const res = await placeOrder(shop, { attribution }).expect(201);
        expect(await jobsFor(body<OrderResponse>(res).order.id)).toHaveLength(0);
      }
      expect(stubMeta.send).not.toHaveBeenCalled();
    });

    it('sends nothing for a pixel without a CAPI token (browser-only setup)', async () => {
      const shop = await setupShop('notok');
      await request(app.getHttpServer())
        .patch('/analytics-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ metaPixelId: '123456789012345' })
        .expect(200);
      const res = await placeOrder(shop, { attribution: CONSENTED }).expect(201);
      expect(await jobsFor(body<OrderResponse>(res).order.id)).toHaveLength(0);
    });

    it('a consent revoked in the order row before the job runs still sends nothing', async () => {
      const shop = await setupShop('revoke');
      await configureCapi(shop);
      const res = await placeOrder(shop, { attribution: CONSENTED }).expect(201);
      const orderId = body<OrderResponse>(res).order.id;
      await db.execute(
        `UPDATE \`order\` SET attributionJson = JSON_SET(attributionJson, '$.consent.marketing', false) WHERE id = ?`,
        [orderId],
      );
      await runJob(orderId);
      expect(stubMeta.send).not.toHaveBeenCalled();
    });

    it('a job whose shopId does not own the order sends nothing (tenant check in the handler)', async () => {
      const a = await setupShop('hta');
      const b = await setupShop('htb');
      await configureCapi(a);
      await configureCapi(b);
      const res = await placeOrder(a, { attribution: CONSENTED }).expect(201);
      const orderId = body<OrderResponse>(res).order.id;
      // A forged / misrouted job: shop B's id against shop A's order.
      const job = await jobs.enqueue(
        b.shopId,
        'send_conversion_event',
        {
          platform: 'meta',
          shopId: b.shopId,
          orderId,
          eventId: `order_${orderId}`,
          eventTime: Math.floor(Date.now() / 1000),
          value: '50.00',
          currency: 'AED',
        },
        `forged:${runId}:${orderId}`,
      );
      expect(await worker.processJobById(job.id)).toBe(true);
      // Only A's own legitimate job (never run here) could have sent anything.
      expect(stubMeta.send).not.toHaveBeenCalled();
    });

    it('online payment: nothing at creation; exactly ONE job across a webhook, a duplicate webhook and a reconciliation run', async () => {
      const shop = await setupShop('onl');
      await configureCapi(shop);
      const res = await placeOrder(shop, {
        paymentMethod: 'card_online',
        attribution: CONSENTED,
      }).expect(201);
      const orderId = body<OrderResponse>(res).order.id;
      expect(body<OrderResponse>(res).checkoutUrl).toBeTruthy();
      // Not a conversion until it is paid.
      expect(await jobsFor(orderId)).toHaveLength(0);

      const webhook = () =>
        request(app.getHttpServer())
          .post('/payments/webhook/stripe')
          .set('Content-Type', 'application/json')
          .send({
            providerReference: `evt_capi_${orderId}`,
            orderId,
            status: 'paid',
            chargeReference: 'pi_capi_1',
          });
      await webhook().expect(201);
      expect(await jobsFor(orderId)).toHaveLength(1);
      expect((await orderRow(orderId)).paymentStatus).toBe('paid');

      // The gateway redelivers the same event.
      await webhook().expect(201);
      expect(await jobsFor(orderId)).toHaveLength(1);

      // And the reconciliation sweep later also reports it paid. Forced back into
      // the candidate set so the sweep genuinely re-applies it.
      await db.execute(
        `UPDATE \`order\` SET paymentStatus = 'unpaid',
                createdAt = DATE_SUB(NOW(), INTERVAL 45 MINUTE) WHERE id = ?`,
        [orderId],
      );
      expect(await reconciliation.runSweep()).toBeGreaterThanOrEqual(1);
      const txns = await db.query<RowDataPacket[]>(
        `SELECT gatewayReference FROM paymenttransaction WHERE orderId = ?`,
        [orderId],
      );
      // The two distinct payment records exist (webhook + reconciliation)...
      const refs = txns.map((t) => t.gatewayReference as string);
      expect(refs).toHaveLength(2);
      expect(refs).toContain(`evt_capi_${orderId}`);
      expect(refs.some((r) => r.startsWith('reconciled:cs_capi_'))).toBe(true);
      // ...yet still exactly one conversion job.
      expect(await jobsFor(orderId)).toHaveLength(1);

      await runJob(orderId);
      expect(capiCalls).toHaveLength(1);
    });

    it('a redelivered paid webhook repairs a conversion whose first enqueue was lost (still one job)', async () => {
      const shop = await setupShop('repair');
      await configureCapi(shop);
      const res = await placeOrder(shop, {
        paymentMethod: 'card_online',
        attribution: CONSENTED,
      }).expect(201);
      const orderId = body<OrderResponse>(res).order.id;
      const send = () =>
        request(app.getHttpServer())
          .post('/payments/webhook/stripe')
          .set('Content-Type', 'application/json')
          .send({
            providerReference: `evt_repair_${orderId}`,
            orderId,
            status: 'paid',
          });
      await send().expect(201);
      expect(await jobsFor(orderId)).toHaveLength(1);
      // Simulate the process dying between committing the payment and queueing.
      await db.execute(`DELETE FROM job WHERE idempotencyKey = ?`, [
        `capi:purchase:${orderId}`,
      ]);
      await send().expect(201); // the gateway redelivers: unique index => duplicate path
      expect(await jobsFor(orderId)).toHaveLength(1);
    });

    it('online payment, reconciliation alone (webhook never came): one job', async () => {
      const shop = await setupShop('rec');
      await configureCapi(shop);
      const res = await placeOrder(shop, {
        paymentMethod: 'card_online',
        attribution: CONSENTED,
      }).expect(201);
      const orderId = body<OrderResponse>(res).order.id;
      expect(await jobsFor(orderId)).toHaveLength(0);
      await db.execute(
        `UPDATE \`order\` SET createdAt = DATE_SUB(NOW(), INTERVAL 45 MINUTE) WHERE id = ?`,
        [orderId],
      );
      await reconciliation.runSweep();
      expect(await jobsFor(orderId)).toHaveLength(1);
    });

    it('online payment without consent: paid, but no job', async () => {
      const shop = await setupShop('onlnc');
      await configureCapi(shop);
      const res = await placeOrder(shop, {
        paymentMethod: 'card_online',
        attribution: { ...CONSENTED, consent: { marketing: false } },
      }).expect(201);
      const orderId = body<OrderResponse>(res).order.id;
      await request(app.getHttpServer())
        .post('/payments/webhook/stripe')
        .set('Content-Type', 'application/json')
        .send({
          providerReference: `evt_nc_${orderId}`,
          orderId,
          status: 'paid',
        })
        .expect(201);
      expect((await orderRow(orderId)).paymentStatus).toBe('paid');
      expect(await jobsFor(orderId)).toHaveLength(0);
    });
  });

  // ------------------------------------------------------- report and export
  describe('attribution report and export', () => {
    const touch = (source: string, medium: string, campaign?: string) => ({
      consent: { marketing: false },
      firstTouch: { source: 'first-' + source, medium: 'first-m' },
      lastTouch: { source, medium, ...(campaign ? { campaign } : {}) },
    });

    it('groups by source / medium / campaign, last-touch by default, first-touch on request', async () => {
      const shop = await setupShop('rep');
      const s1 = `news-${runId}`;
      const s2 = `ads-${runId}`;
      await placeOrder(shop, { attribution: touch(s1, 'email', 'oct') }).expect(201);
      await placeOrder(shop, { attribution: touch(s1, 'email', 'oct') }).expect(201);
      await placeOrder(shop, { attribution: touch(s2, 'cpc') }).expect(201);
      await placeOrder(shop).expect(201); // unknown

      const res = await request(app.getHttpServer())
        .get('/reports/attribution')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const rows = body<{
        model: string;
        rows: { source: string; medium: string; campaign: string; currency: string; orders: number; revenue: number }[];
      }>(res);
      expect(rows.model).toBe('last');
      const find = (source: string) => rows.rows.find((r) => r.source === source)!;
      expect(find(s1)).toMatchObject({ medium: 'email', campaign: 'oct', orders: 2 });
      expect(find(s2)).toMatchObject({ medium: 'cpc', campaign: '(not set)', orders: 1 });
      expect(find('(unknown)')).toMatchObject({ medium: '(unknown)', orders: 1 });
      // Each row carries its own currency, and revenue is in it.
      expect(find(s1).currency).toBe('AED');
      const oneTotal = await db.query<RowDataPacket[]>(
        `SELECT total FROM \`order\` WHERE shopId = ? LIMIT 1`,
        [shop.shopId],
      );
      expect(find(s1).revenue).toBe(2 * Number(oneTotal[0].total));

      const first = await request(app.getHttpServer())
        .get('/reports/attribution?model=first')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(
        body<{ rows: { source: string }[] }>(first).rows.some(
          (r) => r.source === `first-${s1}`,
        ),
      ).toBe(true);
    });

    it('excludes cancelled orders and online orders that were never paid', async () => {
      const shop = await setupShop('repx');
      const src = `excl-${runId}`;
      const ok = await placeOrder(shop, { attribution: touch(src, 'a') }).expect(201);
      const cancelled = await placeOrder(shop, { attribution: touch(src, 'a') }).expect(201);
      await placeOrder(shop, {
        paymentMethod: 'card_online',
        attribution: touch(src, 'a'),
      }).expect(201); // unpaid abandoned checkout
      await db.execute(`UPDATE \`order\` SET status = 'cancelled' WHERE id = ?`, [
        body<OrderResponse>(cancelled).order.id,
      ]);
      void ok;
      const res = await request(app.getHttpServer())
        .get('/reports/attribution')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const row = body<{ rows: { source: string; orders: number }[] }>(res).rows.find(
        (r) => r.source === src,
      );
      expect(row?.orders).toBe(1);
    });

    it('never sums across currencies: a KWD order is its own row at 3 decimals', async () => {
      const shop = await setupShop('repk');
      const src = `cur-${runId}`;
      await placeOrder(shop, { attribution: touch(src, 'm') }).expect(201);
      await db.execute(`UPDATE shop SET currency = 'KWD' WHERE id = ?`, [shop.shopId]);
      const k = await placeOrder(shop, { attribution: touch(src, 'm') }).expect(201);
      const kwdTotal = Number((await orderRow(body<OrderResponse>(k).order.id)).total);
      const res = await request(app.getHttpServer())
        .get('/reports/attribution')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const mine = body<{ rows: { source: string; currency: string; orders: number; revenue: number }[] }>(res)
        .rows.filter((r) => r.source === src);
      expect(mine.map((r) => r.currency).sort()).toEqual(['AED', 'KWD']);
      expect(mine.find((r) => r.currency === 'KWD')).toMatchObject({
        orders: 1,
        revenue: kwdTotal,
      });
    });

    it('cross-tenant: the report and the CSV export only ever contain the caller shop', async () => {
      const a = await setupShop('rxa');
      const b = await setupShop('rxb');
      const srcA = `only-a-${runId}`;
      const srcB = `only-b-${runId}`;
      await placeOrder(a, { attribution: touch(srcA, 'x') }).expect(201);
      await placeOrder(b, { attribution: touch(srcB, 'x') }).expect(201);

      for (const [shop, mine, other] of [
        [a, srcA, srcB],
        [b, srcB, srcA],
      ] as const) {
        const rep = await request(app.getHttpServer())
          .get('/reports/attribution')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200);
        const sources = body<{ rows: { source: string }[] }>(rep).rows.map((r) => r.source);
        expect(sources).toContain(mine);
        expect(sources).not.toContain(other);

        const csv = await request(app.getHttpServer())
          .get('/exports/attribution')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200);
        expect(csv.headers['content-type']).toContain('text/csv');
        expect(csv.text).toContain('Source,Medium,Campaign,Orders,Revenue,Currency');
        expect(csv.text).toContain(mine);
        expect(csv.text).not.toContain(other);
      }
      // an outletId from another shop returns nothing, not the other shop's data
      const bOutlet = b.outletId;
      const spoof = await request(app.getHttpServer())
        .get(`/reports/attribution?outletId=${bOutlet}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(200);
      expect(body<{ rows: unknown[] }>(spoof).rows).toHaveLength(0);
    });

    it('the CSV export neutralises spreadsheet formulas in visitor-supplied source/campaign', async () => {
      const shop = await setupShop('csvf');
      await placeOrder(shop, {
        attribution: {
          consent: { marketing: false },
          lastTouch: {
            source: `evil-${runId}`,
            medium: '=cmd|calc',
            campaign: '@SUM(1+1)',
          },
        },
      }).expect(201);
      const csv = await request(app.getHttpServer())
        .get('/exports/attribution')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(csv.text).toContain(`evil-${runId},'=cmd|calc,'@SUM(1+1)`);
      expect(csv.text).not.toMatch(/,=cmd|,@SUM/);
    });

    it('the export honours roles: viewer yes, order_manager no', async () => {
      const shop = await setupShop('rxr');
      const mk = async (role: string) => {
        const email = `pixr-${role}-${runId}@test.com`;
        await request(app.getHttpServer())
          .post('/auth/branch-users')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ name: role, email, password: 'password123', role })
          .expect(201);
        const login = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: 'password123' })
          .expect(201);
        return body<AuthResponse>(login).accessToken;
      };
      await request(app.getHttpServer())
        .get('/exports/attribution')
        .set('Authorization', `Bearer ${await mk('viewer')}`)
        .expect(200);
      await request(app.getHttpServer())
        .get('/exports/attribution')
        .set('Authorization', `Bearer ${await mk('order_manager')}`)
        .expect(403);
    });
  });

  // PDPL: deleting a customer account scrubs the online identifiers an order captured.
  it('anonymising a customer removes click ids and fbp/fbc from their orders but keeps the UTM source', async () => {
    const shop = await setupShop('pdpl');
    const res = await placeOrder(shop, { attribution: CONSENTED }).expect(201);
    const orderId = body<OrderResponse>(res).order.id;
    const cust = await db.query<RowDataPacket[]>(
      `SELECT customerId FROM \`order\` WHERE id = ?`,
      [orderId],
    );
    const svc = app.get(CustomerAccountService) as unknown as {
      anonymiseCustomer(shopId: number, customerId: number): Promise<void>;
    };
    await svc.anonymiseCustomer(shop.shopId, cust[0].customerId as number);
    const after = JSON.stringify((await orderRow(orderId)).attributionJson);
    expect(after).not.toMatch(/GCLID|FBCLID|fb\.1\.|Mozilla/);
    expect(after).toContain('paid_social');
  });
});
