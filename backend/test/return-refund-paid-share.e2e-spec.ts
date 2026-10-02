import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// F7 (owner decision). The DEFAULT refund (staff typed no amount) is the returned
// units' share of what the customer actually PAID for the goods: the captured
// line price net of the apportioned order-level discount, plus the captured line
// tax on a tax-EXCLUSIVE order (an inclusive price already contains it). It is
// the credit note's own return computation. The delivery fee is not refunded by
// default. Two partial returns sum EXACTLY to the full paid share. A legacy order
// (captured tax NULL = unknown) keeps the old priceAtPurchase x qty default, and a
// typed amount still wins and is still capped. Also pins the concurrency fix: the
// caps are read under the order row lock, so two concurrent returns of the same
// line cannot both pass.
describe('Return refund defaults to the paid share (F7) + race-safe caps (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
  });
  afterAll(async () => {
    await app.close();
  });

  type Shop = Awaited<ReturnType<typeof f.setupShop>>;
  interface Ret {
    refundAmount: string;
    giftCardRefundAmount: string;
  }

  async function taxedShop(
    prefix: string,
    opts: { currency?: string; inclusive?: boolean } = {},
  ) {
    const shop = await f.setupShop(prefix);
    await f.setShop(shop, {
      taxRate: 5,
      taxInclusive: opts.inclusive ?? false,
      ...(opts.currency ? { currency: opts.currency } : {}),
    });
    const classes = await f.taxClasses(shop);
    const standard = classes.find((c) => c.isDefault)!;
    const zero = classes.find((c) => c.type === 'zero')!;
    await request(f.http())
      .patch(`/tax-classes/${standard.id}`)
      .set(f.auth(shop))
      .send({ rate: 5 })
      .expect(200);
    return { shop, standard, zero };
  }

  // A: priceA x2 on the standard class, B: priceB x1 on the zero class, 10% code.
  async function scenario(
    prefix: string,
    opts: {
      inclusive?: boolean;
      currency?: string;
      priceA?: number;
      priceB?: number;
      qtyA?: number;
      code?: boolean;
      giftCard?: number;
    } = {},
  ) {
    const { shop, standard, zero } = await taxedShop(prefix, opts);
    const a = await f.stockedProduct(shop, 10, {
      price: opts.priceA ?? 100,
      taxClassId: standard.id,
    });
    const b = await f.stockedProduct(shop, 10, {
      price: opts.priceB ?? 50,
      taxClassId: zero.id,
    });
    await f.publish(shop);
    const extra: Record<string, unknown> = {};
    if (opts.code !== false) {
      const d = await f.createDiscount(shop, { type: 'PERCENTAGE', value: 10 });
      extra.discountCode = d.code;
    }
    let card: { id: number; code: string } | undefined;
    if (opts.giftCard) {
      const res = await request(f.http())
        .post('/gift-cards')
        .set(f.auth(shop))
        .send({ initialValue: opts.giftCard })
        .expect(201);
      card = body<{ id: number; code: string }>(res);
      extra.giftCardCode = card.code;
    }
    const res = await f.storefrontOrder(
      shop,
      [
        { productId: a.id, quantity: opts.qtyA ?? 2 },
        { productId: b.id, quantity: 1 },
      ],
      extra,
    );
    const orderId = body<{ order: { id: number } }>(res).order.id;
    await f.advance(shop, orderId, 'delivered');
    const items = await f.orderItems(orderId);
    return {
      shop,
      a,
      b,
      card,
      orderId,
      lineA: items.find((i) => i.productId === a.id)!.id as number,
      lineB: items.find((i) => i.productId === b.id)!.id as number,
    };
  }

  function ret(
    shop: Shop,
    orderId: number,
    items: { orderItemId: number; quantity: number }[],
    extra: Record<string, unknown> = {},
  ) {
    return request(f.http())
      .post(`/orders/${orderId}/returns`)
      .set(f.auth(shop))
      .send({ reason: 'changed_mind', items, restock: false, ...extra });
  }

  async function refund(
    shop: Shop,
    orderId: number,
    items: { orderItemId: number; quantity: number }[],
    extra: Record<string, unknown> = {},
  ) {
    const res = await ret(shop, orderId, items, extra).expect(201);
    return body<Ret>(res);
  }

  const cardBalance = async (id: number) =>
    Number(
      (
        await db.query<RowDataPacket[]>(
          `SELECT remainingBalance FROM giftcard WHERE id = ?`,
          [id],
        )
      )[0].remainingBalance,
    );

  describe('tax-exclusive order with a discount code', () => {
    it('a partial return refunds the line net of its discount share plus its tax', async () => {
      // gross 250, 10% = 25 shared pro rata (A 20, B 5): A net 180 tax 9, B net 45. Total 234.
      const { shop, orderId, lineA } = await scenario('rf-excl');
      const r = await refund(shop, orderId, [
        { orderItemId: lineA, quantity: 1 },
      ]);
      // one unit of A: 100 - 10 discount + 4.50 tax (NOT the old 100)
      expect(Number(r.refundAmount)).toBe(94.5);
    });

    it('three partial returns sum EXACTLY to what was paid, and the order ends refunded', async () => {
      const { shop, orderId, lineA, lineB } = await scenario('rf-excl-sum');
      const paid = Number((await f.orderRow(orderId)).total);
      expect(paid).toBe(234);
      const r1 = await refund(shop, orderId, [
        { orderItemId: lineA, quantity: 1 },
      ]);
      const r2 = await refund(shop, orderId, [
        { orderItemId: lineB, quantity: 1 },
      ]);
      expect((await f.orderRow(orderId)).paymentStatus).not.toBe('refunded');
      const r3 = await refund(shop, orderId, [
        { orderItemId: lineA, quantity: 1 },
      ]);
      expect(Number(r1.refundAmount)).toBe(94.5);
      expect(Number(r2.refundAmount)).toBe(45);
      expect(Number(r3.refundAmount)).toBe(94.5);
      expect(
        Math.round(
          (Number(r1.refundAmount) +
            Number(r2.refundAmount) +
            Number(r3.refundAmount)) *
            100,
        ),
      ).toBe(Math.round(paid * 100));
      expect((await f.orderRow(orderId)).paymentStatus).toBe('refunded');
    });

    it('a manual refundAmount still wins over the default, and is still capped at the order total', async () => {
      const { shop, orderId, lineA, lineB } = await scenario('rf-manual');
      const r = await refund(
        shop,
        orderId,
        [{ orderItemId: lineA, quantity: 1 }],
        { refundAmount: 60 },
      );
      expect(Number(r.refundAmount)).toBe(60);
      // 60 already refunded of 234: a further 175 would exceed it, 174 would not.
      await ret(shop, orderId, [{ orderItemId: lineB, quantity: 1 }], {
        refundAmount: 175,
      }).expect(400);
      await ret(shop, orderId, [{ orderItemId: lineB, quantity: 1 }], {
        refundAmount: -1,
      }).expect(400);
      const r2 = await refund(
        shop,
        orderId,
        [{ orderItemId: lineB, quantity: 1 }],
        { refundAmount: 174 },
      );
      expect(Number(r2.refundAmount)).toBe(174);
    });

    it('never refunds more than was paid: a default after oversized manual refunds is clamped, never over the total', async () => {
      const { shop, orderId, lineA, lineB } = await scenario('rf-clamp');
      await refund(shop, orderId, [{ orderItemId: lineA, quantity: 1 }], {
        refundAmount: 200,
      });
      // only 34 of 234 is left; the default for B would be 45.
      const r = await refund(shop, orderId, [
        { orderItemId: lineB, quantity: 1 },
      ]);
      expect(Number(r.refundAmount)).toBe(34);
      const [{ s }] = await db.query<RowDataPacket[]>(
        `SELECT SUM(refundAmount) AS s FROM orderreturn WHERE orderId = ?`,
        [orderId],
      );
      expect(Number(s)).toBe(234);
    });
  });

  describe('tax-inclusive order', () => {
    it('does not add the tax a second time, and the returns still sum exactly to the total', async () => {
      // A 105 x2 (tax in the price), B 50 x1, 10% code: gross 260, discount 26, total 234.
      const { shop, orderId, lineA, lineB } = await scenario('rf-incl', {
        inclusive: true,
        priceA: 105,
      });
      expect(Number((await f.orderRow(orderId)).total)).toBe(234);
      const r1 = await refund(shop, orderId, [
        { orderItemId: lineA, quantity: 1 },
      ]);
      expect(Number(r1.refundAmount)).toBe(94.5); // 105 - 10.50, NOT + tax
      const r2 = await refund(shop, orderId, [
        { orderItemId: lineB, quantity: 1 },
      ]);
      expect(Number(r2.refundAmount)).toBe(45);
      const r3 = await refund(shop, orderId, [
        { orderItemId: lineA, quantity: 1 },
      ]);
      expect(
        Math.round(
          (Number(r1.refundAmount) +
            Number(r2.refundAmount) +
            Number(r3.refundAmount)) *
            100,
        ),
      ).toBe(23400);
    });

    it('reads the tax mode off the order, not the shop: flipping the shop toggle afterwards changes nothing', async () => {
      const { shop, orderId, lineA } = await scenario('rf-incl-flip', {
        inclusive: true,
        priceA: 105,
      });
      await f.setShop(shop, { taxInclusive: false });
      const r = await refund(shop, orderId, [
        { orderItemId: lineA, quantity: 1 },
      ]);
      expect(Number(r.refundAmount)).toBe(94.5);
    });
  });

  describe('KWD, 3 decimals', () => {
    it('keeps the third decimal and three partial returns sum exactly to the order total', async () => {
      const { shop, orderId, lineA, lineB } = await scenario('rf-kwd', {
        currency: 'KWD',
        priceA: 10.505,
        priceB: 4.125,
        qtyA: 3,
      });
      // gross 35.640, 10% = 3.564, net 32.076, tax on A 1.418 -> total 33.494
      const total = Number((await f.orderRow(orderId)).total);
      expect(total).toBe(33.494);
      const r1 = await refund(shop, orderId, [
        { orderItemId: lineA, quantity: 1 },
      ]);
      const r2 = await refund(shop, orderId, [
        { orderItemId: lineA, quantity: 1 },
        { orderItemId: lineB, quantity: 1 },
      ]);
      const r3 = await refund(shop, orderId, [
        { orderItemId: lineA, quantity: 1 },
      ]);
      // 10.505 - 1.0505 discount (rounds half up to 1.051) + 0.473 tax
      expect(Number(r1.refundAmount)).toBe(9.927);
      const sumMinor = [r1, r2, r3]
        .map((r) => Math.round(Number(r.refundAmount) * 1000))
        .reduce((s, v) => s + v, 0);
      expect(sumMinor).toBe(33494);
      for (const r of [r1, r2, r3]) {
        const v = Number(r.refundAmount) * 1000;
        expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-6);
      }
    });
  });

  describe('legacy and special orders', () => {
    it('a LEGACY order (captured tax NULL = unknown) keeps today default: price x qty', async () => {
      const { shop, orderId, lineA } = await scenario('rf-legacy');
      await db.execute(
        `UPDATE orderitem SET taxClassId = NULL, taxRate = NULL, taxAmount = NULL WHERE orderId = ?`,
        [orderId],
      );
      const r = await refund(shop, orderId, [
        { orderItemId: lineA, quantity: 1 },
      ]);
      expect(Number(r.refundAmount)).toBe(100);
    });

    it('an auto-discounted line is refunded at its charged price (no second discount) plus tax', async () => {
      const { shop, standard } = await taxedShop('rf-auto');
      const p = await f.stockedProduct(shop, 10, {
        price: 100,
        taxClassId: standard.id,
      });
      await f.publish(shop);
      await f.createDiscount(shop, {
        code: undefined,
        discountType: 'auto',
        type: 'PERCENTAGE',
        value: 20,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [p.id],
      });
      const res = await f.storefrontOrder(shop, [
        { productId: p.id, quantity: 2 },
      ]);
      const orderId = body<{ order: { id: number } }>(res).order.id;
      await f.advance(shop, orderId, 'delivered');
      const [line] = await f.orderItems(orderId);
      expect(Number(line.priceAtPurchase)).toBe(80);
      const r = await refund(shop, orderId, [
        { orderItemId: line.id as number, quantity: 1 },
      ]);
      expect(Number(r.refundAmount)).toBe(84); // 80 + 4 tax, order has no code discount
    });

    it('the delivery fee is not refunded by default: a full return refunds total minus the fee', async () => {
      const { shop, standard } = await taxedShop('rf-fee');
      const p = await f.stockedProduct(shop, 10, {
        price: 100,
        taxClassId: standard.id,
      });
      await f.publish(shop);
      const order = await f.adminOrder(
        shop,
        [{ productId: p.id, quantity: 1 }],
        {
          deliveryFee: 10,
        },
      );
      await f.advance(shop, order.id, 'delivered');
      const row = await f.orderRow(order.id);
      expect(Number(row.total)).toBe(115); // 100 + 5 tax + 10 fee
      const [line] = await f.orderItems(order.id);
      const r = await refund(shop, order.id, [
        { orderItemId: line.id as number, quantity: 1 },
      ]);
      expect(Number(r.refundAmount)).toBe(105);
      expect((await f.orderRow(order.id)).paymentStatus).not.toBe('refunded');
    });
  });

  describe('gift-card-paid order', () => {
    it('the refund is the paid share; the gift/provider split is unchanged and sums exactly to it', async () => {
      const { shop, card, orderId, lineA, lineB } = await scenario('rf-gift', {
        giftCard: 100,
      });
      const r1 = await refund(shop, orderId, [
        { orderItemId: lineA, quantity: 1 },
      ]);
      expect(Number(r1.refundAmount)).toBe(94.5);
      // 100 of 234 came off the card: 94.5 * 100 / 234 = 40.3846 -> 40.38
      expect(Number(r1.giftCardRefundAmount)).toBe(40.38);
      const r2 = await refund(shop, orderId, [
        { orderItemId: lineB, quantity: 1 },
      ]);
      const r3 = await refund(shop, orderId, [
        { orderItemId: lineA, quantity: 1 },
      ]);
      const gift = [r1, r2, r3].reduce(
        (s, r) => s + Math.round(Number(r.giftCardRefundAmount) * 100),
        0,
      );
      expect(gift).toBe(10000); // the card gets back exactly what it paid
      expect(await cardBalance(card!.id)).toBe(100);
    });
  });

  describe('concurrent returns', () => {
    it('two simultaneous full returns of the same line: exactly one succeeds, caps hold, nothing is credited or restocked twice', async () => {
      const { shop, a, card, orderId, lineA } = await scenario('rf-race', {
        giftCard: 100,
        qtyA: 1,
      });
      const stockBefore = await f.productStock(shop.outletId, a.id);
      const results = await Promise.all(
        [0, 1, 2].map(() =>
          request(f.http())
            .post(`/orders/${orderId}/returns`)
            .set(f.auth(shop))
            .send({
              reason: 'changed_mind',
              items: [{ orderItemId: lineA, quantity: 1 }],
            }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 400, 400]);
      const [{ n, g }] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(giftCardRefundAmount),0) AS g FROM orderreturn WHERE orderId = ?`,
        [orderId],
      );
      expect(Number(n)).toBe(1);
      const [{ q }] = await db.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(ri.quantity),0) AS q FROM orderreturnitem ri JOIN orderreturn r ON r.id = ri.orderReturnId WHERE r.orderId = ?`,
        [orderId],
      );
      expect(Number(q)).toBe(1);
      // stock restocked once, card credited once (balance = 0 left after paying 100, + the one credit)
      expect(await f.productStock(shop.outletId, a.id)).toBe(stockBefore + 1);
      expect(await cardBalance(card!.id)).toBeCloseTo(Number(g), 6);
    });
  });
});
