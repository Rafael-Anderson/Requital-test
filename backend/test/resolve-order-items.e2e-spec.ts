import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DatabaseService } from '../src/database/database.service';
import { ProductsService } from '../src/products/products.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// W5 (audit 7.6 / D-6). ProductsService.resolveOrderItems, the one resolver
// behind storefront checkout, admin create, updateItems and draft orders.
// Asserted two ways: directly on its return value (a public service method),
// and through what the HTTP order paths PERSIST from it (orderitem capture).
describe('resolveOrderItems: price, variant, discount, tax, cost (e2e)', () => {
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

  const resolve = (
    shop: Shop,
    items: {
      productId: number;
      quantity: number;
      variantId?: number;
      priceOverride?: number;
      giftCardAmount?: number;
    }[],
  ) => products.resolveOrderItems(shop.shopId, items);

  async function setVariantPrice(
    shop: Shop,
    productId: number,
    variantId: number,
    price: number,
  ) {
    await request(f.http())
      .patch(`/products/${productId}/variants/${variantId}`)
      .set(f.auth(shop))
      .send({ price })
      .expect(200);
  }

  describe('variant and price resolution', () => {
    it('uses the variant price over the product price, and snapshots the label', async () => {
      const shop = await f.setupShop('ro-var');
      const p = await f.createProduct(shop, { price: 100 });
      const [small, large] = await f.addVariants(shop, p.id, [
        'Small',
        'Large',
      ]);
      await setVariantPrice(shop, p.id, large.id, 150);

      const [rs, rl] = await resolve(shop, [
        { productId: p.id, variantId: small.id, quantity: 2 },
        { productId: p.id, variantId: large.id, quantity: 3 },
      ]);
      expect(Number(rs.price)).toBe(Number(rs.variant!.price)); // whatever small inherited
      expect(Number(rl.price)).toBe(150);
      expect(rl.variantLabel).toBe('Large');
      expect(rl.quantity).toBe(3);
      expect(rl.autoDiscountAmount).toBeNull();
    });

    it('rejects a variant product ordered without a variant, a foreign variant, a variant on a plain product, and a product from another shop', async () => {
      const shop = await f.setupShop('ro-bad');
      const other = await f.setupShop('ro-bad-other');
      const withVariants = await f.createProduct(shop);
      const [v] = await f.addVariants(shop, withVariants.id, ['A', 'B']);
      const plain = await f.createProduct(shop);
      const otherProduct = await f.createProduct(other);

      await expect(
        resolve(shop, [{ productId: withVariants.id, quantity: 1 }]),
      ).rejects.toThrow(/requires selecting an option/);
      await expect(
        resolve(shop, [{ productId: plain.id, variantId: v.id, quantity: 1 }]),
      ).rejects.toThrow(/does not have variant options/);
      const anotherWithVariants = await f.createProduct(shop);
      await f.addVariants(shop, anotherWithVariants.id, ['A', 'B']);
      await expect(
        resolve(shop, [
          { productId: anotherWithVariants.id, variantId: v.id, quantity: 1 },
        ]),
      ).rejects.toThrow(/Invalid variant/);
      await expect(
        resolve(shop, [{ productId: otherProduct.id, quantity: 1 }]),
      ).rejects.toThrow(/does not belong to this shop/);
    });

    it('an admin priceOverride wins over the catalog price AND over an auto-discount', async () => {
      const shop = await f.setupShop('ro-override');
      const p = await f.createProduct(shop, { price: 100 });
      await f.createDiscount(shop, {
        code: undefined,
        discountType: 'auto',
        type: 'PERCENTAGE',
        value: 20,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [p.id],
      });
      const [r] = await resolve(shop, [
        { productId: p.id, quantity: 1, priceOverride: 90 },
      ]);
      expect(Number(r.price)).toBe(90);
      expect(r.autoDiscountAmount).toBeNull();
    });

    it('a gift-card line is priced at the chosen denomination, never the placeholder price', async () => {
      const shop = await f.setupShop('ro-gc');
      const gc = await f.createProduct(shop, {
        price: 1,
        isGiftCard: true,
        trackInventory: false,
        giftCardDenominations: [50, 100],
      });
      const [r] = await resolve(shop, [
        { productId: gc.id, quantity: 2, giftCardAmount: 100 },
      ]);
      expect(Number(r.price)).toBe(100);
      await expect(
        resolve(shop, [{ productId: gc.id, quantity: 1, giftCardAmount: 77 }]),
      ).rejects.toThrow(/not a valid gift card amount/);
      await expect(
        resolve(shop, [{ productId: gc.id, quantity: 1 }]),
      ).rejects.toThrow(/requires choosing a gift card amount/);
    });
  });

  describe('auto-discount', () => {
    it('reduces the line price, records the markdown, and a variant is discounted off ITS price', async () => {
      const shop = await f.setupShop('ro-auto');
      const p = await f.createProduct(shop, { price: 100 });
      const [, large] = await f.addVariants(shop, p.id, ['Small', 'Large']);
      await setVariantPrice(shop, p.id, large.id, 150);
      await f.createDiscount(shop, {
        code: undefined,
        discountType: 'auto',
        type: 'PERCENTAGE',
        value: 20,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [p.id],
      });
      const [r] = await resolve(shop, [
        { productId: p.id, variantId: large.id, quantity: 1 },
      ]);
      expect(Number(r.price)).toBe(120);
      expect(Number(r.autoDiscountAmount)).toBe(30);
    });

    it('with two matching discounts the single best one applies (no stacking), and a collection-scoped one matches by collection', async () => {
      const shop = await f.setupShop('ro-auto2');
      const p = await f.createProduct(shop, { price: 100 });
      const otherCollection = await request(f.http())
        .post('/collections')
        .set(f.auth(shop))
        .send({ name: 'Elsewhere' })
        .expect(201);
      const unrelated = await f.createProduct(shop, {
        price: 100,
        collectionIds: [body<{ id: number }>(otherCollection).id],
      });
      await f.createDiscount(shop, {
        code: undefined,
        discountType: 'auto',
        type: 'PERCENTAGE',
        value: 10,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [p.id],
      });
      await f.createDiscount(shop, {
        code: undefined,
        discountType: 'auto',
        type: 'FIXED_AMOUNT',
        value: 25,
        appliesTo: 'SPECIFIC_COLLECTIONS',
        collectionIds: [shop.collectionId],
      });
      const [r, u] = await resolve(shop, [
        { productId: p.id, quantity: 1 },
        { productId: unrelated.id, quantity: 1 },
      ]);
      expect(Number(r.autoDiscountAmount)).toBe(25); // 25 > 10, not 35
      expect(Number(r.price)).toBe(75);
      expect(u.autoDiscountAmount).toBeNull(); // in no collection, scoped discounts miss it
      expect(Number(u.price)).toBe(100);
    });

    it('persists as orderitem.autoDiscountAmount on both the admin and the storefront path', async () => {
      const shop = await f.setupShop('ro-auto-persist');
      const p = await f.stockedProduct(shop, 20, { price: 100 });
      await f.createDiscount(shop, {
        code: undefined,
        discountType: 'auto',
        type: 'PERCENTAGE',
        value: 20,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [p.id],
      });
      await f.publish(shop);
      const admin = await f.adminOrder(shop, [
        { productId: p.id, quantity: 1 },
      ]);
      const sf = body<{ order: { id: number } }>(
        await f.storefrontOrder(shop, [{ productId: p.id, quantity: 1 }]),
      ).order;
      for (const id of [admin.id, sf.id]) {
        const [item] = await f.orderItems(id);
        expect(Number(item.priceAtPurchase)).toBe(80);
        expect(Number(item.autoDiscountAmount)).toBe(20);
      }
    });
  });

  describe('tax class and rate', () => {
    it('a product with its own class uses it; one with none falls back to the shop default; the rate is the class rate', async () => {
      const shop = await f.setupShop('ro-tax');
      const classes = await f.taxClasses(shop);
      const standard = classes.find((c) => c.isDefault)!;
      const zero = classes.find((c) => c.type === 'zero')!;
      await request(f.http())
        .patch(`/tax-classes/${standard.id}`)
        .set(f.auth(shop))
        .send({ rate: 5 })
        .expect(200);
      const zeroProduct = await f.createProduct(shop, { taxClassId: zero.id });
      const unassigned = await f.createProduct(shop);

      const [z, u] = await resolve(shop, [
        { productId: zeroProduct.id, quantity: 1 },
        { productId: unassigned.id, quantity: 1 },
      ]);
      expect(z.taxClassId).toBe(zero.id);
      expect(z.taxRate).toBe(0);
      expect(u.taxClassId).toBe(standard.id); // NULL class means "shop default", not untaxed
      expect(u.taxRate).toBe(5);
    });

    it('a shop with no default class at all resolves to a null class and rate 0 (unknown, not invented)', async () => {
      const shop = await f.setupShop('ro-tax-none');
      const p = await f.createProduct(shop);
      await db.execute(`UPDATE taxclass SET isDefault = 0 WHERE shopId = ?`, [
        shop.shopId,
      ]);
      const [r] = await resolve(shop, [{ productId: p.id, quantity: 1 }]);
      expect(r.taxClassId).toBeNull();
      expect(r.taxRate).toBe(0);
    });

    it('the rate captured on an order is frozen: a later class rate change does not touch it', async () => {
      const shop = await f.setupShop('ro-tax-frozen');
      const standard = (await f.taxClasses(shop)).find((c) => c.isDefault)!;
      await request(f.http())
        .patch(`/tax-classes/${standard.id}`)
        .set(f.auth(shop))
        .send({ rate: 5 })
        .expect(200);
      const p = await f.stockedProduct(shop, 5);
      const order = await f.adminOrder(shop, [
        { productId: p.id, quantity: 1 },
      ]);
      await request(f.http())
        .patch(`/tax-classes/${standard.id}`)
        .set(f.auth(shop))
        .send({ rate: 15 })
        .expect(200);
      const [item] = await f.orderItems(order.id);
      expect(Number(item.taxRate)).toBe(5);
      // The default shop is tax-inclusive: 5% backed out of 100 is 4.76 at the old rate
      // (it would be 13.04 at the new 15%).
      expect(Number(item.taxAmount)).toBe(4.76);
    });
  });

  describe('unitCost capture', () => {
    it('a plain product captures its own costPrice; no cost set captures NULL, never 0', async () => {
      const shop = await f.setupShop('ro-cost-plain');
      const costed = await f.createProduct(shop, { costPrice: 12.5 });
      const uncosted = await f.createProduct(shop);
      const [c, u] = await resolve(shop, [
        { productId: costed.id, quantity: 1 },
        { productId: uncosted.id, quantity: 1 },
      ]);
      expect(Number(c.unitCost)).toBe(12.5);
      expect(u.unitCost).toBeNull();
    });

    it('a recipe product captures the sum of quantityPerUnit x ingredient cost; any uncosted ingredient makes it NULL', async () => {
      const shop = await f.setupShop('ro-cost-recipe');
      const rose = await f.createIngredient(shop, 'Rose', { costPerUnit: 2 });
      const ribbon = await f.createIngredient(shop, 'Ribbon', {
        costPerUnit: 0.5,
      });
      const mystery = await f.createIngredient(shop, 'Mystery'); // no cost
      const costed = await f.createProduct(shop, {
        ingredients: [
          { ingredientId: rose.id, quantityPerUnit: 6 },
          { ingredientId: ribbon.id, quantityPerUnit: 2 },
        ],
      });
      const partly = await f.createProduct(shop, {
        ingredients: [
          { ingredientId: rose.id, quantityPerUnit: 1 },
          { ingredientId: mystery.id, quantityPerUnit: 1 },
        ],
      });
      const [c, p] = await resolve(shop, [
        { productId: costed.id, quantity: 1 },
        { productId: partly.id, quantity: 1 },
      ]);
      expect(Number(c.unitCost)).toBe(13); // 6*2 + 2*0.5
      expect(p.unitCost).toBeNull();
    });

    it('is frozen at order time: editing the cost afterwards never rewrites the captured unitCost', async () => {
      const shop = await f.setupShop('ro-cost-frozen');
      const p = await f.stockedProduct(shop, 5, { costPrice: 10 });
      const order = await f.adminOrder(shop, [
        { productId: p.id, quantity: 1 },
      ]);
      await request(f.http())
        .patch(`/products/${p.id}`)
        .set(f.auth(shop))
        .send({ costPrice: 99 })
        .expect(200);
      expect(Number((await f.orderItems(order.id))[0].unitCost)).toBe(10);
    });

    it('an admin priceOverride changes what was charged, not what it cost', async () => {
      const shop = await f.setupShop('ro-cost-override');
      const p = await f.createProduct(shop, { costPrice: 10, price: 100 });
      const [r] = await resolve(shop, [
        { productId: p.id, quantity: 1, priceOverride: 60 },
      ]);
      expect(Number(r.price)).toBe(60);
      expect(Number(r.unitCost)).toBe(10);
    });

    // FINDING F3. consumeForOrderItems treats a variant's own recipe rows as a
    // WHOLESALE replacement of the product-level ones (override wins, no merge).
    // resolveOrderItems' recipeFor() instead takes product-wide rows PLUS the
    // variant's rows, so a variant overriding an ingredient is costed for both
    // the default quantity and the override. Cost no longer matches what stock
    // actually consumed, and margin reports are understated.
    it(
      'FINDING F3: a variant with a recipe override is costed on its override only, matching what is consumed',
      async () => {
        const shop = await f.setupShop('ro-cost-override-recipe');
        const rose = await f.createIngredient(shop, 'Rose', { costPerUnit: 2 });
        const p = await f.createProduct(shop, {
          ingredients: [{ ingredientId: rose.id, quantityPerUnit: 6 }],
        });
        const [, large] = await f.addVariants(shop, p.id, ['Small', 'Large']);
        await request(f.http())
          .patch(`/products/${p.id}/variants/${large.id}`)
          .set(f.auth(shop))
          .send({
            ingredients: [{ ingredientId: rose.id, quantityPerUnit: 10 }],
          })
          .expect(200);
        const [r] = await resolve(shop, [
          { productId: p.id, variantId: large.id, quantity: 1 },
        ]);
        // Consumption takes 10 roses -> cost 20 (not (6 + 10) * 2 = 32).
        expect(Number(r.unitCost)).toBe(20);
      },
    );
  });

  describe('allowNegative flag (what the stock guard is told per line)', () => {
    it('is true for an untracked product or continueSellingOutOfStock, false for a tracked default', async () => {
      const shop = await f.setupShop('ro-allowneg');
      const tracked = await f.createProduct(shop, { trackInventory: true });
      const untracked = await f.createProduct(shop, { trackInventory: false });
      const cso = await f.createProduct(shop, {
        trackInventory: true,
        continueSellingOutOfStock: true,
      });
      const rs = await resolve(shop, [
        { productId: tracked.id, quantity: 1 },
        { productId: untracked.id, quantity: 1 },
        { productId: cso.id, quantity: 1 },
      ]);
      expect(rs.map((r) => Boolean(r.allowNegative))).toEqual([
        false,
        true,
        true,
      ]);
    });
  });
});
