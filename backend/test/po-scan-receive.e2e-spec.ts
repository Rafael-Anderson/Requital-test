import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DatabaseService } from '../src/database/database.service';
import { bootApp, makeFixtures, body } from './helpers/w5-fixture';
import { createStaff } from './helpers/staff-login';

jest.setTimeout(240000);

interface PoBody {
  id: number;
  status: string;
  currency: string;
  lines: { id: number; ingredientId: number; quantityOrdered: number; quantityReceived: number }[];
  receipts: { lines: { quantity: number; unitCost: string; currency: string }[] }[];
}
interface ScanBody {
  line: { id: number; quantityOrdered: number };
  quantity: number;
  outstandingAfter: number;
}
const errBody = (res: request.Response) => res.body as { code?: string; message?: string };

// INV-3: scan-driven receive. The scan only RESOLVES; the tally is committed through
// POST :id/receive (the modal's path), so these tests also pin that the ledger
// invariants hold across mixed scan and modal receives.
describe('PO scan receive (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let a: Awaited<ReturnType<typeof f.setupShop>>;
  let b: Awaited<ReturnType<typeof f.setupShop>>;
  let outletA2: number;
  let branch: { token: string; userId: number };
  let branchOther: { token: string };
  let orderManagerToken: string;

  const h = (t: string) => ({ Authorization: `Bearer ${t}` });
  const r = () => request(app.getHttpServer());
  type Shop = typeof a;

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
    a = await f.setupShop('scan-a');
    b = await f.setupShop('scan-b');
    const o2 = await r().post('/outlets').set(h(a.adminToken)).send({ name: `A2 ${f.runId}` }).expect(201);
    outletA2 = body<{ id: number }>(o2).id;
    branch = await createStaff(app, a.adminToken, 'scan', 'branch', a.outletId);
    branchOther = await createStaff(app, a.adminToken, 'scan2', 'branch', outletA2);
    orderManagerToken = (await createStaff(app, a.adminToken, 'scanom', 'order_manager')).token;
  });
  afterAll(async () => {
    await app.close();
  });

  // A sent PO with one product line (barcode + sku) and one ingredient line (supplier SKU).
  async function openPo(shop: Shop, opts: { qtyP?: number; qtyI?: number; barcode?: string; outletId?: number; send?: boolean } = {}) {
    const barcode = opts.barcode ?? `BC${f.uniq()}`;
    const sku = `PSKU${f.uniq()}`;
    const product = await f.createProduct(shop, { barcode, sku });
    const ing = await f.createIngredient(shop, 'Stem');
    const supSku = `SUP${f.uniq()}`;
    const sup = body<{ id: number }>(
      await r().post('/suppliers').set(h(shop.adminToken)).send({ name: `S ${f.uniq()}`, currency: 'KWD' }).expect(201),
    );
    const res = await r()
      .post('/purchase-orders')
      .set(h(shop.adminToken))
      .send({
        supplierId: sup.id,
        outletId: opts.outletId ?? shop.outletId,
        lines: [
          { productId: product.id, quantity: opts.qtyP ?? 3, unitCost: 10.505 },
          { ingredientId: ing.id, quantity: opts.qtyI ?? 2, unitCost: 1.25, supplierSku: supSku },
        ],
      })
      .expect(201);
    const po = body<PoBody>(res);
    if (opts.send !== false) await r().post(`/purchase-orders/${po.id}/send`).set(h(shop.adminToken)).expect(201);
    const pIng = (await f.shadowIngredientId(product.id)) as number;
    return { po, product, barcode, sku, supSku, ing, pIng, pLine: po.lines.find((l) => l.ingredientId === pIng)!, iLine: po.lines.find((l) => l.ingredientId === ing.id)! };
  }

  const scan = (token: string, poId: number, payload: object) =>
    r().post(`/purchase-orders/${poId}/scan`).set(h(token)).send(payload);
  const receive = (token: string, poId: number, lines: object[], extra: object = {}) =>
    r().post(`/purchase-orders/${poId}/receive`).set(h(token)).send({ lines, ...extra });
  async function conserved(outletId: number, ingredientId: number, expected: number) {
    expect(await f.stockOf(outletId, ingredientId)).toBe(expected);
    expect(await f.ledgerSum(outletId, ingredientId)).toBe(expected);
  }

  describe('resolve', () => {
    it('matches a product barcode, the product SKU and a supplier SKU to the right line, case-insensitively', async () => {
      const x = await openPo(a);
      const byBarcode = body<ScanBody>((await scan(a.adminToken, x.po.id, { code: ` ${x.barcode.toLowerCase()} ` }).expect(201)));
      expect(byBarcode.line.id).toBe(x.pLine.id);
      expect(byBarcode).toMatchObject({ quantity: 1, outstandingAfter: 2 });
      expect(body<ScanBody>(await scan(a.adminToken, x.po.id, { code: x.sku }).expect(201)).line.id).toBe(x.pLine.id);
      expect(body<ScanBody>(await scan(a.adminToken, x.po.id, { code: x.supSku, quantity: 2 }).expect(201)).line.id).toBe(x.iLine.id);
      // resolving writes nothing
      await conserved(a.outletId, x.pIng, 0);
      const fresh = body<PoBody>(await r().get(`/purchase-orders/${x.po.id}`).set(h(a.adminToken)).expect(200));
      expect(fresh.lines.every((l) => l.quantityReceived === 0)).toBe(true);
    });

    it('an unknown code, an over-tally and a fully received line each give a 409 with a reason', async () => {
      const x = await openPo(a, { qtyP: 2 });
      const none = await scan(a.adminToken, x.po.id, { code: 'NOPE-123' }).expect(409);
      expect(errBody(none)).toMatchObject({ code: 'no_matching_line' });
      const over = await scan(a.adminToken, x.po.id, {
        code: x.barcode,
        pending: [{ lineId: x.pLine.id, quantity: 2 }],
      }).expect(409);
      expect(errBody(over)).toMatchObject({ code: 'exceeds_ordered' });
      // a tally for a DIFFERENT line does not count against this one
      await scan(a.adminToken, x.po.id, { code: x.barcode, pending: [{ lineId: x.iLine.id, quantity: 2 }] }).expect(201);
      await scan(a.adminToken, x.po.id, { code: x.barcode, quantity: 3 }).expect(409);
      await receive(a.adminToken, x.po.id, [{ lineId: x.pLine.id, quantity: 2 }]).expect(201);
      const done = await scan(a.adminToken, x.po.id, { code: x.barcode }).expect(409);
      expect(errBody(done)).toMatchObject({ code: 'line_fully_received' });
    });

    it('refuses a draft, a received and a cancelled order', async () => {
      const draft = await openPo(a, { send: false });
      await scan(a.adminToken, draft.po.id, { code: draft.barcode }).expect(409);
      const sent = await openPo(a);
      await r().post(`/purchase-orders/${sent.po.id}/cancel`).set(h(a.adminToken)).expect(201);
      await scan(a.adminToken, sent.po.id, { code: sent.barcode }).expect(409);
    });

    it('an ambiguous code (two lines with the same supplier SKU) is refused, never guessed', async () => {
      const x = await openPo(a);
      const dup = `DUP${f.uniq()}`;
      const ing2 = await f.createIngredient(a, 'Stem2');
      const sup = body<{ id: number }>(
        await r().post('/suppliers').set(h(a.adminToken)).send({ name: `S ${f.uniq()}`, currency: 'AED' }).expect(201),
      );
      const po = body<PoBody>(
        await r().post('/purchase-orders').set(h(a.adminToken)).send({
          supplierId: sup.id,
          outletId: a.outletId,
          lines: [
            { ingredientId: x.ing.id, quantity: 1, unitCost: 1, supplierSku: dup },
            { ingredientId: ing2.id, quantity: 1, unitCost: 1, supplierSku: dup },
          ],
        }).expect(201),
      );
      await r().post(`/purchase-orders/${po.id}/send`).set(h(a.adminToken)).expect(201);
      expect(errBody(await scan(a.adminToken, po.id, { code: dup }).expect(409))).toMatchObject({ code: 'ambiguous_code' });
    });

    it('validates the payload', async () => {
      const x = await openPo(a);
      await scan(a.adminToken, x.po.id, {}).expect(400);
      await scan(a.adminToken, x.po.id, { code: '   ' }).expect(400);
      await scan(a.adminToken, x.po.id, { code: 'x', quantity: 0 }).expect(400);
      await scan(a.adminToken, x.po.id, { code: 'x', extra: 1 }).expect(400);
    });
  });

  describe('permissions and isolation', () => {
    it('shop B cannot scan against A, and a B barcode never resolves on A (same code string in both shops)', async () => {
      const shared = `SHARED${f.uniq()}`;
      const xa = await openPo(a, { barcode: shared });
      const xb = await openPo(b, { barcode: shared });
      await scan(b.adminToken, xa.po.id, { code: shared }).expect(404);
      // each shop resolves the shared code to its OWN line only
      expect(body<ScanBody>(await scan(a.adminToken, xa.po.id, { code: shared }).expect(201)).line.id).toBe(xa.pLine.id);
      expect(body<ScanBody>(await scan(b.adminToken, xb.po.id, { code: shared }).expect(201)).line.id).toBe(xb.pLine.id);
      // and A's code is not found on B's PO when B's product has a different code
      const xb2 = await openPo(b);
      await scan(b.adminToken, xb2.po.id, { code: xa.barcode }).expect(409);
      // a B receive against A's order or A's line ids is refused and moves nothing
      await receive(b.adminToken, xa.po.id, [{ lineId: xa.pLine.id, quantity: 1 }]).expect(404);
      await receive(b.adminToken, xb.po.id, [{ lineId: xa.pLine.id, quantity: 1 }]).expect(404);
      await conserved(a.outletId, xa.pIng, 0);
    });

    it('a branch user is pinned to its outlet (404 for another outlet), order_manager is 403', async () => {
      const own = await openPo(a);
      const other = await openPo(a, { outletId: outletA2 });
      await scan(branch.token, own.po.id, { code: own.barcode }).expect(201);
      await scan(branch.token, other.po.id, { code: other.barcode }).expect(404);
      await scan(branchOther.token, own.po.id, { code: own.barcode }).expect(404);
      await receive(branch.token, other.po.id, [{ lineId: other.pLine.id, quantity: 1 }]).expect(404);
      await scan(orderManagerToken, own.po.id, { code: own.barcode }).expect(403);
      await r().post(`/purchase-orders/${own.po.id}/scan`).send({ code: 'x' }).expect(401);
    });

    it('a branch role without purchase_orders.receive cannot scan (403); an admin can', async () => {
      const x = await openPo(a);
      const role = body<{ id: number }>(
        await r().post('/shop/branch-roles').set(h(a.adminToken)).send({ name: `scan-view-${f.uniq()}`, permissions: ['purchase_orders.view'] }).expect(201),
      );
      await r().post('/shop/branch-roles/assignments').set(h(a.adminToken)).send({ userId: branch.userId, outletId: a.outletId, branchRoleId: role.id }).expect(201);
      await scan(branch.token, x.po.id, { code: x.barcode }).expect(403);
      await scan(a.adminToken, x.po.id, { code: x.barcode }).expect(201);
      await r().delete(`/shop/branch-roles/assignments/${branch.userId}/${a.outletId}`).set(h(a.adminToken)).expect(200);
    });
  });

  describe('commit through the receive path', () => {
    it('a scanned tally commits as one receipt: cost from the PO line, PO currency, ledger conserved, replay safe', async () => {
      const x = await openPo(a, { qtyP: 3, qtyI: 2 });
      // three scans of the barcode and one of the supplier SKU build the draft tally
      const tally = new Map<number, number>();
      for (const code of [x.barcode, x.barcode, x.barcode, x.supSku]) {
        const pending = [...tally].map(([lineId, quantity]) => ({ lineId, quantity }));
        const res = body<ScanBody>(await scan(a.adminToken, x.po.id, { code, pending }).expect(201));
        tally.set(res.line.id, (tally.get(res.line.id) ?? 0) + res.quantity);
      }
      // the fourth barcode scan would exceed the ordered 3
      await scan(a.adminToken, x.po.id, { code: x.barcode, pending: [...tally].map(([lineId, quantity]) => ({ lineId, quantity })) }).expect(409);
      const lines = [...tally].map(([lineId, quantity]) => ({ lineId, quantity }));
      const key = `scan-${f.uniq()}`;
      const first = await receive(a.adminToken, x.po.id, lines, { idempotencyKey: key }).expect(201);
      const again = await receive(a.adminToken, x.po.id, lines, { idempotencyKey: key }).expect(201);
      expect(body<{ replayed: boolean }>(first).replayed).toBe(false);
      expect(body<{ replayed: boolean }>(again).replayed).toBe(true);
      const po = body<{ purchaseOrder: PoBody }>(first).purchaseOrder;
      expect(po.status).toBe('partially_received');
      const rl = po.receipts[0].lines;
      expect(rl.find((l) => l.quantity === 3)).toMatchObject({ unitCost: '10.505', currency: 'KWD' });
      await conserved(a.outletId, x.pIng, 3);
      await conserved(a.outletId, x.ing.id, 1);
      const mv = await f.movements(a.outletId, x.pIng, 'PURCHASE_RECEIPT');
      expect(mv).toHaveLength(1);
    });

    it('mixed scan and modal receives keep SUM(stockmovement.delta) = outletingredientstock and finish the PO', async () => {
      const x = await openPo(a, { qtyP: 5, qtyI: 4 });
      await receive(a.adminToken, x.po.id, [{ lineId: x.pLine.id, quantity: 2 }]).expect(201); // modal
      const s = body<ScanBody>(await scan(a.adminToken, x.po.id, { code: x.barcode, quantity: 3 }).expect(201)); // scan, exactly the rest
      expect(s.outstandingAfter).toBe(0);
      await receive(a.adminToken, x.po.id, [{ lineId: s.line.id, quantity: 3 }], { idempotencyKey: `mix-${f.uniq()}` }).expect(201);
      await receive(a.adminToken, x.po.id, [{ lineId: x.iLine.id, quantity: 4 }]).expect(201); // modal
      const po = body<PoBody>(await r().get(`/purchase-orders/${x.po.id}`).set(h(a.adminToken)).expect(200));
      expect(po.status).toBe('received');
      await conserved(a.outletId, x.pIng, 5);
      await conserved(a.outletId, x.ing.id, 4);
      // nothing more can be scanned or received
      await scan(a.adminToken, x.po.id, { code: x.barcode }).expect(409);
      await receive(a.adminToken, x.po.id, [{ lineId: x.pLine.id, quantity: 1 }]).expect(409);
      await conserved(a.outletId, x.pIng, 5);
    });

    it('a commit that exceeds the ordered quantity is a 409 and posts nothing, even when the scan check was bypassed', async () => {
      const x = await openPo(a, { qtyP: 2 });
      await receive(a.adminToken, x.po.id, [{ lineId: x.pLine.id, quantity: 3 }]).expect(409);
      await receive(a.adminToken, x.po.id, [{ lineId: x.pLine.id, quantity: 2 }, { lineId: x.iLine.id, quantity: 9 }]).expect(409);
      await conserved(a.outletId, x.pIng, 0);
      await conserved(a.outletId, x.ing.id, 0);
    });

    it('two scans racing the last unit: exactly one wins, the loser is a 409, stock is +1 and conserved', async () => {
      const x = await openPo(a, { qtyP: 1, qtyI: 1 });
      const results = await Promise.all(
        [0, 1, 2, 3].map((i) => receive(a.adminToken, x.po.id, [{ lineId: x.pLine.id, quantity: 1 }], { idempotencyKey: `race-${f.uniq()}-${i}` })),
      );
      const statuses = results.map((res) => res.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(3);
      await conserved(a.outletId, x.pIng, 1);
      const po = body<PoBody>(await r().get(`/purchase-orders/${x.po.id}`).set(h(a.adminToken)).expect(200));
      expect(po.lines.find((l) => l.id === x.pLine.id)?.quantityReceived).toBe(1);
    });

    it('the same idempotency key racing itself posts once', async () => {
      const x = await openPo(a, { qtyP: 5 });
      const key = `same-${f.uniq()}`;
      const results = await Promise.all(
        [0, 1, 2].map(() => receive(a.adminToken, x.po.id, [{ lineId: x.pLine.id, quantity: 2 }], { idempotencyKey: key })),
      );
      expect(results.every((res) => res.status === 201)).toBe(true);
      await conserved(a.outletId, x.pIng, 2);
    });
  });
});
