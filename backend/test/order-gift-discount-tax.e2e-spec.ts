import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { minorUnitFactor } from '../src/common/currency-minor-units';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// W5 (audit 7.6 / D-6). One order that combines ALL THREE money levers: an
// order-level discount code, per-line tax across mixed classes, and a gift card,
// plus the return that reverses it. Pins the ordering the three are applied in:
//
//   1. line prices (auto-discounts are already in them)
//   2. order-level discount code  -> apportioned pro rata across lines (it reduces the taxable base)
//   3. tax per line on the discounted base
//   4. total = discounted subtotal + tax (+ delivery)
//   5. gift card applies to the FINAL total, as a payment credit, never a price reduction
describe('Gift card + discount + tax on one order (e2e)', () => {
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

  async function taxedShop(prefix: string, currency?: string) {
    const shop = await f.setupShop(prefix);
    await f.setShop(shop, {
      taxRate: 5,
      taxInclusive: false,
      ...(currency ? { currency } : {}),
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

  async function issueCard(shop: Shop, value: number) {
    const res = await request(f.http())
      .post('/gift-cards')
      .set(f.auth(shop))
      .send({ initialValue: value })
      .expect(201);
    return body<{ id: number; code: string }>(res);
  }

  async function cardRow(id: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT remainingBalance, status FROM giftcard WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  async function discountRow(id: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT timesUsed FROM discount WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  const isWholeMinorUnit = (v: number | string, currency: string) => {
    const f2 = minorUnitFactor(currency);
    return Math.abs(Number(v) * f2 - Math.round(Number(v) * f2)) < 1e-6;
  };

  describe('AED, 2 decimals', () => {
    async function scenario(prefix: string, cardValue: number) {
      const { shop, standard, zero } = await taxedShop(prefix);
      const a = await f.stockedProduct(shop, 10, {
        price: 100,
        taxClassId: standard.id,
      });
      const b = await f.stockedProduct(shop, 10, {
        price: 50,
        taxClassId: zero.id,
      });
      await f.publish(shop);
      const discount = await f.createDiscount(shop, {
        type: 'PERCENTAGE',
        value: 10,
      });
      const card = await issueCard(shop, cardValue);
      const res = await f.storefrontOrder(
        shop,
        [
          { productId: a.id, quantity: 2 },
          { productId: b.id, quantity: 1 },
        ],
        { discountCode: discount.code, giftCardCode: card.code },
      );
      const order = body<{ order: { id: number } }>(res).order;
      return { shop, a, b, discount, card, orderId: order.id };
    }

    it('applies discount -> per-line tax -> total -> gift card in that order, and every figure reconciles', async () => {
      const { shop, a, b, discount, card, orderId } = await scenario(
        'gdt-aed',
        100,
      );
      const row = await f.orderRow(orderId);
      // gross 250; 10% = 25, shared pro rata (A 20, B 5) -> A net 180, tax 9; B net 45, tax 0
      expect(Number(row.discountAmount)).toBe(25);
      expect(Number(row.taxAmount)).toBe(9);
      expect(Number(row.total)).toBe(225 + 9);
      // the card is a payment credit against the FINAL total
      expect(Number(row.giftCardAmount)).toBe(100);
      expect(row.paymentStatus).not.toBe('paid'); // 134 still owed
      expect((await cardRow(card.id)).remainingBalance).toEqual(
        expect.anything(),
      );
      expect(Number((await cardRow(card.id)).remainingBalance)).toBe(0);
      expect((await cardRow(card.id)).status).toBe('redeemed');
      expect((await discountRow(discount.id)).timesUsed).toBe(1);

      const items = await f.orderItems(orderId);
      const byProduct = new Map(items.map((i) => [i.productId as number, i]));
      expect(Number(byProduct.get(a.id)!.taxAmount)).toBe(9);
      expect(Number(byProduct.get(a.id)!.taxRate)).toBe(5);
      expect(Number(byProduct.get(b.id)!.taxAmount)).toBe(0);
      expect(Number(byProduct.get(b.id)!.taxRate)).toBe(0);
      // Per-line captured tax sums to the order tax.
      expect(items.reduce((s, i) => s + Number(i.taxAmount), 0)).toBe(
        Number(row.taxAmount),
      );
      // Stock was reserved for both lines.
      expect(await f.productStock(shop.outletId, a.id)).toBe(8);
      expect(await f.productStock(shop.outletId, b.id)).toBe(9);
    });

    it('a card larger than the total is capped at the total: order is paid, card keeps the change', async () => {
      const { card, orderId } = await scenario('gdt-aed-full', 500);
      const row = await f.orderRow(orderId);
      expect(Number(row.total)).toBe(234);
      expect(Number(row.giftCardAmount)).toBe(234);
      expect(row.paymentStatus).toBe('paid');
      expect(Number((await cardRow(card.id)).remainingBalance)).toBe(500 - 234);
    });

    it('the card is NOT a price reduction: it does not change tax or discount, only what is owed', async () => {
      const withCard = await scenario('gdt-aed-nc1', 100);
      const rowWith = await f.orderRow(withCard.orderId);
      const { shop, standard, zero } = await taxedShop('gdt-aed-nc2');
      const a = await f.stockedProduct(shop, 10, {
        price: 100,
        taxClassId: standard.id,
      });
      const b = await f.stockedProduct(shop, 10, {
        price: 50,
        taxClassId: zero.id,
      });
      await f.publish(shop);
      const discount = await f.createDiscount(shop, {
        type: 'PERCENTAGE',
        value: 10,
      });
      const res = await f.storefrontOrder(
        shop,
        [
          { productId: a.id, quantity: 2 },
          { productId: b.id, quantity: 1 },
        ],
        { discountCode: discount.code },
      );
      const rowWithout = await f.orderRow(
        body<{ order: { id: number } }>(res).order.id,
      );
      for (const col of ['total', 'taxAmount', 'discountAmount']) {
        expect(Number(rowWith[col])).toBe(Number(rowWithout[col]));
      }
    });

    it('a full return reverses the gift card share and the order never refunds more than it took (running-total cap)', async () => {
      const { shop, a, b, card, orderId } = await scenario('gdt-aed-ret', 100);
      await f.advance(shop, orderId, 'delivered');
      const detail = await request(f.http())
        .get(`/orders/${orderId}`)
        .set(f.auth(shop))
        .expect(200);
      const lines = body<{
        orderitem: { id: number; productId: number; quantity: number }[];
      }>(detail).orderitem;
      const lineA = lines.find((l) => l.productId === a.id)!;
      const lineB = lines.find((l) => l.productId === b.id)!;

      const ret = await request(f.http())
        .post(`/orders/${orderId}/returns`)
        .set(f.auth(shop))
        .send({
          reason: 'changed_mind',
          items: [
            { orderItemId: lineA.id, quantity: 2 },
            { orderItemId: lineB.id, quantity: 1 },
          ],
          refundAmount: 234, // the order total, as the merchant would enter it
        })
        .expect(201);
      const r = body<{ refundAmount: string; giftCardRefundAmount: string }>(
        ret,
      );
      expect(Number(r.refundAmount)).toBe(234);
      // 100 of the 234 came off the card, so exactly that share goes back to it.
      expect(Number(r.giftCardRefundAmount)).toBeCloseTo(100, 6);
      expect(Number((await cardRow(card.id)).remainingBalance)).toBeCloseTo(
        100,
        6,
      );
      // restocked
      expect(await f.productStock(shop.outletId, a.id)).toBe(10);
      expect(await f.productStock(shop.outletId, b.id)).toBe(10);
      // nothing is left to return or refund
      await request(f.http())
        .post(`/orders/${orderId}/returns`)
        .set(f.auth(shop))
        .send({
          reason: 'changed_mind',
          items: [{ orderItemId: lineB.id, quantity: 1 }],
          refundAmount: 1,
        })
        .expect(400);
    });

    it('F7 (fixed): the DEFAULT refund is the returned line\'s share of what the customer paid (discount and tax included)', async () => {
      // Was pinned at priceAtPurchase x qty = 100. Returning line A x1 now refunds
      // 94.50: 100 - 10 (its share of the 10% discount) + 4.50 tax. The detailed
      // matrix (inclusive, KWD, partials, legacy, override, race) lives in
      // return-refund-paid-share.e2e-spec.ts.
      const { shop, a, orderId } = await scenario('gdt-aed-def', 500);
      await f.advance(shop, orderId, 'delivered');
      const detail = await request(f.http())
        .get(`/orders/${orderId}`)
        .set(f.auth(shop))
        .expect(200);
      const lineA = body<{ orderitem: { id: number; productId: number }[] }>(
        detail,
      ).orderitem.find((l) => l.productId === a.id)!;
      const ret = await request(f.http())
        .post(`/orders/${orderId}/returns`)
        .set(f.auth(shop))
        .send({
          reason: 'changed_mind',
          items: [{ orderItemId: lineA.id, quantity: 1 }],
        })
        .expect(201);
      expect(Number(body<{ refundAmount: string }>(ret).refundAmount)).toBe(
        94.5,
      );
    });

    // FINDING F6. ReturnsService writes orderreturn.refundAmount and
    // giftCardRefundAmount, and credits giftcard.remainingBalance, without
    // roundMoney: the proportional gift-card split is a raw float
    // (100 * 100 / 234 = 42.735042...) stored into DECIMAL(65,30). That breaks the
    // "round once per stored column to the currency's minor unit" policy and leaves
    // the card with a balance no one can pay out.
    it(
      'FINDING F6: a partial return on a gift-card order credits whole minor units only',
      async () => {
        const { shop, a, card, orderId } = await scenario('gdt-aed-round', 100);
        await f.advance(shop, orderId, 'delivered');
        const detail = await request(f.http())
          .get(`/orders/${orderId}`)
          .set(f.auth(shop))
          .expect(200);
        const lineA = body<{ orderitem: { id: number; productId: number }[] }>(
          detail,
        ).orderitem.find((l) => l.productId === a.id)!;
        const ret = await request(f.http())
          .post(`/orders/${orderId}/returns`)
          .set(f.auth(shop))
          .send({
            reason: 'changed_mind',
            items: [{ orderItemId: lineA.id, quantity: 1 }],
            refundAmount: 100,
            restock: false,
          })
          .expect(201);
        const r = body<{ giftCardRefundAmount: string }>(ret);
        expect(isWholeMinorUnit(r.giftCardRefundAmount, 'AED')).toBe(true); // 42.735042...
        expect(Number(r.giftCardRefundAmount)).toBe(42.74);
        expect(
          isWholeMinorUnit(
            (await cardRow(card.id)).remainingBalance as string,
            'AED',
          ),
        ).toBe(true);
        expect(Number((await cardRow(card.id)).remainingBalance)).toBe(42.74);
      },
    );
  });

  describe('KWD, 3 decimals', () => {
    it('keeps the third decimal through discount, tax and gift card, rounding each stored column once', async () => {
      const { shop, standard, zero } = await taxedShop('gdt-kwd', 'KWD');
      const a = await f.stockedProduct(shop, 10, {
        price: 10.505,
        taxClassId: standard.id,
      });
      const b = await f.stockedProduct(shop, 10, {
        price: 4.125,
        taxClassId: zero.id,
      });
      await f.publish(shop);
      const discount = await f.createDiscount(shop, {
        type: 'PERCENTAGE',
        value: 10,
      });
      const card = await issueCard(shop, 10);
      const res = await f.storefrontOrder(
        shop,
        [
          { productId: a.id, quantity: 3 }, // 31.515
          { productId: b.id, quantity: 1 }, // 4.125
        ],
        { discountCode: discount.code, giftCardCode: card.code },
      );
      const orderId = body<{ order: { id: number } }>(res).order.id;
      const row = await f.orderRow(orderId);
      expect(row.currency).toBe('KWD');

      // gross 35.640, 10% = 3.564, net 32.076; tax only on A: 28.3635 * 5% = 1.418175 -> 1.418
      expect(Number(row.taxAmount)).toBe(1.418);
      expect(Number(row.total)).toBe(33.494); // 32.076 + 1.418175 = 33.494175, rounded ONCE
      expect(Number(row.giftCardAmount)).toBe(10);
      // every stored money column is a whole fils
      for (const col of [
        'total',
        'taxAmount',
        'discountAmount',
        'giftCardAmount',
      ]) {
        expect(isWholeMinorUnit(row[col] as string, 'KWD')).toBe(true);
      }
      const items = await f.orderItems(orderId);
      for (const i of items)
        expect(isWholeMinorUnit(i.taxAmount as string, 'KWD')).toBe(true);
      expect(Number(items.find((i) => i.productId === a.id)!.taxAmount)).toBe(
        1.418,
      );
      expect(Number(items.find((i) => i.productId === b.id)!.taxAmount)).toBe(
        0,
      );
      expect(Number((await cardRow(card.id)).remainingBalance)).toBe(0);
    });
  });

  describe('gift-card refund split in KWD (3 decimals)', () => {
    it('splits each return in whole fils, and the returns together give the card back exactly what it paid', async () => {
      const { shop, standard, zero } = await taxedShop('gdt-kwd-ret', 'KWD');
      const a = await f.stockedProduct(shop, 10, {
        price: 10.505,
        taxClassId: standard.id,
      });
      const b = await f.stockedProduct(shop, 10, {
        price: 4.125,
        taxClassId: zero.id,
      });
      await f.publish(shop);
      const discount = await f.createDiscount(shop, {
        type: 'PERCENTAGE',
        value: 10,
      });
      const card = await issueCard(shop, 10);
      const res = await f.storefrontOrder(
        shop,
        [
          { productId: a.id, quantity: 3 },
          { productId: b.id, quantity: 1 },
        ],
        { discountCode: discount.code, giftCardCode: card.code },
      );
      const orderId = body<{ order: { id: number } }>(res).order.id;
      expect(Number((await f.orderRow(orderId)).total)).toBe(33.494);
      expect(Number((await cardRow(card.id)).remainingBalance)).toBe(0);
      await f.advance(shop, orderId, 'delivered');
      const items = await f.orderItems(orderId);
      const lineA = items.find((i) => i.productId === a.id)!;
      const lineB = items.find((i) => i.productId === b.id)!;

      const giveBack = async (orderItemId: number, refundAmount: number) =>
        body<{ refundAmount: string; giftCardRefundAmount: string }>(
          await request(f.http())
            .post(`/orders/${orderId}/returns`)
            .set(f.auth(shop))
            .send({
              reason: 'changed_mind',
              items: [{ orderItemId, quantity: 1 }],
              refundAmount,
              restock: false,
            })
            .expect(201),
        );

      // 10 * 10 / 33.494 = 2.98560... -> 2.986
      const r1 = await giveBack(lineA.id as number, 10);
      expect(Number(r1.giftCardRefundAmount)).toBe(2.986);
      // The return that completes the refund returns the rest of the card
      // exactly (7.014), not a re-rounded 23.494 * 10 / 33.494 share.
      const r2 = await giveBack(lineB.id as number, 23.494);
      expect(Number(r2.giftCardRefundAmount)).toBe(7.014);
      expect(Number(r1.refundAmount) + Number(r2.refundAmount)).toBeCloseTo(
        33.494,
        6,
      );
      const balance = (await cardRow(card.id)).remainingBalance as string;
      expect(isWholeMinorUnit(balance, 'KWD')).toBe(true);
      expect(Number(balance)).toBe(10);
    });
  });

  describe('SPECIFIC_PRODUCTS / SPECIFIC_COLLECTIONS codes at checkout', () => {
    // FINDING F8 (fixed). Every order-creation path used to call
    // discountsService.evaluate() with only { cartSubtotal } and no
    // productIds/collectionIds, so a scoped code was rejected as not_eligible
    // at checkout while POST /discounts/validate called it valid; and the
    // amount ran on the whole cart. Eligibility, the eligible subtotal and the
    // amount now come from one function (discounts/discount-eligibility.ts)
    // over the RESOLVED order lines. Full matrix: discount-eligibility.e2e-spec.ts.
    it('FINDING F8: a code scoped to one product is accepted at checkout for a cart containing it, and discounts only that line', async () => {
      const { shop, standard } = await taxedShop('gdt-scoped');
      const a = await f.stockedProduct(shop, 10, {
        price: 100,
        taxClassId: standard.id,
      });
      const b = await f.stockedProduct(shop, 10, {
        price: 50,
        taxClassId: standard.id,
      });
      await f.publish(shop);
      const discount = await f.createDiscount(shop, {
        type: 'PERCENTAGE',
        value: 10,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [a.id],
      });
      const res = await f.storefrontOrderRaw(
        shop,
        [
          { productId: a.id, quantity: 1 },
          { productId: b.id, quantity: 1 },
        ],
        { discountCode: discount.code },
      );
      expect(res.status).toBe(201);
      const row = await f.orderRow(
        body<{ order: { id: number } }>(res).order.id,
      );
      expect(Number(row.discountAmount)).toBe(10); // 10% of A only, not of the 150 cart
    });

    it('the validate endpoint and checkout agree the same code is valid for that cart', async () => {
      const { shop, standard } = await taxedShop('gdt-scoped-v');
      const a = await f.stockedProduct(shop, 10, {
        price: 100,
        taxClassId: standard.id,
      });
      await f.publish(shop);
      const discount = await f.createDiscount(shop, {
        type: 'PERCENTAGE',
        value: 10,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [a.id],
      });
      const res = await request(f.http())
        .post(`/public/${shop.slug}/discounts/validate`)
        .send({ code: discount.code, cartSubtotal: 100, productIds: [a.id] });
      expect(body<{ valid: boolean }>(res).valid).toBe(true);
      const checkout = await f.storefrontOrderRaw(
        shop,
        [{ productId: a.id, quantity: 1 }],
        { discountCode: discount.code },
      );
      expect(checkout.status).toBe(201);
    });
  });
});
