import 'dotenv/config';
import { bootDriverFixture, body } from './helpers/driver-fixture';
import type { W5Shop } from './helpers/driver-fixture';

jest.setTimeout(300000);

describe('SHP-5 drivers and delivery runs (staff API)', () => {
  let fx: Awaited<ReturnType<typeof bootDriverFixture>>;
  let a: W5Shop;
  let b: W5Shop;
  let outlet2: number;

  beforeAll(async () => {
    fx = await bootDriverFixture();
    a = await fx.f.setupShop('drv-a');
    b = await fx.f.setupShop('drv-b');
    outlet2 = await fx.secondOutlet(a);
  });
  afterAll(async () => {
    await fx.app.close();
  });

  describe('drivers', () => {
    it('admin CRUD, validation and audit', async () => {
      const d = await fx.createDriver(a, { name: '  Omar  ' });
      expect(d.name).toBe('Omar');
      expect(d.active).toBe(true);
      await fx
        .r()
        .post('/drivers')
        .set(fx.h(a.adminToken))
        .send({ name: 'x', phone: 'abc', outletId: a.outletId })
        .expect(400);
      await fx
        .r()
        .post('/drivers')
        .set(fx.h(a.adminToken))
        .send({
          name: 'x',
          phone: '0501234567',
          outletId: a.outletId,
          active: false,
        })
        .expect(400);
      await fx
        .r()
        .post('/drivers')
        .set(fx.h(a.adminToken))
        .send({ name: 'x', phone: '0501234567' })
        .expect(400); // admin must pick an outlet
      const upd = await fx
        .r()
        .patch(`/drivers/${d.id}`)
        .set(fx.h(a.adminToken))
        .send({ phone: '0507654321' })
        .expect(200);
      expect(body<{ phone: string }>(upd).phone).toBe('0507654321');
      const list = await fx
        .r()
        .get('/drivers')
        .set(fx.h(a.adminToken))
        .expect(200);
      expect(body<{ id: number }[]>(list).some((x) => x.id === d.id)).toBe(
        true,
      );
      const log = await fx.row(
        `SELECT action FROM auditlog WHERE shopId = ? AND entityType = 'driver' AND entityId = ?`,
        [a.shopId, d.id],
      );
      expect(
        log.map((l) => (l as unknown as { action: string }).action),
      ).toEqual(expect.arrayContaining(['driver.created', 'driver.updated']));
    });

    it('a driver with no runs is deleted, one with runs is only deactivated', async () => {
      const gone = await fx.createDriver(a);
      const del = await fx
        .r()
        .delete(`/drivers/${gone.id}`)
        .set(fx.h(a.adminToken))
        .expect(200);
      expect(body(del)).toEqual({ deleted: true, deactivated: false });
      await fx
        .r()
        .get(`/drivers/${gone.id}`)
        .set(fx.h(a.adminToken))
        .expect(404);

      const kept = await fx.createDriver(a);
      await fx.createRun(a, kept.id);
      const del2 = await fx
        .r()
        .delete(`/drivers/${kept.id}`)
        .set(fx.h(a.adminToken))
        .expect(200);
      expect(body(del2)).toEqual({ deleted: false, deactivated: true });
      const still = await fx
        .r()
        .get(`/drivers/${kept.id}`)
        .set(fx.h(a.adminToken))
        .expect(200);
      expect(body<{ active: boolean }>(still).active).toBe(false);
    });

    it('is tenant isolated on every endpoint', async () => {
      const d = await fx.createDriver(a);
      await fx.r().get(`/drivers/${d.id}`).set(fx.h(b.adminToken)).expect(404);
      await fx
        .r()
        .patch(`/drivers/${d.id}`)
        .set(fx.h(b.adminToken))
        .send({ name: 'hijack' })
        .expect(404);
      await fx
        .r()
        .delete(`/drivers/${d.id}`)
        .set(fx.h(b.adminToken))
        .expect(404);
      const list = await fx
        .r()
        .get('/drivers')
        .set(fx.h(b.adminToken))
        .expect(200);
      expect(body<{ id: number }[]>(list).some((x) => x.id === d.id)).toBe(
        false,
      );
      // creating at a foreign outlet is refused
      await fx
        .r()
        .post('/drivers')
        .set(fx.h(b.adminToken))
        .send({ name: 'x', phone: '0501234567', outletId: a.outletId })
        .expect(400);
      // still intact
      const after = await fx
        .r()
        .get(`/drivers/${d.id}`)
        .set(fx.h(a.adminToken))
        .expect(200);
      expect(body<{ name: string }>(after).name).toBe(d.name);
    });

    it('pins a branch user to its own outlet and keeps order_manager/viewer out', async () => {
      const branch = await fx.createStaff(
        fx.app,
        a.adminToken,
        'drvbranch',
        'branch',
        a.outletId,
      );
      // outletId in the body is ignored for a branch user
      const mine = await fx
        .r()
        .post('/drivers')
        .set(fx.h(branch.token))
        .send({ name: 'Mine', phone: '0501234567', outletId: outlet2 })
        .expect(201);
      expect(body<{ outletId: number }>(mine).outletId).toBe(a.outletId);
      // a driver at the other outlet is a 404 for the branch user, and absent from its list
      const other = await fx.createDriver(a, { outletId: outlet2 });
      await fx
        .r()
        .get(`/drivers/${other.id}`)
        .set(fx.h(branch.token))
        .expect(404);
      await fx
        .r()
        .patch(`/drivers/${other.id}`)
        .set(fx.h(branch.token))
        .send({ name: 'x' })
        .expect(404);
      const list = await fx
        .r()
        .get(`/drivers?outletId=${outlet2}`)
        .set(fx.h(branch.token))
        .expect(200);
      expect(
        body<{ outletId: number }[]>(list).every(
          (x) => x.outletId === a.outletId,
        ),
      ).toBe(true);

      for (const role of ['order_manager', 'viewer'] as const) {
        const s = await fx.createStaff(
          fx.app,
          a.adminToken,
          `drv${role}`,
          role,
        );
        await fx.r().get('/drivers').set(fx.h(s.token)).expect(403);
        await fx
          .r()
          .post('/drivers')
          .set(fx.h(s.token))
          .send({ name: 'x', phone: '0501234567', outletId: a.outletId })
          .expect(403);
        await fx.r().get('/delivery-runs').set(fx.h(s.token)).expect(403);
      }
    });

    it('a restrict-only branch role without deliveries.* is refused at its outlet', async () => {
      const staff = await fx.createStaff(
        fx.app,
        a.adminToken,
        'drvrole',
        'branch',
        a.outletId,
      );
      const role = body<{ id: number }>(
        await fx
          .r()
          .post('/shop/branch-roles')
          .set(fx.h(a.adminToken))
          .send({ name: `no-del-${fx.f.uniq()}`, permissions: ['orders.view'] })
          .expect(201),
      );
      await fx
        .r()
        .post('/shop/branch-roles/assignments')
        .set(fx.h(a.adminToken))
        .send({
          userId: staff.userId,
          outletId: a.outletId,
          branchRoleId: role.id,
        })
        .expect(201);
      await fx.r().get('/drivers').set(fx.h(staff.token)).expect(403);
      await fx
        .r()
        .post('/drivers')
        .set(fx.h(staff.token))
        .send({ name: 'x', phone: '0501234567' })
        .expect(403);
      await fx.r().get('/delivery-runs').set(fx.h(staff.token)).expect(403);
      const d = await fx.createDriver(a);
      await fx.r().get(`/drivers/${d.id}`).set(fx.h(staff.token)).expect(403);
    });
  });

  describe('runs', () => {
    it('builds a run from the ready queue, reorders, removes and dispatches through the order state machine', async () => {
      const driver = await fx.createDriver(a);
      const o1 = await fx.deliveryOrder(a);
      const o2 = await fx.deliveryOrder(a);
      const o3 = await fx.deliveryOrder(a, { status: 'out_for_delivery' });

      const ready = await fx
        .r()
        .get(`/delivery-runs/ready-orders?outletId=${a.outletId}`)
        .set(fx.h(a.adminToken))
        .expect(200);
      const readyIds = body<{ id: number }[]>(ready).map((x) => x.id);
      expect(readyIds).toEqual(expect.arrayContaining([o1.id, o2.id, o3.id]));

      const run = await fx.createRun(a, driver.id, [o1.id, o2.id, o3.id]);
      expect(run.status).toBe('draft');
      expect(run.stops.map((s) => s.position)).toEqual([1, 2, 3]);

      // an order on a live run leaves the queue
      const ready2 = await fx
        .r()
        .get(`/delivery-runs/ready-orders?outletId=${a.outletId}`)
        .set(fx.h(a.adminToken))
        .expect(200);
      expect(body<{ id: number }[]>(ready2).some((x) => x.id === o1.id)).toBe(
        false,
      );

      // reorder: must be a permutation of every stop
      const ids = run.stops.map((s) => s.id);
      await fx
        .r()
        .put(`/delivery-runs/${run.id}/stops/order`)
        .set(fx.h(a.adminToken))
        .send({ stopIds: ids.slice(0, 2) })
        .expect(400);
      await fx
        .r()
        .put(`/delivery-runs/${run.id}/stops/order`)
        .set(fx.h(a.adminToken))
        .send({ stopIds: [...ids, 999999] })
        .expect(400);
      const reordered = await fx
        .r()
        .put(`/delivery-runs/${run.id}/stops/order`)
        .set(fx.h(a.adminToken))
        .send({ stopIds: [ids[2], ids[0], ids[1]] })
        .expect(200);
      expect(
        body<{ stops: { id: number }[] }>(reordered).stops.map((s) => s.id),
      ).toEqual([ids[2], ids[0], ids[1]]);

      // remove one, positions compact
      const removed = await fx
        .r()
        .delete(`/delivery-runs/${run.id}/stops/${ids[0]}`)
        .set(fx.h(a.adminToken))
        .expect(200);
      expect(
        body<{ stops: { id: number; position: number }[] }>(removed).stops.map(
          (s) => s.position,
        ),
      ).toEqual([1, 2]);

      const dispatched = await fx
        .r()
        .post(`/delivery-runs/${run.id}/dispatch`)
        .set(fx.h(a.adminToken))
        .expect(201);
      expect(body<{ status: string }>(dispatched).status).toBe('dispatched');
      // o2 (preparing) was moved out for delivery by the SAME state machine, with a timeline entry
      expect((await fx.f.orderRow(o2.id)).status).toBe('out_for_delivery');
      const hist = await fx
        .r()
        .get(`/orders/${o2.id}/history`)
        .set(fx.h(a.adminToken))
        .expect(200);
      expect(body<{ status: string }[]>(hist).map((e) => e.status)).toContain(
        'out_for_delivery',
      );

      // dispatching twice is a conflict; edits after dispatch of stops order still work, adds do not
      await fx
        .r()
        .post(`/delivery-runs/${run.id}/dispatch`)
        .set(fx.h(a.adminToken))
        .expect(409);
      const o4 = await fx.deliveryOrder(a);
      await fx
        .r()
        .post(`/delivery-runs/${run.id}/stops`)
        .set(fx.h(a.adminToken))
        .send({ orderIds: [o4.id] })
        .expect(409);
    });

    it('refuses orders that are not eligible, and reveals nothing about other shops', async () => {
      const driver = await fx.createDriver(a);
      const pickup = await fx.deliveryOrder(a, { orderType: 'pickup' });
      const pending = await fx.deliveryOrder(a, { status: 'pending' });
      const delivered = await fx.deliveryOrder(a, { status: 'delivered' });
      const cancelled = await fx.deliveryOrder(a, { status: 'cancelled' });
      const elsewhereOutlet = await fx.deliveryOrder(a, { outletId: outlet2 });
      const foreign = await fx.deliveryOrder(b);

      const res = await fx
        .r()
        .post('/delivery-runs')
        .set(fx.h(a.adminToken))
        .send({
          driverId: driver.id,
          outletId: a.outletId,
          orderIds: [
            pickup.id,
            pending.id,
            delivered.id,
            cancelled.id,
            elsewhereOutlet.id,
            foreign.id,
          ],
        })
        .expect(400);
      const details = body<{ details: { orderId: number; reason: string }[] }>(
        res,
      ).details;
      const reason = (id: number) =>
        details.find((d) => d.orderId === id)?.reason;
      expect(reason(pickup.id)).toBe('not_delivery');
      expect(reason(pending.id)).toBe('bad_status');
      expect(reason(delivered.id)).toBe('bad_status');
      expect(reason(cancelled.id)).toBe('bad_status');
      // another outlet's order and another shop's order are indistinguishable from a missing one
      expect(reason(elsewhereOutlet.id)).toBe('not_found');
      expect(reason(foreign.id)).toBe('not_found');
      // and the failed create left no run behind
      const runs = await fx.row(
        `SELECT id FROM deliveryrun WHERE shopId = ? AND driverId = ?`,
        [a.shopId, driver.id],
      );
      expect(runs).toHaveLength(0);
    });

    it('refuses an order with an active external courier handoff', async () => {
      const driver = await fx.createDriver(a);
      const o = await fx.deliveryOrder(a);
      await fx.db.execute(
        `INSERT INTO externaldelivery (orderId, carrier, price, currency, destination, status) VALUES (?, 'Aramex', 10, 'AED', 'x', 'pending')`,
        [o.id],
      );
      const res = await fx
        .r()
        .post('/delivery-runs')
        .set(fx.h(a.adminToken))
        .send({ driverId: driver.id, outletId: a.outletId, orderIds: [o.id] })
        .expect(400);
      expect(
        body<{ details: { reason: string }[] }>(res).details[0].reason,
      ).toBe('external_courier');
    });

    it('lets an order be on at most ONE active run, atomically', async () => {
      const driver = await fx.createDriver(a);
      const o = await fx.deliveryOrder(a);
      const first = await fx.createRun(a, driver.id, [o.id]);
      const dup = await fx
        .r()
        .post('/delivery-runs')
        .set(fx.h(a.adminToken))
        .send({ driverId: driver.id, outletId: a.outletId, orderIds: [o.id] });
      expect(dup.status).toBe(409);

      // race: two runs created at once for one fresh order, exactly one wins
      const o2 = await fx.deliveryOrder(a);
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          fx
            .r()
            .post('/delivery-runs')
            .set(fx.h(a.adminToken))
            .send({
              driverId: driver.id,
              outletId: a.outletId,
              orderIds: [o2.id],
            }),
        ),
      );
      expect(results.filter((x) => x.status === 201)).toHaveLength(1);
      expect(results.filter((x) => x.status === 409)).toHaveLength(3);
      const active = await fx.row(
        `SELECT id FROM deliveryrunstop WHERE orderId = ? AND activeOrderId IS NOT NULL`,
        [o2.id],
      );
      expect(active).toHaveLength(1);

      // cancelling frees the order for a new run
      await fx
        .r()
        .post(`/delivery-runs/${first.id}/cancel`)
        .set(fx.h(a.adminToken))
        .expect(201);
      const again = await fx.createRun(a, driver.id, [o.id]);
      expect(again.stops).toHaveLength(1);
      // cancelling an already-cancelled run is a conflict
      await fx
        .r()
        .post(`/delivery-runs/${first.id}/cancel`)
        .set(fx.h(a.adminToken))
        .expect(409);
    });

    it('rejects an inactive or foreign driver', async () => {
      const inactive = await fx.createDriver(a);
      await fx
        .r()
        .patch(`/drivers/${inactive.id}`)
        .set(fx.h(a.adminToken))
        .send({ active: false })
        .expect(200);
      await fx
        .r()
        .post('/delivery-runs')
        .set(fx.h(a.adminToken))
        .send({ driverId: inactive.id, outletId: a.outletId })
        .expect(400);
      const foreignDriver = await fx.createDriver(b);
      await fx
        .r()
        .post('/delivery-runs')
        .set(fx.h(a.adminToken))
        .send({ driverId: foreignDriver.id, outletId: a.outletId })
        .expect(400);
      // a driver of the OTHER outlet of the same shop cannot run this outlet
      const wrongOutlet = await fx.createDriver(a, { outletId: outlet2 });
      await fx
        .r()
        .post('/delivery-runs')
        .set(fx.h(a.adminToken))
        .send({ driverId: wrongOutlet.id, outletId: a.outletId })
        .expect(400);
    });

    it('is tenant isolated on every run endpoint', async () => {
      const driver = await fx.createDriver(a);
      const o = await fx.deliveryOrder(a);
      const run = await fx.createRun(a, driver.id, [o.id]);
      const stopId = run.stops[0].id;
      const t = b.adminToken;
      await fx.r().get(`/delivery-runs/${run.id}`).set(fx.h(t)).expect(404);
      await fx
        .r()
        .patch(`/delivery-runs/${run.id}`)
        .set(fx.h(t))
        .send({ notes: 'x' })
        .expect(404);
      await fx
        .r()
        .post(`/delivery-runs/${run.id}/stops`)
        .set(fx.h(t))
        .send({ orderIds: [1] })
        .expect(404);
      await fx
        .r()
        .put(`/delivery-runs/${run.id}/stops/order`)
        .set(fx.h(t))
        .send({ stopIds: [stopId] })
        .expect(404);
      await fx
        .r()
        .delete(`/delivery-runs/${run.id}/stops/${stopId}`)
        .set(fx.h(t))
        .expect(404);
      await fx
        .r()
        .post(`/delivery-runs/${run.id}/dispatch`)
        .set(fx.h(t))
        .expect(404);
      await fx
        .r()
        .post(`/delivery-runs/${run.id}/cancel`)
        .set(fx.h(t))
        .expect(404);
      const list = await fx.r().get('/delivery-runs').set(fx.h(t)).expect(200);
      expect(
        body<{ data: { id: number }[] }>(list).data.some(
          (x) => x.id === run.id,
        ),
      ).toBe(false);
      // a foreign outlet in the ready-orders query
      await fx
        .r()
        .get(`/delivery-runs/ready-orders?outletId=${a.outletId}`)
        .set(fx.h(t))
        .expect(400);
      const recon = await fx
        .r()
        .get(`/delivery-runs/cash-reconciliation?outletId=${a.outletId}`)
        .set(fx.h(t))
        .expect(200);
      expect(body<unknown[]>(recon)).toEqual([]);
      // untouched
      const intact = await fx
        .r()
        .get(`/delivery-runs/${run.id}`)
        .set(fx.h(a.adminToken))
        .expect(200);
      expect(body<{ status: string; stops: unknown[] }>(intact)).toMatchObject({
        status: 'draft',
      });
    });

    it('pins a branch user to its outlet for runs', async () => {
      const branch = await fx.createStaff(
        fx.app,
        a.adminToken,
        'runbranch',
        'branch',
        a.outletId,
      );
      const driver2 = await fx.createDriver(a, { outletId: outlet2 });
      const o2 = await fx.deliveryOrder(a, { outletId: outlet2 });
      const run2 = await fx
        .r()
        .post('/delivery-runs')
        .set(fx.h(a.adminToken))
        .send({ driverId: driver2.id, outletId: outlet2, orderIds: [o2.id] })
        .expect(201);
      const id2 = body<{ id: number }>(run2).id;
      await fx
        .r()
        .get(`/delivery-runs/${id2}`)
        .set(fx.h(branch.token))
        .expect(404);
      await fx
        .r()
        .post(`/delivery-runs/${id2}/dispatch`)
        .set(fx.h(branch.token))
        .expect(404);
      await fx
        .r()
        .post(`/delivery-runs/${id2}/cancel`)
        .set(fx.h(branch.token))
        .expect(404);
      const list = await fx
        .r()
        .get(`/delivery-runs?outletId=${outlet2}`)
        .set(fx.h(branch.token))
        .expect(200);
      expect(
        body<{ data: { outletId: number }[] }>(list).data.every(
          (x) => x.outletId === a.outletId,
        ),
      ).toBe(true);
      // the branch user cannot create a run at the other outlet either: its outlet wins
      const d1 = await fx.createDriver(a);
      const created = await fx
        .r()
        .post('/delivery-runs')
        .set(fx.h(branch.token))
        .send({ driverId: d1.id, outletId: outlet2 })
        .expect(201);
      expect(body<{ outletId: number }>(created).outletId).toBe(a.outletId);
      await fx
        .r()
        .post('/delivery-runs')
        .set(fx.h(branch.token))
        .send({ driverId: driver2.id, outletId: outlet2 })
        .expect(400);
    });
  });
});
