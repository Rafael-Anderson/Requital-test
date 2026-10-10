import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { StoreCreditService } from '../src/store-credit/store-credit.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';
import { asCustomer, registerCustomer, type CustomerSession } from './helpers/customer-session';
import { createStaffToken } from './helpers/staff-login';

jest.setTimeout(240000);

// CUS-6. Money: every guarantee here has an injection proof recorded in
// docs/handoff/s4.md (remove the lock, the currency check, the idempotency key,
// the shop scoping and see the test named in the table fail).
describe('Store credit (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let seq = 0;
  const phone = () => `05${String(Date.now() % 100000)}${String(++seq).padStart(3, '0')}`;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
  });
  afterAll(async () => {
    await app.close();
  });

  type Shop = Awaited<ReturnType<typeof f.setupShop>>;
  const admin = (shop: Shop, method: 'get' | 'post', path: string, data?: object) =>
    request(server())[method](path).set('Authorization', `Bearer ${shop.adminToken}`).send(data);

  async function setup(prefix: string, opts: { price?: number; currency?: string; stock?: number } = {}) {
    const shop = await f.setupShop(prefix);
    if (opts.currency) await f.setShop(shop, { currency: opts.currency });
    const product = await f.stockedProduct(shop, opts.stock ?? 50, { price: opts.price ?? 100 });
    await f.publish(shop);
    const customer = await registerCustomer(server(), shop.slug, phone(), `sc-${f.uniq()}@x.test`);
    return { shop, product, customer };
  }

  const grant = (shop: Shop, customerId: number, amount: number | string, currency = 'AED', extra: object = {}) =>
    admin(shop, 'post', `/customers/${customerId}/store-credit/adjustments`, {
      currency,
      amount,
      direction: 'grant',
      reason: 'goodwill',
      ...extra,
    });

  const ledger = (customerId: number) =>
    db.query<RowDataPacket[]>(
      `SELECT entryType, currency, amount, orderId, returnId FROM storecreditentry WHERE customerId = ? ORDER BY id`,
      [customerId],
    );
  async function sum(customerId: number, currency = 'AED') {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM storecreditentry WHERE customerId = ? AND currency = ?`,
      [customerId, currency],
    );
    return Number(rows[0].s);
  }

  function checkout(
    shop: Shop,
    sess: CustomerSession | null,
    productId: number,
    extra: Record<string, unknown> = {},
    qty = 1,
  ) {
    const payload = {
      outletId: shop.outletId,
      orderType: 'pickup',
      paymentMethod: 'cash_on_pickup',
      customerName: 'Credit Customer',
      customerPhone: phone(),
      customerAddress: 'Pickup',
      items: [{ productId, quantity: qty }],
      ...extra,
    };
    const path = `/public/${shop.slug}/orders`;
    return sess
      ? asCustomer(server(), sess, 'post', path).send(payload)
      : request(server()).post(path).send(payload);
  }

  describe('admin grant and deduct', () => {
    it('grants, shows the balance and the ledger row with reason and actor, and deducts', async () => {
      const { shop, customer } = await setup('sc-adm');
      const res = body<{ balances: { currency: string; balance: string }[]; entries: { type: string; reason: string }[] }>(
        await grant(shop, customer.customerId, 25.5).expect(201),
      );
      expect(res.balances).toEqual([expect.objectContaining({ currency: 'AED', balance: '25.50' })]);
      expect(res.entries[0]).toMatchObject({ type: 'grant', reason: 'goodwill' });
      const ded = body<{ balances: { balance: string }[] }>(
        await admin(shop, 'post', `/customers/${customer.customerId}/store-credit/adjustments`, {
          currency: 'AED',
          amount: '5.25',
          direction: 'deduct',
          reason: 'Correction',
        }).expect(201),
      );
      expect(ded.balances[0].balance).toBe('20.25');
      const audit = await db.query<RowDataPacket[]>(
        `SELECT action FROM auditlog WHERE shopId = ? AND action LIKE 'customer.store_credit.%' ORDER BY id`,
        [shop.shopId],
      );
      expect(audit.map((a) => a.action)).toEqual([
        'customer.store_credit.granted',
        'customer.store_credit.deducted',
      ]);
    });

    it('validates: reason, currency (never defaulted), precision, sign, size', async () => {
      const { shop, customer } = await setup('sc-val');
      const url = `/customers/${customer.customerId}/store-credit/adjustments`;
      const ok = { currency: 'AED', amount: 5, direction: 'grant', reason: 'goodwill' };
      await admin(shop, 'post', url, { ...ok, reason: '' }).expect(400);
      await admin(shop, 'post', url, { ...ok, reason: 'ab' }).expect(400);
      const { currency: _c, ...noCurrency } = ok;
      await admin(shop, 'post', url, noCurrency).expect(400);
      await admin(shop, 'post', url, { ...ok, currency: 'XXX' }).expect(400);
      await admin(shop, 'post', url, { ...ok, amount: 5.005 }).expect(400); // AED has 2dp
      await admin(shop, 'post', url, { ...ok, amount: -5 }).expect(400);
      await admin(shop, 'post', url, { ...ok, amount: 0 }).expect(400);
      await admin(shop, 'post', url, { ...ok, amount: 2_000_000 }).expect(400);
      await admin(shop, 'post', url, { ...ok, amount: '1e3' }).expect(400);
      await admin(shop, 'post', url, { ...ok, direction: 'burn' }).expect(400);
      await admin(shop, 'post', url, { ...ok, customerId: 9 }).expect(400); // unknown property
      expect(await ledger(customer.customerId)).toHaveLength(0);
      // KWD allows 3 decimals
      await grant(shop, customer.customerId, '10.505', 'KWD').expect(201);
      expect(await sum(customer.customerId, 'KWD')).toBe(10.505);
    });

    it('a deduction can never take a balance below zero, and concurrent deductions cannot both pass', async () => {
      const { shop, customer } = await setup('sc-ded');
      await grant(shop, customer.customerId, 10).expect(201);
      const ded = (amount: number) =>
        admin(shop, 'post', `/customers/${customer.customerId}/store-credit/adjustments`, {
          currency: 'AED',
          amount,
          direction: 'deduct',
          reason: 'Correction',
        });
      await ded(10.01).expect(409);
      const results = await Promise.all([ded(6), ded(6), ded(6), ded(6)]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(await sum(customer.customerId)).toBe(4);
    });

    it('an idempotency key applies once: replay returns the same ledger, a changed request is refused', async () => {
      const { shop, customer } = await setup('sc-idem');
      const key = `key-${f.uniq()}-abcdefgh`;
      await grant(shop, customer.customerId, 20, 'AED', { idempotencyKey: key }).expect(201);
      const again = body<{ replay: boolean; balances: { balance: string }[] }>(
        await grant(shop, customer.customerId, 20, 'AED', { idempotencyKey: key }).expect(201),
      );
      expect(again.replay).toBe(true);
      expect(again.balances[0].balance).toBe('20.00');
      await grant(shop, customer.customerId, 99, 'AED', { idempotencyKey: key }).expect(409);
      // concurrent double submit of the same click
      const k2 = `key-${f.uniq()}-zzzzzzzz`;
      await Promise.all([
        grant(shop, customer.customerId, 1, 'AED', { idempotencyKey: k2 }),
        grant(shop, customer.customerId, 1, 'AED', { idempotencyKey: k2 }),
        grant(shop, customer.customerId, 1, 'AED', { idempotencyKey: k2 }),
      ]);
      expect(await sum(customer.customerId)).toBe(21);
    });

    it('role matrix: viewer reads only; branch and order_manager are refused', async () => {
      const { shop, customer } = await setup('sc-role');
      await grant(shop, customer.customerId, 5).expect(201);
      const viewer = await createStaffToken(app, shop.adminToken, 'sc', 'viewer');
      const branch = await createStaffToken(app, shop.adminToken, 'sc', 'branch', shop.outletId);
      const om = await createStaffToken(app, shop.adminToken, 'sc', 'order_manager');
      const url = `/customers/${customer.customerId}/store-credit`;
      const as = (t: string, method: 'get' | 'post', path: string, data?: object) =>
        request(server())[method](path).set('Authorization', `Bearer ${t}`).send(data);
      await as(viewer, 'get', url).expect(200);
      await as(viewer, 'post', `${url}/adjustments`, { currency: 'AED', amount: 1, direction: 'grant', reason: 'nope' }).expect(403);
      for (const t of [branch, om]) {
        await as(t, 'get', url).expect(403);
        await as(t, 'post', `${url}/adjustments`, { currency: 'AED', amount: 1, direction: 'grant', reason: 'nope' }).expect(403);
      }
      expect(await sum(customer.customerId)).toBe(5);
    });
  });

  describe('spending at checkout', () => {
    it('applies up to what is payable, records it on the order, leaves the total unchanged, and the client cannot choose the amount', async () => {
      const { shop, product, customer } = await setup('sc-spend', { price: 100 });
      await grant(shop, customer.customerId, 30).expect(201);
      // the client cannot send an amount of its own
      await checkout(shop, customer, product.id, { useStoreCredit: true, storeCreditAmount: 999 }).expect(400);
      const res = await checkout(shop, customer, product.id, { useStoreCredit: true }).expect(201);
      const order = body<{ order: { id: number; total: string; storeCreditAmount: string } }>(res).order;
      expect(Number(order.storeCreditAmount)).toBe(30);
      const row = await f.orderRow(order.id);
      expect(Number(row.total)).toBeGreaterThanOrEqual(100);
      expect(Number(row.storeCreditAmount)).toBe(30);
      expect(row.customerId).toBe(customer.customerId);
      expect(row.paymentStatus).toBe('unpaid');
      expect(await sum(customer.customerId)).toBe(0);
      const entries = await ledger(customer.customerId);
      expect(entries.map((e) => [e.entryType, Number(e.amount), e.orderId])).toEqual([
        ['grant', 30, null],
        ['spend', -30, order.id],
      ]);
    });

    it('a balance larger than the order is capped at the payable amount and the order is paid', async () => {
      const { shop, product, customer } = await setup('sc-cap', { price: 40 });
      await grant(shop, customer.customerId, 500).expect(201);
      const res = await checkout(shop, customer, product.id, { useStoreCredit: true }).expect(201);
      const id = body<{ order: { id: number } }>(res).order.id;
      const row = await f.orderRow(id);
      expect(Number(row.storeCreditAmount)).toBe(Number(row.total));
      expect(row.paymentStatus).toBe('paid');
      expect(await sum(customer.customerId)).toBe(500 - Number(row.total));
    });

    it('stacks after a gift card, only on what is still payable', async () => {
      const { shop, product, customer } = await setup('sc-gift', { price: 100 });
      await grant(shop, customer.customerId, 1000).expect(201);
      const card = body<{ code: string }>(await admin(shop, 'post', '/gift-cards', { initialValue: 60 }).expect(201));
      const res = await checkout(shop, customer, product.id, { useStoreCredit: true, giftCardCode: card.code }).expect(201);
      const row = await f.orderRow(body<{ order: { id: number } }>(res).order.id);
      expect(Number(row.giftCardAmount)).toBe(60);
      expect(Number(row.storeCreditAmount)).toBeCloseTo(Number(row.total) - 60, 6);
      expect(row.paymentStatus).toBe('paid');
    });

    it('requires a logged-in customer of THIS shop, and a balance in THIS shop currency', async () => {
      const a = await setup('sc-auth-a', { price: 50 });
      const b = await setup('sc-auth-b', { price: 50 });
      await grant(a.shop, a.customer.customerId, 100).expect(201);
      // guest
      await checkout(a.shop, null, a.product.id, { useStoreCredit: true }).expect(401);
      // shop B's session on shop A
      await checkout(a.shop, b.customer, a.product.id, { useStoreCredit: true }).expect(401);
      // a forged cross-site request carries the session cookie but not the CSRF
      // token: refused before anything is spent
      await request(server())
        .post(`/public/${a.shop.slug}/orders`)
        .set('Cookie', a.customer.cookie)
        .send({
          outletId: a.shop.outletId,
          orderType: 'pickup',
          paymentMethod: 'cash_on_pickup',
          customerName: 'Forger',
          customerPhone: phone(),
          customerAddress: 'Pickup',
          items: [{ productId: a.product.id, quantity: 1 }],
          useStoreCredit: true,
        })
        .expect(403);
      expect(await sum(a.customer.customerId)).toBe(100);
      // logged in but no credit at all
      await checkout(b.shop, b.customer, b.product.id, { useStoreCredit: true }).expect(409);
      // credit exists only in KWD; the shop trades in AED: refused, balance untouched, no order
      const c = await setup('sc-cur', { price: 50 });
      await grant(c.shop, c.customer.customerId, 100, 'KWD').expect(201);
      const res = await checkout(c.shop, c.customer, c.product.id, { useStoreCredit: true }).expect(409);
      expect(String((res.body as { message: string }).message)).toContain('AED');
      expect(await sum(c.customer.customerId, 'KWD')).toBe(100);
      const orders = await db.query<RowDataPacket[]>(`SELECT id FROM \`order\` WHERE shopId = ?`, [c.shop.shopId]);
      expect(orders).toHaveLength(0);
      // a guest checkout without the flag is unchanged and never touches the ledger
      await checkout(a.shop, null, a.product.id).expect(201);
      expect(await sum(a.customer.customerId)).toBe(100);
    });

    it('credit in the shop currency is spent; a KWD shop spends KWD to the third decimal', async () => {
      const { shop, product, customer } = await setup('sc-kwd', { price: 10.505, currency: 'KWD' });
      await grant(shop, customer.customerId, '4.125', 'KWD').expect(201);
      const res = await checkout(shop, customer, product.id, { useStoreCredit: true }).expect(201);
      const row = await f.orderRow(body<{ order: { id: number } }>(res).order.id);
      expect(Number(row.storeCreditAmount)).toBe(4.125);
      expect(await sum(customer.customerId, 'KWD')).toBe(0);
    });

    it('OVERSPEND RACE: concurrent checkouts can never drive the balance negative', async () => {
      const { shop, product, customer } = await setup('sc-race', { price: 80, stock: 100 });
      await grant(shop, customer.customerId, 100).expect(201);
      const attempts = 6;
      const results = await Promise.all(
        Array.from({ length: attempts }, () => checkout(shop, customer, product.id, { useStoreCredit: true })),
      );
      const ok = results.filter((r) => r.status === 201);
      const refused = results.filter((r) => r.status === 409);
      expect(ok.length + refused.length).toBe(attempts);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      // 100 of credit against orders that each need ~80+: at most ONE can be covered fully...
      const spent = await db.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(-amount), 0) AS s FROM storecreditentry WHERE customerId = ? AND entryType = 'spend'`,
        [customer.customerId],
      );
      expect(Number(spent[0].s)).toBeLessThanOrEqual(100);
      expect(await sum(customer.customerId)).toBeGreaterThanOrEqual(0);
      // every order that exists has exactly the spend entry it claims
      const orders = await db.query<RowDataPacket[]>(
        `SELECT o.id, o.storeCreditAmount, (SELECT -SUM(amount) FROM storecreditentry s WHERE s.orderId = o.id AND s.entryType = 'spend') AS spent
           FROM \`order\` o WHERE o.shopId = ?`,
        [shop.shopId],
      );
      expect(orders).toHaveLength(ok.length);
      for (const o of orders) expect(Number(o.spent)).toBe(Number(o.storeCreditAmount));
      // refused attempts left no order, no stock reservation
      expect(await f.productStock(shop.outletId, product.id)).toBe(100 - ok.length);
    });
  });

  describe('reversal on cancel', () => {
    it('cancel puts the credit back once; a repeated reversal is a no-op', async () => {
      const { shop, product, customer } = await setup('sc-cancel', { price: 100 });
      await grant(shop, customer.customerId, 30).expect(201);
      const res = await checkout(shop, customer, product.id, { useStoreCredit: true }).expect(201);
      const id = body<{ order: { id: number } }>(res).order.id;
      expect(await sum(customer.customerId)).toBe(0);
      await f.cancelOrder(shop, id).expect(201);
      expect(await sum(customer.customerId)).toBe(30);
      await f.cancelOrder(shop, id).expect(400); // already cancelled
      // call the reversal again directly, twice, in parallel: still exactly one reversal
      const svc = app.get(StoreCreditService);
      await Promise.all(
        [1, 2, 3].map(() => db.transaction((conn) => svc.reverseSpendForOrder(conn, shop.shopId, id, 'again'))),
      );
      const entries = await ledger(customer.customerId);
      expect(entries.map((e) => e.entryType)).toEqual(['grant', 'spend', 'spend_reversal']);
      expect(await sum(customer.customerId)).toBe(30);
    });

    it('cancelling an order that used no credit writes nothing; a confirmed order also reverses', async () => {
      const { shop, product, customer } = await setup('sc-cancel2', { price: 100 });
      await grant(shop, customer.customerId, 10).expect(201);
      const plain = body<{ order: { id: number } }>((await checkout(shop, null, product.id).expect(201)));
      await f.cancelOrder(shop, plain.order.id).expect(201);
      expect(await ledger(customer.customerId)).toHaveLength(1);
      const paid = body<{ order: { id: number } }>(await checkout(shop, customer, product.id, { useStoreCredit: true }).expect(201));
      await f.setStatus(shop, paid.order.id, 'confirmed');
      await f.cancelOrder(shop, paid.order.id).expect(201);
      expect(await sum(customer.customerId)).toBe(10);
    });
  });

  describe('returns', () => {
    async function delivered(prefix: string, price = 100, qty = 2, credit = 60, extra: Record<string, unknown> = {}) {
      const s = await setup(prefix, { price });
      await grant(s.shop, s.customer.customerId, credit).expect(201);
      const res = await checkout(s.shop, s.customer, s.product.id, { useStoreCredit: true, ...extra }, qty).expect(201);
      const id = body<{ order: { id: number } }>(res).order.id;
      await f.advance(s.shop, id, 'delivered');
      const items = await f.orderItems(id);
      return { ...s, orderId: id, line: items[0].id as number };
    }
    const ret = (shop: Shop, orderId: number, items: object[], extra: object = {}) =>
      request(server())
        .post(`/orders/${orderId}/returns`)
        .set(f.auth(shop))
        .send({ reason: 'changed_mind', items, restock: false, ...extra });

    it('the store-credit-paid share goes back to credit, partial returns summing EXACTLY to what was spent', async () => {
      const { shop, customer, orderId, line } = await delivered('sc-ret');
      const row = await f.orderRow(orderId);
      const spent = Number(row.storeCreditAmount);
      expect(spent).toBe(60);
      const r1 = body<{ storeCreditRefundAmount: string; refundMethod: string }>(
        await ret(shop, orderId, [{ orderItemId: line, quantity: 1 }]).expect(201),
      );
      expect(Number(r1.storeCreditRefundAmount)).toBeGreaterThan(0);
      expect(r1.refundMethod).toBe('manual'); // nothing was charged to a provider
      const r2 = body<{ storeCreditRefundAmount: string }>(await ret(shop, orderId, [{ orderItemId: line, quantity: 1 }]).expect(201));
      const back = Number(r1.storeCreditRefundAmount) + Number(r2.storeCreditRefundAmount);
      expect(Math.round(back * 100)).toBe(Math.round(spent * 100));
      // 60 granted - 60 spent + 60 returned
      expect(await sum(customer.customerId)).toBe(60);
      const entries = await ledger(customer.customerId);
      expect(entries.filter((e) => e.entryType === 'return_refund')).toHaveLength(2);
    });

    it('"refund to store credit" credits the rest of the refund too, in the order currency, once per return', async () => {
      const { shop, customer, orderId, line } = await delivered('sc-ret2', 100, 1, 30);
      const total = Number((await f.orderRow(orderId)).total);
      const r = body<{ id: number; refundAmount: string; refundMethod: string }>(
        await ret(shop, orderId, [{ orderItemId: line, quantity: 1 }], { refundTo: 'store_credit' }).expect(201),
      );
      expect(r.refundMethod).toBe('store_credit');
      expect(Number(r.refundAmount)).toBeLessThanOrEqual(total);
      // credit = whole refund (30 paid with credit + the cash share)
      const credited = (await ledger(customer.customerId)).filter((e) => e.entryType === 'return_refund');
      expect(credited).toHaveLength(1);
      expect(Number(credited[0].amount)).toBe(Number(r.refundAmount));
      expect(credited[0].currency).toBe('AED');
      // idempotent at the database: a second credit for the same return is refused
      const svc = app.get(StoreCreditService);
      await expect(
        db.transaction((conn) => svc.creditForReturn(conn, shop.shopId, customer.customerId, r.id, 'AED', 100, 'dup')),
      ).rejects.toThrow();
      expect((await ledger(customer.customerId)).filter((e) => e.entryType === 'return_refund')).toHaveLength(1);
    });

    it('refund to store credit on an order with no customer account is a 400 and changes nothing', async () => {
      const s = await setup('sc-ret3', { price: 100 });
      const res = await checkout(s.shop, null, s.product.id).expect(201);
      const id = body<{ order: { id: number } }>(res).order.id;
      await db.execute(`UPDATE \`order\` SET customerId = NULL WHERE id = ?`, [id]);
      await f.advance(s.shop, id, 'delivered');
      const items = await f.orderItems(id);
      await ret(s.shop, id, [{ orderItemId: items[0].id, quantity: 1 }], { refundTo: 'store_credit' }).expect(400);
      const returns = await db.query<RowDataPacket[]>(`SELECT id FROM orderreturn WHERE orderId = ?`, [id]);
      expect(returns).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it('another shop cannot read or change my customer ledger; a customer cannot read another shop balance', async () => {
      const a = await setup('sc-xa');
      const b = await setup('sc-xb');
      await grant(a.shop, a.customer.customerId, 40).expect(201);
      await admin(b.shop, 'get', `/customers/${a.customer.customerId}/store-credit`).expect(404);
      await grant(b.shop, a.customer.customerId, 1000).expect(404);
      await admin(b.shop, 'post', `/customers/${a.customer.customerId}/store-credit/adjustments`, {
        currency: 'AED',
        amount: 40,
        direction: 'deduct',
        reason: 'steal',
      }).expect(404);
      expect(await sum(a.customer.customerId)).toBe(40);
      // customer endpoints
      const own = body<{ balances: { balance: string }[] }>(
        await asCustomer(server(), a.customer, 'get', `/public/${a.shop.slug}/account/store-credit`).expect(200),
      );
      expect(own.balances[0].balance).toBe('40.00');
      await asCustomer(server(), a.customer, 'get', `/public/${b.shop.slug}/account/store-credit`).expect(401);
      await request(server()).get(`/public/${a.shop.slug}/account/store-credit`).expect(401);
      // idempotency keys are per shop: the same key in shop B is its own request
      const key = `shared-${f.uniq()}-keykeykey`;
      await grant(a.shop, a.customer.customerId, 1, 'AED', { idempotencyKey: key }).expect(201);
      await grant(b.shop, b.customer.customerId, 1, 'AED', { idempotencyKey: key }).expect(201);
      expect(await sum(b.customer.customerId)).toBe(1);
    });
  });

  describe('PDPL', () => {
    it('the export carries balance and entries; deleting the account keeps the ledger but scrubs staff-typed reasons', async () => {
      const { shop, customer } = await setup('sc-pdpl');
      await grant(shop, customer.customerId, 12, 'AED', { reason: 'Compensation for the late delivery to Fatima' }).expect(201);
      const exp = body<{ storeCredit: { balances: { balance: string }[]; entries: unknown[] } }>(
        await asCustomer(server(), customer, 'get', `/public/${shop.slug}/account/export`).expect(200),
      );
      expect(exp.storeCredit.balances[0].balance).toBe('12.00');
      expect(exp.storeCredit.entries).toHaveLength(1);
      const del = body<{ confirmationToken: string }>(
        await asCustomer(server(), customer, 'delete', `/public/${shop.slug}/account/me`).expect(202),
      );
      await asCustomer(server(), customer, 'delete', `/public/${shop.slug}/account/me/confirm?token=${del.confirmationToken}`).expect(200);
      const rows = await db.query<RowDataPacket[]>(`SELECT amount, reason FROM storecreditentry WHERE customerId = ?`, [customer.customerId]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount)).toBe(12);
      expect(rows[0].reason).toBe('[removed]');
      // an anonymised account can no longer be granted credit
      await grant(shop, customer.customerId, 5).expect(409);
    });
  });
});
