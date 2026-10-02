import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// SECURITY REPRO (pre-merge review of fix/return-refund-default-paid-share).
// ReturnsService.create now holds one pool connection for the whole
// transaction (order row FOR UPDATE) and, still inside it, calls
// attemptProviderRefund -> this.db.query(...) which needs a SECOND pool
// connection. DatabaseService's pool is DB_POOL_SIZE (default 5) with
// waitForConnections and no queue timeout. N >= pool-size concurrent returns on
// DIFFERENT orders (any shop, any role that can POST /orders/:id/returns) each
// hold one connection and wait for another: nobody can proceed, every request
// in the backend hangs until the process is restarted.
describe('SEC: concurrent returns exhaust the DB pool (deadlock)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;

  beforeAll(async () => {
    // A tiny pool makes the hang deterministic (read when the app boots): with
    // the default 5 it only shows under heavy contention. Guard for the class
    // "something inside a transaction asks the pool for a second connection".
    process.env.DB_POOL_SIZE = '2';
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
  });
  afterAll(async () => {
    // a deadlocked pool never drains; do not hang the suite on it
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))]);
  });

  it('pool-size concurrent returns on different orders all complete', async () => {
    const poolSize = Number(process.env.DB_POOL_SIZE ?? 5);
    const orders: {
      shop: Awaited<ReturnType<typeof f.setupShop>>;
      orderId: number;
      lineId: number;
    }[] = [];
    for (let i = 0; i < poolSize * 3; i++) {
      const shop = await f.setupShop(`sec-pool-${i}`);
      const p = await f.stockedProduct(shop, 10, { price: 100 });
      await f.publish(shop);
      const res = await f.storefrontOrder(shop, [
        { productId: p.id, quantity: 1 },
      ]);
      const orderId = body<{ order: { id: number } }>(res).order.id;
      await f.advance(shop, orderId, 'delivered');
      const items = await f.orderItems(orderId);
      orders.push({ shop, orderId, lineId: items[0].id as number });
    }
    const fire = orders.map((o) =>
      request(f.http())
        .post(`/orders/${o.orderId}/returns`)
        .set(f.auth(o.shop))
        .send({
          reason: 'changed_mind',
          restock: false,
          items: [{ orderItemId: o.lineId, quantity: 1 }],
        })
        .then((r) => r.status),
    );
    const settled = await Promise.race([
      Promise.all(fire),
      new Promise<'HUNG'>((r) => setTimeout(() => r('HUNG'), 30000)),
    ]);
    expect(settled).not.toBe('HUNG');
    expect(settled).toEqual(orders.map(() => 201));
  });
});
