import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { bootApp, makeFixtures, body } from './w5-fixture';
import type { W5Shop } from './w5-fixture';
import { createStaff } from './staff-login';

export { body };
export type { W5Shop };

// Shared setup for the SHP-5 driver-dispatch specs. Orders are created through
// the real admin endpoint (so tax, totals, items and the per-shop number are all
// real) and then flipped to delivery type / COD / a given status by SQL, because
// admin-created orders are pickup with no paymentMethod and a hand-walked status
// would also move stock, which these specs are not about.
export async function bootDriverFixture() {
  const booted = await bootApp();
  // Listen once on an ephemeral port: supertest otherwise opens a fresh listener
  // per call, and a burst of parallel calls resets connections.
  await booted.app.listen(0);
  const f = makeFixtures(booted.app, booted.db);
  const db = booted.db;
  const app: INestApplication<App> = booted.app;
  const r = () => request(app.getHttpServer());
  const h = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function deliveryOrder(
    shop: W5Shop,
    opts: {
      status?: string;
      cod?: boolean;
      price?: number;
      currency?: string;
      orderType?: string;
      outletId?: number;
      notes?: string;
    } = {},
  ) {
    const product = await f.createProduct(shop, {
      price: opts.price ?? 100,
      trackInventory: false,
    });
    const order = await f.adminOrder(
      shop,
      [{ productId: product.id, quantity: 1 }],
      {
        customerName: 'Layla Hassan',
        customerPhone: '0501112233',
        customerEmail: 'layla@example.com',
        customerAddress: 'Villa 12, Street 4, Jumeirah',
        deliveryNotes: opts.notes ?? 'Ring the bell twice',
        ...(opts.outletId ? { outletId: opts.outletId } : {}),
      },
    );
    await db.execute(
      `UPDATE \`order\` SET orderType = ?, paymentMethod = ?, status = ?, currency = COALESCE(?, currency) WHERE id = ?`,
      [
        opts.orderType ?? 'delivery',
        opts.cod ? 'cash_on_delivery' : 'card',
        opts.status ?? 'preparing',
        opts.currency ?? null,
        order.id,
      ],
    );
    return order;
  }

  async function createDriver(
    shop: W5Shop,
    extra: Record<string, unknown> = {},
  ) {
    const res = await r()
      .post('/drivers')
      .set(h(shop.adminToken))
      .send({
        name: `Driver ${f.uniq()}`,
        phone: '+971 50 555 0100',
        outletId: shop.outletId,
        ...extra,
      })
      .expect(201);
    return body<{
      id: number;
      name: string;
      outletId: number;
      active: boolean;
    }>(res);
  }

  async function createRun(
    shop: W5Shop,
    driverId: number,
    orderIds: number[] = [],
    extra: Record<string, unknown> = {},
    token = shop.adminToken,
  ) {
    const res = await r()
      .post('/delivery-runs')
      .set(h(token))
      .send({ driverId, outletId: shop.outletId, orderIds, ...extra })
      .expect(201);
    return body<{
      id: number;
      status: string;
      stops: {
        id: number;
        position: number;
        status: string;
        order: { id: number };
      }[];
    }>(res);
  }

  async function secondOutlet(shop: W5Shop) {
    const res = await r()
      .post('/outlets')
      .set(h(shop.adminToken))
      .send({ name: `Second ${f.uniq()}`, active: true })
      .expect(201);
    return body<{ id: number }>(res).id;
  }

  async function row<T = RowDataPacket>(
    sql: string,
    params: (string | number)[],
  ) {
    const rows = await db.query<RowDataPacket[]>(sql, params);
    return rows as unknown as T[];
  }

  // A dispatched run with its magic link, ready for the driver-app endpoints.
  async function dispatchedRun(
    shop: W5Shop,
    opts: {
      n?: number;
      cod?: boolean;
      proofRequirement?: string;
      driverId?: number;
      price?: number;
    } = {},
  ) {
    const driver = opts.driverId
      ? { id: opts.driverId }
      : await createDriver(shop);
    const orders: { id: number }[] = [];
    for (let i = 0; i < (opts.n ?? 1); i++) {
      orders.push(
        await deliveryOrder(shop, { cod: opts.cod, price: opts.price }),
      );
    }
    const run = await createRun(
      shop,
      driver.id,
      orders.map((o) => o.id),
      opts.proofRequirement ? { proofRequirement: opts.proofRequirement } : {},
    );
    const res = await r()
      .post(`/delivery-runs/${run.id}/dispatch`)
      .set(h(shop.adminToken))
      .expect(201);
    const url = body<{ issuedLink: { url: string } }>(res).issuedLink.url;
    const token = url.split('/driver/')[1];
    const view = await r()
      .get('/driver-app/run')
      .set('X-Driver-Token', token)
      .expect(200);
    const stops = body<{ stops: { id: number }[] }>(view).stops;
    return { driver, orders, run, token, stops };
  }

  return {
    dispatchedRun,
    app,
    db,
    f,
    r,
    h,
    deliveryOrder,
    createDriver,
    createRun,
    secondOutlet,
    row,
    createStaff,
  };
}
