import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

// F2: order size caps. Before this, quantity was @IsInt @IsPositive with no
// ceiling on every create/update DTO and items had no @ArrayMaxSize, while the
// delivery quote already refused quantity > 999 and more than 100 lines, so
// the quote could reject a cart the order accepted. A gift-card line issued
// one INSERT per unit inside the order transaction, so a huge quantity was a
// huge transaction plus one huge email.
describe('Order size caps (e2e)', () => {
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

  async function world(prefix: string) {
    const shop = await f.setupShop(prefix);
    const a = await f.stockedProduct(shop, 1000, { price: 10 });
    const b = await f.stockedProduct(shop, 1000, { price: 10 });
    const gift = await request(f.http())
      .post('/products')
      .set(f.auth(shop))
      .send({
        name: 'Gift Card',
        price: 1,
        thumbnail: 'https://example.com/g.jpg',
        sku: `CAP-GC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        collectionIds: [shop.collectionId],
        isGiftCard: true,
        giftCardDenominations: [100],
      })
      .expect(201);
    await f.publish(shop);
    return { shop, a, b, giftId: body<{ id: number }>(gift).id };
  }

  async function orderCount(shopId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM \`order\` WHERE shopId = ?`,
      [shopId],
    );
    return Number(rows[0].c);
  }

  const messageOf = (res: { body: unknown }) =>
    JSON.stringify((res.body as { message?: unknown }).message);

  describe('DTO ceilings on every create and update route', () => {
    let w: Awaited<ReturnType<typeof world>>;
    beforeAll(async () => {
      w = await world('cap-dto');
    });

    const tooMany = (productId: number) => ({ productId, quantity: 1000 });
    const lines101 = (productId: number) =>
      Array.from({ length: 101 }, () => ({ productId, quantity: 1 }));

    it('storefront order: quantity 1000 and 101 lines are 400', async () => {
      const q = await f.storefrontOrderRaw(w.shop, [tooMany(w.a.id)]);
      expect(q.status).toBe(400);
      expect(messageOf(q)).toMatch(/quantity must not be greater than 999/);
      const l = await f.storefrontOrderRaw(w.shop, lines101(w.a.id));
      expect(l.status).toBe(400);
      expect(messageOf(l)).toMatch(/items must contain no more than 100/);
      expect(await orderCount(w.shop.shopId)).toBe(0);
    });

    it('delivery quote and public discount validate refuse the same shapes', async () => {
      const quote = (items: unknown[]) =>
        request(f.http())
          .post(`/public/${w.shop.slug}/delivery-quote`)
          .send({ outletId: w.shop.outletId, orderType: 'pickup', items });
      expect((await quote([tooMany(w.a.id)])).status).toBe(400);
      expect((await quote(lines101(w.a.id))).status).toBe(400);
      const validate = (items: unknown[]) =>
        request(f.http())
          .post(`/public/${w.shop.slug}/discounts/validate`)
          .send({ code: 'NOPE', cartSubtotal: 0, items });
      expect((await validate([tooMany(w.a.id)])).status).toBe(400);
      expect((await validate(lines101(w.a.id))).status).toBe(400);
    });

    it('admin order, order item edit, draft create and draft update are 400', async () => {
      const admin = await request(f.http())
        .post('/orders')
        .set(f.auth(w.shop))
        .send({
          customerName: 'Cap',
          customerPhone: '0501234567',
          customerAddress: 'Pickup',
          outletId: w.shop.outletId,
          orderType: 'pickup',
          items: [tooMany(w.a.id)],
        });
      expect(admin.status).toBe(400);
      expect(messageOf(admin)).toMatch(/quantity must not be greater than 999/);

      const ok = await f.adminOrder(w.shop, [
        { productId: w.a.id, quantity: 1 },
      ]);
      const edit = await f.editItems(w.shop, ok.id, [tooMany(w.a.id)]);
      expect(edit.status).toBe(400);
      expect((await f.editItems(w.shop, ok.id, lines101(w.a.id))).status).toBe(
        400,
      );

      const draftBase = {
        outletId: w.shop.outletId,
        customerName: 'Cap',
        customerPhone: '0501234567',
        customerAddress: 'Pickup',
        orderType: 'pickup',
      };
      const draft = await request(f.http())
        .post('/shop/draft-orders')
        .set(f.auth(w.shop))
        .send({ ...draftBase, items: [tooMany(w.a.id)] });
      expect(draft.status).toBe(400);
      const created = await request(f.http())
        .post('/shop/draft-orders')
        .set(f.auth(w.shop))
        .send({ ...draftBase, items: [{ productId: w.a.id, quantity: 1 }] })
        .expect(201);
      const upd = await request(f.http())
        .patch(`/shop/draft-orders/${body<{ id: number }>(created).id}`)
        .set(f.auth(w.shop))
        .send({ items: [tooMany(w.a.id)] });
      expect(upd.status).toBe(400);
    });
  });

  describe('cart-wide units cap (each line is individually legal)', () => {
    let w: Awaited<ReturnType<typeof world>>;
    beforeAll(async () => {
      w = await world('cap-units');
    });
    // 600 + 600 = 1200 > 1000 although neither line passes the DTO
    const big = (w: { a: { id: number }; b: { id: number } }) => [
      { productId: w.a.id, quantity: 600 },
      { productId: w.b.id, quantity: 600 },
    ];

    it('storefront order, quote and validate say the same thing and nothing is written', async () => {
      const before = await orderCount(w.shop.shopId);
      const so = await f.storefrontOrderRaw(w.shop, big(w));
      expect(so.status).toBe(400);
      expect(messageOf(so)).toMatch(/Maximum 1000 items per order/);
      const quote = await request(f.http())
        .post(`/public/${w.shop.slug}/delivery-quote`)
        .send({
          outletId: w.shop.outletId,
          orderType: 'pickup',
          items: big(w),
        });
      expect(quote.status).toBe(400);
      expect(messageOf(quote)).toMatch(/Maximum 1000 items per order/);
      const val = await request(f.http())
        .post(`/public/${w.shop.slug}/discounts/validate`)
        .send({ code: 'NOPE', cartSubtotal: 0, items: big(w) });
      expect(val.status).toBe(400);
      expect(await orderCount(w.shop.shopId)).toBe(before);
      // the stock reservation never happened either
      expect(await f.productStock(w.shop.outletId, w.a.id)).toBe(1000);
    });

    it('admin order and an item edit are held to the same cap', async () => {
      const ao = await request(f.http())
        .post('/orders')
        .set(f.auth(w.shop))
        .send({
          customerName: 'Cap',
          customerPhone: '0501234567',
          customerAddress: 'Pickup',
          outletId: w.shop.outletId,
          orderType: 'pickup',
          items: big(w),
        });
      expect(ao.status).toBe(400);
      expect(messageOf(ao)).toMatch(/Maximum 1000 items per order/);
      const ok = await f.adminOrder(w.shop, [
        { productId: w.a.id, quantity: 1 },
      ]);
      const edit = await f.editItems(w.shop, ok.id, big(w));
      expect(edit.status).toBe(400);
      expect(messageOf(edit)).toMatch(/Maximum 1000 items per order/);
    });

    it('a draft is refused at create, so completing one can never exceed the cap', async () => {
      const res = await request(f.http())
        .post('/shop/draft-orders')
        .set(f.auth(w.shop))
        .send({
          outletId: w.shop.outletId,
          customerName: 'Cap',
          customerPhone: '0501234567',
          customerAddress: 'Pickup',
          orderType: 'pickup',
          items: big(w),
        });
      expect(res.status).toBe(400);
      expect(messageOf(res)).toMatch(/Maximum 1000 items per order/);
    });

    it('a basket just under the cap still checks out', async () => {
      const items = [
        { productId: w.a.id, quantity: 600 },
        { productId: w.b.id, quantity: 400 },
      ];
      const res = await f.storefrontOrder(w.shop, items);
      expect(res.status).toBe(201);
    });
  });

  describe('gift-card cap (one INSERT per unit inside the order transaction)', () => {
    let w: Awaited<ReturnType<typeof world>>;
    beforeAll(async () => {
      w = await world('cap-gc');
    });
    const gc = (giftId: number, quantity: number) => ({
      productId: giftId,
      quantity,
      giftCardAmount: 100,
    });

    it('21 units are refused before anything is written', async () => {
      const res = await f.storefrontOrderRaw(w.shop, [gc(w.giftId, 21)], {
        customerEmail: 'gc-cap@example.com',
      });
      expect(res.status).toBe(400);
      expect(messageOf(res)).toMatch(/Maximum 20 gift cards per order/);
      expect(await orderCount(w.shop.shopId)).toBe(0);
    });

    it('the cap is per order, not per line: 11 + 10 on two lines is refused', async () => {
      const res = await f.storefrontOrderRaw(w.shop, [
        gc(w.giftId, 11),
        gc(w.giftId, 10),
      ]);
      expect(res.status).toBe(400);
      expect(messageOf(res)).toMatch(/Maximum 20 gift cards per order/);
    });

    it('exactly 20 units is accepted and issues 20 cards', async () => {
      const res = await f.storefrontOrderRaw(w.shop, [gc(w.giftId, 20)], {
        customerEmail: 'gc-cap@example.com',
      });
      expect(res.status).toBe(201);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM giftcard WHERE shopId = ?`,
        [w.shop.shopId],
      );
      expect(Number(rows[0].c)).toBe(20);
    });
  });
});
