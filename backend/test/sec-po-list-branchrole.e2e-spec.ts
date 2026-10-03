/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- repro fixture, bodies are untyped supertest JSON */
import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { bootApp, makeFixtures, body } from './helpers/w5-fixture';
import { createStaff } from './helpers/staff-login';

jest.setTimeout(240000);

// SECURITY REPRO (INV-2 pre-merge review): GET /purchase-orders skips the
// per-outlet branch-role permission check for a branch user, although the
// branch user's outlet IS resolved (pinned) and orders.findAll does check in
// exactly that case. A restrict-only override that lacks purchase_orders.view
// must make the list 403, as it does for GET /purchase-orders/:id.
describe('SEC repro: PO list ignores branch-role restriction', () => {
  let app: INestApplication<App>;
  const h = (t: string) => ({ Authorization: `Bearer ${t}` });

  afterAll(async () => {
    await app.close();
  });

  it('a branch user whose role at their outlet lacks purchase_orders.view cannot list purchase orders', async () => {
    const booted = await bootApp();
    app = booted.app;
    const f = makeFixtures(app, booted.db);
    const a = await f.setupShop('sec-po');
    const r = () => request(app.getHttpServer());
    const staff = await createStaff(app, a.adminToken, 'sec', 'branch', a.outletId);

    const sup = body<{ id: number }>(
      await r().post('/suppliers').set(h(a.adminToken)).send({ name: `S ${f.uniq()}`, currency: 'AED' }).expect(201),
    );
    const ing = await f.createIngredient(a, 'Stem');
    const po = body<{ id: number }>(
      await r()
        .post('/purchase-orders')
        .set(h(a.adminToken))
        .send({ supplierId: sup.id, outletId: a.outletId, lines: [{ ingredientId: ing.id, quantity: 3, unitCost: 9 }] })
        .expect(201),
    );

    const role = body<{ id: number }>(
      await r()
        .post('/shop/branch-roles')
        .set(h(a.adminToken))
        .send({ name: `no-po-${f.uniq()}`, permissions: ['products.view'] })
        .expect(201),
    );
    await r()
      .post('/shop/branch-roles/assignments')
      .set(h(a.adminToken))
      .send({ userId: staff.userId, outletId: a.outletId, branchRoleId: role.id })
      .expect(201);

    // Control: the single-resource read IS gated.
    await r().get(`/purchase-orders/${po.id}`).set(h(staff.token)).expect(403);
    // BUG: the list is not; it returns the outlet's POs (supplier, totals).
    const list = await r().get('/purchase-orders').set(h(staff.token));
    expect(list.status).toBe(403);
  });
});
