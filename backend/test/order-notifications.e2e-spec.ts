import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderNotificationsService } from '../src/orders/order-notifications.service';
import { JobsWorkerService } from '../src/jobs/jobs.worker.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface OrderRow {
  id: number;
  status: string;
}
interface EmailJobPayload {
  to: string;
  subject: string;
  bodyText: string;
  fromName?: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// sendEmailStub (backend/src/common/email.ts) just console.logs — the path
// sendEmail() falls back to when RESEND_API_KEY isn't configured (see the
// "Real email provider (Resend)" describe block below for the real-path
// coverage). Spying on console.log and filtering for its "[email:stub]"
// prefix is the only way to observe whether a stub notification actually
// fired, short of mocking the module.
function emailStubCalls(spy: jest.SpyInstance, to: string): string[] {
  return spy.mock.calls
    .map((args) => String(args[0]))
    .filter(
      (line) => line.startsWith('[email:stub]') && line.includes(`to=${to}`),
    );
}

// Same idea for sendWhatsAppStub (backend/src/common/whatsapp.ts).
function whatsAppStubCalls(spy: jest.SpyInstance, to: string): string[] {
  return spy.mock.calls
    .map((args) => String(args[0]))
    .filter(
      (line) => line.startsWith('[whatsapp:stub]') && line.includes(`to=${to}`),
    );
}

// notifyOrderConfirmed/notifyOutForDelivery/notifySurveyRequest are
// fire-and-forget as of the checkout-latency fix (OrdersService/
// PublicService no longer `await` them) — the triggering HTTP request can
// return before the notification's own async work (even against these
// in-memory stubs) has actually run. A short settle after the triggering
// request gives that scheduled work a chance to at least enqueue its job
// (the WhatsApp channel isn't queued at all — see below — so this alone is
// enough for WhatsApp assertions).
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

// As of Phase 5, the email half of a notification is a queued job — see
// JobsWorkerService. It does NOT get processed by settle() alone, and
// deliberately does NOT use the worker's generic pollOnce() drain either:
// Jest runs each e2e spec file in its own OS process, and pollOnce()'s
// claim query has no process affinity — a DIFFERENT spec file's own worker
// can just as easily claim and process this file's job first (found for
// real: running this file alongside another one intermittently failed
// content assertions that pass every time this file runs alone). Any test
// that needs to observe the *content* of a specific email (its subject,
// or that the real Resend `fetch` call/console.log stub fired) must
// process its own job itself, in this process, via
// JobsWorkerService.processJobById — which is exactly what this helper
// does: poll for the job to appear (the enqueue is itself fire-and-forget,
// so it may not exist the instant the triggering request returns), then
// claim+process it here. Returns the final row, or null if nothing was
// ever enqueued for this key within the deadline.
let jobsWorker: JobsWorkerService;
let prisma: PrismaService;
async function processOwnEmailJob(idempotencyKey: string) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const job = await prisma.job.findUnique({ where: { idempotencyKey } });
    if (job) {
      if (job.status === 'pending') {
        await jobsWorker.processJobById(job.id);
      }
      return prisma.job.findUnique({ where: { idempotencyKey } });
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return null;
}

// flushNotifications' drain window is generous (see its own comment) —
// needs more room than Jest's 5s default per test.
jest.setTimeout(20000);

describe('Order status customer email notifications (e2e)', () => {
  let app: INestApplication<App>;
  let logSpy: jest.SpyInstance;
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
    prisma = app.get(PrismaService);
    jobsWorker = app.get(JobsWorkerService);
  });

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function setupShop(
    slugPrefix: string,
    notifyEmail: boolean,
    notifyCustomersWhatsapp = false,
  ) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Notify Test Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notifyEmail, notifyCustomersWhatsapp })
      .expect(200);

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Notify Item ${Math.random()}`,
        price: 25,
        thumbnail: 'https://example.com/x.jpg',
        sku: `NOTIFY-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        collectionIds: [body<IdRow>(collection).id],
        trackInventory: false,
      })
      .expect(201);

    return { adminToken, outletId, productId: body<IdRow>(product).id };
  }

  async function createOrder(
    adminToken: string,
    outletId: number,
    productId: number,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Notify Customer',
        customerPhone: '0500000002',
        customerAddress: '1 Notify Rd',
        emirate: 'Dubai',
        outletId,
        items: [{ productId, quantity: 1 }],
        ...overrides,
      })
      .expect(201);
    await settle();
    return body<OrderRow>(res);
  }

  it('sends an order-confirmation email when the shop has notifications enabled and the order has a customer email', async () => {
    const { adminToken, outletId, productId } = await setupShop(
      'notify-confirm-on',
      true,
    );
    const email = `confirm-on-${runId}@test.com`;
    const order = await createOrder(adminToken, outletId, productId, {
      customerEmail: email,
    });

    const job = await processOwnEmailJob(`order:${order.id}:confirmed-email`);
    expect(job).not.toBeNull();
    expect(job!.status).toBe('completed');
    const payload = job!.payload as unknown as EmailJobPayload;
    expect(payload.to).toBe(email);
    expect(payload.subject).toContain(`Order confirmation — #${order.id}`);
  });

  it('does NOT send anything when the shop has notifications disabled', async () => {
    const { adminToken, outletId, productId } = await setupShop(
      'notify-confirm-off',
      false,
    );
    const email = `confirm-off-${runId}@test.com`;
    const order = await createOrder(adminToken, outletId, productId, {
      customerEmail: email,
    });

    const job = await prisma.job.findUnique({
      where: { idempotencyKey: `order:${order.id}:confirmed-email` },
    });
    expect(job).toBeNull();
  });

  it('does NOT send anything when the order has no customer email, even with notifications enabled', async () => {
    const { adminToken, outletId, productId } = await setupShop(
      'notify-no-email',
      true,
    );
    const order = await createOrder(adminToken, outletId, productId, {});
    // Checked via the job table directly, scoped to this specific order's
    // idempotency key, rather than "no [email:stub] line logged at all" —
    // the queue is shared/global (Phase 5), so a blanket console.log count
    // would also catch unrelated jobs (this shop's own verification email,
    // anything still draining from an earlier test) that have nothing to
    // do with this order.
    const job = await prisma.job.findUnique({
      where: { idempotencyKey: `order:${order.id}:confirmed-email` },
    });
    expect(job).toBeNull();
  });

  it('sends an out-for-delivery email at that exact status transition, worded for delivery orders', async () => {
    const { adminToken, outletId, productId } = await setupShop(
      'notify-ofd-delivery',
      true,
    );
    const email = `ofd-delivery-${runId}@test.com`;
    const order = await createOrder(adminToken, outletId, productId, {
      customerEmail: email,
      orderType: 'delivery',
    });
    const jobKey = `order:${order.id}:out-for-delivery-email`;

    for (const status of ['confirmed', 'preparing']) {
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status })
        .expect(200);
      await settle();
      // No email at any of these intermediate transitions.
      const midJob = await prisma.job.findUnique({
        where: { idempotencyKey: jobKey },
      });
      expect(midJob).toBeNull();
    }

    await request(app.getHttpServer())
      .patch(`/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'out_for_delivery' })
      .expect(200);

    const job = await processOwnEmailJob(jobKey);
    expect(job).not.toBeNull();
    expect(job!.status).toBe('completed');
    const payload = job!.payload as unknown as EmailJobPayload;
    expect(payload.subject).toContain('out for delivery');
    expect(payload.subject).not.toContain('ready for pickup');
  });

  it('words the same transition as "ready for pickup" for a pickup order', async () => {
    const { adminToken, outletId, productId } = await setupShop(
      'notify-ofd-pickup',
      true,
    );
    const email = `ofd-pickup-${runId}@test.com`;
    const order = await createOrder(adminToken, outletId, productId, {
      customerEmail: email,
      orderType: 'pickup',
    });

    await request(app.getHttpServer())
      .patch(`/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'confirmed' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'preparing' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'out_for_delivery' })
      .expect(200);

    const job = await processOwnEmailJob(
      `order:${order.id}:out-for-delivery-email`,
    );
    expect(job).not.toBeNull();
    expect(job!.status).toBe('completed');
    const payload = job!.payload as unknown as EmailJobPayload;
    expect(payload.subject).toContain('ready for pickup');
  });

  it('a storefront checkout order also triggers the confirmation email (not just admin-created orders)', async () => {
    const slug = `notify-storefront-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Storefront Notify Admin',
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
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notifyEmail: true })
      .expect(200);

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pickupEnabled: true })
      .expect(200);

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Storefront collection' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Storefront Notify Product',
        price: 15,
        thumbnail: 'https://example.com/x.jpg',
        sku: `NOTIFY-SF-${runId}`,
        status: 'Available',
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);

    // publish gates false->true on readiness (a product + a ready outlet) —
    // both must exist first, see ShopService.update.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    const email = `storefront-${runId}@test.com`;
    const orderRes = await request(app.getHttpServer())
      .post(`/public/${slug}/orders`)
      .send({
        customerName: 'Storefront Customer',
        customerPhone: '0500000003',
        customerEmail: email,
        customerAddress: '2 Storefront Rd',
        emirate: 'Dubai',
        outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        items: [{ productId: body<IdRow>(product).id, quantity: 1 }],
      })
      .expect(201);
    const orderId = body<{ order: OrderRow }>(orderRes).order.id;

    const job = await processOwnEmailJob(`order:${orderId}:confirmed-email`);
    expect(job).not.toBeNull();
    expect(job!.status).toBe('completed');
    const payload = job!.payload as unknown as EmailJobPayload;
    expect(payload.subject).toContain('Order confirmation');
  });

  describe('WhatsApp notifications', () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      fetchSpy = jest.spyOn(global, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    // Scoped to the Meta Graph API specifically — `global.fetch` is no
    // longer only ever called for WhatsApp in this describe block: every
    // setupShop() signs up a new admin, which now also fires a real
    // sendEmail() verification-email attempt against the Resend API
    // whenever RESEND_API_KEY is configured in the environment (see the
    // "Real email provider (Resend)" describe block below). Asserting on
    // fetchSpy's raw total call count would incorrectly fail these
    // WhatsApp-specific tests on an environment with that key set; filtering
    // by URL is what actually isolates "did the Meta Cloud API get called."
    function metaApiCalls() {
      return fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/messages'),
      );
    }

    it('fires via the stub when notifyCustomersWhatsapp is on and no credentials are configured — independent of the email toggle', async () => {
      const { adminToken, outletId, productId } = await setupShop(
        'wa-stub',
        false,
        true,
      );
      const order = await createOrder(adminToken, outletId, productId, {
        customerPhone: '0501234567',
      });

      const waCalls = whatsAppStubCalls(logSpy, '+971501234567');
      expect(waCalls.length).toBe(1);
      expect(waCalls[0]).toContain(`order #${order.id}`);
      // Email toggle was off — no email attempted for this order at all.
      expect(metaApiCalls()).toHaveLength(0);
    });

    it('does NOT fire when notifyCustomersWhatsapp is off, even if notifyEmail is on', async () => {
      const { adminToken, outletId, productId } = await setupShop(
        'wa-off',
        true,
        false,
      );
      const email = `wa-off-customer-${runId}@test.com`;
      const order = await createOrder(adminToken, outletId, productId, {
        customerPhone: '0501234568',
        customerEmail: email,
      });

      expect(whatsAppStubCalls(logSpy, '+971501234568').length).toBe(0);
      // The independent email channel still fires normally.
      const job = await processOwnEmailJob(`order:${order.id}:confirmed-email`);
      expect(job).not.toBeNull();
      expect(job!.status).toBe('completed');
    });

    it('calls the real Meta Cloud API provider (not the stub) once credentials are configured', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.fake123' }] }),
      });

      const { adminToken, outletId, productId } = await setupShop(
        'wa-real',
        false,
        true,
      );
      await request(app.getHttpServer())
        .patch('/whatsapp-settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ phoneNumberId: '1234567890', accessToken: 'fake-access-token' })
        .expect(200);

      await createOrder(adminToken, outletId, productId, {
        customerPhone: '0501234569',
      });

      const calls = metaApiCalls();
      expect(calls).toHaveLength(1);
      const [url, init] = calls[0];
      expect(String(url)).toContain('/1234567890/messages');
      expect(init.headers.Authorization).toBe('Bearer fake-access-token');
      const sentBody = JSON.parse(init.body);
      expect(sentBody.to).toBe('971501234569'); // no leading '+' for the Cloud API
      // Real provider path taken — the stub must not also have logged.
      expect(whatsAppStubCalls(logSpy, '+971501234569').length).toBe(0);
    });

    it('a WhatsApp send failure does not block the email channel or the order operation itself', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Meta is down',
      });

      const { adminToken, outletId, productId } = await setupShop(
        'wa-fail',
        true,
        true,
      );
      await request(app.getHttpServer())
        .patch('/whatsapp-settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ phoneNumberId: '1234567890', accessToken: 'fake-access-token' })
        .expect(200);

      const email = `wa-fail-customer-${runId}@test.com`;
      // Order creation itself must still return 201 despite the WhatsApp
      // provider failing — createOrder() already asserts .expect(201).
      const order = await createOrder(adminToken, outletId, productId, {
        customerPhone: '0501234570',
        customerEmail: email,
      });

      // Email channel is unaffected by the WhatsApp failure.
      const job = await processOwnEmailJob(`order:${order.id}:confirmed-email`);
      expect(job).not.toBeNull();
      expect(job!.status).toBe('completed');
    });

    it('skips silently (no throw, no send) when the customer phone cannot be normalized to E.164', async () => {
      const { adminToken, outletId, productId } = await setupShop(
        'wa-badphone',
        false,
        true,
      );
      const order = await createOrder(adminToken, outletId, productId, {
        customerPhone: 'not-a-real-number',
      });
      expect(order.id).toBeTruthy();
      expect(metaApiCalls()).toHaveLength(0);
    });
  });

  describe('Merchant WhatsApp order alert (platform-owned)', () => {
    let fetchSpy: jest.SpyInstance;
    const originalPhoneNumberId = process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID;
    const originalAccessToken = process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN;

    beforeEach(() => {
      fetchSpy = jest.spyOn(global, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
      if (originalPhoneNumberId === undefined) {
        delete process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID;
      } else {
        process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = originalPhoneNumberId;
      }
      if (originalAccessToken === undefined) {
        delete process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN;
      } else {
        process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = originalAccessToken;
      }
    });

    function metaApiCalls() {
      return fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/messages'),
      );
    }

    interface WhatsAppAlertJobPayload {
      to: string;
      body: string;
      orderId: number;
    }

    it('is always on: no per-shop toggle gates it, unlike the customer-facing WhatsApp channel', async () => {
      // notifyCustomersWhatsapp/notifyEmail both off — the merchant alert
      // must still fire since it has no per-shop enable/disable by design.
      const { adminToken, outletId, productId } = await setupShop(
        'merchant-alert-always-on',
        false,
        false,
      );
      await request(app.getHttpServer())
        .patch(`/outlets/${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ phone: '0507654321' })
        .expect(200);

      const order = await createOrder(adminToken, outletId, productId, {});
      const job = await processOwnEmailJob(
        `order:${order.id}:merchant-whatsapp-alert`,
      );
      expect(job).not.toBeNull();
      expect(job!.status).toBe('completed');
      const payload = job!.payload as unknown as WhatsAppAlertJobPayload;
      expect(payload.to).toBe('+971507654321');
      expect(payload.body).toContain(`New order #${order.id}`);
      expect(payload.orderId).toBe(order.id);
    });

    it("prefers the outlet's whatsapp field over its phone field", async () => {
      const { adminToken, outletId, productId } = await setupShop(
        'merchant-alert-whatsapp-pref',
        false,
        false,
      );
      await request(app.getHttpServer())
        .patch(`/outlets/${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ phone: '0507654322', whatsapp: '0507654399' })
        .expect(200);

      const order = await createOrder(adminToken, outletId, productId, {});
      const job = await processOwnEmailJob(
        `order:${order.id}:merchant-whatsapp-alert`,
      );
      expect(job).not.toBeNull();
      const payload = job!.payload as unknown as WhatsAppAlertJobPayload;
      expect(payload.to).toBe('+971507654399');
    });

    it('does not enqueue anything when the outlet has no phone or whatsapp configured', async () => {
      const { adminToken, outletId, productId } = await setupShop(
        'merchant-alert-nophone',
        false,
        false,
      );
      const order = await createOrder(adminToken, outletId, productId, {});
      const job = await prisma.job.findUnique({
        where: {
          idempotencyKey: `order:${order.id}:merchant-whatsapp-alert`,
        },
      });
      expect(job).toBeNull();
      // Order creation itself is unaffected.
      expect(order.id).toBeTruthy();
    });

    it('does not enqueue anything when the outlet phone cannot be normalized to E.164', async () => {
      const { adminToken, outletId, productId } = await setupShop(
        'merchant-alert-badphone',
        false,
        false,
      );
      await request(app.getHttpServer())
        .patch(`/outlets/${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ phone: 'not-a-real-number' })
        .expect(200);

      const order = await createOrder(adminToken, outletId, productId, {});
      const job = await prisma.job.findUnique({
        where: {
          idempotencyKey: `order:${order.id}:merchant-whatsapp-alert`,
        },
      });
      expect(job).toBeNull();
    });

    it('processes via the stub when the platform WhatsApp env vars are unset', async () => {
      delete process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN;

      const { adminToken, outletId, productId } = await setupShop(
        'merchant-alert-stub',
        false,
        false,
      );
      await request(app.getHttpServer())
        .patch(`/outlets/${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ phone: '0507654323' })
        .expect(200);

      const order = await createOrder(adminToken, outletId, productId, {});
      const job = await processOwnEmailJob(
        `order:${order.id}:merchant-whatsapp-alert`,
      );
      expect(job).not.toBeNull();
      expect(job!.status).toBe('completed');
      expect(metaApiCalls()).toHaveLength(0);
      expect(
        whatsAppStubCalls(logSpy, '+971507654323').some((line) =>
          line.includes(`New order #${order.id}`),
        ),
      ).toBe(true);
    });

    it('calls the Meta Cloud API with platform env credentials (not per-shop ones) once configured', async () => {
      process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = 'platform-phone-id';
      process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = 'platform-access-token';
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.platform1' }] }),
      });

      const { adminToken, outletId, productId } = await setupShop(
        'merchant-alert-real',
        false,
        false,
      );
      await request(app.getHttpServer())
        .patch(`/outlets/${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ phone: '0507654324' })
        .expect(200);

      const order = await createOrder(adminToken, outletId, productId, {});
      const job = await processOwnEmailJob(
        `order:${order.id}:merchant-whatsapp-alert`,
      );
      expect(job).not.toBeNull();
      expect(job!.status).toBe('completed');

      const calls = metaApiCalls();
      expect(calls).toHaveLength(1);
      const [url, init] = calls[0];
      expect(String(url)).toContain('/platform-phone-id/messages');
      expect(init.headers.Authorization).toBe('Bearer platform-access-token');
      const sentBody = JSON.parse(init.body);
      expect(sentBody.to).toBe('971507654324');
    });
  });

  describe('Real email provider (Resend)', () => {
    let fetchSpy: jest.SpyInstance;
    const originalKey = process.env.RESEND_API_KEY;
    // Also isolated, not just RESEND_API_KEY — this suite runs against
    // whatever real .env is loaded in this environment (see the "Wire in
    // the Resend API key for testing" task, which points the real
    // EMAIL_FROM_ADDRESS at Resend's sandbox sender), and asserting against
    // a hardcoded address would make this test's pass/fail depend on that
    // unrelated real config rather than on the code being tested.
    const originalFromAddress = process.env.EMAIL_FROM_ADDRESS;

    beforeEach(() => {
      fetchSpy = jest.spyOn(global, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
      if (originalKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalKey;
      if (originalFromAddress === undefined)
        delete process.env.EMAIL_FROM_ADDRESS;
      else process.env.EMAIL_FROM_ADDRESS = originalFromAddress;
    });

    it('calls the real Resend API (not the stub) once RESEND_API_KEY is configured', async () => {
      process.env.RESEND_API_KEY = 'test-resend-key';
      process.env.EMAIL_FROM_ADDRESS = 'notifications@requital.app';
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 're_fake' }),
      });

      const { adminToken, outletId, productId } = await setupShop(
        'email-real',
        true,
        false,
      );
      // Distinct from the admin's own signup email — setupShop's signup call
      // now also sends a real verification email once RESEND_API_KEY is set,
      // so fetchSpy sees that call too; filter to this order's own send.
      const email = `email-real-customer-${runId}@test.com`;
      const order = await createOrder(adminToken, outletId, productId, {
        customerEmail: email,
      });
      // Must process this order's own job in THIS process (not just wait for
      // it) — the real Resend `fetch` call only shows up in fetchSpy if it
      // happens here rather than in another concurrently-running spec
      // file's own worker (see processOwnEmailJob's comment).
      const job = await processOwnEmailJob(`order:${order.id}:confirmed-email`);
      expect(job).not.toBeNull();
      expect(job!.status).toBe('completed');

      const orderCalls = fetchSpy.mock.calls.filter(
        ([, init]) => JSON.parse(init.body).to === email,
      );
      expect(orderCalls.length).toBe(1);
      const [url, init] = orderCalls[0];
      expect(String(url)).toBe('https://api.resend.com/emails');
      expect(init.headers.Authorization).toBe('Bearer test-resend-key');
      const sentBody = JSON.parse(init.body);
      expect(sentBody.to).toBe(email);
      expect(sentBody.subject).toContain(`Order confirmation — #${order.id}`);
      expect(sentBody.from).toContain('<notifications@requital.app>');
      expect(sentBody.html).toContain('<p style=');

      // Real path taken — the stub must not also have logged for this order.
      expect(emailStubCalls(logSpy, email).length).toBe(0);
    });

    it('a Resend send failure does not block order creation, and gets retried by the queue rather than silently falling back to the stub', async () => {
      process.env.RESEND_API_KEY = 'test-resend-key';
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Invalid API key' }),
      });

      const { adminToken, outletId, productId } = await setupShop(
        'email-fail',
        true,
        false,
      );
      const email = `email-fail-customer-${runId}@test.com`;
      // Order creation itself must still return 201 despite the Resend call
      // failing — createOrder() already asserts .expect(201).
      const order = await createOrder(adminToken, outletId, productId, {
        customerEmail: email,
      });
      // Process this order's own job in THIS process — it must be the one
      // that actually attempts (and fails) the real Resend call, not
      // whichever process happens to claim it first.
      const job = await processOwnEmailJob(`order:${order.id}:confirmed-email`);
      expect(job).not.toBeNull();

      // Phase 5 behavior change: the queue's send_email handler uses
      // sendEmailOrThrow, not sendEmail's catch-and-stub-fallback — a real
      // delivery failure is a genuine job failure the queue retries with
      // backoff (and eventually dead-letters), not something silently
      // logged as if it succeeded via the stub.
      expect(emailStubCalls(logSpy, email).length).toBe(0);
      expect(job!.status).toBe('pending');
      expect(job!.attempts).toBe(1);
      expect(job!.lastError).toContain('401');
    });
  });
});

