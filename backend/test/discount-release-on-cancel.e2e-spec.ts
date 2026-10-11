import 'dotenv/config';
import { createHmac } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { OrdersService } from '../src/orders/orders.service';
import * as releaseModule from '../src/discounts/release-redemption';
import { releaseDiscountRedemption } from '../src/discounts/release-redemption';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// Captured before any spy replaces the module property.
const realRelease = releaseModule.releaseDiscountRedemption;

const TABBY_SECRET = 'tabby-webhook-secret-for-release-tests';

// A cancelled order, or one refunded in full, gives its discount use back to
// BOTH limits (global usageLimit counter and the per-customer redemption row),
// exactly once, in the same transaction as the status change. A partial return
// never releases.
describe('Discount redemption release on cancel / full refund (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;

  beforeAll(async () => {
    process.env.TABBY_WEBHOOK_SECRET = TABBY_SECRET;
    ({ app, db } = await bootApp({ rawBody: true }));
    f = makeFixtures(app, db);
  });
  afterAll(async () => {
    delete process.env.TABBY_WEBHOOK_SECRET;
    await app.close();
  });

  type Shop = Awaited<ReturnType<typeof f.setupShop>>;
  let phoneSeq = 0;
  const newPhone = () =>
    `05${String(Date.now() % 100000)}${String(++phoneSeq).padStart(3, '0')}`;

  async function shopWithStock(prefix: string, stock = 50) {
    const shop = await f.setupShop(prefix);
    const product = await f.stockedProduct(shop, stock);
    await f.publish(shop);
    return { shop, product };
  }
  const redemptions = (discountId: number) =>
    db.query<RowDataPacket[]>(
      `SELECT customerId, orderId FROM discountredemption WHERE discountId = ?`,
      [discountId],
    );
  async function timesUsed(discountId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT timesUsed FROM discount WHERE id = ?`,
      [discountId],
    );
    return rows[0].timesUsed as number;
  }
  const orderId = (res: { body: unknown }) =>
    (res.body as { order: { id: number } }).order.id;
  const place = (
    shop: Shop,
    productId: number,
    code: string | null,
    phone = newPhone(),
    qty = 1,
  ) =>
    f.storefrontOrderRaw(shop, [{ productId, quantity: qty }], {
      customerPhone: phone,
      ...(code ? { discountCode: code } : {}),
    });

  it('global usageLimit: refused at the cap, freed by a cancel, then a new order succeeds', async () => {
    const { shop, product } = await shopWithStock('rel-global');
    const d = await f.createDiscount(shop, { usageLimit: 1 });
    const first = await place(shop, product.id, d.code);
    expect(first.status).toBe(201);
    expect(
      (await place(shop, product.id, d.code)).status,
    ).toBeGreaterThanOrEqual(400);
    expect(await timesUsed(d.id)).toBe(1);

    await f.cancelOrder(shop, orderId(first)).expect(201);
    expect(await timesUsed(d.id)).toBe(0);
    expect(await redemptions(d.id)).toHaveLength(0);

    const again = await place(shop, product.id, d.code);
    expect(again.status).toBe(201);
    expect(await timesUsed(d.id)).toBe(1);
    expect(await redemptions(d.id)).toHaveLength(1);
  });

  it('per-customer limit: freed by a cancel for that customer only', async () => {
    const { shop, product } = await shopWithStock('rel-pc');
    const d = await f.createDiscount(shop, { usageLimitPerCustomer: 1 });
    const phone = newPhone();
    const other = newPhone();
    const first = await place(shop, product.id, d.code, phone);
    const otherOrder = await place(shop, product.id, d.code, other);
    expect(first.status).toBe(201);
    expect(otherOrder.status).toBe(201);
    expect((await place(shop, product.id, d.code, phone)).status).toBe(409);

    await f.cancelOrder(shop, orderId(first)).expect(201);
    expect(await redemptions(d.id)).toHaveLength(1); // the other customer's stays
    expect(await timesUsed(d.id)).toBe(1);
    expect((await place(shop, product.id, d.code, phone)).status).toBe(201);
    expect((await place(shop, product.id, d.code, other)).status).toBe(409);
  });

  it('releases from a confirmed order too (second CAS branch) and via PATCH status=cancelled', async () => {
    const { shop, product } = await shopWithStock('rel-branches');
    const d = await f.createDiscount(shop, { usageLimit: 5 });
    const a = orderId(await place(shop, product.id, d.code));
    const b = orderId(await place(shop, product.id, d.code));
    expect(await timesUsed(d.id)).toBe(2);

    await f.setStatus(shop, a, 'confirmed');
    await f.cancelOrder(shop, a).expect(201);
    expect(await timesUsed(d.id)).toBe(1);

    // This route used to run its own bare status CAS: no restock, no release.
    const before = await f.productStock(shop.outletId, product.id);
    await f.setStatus(shop, b, 'cancelled');
    expect((await f.orderRow(b)).status).toBe('cancelled');
    expect(await timesUsed(d.id)).toBe(0);
    expect(await f.productStock(shop.outletId, product.id)).toBe(before + 1);
  });

  it('double cancel and concurrent cancels release exactly once', async () => {
    const { shop, product } = await shopWithStock('rel-twice');
    const d = await f.createDiscount(shop, { usageLimit: 10 });
    const a = orderId(await place(shop, product.id, d.code));
    await place(shop, product.id, d.code); // keeps timesUsed above 0 so an over-release is visible
    await place(shop, product.id, d.code);
    expect(await timesUsed(d.id)).toBe(3);

    const res = await Promise.all(
      Array.from({ length: 6 }, () => f.cancelOrder(shop, a)),
    );
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await timesUsed(d.id)).toBe(2);
    await f.cancelOrder(shop, a).expect(400);
    expect(await timesUsed(d.id)).toBe(2);
    expect(await redemptions(d.id)).toHaveLength(2);
  });

  it('the release helper itself is idempotent under parallel callers (the delete is the guard)', async () => {
    const { shop, product } = await shopWithStock('rel-helper');
    const d = await f.createDiscount(shop, { usageLimit: 10 });
    const a = orderId(await place(shop, product.id, d.code));
    await place(shop, product.id, d.code);
    await place(shop, product.id, d.code);
    expect(await timesUsed(d.id)).toBe(3);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.transaction((conn) =>
          releaseDiscountRedemption(conn, shop.shopId, a),
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await timesUsed(d.id)).toBe(2);
  });

  it('never goes below zero', async () => {
    const { shop, product } = await shopWithStock('rel-floor');
    const d = await f.createDiscount(shop, { usageLimit: 3 });
    const a = orderId(await place(shop, product.id, d.code));
    await db.execute(`UPDATE discount SET timesUsed = 0 WHERE id = ?`, [d.id]);
    await f.cancelOrder(shop, a).expect(201);
    expect(await timesUsed(d.id)).toBe(0);
    expect(await redemptions(d.id)).toHaveLength(0);
  });

  it('an order without a code, and an auto discount, release nothing and break nothing', async () => {
    const { shop, product } = await shopWithStock('rel-auto');
    const d = await f.createDiscount(shop, { usageLimit: 5 });
    await place(shop, product.id, d.code); // timesUsed = 1
    const auto = await request(f.http())
      .post('/shop/discounts')
      .set(f.auth(shop))
      .send({
        discountType: 'auto',
        type: 'PERCENTAGE',
        value: 20,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [product.id],
      })
      .expect(201);
    const autoId = body<{ id: number }>(auto).id;
    const plain = orderId(await place(shop, product.id, null));
    const item = await db.query<RowDataPacket[]>(
      `SELECT autoDiscountAmount FROM orderitem WHERE orderId = ?`,
      [plain],
    );
    expect(Number(item[0].autoDiscountAmount)).toBeGreaterThan(0);

    await f.cancelOrder(shop, plain).expect(201);
    expect(await timesUsed(d.id)).toBe(1);
    expect(await timesUsed(autoId)).toBe(0);
    expect(await redemptions(autoId)).toHaveLength(0);
  });

  it('gift card + discount order: the cancel releases the discount and does not touch the card', async () => {
    const { shop, product } = await shopWithStock('rel-gift');
    const d = await f.createDiscount(shop, { usageLimit: 2 });
    const card = body<{ id: number; code: string }>(
      await request(f.http())
        .post('/gift-cards')
        .set(f.auth(shop))
        .send({ initialValue: 5 })
        .expect(201),
    );
    const res = await f.storefrontOrderRaw(
      shop,
      [{ productId: product.id, quantity: 1 }],
      {
        customerPhone: newPhone(),
        discountCode: d.code,
        giftCardCode: card.code,
      },
    );
    expect(res.status).toBe(201);
    const cardBefore = await db.query<RowDataPacket[]>(
      `SELECT remainingBalance, status FROM giftcard WHERE id = ?`,
      [card.id],
    );
    await f.cancelOrder(shop, orderId(res)).expect(201);
    expect(await timesUsed(d.id)).toBe(0);
    const cardAfter = await db.query<RowDataPacket[]>(
      `SELECT remainingBalance, status FROM giftcard WHERE id = ?`,
      [card.id],
    );
    expect(cardAfter[0]).toEqual(cardBefore[0]);
  });

  it('BNPL: a webhook-driven expiry cancel releases the redemption, a replayed event does not release twice', async () => {
    const { shop, product } = await shopWithStock('rel-bnpl');
    const d = await f.createDiscount(shop, { usageLimit: 5 });
    const a = orderId(await place(shop, product.id, d.code));
    await place(shop, product.id, d.code);
    expect(await timesUsed(d.id)).toBe(2);

    const send = async (eventId: string) => {
      const payload = JSON.stringify({
        id: eventId,
        event: 'payment.expired',
        payment: { id: `pay_${a}`, order: { reference_id: String(a) } },
      });
      await request(f.http())
        .post('/payments/webhook/tabby')
        .set(
          'x-tabby-signature',
          createHmac('sha256', TABBY_SECRET).update(payload).digest('hex'),
        )
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(201);
    };
    await send(`evt_${Math.random()}`);
    expect((await f.orderRow(a)).status).toBe('cancelled');
    expect(await timesUsed(d.id)).toBe(1);
    await send(`evt_${Math.random()}`); // a different event id for an already cancelled order
    expect(await timesUsed(d.id)).toBe(1);
  });

  it("draft order: cancelling an invoice-sent draft releases its order's redemption", async () => {
    const { shop, product } = await shopWithStock('rel-draft');
    const d = await f.createDiscount(shop, { usageLimit: 1 });
    const draft = body<{ id: number }>(
      await request(f.http())
        .post('/shop/draft-orders')
        .set(f.auth(shop))
        .send({
          outletId: shop.outletId,
          customerName: 'Draft Customer',
          customerPhone: newPhone(),
          customerAddress: '1 Main St',
          orderType: 'delivery',
          items: [{ productId: product.id, quantity: 1 }],
          discountCode: d.code,
        })
        .expect(201),
    );
    await request(f.http())
      .post(`/shop/draft-orders/${draft.id}/complete`)
      .set(f.auth(shop))
      .expect(201);
    expect(await timesUsed(d.id)).toBe(1);
    const row = await db.query<RowDataPacket[]>(
      `SELECT convertedOrderId FROM draftorder WHERE id = ?`,
      [draft.id],
    );
    await f.cancelOrder(shop, row[0].convertedOrderId as number).expect(201);
    expect(await timesUsed(d.id)).toBe(0);
    expect(await redemptions(d.id)).toHaveLength(0);
  });

  describe('returns', () => {
    async function delivered(prefix: string, qty = 2) {
      const { shop, product } = await shopWithStock(prefix);
      const d = await f.createDiscount(shop, {
        usageLimit: 5,
        usageLimitPerCustomer: 5,
      });
      const o = await f.adminOrder(
        shop,
        [{ productId: product.id, quantity: qty }],
        {
          customerPhone: newPhone(),
          discountCode: d.code,
        },
      );
      await f.advance(shop, o.id, 'delivered');
      const items = await db.query<RowDataPacket[]>(
        `SELECT id FROM orderitem WHERE orderId = ?`,
        [o.id],
      );
      return { shop, d, o, itemId: items[0].id as number };
    }
    const ret = (
      shop: Shop,
      id: number,
      itemId: number,
      quantity: number,
      refundAmount?: number,
    ) =>
      request(f.http())
        .post(`/orders/${id}/returns`)
        .set(f.auth(shop))
        .send({
          items: [{ orderItemId: itemId, quantity }],
          reason: 'damaged',
          restock: false,
          ...(refundAmount !== undefined ? { refundAmount } : {}),
        });

    it('a partial return does not release', async () => {
      const { shop, d, o, itemId } = await delivered('rel-partial');
      await ret(shop, o.id, itemId, 1).expect(201);
      expect(await timesUsed(d.id)).toBe(1);
      expect(await redemptions(d.id)).toHaveLength(1);
    });

    it('a total-0 order (100% discount) never releases on a partial return', async () => {
      const { shop, product } = await shopWithStock('rel-zero');
      const d = await f.createDiscount(shop, {
        type: 'PERCENTAGE',
        value: 100,
        usageLimit: 5,
      });
      const o = await f.adminOrder(
        shop,
        [{ productId: product.id, quantity: 2 }],
        {
          customerPhone: newPhone(),
          discountCode: d.code,
        },
      );
      expect(Number(o.total)).toBe(0);
      await f.advance(shop, o.id, 'delivered');
      const items = await db.query<RowDataPacket[]>(
        `SELECT id FROM orderitem WHERE orderId = ?`,
        [o.id],
      );
      await ret(shop, o.id, items[0].id as number, 1).expect(201);
      expect(await timesUsed(d.id)).toBe(1);
      expect(await redemptions(d.id)).toHaveLength(1);
    });

    it('a return that refunds the whole total releases once, and a later look changes nothing', async () => {
      const { shop, d, o, itemId } = await delivered('rel-full');
      await ret(shop, o.id, itemId, 1).expect(201);
      expect(await timesUsed(d.id)).toBe(1);
      const row = await f.orderRow(o.id);
      const refunded = await db.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(refundAmount),0) AS s FROM orderreturn WHERE orderId = ?`,
        [o.id],
      );
      const rest = Number(row.total) - Number(refunded[0].s);
      await ret(shop, o.id, itemId, 1, rest).expect(201);
      expect((await f.orderRow(o.id)).paymentStatus).toBe('refunded');
      expect(await timesUsed(d.id)).toBe(0);
      expect(await redemptions(d.id)).toHaveLength(0);
    });
  });

  describe('atomicity and tenant scope', () => {
    it('a failure after the release rolls the cancel AND the release back together', async () => {
      const { shop, product } = await shopWithStock('rel-atomic');
      const d = await f.createDiscount(shop, { usageLimit: 5 });
      const a = orderId(await place(shop, product.id, d.code));
      // The real release runs (and deletes the row), then the request fails.
      const spy = jest
        .spyOn(releaseModule, 'releaseDiscountRedemption')
        .mockImplementationOnce(async (...args) => {
          await realRelease(...args);
          throw new Error('boom');
        });
      const res = await f.cancelOrder(shop, a);
      spy.mockRestore();
      expect(res.status).toBe(500);
      expect((await f.orderRow(a)).status).toBe('pending');
      expect(await timesUsed(d.id)).toBe(1);
      expect(await redemptions(d.id)).toHaveLength(1);
      // and the retry then succeeds and releases once
      await f.cancelOrder(shop, a).expect(201);
      expect(await timesUsed(d.id)).toBe(0);
    });

    // Lock order: checkout locks stock rows, inserts the order, then locks the
    // discount row (redeem). Cancel must therefore take order, stock, discount:
    // the release comes AFTER the restock in both CAS branches, or a checkout
    // and a cancel sharing a code and an ingredient can deadlock (1213).
    it('cancel restocks BEFORE it releases the discount, in both CAS branches', async () => {
      const { shop, product } = await shopWithStock('rel-lockorder');
      const d = await f.createDiscount(shop, { usageLimit: 5 });
      const pending = orderId(await place(shop, product.id, d.code));
      const confirmed = orderId(await place(shop, product.id, d.code));
      await f.setStatus(shop, confirmed, 'confirmed');

      const calls: string[] = [];
      type Stock = (this: unknown, ...a: unknown[]) => Promise<unknown>;
      const proto = OrdersService.prototype as unknown as {
        adjustStockForOrder: Stock;
      };
      const origStock = proto.adjustStockForOrder;
      const s1 = jest
        .spyOn(proto, 'adjustStockForOrder')
        .mockImplementation(function (this: unknown, ...a: unknown[]) {
          calls.push('stock');
          return Reflect.apply(origStock, this, a);
        });
      const s2 = jest
        .spyOn(releaseModule, 'releaseDiscountRedemption')
        .mockImplementation(async (...args) => {
          calls.push('release');
          return realRelease(...args);
        });
      try {
        await f.cancelOrder(shop, pending).expect(201);
        expect(calls).toEqual(['stock', 'release']);
        calls.length = 0;
        await f.cancelOrder(shop, confirmed).expect(201);
        expect(calls).toEqual(['stock', 'release']);
      } finally {
        s1.mockRestore();
        s2.mockRestore();
      }
      expect(await timesUsed(d.id)).toBe(0);
    });

    it("another shop's redemption is untouched, and the helper refuses a foreign shop id", async () => {
      const a = await shopWithStock('rel-tenant-a');
      const b = await shopWithStock('rel-tenant-b');
      const da = await f.createDiscount(a.shop, { usageLimit: 5 });
      const db_ = await f.createDiscount(b.shop, { usageLimit: 5 });
      const oa = orderId(await place(a.shop, a.product.id, da.code));
      await place(b.shop, b.product.id, db_.code);

      // shop B's id cannot release shop A's order
      const released = await db.transaction((conn) =>
        releaseDiscountRedemption(conn, b.shop.shopId, oa),
      );
      expect(released).toBe(false);
      expect(await timesUsed(da.id)).toBe(1);
      expect(await redemptions(da.id)).toHaveLength(1);

      // shop B cannot cancel shop A's order over HTTP either
      await f.cancelOrder(b.shop, oa).expect(404);
      expect(await timesUsed(da.id)).toBe(1);

      // and cancelling in A leaves B alone
      await f.cancelOrder(a.shop, oa).expect(201);
      expect(await timesUsed(da.id)).toBe(0);
      expect(await timesUsed(db_.id)).toBe(1);
      expect(await redemptions(db_.id)).toHaveLength(1);
    });
  });
});
