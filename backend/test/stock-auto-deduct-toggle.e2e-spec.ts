import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// F12 (owner decision). shop.autoDeductIngredientStock governs RECIPE-BACKED
// products only. A PLAIN product (its stock resolves through its own shadow
// ingredient, quantityPerUnit 1) always decrements and restocks, whatever the
// toggle says. Applies to NEW orders; an order with no consumption record
// (LEGACY) keeps the old rule: toggle off takes nothing.
describe('autoDeductIngredientStock governs recipe-backed products only (F12, e2e)', () => {
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
  type Kind = 'plain' | 'recipe';
  type Channel = 'admin' | 'storefront' | 'draft';

  const START = 100;
  const QTY = 2;
  const PER_UNIT = 6; // recipe quantityPerUnit

  // A shop with one product of the given kind. `ing` is the ingredient whose
  // stock the product drains: its own shadow (plain) or the real one (recipe).
  async function shopWith(prefix: string, kind: Kind, toggle: boolean) {
    const shop = await f.setupShop(prefix);
    let product: { id: number };
    let ing: number;
    if (kind === 'plain') {
      product = await f.stockedProduct(shop, START);
      ing = (await f.shadowIngredientId(product.id))!;
    } else {
      const rose = await f.createIngredient(shop, 'Rose');
      await f.stockIngredient(shop, rose.id, START);
      product = await f.createProduct(shop, {
        ingredients: [{ ingredientId: rose.id, quantityPerUnit: PER_UNIT }],
      });
      ing = rose.id;
    }
    await f.setShop(shop, { autoDeductIngredientStock: toggle });
    await f.publish(shop);
    return { shop, product, ing };
  }

  // What one order of QTY units must take: plain always, recipe only toggle on.
  const taken = (kind: Kind, toggle: boolean) =>
    kind === 'plain' ? QTY : toggle ? QTY * PER_UNIT : 0;

  // Places an order on `channel` and leaves it holding stock (admin: confirmed).
  async function place(
    channel: Channel,
    shop: Shop,
    productId: number,
    confirm = true,
  ) {
    const items = [{ productId, quantity: QTY }];
    if (channel === 'admin') {
      const o = await f.adminOrder(shop, items);
      if (confirm) await f.setStatus(shop, o.id, 'confirmed');
      return o.id;
    }
    if (channel === 'storefront') {
      const res = await f.storefrontOrder(shop, items);
      return body<{ order: { id: number } }>(res).order.id;
    }
    const draft = await request(f.http())
      .post('/shop/draft-orders')
      .set(f.auth(shop))
      .send({
        outletId: shop.outletId,
        customerName: 'Phone Customer',
        customerPhone: '0501112222',
        customerAddress: 'Pickup',
        orderType: 'pickup',
        items,
      })
      .expect(201);
    const done = await request(f.http())
      .post(`/shop/draft-orders/${body<{ id: number }>(draft).id}/complete`)
      .set(f.auth(shop))
      .expect(201);
    return body<{ convertedOrderId: number }>(done).convertedOrderId;
  }

  const conserved = async (shop: Shop, ing: number) =>
    expect(await f.ledgerSum(shop.outletId, ing)).toBe(
      await f.stockOf(shop.outletId, ing),
    );

  const cells: [Channel, Kind, boolean][] = [];
  for (const c of ['admin', 'storefront', 'draft'] as Channel[])
    for (const k of ['plain', 'recipe'] as Kind[])
      for (const t of [true, false]) cells.push([c, k, t]);

  describe.each(cells)(
    '%s channel, %s product, toggle %s',
    (channel, kind, toggle) => {
      const tag = `${channel.slice(0, 2)}${kind[0]}${toggle ? 1 : 0}`;

      it('takes what the rule says and a cancel gives back exactly that', async () => {
        const { shop, product, ing } = await shopWith(
          `ad-c-${tag}`,
          kind,
          toggle,
        );
        const orderId = await place(channel, shop, product.id);
        expect(await f.stockOf(shop.outletId, ing)).toBe(
          START - taken(kind, toggle),
        );
        const row = await f.orderRow(orderId);
        expect(row.consumptionRecordedAt).not.toBeNull();
        expect(row.ingredientsConsumedAt !== null).toBe(
          taken(kind, toggle) > 0,
        );

        // Toggle flipped before the cancel: the record drives it, not the toggle.
        await f.setShop(shop, { autoDeductIngredientStock: !toggle });
        await f.cancelOrder(shop, orderId).expect(201);
        expect(await f.stockOf(shop.outletId, ing)).toBe(START);
        await conserved(shop, ing);
      });

      it('a delivered order returns exactly what it took', async () => {
        const { shop, product, ing } = await shopWith(
          `ad-r-${tag}`,
          kind,
          toggle,
        );
        const orderId = await place(channel, shop, product.id, false);
        await f.advance(shop, orderId, 'delivered');
        expect(await f.stockOf(shop.outletId, ing)).toBe(
          START - taken(kind, toggle),
        );
        const lineId = (await f.orderItems(orderId))[0].id as number;
        await request(f.http())
          .post(`/orders/${orderId}/returns`)
          .set(f.auth(shop))
          .send({
            reason: 'damaged',
            items: [{ orderItemId: lineId, quantity: QTY }],
          })
          .expect(201);
        expect(await f.stockOf(shop.outletId, ing)).toBe(START);
        await conserved(shop, ing);
      });
    },
  );

  it('plain product with variants: toggle off still decrements the variant stock', async () => {
    const shop = await f.setupShop('ad-variant');
    const p = await f.createProduct(shop);
    const [small] = await f.addVariants(shop, p.id, ['Small', 'Large']);
    const ing = (await f.shadowIngredientId(p.id, small.id))!;
    await f.stockIngredient(shop, ing, 10);
    await f.setShop(shop, { autoDeductIngredientStock: false });
    const o = await f.adminOrder(shop, [
      { productId: p.id, variantId: small.id, quantity: 3 },
    ]);
    await f.setStatus(shop, o.id, 'confirmed');
    expect(await f.stockOf(shop.outletId, ing)).toBe(7);
    await f.cancelOrder(shop, o.id).expect(201);
    expect(await f.stockOf(shop.outletId, ing)).toBe(10);
    await conserved(shop, ing);
  });

  describe('mixed basket (plain + recipe), toggle off', () => {
    async function mixed(prefix: string) {
      const shop = await f.setupShop(prefix);
      const plain = await f.stockedProduct(shop, START);
      const plainIng = (await f.shadowIngredientId(plain.id))!;
      const rose = await f.createIngredient(shop, 'Rose');
      await f.stockIngredient(shop, rose.id, START);
      const recipe = await f.createProduct(shop, {
        ingredients: [{ ingredientId: rose.id, quantityPerUnit: PER_UNIT }],
      });
      return { shop, plain, plainIng, recipe, rose: rose.id };
    }

    it('confirm takes the plain line only and records only that', async () => {
      const m = await mixed('ad-mix-confirm');
      await f.setShop(m.shop, { autoDeductIngredientStock: false });
      const o = await f.adminOrder(m.shop, [
        { productId: m.plain.id, quantity: 2 },
        { productId: m.recipe.id, quantity: 2 },
      ]);
      await f.setStatus(m.shop, o.id, 'confirmed');
      expect(await f.stockOf(m.shop.outletId, m.plainIng)).toBe(START - 2);
      expect(await f.stockOf(m.shop.outletId, m.rose)).toBe(START);
      expect((await f.orderRow(o.id)).ingredientsConsumedAt).not.toBeNull();
      const rec = await db.query<
        { ingredientId: number; quantity: number }[] &
          import('mysql2/promise').RowDataPacket[]
      >(
        `SELECT ingredientId, quantity FROM orderstockconsumption WHERE orderId = ?`,
        [o.id],
      );
      expect(rec).toHaveLength(1);
      expect(rec[0]).toMatchObject({ ingredientId: m.plainIng, quantity: 2 });
      await f.cancelOrder(m.shop, o.id).expect(201);
      expect(await f.stockOf(m.shop.outletId, m.plainIng)).toBe(START);
      expect(await f.stockOf(m.shop.outletId, m.rose)).toBe(START);
      await conserved(m.shop, m.plainIng);
      await conserved(m.shop, m.rose);
    });

    it('F2 scenario: confirmed with the toggle ON, flipped OFF, increase-edit then cancel leaves no phantom stock', async () => {
      const m = await mixed('ad-mix-f2');
      const o = await f.adminOrder(m.shop, [
        { productId: m.plain.id, quantity: 1 },
        { productId: m.recipe.id, quantity: 1 },
      ]);
      await f.setStatus(m.shop, o.id, 'confirmed');
      expect(await f.stockOf(m.shop.outletId, m.plainIng)).toBe(START - 1);
      expect(await f.stockOf(m.shop.outletId, m.rose)).toBe(START - PER_UNIT);

      await f.setShop(m.shop, { autoDeductIngredientStock: false });
      await f
        .editItems(m.shop, o.id, [
          { productId: m.plain.id, quantity: 3 },
          { productId: m.recipe.id, quantity: 3 },
        ])
        .expect(200);
      // Plain line took +2 despite the toggle; the recipe line took nothing more.
      expect(await f.stockOf(m.shop.outletId, m.plainIng)).toBe(START - 3);
      expect(await f.stockOf(m.shop.outletId, m.rose)).toBe(START - PER_UNIT);

      await f.cancelOrder(m.shop, o.id).expect(201);
      expect(await f.stockOf(m.shop.outletId, m.plainIng)).toBe(START);
      expect(await f.stockOf(m.shop.outletId, m.rose)).toBe(START);
      await conserved(m.shop, m.plainIng);
      await conserved(m.shop, m.rose);
    });

    it('an edit-down with the toggle off gives back what the record holds, plain and recipe alike', async () => {
      const m = await mixed('ad-mix-down');
      const o = await f.adminOrder(m.shop, [
        { productId: m.plain.id, quantity: 4 },
        { productId: m.recipe.id, quantity: 4 },
      ]);
      await f.setStatus(m.shop, o.id, 'confirmed');
      await f.setShop(m.shop, { autoDeductIngredientStock: false });
      await f
        .editItems(m.shop, o.id, [
          { productId: m.plain.id, quantity: 2 },
          { productId: m.recipe.id, quantity: 2 },
        ])
        .expect(200);
      expect(await f.stockOf(m.shop.outletId, m.plainIng)).toBe(START - 2);
      expect(await f.stockOf(m.shop.outletId, m.rose)).toBe(
        START - 2 * PER_UNIT,
      );
      await f.cancelOrder(m.shop, o.id).expect(201);
      expect(await f.stockOf(m.shop.outletId, m.plainIng)).toBe(START);
      expect(await f.stockOf(m.shop.outletId, m.rose)).toBe(START);
    });
  });

  describe('LEGACY orders (no consumption record) keep the old rule', () => {
    async function makeLegacy(orderId: number) {
      await db.execute(
        `UPDATE \`order\` SET consumptionRecordedAt = NULL WHERE id = ?`,
        [orderId],
      );
      await db.execute(`DELETE FROM orderstockconsumption WHERE orderId = ?`, [
        orderId,
      ]);
    }

    it('a legacy pending order confirmed with the toggle off takes nothing, plain product included', async () => {
      const { shop, product, ing } = await shopWith(
        'ad-leg-conf',
        'plain',
        false,
      );
      const o = await f.adminOrder(shop, [
        { productId: product.id, quantity: QTY },
      ]);
      await makeLegacy(o.id);
      await f.setStatus(shop, o.id, 'confirmed');
      expect(await f.stockOf(shop.outletId, ing)).toBe(START);
      expect((await f.orderRow(o.id)).ingredientsConsumedAt).toBeNull();
    });

    it('a legacy pending order confirmed with the toggle on decrements as before', async () => {
      const { shop, product, ing } = await shopWith('ad-leg-on', 'plain', true);
      const o = await f.adminOrder(shop, [
        { productId: product.id, quantity: QTY },
      ]);
      await makeLegacy(o.id);
      await f.setStatus(shop, o.id, 'confirmed');
      expect(await f.stockOf(shop.outletId, ing)).toBe(START - QTY);
    });

    it('a legacy confirmed order edited UP with the toggle off takes nothing more', async () => {
      const { shop, product, ing } = await shopWith(
        'ad-leg-edit',
        'plain',
        true,
      );
      const o = await f.adminOrder(shop, [
        { productId: product.id, quantity: 1 },
      ]);
      await f.setStatus(shop, o.id, 'confirmed');
      await makeLegacy(o.id);
      await f.setShop(shop, { autoDeductIngredientStock: false });
      await f
        .editItems(shop, o.id, [{ productId: product.id, quantity: 3 }])
        .expect(200);
      expect(await f.stockOf(shop.outletId, ing)).toBe(START - 1);
    });
  });

  it('tenant scoping: another shop with the toggle off is unaffected by this shop', async () => {
    const a = await shopWith('ad-iso-a', 'plain', false);
    const b = await shopWith('ad-iso-b', 'plain', true);
    await place('storefront', a.shop, a.product.id);
    expect(await f.stockOf(a.shop.outletId, a.ing)).toBe(START - QTY);
    expect(await f.stockOf(b.shop.outletId, b.ing)).toBe(START);
  });
});
