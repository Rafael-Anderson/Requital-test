import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// P3a. The order's own record of what it took out of ingredient stock
// (orderstockconsumption + order.consumptionRecordedAt). Restocks and deltas read
// THAT, never today's recipe or flags. The W5 specs pin each finding end to end;
// this one pins the record itself and the paths they do not reach.
describe('Order stock consumption record (e2e)', () => {
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

  async function record(orderId: number) {
    return db.query<RowDataPacket[]>(
      `SELECT shopId, productId, variantId, ingredientId, quantity
         FROM orderstockconsumption WHERE orderId = ? ORDER BY id`,
      [orderId],
    );
  }

  async function conserved(shop: Shop, ingredientId: number) {
    expect(await f.ledgerSum(shop.outletId, ingredientId)).toBe(
      await f.stockOf(shop.outletId, ingredientId),
    );
  }

  async function bom(shop: Shop) {
    const rose = await f.createIngredient(shop, 'Rose');
    await f.stockIngredient(shop, rose.id, 100);
    const p = await f.createProduct(shop, {
      ingredients: [{ ingredientId: rose.id, quantityPerUnit: 6 }],
    });
    return { rose, p };
  }

  async function lineId(shop: Shop, orderId: number) {
    const res = await request(f.http())
      .get(`/orders/${orderId}`)
      .set(f.auth(shop))
      .expect(200);
    return body<{ orderitem: { id: number }[] }>(res).orderitem[0].id;
  }

  function ret(shop: Shop, orderId: number, orderItemId: number, qty: number) {
    return request(f.http())
      .post(`/orders/${orderId}/returns`)
      .set(f.auth(shop))
      .send({ reason: 'damaged', items: [{ orderItemId, quantity: qty }] });
  }

  it('storefront checkout writes the record in the same transaction as the reservation, scoped to the shop', async () => {
    const shop = await f.setupShop('osc-sf');
    const { rose, p } = await bom(shop);
    await f.publish(shop);
    const res = await f.storefrontOrder(shop, [
      { productId: p.id, quantity: 3 },
    ]);
    const orderId = body<{ order: { id: number } }>(res).order.id;
    const rows = await record(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      shopId: shop.shopId,
      productId: p.id,
      variantId: null,
      ingredientId: rose.id,
      quantity: 18,
    });
    expect((await f.orderRow(orderId)).consumptionRecordedAt).not.toBeNull();
  });

  it('a checkout that loses the stock race leaves no order and no record rows behind', async () => {
    const shop = await f.setupShop('osc-rollback');
    const p = await f.stockedProduct(shop, 1);
    await f.publish(shop);
    const [a, b] = await Promise.all([
      f.storefrontOrderRaw(shop, [{ productId: p.id, quantity: 1 }]),
      f.storefrontOrderRaw(shop, [{ productId: p.id, quantity: 1 }]),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM orderstockconsumption WHERE shopId = ?`,
      [shop.shopId],
    );
    expect(Number(rows[0].c)).toBe(1);
  });

  it('a deferred admin order is marked at creation with no rows, takes its rows at confirm, and gives exactly them back on cancel', async () => {
    const shop = await f.setupShop('osc-admin');
    const { rose, p } = await bom(shop);
    const order = await f.adminOrder(shop, [{ productId: p.id, quantity: 2 }]);
    expect((await f.orderRow(order.id)).consumptionRecordedAt).not.toBeNull();
    expect(await record(order.id)).toEqual([]);
    await f.setStatus(shop, order.id, 'confirmed');
    expect((await record(order.id)).map((r) => r.quantity as number)).toEqual([
      12,
    ]);
    await f.cancelOrder(shop, order.id).expect(201);
    expect((await record(order.id)).map((r) => r.quantity as number)).toEqual([
      0,
    ]); // kept at 0, never deleted
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
    await conserved(shop, rose.id);
  });

  it('an order confirmed with the toggle off holds nothing: its record is empty but present, so a return restocks nothing and is not mistaken for legacy', async () => {
    const shop = await f.setupShop('osc-off');
    const { rose, p } = await bom(shop);
    await f.setShop(shop, { autoDeductIngredientStock: false });
    const order = await f.adminOrder(shop, [{ productId: p.id, quantity: 2 }]);
    await f.advance(shop, order.id, 'delivered');
    expect(await record(order.id)).toEqual([]);
    expect((await f.orderRow(order.id)).consumptionRecordedAt).not.toBeNull();
    await f.setShop(shop, { autoDeductIngredientStock: true });
    await ret(shop, order.id, await lineId(shop, order.id), 2).expect(201);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
  });

  it('returns split what the line holds across several returns and the last one gives back the remainder exactly', async () => {
    const shop = await f.setupShop('osc-partials');
    const { rose, p } = await bom(shop);
    const order = await f.adminOrder(shop, [{ productId: p.id, quantity: 3 }]);
    await f.advance(shop, order.id, 'delivered');
    const line = await lineId(shop, order.id);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100 - 18);
    await ret(shop, order.id, line, 1).expect(201);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100 - 12);
    await ret(shop, order.id, line, 2).expect(201);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
    expect((await record(order.id)).map((r) => r.quantity as number)).toEqual([
      0,
    ]);
    await conserved(shop, rose.id);
  });

  it('a return after the recipe was edited gives back the average actually held per unit, never more than was held', async () => {
    const shop = await f.setupShop('osc-mixed');
    const { rose, p } = await bom(shop);
    const order = await f.adminOrder(shop, [{ productId: p.id, quantity: 2 }]);
    await f.advance(shop, order.id, 'delivered'); // holds 12
    await request(f.http())
      .patch(`/products/${p.id}`)
      .set(f.auth(shop))
      .send({ ingredients: [{ ingredientId: rose.id, quantityPerUnit: 1 }] })
      .expect(200);
    const line = await lineId(shop, order.id);
    await ret(shop, order.id, line, 1).expect(201);
    await ret(shop, order.id, line, 1).expect(201);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
    await conserved(shop, rose.id);
  });

  it('a variant line is recorded under its variant and a return gives back that variant only', async () => {
    const shop = await f.setupShop('osc-variant');
    const p = await f.createProduct(shop);
    const [small, large] = await f.addVariants(shop, p.id, ['Small', 'Large']);
    for (const v of [small, large]) {
      const ing = (await f.shadowIngredientId(p.id, v.id))!;
      await f.stockIngredient(shop, ing, 10);
    }
    const order = await f.adminOrder(shop, [
      { productId: p.id, variantId: large.id, quantity: 4 },
    ]);
    await f.advance(shop, order.id, 'delivered');
    const rows = await record(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ variantId: large.id, quantity: 4 });
    await ret(shop, order.id, await lineId(shop, order.id), 3).expect(201);
    expect(await f.productStock(shop.outletId, p.id, large.id)).toBe(10 - 4 + 3);
    expect(await f.productStock(shop.outletId, p.id, small.id)).toBe(10);
  });

  it('lowering the quantity of a pending storefront order gives back the removed units from the record', async () => {
    const shop = await f.setupShop('osc-edit-down');
    const { rose, p } = await bom(shop);
    await f.publish(shop);
    const res = await f.storefrontOrder(shop, [
      { productId: p.id, quantity: 4 },
    ]);
    const orderId = body<{ order: { id: number } }>(res).order.id;
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100 - 24);
    await f.editItems(shop, orderId, [{ productId: p.id, quantity: 1 }]).expect(200);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100 - 6);
    expect((await record(orderId)).map((r) => r.quantity as number)).toEqual([6]);
    await f.cancelOrder(shop, orderId).expect(201);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
    await conserved(shop, rose.id);
  });

  it('removing a line from a confirmed order gives back everything that line held, not what the recipe says today', async () => {
    const shop = await f.setupShop('osc-edit-remove');
    const { rose, p } = await bom(shop);
    const other = await f.stockedProduct(shop, 20);
    const order = await f.adminOrder(shop, [
      { productId: p.id, quantity: 2 },
      { productId: other.id, quantity: 1 },
    ]);
    await f.setStatus(shop, order.id, 'confirmed');
    await request(f.http())
      .patch(`/products/${p.id}`)
      .set(f.auth(shop))
      .send({ ingredients: [{ ingredientId: rose.id, quantityPerUnit: 1 }] })
      .expect(200);
    await f
      .editItems(shop, order.id, [{ productId: other.id, quantity: 1 }])
      .expect(200);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
    await conserved(shop, rose.id);
  });

  it('a record never crosses shops: the other shop has none of this order\'s rows', async () => {
    const a = await f.setupShop('osc-iso-a');
    const b = await f.setupShop('osc-iso-b');
    const { p } = await bom(a);
    const order = await f.adminOrder(a, [{ productId: p.id, quantity: 1 }]);
    await f.setStatus(a, order.id, 'confirmed');
    const mine = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM orderstockconsumption WHERE orderId = ? AND shopId = ?`,
      [order.id, a.shopId],
    );
    const theirs = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM orderstockconsumption WHERE orderId = ? AND shopId = ?`,
      [order.id, b.shopId],
    );
    expect(Number(mine[0].c)).toBe(1);
    expect(Number(theirs[0].c)).toBe(0);
    // And the other shop cannot cancel it (and so cannot trigger its restock).
    await f.cancelOrder(b, order.id).expect(404);
  });

  it('LEGACY (no marker): an increase-edit on a confirmed order writes NO partial record, so a later cancel is still recipe-driven and complete', async () => {
    const shop = await f.setupShop('osc-legacy-edit');
    const { rose, p } = await bom(shop);
    const order = await f.adminOrder(shop, [{ productId: p.id, quantity: 1 }]);
    await f.setStatus(shop, order.id, 'confirmed'); // took 6
    await db.execute(
      `UPDATE \`order\` SET consumptionRecordedAt = NULL WHERE id = ?`,
      [order.id],
    );
    await db.execute(`DELETE FROM orderstockconsumption WHERE orderId = ?`, [
      order.id,
    ]);
    await f.editItems(shop, order.id, [{ productId: p.id, quantity: 2 }]).expect(200);
    expect(await record(order.id)).toEqual([]);
    await f.cancelOrder(shop, order.id).expect(201);
    expect(await f.stockOf(shop.outletId, rose.id)).toBe(100);
    await conserved(shop, rose.id);
  });
});
