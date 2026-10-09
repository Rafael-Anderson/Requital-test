/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- untyped supertest JSON */
import 'dotenv/config';
import { bootDriverFixture, body } from './helpers/driver-fixture';
import type { W5Shop } from './helpers/driver-fixture';

jest.setTimeout(300000);

const tokenOf = (url: string) => url.split('/driver/')[1];

describe('SHP-5 driver magic link', () => {
  let fx: Awaited<ReturnType<typeof bootDriverFixture>>;
  let a: W5Shop;
  let b: W5Shop;

  beforeAll(async () => {
    fx = await bootDriverFixture();
    a = await fx.f.setupShop('lnk-a');
    b = await fx.f.setupShop('lnk-b');
  });
  afterAll(async () => {
    await fx.app.close();
  });

  const driverGet = (token?: string) => {
    const req = fx.r().get('/driver-app/run');
    return token === undefined ? req : req.set('X-Driver-Token', token);
  };

  async function dispatchedRun(shop: W5Shop, n = 1) {
    const driver = await fx.createDriver(shop);
    const orders: { id: number }[] = [];
    for (let i = 0; i < n; i++)
      orders.push(await fx.deliveryOrder(shop, { cod: true }));
    const run = await fx.createRun(
      shop,
      driver.id,
      orders.map((o) => o.id),
    );
    const res = await fx
      .r()
      .post(`/delivery-runs/${run.id}/dispatch`)
      .set(fx.h(shop.adminToken))
      .expect(201);
    const link = body<{ issuedLink: { url: string; expiresAt: string } }>(
      res,
    ).issuedLink;
    return { driver, orders, run, token: tokenOf(link.url), url: link.url };
  }

  it('stores only a hash, and dispatch hands back a usable link', async () => {
    const { token, run } = await dispatchedRun(a);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await fx.row<{ tokenHash: string }>(
      `SELECT tokenHash FROM deliveryrunlink WHERE runId = ?`,
      [run.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].tokenHash).not.toContain(token);
    const res = await driverGet(token).expect(200);
    const view = body<{
      stops: {
        orderNumber: number;
        cod: { amount: string } | null;
        deliverable: boolean;
      }[];
    }>(res);
    expect(view.stops).toHaveLength(1);
    expect(view.stops[0].cod?.amount).toBeDefined();
    expect(view.stops[0].deliverable).toBe(true);
  });

  it('shows the driver only what the job needs', async () => {
    const { token } = await dispatchedRun(a);
    const text = JSON.stringify((await driverGet(token).expect(200)).body);
    expect(text).not.toContain('layla@example.com'); // no customer email
    for (const k of [
      'shopId',
      'otpHash',
      'otpSalt',
      'proofPhotoKey',
      'tokenHash',
      'activeOrderId',
      'taxAmount',
      'priceAtPurchase',
    ]) {
      expect(text).not.toContain(k);
    }
  });

  it('answers every unusable link with the SAME 404', async () => {
    const shape = async (token?: string) => {
      const res = await driverGet(token);
      return { status: res.status, body: res.body };
    };
    const missing = await shape();
    expect(missing.status).toBe(404);
    for (const t of [
      'nope',
      'x'.repeat(43),
      'A'.repeat(200),
      '../../etc/passwd',
      ' ',
    ]) {
      expect(await shape(t)).toEqual(missing);
    }
    // expired
    const exp = await dispatchedRun(a);
    await fx.db.execute(
      `UPDATE deliveryrunlink SET expiresAt = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE runId = ?`,
      [exp.run.id],
    );
    expect(await shape(exp.token)).toEqual(missing);
    // revoked via staff
    const rev = await dispatchedRun(a);
    await driverGet(rev.token).expect(200);
    await fx
      .r()
      .delete(`/delivery-runs/${rev.run.id}/link`)
      .set(fx.h(a.adminToken))
      .expect(200);
    expect(await shape(rev.token)).toEqual(missing);
    // forged: flip one character of a real token
    const real = await dispatchedRun(a);
    const forged =
      real.token.slice(0, -1) + (real.token.endsWith('A') ? 'B' : 'A');
    expect(await shape(forged)).toEqual(missing);
    await driverGet(real.token).expect(200);
  });

  it('dies when the run is cancelled or the driver is deactivated', async () => {
    const c = await dispatchedRun(a);
    await fx
      .r()
      .post(`/delivery-runs/${c.run.id}/cancel`)
      .set(fx.h(a.adminToken))
      .expect(201);
    await driverGet(c.token).expect(404);

    const d = await dispatchedRun(a);
    await driverGet(d.token).expect(200);
    await fx
      .r()
      .patch(`/drivers/${d.driver.id}`)
      .set(fx.h(a.adminToken))
      .send({ active: false })
      .expect(200);
    await driverGet(d.token).expect(404);
    // even if the revoke write were missed, the driver join alone kills it
    await fx.db.execute(
      `UPDATE deliveryrunlink SET revokedAt = NULL WHERE runId = ?`,
      [d.run.id],
    );
    await driverGet(d.token).expect(404);
  });

  it('a suspended shop kills the link', async () => {
    const s = await dispatchedRun(b);
    await driverGet(s.token).expect(200);
    await fx.db.execute(`UPDATE shop SET suspendedAt = NOW() WHERE id = ?`, [
      b.shopId,
    ]);
    await driverGet(s.token).expect(404);
    await fx.db.execute(`UPDATE shop SET suspendedAt = NULL WHERE id = ?`, [
      b.shopId,
    ]);
  });

  it('re-issuing revokes the previous link (one live link per run)', async () => {
    const r1 = await dispatchedRun(a);
    const again = await fx
      .r()
      .post(`/delivery-runs/${r1.run.id}/link`)
      .set(fx.h(a.adminToken))
      .expect(201);
    const t2 = tokenOf(body<{ url: string }>(again).url);
    await driverGet(r1.token).expect(404);
    await driverGet(t2).expect(200);
  });

  it('a run A token only ever shows run A, and never another shop or run', async () => {
    const one = await dispatchedRun(a, 2);
    const two = await dispatchedRun(a, 1);
    const other = await dispatchedRun(b, 1);
    const v1 = body<{ stops: { id: number }[] }>(
      await driverGet(one.token).expect(200),
    );
    const ids1 = v1.stops.map((s) => s.id);
    const ids2 = body<{ stops: { id: number }[] }>(
      await driverGet(two.token),
    ).stops.map((s) => s.id);
    const idsB = body<{ stops: { id: number }[] }>(
      await driverGet(other.token),
    ).stops.map((s) => s.id);
    expect(ids1).toHaveLength(2);
    expect(ids1.filter((i) => ids2.includes(i) || idsB.includes(i))).toEqual(
      [],
    );
    // a client-supplied run/shop id changes nothing: the endpoint takes none
    const sneaky = await fx
      .r()
      .get(`/driver-app/run?runId=${two.run.id}&shopId=${b.shopId}`)
      .set('X-Driver-Token', one.token)
      .expect(200);
    expect(
      body<{ stops: { id: number }[] }>(sneaky).stops.map((s) => s.id),
    ).toEqual(ids1);
  });

  it('cannot be authenticated with a staff token, cookie or bearer', async () => {
    await fx.r().get('/driver-app/run').set(fx.h(a.adminToken)).expect(404);
    const t = await dispatchedRun(a);
    // and a driver token is no staff credential
    await fx
      .r()
      .get('/delivery-runs')
      .set('X-Driver-Token', t.token)
      .expect(401);
    await fx
      .r()
      .get('/orders')
      .set('Authorization', `Bearer ${t.token}`)
      .expect(401);
  });

  it('staff link endpoints are tenant isolated and need a live run', async () => {
    const t = await dispatchedRun(a);
    await fx
      .r()
      .post(`/delivery-runs/${t.run.id}/link`)
      .set(fx.h(b.adminToken))
      .expect(404);
    await fx
      .r()
      .delete(`/delivery-runs/${t.run.id}/link`)
      .set(fx.h(b.adminToken))
      .expect(404);
    await fx
      .r()
      .post(`/delivery-runs/${t.run.id}/link/send`)
      .set(fx.h(b.adminToken))
      .expect(404);
    await driverGet(t.token).expect(200); // untouched
    const driver = await fx.createDriver(a);
    const draft = await fx.createRun(a, driver.id);
    await fx
      .r()
      .post(`/delivery-runs/${draft.id}/link`)
      .set(fx.h(a.adminToken))
      .expect(409);
  });

  it('sends the link to the driver through the job queue, without customer data', async () => {
    const t = await dispatchedRun(a);
    const res = await fx
      .r()
      .post(`/delivery-runs/${t.run.id}/link/send`)
      .set(fx.h(a.adminToken))
      .expect(201);
    expect(body<{ queued: boolean }>(res).queued).toBe(true);
    const jobs = await fx.row<{ payload: unknown }>(
      `SELECT payload FROM job WHERE shopId = ? AND type = 'send_merchant_whatsapp_alert' AND idempotencyKey LIKE 'driver-link:%' ORDER BY id DESC LIMIT 1`,
      [a.shopId],
    );
    const payload =
      typeof jobs[0].payload === 'string'
        ? JSON.parse(jobs[0].payload)
        : jobs[0].payload;
    expect(payload.body).toContain('/driver/');
    expect(payload.body).not.toContain('Layla');
    // the older link was rotated out
    await driverGet(t.token).expect(404);
  });

  it('writes the link audit rows without the secret', async () => {
    const t = await dispatchedRun(a);
    const rows = await fx.row<{
      metadata: string | null;
      after: string | null;
    }>(
      `SELECT metadata, \`after\` FROM auditlog WHERE shopId = ? AND entityType = 'delivery_run' AND entityId = ?`,
      [a.shopId, t.run.id],
    );
    expect(JSON.stringify(rows)).not.toContain(t.token);
  });
});
