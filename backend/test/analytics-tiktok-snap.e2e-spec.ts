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
import { ConversionEventsService } from '../src/shop-analytics/conversion-events.service';
import { MetaCapiClient } from '../src/shop-analytics/meta-capi.client';
import { TiktokEventsClient } from '../src/shop-analytics/tiktok-events';
import { SnapCapiClient } from '../src/shop-analytics/snap-capi';
import { FakeConversionClient } from '../src/shop-analytics/conversion-clients.fake';
import { decrypt } from '../src/common/crypto';
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
type Platform = 'meta' | 'tiktok' | 'snap';
interface TiktokCall {
  pixelCode: string;
  accessToken: string;
  events: Record<string, Record<string, unknown>>[];
}
interface SnapCall {
  pixelId: string;
  accessToken: string;
  events: Record<string, Record<string, unknown>>[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(120000);

// No real gateway: hands back a session and answers the webhook parse and the
// session poll, only for sessions THIS suite created (the sweep is platform-wide).
class StubStripe implements PaymentProvider {
  readonly name = 'stripe';
  private n = 0;
  createCheckoutSession(p: CreateCheckoutSessionParams): Promise<CheckoutSession> {
    this.n += 1;
    return Promise.resolve({
      checkoutUrl: 'https://stub.example/checkout',
      providerReference: `cs_ttsn_${p.orderId}_${this.n}`,
    });
  }
  parseWebhookEvent(rawBody: Buffer): WebhookResult | null {
    return JSON.parse(rawBody.toString()) as WebhookResult;
  }
  retrieveSessionOutcome(sessionId: string): Promise<CheckoutSessionOutcome | null> {
    return Promise.resolve(
      sessionId.startsWith('cs_ttsn_') ? { status: 'paid', chargeReference: 'pi_ttsn' } : null,
    );
  }
}

const TT_TOKEN = 'tt_' + 'Qz9'.repeat(12);
const SNAP_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.' + 'Sn4p'.repeat(20);
const META_TOKEN = 'EAABsbCS1iHgBO' + 'Zz'.repeat(30);
const TT_PIXEL = 'CABCDEFGHIJKLMNOPQRS';
const SNAP_PIXEL = '1b2c3d4e-0000-4000-8000-123456789abc';
const CONSENTED = {
  consent: { marketing: true },
  firstTouch: { source: 'tiktok', medium: 'paid_social', ttclid: 'TTCLID-FIRST' },
  lastTouch: { source: 'tiktok', medium: 'paid_social', ttclid: 'TTCLID-LAST' },
  clientUserAgent: 'Mozilla/5.0 (e2e)',
};

describe('TikTok and Snap server-side purchase events (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let jobs: JobsService;
  let worker: JobsWorkerService;
  let reconciliation: PaymentReconciliationService;
  let conversions: ConversionEventsService;
  const runId = Date.now();
  const meta = new FakeConversionClient<unknown>();
  const tiktok = new FakeConversionClient<TiktokCall>();
  const snap = new FakeConversionClient<SnapCall>();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // No test in this suite reaches Meta, TikTok or Snap.
      .overrideProvider(MetaCapiClient)
      .useValue(meta)
      .overrideProvider(TiktokEventsClient)
      .useValue(tiktok)
      .overrideProvider(SnapCapiClient)
      .useValue(snap)
      .compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    db = app.get(DatabaseService);
    jobs = app.get(JobsService);
    worker = app.get(JobsWorkerService);
    reconciliation = app.get(PaymentReconciliationService);
    conversions = app.get(ConversionEventsService);
    app.get(PaymentProviderRegistry).register(new StubStripe());
  });

  afterAll(async () => {
    await db.execute(
      `UPDATE \`order\` o JOIN shop s ON s.id = o.shopId
          SET o.paymentSessionId = NULL, o.paymentSessionGateway = NULL
        WHERE s.subdomain LIKE ?`,
      [`ts-%-${runId}`],
    );
    await app.close();
  });

  beforeEach(() => {
    meta.reset();
    tiktok.reset();
    snap.reset();
  });

  async function setupShop(prefix: string) {
    const slug = `ts-${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'TS Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(app.getHttpServer(), body<AuthResponse>(signup).devVerificationLink);
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
      .send({ name: 'TS Collection' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'TS Rose',
        price: 50,
        thumbnail: 'https://example.com/r.jpg',
        sku: `TS-${prefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);
    const shopRows = await db.query<RowDataPacket[]>(`SELECT id FROM shop WHERE subdomain = ?`, [slug]);
    return {
      adminToken,
      outletId,
      productId: body<IdRow>(product).id,
      shopId: shopRows[0].id as number,
      slug,
    };
  }
  type Shop = Awaited<ReturnType<typeof setupShop>>;

