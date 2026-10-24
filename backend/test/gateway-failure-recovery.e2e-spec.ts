import 'dotenv/config';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { PaymentProviderRegistry } from '../src/payments/payment-provider.registry';
import { PaymentProviderNotConfiguredException } from '../src/payments/payment-provider-not-configured.exception';
import { PaymentsService } from '../src/payments/payments.service';
import { OrderNotificationsService } from '../src/orders/order-notifications.service';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
} from '../src/payments/payment-provider.interface';
import { registerCustomer } from './helpers/customer-session';
import { bootApp, makeFixtures, body } from './helpers/w5-fixture';

jest.setTimeout(240000);

// F8. A payment gateway that fails AFTER the order transaction committed used to
// leave an unpayable pending order holding stock, a discount use, a gift card
// balance and store credit, with the customer and the merchant already told. This
// drives the real checkout against a gateway double that throws, and asserts the
// recovery (auto-cancel, everything given back, nobody notified), the idempotent
// checkout that stops a retry creating a second order, and the "usable gateway"
// gate. Pattern: payment-return-urls.e2e-spec.ts (a stub registered under the real
// gateway's own name, so PublicService resolves it exactly as it does the real one).
class ControllableProvider implements PaymentProvider {
  calls: CreateCheckoutSessionParams[] = [];
  mode: 'ok' | 'throw' = 'ok';
  // What a throwing gateway throws (default: a raw error full of secrets).
  error: Error | null = null;
  usable = true;
  // What the stub saw at the moment the gateway was asked: whether the customer
  // "received" message had already been sent.
  notifiedWhenAsked: number[] = [];
  constructor(
    readonly name: string,
    private readonly notified: () => number,
  ) {}
  isUsable() {
    return this.usable;
  }
  // Holds every call open until released (a slow gateway).
  gate: Promise<void> | null = null;
  // Runs inside the gateway call, before it answers (the world moving on).
  hook: ((p: CreateCheckoutSessionParams) => Promise<void>) | null = null;
  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    this.calls.push(params);
    this.notifiedWhenAsked.push(this.notified());
    // Only the NEXT call is held (one slow request among normal ones).
    const gate = this.gate;
    this.gate = null;
    if (gate) await gate;
    if (this.hook) await this.hook(params);
    if (this.mode === 'throw') {
      throw (
        this.error ??
        new Error('stripe says: api_key sk_live_TOPSECRET is invalid (req_123)')
      );
    }
    return {
      checkoutUrl: `https://stub.example/pay/${this.calls.length}`,
      providerReference: `stub_${this.name}_${params.orderId}_${this.calls.length}`,
    };
  }
  parseWebhookEvent() {
    return null;
  }
}

