import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DatabaseService } from '../src/database/database.service';
import { bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// F4: PATCH /products/stock/bulk-adjust is one transaction (all lines or none),
// validates every id against the caller's shop, and writes a ledger row per line.
describe('PATCH /products/stock/bulk-adjust (e2e)', () => {
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

  const bulk = (
    shop: Awaited<ReturnType<typeof f.setupShop>>,
    adjustments: { productId: number; delta: number }[],
    outletId = shop.outletId,
  ) =>
    request(f.http())
      .patch('/products/stock/bulk-adjust')
      .set(f.auth(shop))
      .send({ outletId, adjustments });

  it('writes one ADJUSTMENT movement per line, so the ledger equals the stock (duplicate lines included)', async () => {
    const shop = await f.setupShop('ba-ledger');
    const p1 = await f.stockedProduct(shop, 5);
    const p2 = await f.stockedProduct(shop, 0);
    await bulk(shop, [
      { productId: p1.id, delta: 4 },
      { productId: p1.id, delta: -2 },
      { productId: p2.id, delta: 7 },
    ]).expect(200);
    expect(await f.productStock(shop.outletId, p1.id)).toBe(7);
    expect(await f.productStock(shop.outletId, p2.id)).toBe(7);
    for (const p of [p1, p2]) {
      const ing = (await f.shadowIngredientId(p.id))!;
      expect(await f.ledgerSum(shop.outletId, ing)).toBe(
        await f.stockOf(shop.outletId, ing),
      );
    }
    const ing1 = (await f.shadowIngredientId(p1.id))!;
    const bulkRows = (await f.movements(shop.outletId, ing1, 'ADJUSTMENT')).map(
      (m) => m.delta as number,
    );
    expect(bulkRows).toEqual([5, 4, -2]); // seed, then the two bulk lines
  });

  it('is all-or-nothing: one line that would go below zero rejects the whole batch', async () => {
    const shop = await f.setupShop('ba-atomic');
    const p1 = await f.stockedProduct(shop, 5);
    const p2 = await f.stockedProduct(shop, 1);
    const ing1 = (await f.shadowIngredientId(p1.id))!;
    const res = await bulk(shop, [
      { productId: p1.id, delta: 10 },
      { productId: p2.id, delta: -3 },
    ]);
    expect(res.status).toBe(409);
    expect(await f.productStock(shop.outletId, p1.id)).toBe(5);
    expect(await f.productStock(shop.outletId, p2.id)).toBe(1);
    expect(
      (await f.movements(shop.outletId, ing1, 'ADJUSTMENT')).map(
        (m) => m.delta as number,
      ),
    ).toEqual([5]); // only the seeding movement
  });

  it('cross-tenant: a foreign shop product id 404s and the valid lines in the same batch are not applied', async () => {
    const a = await f.setupShop('ba-xa');
    const b = await f.setupShop('ba-xb');
    const pa = await f.stockedProduct(a, 5);
    const pb = await f.stockedProduct(b, 5);
    const res = await bulk(a, [
      { productId: pa.id, delta: 3 },
      { productId: pb.id, delta: 3 },
    ]);
    expect(res.status).toBe(404);
    expect(await f.productStock(a.outletId, pa.id)).toBe(5);
    expect(await f.productStock(b.outletId, pb.id)).toBe(5);
    // Nothing of A's was written against B's outlet either.
    expect(await f.productStock(a.outletId, pb.id)).toBe(0);
  });

  it("cross-tenant: a foreign shop's outlet id is rejected and nothing is written", async () => {
    const a = await f.setupShop('ba-oa');
    const b = await f.setupShop('ba-ob');
    const pa = await f.stockedProduct(a, 5);
    const res = await bulk(a, [{ productId: pa.id, delta: 3 }], b.outletId);
    expect(res.status).toBe(400);
    expect(await f.productStock(b.outletId, pa.id)).toBe(0);
    expect(await f.productStock(a.outletId, pa.id)).toBe(5);
  });
});
