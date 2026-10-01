import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DatabaseService } from '../src/database/database.service';
import { ProductsService } from '../src/products/products.service';
import { bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// W5 (audit 7.6 / D-6). ProductsService.consumeForOrderItems, the BoM fan-out,
// called directly inside a real transaction (it is the public primitive every
// order lifecycle path routes through).
describe('consumeForOrderItems: the BoM fan-out (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let products: ProductsService;

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
    products = app.get(ProductsService);
  });
  afterAll(async () => {
    await app.close();
  });

  type Shop = Awaited<ReturnType<typeof f.setupShop>>;
  type Item = {
    productId: number;
    variantId: number | null;
    quantity: number;
    allowNegative?: boolean;
  };
  const OPTS = {
    throwOnInsufficientStock: false,
    actorUserId: null as number | null,
  };

  function consume(
    shop: Shop,
    items: Item[],
    direction: 1 | -1,
    options: Partial<
      Parameters<ProductsService['consumeForOrderItems']>[5]
    > = {},
  ) {
    return db.transaction((conn) =>
      products.consumeForOrderItems(
        conn,
        shop.shopId,
        shop.outletId,
        items,
        direction,
        {
          ...OPTS,
          ...options,
        },
      ),
    );
  }

  async function bom(prefix: string, roseStock = 100, ribbonStock = 50) {
    const shop = await f.setupShop(prefix);
    const rose = await f.createIngredient(shop, 'Rose');
    const ribbon = await f.createIngredient(shop, 'Ribbon');
    await f.stockIngredient(shop, rose.id, roseStock);
    await f.stockIngredient(shop, ribbon.id, ribbonStock);
    const product = await f.createProduct(shop, {
      ingredients: [
        { ingredientId: rose.id, quantityPerUnit: 6 },
        { ingredientId: ribbon.id, quantityPerUnit: 2 },
      ],
    });
    return { shop, rose, ribbon, product };
  }

  it('fans one order line out to every recipe ingredient: delta = direction x quantityPerUnit x quantity, one CONSUMED row each', async () => {
    const { shop, rose, ribbon, product } = await bom('co-fan');
    const consumed = await consume(
      shop,
      [{ productId: product.id, variantId: null, quantity: 3 }],
      -1,
      { actorUserId: null },
    );
    expect(consumed).toBe(true);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100 - 18);
    expect(await f.stockOf(shop.outletId, ribbon.id)).toBe(50 - 6);

    const roseMoves = await f.movements(shop.outletId, rose.id, 'CONSUMED');
    expect(roseMoves.map((m) => m.delta as number)).toEqual([-18]);
    // A REAL ingredient keeps the ingredient-only attribution shape.
    expect(roseMoves[0].productId).toBeNull();
    expect(roseMoves[0].variantId).toBeNull();
    expect(
      (await f.movements(shop.outletId, ribbon.id, 'CONSUMED')).map(
        (m) => m.delta as number,
      ),
    ).toEqual([-6]);
    expect(await f.ledgerSum(shop.outletId, rose.id)).toBe(
      await f.stockOf(shop.outletId, rose.id),
    );
  });

  it('direction +1 returns exactly what -1 took, and is the exact inverse in the ledger', async () => {
    const { shop, rose, ribbon, product } = await bom('co-inverse');
    const item: Item = { productId: product.id, variantId: null, quantity: 4 };
    await consume(shop, [item], -1);
    await consume(shop, [item], 1);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
    expect(await f.stockOf(shop.outletId, ribbon.id)).toBe(50);
    expect(
      (await f.movements(shop.outletId, rose.id, 'CONSUMED')).map(
        (m) => m.delta as number,
      ),
    ).toEqual([-24, 24]);
  });

  it('a plain product consumes only its own shadow ingredient, attributed to the product (so Movement History filters keep working)', async () => {
    const shop = await f.setupShop('co-shadow');
    const p = await f.stockedProduct(shop, 10);
    const ing = (await f.shadowIngredientId(p.id))!;
    await consume(
      shop,
      [{ productId: p.id, variantId: null, quantity: 4 }],
      -1,
    );
    expect(await f.stockOf(shop.outletId, ing)).toBe(6);
    const [m] = await f.movements(shop.outletId, ing, 'CONSUMED');
    expect(m.productId).toBe(p.id);
    expect(m.delta).toBe(-4);
  });

  it('a variant override replaces the product recipe wholesale (no merge); a variant without one inherits it', async () => {
    const shop = await f.setupShop('co-variant');
    const rose = await f.createIngredient(shop, 'Rose');
    const ribbon = await f.createIngredient(shop, 'Ribbon');
    await f.stockIngredient(shop, rose.id, 200);
    await f.stockIngredient(shop, ribbon.id, 200);
    const p = await f.createProduct(shop, {
      ingredients: [
        { ingredientId: rose.id, quantityPerUnit: 6 },
        { ingredientId: ribbon.id, quantityPerUnit: 2 },
      ],
    });
    const [small, large] = await f.addVariants(shop, p.id, ['Small', 'Large']);
    // Large's override mentions ONLY rose (10). Ribbon must NOT be consumed for Large.
    await request(f.http())
      .patch(`/products/${p.id}/variants/${large.id}`)
      .set(f.auth(shop))
      .send({ ingredients: [{ ingredientId: rose.id, quantityPerUnit: 10 }] })
      .expect(200);

    await consume(
      shop,
      [{ productId: p.id, variantId: large.id, quantity: 1 }],
      -1,
    );
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(190);
    expect(await f.stockOf(shop.outletId, ribbon.id)).toBe(200);

    await consume(
      shop,
      [{ productId: p.id, variantId: small.id, quantity: 1 }],
      -1,
    );
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(184);
    expect(await f.stockOf(shop.outletId, ribbon.id)).toBe(198);
  });

  it('two lines needing the same ingredient each write their own movement and the stock moves by the sum', async () => {
    const shop = await f.setupShop('co-shared');
    const rose = await f.createIngredient(shop, 'Rose');
    await f.stockIngredient(shop, rose.id, 100);
    const a = await f.createProduct(shop, {
      ingredients: [{ ingredientId: rose.id, quantityPerUnit: 3 }],
    });
    const b = await f.createProduct(shop, {
      ingredients: [{ ingredientId: rose.id, quantityPerUnit: 5 }],
    });
    await consume(
      shop,
      [
        { productId: a.id, variantId: null, quantity: 2 },
        { productId: b.id, variantId: null, quantity: 4 },
      ],
      -1,
    );
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100 - 6 - 20);
    expect(
      (await f.movements(shop.outletId, rose.id, 'CONSUMED')).map(
        (m) => m.delta as number,
      ),
    ).toEqual([-6, -20]);
    expect(await f.ledgerSum(shop.outletId, rose.id)).toBe(74);
  });

  it('an ingredient with trackInventory off is skipped entirely; with every ingredient skipped nothing is reported consumed', async () => {
    const shop = await f.setupShop('co-untracked');
    const water = await f.createIngredient(shop, 'Water', {
      trackInventory: false,
    });
    const p = await f.createProduct(shop, {
      ingredients: [{ ingredientId: water.id, quantityPerUnit: 1 }],
    });
    const consumed = await consume(
      shop,
      [{ productId: p.id, variantId: null, quantity: 5 }],
      -1,
    );
    expect(consumed).toBe(false);
    expect(await f.movements(shop.outletId, water.id)).toEqual([]);
  });

  describe('insufficient stock', () => {
    it('throwOnInsufficientStock rejects with 409 and rolls the WHOLE call back, including ingredients that were fine', async () => {
      const { shop, rose, ribbon, product } = await bom('co-throw', 100, 3); // ribbon: need 2 x 5 = 10, have 3
      await expect(
        consume(
          shop,
          [{ productId: product.id, variantId: null, quantity: 5 }],
          -1,
          { throwOnInsufficientStock: true },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(100); // rose's decrement rolled back
      expect(await f.stockOf(shop.outletId, ribbon.id)).toBe(3);
      expect(await f.movements(shop.outletId, rose.id, 'CONSUMED')).toEqual([]);
    });

    it('the guard is exact at the boundary: needing precisely what is there succeeds and leaves 0, never negative', async () => {
      const { shop, rose, product } = await bom('co-boundary', 18, 6); // 3 units need 18 roses, 6 ribbon
      await consume(
        shop,
        [{ productId: product.id, variantId: null, quantity: 3 }],
        -1,
        { throwOnInsufficientStock: true },
      );
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(0);
    });

    it('allowNegative bypasses the guard for that line only: a sibling line without it is still guarded', async () => {
      const shop = await f.setupShop('co-allowneg');
      const a = await f.stockedProduct(shop, 1);
      const b = await f.stockedProduct(shop, 1);
      const ingA = (await f.shadowIngredientId(a.id))!;
      await consume(
        shop,
        [
          {
            productId: a.id,
            variantId: null,
            quantity: 3,
            allowNegative: true,
          },
        ],
        -1,
        { throwOnInsufficientStock: true },
      );
      expect(await f.stockOf(shop.outletId, ingA)).toBe(-2);
      await expect(
        consume(shop, [{ productId: b.id, variantId: null, quantity: 3 }], -1, {
          throwOnInsufficientStock: true,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('with throwOnInsufficientStock off (confirm path) stock simply goes negative and the ledger records the full amount', async () => {
      const { shop, rose, product } = await bom('co-neg', 5, 50);
      await consume(
        shop,
        [{ productId: product.id, variantId: null, quantity: 1 }],
        -1,
      );
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(-1);
      expect(await f.ledgerSum(shop.outletId, rose.id)).toBe(-1);
    });
  });

  describe('toggle gating is asymmetric by direction', () => {
    it('direction -1 with shop.autoDeductIngredientStock off writes nothing and returns false', async () => {
      const { shop, rose, product } = await bom('co-toggle-out');
      await f.setShop(shop, { autoDeductIngredientStock: false });
      expect(
        await consume(
          shop,
          [{ productId: product.id, variantId: null, quantity: 2 }],
          -1,
        ),
      ).toBe(false);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
      expect(await f.movements(shop.outletId, rose.id, 'CONSUMED')).toEqual([]);
    });

    it('direction +1 ignores the toggle: it reverses a consumption that already happened', async () => {
      const { shop, rose, product } = await bom('co-toggle-in');
      await consume(
        shop,
        [{ productId: product.id, variantId: null, quantity: 2 }],
        -1,
      );
      await f.setShop(shop, { autoDeductIngredientStock: false });
      expect(
        await consume(
          shop,
          [{ productId: product.id, variantId: null, quantity: 2 }],
          1,
        ),
      ).toBe(true);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
    });
  });

  it('movementType, note, reason and actor are passed through to the ledger row', async () => {
    const { shop, rose, product } = await bom('co-meta');
    const [admin] = await db.query<
      { id: number }[] & import('mysql2/promise').RowDataPacket[]
    >(`SELECT id FROM user WHERE shopId = ? LIMIT 1`, [shop.shopId]);
    await consume(
      shop,
      [{ productId: product.id, variantId: null, quantity: 1 }],
      1,
      {
        movementType: 'RETURN',
        note: 'Return #7',
        reason: 'damaged',
        actorUserId: admin.id,
      },
    );
    const [m] = await f.movements(shop.outletId, rose.id, 'RETURN');
    expect(m).toMatchObject({
      delta: 6,
      note: 'Return #7',
      reason: 'damaged',
      actorUserId: admin.id,
    });
  });

  it('an empty item list is a no-op that reports nothing consumed', async () => {
    const shop = await f.setupShop('co-empty');
    expect(await consume(shop, [], -1)).toBe(false);
  });
});