// Regression coverage for a real finding: checkout used to `await` the
// email+WhatsApp notification inline before returning — a slow or down
// provider would delay (and a throw would fail) an already-committed order.
// notifyOrderConfirmed/notifyOutForDelivery/notifySurveyRequest are now
// fire-and-forget (.catch()-guarded, never awaited) at every call site
// (PublicService.createOrder, OrdersService.create/updateStatus). This
// suite overrides OrderNotificationsService itself (a real provider
// substitution, not a spy) so it can simulate a hang/throw at the exact
// seam the fix changed, rather than only the "never throws internally"
// behavior the describe blocks above already cover one layer down.
describe('Order creation is non-blocking against a hanging or throwing notification provider (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();

  async function buildApp(
    notifyOrderConfirmed: () => Promise<void>,
  ): Promise<INestApplication<App>> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OrderNotificationsService)
      .useValue({
        notifyOrderConfirmed,
        notifyOutForDelivery: jest.fn().mockResolvedValue(undefined),
        notifySurveyRequest: jest.fn().mockResolvedValue(undefined),
      })
      .compile();
    const testApp: INestApplication<App> =
      moduleFixture.createNestApplication();
    testApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await testApp.init();
    return testApp;
  }

  afterEach(async () => {
    await prisma?.$disconnect();
    await app?.close();
  });

  async function setupPublishedShop(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Nonblocking Admin',
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
    const outletId = body<OutletRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pickupEnabled: true })
      .expect(200);

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nonblocking collection' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Nonblocking Product',
        price: 15,
        thumbnail: 'https://example.com/x.jpg',
        sku: `NONBLOCK-${slug}`,
        status: 'Available',
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    return { slug, outletId, productId: body<IdRow>(product).id };
  }

  it('a notification provider that hangs indefinitely does not delay the checkout response', async () => {
    // Never resolves — if the call site still awaited this, the request
    // itself would time out; asserting a fast response is the whole point.
    app = await buildApp(() => new Promise<void>(() => {}));
    prisma = app.get(PrismaService);
    const { slug, outletId, productId } =
      await setupPublishedShop('notify-hang');

    const start = Date.now();
    await request(app.getHttpServer())
      .post(`/public/${slug}/orders`)
      .send({
        customerName: 'Hang Customer',
        customerPhone: '0500000004',
        customerAddress: '3 Nonblocking Rd',
        emirate: 'Dubai',
        outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);
    // A hanging provider that actually blocked the response would take far
    // longer than this; a generous bound avoids flaking on a slow CI box
    // while still failing loudly if the fire-and-forget wiring regresses.
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it('a notification provider that throws does not fail order creation', async () => {
    app = await buildApp(() => Promise.reject(new Error('provider down')));
    prisma = app.get(PrismaService);
    const { slug, outletId, productId } =
      await setupPublishedShop('notify-throw');

    const res = await request(app.getHttpServer())
      .post(`/public/${slug}/orders`)
      .send({
        customerName: 'Throw Customer',
        customerPhone: '0500000005',
        customerAddress: '4 Nonblocking Rd',
        emirate: 'Dubai',
        outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);
    expect(body<{ order: OrderRow }>(res).order.status).toBe('pending');
  });
});
