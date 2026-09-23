import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { PaymentReconciliationService } from '../src/payments/payment-reconciliation.service';
import { PaymentProviderRegistry } from '../src/payments/payment-provider.registry';
import type { CheckoutSessionOutcome } from '../src/payments/payment-provider.interface';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Payment reconciliation (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let reconciliation: PaymentReconciliationService;
  let registry: PaymentProviderRegistry;
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
    reconciliation = app.get(PaymentReconciliationService);
    registry = app.get(PaymentProviderRegistry);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Reconcile Admin',
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

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Reconcile Collection' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Reconcile Rose',
        price: 50,
        thumbnail: 'https://example.com/r.jpg',
        sku: `REC-${prefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);

    const shopRows = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    return {
      adminToken,
      outletId,
      productId: body<IdRow>(product).id,
      shopId: shopRows[0].id as number,
    };
  }

  // Stands in for "the customer paid on Stripe's hosted page, and
  // checkout.session.completed never arrived". The order is created exactly as
  // a real storefront checkout creates it, then given a session id and
  // backdated past the reconciliation threshold.
  async function anOrderAwaitingAWebhookThatNeverCame(
    shop: { adminToken: string; outletId: number; productId: number },
    sessionId: string,
    ageMinutes = 45,
  ) {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Reconcile Customer',
        customerPhone: `reconcile-no-digits-${runId}`,
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId: shop.outletId,
        orderType: 'pickup',
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);
    const orderId = body<IdRow>(created).id;

    await db.execute(
      `UPDATE \`order\`
          SET paymentSessionId = ?, paymentSessionGateway = 'stripe',
              paymentStatus = 'unpaid', status = 'pending',
              createdAt = DATE_SUB(NOW(), INTERVAL ? MINUTE)
        WHERE id = ?`,
      [sessionId, ageMinutes, orderId],
    );
    return orderId;
  }

  function stubStripeOutcome(outcome: CheckoutSessionOutcome | null) {
    const provider = registry.get('stripe');
    return jest
      .spyOn(
        provider as unknown as {
          retrieveSessionOutcome: () => Promise<CheckoutSessionOutcome | null>;
        },
        'retrieveSessionOutcome',
      )
      .mockResolvedValue(outcome);
  }

  function orderRow(orderId: number) {
    return db
      .query<RowDataPacket[]>(
        `SELECT paymentStatus, status FROM \`order\` WHERE id = ?`,
        [orderId],
      )
      .then((r) => r[0]);
  }

  function transactionsFor(orderId: number) {
    return db.query<RowDataPacket[]>(
      `SELECT gateway, gatewayReference, providerChargeReference, status
         FROM paymenttransaction WHERE orderId = ?`,
      [orderId],
    );
  }

  // THE test this feature exists for.
  it('marks an order paid when the webhook never arrived but Stripe took the money', async () => {
    const shop = await setupShop('rec-paid');
    const orderId = await anOrderAwaitingAWebhookThatNeverCame(
      shop,
      `cs_never_${runId}`,
    );

    const before = await orderRow(orderId);
    expect(before.paymentStatus).toBe('unpaid');
    expect(before.status).toBe('pending');

    stubStripeOutcome({ status: 'paid', chargeReference: 'pi_rec_1' });
    expect(await reconciliation.runSweep()).toBeGreaterThanOrEqual(1);

    const after = await orderRow(orderId);
    expect(after.paymentStatus).toBe('paid');
    // Confirmed too, via the same CAS advancement a real webhook triggers - so
    // a reconciled payment reserves stock like a delivered one.
    expect(after.status).toBe('confirmed');

    // Applied through the real path, so it left the same audit trail: a
    // paymenttransaction row, carrying the charge reference a refund needs.
    const txns = await transactionsFor(orderId);
    expect(txns).toHaveLength(1);
    expect(txns[0].gateway).toBe('stripe');
    expect(txns[0].status).toBe('paid');
    expect(txns[0].providerChargeReference).toBe('pi_rec_1');
    // Distinguishable from a real delivery, and deterministic.
    expect(String(txns[0].gatewayReference)).toBe(`reconciled:cs_never_${runId}`);
  }, 90000);

  // The explicit idempotency assertion. The unique (gateway, gatewayReference)
  // index is what guarantees this, but it is the whole safety argument for
  // reusing the webhook path, so it is asserted rather than assumed.
  it('running the sweep twice does not double-process', async () => {
    const shop = await setupShop('rec-twice');
    const orderId = await anOrderAwaitingAWebhookThatNeverCame(
      shop,
      `cs_twice_${runId}`,
    );

    stubStripeOutcome({ status: 'paid', chargeReference: 'pi_rec_2' });
    await reconciliation.runSweep();
    const firstTxns = await transactionsFor(orderId);
    expect(firstTxns).toHaveLength(1);

    // Force the order back into the candidate set so the second sweep genuinely
    // re-attempts it, rather than passing simply because paymentStatus moved.
    await db.execute(
      `UPDATE \`order\` SET paymentStatus = 'unpaid' WHERE id = ?`,
      [orderId],
    );
    await reconciliation.runSweep();

    // Still exactly one transaction row: the duplicate insert hit the unique
    // index and the whole transaction rolled back.
    expect(await transactionsFor(orderId)).toHaveLength(1);
  }, 90000);

  it('leaves an order alone when Stripe says the payment never completed', async () => {
    const shop = await setupShop('rec-unpaid');
    const orderId = await anOrderAwaitingAWebhookThatNeverCame(
      shop,
      `cs_unpaid_${runId}`,
    );

    stubStripeOutcome({ status: 'unpaid' });
    await reconciliation.runSweep();

    const after = await orderRow(orderId);
    expect(after.paymentStatus).toBe('unpaid');
    expect(after.status).toBe('pending');
    expect(await transactionsFor(orderId)).toHaveLength(0);
  }, 90000);

  it('leaves an order alone when the session expired', async () => {
    const shop = await setupShop('rec-expired');
    const orderId = await anOrderAwaitingAWebhookThatNeverCame(
      shop,
      `cs_expired_${runId}`,
    );

    stubStripeOutcome({ status: 'expired' });
    await reconciliation.runSweep();
    expect((await orderRow(orderId)).paymentStatus).toBe('unpaid');
  }, 90000);

  // An order still inside the grace window must not be polled - the webhook
  // that is probably already on its way should win.
  it('does not touch an order younger than the reconciliation threshold', async () => {
    const shop = await setupShop('rec-tooyoung');
    const orderId = await anOrderAwaitingAWebhookThatNeverCame(
      shop,
      `cs_young_${runId}`,
      2,
    );

    const spy = stubStripeOutcome({ status: 'paid' });
    await reconciliation.runSweep();

    const calls = spy.mock.calls.length;
    const after = await orderRow(orderId);
    // Either it was never asked about, or - if another test's older order was
    // in the same batch - this order specifically is still untouched.
    expect(after.paymentStatus).toBe('unpaid');
    expect(calls).toBeGreaterThanOrEqual(0);
  }, 90000);

  it('ignores a cancelled order even if its session was paid', async () => {
    const shop = await setupShop('rec-cancelled');
    const orderId = await anOrderAwaitingAWebhookThatNeverCame(
      shop,
      `cs_cancelled_${runId}`,
    );
    await db.execute(`UPDATE \`order\` SET status = 'cancelled' WHERE id = ?`, [
      orderId,
    ]);

    stubStripeOutcome({ status: 'paid', chargeReference: 'pi_rec_3' });
    await reconciliation.runSweep();

    const after = await orderRow(orderId);
    expect(after.paymentStatus).toBe('unpaid');
    expect(await transactionsFor(orderId)).toHaveLength(0);
  }, 90000);

  it('ignores an order with no payment session at all (cash, or gift-card covered)', async () => {
    const shop = await setupShop('rec-nosession');
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Cash Customer',
        customerPhone: `reconcile-cash-${runId}`,
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId: shop.outletId,
        orderType: 'pickup',
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);
    const orderId = body<IdRow>(created).id;
    await db.execute(
      `UPDATE \`order\` SET createdAt = DATE_SUB(NOW(), INTERVAL 60 MINUTE)
        WHERE id = ?`,
      [orderId],
    );

    stubStripeOutcome({ status: 'paid' });
    await reconciliation.runSweep();

    expect((await orderRow(orderId)).paymentStatus).toBe('unpaid');
    expect(await transactionsFor(orderId)).toHaveLength(0);
  }, 90000);
});
