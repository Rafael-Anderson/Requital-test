import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// W5 (audit 7.6 / D-6): concurrency + ledger conservation.
//
// THE REAL STOCK POLICY (verified in code, the audit's "always allow" is only
// half right). It depends on the path, not one global rule:
//   storefront checkout / draft-order complete: reserved AT CREATION with a CAS
//     guard (`stockQuantity >= qty` in the UPDATE's WHERE). A tracked product
//     with continueSellingOutOfStock = false CANNOT oversell: the loser gets 409
//     and its order is rolled back. continueSellingOutOfStock = true or an
//     untracked product skips the guard (may go negative).
//   admin order confirm (pending -> confirmed): ALWAYS ALLOWS negative
//     (throwOnInsufficientStock: false). This is where "always allow" is true.
//   updateItems increase on a confirmed order: plain products 409, BoM warns.
//
// Conservation: for any (outlet, ingredient) whose row only ever moved through
// logged movements, sum(stockmovement.delta) == outletingredientstock.stockQuantity.
describe('Stock concurrency and ledger conservation (e2e)', () => {
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

  async function expectConserved(shop: Shop, ingredientId: number) {
    expect(await f.ledgerSum(shop.outletId, ingredientId)).toBe(
      await f.stockOf(shop.outletId, ingredientId),
    );
  }

  async function orderCountFor(shop: Shop, productId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT o.id) AS c FROM \`order\` o JOIN orderitem oi ON oi.orderId = o.id
        WHERE o.shopId = ? AND oi.productId = ?`,
      [shop.shopId, productId],
    );
    return Number(rows[0].c);
  }

  describe('storefront reservation (guarded)', () => {
    it('two orders racing for the last unit: exactly one wins, the loser leaves no order and no movement, ledger conserved', async () => {
      const shop = await f.setupShop('cc-last');
      const p = await f.stockedProduct(shop, 1);
      await f.publish(shop);
      const ing = (await f.shadowIngredientId(p.id))!;

      const [a, b] = await Promise.all([
        f.storefrontOrderRaw(shop, [{ productId: p.id, quantity: 1 }]),
        f.storefrontOrderRaw(shop, [{ productId: p.id, quantity: 1 }]),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await f.productStock(shop.outletId, p.id)).toBe(0);
      expect(await orderCountFor(shop, p.id)).toBe(1);
      expect(
        (await f.movements(shop.outletId, ing, 'CONSUMED')).map(
          (m) => m.delta as number,
        ),
      ).toEqual([-1]);
      await expectConserved(shop, ing);
    });

    it('8 racers for 3 units: exactly 3 win, stock lands on 0, every lost update would show as a mismatch', async () => {
      const shop = await f.setupShop('cc-many');
      const p = await f.stockedProduct(shop, 3);
      await f.publish(shop);
      const ing = (await f.shadowIngredientId(p.id))!;

      const res = await Promise.all(
        Array.from({ length: 8 }, () =>
          f.storefrontOrderRaw(shop, [{ productId: p.id, quantity: 1 }]),
        ),
      );
      const won = res.filter((r) => r.status === 201).length;
      expect(won).toBe(3);
      expect(res.filter((r) => r.status === 409)).toHaveLength(5);
      expect(await f.productStock(shop.outletId, p.id)).toBe(0);
      expect(await orderCountFor(shop, p.id)).toBe(3);
      expect(await f.ledgerSum(shop.outletId, ing)).toBe(0);
      expect((await f.movements(shop.outletId, ing, 'CONSUMED')).length).toBe(
        3,
      );
    });

    it('a mixed-size race never over-allocates: stock 5, orders of 3 and 3 and 2 -> reserved total never exceeds 5', async () => {
      const shop = await f.setupShop('cc-mixed');
      const p = await f.stockedProduct(shop, 5);
      await f.publish(shop);
      const ing = (await f.shadowIngredientId(p.id))!;
      const sizes = [3, 3, 2];
      const res = await Promise.all(
        sizes.map((q) =>
          f.storefrontOrderRaw(shop, [{ productId: p.id, quantity: q }]),
        ),
      );
      const reserved = res.reduce(
        (sum, r, i) => sum + (r.status === 201 ? sizes[i] : 0),
        0,
      );
      expect(reserved).toBeLessThanOrEqual(5);
      expect(reserved).toBeGreaterThanOrEqual(3); // some combination always fits
      expect(await f.productStock(shop.outletId, p.id)).toBe(5 - reserved);
      await expectConserved(shop, ing);
    });

    it('continueSellingOutOfStock: both racers for the last unit succeed, stock goes to -1, both movements are recorded', async () => {
      const shop = await f.setupShop('cc-cso');
      const p = await f.stockedProduct(shop, 1, {
        continueSellingOutOfStock: true,
      });
      await f.publish(shop);
      const ing = (await f.shadowIngredientId(p.id))!;
      const [a, b] = await Promise.all([
        f.storefrontOrderRaw(shop, [{ productId: p.id, quantity: 1 }]),
        f.storefrontOrderRaw(shop, [{ productId: p.id, quantity: 1 }]),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(await f.productStock(shop.outletId, p.id)).toBe(-1);
      expect(
        (await f.movements(shop.outletId, ing, 'CONSUMED')).map(
          (m) => m.delta as number,
        ),
      ).toEqual([-1, -1]);
      await expectConserved(shop, ing);
    });

    it('an untracked product is never guarded and never writes a movement, however many race', async () => {
      const shop = await f.setupShop('cc-untracked');
      const p = await f.createProduct(shop, { trackInventory: false });
      await f.publish(shop);
      const res = await Promise.all(
        Array.from({ length: 4 }, () =>
          f.storefrontOrderRaw(shop, [{ productId: p.id, quantity: 2 }]),
        ),
      );
      expect(res.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      const ing = (await f.shadowIngredientId(p.id))!;
      expect(await f.movements(shop.outletId, ing)).toEqual([]);
    });

    it('a BoM recipe only 3 of 5 racers can cover: exactly 3 win, no ingredient goes negative, every ingredient is conserved', async () => {
      const shop = await f.setupShop('cc-bom');
      const rose = await f.createIngredient(shop, 'Rose');
      const ribbon = await f.createIngredient(shop, 'Ribbon');
      await f.stockIngredient(shop, rose.id, 20); // 20 / 6 = 3 bouquets
      await f.stockIngredient(shop, ribbon.id, 100);
      const p = await f.createProduct(shop, {
        ingredients: [
          { ingredientId: rose.id, quantityPerUnit: 6 },
          { ingredientId: ribbon.id, quantityPerUnit: 2 },
        ],
      });
      await f.publish(shop);
      const res = await Promise.all(
        Array.from({ length: 5 }, () =>
          f.storefrontOrderRaw(shop, [{ productId: p.id, quantity: 1 }]),
        ),
      );
      expect(res.filter((r) => r.status === 201)).toHaveLength(3);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(2);
      // A loser's partial decrement of ribbon (processed before rose failed) must have rolled back.
      expect(await f.stockOf(shop.outletId, ribbon.id)).toBe(100 - 6);
      await expectConserved(shop, rose.id);
      await expectConserved(shop, ribbon.id);
    });
  });

  describe('admin confirm (unguarded: always allows)', () => {
    it('two pending orders for the last unit both confirm; stock goes to -1 and the ledger agrees', async () => {
      const shop = await f.setupShop('cc-confirm');
      const p = await f.stockedProduct(shop, 1);
      const ing = (await f.shadowIngredientId(p.id))!;
      const o1 = await f.adminOrder(shop, [{ productId: p.id, quantity: 1 }]);
      const o2 = await f.adminOrder(shop, [{ productId: p.id, quantity: 1 }]);
      // Nothing is held while pending, so both create fine and stock is untouched.
      expect(await f.productStock(shop.outletId, p.id)).toBe(1);

      const [a, b] = await Promise.all(
        [o1, o2].map((o) =>
          request(f.http())
            .patch(`/orders/${o.id}/status`)
            .set(f.auth(shop))
            .send({ status: 'confirmed' }),
        ),
      );
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(await f.productStock(shop.outletId, p.id)).toBe(-1);
      expect(
        (await f.movements(shop.outletId, ing, 'CONSUMED')).map(
          (m) => m.delta as number,
        ),
      ).toEqual([-1, -1]);
      await expectConserved(shop, ing);
    });

    // Forces a deterministic interleaving of two requests on ONE order: a side
    // connection holds the order row's lock, `first` is started and parks on its
    // CAS UPDATE, then `second` does the same behind it, then the lock is released.
    // Each request has already done its plain read of the order (status 'pending',
    // ingredientsConsumedAt NULL) before it parks, which is exactly the stale read
    // a real race produces. Lock grant order is FIFO per row, so first commits first.
    async function raceOnOrder(
      shop: Shop,
      orderId: number,
      first: () => PromiseLike<request.Response>,
      second: () => PromiseLike<request.Response>,
    ) {
      let firstP!: Promise<request.Response>;
      let secondP!: Promise<request.Response>;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      await db.transaction(async (conn) => {
        await conn.query('SELECT id FROM `order` WHERE id = ? FOR UPDATE', [
          orderId,
        ]);
        firstP = Promise.resolve(first());
        await sleep(500);
        secondP = Promise.resolve(second());
        await sleep(500);
      });
      return { first: await firstP, second: await secondP };
    }

    async function confirmThenStaleCancel() {
      const shop = await f.setupShop(
        `cc-stale-${Math.floor(Math.random() * 1e6)}`,
      );
      const p = await f.stockedProduct(shop, 10);
      const ing = (await f.shadowIngredientId(p.id))!;
      const order = await f.adminOrder(shop, [
        { productId: p.id, quantity: 3 },
      ]);
      const r = await raceOnOrder(
        shop,
        order.id,
        () =>
          request(f.http())
            .patch(`/orders/${order.id}/status`)
            .set(f.auth(shop))
            .send({ status: 'confirmed' }),
        () => f.cancelOrder(shop, order.id),
      );
      return { shop, p, ing, order, ...r };
    }

    it('cancel parked behind a confirm: both requests succeed in sequence (the interleaving this section relies on is real)', async () => {
      const { shop, order, first, second } = await confirmThenStaleCancel();
      expect(first.status).toBe(200); // confirm won the CAS and decremented
      expect(second.status).toBe(201); // cancel then matched the 'confirmed' CAS branch
      const row = await f.orderRow(order.id);
      expect(row.status).toBe('cancelled');
      expect(row.ingredientsConsumedAt).not.toBeNull(); // confirm DID consume
      void shop;
    });

    // FINDING F5. OrdersService.cancel reads order.ingredientsConsumedAt BEFORE its
    // transaction and trusts it ("confirm and cancel are both CAS-guarded, so at
    // most one can win"). But a confirm (pending->confirmed) followed by a cancel
    // (confirmed->cancelled, its second CAS branch) both succeed in sequence, and
    // the cancel acted on a pre-confirm read where the column was still NULL. So
    // it skips the restock and the confirm's decrement is leaked for good.
    test.failing(
      'FINDING F5: a cancel that raced a confirm still returns the stock the confirm took',
      async () => {
        const { shop, p, ing } = await confirmThenStaleCancel();
        expect(await f.productStock(shop.outletId, p.id)).toBe(10); // actual: 7
        await expectConserved(shop, ing);
      },
    );

    it('cancel parked FIRST: it wins, the confirm is rejected, and nothing was ever taken or returned', async () => {
      const shop = await f.setupShop('cc-cancel-first');
      const p = await f.stockedProduct(shop, 10);
      const ing = (await f.shadowIngredientId(p.id))!;
      const order = await f.adminOrder(shop, [
        { productId: p.id, quantity: 3 },
      ]);
      const r = await raceOnOrder(
        shop,
        order.id,
        () => f.cancelOrder(shop, order.id),
        () =>
          request(f.http())
            .patch(`/orders/${order.id}/status`)
            .set(f.auth(shop))
            .send({ status: 'confirmed' }),
      );
      expect(r.first.status).toBe(201);
      expect([400, 409]).toContain(r.second.status);
      expect(await f.productStock(shop.outletId, p.id)).toBe(10);
      expect((await f.orderRow(order.id)).status).toBe('cancelled');
      await expectConserved(shop, ing);
    });
  });

  describe('manual adjustments against concurrent orders (no lost update)', () => {
    it('reason-coded adjust racing storefront orders: final = start - orders + adjust, ledger conserved', async () => {
      const shop = await f.setupShop('cc-adjust');
      const p = await f.stockedProduct(shop, 10);
      await f.publish(shop);
      const ing = (await f.shadowIngredientId(p.id))!;
      const [adj, ...orders] = await Promise.all([
        request(f.http())
          .post('/products/stock/adjust')
          .set(f.auth(shop))
          .send({
            productId: p.id,
            outletId: shop.outletId,
            delta: 5,
            reason: 'received',
          }),
        ...Array.from({ length: 4 }, () =>
          f.storefrontOrderRaw(shop, [{ productId: p.id, quantity: 2 }]),
        ),
      ]);
      expect(adj.status).toBe(201);
      const won = orders.filter((r) => r.status === 201).length;
      expect(won).toBe(4); // 10 + 5 covers 4 x 2 whatever the interleaving
      expect(await f.productStock(shop.outletId, p.id)).toBe(10 + 5 - 8);
      await expectConserved(shop, ing);
    });

    it('reason-coded negative adjust is CAS-guarded: 6 racers each removing 1 from stock 3 -> exactly 3 succeed, never below zero', async () => {
      const shop = await f.setupShop('cc-adj-neg');
      const p = await f.stockedProduct(shop, 3);
      const ing = (await f.shadowIngredientId(p.id))!;
      const res = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(f.http())
            .post('/products/stock/adjust')
            .set(f.auth(shop))
            .send({
              productId: p.id,
              outletId: shop.outletId,
              delta: -1,
              reason: 'damaged',
            }),
        ),
      );
      expect(res.filter((r) => r.status === 201)).toHaveLength(3);
      expect(await f.productStock(shop.outletId, p.id)).toBe(0);
      await expectConserved(shop, ing);
    });

    // FINDING F4 (fixed). PATCH /products/stock/bulk-adjust used to do its floor
    // check as a plain SELECT before the transaction and add delta with no WHERE
    // guard, and wrote NO stockmovement row. It now has the CAS floor and the
    // ledger row like the reason-coded POST /products/stock/adjust above.
    // Deterministic form of the race: a side connection holds the stock row's lock
    // so every request passes its pre-transaction floor check against the SAME
    // unchanged stock (1), then all of them apply their decrement once it is released.
    async function bulkDecrementsBehindLock(prefix: string) {
      const shop = await f.setupShop(prefix);
      const p = await f.stockedProduct(shop, 1);
      const ing = (await f.shadowIngredientId(p.id))!;
      let pending: Promise<request.Response>[] = [];
      await db.transaction(async (conn) => {
        await conn.query(
          'SELECT stockQuantity FROM outletingredientstock WHERE outletId = ? AND ingredientId = ? FOR UPDATE',
          [shop.outletId, ing],
        );
        pending = Array.from({ length: 4 }, () =>
          Promise.resolve(
            request(f.http())
              .patch('/products/stock/bulk-adjust')
              .set(f.auth(shop))
              .send({
                outletId: shop.outletId,
                adjustments: [{ productId: p.id, delta: -1 }],
              }),
          ),
        );
        await new Promise((r) => setTimeout(r, 800));
      });
      return { shop, p, res: await Promise.all(pending) };
    }

    it(
      'FINDING F4a: bulk-adjust never takes stock below zero under concurrent decrements',
      async () => {
        const { shop, p, res } = await bulkDecrementsBehindLock('cc-bulk-neg');
        expect(res.filter((r) => r.status === 200).length).toBeLessThanOrEqual(
          1,
        );
        expect(
          await f.productStock(shop.outletId, p.id),
        ).toBeGreaterThanOrEqual(0);
      },
    );

    it(
      'FINDING F4b: bulk-adjust writes a stockmovement row, so the ledger stays conserved',
      async () => {
        const shop = await f.setupShop('cc-bulk-ledger');
        const p = await f.stockedProduct(shop, 5);
        const ing = (await f.shadowIngredientId(p.id))!;
        await request(f.http())
          .patch('/products/stock/bulk-adjust')
          .set(f.auth(shop))
          .send({
            outletId: shop.outletId,
            adjustments: [{ productId: p.id, delta: 4 }],
          })
          .expect(200);
        expect(await f.productStock(shop.outletId, p.id)).toBe(9);
        await expectConserved(shop, ing);
      },
    );
  });
});
