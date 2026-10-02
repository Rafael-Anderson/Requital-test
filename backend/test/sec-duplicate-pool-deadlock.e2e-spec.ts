import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// ProductCatalogService.duplicate() used to call resolveTagIds (this.db) from
// INSIDE its transaction: each duplicate of a tagged product held one pool
// connection and asked for a second. pool-size concurrent duplicates all
// holding one and waiting for another hang the whole API. Same technique as
// sec-return-pool-deadlock.e2e-spec.ts.
describe('SEC: concurrent duplicates of tagged products do not deadlock the pool', () => {
  let app: INestApplication<App>;
  let f: ReturnType<typeof makeFixtures>;

  beforeAll(async () => {
    process.env.DB_POOL_SIZE = '2'; // read when the app boots
    const booted = await bootApp();
    app = booted.app;
    f = makeFixtures(app, booted.db);
  });
  afterAll(async () => {
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))]);
  });

  it('pool-size x3 concurrent duplicates all complete and keep their tags', async () => {
    const poolSize = Number(process.env.DB_POOL_SIZE ?? 5);
    const jobs: { shop: Awaited<ReturnType<typeof f.setupShop>>; id: number }[] = [];
    for (let i = 0; i < poolSize * 3; i++) {
      const shop = await f.setupShop(`sec-dup-${i}`);
      const p = await f.stockedProduct(shop, 0, { tags: ['alpha', 'beta'] });
      jobs.push({ shop, id: p.id });
    }
    const fire = jobs.map((j) =>
      request(f.http())
        .post(`/products/${j.id}/duplicate`)
        .set(f.auth(j.shop))
        .then((r) => ({
          status: r.status,
          tags: (r.body as { tags?: string[] }).tags,
        })),
    );
    const settled = await Promise.race([
      Promise.all(fire),
      new Promise<'HUNG'>((r) => setTimeout(() => r('HUNG'), 30000)),
    ]);
    expect(settled).not.toBe('HUNG');
    if (settled === 'HUNG') return;
    expect(settled.map((s) => s.status)).toEqual(jobs.map(() => 201));
    for (const s of settled) expect([...(s.tags ?? [])].sort()).toEqual(['alpha', 'beta']);
  });
});
