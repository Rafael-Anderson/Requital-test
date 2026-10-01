import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// W5 (audit 7.6 / D-6). Does a return restock a Bill-of-Materials product's
// INGREDIENTS? Yes, when the order consumed them: ReturnsService routes the
// restock through consumeForOrderItems(direction +1, movementType 'RETURN'),
// which fans out over the recipe exactly like a sale does. These specs pin that,
// and pin the three ways the restock can disagree with what the order consumed.
describe('Return restock for a BoM-backed product (e2e)', () => {
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

  async function bomShop(
    prefix: string,
    productOverrides: Record<string, unknown> = {},
  ) {
    const shop = await f.setupShop(prefix);
    const rose = await f.createIngredient(shop, 'Rose');
    const ribbon = await f.createIngredient(shop, 'Ribbon');
    await f.stockIngredient(shop, rose.id, 100);
    await f.stockIngredient(shop, ribbon.id, 50);
    const product = await f.createProduct(shop, {
      ingredients: [
        { ingredientId: rose.id, quantityPerUnit: 6 },
        { ingredientId: ribbon.id, quantityPerUnit: 2 },
      ],
      ...productOverrides,
    });
    return { shop, rose, ribbon, product };
  }

  async function deliveredOrder(
    shop: Shop,
    productId: number,
    quantity: number,
  ) {
    const order = await f.adminOrder(shop, [{ productId, quantity }]);
    await f.advance(shop, order.id, 'delivered');
    const detail = await request(f.http())
      .get(`/orders/${order.id}`)
      .set(f.auth(shop))
      .expect(200);
    const line = body<{ orderitem: { id: number }[] }>(detail).orderitem[0];
    return { orderId: order.id, orderItemId: line.id };
  }

  function returnItems(
    shop: Shop,
    orderId: number,
    orderItemId: number,
    quantity: number,
    extra: Record<string, unknown> = {},
  ) {
    return request(f.http())
      .post(`/orders/${orderId}/returns`)
      .set(f.auth(shop))
      .send({
        reason: 'damaged',
        items: [{ orderItemId, quantity }],
        ...extra,
      });
  }

  it('a partial return gives back quantityPerUnit x returned quantity of EVERY recipe ingredient, as RETURN movements', async () => {
    const { shop, rose, ribbon, product } = await bomShop('rr-partial');
    const { orderId, orderItemId } = await deliveredOrder(shop, product.id, 3);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100 - 18);

    const res = await returnItems(shop, orderId, orderItemId, 1).expect(201);
    const returnId = body<{ id: number }>(res).id;
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100 - 18 + 6);
    expect(await f.stockOf(shop.outletId, ribbon.id)).toBe(50 - 6 + 2);

    const [m] = await f.movements(shop.outletId, rose.id, 'RETURN');
    expect(m).toMatchObject({
      delta: 6,
      note: `Return #${returnId}`,
      reason: 'damaged',
    });
    expect(m.productId).toBeNull(); // a real ingredient keeps the ingredient-only attribution
    expect(await f.ledgerSum(shop.outletId, rose.id)).toBe(
      await f.stockOf(shop.outletId, rose.id),
    );
    expect(await f.ledgerSum(shop.outletId, ribbon.id)).toBe(
      await f.stockOf(shop.outletId, ribbon.id),
    );
  });

  it('two partial returns that together cover the line restore the whole consumption, exactly once', async () => {
    const { shop, rose, ribbon, product } = await bomShop('rr-twice');
    const { orderId, orderItemId } = await deliveredOrder(shop, product.id, 3);
    await returnItems(shop, orderId, orderItemId, 1, {
      refundAmount: 1,
    }).expect(201);
    await returnItems(shop, orderId, orderItemId, 2, {
      refundAmount: 1,
    }).expect(201);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
    expect(await f.stockOf(shop.outletId, ribbon.id)).toBe(50);
    // a third return of the same line is refused and restocks nothing
    await returnItems(shop, orderId, orderItemId, 1, {
      refundAmount: 1,
    }).expect(400);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
  });

  it('restock: false leaves ingredient stock and the ledger untouched', async () => {
    const { shop, rose, product } = await bomShop('rr-norestock');
    const { orderId, orderItemId } = await deliveredOrder(shop, product.id, 2);
    await returnItems(shop, orderId, orderItemId, 2, { restock: false }).expect(
      201,
    );
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100 - 12);
    expect(await f.movements(shop.outletId, rose.id, 'RETURN')).toEqual([]);
  });

  it('a variant line restocks through ITS recipe override, not the product default', async () => {
    const shop = await f.setupShop('rr-variant');
    const rose = await f.createIngredient(shop, 'Rose');
    await f.stockIngredient(shop, rose.id, 100);
    const p = await f.createProduct(shop, {
      ingredients: [{ ingredientId: rose.id, quantityPerUnit: 6 }],
    });
    const [, large] = await f.addVariants(shop, p.id, ['Small', 'Large']);
    await request(f.http())
      .patch(`/products/${p.id}/variants/${large.id}`)
      .set(f.auth(shop))
      .send({ ingredients: [{ ingredientId: rose.id, quantityPerUnit: 10 }] })
      .expect(200);
    const order = await f.adminOrder(shop, [
      { productId: p.id, variantId: large.id, quantity: 1 },
    ]);
    await f.advance(shop, order.id, 'delivered');
    const detail = await request(f.http())
      .get(`/orders/${order.id}`)
      .set(f.auth(shop))
      .expect(200);
    const line = body<{ orderitem: { id: number }[] }>(detail).orderitem[0];
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(90);
    await returnItems(shop, order.id, line.id, 1).expect(201);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
  });

  it("another shop's order cannot be returned, and nothing is restocked", async () => {
    const { shop, rose, product } = await bomShop('rr-iso-a');
    const { orderId, orderItemId } = await deliveredOrder(shop, product.id, 1);
    const other = await f.setupShop('rr-iso-b');
    await returnItems(other, orderId, orderItemId, 1).expect(404);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100 - 6);
  });

  describe('the restock vs what the order actually consumed', () => {
    // FINDING F9. cancel() only restocks when order.ingredientsConsumedAt says the
    // order consumed ingredients ("never re-derived from the current toggle").
    // ReturnsService has no such gate: it always restocks. An order confirmed
    // while shop.autoDeductIngredientStock was OFF consumed nothing, and its
    // return still ADDS stock, so ingredient stock inflates.
    it(
      'FINDING F9: returning an order that consumed no ingredients does not add ingredient stock',
      async () => {
        const { shop, rose, product } = await bomShop('rr-unconsumed');
        await f.setShop(shop, { autoDeductIngredientStock: false });
        const { orderId, orderItemId } = await deliveredOrder(
          shop,
          product.id,
          2,
        );
        expect((await f.orderRow(orderId)).ingredientsConsumedAt).toBeNull();
        expect(await f.stockOf(shop.outletId, rose.id)).toBe(100); // nothing was consumed
        await returnItems(shop, orderId, orderItemId, 2).expect(201);
        expect(await f.stockOf(shop.outletId, rose.id)).toBe(100); // was 112
      },
    );

    it('F9 precondition: that order really consumed nothing (so the +12 above is phantom stock)', async () => {
      const { shop, rose, product } = await bomShop('rr-unconsumed-pre');
      await f.setShop(shop, { autoDeductIngredientStock: false });
      const { orderId } = await deliveredOrder(shop, product.id, 2);
      expect((await f.orderRow(orderId)).ingredientsConsumedAt).toBeNull();
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
    });

    // FINDING F10. Both cancel and return restock from the recipe AS IT STANDS
    // NOW (productingredient is read at restock time), not from what the order
    // consumed. Edit a recipe between sale and cancel/return and the stock does
    // not come back to where it started. Nothing on the order records the
    // quantities consumed (only a stockmovement row per ingredient does).
    it(
      'FINDING F10a: cancelling after the recipe changed restores what was actually consumed',
      async () => {
        const { shop, rose, product } = await bomShop('rr-recipe-cancel');
        const order = await f.adminOrder(shop, [
          { productId: product.id, quantity: 2 },
        ]);
        await f.setStatus(shop, order.id, 'confirmed'); // consumed 12 roses
        await request(f.http())
          .patch(`/products/${product.id}`)
          .set(f.auth(shop))
          .send({
            ingredients: [{ ingredientId: rose.id, quantityPerUnit: 4 }],
          })
          .expect(200);
        await f.cancelOrder(shop, order.id).expect(201);
        expect(await f.stockOf(shop.outletId, rose.id)).toBe(100); // was 100 - 12 + 8 = 96
      },
    );

    it(
      'FINDING F10b: returning after the recipe changed restores what was actually consumed',
      async () => {
        const { shop, rose, product } = await bomShop('rr-recipe-return');
        const { orderId, orderItemId } = await deliveredOrder(
          shop,
          product.id,
          2,
        );
        await request(f.http())
          .patch(`/products/${product.id}`)
          .set(f.auth(shop))
          .send({
            ingredients: [{ ingredientId: rose.id, quantityPerUnit: 4 }],
          })
          .expect(200);
        await returnItems(shop, orderId, orderItemId, 2).expect(201);
        expect(await f.stockOf(shop.outletId, rose.id)).toBe(100); // was 96
      },
    );

    // FINDING F11. A recipe product with product.trackInventory = false still
    // consumes its (tracked) ingredients on confirm: consumeForOrderItems looks
    // only at ingredient.trackInventory. ReturnsService gates its restock on
    // product.trackInventory, so the same order's return gives nothing back.
    it(
      'FINDING F11: a recipe product with trackInventory off gets its ingredients back on return',
      async () => {
        const { shop, rose, product } = await bomShop('rr-untracked-product', {
          trackInventory: false,
        });
        const { orderId, orderItemId } = await deliveredOrder(
          shop,
          product.id,
          2,
        );
        expect(await f.stockOf(shop.outletId, rose.id)).toBe(100 - 12); // it DID consume
        await returnItems(shop, orderId, orderItemId, 2).expect(201);
        expect(await f.stockOf(shop.outletId, rose.id)).toBe(100); // was 88
      },
    );

    it('F11 precondition: the untracked-product order consumed ingredients, and cancel (ungated) does give them back', async () => {
      const { shop, rose, product } = await bomShop('rr-untracked-product-c', {
        trackInventory: false,
      });
      const order = await f.adminOrder(shop, [
        { productId: product.id, quantity: 2 },
      ]);
      await f.setStatus(shop, order.id, 'confirmed');
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(88);
      await f.cancelOrder(shop, order.id).expect(201);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
    });

    it('F10 precondition: the recipe edit is accepted, so the new tests above really restock from a record and not from the changed recipe', async () => {
      const { shop, rose, product } = await bomShop('rr-recipe-pre');
      const order = await f.adminOrder(shop, [
        { productId: product.id, quantity: 2 },
      ]);
      await f.setStatus(shop, order.id, 'confirmed');
      await request(f.http())
        .patch(`/products/${product.id}`)
        .set(f.auth(shop))
        .send({ ingredients: [{ ingredientId: rose.id, quantityPerUnit: 4 }] })
        .expect(200);
      const recipe = await db.query<RowDataPacket[]>(
        `SELECT quantityPerUnit FROM productingredient WHERE productId = ? AND ingredientId = ?`,
        [product.id, rose.id],
      );
      expect(recipe.map((r) => r.quantityPerUnit as number)).toEqual([4]);
      await f.cancelOrder(shop, order.id).expect(201);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
    });

    // LEGACY: an order that predates the stock record (consumptionRecordedAt NULL,
    // nothing backfilled) keeps the old recipe-driven restock. Simulated by
    // clearing the marker and the record rows of an order placed today, so the
    // test exercises exactly the state a pre-migration order is in.
    async function makeLegacy(orderId: number) {
      await db.execute(
        `UPDATE \`order\` SET consumptionRecordedAt = NULL WHERE id = ?`,
        [orderId],
      );
      await db.execute(`DELETE FROM orderstockconsumption WHERE orderId = ?`, [
        orderId,
      ]);
    }

    it('LEGACY (no record): cancel after a recipe change still restocks from the recipe as it reads now (documented imprecision, unchanged)', async () => {
      const { shop, rose, product } = await bomShop('rr-legacy-cancel');
      const order = await f.adminOrder(shop, [
        { productId: product.id, quantity: 2 },
      ]);
      await f.setStatus(shop, order.id, 'confirmed');
      await makeLegacy(order.id);
      await request(f.http())
        .patch(`/products/${product.id}`)
        .set(f.auth(shop))
        .send({ ingredients: [{ ingredientId: rose.id, quantityPerUnit: 4 }] })
        .expect(200);
      await f.cancelOrder(shop, order.id).expect(201);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(96);
    });

    it('LEGACY (no record): a return restocks from the recipe and ignores what the order consumed (F9 behaviour kept for orders that predate the record)', async () => {
      const { shop, rose, product } = await bomShop('rr-legacy-return');
      await f.setShop(shop, { autoDeductIngredientStock: false });
      const { orderId, orderItemId } = await deliveredOrder(shop, product.id, 2);
      await makeLegacy(orderId);
      await returnItems(shop, orderId, orderItemId, 2).expect(201);
      expect(await f.stockOf(shop.outletId, rose.id)).toBe(112);
    });
  });
});