describe('Gateway failure recovery and idempotent checkout (e2e)', () => {
  let app: Awaited<ReturnType<typeof bootApp>>['app'];
  let db: Awaited<ReturnType<typeof bootApp>>['db'];
  let f: ReturnType<typeof makeFixtures>;
  let stripe: ControllableProvider;
  let tabby: ControllableProvider;
  let notifySpy: jest.SpyInstance;

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
    const notifications = app.get(OrderNotificationsService);
    notifySpy = jest
      .spyOn(notifications, 'notifyOrderConfirmed')
      .mockResolvedValue(undefined);
    const registry = app.get(PaymentProviderRegistry);
    stripe = new ControllableProvider(
      'stripe',
      () => notifySpy.mock.calls.length,
    );
    tabby = new ControllableProvider(
      'tabby',
      () => notifySpy.mock.calls.length,
    );
    registry.register(stripe);
    registry.register(tabby);
  });
  afterAll(async () => {
    await db.execute(
      `UPDATE \`order\` o JOIN shop s ON s.id = o.shopId
          SET o.paymentSessionId = NULL, o.paymentSessionGateway = NULL
        WHERE s.subdomain LIKE ?`,
      [`%-${f.runId}`],
    );
    await app.close();
  });
  beforeEach(() => {
    stripe.mode = 'ok';
    stripe.usable = true;
    tabby.usable = true;
    tabby.mode = 'ok';
    tabby.error = null;
    stripe.gate = null;
    stripe.hook = null;
    stripe.error = null;
  });

  type Shop = Awaited<ReturnType<typeof f.setupShop>>;
  let phoneSeq = 0;
  const newPhone = () => `0507${String(Date.now() % 100000)}${++phoneSeq % 10}`;
  const newKey = () => randomUUID();

  async function shopWithStock(prefix: string, stock = 10) {
    const shop = await f.setupShop(prefix);
    const product = await f.stockedProduct(shop, stock);
    await f.publish(shop);
    await db.execute(`UPDATE outlet SET phone = '0501112222' WHERE id = ?`, [
      shop.outletId,
    ]);
    return { shop, product };
  }
  const orders = (shop: Shop) =>
    db.query<RowDataPacket[]>(
      `SELECT id, status, paymentStatus, paymentSessionId, storeCreditAmount, giftCardAmount
         FROM \`order\` WHERE shopId = ? ORDER BY id`,
      [shop.shopId],
    );
  const timesUsed = async (discountId: number) =>
    Number(
      (
        await db.query<RowDataPacket[]>(
          `SELECT timesUsed FROM discount WHERE id = ?`,
          [discountId],
        )
      )[0].timesUsed,
    );
  const redemptionRows = async (discountId: number) =>
    (
      await db.query<RowDataPacket[]>(
        `SELECT id FROM discountredemption WHERE discountId = ?`,
        [discountId],
      )
    ).length;
  const giftBalance = async (cardId: number) =>
    Number(
      (
        await db.query<RowDataPacket[]>(
          `SELECT remainingBalance FROM giftcard WHERE id = ?`,
          [cardId],
        )
      )[0].remainingBalance,
    );
  const giftRedeemed = async (cardId: number) =>
    Number(
      (
        await db.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(amountUsed), 0) AS s FROM giftcardredemption WHERE giftCardId = ?`,
          [cardId],
        )
      )[0].s,
    );
  const creditSum = async (customerId: number) =>
    Number(
      (
        await db.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(amount), 0) AS s FROM storecreditentry WHERE customerId = ? AND currency = 'AED'`,
          [customerId],
        )
      )[0].s,
    );
  const jobsFor = (orderId: number) =>
    db.query<RowDataPacket[]>(
      `SELECT idempotencyKey, status FROM job WHERE idempotencyKey LIKE ?`,
      [`order:${orderId}:%`],
    );
  const settle = () => new Promise((r) => setTimeout(r, 400));

  async function withTenders(prefix: string, stock = 10) {
    const { shop, product } = await shopWithStock(prefix, stock);
    const discount = await f.createDiscount(shop, { usageLimit: 5 });
    const card = body<{ id: number; code: string }>(
      await request(f.http())
        .post('/gift-cards')
        .set(f.auth(shop))
        .send({ initialValue: 5 })
        .expect(201),
    );
    const phone = newPhone();
    const customer = await registerCustomer(
      f.http(),
      shop.slug,
      phone,
      `f8-${f.uniq()}@x.test`,
    );
    await request(f.http())
      .post(`/customers/${customer.customerId}/store-credit/adjustments`)
      .set(f.auth(shop))
      .send({
        currency: 'AED',
        amount: 20,
        direction: 'grant',
        reason: 'goodwill',
      })
      .expect(201);
    return { shop, product, discount, card, customer, phone };
  }

  function place(
    shop: Shop,
    payload: Record<string, unknown>,
    customer?: { cookie: string; csrf: string },
  ) {
    const req = request(f.http()).post(`/public/${shop.slug}/orders`);
    if (customer)
      req.set('Cookie', customer.cookie).set('X-CSRF-Token', customer.csrf);
    return req.send({
      outletId: shop.outletId,
      orderType: 'pickup',
      customerName: 'F8 Shopper',
      customerPhone: '0509990000',
      customerEmail: 'f8@x.test',
      customerAddress: 'Pickup',
      ...payload,
    });
  }

  describe('a gateway that throws after the order committed', () => {
    it('auto-cancels, gives back every tender, notifies nobody, and answers with a safe error', async () => {
      const t = await withTenders('f8-fail');
      stripe.mode = 'throw';
      notifySpy.mockClear();
      const key = newKey();
      const payload = {
        paymentMethod: 'card_online',
        customerPhone: t.phone,
        items: [{ productId: t.product.id, quantity: 2 }],
        discountCode: t.discount.code,
        giftCardCode: t.card.code,
        useStoreCredit: true,
        idempotencyKey: key,
      };
      const res = await place(t.shop, payload, t.customer);

      // Customer-safe error: a stable code, no gateway text, no key, no ids.
      expect(res.status).toBe(503);
      const err = body<{ statusCode: number; code: string; message: string }>(
        res,
      );
      expect(err.code).toBe('payment_unavailable');
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/sk_live|TOPSECRET|req_123|stripe says|stripe/i);
      expect(raw).not.toContain(key);
      expect(err.message).not.toContain('—');

      // One order, cancelled, never paid, no session.
      const rows = await orders(t.shop);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('cancelled');
      expect(rows[0].paymentStatus).toBe('unpaid');
      expect(rows[0].paymentSessionId).toBeNull();
      // It really did take the tenders (so the givebacks below are meaningful).
      expect(Number(rows[0].storeCreditAmount)).toBe(20);
      expect(Number(rows[0].giftCardAmount)).toBe(5);

      // Everything it held is back.
      expect(await f.productStock(t.shop.outletId, t.product.id)).toBe(10);
      const ing = (await f.shadowIngredientId(t.product.id))!;
      expect(await f.ledgerSum(t.shop.outletId, ing)).toBe(10);
      expect(await timesUsed(t.discount.id)).toBe(0);
      expect(await redemptionRows(t.discount.id)).toBe(0);
      expect(await giftBalance(t.card.id)).toBe(5);
      expect(await giftRedeemed(t.card.id)).toBe(0);
      expect(await creditSum(t.customer.customerId)).toBe(20);

      // Nobody was told about an order that never became payable.
      await settle();
      expect(notifySpy).not.toHaveBeenCalled();
      expect(await jobsFor(rows[0].id as number)).toHaveLength(0);

      // Attributed to the system, with a clear label and no staff user.
      const audit = await db.query<RowDataPacket[]>(
        `SELECT actorUserId, actorLabel, \`after\`, metadata FROM auditlog
          WHERE shopId = ? AND entityType = 'order' AND entityId = ?`,
        [t.shop.shopId, rows[0].id as number],
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].actorUserId).toBeNull();
      expect(audit[0].actorLabel).toBe('system (payment gateway failure)');

      // The failed attempt is closed: replaying its key never revives it...
      const replay = await place(t.shop, payload, t.customer);
      expect(replay.status).toBe(409);
      expect(body<{ code: string }>(replay).code).toBe(
        'checkout_attempt_closed',
      );
      expect(await orders(t.shop)).toHaveLength(1);

      // ...and a fresh attempt once the gateway is back works and spends the
      // tenders again exactly once.
      stripe.mode = 'ok';
      const retry = await place(
        t.shop,
        { ...payload, idempotencyKey: newKey() },
        t.customer,
      );
      expect(retry.status).toBe(201);
      expect(body<{ checkoutUrl: string }>(retry).checkoutUrl).toMatch(
        /^https:\/\/stub/,
      );
      expect(await timesUsed(t.discount.id)).toBe(1);
      expect(await giftRedeemed(t.card.id)).toBe(5);
      expect(await creditSum(t.customer.customerId)).toBe(0);
      expect(await f.productStock(t.shop.outletId, t.product.id)).toBe(8);
    });

    it('also covers a gateway that is simply not configured (the provider guard throws)', async () => {
      const { shop, product } = await shopWithStock('f8-unconf');
      // tabby with no enabled row is refused up front; enable it, and let the
      // provider throw the way a real unconfigured one does.
      await db.execute(
        `INSERT INTO shoppaymentprovider (shopId, provider, enabled) VALUES (?, 'tabby', 1)
         ON DUPLICATE KEY UPDATE enabled = 1`,
        [shop.shopId],
      );
      tabby.mode = 'throw';
      tabby.error = new PaymentProviderNotConfiguredException('Tabby');
      try {
        const res = await place(shop, {
          paymentMethod: 'tabby',
          items: [{ productId: product.id, quantity: 1 }],
        });
        expect(res.status).toBe(503);
        expect(JSON.stringify(res.body)).not.toMatch(/tabby/i);
        const rows = await orders(shop);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('cancelled');
        expect(await f.productStock(shop.outletId, product.id)).toBe(10);
      } finally {
        tabby.mode = 'ok';
        tabby.error = null;
      }
    });

    it('voids the gift cards the failed order SOLD and dismisses their email', async () => {
      const shop = await f.setupShop('f8-sold');
      const card = await f.createProduct(shop, {
        isGiftCard: true,
        giftCardDenominations: [100, 200],
        trackInventory: false,
        price: 1,
      });
      await f.publish(shop);
      stripe.mode = 'throw';
      const res = await place(shop, {
        paymentMethod: 'card_online',
        items: [{ productId: card.id, quantity: 1, giftCardAmount: 200 }],
      });
      expect(res.status).toBe(503);
      const orderId = (await orders(shop))[0].id as number;
      const cards = await db.query<RowDataPacket[]>(
        `SELECT status FROM giftcard WHERE purchaseOrderId = ? AND shopId = ?`,
        [orderId, shop.shopId],
      );
      expect(cards).toHaveLength(1);
      expect(cards[0].status).toBe('disabled');
      const mail = await db.query<RowDataPacket[]>(
        `SELECT status FROM job WHERE idempotencyKey = ?`,
        [`gift-card-issued-email:${orderId}`],
      );
      expect(mail.every((j) => j.status === 'dismissed')).toBe(true);
    });
  });

  describe('every cancel gives the gift card balance back', () => {
    async function orderWithCard(prefix: string) {
      const { shop, product } = await shopWithStock(prefix);
      const card = body<{ id: number; code: string }>(
        await request(f.http())
          .post('/gift-cards')
          .set(f.auth(shop))
          .send({ initialValue: 30 })
          .expect(201),
      );
      const res = await place(shop, {
        paymentMethod: 'cash_on_pickup',
        items: [{ productId: product.id, quantity: 1 }],
        giftCardCode: card.code,
      }).expect(201);
      return {
        shop,
        card,
        orderId: body<{ order: { id: number } }>(res).order.id,
      };
    }

    it('a pending order, once, even if the cancel is retried', async () => {
      const { shop, card, orderId } = await orderWithCard('f8-cx1');
      expect(await giftBalance(card.id)).toBe(0);
      await f.cancelOrder(shop, orderId).expect(201);
      expect(await giftBalance(card.id)).toBe(30);
      expect(await giftRedeemed(card.id)).toBe(0);
      await f.cancelOrder(shop, orderId).expect(400);
      expect(await giftBalance(card.id)).toBe(30);
    });

    it('a confirmed order (stock already decremented at confirm for non-storefront, reserved at creation here)', async () => {
      const { shop, card, orderId } = await orderWithCard('f8-cx2');
      await f.setStatus(shop, orderId, 'confirmed');
      await f.cancelOrder(shop, orderId).expect(201);
      expect(await giftBalance(card.id)).toBe(30);
      expect(await giftRedeemed(card.id)).toBe(0);
    });
  });

  describe('announcements wait for a payment session', () => {
    it('the customer message and merchant alert go out only after the session exists (online), right after commit (pickup)', async () => {
      const { shop, product } = await shopWithStock('f8-notify');
      notifySpy.mockClear();
      const online = await place(shop, {
        paymentMethod: 'card_online',
        items: [{ productId: product.id, quantity: 1 }],
      });
      expect(online.status).toBe(201);
      // At the moment the gateway was asked, nothing had been announced.
      expect(
        stripe.notifiedWhenAsked[stripe.notifiedWhenAsked.length - 1],
      ).toBe(0);
      await settle();
      expect(notifySpy).toHaveBeenCalledTimes(1);

      const cod = await place(shop, {
        paymentMethod: 'cash_on_pickup',
        items: [{ productId: product.id, quantity: 1 }],
      });
      expect(cod.status).toBe(201);
      await settle();
      expect(notifySpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('idempotent checkout', () => {
    it('a replayed key returns the same order and never spends a tender twice', async () => {
      const t = await withTenders('f8-idem');
      notifySpy.mockClear();
      const payload = {
        paymentMethod: 'cash_on_pickup',
        customerPhone: t.phone,
        items: [{ productId: t.product.id, quantity: 2 }],
        discountCode: t.discount.code,
        giftCardCode: t.card.code,
        useStoreCredit: true,
        idempotencyKey: newKey(),
      };
      const a = await place(t.shop, payload, t.customer);
      expect(a.status).toBe(201);
      const b = await place(t.shop, payload, t.customer);
      expect(b.status).toBe(201);
      const aOrder = body<{ order: { id: number; total: string } }>(a).order;
      const bOrder = body<{ order: { id: number; total: string } }>(b).order;
      expect(bOrder.id).toBe(aOrder.id);
      expect(bOrder.total).toBe(aOrder.total);

      expect(await orders(t.shop)).toHaveLength(1);
      expect(await f.productStock(t.shop.outletId, t.product.id)).toBe(8);
      expect(await timesUsed(t.discount.id)).toBe(1);
      expect(await redemptionRows(t.discount.id)).toBe(1);
      expect(await giftRedeemed(t.card.id)).toBe(5);
      expect(await creditSum(t.customer.customerId)).toBe(0);
      await settle();
      expect(notifySpy).toHaveBeenCalledTimes(1);

      // The internal columns never reach a client.
      expect(JSON.stringify(a.body)).not.toMatch(/idempotency/i);
      expect(JSON.stringify(b.body)).not.toMatch(/idempotency/i);
    });

    it('two simultaneous submits with one key create ONE order', async () => {
      const t = await withTenders('f8-race');
      const payload = {
        paymentMethod: 'cash_on_pickup',
        customerPhone: t.phone,
        items: [{ productId: t.product.id, quantity: 1 }],
        discountCode: t.discount.code,
        giftCardCode: t.card.code,
        idempotencyKey: newKey(),
      };
      const [a, b] = await Promise.all([
        place(t.shop, payload),
        place(t.shop, payload),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(body<{ order: { id: number } }>(a).order.id).toBe(
        body<{ order: { id: number } }>(b).order.id,
      );
      expect(await orders(t.shop)).toHaveLength(1);
      expect(await f.productStock(t.shop.outletId, t.product.id)).toBe(9);
      expect(await timesUsed(t.discount.id)).toBe(1);
      expect(await giftRedeemed(t.card.id)).toBe(5);
    });

    it('the same key with a different request is a 409 and creates nothing', async () => {
      const { shop, product } = await shopWithStock('f8-mismatch');
      const key = newKey();
      const base = {
        paymentMethod: 'cash_on_pickup',
        items: [{ productId: product.id, quantity: 1 }],
        idempotencyKey: key,
      };
      await place(shop, base).expect(201);
      const other = await place(shop, {
        ...base,
        items: [{ productId: product.id, quantity: 3 }],
      });
      expect(other.status).toBe(409);
      expect(body<{ code: string }>(other).code).toBe('idempotency_key_reused');
      expect(await orders(shop)).toHaveLength(1);
      expect(await f.productStock(shop.outletId, product.id)).toBe(9);
    });

    it('keys are per shop, and a malformed key is a 400', async () => {
      const a = await shopWithStock('f8-ka');
      const b = await shopWithStock('f8-kb');
      const key = newKey();
      const ra = await place(a.shop, {
        paymentMethod: 'cash_on_pickup',
        items: [{ productId: a.product.id, quantity: 1 }],
        idempotencyKey: key,
      }).expect(201);
      const rb = await place(b.shop, {
        paymentMethod: 'cash_on_pickup',
        items: [{ productId: b.product.id, quantity: 1 }],
        idempotencyKey: key,
      }).expect(201);
      expect(body<{ order: { id: number } }>(ra).order.id).not.toBe(
        body<{ order: { id: number } }>(rb).order.id,
      );
      await place(a.shop, {
        paymentMethod: 'cash_on_pickup',
        items: [{ productId: a.product.id, quantity: 1 }],
        idempotencyKey: 'short',
      }).expect(400);
    });

    it('an unpaid online order replayed gets a fresh session for the SAME order, and none once it is paid', async () => {
      const { shop, product } = await shopWithStock('f8-online');
      const payload = {
        paymentMethod: 'card_online',
        items: [{ productId: product.id, quantity: 1 }],
        idempotencyKey: newKey(),
      };
      const before = stripe.calls.length;
      const first = await place(shop, payload).expect(201);
      const again = await place(shop, payload).expect(201);
      const id = body<{ order: { id: number } }>(first).order.id;
      expect(body<{ order: { id: number } }>(again).order.id).toBe(id);
      expect(body<{ checkoutUrl: string }>(again).checkoutUrl).toMatch(
        /^https:\/\/stub/,
      );
      expect(stripe.calls.length).toBe(before + 2);
      expect(stripe.calls[before + 1].orderId).toBe(id);
      expect(await orders(shop)).toHaveLength(1);

      await db.execute(
        `UPDATE \`order\` SET paymentStatus = 'paid' WHERE id = ?`,
        [id],
      );
      const paid = await place(shop, payload).expect(201);
      expect(body<{ checkoutUrl: string | null }>(paid).checkoutUrl).toBeNull();
      expect(stripe.calls.length).toBe(before + 2);
    });
  });

  describe('a gateway without usable credentials is not offered', () => {
    it('hides it from the storefront shop payload and refuses the order before anything is written', async () => {
      const { shop, product } = await shopWithStock('f8-usable');
      await db.execute(
        `INSERT INTO shoppaymentprovider (shopId, provider, enabled) VALUES (?, 'tabby', 1)
         ON DUPLICATE KEY UPDATE enabled = 1`,
        [shop.shopId],
      );
      const shopPayload = async () =>
        body<{
          cardProcessorEnabled: boolean;
          enabledPaymentProviders: string[];
        }>(await request(f.http()).get(`/public/${shop.slug}`).expect(200));
      let p = await shopPayload();
      expect(p.cardProcessorEnabled).toBe(true);
      expect(p.enabledPaymentProviders).toContain('tabby');

      stripe.usable = false;
      tabby.usable = false;
      p = await shopPayload();
      expect(p.cardProcessorEnabled).toBe(false);
      expect(p.enabledPaymentProviders).not.toContain('tabby');

      for (const paymentMethod of ['card_online', 'tabby']) {
        const res = await place(shop, {
          paymentMethod,
          items: [{ productId: product.id, quantity: 1 }],
        });
        expect(res.status).toBe(400);
      }
      expect(await orders(shop)).toHaveLength(0);
      expect(await f.productStock(shop.outletId, product.id)).toBe(10);
      // Cash on pickup is unaffected.
      await place(shop, {
        paymentMethod: 'cash_on_pickup',
        items: [{ productId: product.id, quantity: 1 }],
      }).expect(201);
    });
  });

  // ---- review findings (H1, M1, L1, L3, L4) ----
  describe('a payment can never land on a cancelled order unannounced (H1)', () => {
    const deliverPaid = (shop: Shop, orderId: number, ref: string) =>
      app.get(PaymentsService).applyWebhookResult(
        'stripe',
        'stripe',
        {
          providerReference: `${ref}_${f.runId}`,
          orderId,
          status: 'paid',
          chargeReference: `ch_${ref}`,
        },
        shop.shopId,
      );
    const txRows = (orderId: number) =>
      db.query<RowDataPacket[]>(
        `SELECT gatewayReference, status FROM paymenttransaction WHERE orderId = ? ORDER BY id`,
        [orderId],
      );
    const lateJobs = (orderId: number) =>
      db.query<RowDataPacket[]>(
        `SELECT payload FROM job WHERE idempotencyKey = ?`,
        [`order:${orderId}:late-payment`],
      );
    const orderOf = async (orderId: number) =>
      (
        await db.query<RowDataPacket[]>(
          `SELECT status, paymentStatus, paymentSessionId, paymentSessionClaimedAt FROM \`order\` WHERE id = ?`,
          [orderId],
        )
      )[0];
    const onlinePayload = (productId: number, key = newKey()) => ({
      paymentMethod: 'card_online',
      items: [{ productId, quantity: 1 }],
      idempotencyKey: key,
    });

    it('a replay that fails AFTER a live session leaves the order pending and cancels nothing; the live session still settles it', async () => {
      const { shop, product } = await shopWithStock('f8-h1a');
      const payload = onlinePayload(product.id);
      const first = await place(shop, payload).expect(201);
      const id = body<{ order: { id: number } }>(first).order.id;
      const s1 = (await orderOf(id)).paymentSessionId as string;
      expect(s1).toMatch(/^stub_stripe_/);

      stripe.mode = 'throw';
      const replay = await place(shop, payload);
      expect(replay.status).toBe(503);
      const err = body<{ code: string; message: string }>(replay);
      expect(err.code).toBe('payment_session_unavailable');
      // The order exists, so the message must not claim it was not placed.
      expect(err.message).not.toMatch(/not placed|not been charged/i);

      const row = await orderOf(id);
      expect(row.status).toBe('pending');
      expect(row.paymentStatus).toBe('unpaid');
      expect(row.paymentSessionId).toBe(s1);
      expect(row.paymentSessionClaimedAt).toBeNull();
      expect(await f.productStock(shop.outletId, product.id)).toBe(9);
      const audit = await db.query<RowDataPacket[]>(
        `SELECT id FROM auditlog WHERE shopId = ? AND entityType = 'order' AND entityId = ?`,
        [shop.shopId, id],
      );
      expect(audit).toHaveLength(0);

      // S1 is still payable, and paying it settles the (still pending) order.
      await deliverPaid(shop, id, 'evt_h1a');
      const paid = await orderOf(id);
      expect(paid.paymentStatus).toBe('paid');
      expect(paid.status).toBe('pending');
      expect(await lateJobs(id)).toHaveLength(0);
    });

    it('a payment for an AUTO-cancelled order is recorded, the order stays cancelled and unpaid, and the merchant is alerted once', async () => {
      const { shop, product } = await shopWithStock('f8-h1b');
      stripe.mode = 'throw';
      const res = await place(shop, onlinePayload(product.id));
      expect(res.status).toBe(503);
      const id = (await orders(shop))[0].id as number;
      expect((await orderOf(id)).status).toBe('cancelled');

      await deliverPaid(shop, id, 'evt_h1b_1');
      const row = await orderOf(id);
      expect(row.status).toBe('cancelled');
      expect(row.paymentStatus).toBe('unpaid');
      expect(await txRows(id)).toEqual([
        expect.objectContaining({
          gatewayReference: `evt_h1b_1_${f.runId}`,
          status: 'paid',
        }),
      ]);
      let jobs = await lateJobs(id);
      expect(jobs).toHaveLength(1);
      const payload = jobs[0].payload as { body: string };
      expect(payload.body).toMatch(
        /^Payment received for cancelled order #\d+\. Refund it in the payment provider\.$/,
      );

      // The same event again, and a second payment event: no second alert.
      await deliverPaid(shop, id, 'evt_h1b_1');
      await deliverPaid(shop, id, 'evt_h1b_2');
      expect(await txRows(id)).toHaveLength(2);
      jobs = await lateJobs(id);
      expect(jobs).toHaveLength(1);
      // Nothing it released was taken again.
      expect(await f.productStock(shop.outletId, product.id)).toBe(10);
    });

    it('a staff cancel followed by a paid event is handled the same way', async () => {
      const { shop, product } = await shopWithStock('f8-h1c');
      const res = await place(shop, onlinePayload(product.id)).expect(201);
      const id = body<{ order: { id: number } }>(res).order.id;
      await f.cancelOrder(shop, id).expect(201);

      await deliverPaid(shop, id, 'evt_h1c');
      const row = await orderOf(id);
      expect(row.status).toBe('cancelled');
      expect(row.paymentStatus).toBe('unpaid');
      expect(await txRows(id)).toHaveLength(1);
      expect(await lateJobs(id)).toHaveLength(1);
    });

    it('a failed-payment event for a cancelled order raises nothing', async () => {
      const { shop, product } = await shopWithStock('f8-h1d');
      const res = await place(shop, onlinePayload(product.id)).expect(201);
      const id = body<{ order: { id: number } }>(res).order.id;
      await f.cancelOrder(shop, id).expect(201);
      await app
        .get(PaymentsService)
        .applyWebhookResult(
          'stripe',
          'stripe',
          {
            providerReference: `evt_h1d_${f.runId}`,
            orderId: id,
            status: 'failed',
          },
          shop.shopId,
        );
      expect(await lateJobs(id)).toHaveLength(0);
    });
  });

  describe('one payment session at a time per order (M1)', () => {
    const waitForCalls = async (n: number) => {
      for (let i = 0; i < 100 && stripe.calls.length < n; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(stripe.calls.length).toBeGreaterThanOrEqual(n);
    };
    const open = () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      return { gate, release };
    };
    const payload = (productId: number) => ({
      paymentMethod: 'card_online',
      items: [{ productId, quantity: 1 }],
      idempotencyKey: newKey(),
    });

    it('a submit while the first is still asking the gateway is told it is being prepared; no second session is minted', async () => {
      const { shop, product } = await shopWithStock('f8-m1a');
      const body1 = payload(product.id);
      const { gate, release } = open();
      stripe.gate = gate;
      const before = stripe.calls.length;
      const a = place(shop, body1).then((r) => r);
      await waitForCalls(before + 1);

      const b = await place(shop, body1);
      expect(b.status).toBe(409);
      expect(body<{ code: string }>(b).code).toBe(
        'payment_session_in_progress',
      );
      expect(stripe.calls.length).toBe(before + 1);

      release();
      const aRes = await a;
      expect(aRes.status).toBe(201);
      expect(body<{ checkoutUrl: string }>(aRes).checkoutUrl).toMatch(
        /^https:\/\/stub/,
      );
      const row = (await orders(shop))[0];
      expect(row.paymentSessionId).toMatch(/^stub_stripe_/);
      const lease = await db.query<RowDataPacket[]>(
        `SELECT paymentSessionClaimedAt FROM \`order\` WHERE id = ?`,
        [row.id],
      );
      expect(lease[0].paymentSessionClaimedAt).toBeNull();
      // Once recorded, a later replay (Back from the gateway) mints normally.
      await place(shop, body1).expect(201);
    });

    it('if the first attempt then fails and nothing was recorded, the order is cancelled', async () => {
      const { shop, product } = await shopWithStock('f8-m1b');
      const body1 = payload(product.id);
      const { gate, release } = open();
      stripe.gate = gate;
      stripe.mode = 'throw';
      const before = stripe.calls.length;
      const a = place(shop, body1).then((r) => r);
      await waitForCalls(before + 1);
      await place(shop, body1).expect(409);
      release();
      const aRes = await a;
      expect(aRes.status).toBe(503);
      expect(body<{ code: string }>(aRes).code).toBe('payment_unavailable');
      expect((await orders(shop))[0].status).toBe('cancelled');
      expect(await f.productStock(shop.outletId, product.id)).toBe(10);
    });

    it('a lapsed lease is taken over, and the slow original then cannot cancel the order the takeover holds a session for', async () => {
      const { shop, product } = await shopWithStock('f8-m1c');
      const body1 = payload(product.id);
      const { gate, release } = open();
      stripe.gate = gate;
      const before = stripe.calls.length;
      const a = place(shop, body1).then((r) => r);
      await waitForCalls(before + 1);
      const id = (await orders(shop))[0].id as number;
      // The original has been stuck past the lease window.
      await db.execute(
        `UPDATE \`order\` SET paymentSessionClaimedAt = NOW(3) - INTERVAL 3 MINUTE WHERE id = ?`,
        [id],
      );

      // The shopper's replay mints a session of its own and is sent to pay it.
      const b = await place(shop, body1).expect(201);
      const s2 = (
        await db.query<RowDataPacket[]>(
          `SELECT paymentSessionId FROM \`order\` WHERE id = ?`,
          [id],
        )
      )[0].paymentSessionId as string;
      expect(body<{ checkoutUrl: string }>(b).checkoutUrl).toMatch(
        /^https:\/\/stub/,
      );

      // Now the original gives up. It must NOT cancel: S2 is live and payable.
      stripe.mode = 'throw';
      release();
      const aRes = await a;
      expect(aRes.status).toBe(503);
      expect(body<{ code: string }>(aRes).code).toBe(
        'payment_session_unavailable',
      );
      const row = (
        await db.query<RowDataPacket[]>(
          `SELECT status, paymentStatus, paymentSessionId FROM \`order\` WHERE id = ?`,
          [id],
        )
      )[0];
      expect(row.status).toBe('pending');
      expect(row.paymentSessionId).toBe(s2);
      expect(await f.productStock(shop.outletId, product.id)).toBe(9);

      // The shopper pays S2: the order settles.
      stripe.mode = 'ok';
      await app
        .get(PaymentsService)
        .applyWebhookResult(
          'stripe',
          'stripe',
          {
            providerReference: `evt_m1c_${f.runId}`,
            orderId: id,
            status: 'paid',
          },
          shop.shopId,
        );
      const paid = await db.query<RowDataPacket[]>(
        `SELECT status, paymentStatus FROM \`order\` WHERE id = ?`,
        [id],
      );
      expect(paid[0]).toMatchObject({
        status: 'pending',
        paymentStatus: 'paid',
      });
    });
  });

  describe('the order moved on while the gateway was being asked (L4)', () => {
    it('paid meanwhile is reported as it is: a success with no URL, never "not charged"', async () => {
      const { shop, product } = await shopWithStock('f8-l4a');
      stripe.hook = async (p) => {
        await db.execute(
          `UPDATE \`order\` SET paymentStatus = 'paid' WHERE id = ?`,
          [p.orderId],
        );
      };
      const res = await place(shop, {
        paymentMethod: 'card_online',
        items: [{ productId: product.id, quantity: 1 }],
        idempotencyKey: newKey(),
      }).expect(201);
      expect(body<{ checkoutUrl: string | null }>(res).checkoutUrl).toBeNull();
      expect(
        body<{ order: { paymentStatus: string } }>(res).order.paymentStatus,
      ).toBe('paid');
      const row = (await orders(shop))[0];
      expect(row.status).toBe('pending');
      expect(await f.productStock(shop.outletId, product.id)).toBe(9);
    });

    it('cancelled meanwhile is reported as a closed attempt', async () => {
      const { shop, product } = await shopWithStock('f8-l4b');
      stripe.hook = async (p) => {
        await f.cancelOrder(shop, p.orderId).expect(201);
      };
      const res = await place(shop, {
        paymentMethod: 'card_online',
        items: [{ productId: product.id, quantity: 1 }],
        idempotencyKey: newKey(),
      });
      expect(res.status).toBe(409);
      expect(body<{ code: string }>(res).code).toBe('checkout_attempt_closed');
      expect(JSON.stringify(res.body)).not.toMatch(/not been charged/i);
    });
  });

  describe('idempotency key shape (L1)', () => {
    it('refuses a short key and accepts a UUID (any case) or 22+ URL-safe characters', async () => {
      const { shop, product } = await shopWithStock('f8-l1');
      const send = (idempotencyKey: string) =>
        place(shop, {
          paymentMethod: 'cash_on_pickup',
          items: [{ productId: product.id, quantity: 1 }],
          idempotencyKey,
        });
      await send('abcdefghijklmnop').expect(400); // 16 characters
      await send('abcdefghijklmnopqrstu').expect(400); // 21
      await send('abcdefghijklmnopqrstuv').expect(201); // 22
      await send(randomUUID().toUpperCase()).expect(201);
    });
  });

  describe('what the failure path logs (L3)', () => {
    it('logs the error class and status, never the gateway message', async () => {
      const { shop, product } = await shopWithStock('f8-l3');
      // Whichever logger is active (structured JSON or Nest's console one), it
      // ends up on stdout or stderr.
      const chunks: string[] = [];
      const capture = (chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      };
      const out = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(capture);
      const err = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(capture);
      try {
        stripe.mode = 'throw';
        await place(shop, {
          paymentMethod: 'card_online',
          items: [{ productId: product.id, quantity: 1 }],
        }).expect(503);
      } finally {
        out.mockRestore();
        err.mockRestore();
      }
      // eslint-disable-next-line no-control-regex
      const logged = chunks.join('').replace(/\u001b\[[0-9;]*m/g, '');
      expect(logged).toContain('payment session could not be created');
      expect(logged).toContain('errorClass');
      expect(logged).not.toMatch(
        /TOPSECRET|sk_live|req_123|api_key|is invalid/,
      );
    });
  });
});
