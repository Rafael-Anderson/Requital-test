import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { bootApp, makeFixtures, body } from './helpers/w5-fixture';
import { createStaff } from './helpers/staff-login';

jest.setTimeout(240000);

interface PoBody {
  id: number;
  poNumber: string;
  status: string;
  currency: string;
  subtotal: string;
  total: string;
  outletId: number;
  supplierId: number;
  expectedAt: string | null;
  lines: {
    id: number;
    ingredientId: number | null;
    productId: number | null;
    quantityOrdered: number;
    quantityReceived: number;
    unitCost: string;
    lineTotal: string;
    currency: string;
    supplierSku: string | null;
    description: string;
  }[];
  receipts: {
    id: number;
    total: string;
    currency: string;
    lines: { quantity: number; unitCost: string; stockMovementId: number | null }[];
  }[];
}
interface ReceiveBody {
  receiptId: number;
  replayed: boolean;
  purchaseOrder: PoBody;
}

// INV-2: purchase orders and receiving.
describe('Purchase orders (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let a: Awaited<ReturnType<typeof f.setupShop>>;
  let b: Awaited<ReturnType<typeof f.setupShop>>;
  let outletA2: number;
  let branchToken: string;
  let branchUserId: number;
  let orderManagerToken: string;

  const h = (t: string) => ({ Authorization: `Bearer ${t}` });
  const r = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
    a = await f.setupShop('po-a');
    b = await f.setupShop('po-b');
    const o2 = await r().post('/outlets').set(h(a.adminToken)).send({ name: `A2 ${f.runId}` }).expect(201);
    outletA2 = body<{ id: number }>(o2).id;
    const staff = await createStaff(app, a.adminToken, 'po', 'branch', a.outletId);
    branchToken = staff.token;
    branchUserId = staff.userId;
    orderManagerToken = (await createStaff(app, a.adminToken, 'po', 'order_manager')).token;
  });
  afterAll(async () => {
    await app.close();
  });

  type Shop = typeof a;

  async function supplier(shop: Shop, extra: object = {}) {
    const res = await r()
      .post('/suppliers')
      .set(h(shop.adminToken))
      .send({ name: `Sup ${f.uniq()}`, currency: 'AED', ...extra })
      .expect(201);
    return body<{ id: number; currency: string | null }>(res);
  }

  function createPo(
    shop: Shop,
    supplierId: number,
    lines: object[],
    extra: object = {},
    token = shop.adminToken,
  ) {
    return r()
      .post('/purchase-orders')
      .set(h(token))
      .send({ supplierId, outletId: shop.outletId, lines, ...extra });
  }

  async function sentPo(
    shop: Shop,
    qty: number,
    unitCost = 2,
    extra: { currency?: string; supplierCurrency?: string } = {},
  ) {
    const sup = await supplier(shop, { currency: extra.supplierCurrency ?? 'AED' });
    const ing = await f.createIngredient(shop, 'Stem');
    const res = await createPo(
      shop,
      sup.id,
      [{ ingredientId: ing.id, quantity: qty, unitCost }],
      extra.currency ? { currency: extra.currency } : {},
    ).expect(201);
    const po = body<PoBody>(res);
    await r().post(`/purchase-orders/${po.id}/send`).set(h(shop.adminToken)).expect(201);
    return { po, ing, sup, lineId: po.lines[0].id };
  }

  const receive = (
    shop: Shop,
    poId: number,
    lines: object[],
    extra: object = {},
    token = shop.adminToken,
  ) => r().post(`/purchase-orders/${poId}/receive`).set(h(token)).send({ lines, ...extra });

  async function conserved(shop: Shop, ingredientId: number, expected: number) {
    expect(await f.stockOf(shop.outletId, ingredientId)).toBe(expected);
    expect(await f.ledgerSum(shop.outletId, ingredientId)).toBe(expected);
  }

  describe('create', () => {
    it('numbers per shop (PO-0001 each), starts as a draft, captures currency and totals', async () => {
      const sup = await supplier(a);
      const ing = await f.createIngredient(a, 'Rose');
      const first = body<PoBody>(
        (await createPo(a, sup.id, [{ ingredientId: ing.id, quantity: 4, unitCost: 2.5 }], { expectedAt: '2026-10-15' }).expect(201)),
      );
      expect(first.expectedAt).toBe('2026-10-15');
      expect(first.status).toBe('draft');
      expect(first.currency).toBe('AED');
      expect(first.subtotal).toBe('10');
      expect(first.total).toBe('10');
      expect(first.lines[0]).toMatchObject({ currency: 'AED', lineTotal: '10', quantityReceived: 0 });
      const second = body<PoBody>(
        (await createPo(a, sup.id, [{ ingredientId: ing.id, quantity: 1, unitCost: 1 }]).expect(201)),
      );
      expect(Number(second.poNumber.slice(3))).toBe(Number(first.poNumber.slice(3)) + 1);
      // Another shop has its own sequence.
      const supB = await supplier(b);
      const ingB = await f.createIngredient(b, 'Rose');
      const firstB = body<PoBody>(
        (await createPo(b, supB.id, [{ ingredientId: ingB.id, quantity: 1, unitCost: 1 }]).expect(201)),
      );
      expect(firstB.poNumber).toBe('PO-0001');
    });

    it('prices a KWD order to 3 decimals and an AED one to 2 (3 x 10.505)', async () => {
      const ing = await f.createIngredient(a, 'Lily');
      const kwd = await supplier(a, { currency: 'KWD' });
      const k = body<PoBody>(
        (await createPo(a, kwd.id, [{ ingredientId: ing.id, quantity: 3, unitCost: 10.505 }]).expect(201)),
      );
      expect(k.currency).toBe('KWD');
      expect(k.lines[0].lineTotal).toBe('31.515');
      expect(k.total).toBe('31.515');
      const aed = await supplier(a, { currency: 'AED' });
      const p = body<PoBody>(
        (await createPo(a, aed.id, [{ ingredientId: ing.id, quantity: 3, unitCost: 10.505 }]).expect(201)),
      );
      expect(p.lines[0].lineTotal).toBe('31.52');
    });

    it('a supplier with no currency is refused unless the PO names one, and the supplier stays NULL', async () => {
      const sup = await supplier(a, { currency: undefined });
      expect(sup.currency).toBeNull();
      const ing = await f.createIngredient(a, 'Tulip');
      const line = { ingredientId: ing.id, quantity: 1, unitCost: 1 };
      await createPo(a, sup.id, [line]).expect(400);
      const ok = await createPo(a, sup.id, [line], { currency: 'OMR' }).expect(201);
      expect(body<PoBody>(ok).currency).toBe('OMR');
      expect(body<PoBody>(ok).lines[0].currency).toBe('OMR');
      const after = await r().get(`/suppliers/${sup.id}`).set(h(a.adminToken)).expect(200);
      expect(body<{ currency: string | null }>(after).currency).toBeNull();
    });

    it('fills the unit cost from the supplier catalogue only when its currency matches the PO', async () => {
      const sup = await supplier(a, { currency: 'AED' });
      const ing = await f.createIngredient(a, 'Peony');
      await r()
        .put(`/suppliers/${sup.id}/items/${ing.id}`)
        .set(h(a.adminToken))
        .send({ supplierSku: 'PEO-1', unitCost: 3.25 })
        .expect(200);
      const ok = body<PoBody>(
        (await createPo(a, sup.id, [{ ingredientId: ing.id, quantity: 2 }]).expect(201)),
      );
      expect(ok.lines[0]).toMatchObject({ unitCost: '3.25', supplierSku: 'PEO-1', lineTotal: '6.5' });
      // A KWD PO never reuses an AED catalogue price.
      await createPo(a, sup.id, [{ ingredientId: ing.id, quantity: 2 }], { currency: 'KWD' }).expect(400);
    });

    it('a product-level pick resolves to its shadow ingredient', async () => {
      const sup = await supplier(a);
      const product = await f.stockedProduct(a, 0);
      const shadow = (await f.shadowIngredientId(product.id))!;
      const po = body<PoBody>(
        (await createPo(a, sup.id, [{ productId: product.id, quantity: 2, unitCost: 1 }]).expect(201)),
      );
      expect(po.lines[0].ingredientId).toBe(shadow);
      expect(po.lines[0].productId).toBe(product.id);
    });

    it('refuses an archived supplier, a foreign supplier/outlet/ingredient/product, both-or-neither picks and duplicates', async () => {
      const sup = await supplier(a);
      const ing = await f.createIngredient(a, 'Iris');
      const line = { ingredientId: ing.id, quantity: 1, unitCost: 1 };
      await r().patch(`/suppliers/${sup.id}`).set(h(a.adminToken)).send({ status: 'archived' }).expect(200);
      await createPo(a, sup.id, [line]).expect(409);

      const supOk = await supplier(a);
      const supB = await supplier(b);
      const ingB = await f.createIngredient(b, 'Iris');
      const productB = await f.stockedProduct(b, 0);
      await createPo(a, supB.id, [line]).expect(404);
      await createPo(a, supOk.id, [line], { outletId: b.outletId }).expect(400);
      await createPo(a, supOk.id, [{ ingredientId: ingB.id, quantity: 1, unitCost: 1 }]).expect(404);
      await createPo(a, supOk.id, [{ productId: productB.id, quantity: 1, unitCost: 1 }]).expect(404);
      await createPo(a, supOk.id, [{ ingredientId: ing.id, productId: 1, quantity: 1, unitCost: 1 }]).expect(400);
      await createPo(a, supOk.id, [{ quantity: 1, unitCost: 1 }]).expect(400);
      await createPo(a, supOk.id, [line, line]).expect(400);
      await createPo(a, supOk.id, []).expect(400);
      await createPo(a, supOk.id, [line], { expectedAt: '2026-13-45' }).expect(400);
      await createPo(a, supOk.id, [{ ingredientId: ing.id, quantity: 0, unitCost: 1 }]).expect(400);
      await createPo(a, supOk.id, [{ ingredientId: ing.id, quantity: 1, unitCost: 1.00001 }]).expect(400);
    });
  });

  describe('state machine (compare-and-swap)', () => {
    it('draft lines are editable and totals recomputed; not once sent', async () => {
      const sup = await supplier(a);
      const ing = await f.createIngredient(a, 'Daisy');
      const po = body<PoBody>(
        (await createPo(a, sup.id, [{ ingredientId: ing.id, quantity: 1, unitCost: 1 }]).expect(201)),
      );
      const edited = await r()
        .put(`/purchase-orders/${po.id}/lines`)
        .set(h(a.adminToken))
        .send({ lines: [{ ingredientId: ing.id, quantity: 10, unitCost: 1.5 }] })
        .expect(200);
      expect(body<PoBody>(edited).total).toBe('15');
      expect(body<PoBody>(edited).lines).toHaveLength(1);
      await r().post(`/purchase-orders/${po.id}/send`).set(h(a.adminToken)).expect(201);
      await r()
        .put(`/purchase-orders/${po.id}/lines`)
        .set(h(a.adminToken))
        .send({ lines: [{ ingredientId: ing.id, quantity: 99, unitCost: 1 }] })
        .expect(409);
    });

    it('send is a CAS: twice is 409, two concurrent sends have exactly one winner', async () => {
      const sup = await supplier(a);
      const ing = await f.createIngredient(a, 'Aster');
      const mk = async () =>
        body<PoBody>(await createPo(a, sup.id, [{ ingredientId: ing.id, quantity: 1, unitCost: 1 }]).expect(201));
      const p1 = await mk();
      await r().post(`/purchase-orders/${p1.id}/send`).set(h(a.adminToken)).expect(201);
      await r().post(`/purchase-orders/${p1.id}/send`).set(h(a.adminToken)).expect(409);
      const p2 = await mk();
      const res = await Promise.all([
        r().post(`/purchase-orders/${p2.id}/send`).set(h(a.adminToken)),
        r().post(`/purchase-orders/${p2.id}/send`).set(h(a.adminToken)),
      ]);
      expect(res.map((x) => x.status).sort()).toEqual([201, 409]);
    });

    it('cancel: allowed from draft and sent, a 409 after a partial receipt or once cancelled', async () => {
      const sup = await supplier(a);
      const ing = await f.createIngredient(a, 'Moss');
      const draft = body<PoBody>(
        (await createPo(a, sup.id, [{ ingredientId: ing.id, quantity: 1, unitCost: 1 }]).expect(201)),
      );
      const c1 = await r().post(`/purchase-orders/${draft.id}/cancel`).set(h(a.adminToken)).expect(201);
      expect(body<PoBody>(c1).status).toBe('cancelled');
      await r().post(`/purchase-orders/${draft.id}/cancel`).set(h(a.adminToken)).expect(409);
      await r().post(`/purchase-orders/${draft.id}/send`).set(h(a.adminToken)).expect(409);
      await receive(a, draft.id, [{ lineId: draft.lines[0].id, quantity: 1 }]).expect(409);

      const { po, lineId } = await sentPo(a, 5);
      await r().post(`/purchase-orders/${po.id}/cancel`).set(h(a.adminToken)).expect(201);

      const partial = await sentPo(a, 5);
      await receive(a, partial.po.id, [{ lineId: partial.lineId, quantity: 2 }]).expect(201);
      const refused = await r().post(`/purchase-orders/${partial.po.id}/cancel`).set(h(a.adminToken)).expect(409);
      expect(JSON.stringify(refused.body)).toMatch(/already been received/);
      expect(lineId).toBeGreaterThan(0);
    });

    it('a draft cannot be received', async () => {
      const sup = await supplier(a);
      const ing = await f.createIngredient(a, 'Ivy');
      const po = body<PoBody>(
        (await createPo(a, sup.id, [{ ingredientId: ing.id, quantity: 3, unitCost: 1 }]).expect(201)),
      );
      await receive(a, po.id, [{ lineId: po.lines[0].id, quantity: 1 }]).expect(409);
      await conserved(a, ing.id, 0);
    });
  });

  describe('receiving', () => {
    it('posts stock and a PURCHASE_RECEIPT movement, partial then full, and the ledger is conserved', async () => {
      const { po, ing, lineId } = await sentPo(a, 10, 2);
      const r1 = body<ReceiveBody>(await receive(a, po.id, [{ lineId, quantity: 4 }]).expect(201));
      expect(r1.purchaseOrder.status).toBe('partially_received');
      expect(r1.purchaseOrder.lines[0].quantityReceived).toBe(4);
      await conserved(a, ing.id, 4);
      const r2 = body<ReceiveBody>(await receive(a, po.id, [{ lineId, quantity: 6 }]).expect(201));
      expect(r2.purchaseOrder.status).toBe('received');
      await conserved(a, ing.id, 10);
      const moves = await f.movements(a.outletId, ing.id, 'PURCHASE_RECEIPT');
      expect(moves.map((m) => m.delta as number)).toEqual([4, 6]);
      expect(moves[0].note).toContain(po.poNumber);
      // Once received, nothing more can be received or cancelled.
      await receive(a, po.id, [{ lineId, quantity: 1 }]).expect(409);
      await r().post(`/purchase-orders/${po.id}/cancel`).set(h(a.adminToken)).expect(409);
      // Each receipt line points at its ledger row.
      const detail = body<PoBody>(await r().get(`/purchase-orders/${po.id}`).set(h(a.adminToken)).expect(200));
      expect(detail.receipts).toHaveLength(2);
      expect(detail.receipts.every((x) => x.lines.every((l) => l.stockMovementId !== null))).toBe(true);
    });

    it('over-receiving is a 409 and posts nothing', async () => {
      const { po, ing, lineId } = await sentPo(a, 5);
      await receive(a, po.id, [{ lineId, quantity: 6 }]).expect(409);
      await conserved(a, ing.id, 0);
      await receive(a, po.id, [{ lineId, quantity: 5 }]).expect(201);
      await conserved(a, ing.id, 5);
    });

    it('a multi-line receive is all-or-nothing: one over-cap line rolls the whole receipt back', async () => {
      const sup = await supplier(a);
      const i1 = await f.createIngredient(a, 'M1');
      const i2 = await f.createIngredient(a, 'M2');
      const po = body<PoBody>(
        (await createPo(a, sup.id, [
          { ingredientId: i1.id, quantity: 5, unitCost: 1 },
          { ingredientId: i2.id, quantity: 2, unitCost: 1 },
        ]).expect(201)),
      );
      await r().post(`/purchase-orders/${po.id}/send`).set(h(a.adminToken)).expect(201);
      await receive(a, po.id, [
        { lineId: po.lines[0].id, quantity: 5 },
        { lineId: po.lines[1].id, quantity: 3 },
      ]).expect(409);
      await conserved(a, i1.id, 0);
      await conserved(a, i2.id, 0);
      const d = body<PoBody>(await r().get(`/purchase-orders/${po.id}`).set(h(a.adminToken)).expect(200));
      expect(d.status).toBe('sent');
      expect(d.receipts).toHaveLength(0);
    });

    it('captures the unit cost AT RECEIPT and never recomputes it; the PO line and ingredient cost are untouched', async () => {
      const { po, ing, lineId } = await sentPo(a, 10, 2);
      await db.execute(`UPDATE ingredient SET costPerUnit = 9 WHERE id = ?`, [ing.id]);
      const res = body<ReceiveBody>(
        await receive(a, po.id, [{ lineId, quantity: 4, unitCost: 2.5 }]).expect(201),
      );
      const rec = res.purchaseOrder.receipts[0];
      expect(rec.lines[0].unitCost).toBe('2.5');
      expect(rec.total).toBe('10');
      expect(rec.currency).toBe('AED');
      // The ordered price on the PO line is frozen at its own value.
      expect(res.purchaseOrder.lines[0].unitCost).toBe('2');
      expect(res.purchaseOrder.lines[0].lineTotal).toBe('20');
      // A later ordinary receipt at the ordered price is its own captured figure.
      const res2 = body<ReceiveBody>(await receive(a, po.id, [{ lineId, quantity: 6 }]).expect(201));
      expect(res2.purchaseOrder.receipts[1].lines[0].unitCost).toBe('2');
      expect(res2.purchaseOrder.receipts[0].lines[0].unitCost).toBe('2.5');
      const ingRow = await db.query<RowDataPacket[]>(`SELECT costPerUnit FROM ingredient WHERE id = ?`, [ing.id]);
      expect(Number(ingRow[0].costPerUnit)).toBe(9);
    });

    it('receipt value is rounded by the PO currency (KWD 3 decimals)', async () => {
      const { po, lineId } = await sentPo(a, 3, 10.505, { supplierCurrency: 'KWD' });
      const res = body<ReceiveBody>(await receive(a, po.id, [{ lineId, quantity: 3 }]).expect(201));
      expect(res.purchaseOrder.receipts[0].total).toBe('31.515');
      expect(res.purchaseOrder.receipts[0].currency).toBe('KWD');
    });

    it('two concurrent receives of the full quantity: exactly one posts, stock +N once', async () => {
      const { po, ing, lineId } = await sentPo(a, 10);
      const res = await Promise.all([
        receive(a, po.id, [{ lineId, quantity: 10 }]),
        receive(a, po.id, [{ lineId, quantity: 10 }]),
      ]);
      expect(res.map((x) => x.status).sort()).toEqual([201, 409]);
      await conserved(a, ing.id, 10);
      expect((await f.movements(a.outletId, ing.id, 'PURCHASE_RECEIPT')).length).toBe(1);
    });

    it('concurrent partial receives (6 and 6 of 10): never exceed the cap, ledger exact', async () => {
      const { po, ing, lineId } = await sentPo(a, 10);
      const res = await Promise.all([
        receive(a, po.id, [{ lineId, quantity: 6 }]),
        receive(a, po.id, [{ lineId, quantity: 6 }]),
      ]);
      expect(res.map((x) => x.status).sort()).toEqual([201, 409]);
      await conserved(a, ing.id, 6);
    });

    it('concurrent partial receives that fit (4 and 6 of 10) both post and complete the order', async () => {
      const { po, ing, lineId } = await sentPo(a, 10);
      const res = await Promise.all([
        receive(a, po.id, [{ lineId, quantity: 4 }]),
        receive(a, po.id, [{ lineId, quantity: 6 }]),
      ]);
      expect(res.map((x) => x.status)).toEqual([201, 201]);
      await conserved(a, ing.id, 10);
      const d = body<PoBody>(await r().get(`/purchase-orders/${po.id}`).set(h(a.adminToken)).expect(200));
      expect(d.status).toBe('received');
    });

    it('an idempotency key makes a retried (even concurrent) receive a no-op returning the same receipt', async () => {
      const { po, ing, lineId } = await sentPo(a, 10);
      const key = `k-${f.uniq()}`;
      const res = await Promise.all([
        receive(a, po.id, [{ lineId, quantity: 10 }], { idempotencyKey: key }),
        receive(a, po.id, [{ lineId, quantity: 10 }], { idempotencyKey: key }),
      ]);
      expect(res.map((x) => x.status)).toEqual([201, 201]);
      const ids = res.map((x) => body<ReceiveBody>(x).receiptId);
      expect(ids[0]).toBe(ids[1]);
      expect(res.map((x) => body<ReceiveBody>(x).replayed).sort()).toEqual([false, true]);
      await conserved(a, ing.id, 10);
      // A later retry, after the order is fully received, still replays.
      const again = await receive(a, po.id, [{ lineId, quantity: 10 }], { idempotencyKey: key }).expect(201);
      expect(body<ReceiveBody>(again).replayed).toBe(true);
      await conserved(a, ing.id, 10);
    });

    it('receipt fields: delivery note ref and unknown line ids', async () => {
      const { po, lineId } = await sentPo(a, 3);
      const ok = await receive(a, po.id, [{ lineId, quantity: 1 }], { deliveryNoteRef: 'DN-77' }).expect(201);
      expect(JSON.stringify(ok.body)).toContain('DN-77');
      await receive(a, po.id, [{ lineId: 999999999, quantity: 1 }]).expect(404);
      await receive(a, po.id, [{ lineId, quantity: 1 }, { lineId, quantity: 1 }]).expect(400);
    });

    it('stays conserved when receipts mix with order consumption, and never touches the consumption record', async () => {
      const product = await f.stockedProduct(a, 0);
      const ing = (await f.shadowIngredientId(product.id))!;
      const sup = await supplier(a);
      const po = body<PoBody>(
        (await createPo(a, sup.id, [{ productId: product.id, quantity: 10, unitCost: 4 }]).expect(201)),
      );
      await r().post(`/purchase-orders/${po.id}/send`).set(h(a.adminToken)).expect(201);
      const countRecords = async () =>
        Number(
          (await db.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS c FROM orderstockconsumption WHERE shopId = ?`,
            [a.shopId],
          ))[0].c,
        );
      const before = await countRecords();
      await receive(a, po.id, [{ lineId: po.lines[0].id, quantity: 6 }]).expect(201);
      expect(await countRecords()).toBe(before);
      await conserved(a, ing, 6);

      const order = await f.adminOrder(a, [{ productId: product.id, quantity: 2 }]);
      await f.advance(a, order.id, 'confirmed');
      await conserved(a, ing, 4);
      await receive(a, po.id, [{ lineId: po.lines[0].id, quantity: 4 }]).expect(201);
      await conserved(a, ing, 8);
      // Cancelling the order gives back exactly what the ORDER took, not the receipts.
      await f.cancelOrder(a, order.id).expect(201);
      await conserved(a, ing, 10);
      expect((await f.movements(a.outletId, ing, 'PURCHASE_RECEIPT')).map((m) => m.delta as number)).toEqual([6, 4]);
      // The receipt line's movement carries the product (shadow ingredient rule).
      const m = (await f.movements(a.outletId, ing, 'PURCHASE_RECEIPT'))[0];
      expect(m.productId).toBe(product.id);
    });

    it('fires back-in-stock notifications on a 0 -> positive crossing', async () => {
      const product = await f.stockedProduct(a, 0);
      const email = `restock-${f.uniq()}@example.com`;
      await r().post('/notify-subscriptions').send({ productId: product.id, email }).expect(201);
      const sup = await supplier(a);
      const po = body<PoBody>(
        (await createPo(a, sup.id, [{ productId: product.id, quantity: 3, unitCost: 1 }]).expect(201)),
      );
      await r().post(`/purchase-orders/${po.id}/send`).set(h(a.adminToken)).expect(201);
      await receive(a, po.id, [{ lineId: po.lines[0].id, quantity: 3 }]).expect(201);
      const deadline = Date.now() + 8000;
      let notified = false;
      while (Date.now() < deadline && !notified) {
        const rows = await db.query<RowDataPacket[]>(
          `SELECT notifiedAt FROM notifysubscription WHERE productId = ? AND email = ?`,
          [product.id, email],
        );
        notified = rows[0]?.notifiedAt != null;
        if (!notified) await new Promise((res) => setTimeout(res, 100));
      }
      expect(notified).toBe(true);
    });
  });

  describe('roles, outlets and permissions', () => {
    it('order_manager has no purchasing access; unauthenticated is 401', async () => {
      await r().get('/purchase-orders').set(h(orderManagerToken)).expect(403);
      await r().post('/purchase-orders').set(h(orderManagerToken)).send({}).expect(403);
      await r().get('/purchase-orders').expect(401);
    });

    it('a branch user is pinned to their own outlet: creates there whatever outletId they send, and sees only theirs', async () => {
      const sup = await supplier(a);
      const ing = await f.createIngredient(a, 'Br');
      const line = [{ ingredientId: ing.id, quantity: 2, unitCost: 1 }];
      const own = body<PoBody>(
        (await createPo(a, sup.id, line, { outletId: outletA2 }, branchToken).expect(201)),
      );
      expect(own.outletId).toBe(a.outletId);
      // An admin raises one at the OTHER outlet.
      const other = body<PoBody>(
        (await createPo(a, sup.id, line, { outletId: outletA2 }).expect(201)),
      );
      expect(other.outletId).toBe(outletA2);
      // The branch user cannot read, edit, send, cancel or receive it: 404.
      await r().get(`/purchase-orders/${other.id}`).set(h(branchToken)).expect(404);
      await r().patch(`/purchase-orders/${other.id}`).set(h(branchToken)).send({ notes: 'x' }).expect(404);
      await r().put(`/purchase-orders/${other.id}/lines`).set(h(branchToken)).send({ lines: line }).expect(404);
      await r().post(`/purchase-orders/${other.id}/send`).set(h(branchToken)).expect(404);
      await r().post(`/purchase-orders/${other.id}/cancel`).set(h(branchToken)).expect(404);
      await receive(a, other.id, [{ lineId: other.lines[0].id, quantity: 1 }], {}, branchToken).expect(404);
      // Lists are filtered to their outlet even when they ask for the other one.
      const list = await r().get(`/purchase-orders?outletId=${outletA2}`).set(h(branchToken)).expect(200);
      const rows = body<{ data: { id: number; outletId: number }[] }>(list).data;
      expect(rows.every((x) => x.outletId === a.outletId)).toBe(true);
      expect(rows.some((x) => x.id === other.id)).toBe(false);
      // The branch user can run their own order end to end.
      await r().post(`/purchase-orders/${own.id}/send`).set(h(branchToken)).expect(201);
      await receive(a, own.id, [{ lineId: own.lines[0].id, quantity: 2 }], {}, branchToken).expect(201);
      // Admin sees both outlets.
      const all = await r().get('/purchase-orders?pageSize=100').set(h(a.adminToken)).expect(200);
      const ids = body<{ data: { id: number }[] }>(all).data.map((x) => x.id);
      expect(ids).toEqual(expect.arrayContaining([own.id, other.id]));
    });

    it('a per-outlet branch role can only restrict: without purchase_orders.receive the receive is 403', async () => {
      const { po, lineId } = await sentPo(a, 2);
      const role = await r()
        .post('/shop/branch-roles')
        .set(h(a.adminToken))
        .send({ name: `po-viewer-${f.uniq()}`, permissions: ['purchase_orders.view'] })
        .expect(201);
      await r()
        .post('/shop/branch-roles/assignments')
        .set(h(a.adminToken))
        .send({ userId: branchUserId, outletId: a.outletId, branchRoleId: body<{ id: number }>(role).id })
        .expect(201);
      await r().get(`/purchase-orders/${po.id}`).set(h(branchToken)).expect(200);
      await receive(a, po.id, [{ lineId, quantity: 1 }], {}, branchToken).expect(403);
      await r().post(`/purchase-orders/${po.id}/cancel`).set(h(branchToken)).expect(403);
      // An admin is unaffected.
      await receive(a, po.id, [{ lineId, quantity: 1 }]).expect(201);
      // Clean up the assignment so later tests see a plain branch user.
      await r()
        .delete(`/shop/branch-roles/assignments/${branchUserId}/${a.outletId}`)
        .set(h(a.adminToken))
        .expect(200);
    });
  });

  describe('references', () => {
    it('deleting a supplier used on a PO archives it instead; an outlet with POs cannot be deleted', async () => {
      const { po, sup } = await sentPo(a, 1);
      const res = await r().delete(`/suppliers/${sup.id}`).set(h(a.adminToken)).expect(200);
      expect(body<{ deleted: boolean; archived: boolean }>(res)).toMatchObject({ deleted: false, archived: true });
      const still = await r().get(`/suppliers/${sup.id}`).set(h(a.adminToken)).expect(200);
      expect(body<{ status: string }>(still).status).toBe('archived');
      // The archived supplier cannot take a NEW PO, but this one can still be received.
      const ing = await f.createIngredient(a, 'Arch');
      await createPo(a, sup.id, [{ ingredientId: ing.id, quantity: 1, unitCost: 1 }]).expect(409);
      await receive(a, po.id, [{ lineId: po.lines[0].id, quantity: 1 }]).expect(201);

      const o = await r().post('/outlets').set(h(a.adminToken)).send({ name: `PO outlet ${f.uniq()}` }).expect(201);
      const oid = body<{ id: number }>(o).id;
      const sup2 = await supplier(a);
      await createPo(a, sup2.id, [{ ingredientId: ing.id, quantity: 1, unitCost: 1 }], { outletId: oid }).expect(201);
      await r().delete(`/outlets/${oid}`).set(h(a.adminToken)).expect(409);
    });
  });

  describe('cross-tenant: shop B cannot touch shop A purchase orders', () => {
    it('404s on every endpoint, and cannot smuggle A ids into its own order', async () => {
      const { po, lineId, ing } = await sentPo(a, 5);
      const hb = h(b.adminToken);
      await r().get(`/purchase-orders/${po.id}`).set(hb).expect(404);
      await r().patch(`/purchase-orders/${po.id}`).set(hb).send({ notes: 'x' }).expect(404);
      await r().put(`/purchase-orders/${po.id}/lines`).set(hb).send({ lines: [{ ingredientId: 1, quantity: 1, unitCost: 1 }] }).expect(404);
      await r().post(`/purchase-orders/${po.id}/send`).set(hb).expect(404);
      await r().post(`/purchase-orders/${po.id}/cancel`).set(hb).expect(404);
      await receive(b, po.id, [{ lineId, quantity: 1 }]).expect(404);

      // B's own PO, A's line id on the receive: the line is foreign.
      const supB = await supplier(b);
      const ingB = await f.createIngredient(b, 'X');
      const poB = body<PoBody>(
        (await createPo(b, supB.id, [{ ingredientId: ingB.id, quantity: 1, unitCost: 1 }]).expect(201)),
      );
      await r().post(`/purchase-orders/${poB.id}/send`).set(hb).expect(201);
      await receive(b, poB.id, [{ lineId, quantity: 1 }]).expect(404);

      const listB = await r().get('/purchase-orders?pageSize=100').set(hb).expect(200);
      expect(body<{ data: { id: number }[] }>(listB).data.some((x) => x.id === po.id)).toBe(false);
      // A's order is untouched.
      await conserved(a, ing.id, 0);
      const d = body<PoBody>(await r().get(`/purchase-orders/${po.id}`).set(h(a.adminToken)).expect(200));
      expect(d.status).toBe('sent');
    });
  });
});
