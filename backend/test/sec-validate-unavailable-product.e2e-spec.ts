import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

// SECURITY REPRO (PR #187): the public, unauthenticated discount validate
// route now prices `items` through resolveOrderItems, which does not filter
// product.status. Checkout refuses a non-Available product; validate does
// not, so a 100% code turns discountAmount into a price oracle for products
// the merchant has not published.
describe('SEC: public validate prices unpublished products (e2e)', () => {
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

  it('does not reveal the price of an Unavailable product', async () => {
    const shop = await f.setupShop('sec-unavail');
    const hidden = await f.stockedProduct(shop, 10, { price: 777 });
    await f.publish(shop);
    await db.execute(`UPDATE product SET status = 'Unavailable' WHERE id = ?`, [
      hidden.id,
    ]);
    const discount = await f.createDiscount(shop, {
      type: 'PERCENTAGE',
      value: 100,
    });

    const res = await request(f.http())
      .post(`/public/${shop.slug}/discounts/validate`)
      .send({
        code: discount.code,
        cartSubtotal: 0,
        items: [{ productId: hidden.id, quantity: 1 }],
      });
    // Expected: rejected like checkout does (400 "not currently available").
    // Actual on main: 201 { valid: true, discountAmount: 777 }.
    expect(JSON.stringify(body(res))).not.toContain('777');
    expect(res.status).toBe(400);
    expect(JSON.stringify(body(res))).not.toContain('777');
  });
});