  function placeOrder(shop: Shop, opts: { paymentMethod?: string; attribution?: unknown } = {}) {
    return request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'TS Customer',
        customerPhone: '0501234567',
        customerEmail: 'Jane.Doe@Example.com',
        customerAddress: 'Pickup at outlet',
        orderType: 'pickup',
        paymentMethod: opts.paymentMethod ?? 'cash_on_pickup',
        items: [{ productId: shop.productId, quantity: 1 }],
        ...(opts.attribution !== undefined ? { attribution: opts.attribution } : {}),
      });
  }

  function patchSettings(shop: Shop, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch('/analytics-settings')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send(payload);
  }

  // All three platforms configured.
  async function configureAll(shop: Shop) {
    await patchSettings(shop, {
      metaPixelId: '123456789012345',
      metaCapiToken: META_TOKEN,
      tiktokPixelId: TT_PIXEL,
      tiktokEventsToken: TT_TOKEN,
      snapPixelId: SNAP_PIXEL,
      snapCapiToken: SNAP_TOKEN,
    }).expect(200);
  }

  async function jobsFor(orderId: number, platform: Platform) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT * FROM job
        WHERE type = 'send_conversion_event'
          AND JSON_EXTRACT(payload, '$.orderId') = ?
          AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.platform')) = ?`,
      [orderId, platform],
    );
    for (const r of rows) {
      expect(r.idempotencyKey).toBe(
        platform === 'meta' ? `capi:purchase:${orderId}` : `capi:${platform}:purchase:${orderId}`,
      );
    }
    return rows;
  }
  async function runJobs(orderId: number, platforms: Platform[] = ['meta', 'tiktok', 'snap']) {
    for (const p of platforms) {
      for (const r of await jobsFor(orderId, p)) {
        expect(await worker.processJobById(r.id as number)).toBe(true);
      }
    }
  }
  const totalSends = () => meta.calls.length + tiktok.calls.length + snap.calls.length;

  function paidWebhook(orderId: number, evt: string) {
    return request(app.getHttpServer())
      .post('/payments/webhook/stripe')
      .set('Content-Type', 'application/json')
      .send({ providerReference: evt, orderId, status: 'paid', chargeReference: 'pi_ttsn_1' });
  }
  async function placeOnline(shop: Shop, ...rest: [attribution?: unknown]) {
    const attribution = rest.length ? rest[0] : CONSENTED;
    const res = await placeOrder(shop, { paymentMethod: 'card_online', attribution }).expect(201);
    expect(body<OrderResponse>(res).checkoutUrl).toBeTruthy();
    return body<OrderResponse>(res).order.id;
  }

  // ---------------------------------------------------------------- settings
  describe('settings', () => {
    it('stores both tokens encrypted; never returns, logs or audits them; exposes only *TokenSet', async () => {
      const shop = await setupShop('set');
      const patch = await patchSettings(shop, {
        tiktokPixelId: TT_PIXEL,
        tiktokEventsToken: TT_TOKEN,
        snapPixelId: SNAP_PIXEL,
        snapCapiToken: SNAP_TOKEN,
      }).expect(200);
      const get = await request(app.getHttpServer())
        .get('/analytics-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      for (const res of [patch, get]) {
        const text = JSON.stringify(res.body);
        expect(text).not.toContain(TT_TOKEN);
        expect(text).not.toContain(SNAP_TOKEN);
        expect(text).not.toContain(TT_TOKEN.slice(-6));
        expect(text).not.toContain(SNAP_TOKEN.slice(-6));
        expect(body<Record<string, unknown>>(res)).toMatchObject({
          tiktokEventsTokenSet: true,
          snapCapiTokenSet: true,
          metaCapiTokenSet: false,
        });
      }
      const rows = await db.query<RowDataPacket[]>(
        `SELECT tiktokEventsTokenEnc, snapCapiTokenEnc FROM shopanalytics WHERE shopId = ?`,
        [shop.shopId],
      );
      const t = rows[0].tiktokEventsTokenEnc as string;
      const s = rows[0].snapCapiTokenEnc as string;
      expect(t).not.toContain(TT_TOKEN);
      expect(s).not.toContain(SNAP_TOKEN);
      expect(decrypt(t)).toBe(TT_TOKEN);
      expect(decrypt(s)).toBe(SNAP_TOKEN);

      const audit = await db.query<RowDataPacket[]>(
        `SELECT metadata, \`after\`, \`before\` FROM auditlog
          WHERE shopId = ? AND action = 'analytics_settings.updated'`,
        [shop.shopId],
      );
      const auditText = JSON.stringify(audit);
      expect(auditText).not.toContain(TT_TOKEN);
      expect(auditText).not.toContain(SNAP_TOKEN);
      expect(auditText).toContain('tiktokEventsToken');
      expect(auditText).toContain('snapCapiToken');

      // The public storefront payload never carries either.
      const pub = JSON.stringify((await request(app.getHttpServer()).get(`/public/${shop.slug}`).expect(200)).body);
      expect(pub).not.toContain(TT_TOKEN);
      expect(pub).not.toContain(SNAP_TOKEN);
      expect(pub).not.toContain(t);
      expect(pub).not.toMatch(/EventsToken|CapiToken/);
    });

    it('null removes a token; an absent key leaves it; malformed tokens are 400', async () => {
      const shop = await setupShop('rm');
      await configureAll(shop);
      const res = await patchSettings(shop, { tiktokEventsToken: null }).expect(200);
      expect(body<Record<string, unknown>>(res)).toMatchObject({
        tiktokEventsTokenSet: false,
        snapCapiTokenSet: true,
        metaCapiTokenSet: true,
      });
      for (const bad of [
        { tiktokEventsToken: 'short' },
        { snapCapiToken: 'has space in it which is long enough to pass length' },
        { tiktokEventsToken: 'x'.repeat(300) },
      ]) {
        await patchSettings(shop, bad).expect(400);
      }
    });

    it('cross-tenant: shop B never sees or touches shop A tokens', async () => {
      const a = await setupShop('xa');
      const b = await setupShop('xb');
      await configureAll(a);
      const bGet = await request(app.getHttpServer())
        .get('/analytics-settings')
        .set('Authorization', `Bearer ${b.adminToken}`)
        .expect(200);
      expect(body<Record<string, unknown>>(bGet)).toMatchObject({
        tiktokEventsTokenSet: false,
        snapCapiTokenSet: false,
      });
      await patchSettings(b, { tiktokEventsToken: null }).expect(200);
      const aGet = await request(app.getHttpServer())
        .get('/analytics-settings')
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(200);
      expect(body<Record<string, unknown>>(aGet).tiktokEventsTokenSet).toBe(true);
    });
  });

  // ------------------------------------------------------------------ events
  describe('purchase events', () => {
    it('online payment: ONE tiktok and ONE snap job across webhook, duplicate webhook and reconciliation; event ids shared with the browser; no secret or PII in job rows or events', async () => {
      const shop = await setupShop('onl');
      await configureAll(shop);
      const orderId = await placeOnline(shop);
      // Not a conversion until paid.
      for (const p of ['meta', 'tiktok', 'snap'] as Platform[]) {
        expect(await jobsFor(orderId, p)).toHaveLength(0);
      }

      await paidWebhook(orderId, `evt_ts_${orderId}`).expect(201);
      await paidWebhook(orderId, `evt_ts_${orderId}`).expect(201); // redelivery
      await db.execute(
        `UPDATE \`order\` SET paymentStatus = 'unpaid',
                createdAt = DATE_SUB(NOW(), INTERVAL 45 MINUTE) WHERE id = ?`,
        [orderId],
      );
      expect(await reconciliation.runSweep()).toBeGreaterThanOrEqual(1);
      for (const p of ['meta', 'tiktok', 'snap'] as Platform[]) {
        expect(await jobsFor(orderId, p)).toHaveLength(1);
      }

      const allJobs = await db.query<RowDataPacket[]>(
        `SELECT payload, lastError FROM job WHERE type = 'send_conversion_event'
          AND JSON_EXTRACT(payload, '$.orderId') = ?`,
        [orderId],
      );
      const jobText = JSON.stringify(allJobs);
      for (const secret of [TT_TOKEN, SNAP_TOKEN, META_TOKEN]) expect(jobText).not.toContain(secret);
      expect(jobText).not.toMatch(/jane|example\.com|0501234567/i);

      await runJobs(orderId);
      expect(meta.calls).toHaveLength(1);
      expect(tiktok.calls).toHaveLength(1);
      expect(snap.calls).toHaveLength(1);

      const tt = tiktok.calls[0];
      expect(tt.pixelCode).toBe(TT_PIXEL);
      expect(tt.accessToken).toBe(TT_TOKEN);
      expect(tt.events[0]).toMatchObject({ event: 'CompletePayment', event_id: `order_${orderId}` });
      expect(tt.events[0].user).toMatchObject({
        email: sha256Hex('jane.doe@example.com'),
        phone: sha256Hex('+971501234567'),
        ttclid: 'TTCLID-LAST',
      });
      const sn = snap.calls[0];
      expect(sn.pixelId).toBe(SNAP_PIXEL);
      expect(sn.accessToken).toBe(SNAP_TOKEN);
      expect(sn.events[0]).toMatchObject({ event_name: 'PURCHASE', event_id: `order_${orderId}` });
      expect(sn.events[0].user_data.em).toEqual([sha256Hex('jane.doe@example.com')]);

      const row = (await db.query<RowDataPacket[]>(`SELECT currency, total FROM \`order\` WHERE id = ?`, [orderId]))[0];
      expect(tt.events[0].properties.currency).toBe(row.currency);
      expect(tt.events[0].properties.value).toBe(Number(row.total));
      expect(sn.events[0].custom_data.value).toBe(Number(row.total));

      // No raw contact data, no token, no IP in what was handed over.
      for (const sent of [JSON.stringify(tt.events), JSON.stringify(sn.events)]) {
        expect(sent).not.toMatch(/jane\.doe|example\.com|0501234567|"ip"/i);
        expect(sent).not.toMatch(/tt_Qz9|Sn4p/);
      }
    });

    it('a repair redelivery after a lost enqueue restores each job exactly once', async () => {
      const shop = await setupShop('rep');
      await configureAll(shop);
      const orderId = await placeOnline(shop);
      await paidWebhook(orderId, `evt_rep_${orderId}`).expect(201);
      await db.execute(`DELETE FROM job WHERE idempotencyKey LIKE ?`, [`capi:%${orderId}`]);
      await paidWebhook(orderId, `evt_rep_${orderId}`).expect(201);
      for (const p of ['meta', 'tiktok', 'snap'] as Platform[]) {
        expect(await jobsFor(orderId, p)).toHaveLength(1);
      }
    });

    it('pay-on-pickup/delivery order: Meta job only, NOTHING for tiktok or snap (the browser fires those)', async () => {
      const shop = await setupShop('cod');
      await configureAll(shop);
      const res = await placeOrder(shop, { attribution: CONSENTED }).expect(201);
      const orderId = body<OrderResponse>(res).order.id;
      expect(await jobsFor(orderId, 'meta')).toHaveLength(1);
      expect(await jobsFor(orderId, 'tiktok')).toHaveLength(0);
      expect(await jobsFor(orderId, 'snap')).toHaveLength(0);
      await runJobs(orderId);
      expect(tiktok.calls).toHaveLength(0);
      expect(snap.calls).toHaveLength(0);
    });

    it('sends nothing without recorded marketing consent (false, absent or unknown)', async () => {
      const shop = await setupShop('noc');
      await configureAll(shop);
      for (const attribution of [
        { ...CONSENTED, consent: { marketing: false } },
        { ...CONSENTED, consent: {} },
        undefined,
      ]) {
        const orderId = await placeOnline(shop, attribution);
        await paidWebhook(orderId, `evt_noc_${orderId}`).expect(201);
        for (const p of ['tiktok', 'snap'] as Platform[]) {
          expect(await jobsFor(orderId, p)).toHaveLength(0);
        }
      }
      expect(totalSends()).toBe(0);
    });

    it('consent revoked after enqueue: the job runs and sends nothing', async () => {
      const shop = await setupShop('rev');
      await configureAll(shop);
      const orderId = await placeOnline(shop);
      await paidWebhook(orderId, `evt_rev_${orderId}`).expect(201);
      await db.execute(
        `UPDATE \`order\` SET attributionJson = JSON_SET(attributionJson, '$.consent.marketing', false) WHERE id = ?`,
        [orderId],
      );
      await runJobs(orderId);
      expect(totalSends()).toBe(0);
    });

    it('marketplace order: nothing at enqueue, and nothing at send if the channel changes after', async () => {
      const shop = await setupShop('mkt');
      await configureAll(shop);
      // At enqueue.
      const first = await placeOnline(shop);
      await db.execute(`UPDATE \`order\` SET channel = 'deliveroo' WHERE id = ?`, [first]);
      await paidWebhook(first, `evt_mkt1_${first}`).expect(201);
      for (const p of ['meta', 'tiktok', 'snap'] as Platform[]) {
        expect(await jobsFor(first, p)).toHaveLength(0);
      }
      // At send.
      const second = await placeOnline(shop);
      await paidWebhook(second, `evt_mkt2_${second}`).expect(201);
      await db.execute(`UPDATE \`order\` SET channel = 'talabat' WHERE id = ?`, [second]);
      await runJobs(second);
      expect(totalSends()).toBe(0);
    });

    it('a forged job whose shopId does not own the order sends nothing (tenant check)', async () => {
      const a = await setupShop('twa');
      const b = await setupShop('twb');
      await configureAll(a);
      await configureAll(b);
      const orderId = await placeOnline(a);
      for (const platform of ['tiktok', 'snap'] as Platform[]) {
        const job = await jobs.enqueue(
          b.shopId,
          'send_conversion_event',
          {
            platform,
            shopId: b.shopId,
            orderId,
            eventId: `order_${orderId}`,
            eventTime: Math.floor(Date.now() / 1000),
            value: '50.00',
            currency: 'AED',
          },
          `forged:${platform}:${runId}:${orderId}`,
        );
        expect(await worker.processJobById(job.id)).toBe(true);
      }
      expect(totalSends()).toBe(0);
    });

    it('no token (pixel only) or no pixel id (token only): no job for that platform; other platforms unaffected', async () => {
      const noToken = await setupShop('ntk');
      await patchSettings(noToken, { tiktokPixelId: TT_PIXEL, snapPixelId: SNAP_PIXEL }).expect(200);
      const o1 = await placeOnline(noToken);
      await paidWebhook(o1, `evt_ntk_${o1}`).expect(201);
      for (const p of ['tiktok', 'snap'] as Platform[]) expect(await jobsFor(o1, p)).toHaveLength(0);

      const noPixel = await setupShop('npx');
      await patchSettings(noPixel, { tiktokEventsToken: TT_TOKEN, snapCapiToken: SNAP_TOKEN }).expect(200);
      const o2 = await placeOnline(noPixel);
      await paidWebhook(o2, `evt_npx_${o2}`).expect(201);
      for (const p of ['tiktok', 'snap'] as Platform[]) expect(await jobsFor(o2, p)).toHaveLength(0);

      // Only TikTok configured: Snap queues nothing.
      const onlyTt = await setupShop('ott');
      await patchSettings(onlyTt, { tiktokPixelId: TT_PIXEL, tiktokEventsToken: TT_TOKEN }).expect(200);
      const o3 = await placeOnline(onlyTt);
      await paidWebhook(o3, `evt_ott_${o3}`).expect(201);
      expect(await jobsFor(o3, 'tiktok')).toHaveLength(1);
      expect(await jobsFor(o3, 'snap')).toHaveLength(0);
    });

    it('a token removed before the job runs sends nothing', async () => {
      const shop = await setupShop('rmv');
      await configureAll(shop);
      const orderId = await placeOnline(shop);
      await paidWebhook(orderId, `evt_rmv_${orderId}`).expect(201);
      await patchSettings(shop, { tiktokEventsToken: null }).expect(200);
      await runJobs(orderId, ['tiktok', 'snap']);
      expect(tiktok.calls).toHaveLength(0);
      expect(snap.calls).toHaveLength(1);
    });

    it('enqueuePurchase called directly without paid:true never queues tiktok or snap', async () => {
      const shop = await setupShop('dir');
      await configureAll(shop);
      const orderId = await placeOnline(shop);
      await conversions.enqueuePurchase(orderId);
      expect(await jobsFor(orderId, 'tiktok')).toHaveLength(0);
      expect(await jobsFor(orderId, 'snap')).toHaveLength(0);
    });

    it('a provider failure surfaces as a retryable job error with no token in lastError', async () => {
      const shop = await setupShop('fail');
      await configureAll(shop);
      const orderId = await placeOnline(shop);
      await paidWebhook(orderId, `evt_fail_${orderId}`).expect(201);
      tiktok.failNext = 'TikTok Events API request failed (HTTP 401) code=40001';
      await runJobs(orderId, ['tiktok']);
      const rows = await jobsFor(orderId, 'tiktok');
      expect(JSON.stringify(rows)).not.toContain(TT_TOKEN);
      expect(String(rows[0].lastError)).toContain('HTTP 401');
    });
  });
});
