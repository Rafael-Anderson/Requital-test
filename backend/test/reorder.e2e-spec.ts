import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { bootApp, makeFixtures, body } from './helpers/w5-fixture';
import { createStaff } from './helpers/staff-login';

jest.setTimeout(240000);

interface Group {
  outletId: number;
  supplierId: number;
  supplierName: string;
  currency: string;
  subtotal: number;
  belowMinimumOrderAmount: boolean;
  lines: { ingredientId: number; quantity: number; unitCost: string; lineTotal: number; priceComparable: boolean }[];
}
interface Suggestions {
  groups: Group[];
  noSupplier: { outletId: number; ingredientId: number; reason: string }[];
}
interface LowStock {
  data: { outletId: number; ingredientId: number; stock: number; onOrder: number; position: number; covered: boolean; reorderPoint: number }[];
}
interface Created {
  created: { id: number; supplierId: number; currency: string; subtotal: number; lines: number }[];
}

// INV-5: reorder points, the low-stock list and suggested draft purchase orders.
describe('Reorder points and suggested POs (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let a: Awaited<ReturnType<typeof f.setupShop>>;
  let b: Awaited<ReturnType<typeof f.setupShop>>;
  let outletA2: number;
  let branch: { token: string; userId: number };
  let orderManagerToken: string;

  const h = (t: string) => ({ Authorization: `Bearer ${t}` });
  const r = () => request(app.getHttpServer());
  type Shop = typeof a;

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
    a = await f.setupShop('rop-a');
    b = await f.setupShop('rop-b');
    outletA2 = body<{ id: number }>(
      await r().post('/outlets').set(h(a.adminToken)).send({ name: `A2 ${f.runId}` }).expect(201),
    ).id;
    branch = await createStaff(app, a.adminToken, 'rop', 'branch', a.outletId);
    orderManagerToken = (await createStaff(app, a.adminToken, 'ropom', 'order_manager')).token;
  });
  afterAll(async () => {
    await app.close();
  });

  const setPoint = (token: string, payload: object) => r().put('/reorder/points').set(h(token)).send(payload);
  const point = (shop: Shop, ingredientId: number, reorderPoint: number | null, reorderQuantity: number | null, outletId = shop.outletId) =>
    setPoint(shop.adminToken, { ingredientId, outletId, reorderPoint, reorderQuantity });
  const supplier = async (shop: Shop, extra: object = {}) =>
    body<{ id: number }>(
      await r().post('/suppliers').set(h(shop.adminToken)).send({ name: `Sup ${f.uniq()}`, currency: 'AED', ...extra }).expect(201),
    ).id;
  const item = (shop: Shop, supplierId: number, ingredientId: number, payload: object) =>
    r().put(`/suppliers/${supplierId}/items/${ingredientId}`).set(h(shop.adminToken)).send(payload).expect(200);
  const suggestions = async (shop: Shop, outletId = shop.outletId, token = shop.adminToken) =>
    body<Suggestions>(await r().get(`/reorder/suggestions?outletId=${outletId}`).set(h(token)).expect(200));
  const draftPos = (token: string, payload: object) => r().post('/reorder/suggestions/draft-pos').set(h(token)).send(payload);
  const groupFor = (s: Suggestions, supplierId: number, currency?: string) =>
    s.groups.find((g) => g.supplierId === supplierId && (currency === undefined || g.currency === currency));

  // A fresh ingredient with stock, a reorder point and quantity at the shop's outlet.
  async function needed(shop: Shop, stock: number, rp: number | null, rq: number | null) {
    const ing = await f.createIngredient(shop, 'Rose');
    if (stock > 0) await f.stockIngredient(shop, ing.id, stock);
    if (rp !== null || rq !== null) await point(shop, ing.id, rp, rq).expect(200);
    return ing;
  }

  describe('set / clear', () => {
    it('is admin only, audit-logged, validated, and creates the stock row at 0 without a movement', async () => {
      const ing = await f.createIngredient(a, 'Fern');
      const payload = { ingredientId: ing.id, outletId: a.outletId, reorderPoint: 5, reorderQuantity: 20 };
      await setPoint(branch.token, payload).expect(403);
      await setPoint(orderManagerToken, payload).expect(403);
      await r().put('/reorder/points').send(payload).expect(401);
      await setPoint(a.adminToken, { ...payload, reorderPoint: -1 }).expect(400);
      await setPoint(a.adminToken, { ...payload, reorderQuantity: 0 }).expect(400);
      await setPoint(a.adminToken, { ingredientId: ing.id, outletId: a.outletId, reorderQuantity: 20 }).expect(400); // omitted point is not "clear"
      await setPoint(a.adminToken, { ...payload, extra: 1 }).expect(400);
      expect(body(await setPoint(a.adminToken, payload).expect(200))).toMatchObject({ reorderPoint: 5, reorderQuantity: 20 });
      const row = await db.query<RowDataPacket[]>(
        `SELECT stockQuantity, reorderPoint, reorderQuantity FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
        [a.outletId, ing.id],
      );
      expect(row[0]).toMatchObject({ stockQuantity: 0, reorderPoint: 5, reorderQuantity: 20 });
      expect(await f.ledgerSum(a.outletId, ing.id)).toBe(0);
      const audit = await db.query<RowDataPacket[]>(
        `SELECT actorUserId FROM auditlog WHERE shopId = ? AND action = 'reorder_point.set' AND entityId = ?`,
        [a.shopId, ing.id],
      );
      expect(audit.length).toBe(1);
      // clearing is explicit null and goes back to NULL, not 0
      await point(a, ing.id, null, null).expect(200);
      const cleared = await db.query<RowDataPacket[]>(
        `SELECT reorderPoint, reorderQuantity FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
        [a.outletId, ing.id],
      );
      expect(cleared[0]).toMatchObject({ reorderPoint: null, reorderQuantity: null });
    });

    it('cannot cross tenants: another shop outlet or ingredient is refused and nothing is written', async () => {
      const ingA = await f.createIngredient(a, 'Iris');
      const ingB = await f.createIngredient(b, 'Iris');
      await setPoint(a.adminToken, { ingredientId: ingA.id, outletId: b.outletId, reorderPoint: 1, reorderQuantity: 1 }).expect(400);
      await setPoint(a.adminToken, { ingredientId: ingB.id, outletId: a.outletId, reorderPoint: 1, reorderQuantity: 1 }).expect(404);
      await setPoint(b.adminToken, { ingredientId: ingA.id, outletId: b.outletId, reorderPoint: 1, reorderQuantity: 1 }).expect(404);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM outletingredientstock WHERE ingredientId IN (?, ?) AND reorderPoint IS NOT NULL`,
        [ingA.id, ingB.id],
      );
      expect(Number(rows[0].c)).toBe(0);
    });

    it('accepts a plain product (through its shadow ingredient) and refuses a recipe product', async () => {
      const p = await f.createProduct(a);
      await setPoint(a.adminToken, { productId: p.id, outletId: a.outletId, reorderPoint: 2, reorderQuantity: 6 }).expect(200);
      const shadow = (await f.shadowIngredientId(p.id)) as number;
      const row = await db.query<RowDataPacket[]>(
        `SELECT reorderPoint FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
        [a.outletId, shadow],
      );
      expect(row[0].reorderPoint).toBe(2);
      await setPoint(a.adminToken, { productId: 999999999, outletId: a.outletId, reorderPoint: 2, reorderQuantity: 6 }).expect(404);
    });

    it('does not touch lowStockThreshold (a separate column with a separate meaning)', async () => {
      const ing = await f.createIngredient(a, 'Thr');
      await r().patch('/products/stock/threshold').set(h(a.adminToken)).send({ ingredientId: ing.id, outletId: a.outletId, lowStockThreshold: 7 }).expect(200);
      await point(a, ing.id, 3, 10).expect(200);
      const row = await db.query<RowDataPacket[]>(
        `SELECT lowStockThreshold, reorderPoint FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
        [a.outletId, ing.id],
      );
      expect(row[0]).toMatchObject({ lowStockThreshold: 7, reorderPoint: 3 });
    });
  });

  describe('low-stock list', () => {
    it('lists only rows at or below their own point; no point means not listed; 0 is a real point', async () => {
      const below = await needed(a, 2, 5, 10);
      const at = await needed(a, 5, 5, 10);
      const above = await needed(a, 6, 5, 10);
      const none = await needed(a, 0, null, null);
      const zero = await needed(a, 0, 0, 4);
      const ids = body<LowStock>(await r().get(`/reorder/low-stock?outletId=${a.outletId}`).set(h(a.adminToken)).expect(200)).data.map((x) => x.ingredientId);
      expect(ids).toEqual(expect.arrayContaining([below.id, at.id, zero.id]));
      expect(ids).not.toContain(above.id);
      expect(ids).not.toContain(none.id);
    });

    it('nets quantity already on open orders (draft, sent, partially received) but not received, cancelled', async () => {
      const ing = await needed(a, 1, 5, 10);
      const sup = await supplier(a);
      const mk = async (qty: number, send: boolean) => {
        const po = body<{ id: number; lines: { id: number }[] }>(
          await r().post('/purchase-orders').set(h(a.adminToken)).send({ supplierId: sup, outletId: a.outletId, lines: [{ ingredientId: ing.id, quantity: qty, unitCost: 1 }] }).expect(201),
        );
        if (send) await r().post(`/purchase-orders/${po.id}/send`).set(h(a.adminToken)).expect(201);
        return po;
      };
      const row = async () => body<LowStock>(await r().get(`/reorder/low-stock?outletId=${a.outletId}`).set(h(a.adminToken)).expect(200)).data.find((x) => x.ingredientId === ing.id);
      expect(await row()).toMatchObject({ onOrder: 0, covered: false });
      await mk(3, false); // draft
      expect(await row()).toMatchObject({ onOrder: 3, position: 4, covered: false });
      const sent = await mk(4, true);
      expect((await row())?.onOrder).toBe(7);
      // receive 2 of the sent one: outstanding falls to 2 but stock rises by 2
      await r().post(`/purchase-orders/${sent.id}/receive`).set(h(a.adminToken)).send({ lines: [{ lineId: sent.lines[0].id, quantity: 2 }] }).expect(201);
      expect(await row()).toMatchObject({ stock: 3, onOrder: 5, position: 8, covered: true });
      const cancelled = await mk(50, true);
      await r().post(`/purchase-orders/${cancelled.id}/cancel`).set(h(a.adminToken)).expect(201);
      expect((await row())?.onOrder).toBe(5);
    });

    it('is shop and outlet scoped: B never sees A, a branch user only its outlet, a restricting role gets 403', async () => {
      const inA = await needed(a, 0, 5, 10);
      const inB = await needed(b, 0, 5, 10);
      const adminB = body<LowStock>(await r().get('/reorder/low-stock').set(h(b.adminToken)).expect(200)).data.map((x) => x.ingredientId);
      expect(adminB).toContain(inB.id);
      expect(adminB).not.toContain(inA.id);
      await r().get(`/reorder/low-stock?outletId=${a.outletId}`).set(h(b.adminToken)).expect(400);
      // a point at the second outlet is invisible to the first outlet's branch user, even if it asks for it
      const second = await f.createIngredient(a, 'Second');
      await point(a, second.id, 5, 10, outletA2).expect(200);
      const viaBranch = body<LowStock>(await r().get(`/reorder/low-stock?outletId=${outletA2}`).set(h(branch.token)).expect(200)).data;
      expect(viaBranch.every((x) => x.outletId === a.outletId)).toBe(true);
      expect(viaBranch.map((x) => x.ingredientId)).not.toContain(second.id);
      const all = body<LowStock>(await r().get('/reorder/low-stock').set(h(a.adminToken)).expect(200)).data;
      expect(all.map((x) => x.ingredientId)).toEqual(expect.arrayContaining([inA.id, second.id]));
      await r().get('/reorder/low-stock').set(h(orderManagerToken)).expect(403);
      const role = body<{ id: number }>(
        await r().post('/shop/branch-roles').set(h(a.adminToken)).send({ name: `rop-none-${f.uniq()}`, permissions: ['products.view'] }).expect(201),
      );
      await r().post('/shop/branch-roles/assignments').set(h(a.adminToken)).send({ userId: branch.userId, outletId: a.outletId, branchRoleId: role.id }).expect(201);
      await r().get('/reorder/low-stock').set(h(branch.token)).expect(403);
      await r().get('/reorder/suggestions').set(h(branch.token)).expect(403);
      await draftPos(branch.token, { outletId: a.outletId }).expect(403);
      await r().delete(`/shop/branch-roles/assignments/${branch.userId}/${a.outletId}`).set(h(a.adminToken)).expect(200);
    });
  });

  describe('suggestions', () => {
    it('quantity: whole multiples of the reorder quantity until above the point, raised to the supplier minimum', async () => {
      const ing = await needed(a, 0, 10, 4); // need 11 -> 12
      const sup = await supplier(a, { currency: 'AED' });
      await item(a, sup, ing.id, { unitCost: 2.5, currency: 'AED' });
      const g = groupFor(await suggestions(a), sup);
      expect(g?.lines).toEqual([expect.objectContaining({ ingredientId: ing.id, quantity: 12, unitCost: '2.5', lineTotal: 30 })]);
      expect(g?.subtotal).toBe(30);
      await item(a, sup, ing.id, { unitCost: 2.5, currency: 'AED', minOrderQty: 50 });
      expect(groupFor(await suggestions(a), sup)?.lines[0].quantity).toBe(50);
    });

    it('picks the cheapest supplier within one currency and never compares across currencies', async () => {
      const ing = await needed(a, 0, 5, 5);
      const cheap = await supplier(a);
      const dear = await supplier(a);
      await item(a, cheap, ing.id, { unitCost: 1, currency: 'AED' });
      await item(a, dear, ing.id, { unitCost: 3, currency: 'AED' });
      let s = await suggestions(a);
      expect(groupFor(s, cheap)?.lines.map((l) => l.ingredientId)).toContain(ing.id);
      expect(groupFor(s, dear)?.lines.map((l) => l.ingredientId) ?? []).not.toContain(ing.id);
      // a KWD supplier with a numerically tiny price is not "cheaper": prices are not comparable
      const kwd = await supplier(a, { currency: 'KWD', leadTimeDays: 1 });
      await item(a, kwd, ing.id, { unitCost: 0.1, currency: 'KWD', leadTimeDays: 1 });
      await item(a, cheap, ing.id, { unitCost: 1, currency: 'AED', leadTimeDays: 9 });
      s = await suggestions(a);
      const k = groupFor(s, kwd, 'KWD');
      expect(k?.lines.find((l) => l.ingredientId === ing.id)).toMatchObject({ priceComparable: false });
      expect(groupFor(s, cheap)?.lines.map((l) => l.ingredientId) ?? []).not.toContain(ing.id);
    });

    it('splits one supplier priced in two currencies into two suggestions, KWD to 3 decimals', async () => {
      const i1 = await needed(a, 0, 2, 3); // need 3 -> 3
      const i2 = await needed(a, 0, 2, 3);
      const sup = await supplier(a, { currency: 'KWD' });
      await item(a, sup, i1.id, { unitCost: 10.505, currency: 'KWD' });
      await item(a, sup, i2.id, { unitCost: 4.1, currency: 'AED' });
      const s = await suggestions(a);
      const k = groupFor(s, sup, 'KWD');
      const d = groupFor(s, sup, 'AED');
      expect(k?.lines).toHaveLength(1);
      expect(d?.lines).toHaveLength(1);
      expect(k?.subtotal).toBe(31.515);
      expect(d?.subtotal).toBe(12.3);
    });

    it('lists items with no supplier, an unpriced supplier item, no reorder quantity; skips archived suppliers', async () => {
      const none = await needed(a, 0, 5, 5);
      const unpriced = await needed(a, 0, 5, 5);
      const noQty = await needed(a, 0, 5, null);
      const archived = await needed(a, 0, 5, 5);
      const sup = await supplier(a);
      await item(a, sup, unpriced.id, { supplierSku: 'U-1' });
      const arch = await supplier(a);
      await item(a, arch, archived.id, { unitCost: 1, currency: 'AED' });
      await r().patch(`/suppliers/${arch}`).set(h(a.adminToken)).send({ status: 'archived' }).expect(200);
      const s = await suggestions(a);
      const reason = (id: number) => s.noSupplier.find((x) => x.ingredientId === id)?.reason;
      expect(reason(none.id)).toBe('no_supplier');
      expect(reason(unpriced.id)).toBe('unpriced_supplier_item');
      expect(reason(noQty.id)).toBe('no_reorder_quantity');
      expect(reason(archived.id)).toBe('no_supplier');
      expect(s.groups.flatMap((g) => g.lines.map((l) => l.ingredientId))).not.toEqual(expect.arrayContaining([none.id]));
    });

    it('does not leak across shops: B suppliers never price A items and B sees none of A', async () => {
      const ing = await needed(a, 0, 5, 5);
      const supB = await supplier(b);
      const ingB = await f.createIngredient(b, 'X');
      await item(b, supB, ingB.id, { unitCost: 1, currency: 'AED' });
      const sa = await suggestions(a);
      expect(sa.groups.find((g) => g.supplierId === supB)).toBeUndefined();
      expect(sa.noSupplier.find((x) => x.ingredientId === ing.id)).toBeDefined();
      const sb = await suggestions(b);
      expect(JSON.stringify(sb)).not.toContain(`"ingredientId":${ing.id},`);
      await r().get(`/reorder/suggestions?outletId=${a.outletId}`).set(h(b.adminToken)).expect(400);
    });

    it('stops suggesting once open orders cover the position', async () => {
      const ing = await needed(a, 0, 5, 5);
      const sup = await supplier(a);
      await item(a, sup, ing.id, { unitCost: 2, currency: 'AED' });
      expect(groupFor(await suggestions(a), sup)).toBeDefined();
      await r().post('/purchase-orders').set(h(a.adminToken)).send({ supplierId: sup, outletId: a.outletId, lines: [{ ingredientId: ing.id, quantity: 6, unitCost: 2 }] }).expect(201);
      expect(groupFor(await suggestions(a), sup)).toBeUndefined();
    });
  });

  describe('create draft POs', () => {
    async function scenario(shop: Shop) {
      const ing = await needed(shop, 0, 5, 7); // need 6 -> 7
      const sup = await supplier(shop, { currency: 'KWD' });
      await item(shop, sup, ing.id, { unitCost: 10.505, currency: 'KWD' });
      return { ing, sup };
    }

    it('creates a DRAFT (never sent) with the suggested lines, supplier currency, 3 dp KWD, and an audit row', async () => {
      const { ing, sup } = await scenario(a);
      const res = body<Created>(await draftPos(a.adminToken, { outletId: a.outletId, supplierId: sup }).expect(201));
      expect(res.created).toHaveLength(1);
      expect(res.created[0]).toMatchObject({ supplierId: sup, currency: 'KWD', subtotal: 73.535, lines: 1 });
      const po = body<{ status: string; sentAt: string | null; currency: string; lines: { ingredientId: number; quantityOrdered: number; unitCost: string; currency: string; lineTotal: string }[] }>(
        await r().get(`/purchase-orders/${res.created[0].id}`).set(h(a.adminToken)).expect(200),
      );
      expect(po).toMatchObject({ status: 'draft', sentAt: null, currency: 'KWD' });
      expect(po.lines[0]).toMatchObject({ ingredientId: ing.id, quantityOrdered: 7, unitCost: '10.505', currency: 'KWD', lineTotal: '73.535' });
      const audit = await db.query<RowDataPacket[]>(
        `SELECT id FROM auditlog WHERE shopId = ? AND action = 'purchase_order.created' AND entityId = ?`,
        [a.shopId, res.created[0].id],
      );
      expect(audit).toHaveLength(1);
    });

    it('is idempotent: repeating and racing the click creates the drafts once', async () => {
      const { sup } = await scenario(a);
      const results = await Promise.all([1, 2, 3, 4].map(() => draftPos(a.adminToken, { outletId: a.outletId, supplierId: sup })));
      expect(results.every((x) => x.status === 201)).toBe(true);
      const total = results.reduce((n, x) => n + body<Created>(x).created.length, 0);
      expect(total).toBe(1);
      const again = body<Created>(await draftPos(a.adminToken, { outletId: a.outletId, supplierId: sup }).expect(201));
      expect(again.created).toHaveLength(0);
      const pos = body<{ data: { id: number }[] }>(await r().get(`/purchase-orders?supplierId=${sup}`).set(h(a.adminToken)).expect(200));
      expect(pos.data).toHaveLength(1);
    });

    it('the supplierId filter only creates that supplier; another shop supplier id creates nothing', async () => {
      const s1 = await scenario(a);
      const s2 = await scenario(a);
      const supB = await supplier(b);
      expect(body<Created>(await draftPos(a.adminToken, { outletId: a.outletId, supplierId: supB }).expect(201)).created).toHaveLength(0);
      const one = body<Created>(await draftPos(a.adminToken, { outletId: a.outletId, supplierId: s1.sup }).expect(201));
      expect(one.created.map((c) => c.supplierId)).toEqual([s1.sup]);
      const rest = groupFor(await suggestions(a), s2.sup);
      expect(rest).toBeDefined();
      expect(groupFor(await suggestions(a), s1.sup)).toBeUndefined();
    });

    it('cannot cross tenants or outlets: B outlet 400, branch is forced to its own outlet', async () => {
      await draftPos(b.adminToken, { outletId: a.outletId }).expect(400);
      await draftPos(a.adminToken, { outletId: b.outletId }).expect(400);
      await draftPos(a.adminToken, {}).expect(400);
      await draftPos(orderManagerToken, { outletId: a.outletId }).expect(403);
      // a branch user at outlet A asking for outlet A2 gets A (A2 is untouched)
      const ing = await f.createIngredient(a, 'Pinned');
      await point(a, ing.id, 5, 5, outletA2).expect(200);
      const sup = await supplier(a);
      await item(a, sup, ing.id, { unitCost: 1, currency: 'AED' });
      const res = body<Created>(await draftPos(branch.token, { outletId: outletA2, supplierId: sup }).expect(201));
      expect(res.created).toHaveLength(0); // the branch outlet has nothing for this supplier
      const second = await suggestions(a, outletA2);
      expect(groupFor(second, sup)).toBeDefined(); // A2's need is still open
    });

    it('creates nothing for an item with no supplier or no reorder quantity, and writes no stock', async () => {
      const ing = await needed(a, 0, 5, null);
      const before = await f.ledgerSum(a.outletId, ing.id);
      const res = body<Created>(await draftPos(a.adminToken, { outletId: a.outletId }).expect(201));
      const lines = await db.query<RowDataPacket[]>(`SELECT id FROM purchaseorderline WHERE ingredientId = ?`, [ing.id]);
      expect(lines).toHaveLength(0);
      expect(res).toBeDefined();
      expect(await f.ledgerSum(a.outletId, ing.id)).toBe(before);
      expect(await f.stockOf(a.outletId, ing.id)).toBe(0);
    });
  });
});
