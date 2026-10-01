import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import type { DatabaseService } from '../src/database/database.service';
import { bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// W5 (audit 7.6 / D-6). OrdersService.adjustStockForOrder's restock-on-cancel
// branch, from EVERY cancellable status, on both reservation channels:
//
//   admin channel       decrements at pending->confirmed (nothing held while pending)
//   storefront channel  decrements at CREATION; confirm must NOT decrement again
//
// Real tables: outletingredientstock (stock) + stockmovement (ledger). Every
// test also asserts the ledger is conserved: sum(delta) == the stock row.
describe('Cancel restocks from every cancellable status (e2e)', () => {
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

  const START = 10;
  const QTY = 3;
  const CANCELLABLE = ['pending', 'confirmed', 'preparing', 'out_for_delivery'];

  describe('plain tracked product', () => {
    it.each(CANCELLABLE)(
      'admin-channel order cancelled from %s ends at the starting stock',
      async (from) => {
        const shop = await f.setupShop(`cr-a-${from.replace(/_/g, '')}`);
        const p = await f.stockedProduct(shop, START);
        const ing = (await f.shadowIngredientId(p.id))!;
        const order = await f.adminOrder(shop, [
          { productId: p.id, quantity: QTY },
        ]);

        if (from !== 'pending') await f.advance(shop, order.id, from);
        // Deferred channel: nothing is held until confirm.
        expect(await f.productStock(shop.outletId, p.id)).toBe(
          from === 'pending' ? START : START - QTY,
        );
        expect(
          (await f.orderRow(order.id)).ingredientsConsumedAt !== null,
        ).toBe(from !== 'pending');

        await f.cancelOrder(shop, order.id).expect(201);

        expect(await f.productStock(shop.outletId, p.id)).toBe(START);
        expect((await f.orderRow(order.id)).status).toBe('cancelled');
        expect(await f.ledgerSum(shop.outletId, ing)).toBe(START);
        // A cancel from pending never touched stock, so it logs no CONSUMED row.
        const consumed = await f.movements(shop.outletId, ing, 'CONSUMED');
        expect(consumed.map((m) => m.delta as number)).toEqual(
          from === 'pending' ? [] : [-QTY, QTY],
        );
      },
    );

    it.each(CANCELLABLE)(
      'storefront-channel order cancelled from %s ends at the starting stock (reserved at creation, never double-decremented)',
      async (from) => {
        const shop = await f.setupShop(`cr-s-${from.replace(/_/g, '')}`);
        const p = await f.stockedProduct(shop, START);
        await f.publish(shop);
        const ing = (await f.shadowIngredientId(p.id))!;
        const res = await f.storefrontOrder(shop, [
          { productId: p.id, quantity: QTY },
        ]);
        const orderId = (res.body as { order: { id: number } }).order.id;
        expect(await f.productStock(shop.outletId, p.id)).toBe(START - QTY);

        if (from !== 'pending') await f.advance(shop, orderId, from);
        // Confirm and later stages must NOT decrement a second time.
        expect(await f.productStock(shop.outletId, p.id)).toBe(START - QTY);

        await f.cancelOrder(shop, orderId).expect(201);
        expect(await f.productStock(shop.outletId, p.id)).toBe(START);
        expect(await f.ledgerSum(shop.outletId, ing)).toBe(START);
        const consumed = await f.movements(shop.outletId, ing, 'CONSUMED');
        expect(consumed.map((m) => m.delta as number)).toEqual([-QTY, QTY]);
      },
    );

    it.each(['delivered', 'cancelled'])(
      'cannot cancel a %s order, and stock is untouched',
      async (terminal) => {
        const shop = await f.setupShop(`cr-t-${terminal}`);
        const p = await f.stockedProduct(shop, START);
        const order = await f.adminOrder(shop, [
          { productId: p.id, quantity: QTY },
        ]);
        if (terminal === 'delivered')
          await f.advance(shop, order.id, 'delivered');
        else {
          await f.setStatus(shop, order.id, 'confirmed');
          await f.cancelOrder(shop, order.id).expect(201);
        }
        const before = await f.productStock(shop.outletId, p.id);
        await f.cancelOrder(shop, order.id).expect(400);
        expect(await f.productStock(shop.outletId, p.id)).toBe(before);
      },
    );

    it('two concurrent cancels of one confirmed order restock exactly once', async () => {
      const shop = await f.setupShop('cr-race');
      const p = await f.stockedProduct(shop, START);
      const ing = (await f.shadowIngredientId(p.id))!;
      const order = await f.adminOrder(shop, [
        { productId: p.id, quantity: QTY },
      ]);
      await f.setStatus(shop, order.id, 'confirmed');

      const [a, b] = await Promise.all([
        f.cancelOrder(shop, order.id),
        f.cancelOrder(shop, order.id),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses[0]).toBe(201);
      expect(statuses[1]).toBeGreaterThanOrEqual(400); // 400 (already cancelled) or 409 (CAS lost)

      expect(await f.productStock(shop.outletId, p.id)).toBe(START); // not START + QTY
      expect(await f.ledgerSum(shop.outletId, ing)).toBe(START);
    });

    it('an untracked product never moves stock or writes a movement through confirm and cancel', async () => {
      const shop = await f.setupShop('cr-untracked');
      const p = await f.createProduct(shop, { trackInventory: false });
      const order = await f.adminOrder(shop, [
        { productId: p.id, quantity: QTY },
      ]);
      await f.setStatus(shop, order.id, 'confirmed');
      await f.cancelOrder(shop, order.id).expect(201);
      const ing = await f.shadowIngredientId(p.id);
      expect(ing).toBeDefined();
      expect(await f.stockOf(shop.outletId, ing!)).toBe(0);
      expect(await f.movements(shop.outletId, ing!)).toEqual([]);
    });

    it('a variant line restocks that variant only, not its siblings or the parent', async () => {
      const shop = await f.setupShop('cr-variant');
      const p = await f.createProduct(shop);
      const variants = await f.addVariants(shop, p.id, ['Small', 'Large']);
      const [small, large] = variants;
      for (const v of variants) {
        const ing = (await f.shadowIngredientId(p.id, v.id))!;
        await f.stockIngredient(shop, ing, START);
      }
      const order = await f.adminOrder(shop, [
        { productId: p.id, variantId: large.id, quantity: QTY },
      ]);
      await f.setStatus(shop, order.id, 'confirmed');
      expect(await f.productStock(shop.outletId, p.id, large.id)).toBe(
        START - QTY,
      );
      await f.cancelOrder(shop, order.id).expect(201);
      expect(await f.productStock(shop.outletId, p.id, large.id)).toBe(START);
      expect(await f.productStock(shop.outletId, p.id, small.id)).toBe(START);
    });
  });

  describe('Bill-of-Materials product (multi-ingredient recipe)', () => {
    async function bomProduct(shop: Awaited<ReturnType<typeof f.setupShop>>) {
      const rose = await f.createIngredient(shop, 'Rose');
      const ribbon = await f.createIngredient(shop, 'Ribbon');
      await f.stockIngredient(shop, rose.id, 100);
      await f.stockIngredient(shop, ribbon.id, 50);
      const p = await f.createProduct(shop, {
        ingredients: [
          { ingredientId: rose.id, quantityPerUnit: 6 },
          { ingredientId: ribbon.id, quantityPerUnit: 2 },
        ],
      });
      return { p, rose: rose.id, ribbon: ribbon.id };
    }

    it.each(['confirmed', 'preparing', 'out_for_delivery'])(
      'cancel from %s returns EVERY recipe ingredient in full',
      async (from) => {
        const shop = await f.setupShop(`cr-b-${from.replace(/_/g, '')}`);
        const { p, rose, ribbon } = await bomProduct(shop);
        const order = await f.adminOrder(shop, [
          { productId: p.id, quantity: 4 },
        ]);
        await f.advance(shop, order.id, from);
        expect(await f.stockOf(shop.outletId, rose)).toBe(100 - 24);
        expect(await f.stockOf(shop.outletId, ribbon)).toBe(50 - 8);

        await f.cancelOrder(shop, order.id).expect(201);
        expect(await f.stockOf(shop.outletId, rose)).toBe(100);
        expect(await f.stockOf(shop.outletId, ribbon)).toBe(50);
        expect(await f.ledgerSum(shop.outletId, rose)).toBe(100);
        expect(await f.ledgerSum(shop.outletId, ribbon)).toBe(50);
      },
    );

    it('cancelling a still-pending storefront order restocks the recipe', async () => {
      const shop = await f.setupShop('cr-b-sf');
      const { p, rose, ribbon } = await bomProduct(shop);
      await f.publish(shop);
      const res = await f.storefrontOrder(shop, [
        { productId: p.id, quantity: 2 },
      ]);
      const orderId = (res.body as { order: { id: number } }).order.id;
      expect(await f.stockOf(shop.outletId, rose)).toBe(100 - 12);
      await f.cancelOrder(shop, orderId).expect(201);
      expect(await f.stockOf(shop.outletId, rose)).toBe(100);
      expect(await f.stockOf(shop.outletId, ribbon)).toBe(50);
    });

    it('restock follows what THIS order consumed, not the toggle as it reads at cancel time', async () => {
      const shop = await f.setupShop('cr-b-toggle');
      const { p, rose } = await bomProduct(shop);
      const order = await f.adminOrder(shop, [
        { productId: p.id, quantity: 1 },
      ]);
      await f.setStatus(shop, order.id, 'confirmed'); // consumed under toggle ON
      await f.setShop(shop, { autoDeductIngredientStock: false });
      await f.cancelOrder(shop, order.id).expect(201);
      expect(await f.stockOf(shop.outletId, rose)).toBe(100); // still restored
    });

    it('an order confirmed with the toggle OFF consumed nothing, so cancel restores nothing (no phantom stock)', async () => {
      const shop = await f.setupShop('cr-b-off');
      const { p, rose } = await bomProduct(shop);
      await f.setShop(shop, { autoDeductIngredientStock: false });
      const order = await f.adminOrder(shop, [
        { productId: p.id, quantity: 1 },
      ]);
      await f.setStatus(shop, order.id, 'confirmed');
      expect((await f.orderRow(order.id)).ingredientsConsumedAt).toBeNull();
      await f.setShop(shop, { autoDeductIngredientStock: true });
      await f.cancelOrder(shop, order.id).expect(201);
      expect(await f.stockOf(shop.outletId, rose)).toBe(100); // not 106
    });

    it('CHARACTERIZATION (finding F12): with the toggle off, a PLAIN product is not decremented either', async () => {
      // Phase A routed plain products through consumeForOrderItems, whose
      // direction -1 branch returns early on shop.autoDeductIngredientStock.
      // So the toggle named for ingredients also switches off product stock
      // and the insufficient-stock guard. Pinned as-is so a refactor cannot
      // change it silently; whether it is intended is the coordinator's call.
      const shop = await f.setupShop('cr-char-toggle');
      const p = await f.stockedProduct(shop, 5);
      await f.setShop(shop, { autoDeductIngredientStock: false });
      await f.publish(shop);
      await f.storefrontOrder(shop, [{ productId: p.id, quantity: 4 }]);
      expect(await f.productStock(shop.outletId, p.id)).toBe(5);
      // ...and a quantity that exceeds stock is not rejected.
      await f.storefrontOrder(shop, [{ productId: p.id, quantity: 50 }]);
      expect(await f.productStock(shop.outletId, p.id)).toBe(5);
    });
  });
});
