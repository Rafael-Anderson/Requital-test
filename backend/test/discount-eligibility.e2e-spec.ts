import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

// F8: a discount scoped to products or collections used to be rejected at
// every checkout path while POST /discounts/validate called it valid (the
// order paths never told evaluate() which products were in the cart), and the
// amount ran on the whole cart. One function now decides eligibility, the
// eligible subtotal and the amount (discounts/discount-eligibility.ts) over
// the RESOLVED lines. This table pins that the public validate response, the
// storefront order, the admin order and the draft order always agree.

interface ValidateBody {
  valid: boolean;
  reason?: string;
  message?: string;
  discountAmount?: number;
  freeShipping?: boolean;
}

describe('Discount eligibility: validate and charge agree (e2e)', () => {
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
  type Item = { productId: number; quantity: number };

  const DELIVERY_FEE = 15;

  // Product A (100) is in the shop's "Goods" collection; product B (50) is in
  // a second collection, so a collection scope and a product scope can each
  // split a basket.
  async function world(prefix: string) {
    const shop = await f.setupShop(prefix);
    await f.setShop(shop, { taxRate: 5, taxInclusive: false });
    const other = await request(f.http())
      .post('/collections')
      .set(f.auth(shop))
      .send({ name: 'Other' })
      .expect(201);
    const otherCollectionId = body<{ id: number }>(other).id;
    const a = await f.stockedProduct(shop, 1000, { price: 100 });
    const b = await f.stockedProduct(shop, 1000, {
      price: 50,
      collectionIds: [otherCollectionId],
    });
    await f.publish(shop);
    return { shop, a, b, otherCollectionId };
  }

  function validatePublic(shop: Shop, code: string, items: Item[]) {
    return request(f.http())
      .post(`/public/${shop.slug}/discounts/validate`)
      .send({
        code,
        cartSubtotal: 0, // deliberately wrong: the server must price the lines itself
        items,
      });
  }

  async function validateAdmin(shop: Shop, code: string, items: Item[]) {
    const res = await request(f.http())
      .post('/shop/discounts/validate')
      .set(f.auth(shop))
      .send({ code, cartSubtotal: 0, items })
      .expect(201);
    return body<ValidateBody>(res);
  }

  function adminOrderRaw(shop: Shop, items: Item[], code: string) {
    return request(f.http()).post('/orders').set(f.auth(shop)).send({
      customerName: 'Elig Customer',
      customerPhone: '0501112222',
      customerAddress: 'Pickup',
      outletId: shop.outletId,
      orderType: 'pickup',
      deliveryFee: DELIVERY_FEE,
      items,
      discountCode: code,
    });
  }

  async function timesUsed(discountId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT timesUsed FROM discount WHERE id = ?`,
      [discountId],
    );
    return rows[0].timesUsed as number;
  }

  // order total must be (goods - discount) + tax + delivery, to within the
  // single rounding of the total (tax is exclusive on this shop).
  function expectTotalAddsUp(
    row: RowDataPacket,
    goods: number,
    discount: number,
  ) {
    expect(Number(row.total)).toBeCloseTo(
      goods -
        discount +
        Number(row.taxAmount ?? 0) +
        Number(row.deliveryFee ?? 0),
      1,
    );
  }

  const SCOPES = ['ALL_PRODUCTS', 'SPECIFIC_PRODUCTS', 'SPECIFIC_COLLECTIONS'];
  const TYPES = ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING'];
  const BASKETS = ['eligible', 'ineligible', 'mixed'];

  const cells = SCOPES.flatMap((scope) =>
    TYPES.flatMap((type) => BASKETS.map((basket) => [scope, type, basket])),
  );

  describe('{scope} x {type} x {basket}: validate === storefront order === admin order', () => {
    let w: Awaited<ReturnType<typeof world>>;
    beforeAll(async () => {
      w = await world('de-matrix');
    });

    it.each(cells)('%s / %s / %s basket', async (scope, type, basket) => {
      const { shop, a, b } = w;
      const items: Item[] =
        basket === 'eligible'
          ? [{ productId: a.id, quantity: 1 }]
          : basket === 'ineligible'
            ? [{ productId: b.id, quantity: 2 }]
            : [
                { productId: a.id, quantity: 1 },
                { productId: b.id, quantity: 2 },
              ];
      const goods = items.reduce(
        (s, i) => s + i.quantity * (i.productId === a.id ? 100 : 50),
        0,
      );
      // Independent oracle: which lines the scope covers.
      const eligibleSubtotal = items
        .filter((i) => scope === 'ALL_PRODUCTS' || i.productId === a.id)
        .reduce(
          (s, i) => s + i.quantity * (i.productId === a.id ? 100 : 50),
          0,
        );
      const expectedValid = eligibleSubtotal > 0;
      const expectedAmount =
        type === 'PERCENTAGE'
          ? eligibleSubtotal * 0.1
          : type === 'FIXED_AMOUNT'
            ? Math.min(30, eligibleSubtotal)
            : 0;

      const discount = await f.createDiscount(shop, {
        type,
        // the fixture defaults a value in; FREE_SHIPPING must not carry one
        value:
          type === 'FREE_SHIPPING'
            ? undefined
            : type === 'PERCENTAGE'
              ? 10
              : 30,
        appliesTo: scope,
        ...(scope === 'SPECIFIC_PRODUCTS' ? { productIds: [a.id] } : {}),
        ...(scope === 'SPECIFIC_COLLECTIONS'
          ? { collectionIds: [shop.collectionId] }
          : {}),
      });
      const code = discount.code!;

      // 1. what the shopper (public) and the merchant (admin) are shown
      const pub = body<ValidateBody>(await validatePublic(shop, code, items));
      const adm = await validateAdmin(shop, code, items);
      expect(pub.valid).toBe(expectedValid);
      expect(adm).toEqual(pub);
      if (expectedValid) {
        expect(pub.discountAmount).toBeCloseTo(expectedAmount, 5);
        expect(pub.freeShipping).toBe(type === 'FREE_SHIPPING');
      } else {
        expect(pub.reason).toBe('not_eligible');
      }

      // 2. what is actually charged, on both order-creation paths
      const sf = await f.storefrontOrderRaw(shop, items, {
        discountCode: code,
      });
      const ad = await adminOrderRaw(shop, items, code);
      if (!expectedValid) {
        expect(sf.status).toBe(400);
        expect(ad.status).toBe(400);
        expect(body<{ message: string }>(sf).message).toBe(pub.message);
        expect(body<{ message: string }>(ad).message).toBe(pub.message);
        expect(await timesUsed(discount.id)).toBe(0);
        return;
      }
      expect(sf.status).toBe(201);
      expect(ad.status).toBe(201);
      const sfRow = await f.orderRow(
        body<{ order: { id: number } }>(sf).order.id,
      );
      const adRow = await f.orderRow(body<{ id: number }>(ad).id);

      for (const row of [sfRow, adRow]) {
        expect(Number(row.discountAmount)).toBeCloseTo(pub.discountAmount!, 5);
        expect(Number(row.discountAmount)).toBeCloseTo(expectedAmount, 5);
        expectTotalAddsUp(row, goods, pub.discountAmount!);
      }
      // free shipping: the storefront order is pickup (fee 0 regardless); the
      // admin order carries a real fee, which only an eligible code zeroes.
      expect(Number(adRow.deliveryFee)).toBe(
        type === 'FREE_SHIPPING' ? 0 : DELIVERY_FEE,
      );
      // the atomic usage claim ran once per order
      expect(await timesUsed(discount.id)).toBe(2);
    });
  });

  describe('auto-discount path', () => {
    it('an auto discount scoped to a collection marks down only that collection line, and a code is then evaluated on the marked-down price', async () => {
      const { shop, a, b } = await world('de-auto');
      await f.createDiscount(shop, {
        code: undefined,
        discountType: 'auto',
        type: 'PERCENTAGE',
        value: 20,
        appliesTo: 'SPECIFIC_COLLECTIONS',
        collectionIds: [shop.collectionId],
      });
      const code = (
        await f.createDiscount(shop, {
          type: 'PERCENTAGE',
          value: 10,
          appliesTo: 'SPECIFIC_PRODUCTS',
          productIds: [a.id],
        })
      ).code!;
      const items: Item[] = [
        { productId: a.id, quantity: 1 },
        { productId: b.id, quantity: 1 },
      ];
      const pub = body<ValidateBody>(await validatePublic(shop, code, items));
      // A is 80 after the auto markdown; 10% of that line only = 8
      expect(pub.valid).toBe(true);
      expect(pub.discountAmount).toBeCloseTo(8, 5);

      const sf = await f.storefrontOrder(shop, items, { discountCode: code });
      const orderId = body<{ order: { id: number } }>(sf).order.id;
      const row = await f.orderRow(orderId);
      expect(Number(row.discountAmount)).toBeCloseTo(8, 5);
      const lines = await f.orderItems(orderId);
      const lineA = lines.find((l) => l.productId === a.id)!;
      const lineB = lines.find((l) => l.productId === b.id)!;
      expect(Number(lineA.priceAtPurchase)).toBe(80);
      expect(Number(lineA.autoDiscountAmount)).toBe(20);
      expect(Number(lineB.priceAtPurchase)).toBe(50);
      expect(lineB.autoDiscountAmount).toBeNull();
    });
  });

  describe('draft-order completion', () => {
    it('a scoped code is accepted on a draft, its previewed amount covers only the eligible lines, and completing charges the same', async () => {
      const { shop, a, b } = await world('de-draft');
      const code = (
        await f.createDiscount(shop, {
          type: 'PERCENTAGE',
          value: 10,
          appliesTo: 'SPECIFIC_PRODUCTS',
          productIds: [a.id],
        })
      ).code!;
      const items: Item[] = [
        { productId: a.id, quantity: 1 },
        { productId: b.id, quantity: 2 },
      ];
      const draftRes = await request(f.http())
        .post('/shop/draft-orders')
        .set(f.auth(shop))
        .send({
          outletId: shop.outletId,
          customerName: 'Draft Customer',
          customerPhone: '0503334444',
          customerAddress: 'Pickup',
          orderType: 'pickup',
          items,
          discountCode: code,
        })
        .expect(201);
      const draft = body<{
        id: number;
        subtotal: number;
        discountAmount: number;
        total: number;
      }>(draftRes);
      expect(draft.subtotal).toBe(200);
      expect(draft.discountAmount).toBeCloseTo(10, 5); // 10% of A only, not of 200
      expect(draft.total).toBeCloseTo(190, 5);

      // the admin builder's live preview says the same thing
      const adm = await validateAdmin(shop, code, items);
      expect(adm.discountAmount).toBeCloseTo(draft.discountAmount, 5);

      const done = await request(f.http())
        .post(`/shop/draft-orders/${draft.id}/complete`)
        .set(f.auth(shop))
        .expect(201);
      const row = await f.orderRow(
        body<{ convertedOrder: { id: number } }>(done).convertedOrder.id,
      );
      expect(Number(row.discountAmount)).toBeCloseTo(10, 5);
      expectTotalAddsUp(row, 200, 10);
    });

    it('a code that covers nothing on the draft is refused at attach time with the same reason validate gives', async () => {
      const { shop, a, b } = await world('de-draft-no');
      const code = (
        await f.createDiscount(shop, {
          type: 'PERCENTAGE',
          value: 10,
          appliesTo: 'SPECIFIC_COLLECTIONS',
          collectionIds: [shop.collectionId],
        })
      ).code!;
      const items: Item[] = [{ productId: b.id, quantity: 1 }];
      const adm = await validateAdmin(shop, code, items);
      expect(adm.reason).toBe('not_eligible');
      const res = await request(f.http())
        .post('/shop/draft-orders')
        .set(f.auth(shop))
        .send({
          outletId: shop.outletId,
          customerName: 'Draft Customer',
          customerPhone: '0503334445',
          customerAddress: 'Pickup',
          orderType: 'pickup',
          items,
          discountCode: code,
        })
        .expect(400);
      expect(body<{ message: string }>(res).message).toBe(adm.message);
      expect(a.id).toBeGreaterThan(0);
    });
  });

  describe('editing an order keeps a scoped code honest', () => {
    it('a collection-scoped code survives an item edit that still contains the collection, and is dropped when it no longer does', async () => {
      const { shop, a, b } = await world('de-edit');
      const code = (
        await f.createDiscount(shop, {
          type: 'PERCENTAGE',
          value: 10,
          appliesTo: 'SPECIFIC_COLLECTIONS',
          collectionIds: [shop.collectionId],
        })
      ).code!;
      const res = await adminOrderRaw(
        shop,
        [
          { productId: a.id, quantity: 1 },
          { productId: b.id, quantity: 1 },
        ],
        code,
      );
      expect(res.status).toBe(201);
      const orderId = body<{ id: number }>(res).id;
      expect(Number((await f.orderRow(orderId)).discountAmount)).toBeCloseTo(
        10,
        5,
      );

      // still contains A (the collection): 10% of A's 200 only
      await f
        .editItems(shop, orderId, [
          { productId: a.id, quantity: 2 },
          { productId: b.id, quantity: 1 },
        ])
        .expect(200);
      expect(Number((await f.orderRow(orderId)).discountAmount)).toBeCloseTo(
        20,
        5,
      );

      // only B left: the code no longer covers anything
      await f
        .editItems(shop, orderId, [{ productId: b.id, quantity: 1 }])
        .expect(200);
      expect(Number((await f.orderRow(orderId)).discountAmount)).toBe(0);
    });
  });

  describe('usage and per-customer limits are unchanged', () => {
    it('concurrent checkouts against a scoped code with usageLimit 1: exactly one wins', async () => {
      const { shop, a } = await world('de-race');
      const d = await f.createDiscount(shop, {
        type: 'PERCENTAGE',
        value: 10,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [a.id],
        usageLimit: 1,
      });
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          f.storefrontOrderRaw(shop, [{ productId: a.id, quantity: 1 }], {
            discountCode: d.code,
          }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await timesUsed(d.id)).toBe(1);
      const after = body<ValidateBody>(
        await validatePublic(shop, d.code!, [{ productId: a.id, quantity: 1 }]),
      );
      expect(after).toMatchObject({
        valid: false,
        reason: 'usage_limit_reached',
      });
    });

    it('per-customer limit still applies to a scoped code once the customer has redeemed it', async () => {
      const { shop, a } = await world('de-percust');
      const d = await f.createDiscount(shop, {
        type: 'PERCENTAGE',
        value: 10,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [a.id],
        usageLimitPerCustomer: 1,
      });
      const items: Item[] = [{ productId: a.id, quantity: 1 }];
      await f.storefrontOrder(shop, items, { discountCode: d.code });
      const [cust] = await db.query<RowDataPacket[]>(
        `SELECT id FROM customer WHERE shopId = ? AND phone IS NOT NULL ORDER BY id DESC LIMIT 1`,
        [shop.shopId],
      );
      const res = await request(f.http())
        .post('/shop/discounts/validate')
        .set(f.auth(shop))
        .send({
          code: d.code,
          cartSubtotal: 0,
          items,
          customerId: cust.id as number,
        })
        .expect(201);
      expect(body<ValidateBody>(res)).toMatchObject({
        valid: false,
        reason: 'per_customer_limit_reached',
      });
    });
  });

  describe('tenant isolation', () => {
    it("another shop's code is not_found on validate and checkout, and another shop's product is refused", async () => {
      const one = await world('de-iso-a');
      const two = await world('de-iso-b');
      const d = await f.createDiscount(one.shop, {
        type: 'PERCENTAGE',
        value: 10,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [one.a.id],
      });
      // shop two's own product, shop one's code
      const items: Item[] = [{ productId: two.a.id, quantity: 1 }];
      const pub = body<ValidateBody>(
        await validatePublic(two.shop, d.code!, items),
      );
      expect(pub).toMatchObject({ valid: false, reason: 'not_found' });
      expect(await validateAdmin(two.shop, d.code!, items)).toMatchObject({
        valid: false,
        reason: 'not_found',
      });
      const sf = await f.storefrontOrderRaw(two.shop, items, {
        discountCode: d.code,
      });
      expect(sf.status).toBe(400);
      expect(await timesUsed(d.id)).toBe(0);

      // shop one's product id sent under shop two's slug never reaches pricing
      const foreign = await validatePublic(two.shop, d.code!, [
        { productId: one.a.id, quantity: 1 },
      ]);
      expect(foreign.status).toBe(400);
    });
  });
});
