import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// W5 (audit 7.6 / D-6). OrdersService.updateItems: ingredient delta arithmetic
// and the negative-stock warning branch. Every test also asserts ledger
// conservation (sum of stockmovement deltas == outletingredientstock).
describe('updateItems: stock delta arithmetic and warnings (e2e)', () => {
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

  async function recipeShop(
    prefix: string,
    roseStock = 1000,
    ribbonStock = 1000,
  ) {
    const shop = await f.setupShop(prefix);
    const rose = await f.createIngredient(shop, 'Rose');
    const ribbon = await f.createIngredient(shop, 'Ribbon');
    await f.stockIngredient(shop, rose.id, roseStock);
    await f.stockIngredient(shop, ribbon.id, ribbonStock);
    const bouquet = await f.createProduct(shop, {
      ingredients: [
        { ingredientId: rose.id, quantityPerUnit: 6 },
        { ingredientId: ribbon.id, quantityPerUnit: 2 },
      ],
    });
    return { shop, rose, ribbon, bouquet };
  }

  async function confirmed(shop: Shop, items: Record<string, unknown>[]) {
    const order = await f.adminOrder(shop, items);
    await f.setStatus(shop, order.id, 'confirmed');
    return order.id;
  }

  async function conserved(shop: Shop, ids: number[], start: number[]) {
    for (let i = 0; i < ids.length; i++) {
      expect(await f.ledgerSum(shop.outletId, ids[i])).toBe(
        await f.stockOf(shop.outletId, ids[i]),
      );
      expect(await f.stockOf(shop.outletId, ids[i])).toBeLessThanOrEqual(
        start[i],
      );
    }
  }

  it('fans the delta out to every recipe ingredient, per ingredient quantityPerUnit', async () => {
    const { shop, rose, ribbon, bouquet } = await recipeShop('ui-fan');
    const orderId = await confirmed(shop, [
      { productId: bouquet.id, quantity: 2 },
    ]);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(1000 - 12);
    expect(await f.stockOf(shop.outletId, ribbon.id)).toBe(1000 - 4);

    const res = await f.editItems(shop, orderId, [
      { productId: bouquet.id, quantity: 7 },
    ]);
    expect(res.status).toBe(200);
    expect(
      body<{ ingredientStockWarnings: string[] }>(res).ingredientStockWarnings,
    ).toEqual([]);
    // +5 bouquets: 30 roses, 10 ribbon more, on top of what confirm took.
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(1000 - 42);
    expect(await f.stockOf(shop.outletId, ribbon.id)).toBe(1000 - 14);
    await conserved(shop, [rose.id, ribbon.id], [1000, 1000]);
    expect(await f.ledgerSum(shop.outletId, rose.id)).toBe(1000 - 42);
  });

  it('handles an add, a remove and a quantity change in ONE edit, each by its own delta', async () => {
    const shop = await f.setupShop('ui-mixed');
    const a = await f.stockedProduct(shop, 50);
    const b = await f.stockedProduct(shop, 50);
    const c = await f.stockedProduct(shop, 50);
    const orderId = await confirmed(shop, [
      { productId: a.id, quantity: 4 },
      { productId: b.id, quantity: 3 },
    ]);
    // a: 4 -> 1 (give back 3), b: removed (give back 3), c: added (take 5)
    await f
      .editItems(shop, orderId, [
        { productId: a.id, quantity: 1 },
        { productId: c.id, quantity: 5 },
      ])
      .expect(200);
    expect(await f.productStock(shop.outletId, a.id)).toBe(50 - 1);
    expect(await f.productStock(shop.outletId, b.id)).toBe(50);
    expect(await f.productStock(shop.outletId, c.id)).toBe(50 - 5);
    for (const p of [a, b, c]) {
      const ing = (await f.shadowIngredientId(p.id))!;
      expect(await f.ledgerSum(shop.outletId, ing)).toBe(
        await f.stockOf(shop.outletId, ing),
      );
    }
  });

  it('an unchanged quantity writes no movement at all', async () => {
    const { shop, rose, bouquet } = await recipeShop('ui-noop');
    const orderId = await confirmed(shop, [
      { productId: bouquet.id, quantity: 2 },
    ]);
    const before = (await f.movements(shop.outletId, rose.id)).length;
    await f
      .editItems(shop, orderId, [{ productId: bouquet.id, quantity: 2 }])
      .expect(200);
    expect((await f.movements(shop.outletId, rose.id)).length).toBe(before);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(1000 - 12);
  });

  describe('negative-stock warning branch', () => {
    it('an increase past what the recipe ingredient has still saves, goes negative, and names the ingredient', async () => {
      const { shop, rose, ribbon, bouquet } = await recipeShop(
        'ui-warn',
        10,
        1000,
      );
      const orderId = await confirmed(shop, [
        { productId: bouquet.id, quantity: 1 },
      ]);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(4); // 10 - 6

      const res = await f.editItems(shop, orderId, [
        { productId: bouquet.id, quantity: 3 },
      ]);
      expect(res.status).toBe(200);
      const out = body<{ ingredientStockWarnings: string[]; id: number }>(res);
      // Only the ingredient that actually went negative is named, by name.
      expect(out.ingredientStockWarnings).toEqual([rose.name]);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(10 - 18);
      expect(await f.stockOf(shop.outletId, ribbon.id)).toBe(1000 - 6);
      // The edit really persisted.
      const items = await f.orderItems(orderId);
      expect(items.map((i) => i.quantity as number)).toEqual([3]);
      await conserved(shop, [rose.id, ribbon.id], [10, 1000]);
      expect(await f.ledgerSum(shop.outletId, rose.id)).toBe(-8);
    });

    it('the warning list is scoped to the edited products recipes: an unrelated negative ingredient is not listed', async () => {
      const { shop, rose, bouquet } = await recipeShop(
        'ui-warn-scope',
        1000,
        1000,
      );
      const other = await f.createIngredient(shop, 'Unrelated');
      // Force a negative unrelated ingredient directly (the adjust endpoint refuses to go below 0).
      await db.execute(
        `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity) VALUES (?, ?, -9)
         ON DUPLICATE KEY UPDATE stockQuantity = -9`,
        [shop.outletId, other.id],
      );
      const orderId = await confirmed(shop, [
        { productId: bouquet.id, quantity: 1 },
      ]);
      const res = await f.editItems(shop, orderId, [
        { productId: bouquet.id, quantity: 2 },
      ]);
      expect(
        body<{ ingredientStockWarnings: string[] }>(res)
          .ingredientStockWarnings,
      ).toEqual([]);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(1000 - 12);
    });

    it('a DECREASE never warns and returns exactly its delta, even back out of negative stock', async () => {
      const { shop, rose, bouquet } = await recipeShop('ui-warn-dec', 10, 1000);
      const orderId = await confirmed(shop, [
        { productId: bouquet.id, quantity: 3 },
      ]);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(10 - 18); // already negative
      const res = await f.editItems(shop, orderId, [
        { productId: bouquet.id, quantity: 1 },
      ]);
      expect(res.status).toBe(200);
      expect(
        body<{ ingredientStockWarnings: string[] }>(res)
          .ingredientStockWarnings,
      ).toEqual([]);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(10 - 6);
      expect(await f.ledgerSum(shop.outletId, rose.id)).toBe(4);
    });
  });

  describe('plain (shadow-ingredient) products keep the hard floor', () => {
    it('an increase past available stock is rejected 409 and the edit is rolled back whole', async () => {
      const shop = await f.setupShop('ui-floor');
      const p = await f.stockedProduct(shop, 5);
      const orderId = await confirmed(shop, [{ productId: p.id, quantity: 4 }]); // 1 left
      const res = await f.editItems(shop, orderId, [
        { productId: p.id, quantity: 7 },
      ]); // needs +3
      expect(res.status).toBe(409);
      expect(await f.productStock(shop.outletId, p.id)).toBe(1);
      expect(
        (await f.orderItems(orderId)).map((i) => i.quantity as number),
      ).toEqual([4]);
    });

    it('CHARACTERIZATION: continueSellingOutOfStock does NOT bypass the floor on an edit (it does at checkout)', async () => {
      // orders.service.ts says "order-item-edit never had that escape valve".
      const shop = await f.setupShop('ui-floor-cso');
      const p = await f.stockedProduct(shop, 5, {
        continueSellingOutOfStock: true,
      });
      const orderId = await confirmed(shop, [{ productId: p.id, quantity: 4 }]);
      const res = await f.editItems(shop, orderId, [
        { productId: p.id, quantity: 7 },
      ]);
      expect(res.status).toBe(409);
    });
  });

  describe('which orders an edit touches stock for', () => {
    it('a pending ADMIN order has reserved nothing: an edit changes no stock, the later confirm takes the edited quantity', async () => {
      const shop = await f.setupShop('ui-pending-admin');
      const p = await f.stockedProduct(shop, 20);
      const order = await f.adminOrder(shop, [
        { productId: p.id, quantity: 2 },
      ]);
      await f
        .editItems(shop, order.id, [{ productId: p.id, quantity: 5 }])
        .expect(200);
      expect(await f.productStock(shop.outletId, p.id)).toBe(20);
      await f.setStatus(shop, order.id, 'confirmed');
      expect(await f.productStock(shop.outletId, p.id)).toBe(15);
    });

    // FINDING F1. A storefront order reserves stock at CREATION
    // (PublicService.createOrder -> consumeForOrderItems). updateItems only
    // adjusts when status === 'confirmed', and its comment asserts a pending
    // immediate-channel order "has never run consumeForOrderItems yet", which
    // is false. So editing a pending storefront order leaves the reservation at
    // the OLD quantity, and the later cancel restocks the NEW one.
    test.failing(
      'FINDING F1: editing a pending storefront order moves its reserved stock by the delta',
      async () => {
        const shop = await f.setupShop('ui-pending-sf');
        const p = await f.stockedProduct(shop, 10);
        await f.publish(shop);
        const res = await f.storefrontOrder(shop, [
          { productId: p.id, quantity: 2 },
        ]);
        const orderId = body<{ order: { id: number } }>(res).order.id;
        expect(await f.productStock(shop.outletId, p.id)).toBe(8);

        await f
          .editItems(shop, orderId, [{ productId: p.id, quantity: 5 }])
          .expect(200);
        // Correct: 5 now reserved -> 5 on the shelf. Actual: still 8.
        expect(await f.productStock(shop.outletId, p.id)).toBe(5);
      },
    );

    test.failing(
      'FINDING F1 (consequence): edit then cancel a pending storefront order ends at the starting stock',
      async () => {
        const shop = await f.setupShop('ui-pending-sf2');
        const p = await f.stockedProduct(shop, 10);
        await f.publish(shop);
        const res = await f.storefrontOrder(shop, [
          { productId: p.id, quantity: 2 },
        ]);
        const orderId = body<{ order: { id: number } }>(res).order.id;
        await f
          .editItems(shop, orderId, [{ productId: p.id, quantity: 5 }])
          .expect(200);
        await f.cancelOrder(shop, orderId).expect(201);
        // Correct: 10. Actual: 8 + 5 = 13, three units of phantom stock.
        expect(await f.productStock(shop.outletId, p.id)).toBe(10);
      },
    );
  });

  describe('toggle flipped between confirm and edit', () => {
    // FINDING F2. consumeForOrderItems re-checks shop.autoDeductIngredientStock
    // for direction -1 even when the caller is extending a consumption that
    // ALREADY happened (updateItems increase), while direction +1 (decrease,
    // cancel) deliberately ignores it. With the toggle off after confirm, an
    // increase consumes nothing but the later cancel returns the full new
    // quantity.
    test.failing(
      'FINDING F2: increase-edit then cancel with the toggle flipped off in between does not create phantom stock',
      async () => {
        const { shop, rose, bouquet } = await recipeShop('ui-toggle');
        const orderId = await confirmed(shop, [
          { productId: bouquet.id, quantity: 1 },
        ]);
        await f.setShop(shop, { autoDeductIngredientStock: false });
        await f
          .editItems(shop, orderId, [{ productId: bouquet.id, quantity: 3 }])
          .expect(200);
        await f.cancelOrder(shop, orderId).expect(201);
        // Correct: 1000. Actual: 1000 - 6 (confirm) + 18 (cancel, qty 3) = 1012.
        expect(await f.stockOf(shop.outletId, rose.id)).toBe(1000);
      },
    );
  });
});
