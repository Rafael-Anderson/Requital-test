import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderNotificationsService } from '../src/orders/order-notifications.service';

interface AuthResponse {
  accessToken: string;
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

function body<T>(res: Response): T {
  return res.body as T;
}

// Same stub-observation approach as order-notifications.e2e-spec.ts.
function emailStubCalls(spy: jest.SpyInstance, to: string): string[] {
  return spy.mock.calls
    .map((args) => String(args[0]))
    .filter(
      (line) => line.startsWith('[email:stub]') && line.includes(`to=${to}`),
    );
}

// Same reasoning as order-notifications.e2e-spec.ts's own helper of this
// name: notifySurveyRequest is fire-and-forget as of the checkout-latency
// fix, so a status-transition request can return before the survey row/
// email it triggers has actually been created/sent.
function flushNotifications() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

// Most tests here drive an order through 4 sequential status transitions —
// when RESEND_API_KEY is configured in this environment, several of those
// attempt a real network round-trip to the Resend API before falling back
// to the stub, which can exceed Jest's 5s default under real latency.
jest.setTimeout(20000);

describe('Post-purchase survey (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
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
    customerSurveyEnabled: boolean,
    notifyEmail = true,
  ) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Survey Test Admin',
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
      .send({ customerSurveyEnabled, notifyEmail })
      .expect(200);

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Survey Item ${Math.random()}`,
        price: 25,
        thumbnail: 'https://example.com/x.jpg',
        sku: `SURVEY-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [body<IdRow>(category).id],
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
        customerName: 'Survey Customer',
        customerPhone: '0500000004',
        customerAddress: '1 Survey Rd',
        emirate: 'Dubai',
        outletId,
        items: [{ productId, quantity: 1 }],
        ...overrides,
      })
      .expect(201);
    await flushNotifications();
    return body<OrderRow>(res);
  }

  async function driveToDelivered(adminToken: string, orderId: number) {
    for (const status of [
      'confirmed',
      'preparing',
      'out_for_delivery',
      'delivered',
    ]) {
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status })
        .expect(200);
    }
    await flushNotifications();
  }

  // Longer timeout: signup + 4 status transitions, and (when RESEND_API_KEY
  // is configured in this environment) up to 3 of those calls attempt a real
  // network round-trip to the Resend API before falling back to the stub —
  // same reason order-notifications.e2e-spec.ts's own multi-transition tests
  // budget extra time.
  it('creates a survey row and sends the survey email when an order reaches delivered, gated on customerSurveyEnabled', async () => {
    const { adminToken, outletId, productId } = await setupShop(
      'survey-on',
      true,
    );
    const email = `survey-on-${runId}@test.com`;
    const order = await createOrder(adminToken, outletId, productId, {
      customerEmail: email,
    });
    logSpy.mockClear();

    await driveToDelivered(adminToken, order.id);

    const survey = await prisma.surveyresponse.findUnique({
      where: { orderId: order.id },
    });
    expect(survey).not.toBeNull();
    expect(survey?.respondedAt).toBeNull();

    // driveToDelivered's 'out_for_delivery' transition also emails this same
    // address (see order-notifications.e2e-spec.ts) — filter to the survey
    // email specifically, not just "any email sent to this customer".
    const calls = emailStubCalls(logSpy, email).filter((line) =>
      line.includes('How was your order'),
    );
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain(`#${order.id}`);
  });

  it('does NOT create a survey row when customerSurveyEnabled is off', async () => {
    const { adminToken, outletId, productId } = await setupShop(
      'survey-off',
      false,
    );
    const order = await createOrder(adminToken, outletId, productId, {});
    await driveToDelivered(adminToken, order.id);

    const survey = await prisma.surveyresponse.findUnique({
      where: { orderId: order.id },
    });
    expect(survey).toBeNull();
  });

  it('creates the survey row but sends no email when notifyEmail is off at the moment of delivery', async () => {
    const { adminToken, outletId, productId } = await setupShop(
      'survey-no-notify',
      true,
      false,
    );
    const email = `survey-no-notify-${runId}@test.com`;
    const order = await createOrder(adminToken, outletId, productId, {
      customerEmail: email,
    });
    logSpy.mockClear();

    await driveToDelivered(adminToken, order.id);

    const survey = await prisma.surveyresponse.findUnique({
      where: { orderId: order.id },
    });
    expect(survey).not.toBeNull();
    expect(emailStubCalls(logSpy, email).length).toBe(0);
  });

  it('is idempotent: calling notifySurveyRequest twice for the same order creates only one row and sends only one email', async () => {
    const { adminToken, outletId, productId } = await setupShop(
      'survey-idempotent',
      true,
    );
    const email = `survey-idempotent-${runId}@test.com`;
    const order = await createOrder(adminToken, outletId, productId, {
      customerEmail: email,
    });
    logSpy.mockClear();

    const orderNotificationsService = app.get(OrderNotificationsService);
    const shop = await prisma.shop.findFirstOrThrow({
      where: { name: { contains: 'survey-idempotent' } },
    });
    const notifiableOrder = {
      id: order.id,
      customerName: 'Survey Customer',
      customerEmail: email,
      customerPhone: '0500000004',
      orderType: null,
      total: '25',
    };
    await orderNotificationsService.notifySurveyRequest(
      shop.id,
      notifiableOrder,
    );
    await orderNotificationsService.notifySurveyRequest(
      shop.id,
      notifiableOrder,
    );

    const count = await prisma.surveyresponse.count({
      where: { orderId: order.id },
    });
    expect(count).toBe(1);
    expect(emailStubCalls(logSpy, email).length).toBe(1);
  });

  describe('public survey endpoints', () => {
    async function setupDeliveredOrderWithSurvey(slugPrefix: string) {
      const { adminToken, outletId, productId } = await setupShop(
        slugPrefix,
        true,
      );
      const order = await createOrder(adminToken, outletId, productId, {});
      await driveToDelivered(adminToken, order.id);
      const survey = await prisma.surveyresponse.findUniqueOrThrow({
        where: { orderId: order.id },
      });
      return { adminToken, order, token: survey.token };
    }

    it('GET /public/surveys/lookup returns the survey for a valid token', async () => {
      const { token } = await setupDeliveredOrderWithSurvey('survey-lookup');
      const res = await request(app.getHttpServer())
        .get(`/public/surveys/lookup?token=${token}`)
        .expect(200);
      expect(
        body<{ respondedAt: string | null; rating: number | null }>(res),
      ).toMatchObject({
        respondedAt: null,
        rating: null,
      });
    });

    it('GET /public/surveys/lookup 404s for an invalid token', async () => {
      await request(app.getHttpServer())
        .get('/public/surveys/lookup?token=NOTAREALTOKEN')
        .expect(404);
    });

    it('POST /public/surveys/submit records rating + comment and sets respondedAt', async () => {
      const { token, order } =
        await setupDeliveredOrderWithSurvey('survey-submit');
      await request(app.getHttpServer())
        .post(`/public/surveys/submit?token=${token}`)
        .send({ rating: 5, comment: 'Great service!' })
        .expect(201);

      const survey = await prisma.surveyresponse.findUniqueOrThrow({
        where: { orderId: order.id },
      });
      expect(survey.rating).toBe(5);
      expect(survey.comment).toBe('Great service!');
      expect(survey.respondedAt).not.toBeNull();
    });

    it('POST /public/surveys/submit rejects a second submission for the same token', async () => {
      const { token } = await setupDeliveredOrderWithSurvey(
        'survey-double-submit',
      );
      await request(app.getHttpServer())
        .post(`/public/surveys/submit?token=${token}`)
        .send({ rating: 4 })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/public/surveys/submit?token=${token}`)
        .send({ rating: 1 })
        .expect(400);
    });

    it('POST /public/surveys/submit 404s for an invalid token', async () => {
      await request(app.getHttpServer())
        .post('/public/surveys/submit?token=NOTAREALTOKEN')
        .send({ rating: 3 })
        .expect(404);
    });

    it('rejects an out-of-range rating', async () => {
      const { token } =
        await setupDeliveredOrderWithSurvey('survey-bad-rating');
      await request(app.getHttpServer())
        .post(`/public/surveys/submit?token=${token}`)
        .send({ rating: 6 })
        .expect(400);
    });
  });

  it("tenant isolation: shop B's admin cannot see shop A's survey response through the order detail endpoint", async () => {
    const shopA = await setupDeliveredOrderForIsolation('survey-iso-a');
    const shopB = await setupDeliveredOrderForIsolation('survey-iso-b');

    const resA = await request(app.getHttpServer())
      .get(`/orders/${shopA.order.id}`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(404);
    expect(resA.status).toBe(404);

    const resOwn = await request(app.getHttpServer())
      .get(`/orders/${shopA.order.id}`)
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    expect(
      body<{ surveyresponse: { id: number } | null }>(resOwn).surveyresponse,
    ).not.toBeNull();
  });

  async function setupDeliveredOrderForIsolation(slugPrefix: string) {
    const { adminToken, outletId, productId } = await setupShop(
      slugPrefix,
      true,
    );
    const order = await createOrder(adminToken, outletId, productId, {});
    await driveToDelivered(adminToken, order.id);
    return { adminToken, order };
  }
});
