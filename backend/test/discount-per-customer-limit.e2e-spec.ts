import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(240000);

// usageLimitPerCustomer is enforced INSIDE the order transaction at every
// entry point that redeems a code (storefront checkout, admin create, draft
// complete), keyed on the customer row ([shopId, phone]) the order resolves to.
// validate()/draft-attach checks are advisory: they only see a customer that
// already exists and only committed rows.
//
// Semantics recorded here (not invented): a redemption is written at order
// creation and never deleted, so an UNPAID or CANCELLED order still counts
// against the per-customer limit, exactly as it still counts against the global
// usageLimit (timesUsed is never decremented either).
describe('Discount per-customer limit (e2e)', () => {
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

  type Shop = Awaited<ReturnType<typeof f.setupShop>>;
  let phoneSeq = 0;
  const newPhone = () =>
    `05${String(Date.now() % 100000)}${String(++phoneSeq).padStart(3, '0')}`;

  async function shopWithStock(prefix: string, stock = 20) {
    const shop = await f.setupShop(prefix);
    const product = await f.stockedProduct(shop, stock);
    await f.publish(shop);
    return { shop, product };
  }

  async function redemptions(discountId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT customerId, orderId FROM discountredemption WHERE discountId = ?`,
      [discountId],
    );
    return rows;
  }
  async function timesUsed(discountId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT timesUsed FROM discount WHERE id = ?`,
      [discountId],
    );
    return rows[0].timesUsed as number;
  }
  async function ordersForPhone(shop: Shop, phone: string) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT id FROM \`order\` WHERE shopId = ? AND customerPhone = ?`,
      [shop.shopId, phone],
    );
    return rows.length;
  }
  const msg = (res: { body: unknown }) =>
    String((res.body as { message?: unknown }).message);

  it('storefront: a second order by the same phone is rejected with 409 and leaves nothing behind', async () => {
    const { shop, product } = await shopWithStock('pcl-sf');
    const d = await f.createDiscount(shop, { usageLimitPerCustomer: 1 });
    const phone = newPhone();
    const items = [{ productId: product.id, quantity: 1 }];

    const first = await f.storefrontOrderRaw(shop, items, {
      customerPhone: phone,
      discountCode: d.code,
    });
    expect(first.status).toBe(201);
    expect(await f.productStock(shop.outletId, product.id)).toBe(19);

    const second = await f.storefrontOrderRaw(shop, items, {
      customerPhone: phone,
      discountCode: d.code,
    });
    expect(second.status).toBe(409);
    expect(msg(second)).toContain('maximum number of times');

    // no order row, no redemption, no stock reservation, global counter untouched
    expect(await ordersForPhone(shop, phone)).toBe(1);
    expect(await redemptions(d.id)).toHaveLength(1);
    expect(await timesUsed(d.id)).toBe(1);
    expect(await f.productStock(shop.outletId, product.id)).toBe(19);
  });

  it('admin create: a second order by the same phone is rejected, and the limit is shared with the storefront', async () => {
    const { shop, product } = await shopWithStock('pcl-admin');
    const d = await f.createDiscount(shop, { usageLimitPerCustomer: 1 });
    const phone = newPhone();
    const items = [{ productId: product.id, quantity: 1 }];

    await f.adminOrder(shop, items, {
      customerPhone: phone,
      discountCode: d.code,
    });
    const second = await request(f.http())
      .post('/orders')
      .set(f.auth(shop))
      .send({
        customerName: 'Again',
        customerPhone: phone,
        customerAddress: 'Pickup',
        outletId: shop.outletId,
        orderType: 'pickup',
        items,
        discountCode: d.code,
      });
    expect(second.status).toBe(409);
    // the storefront path sees the admin order's redemption (same customer row)
    const viaStorefront = await f.storefrontOrderRaw(shop, items, {
      customerPhone: phone,
      discountCode: d.code,
    });
    expect(viaStorefront.status).toBe(409);

    expect(await ordersForPhone(shop, phone)).toBe(1);
    expect(await redemptions(d.id)).toHaveLength(1);
    expect(await timesUsed(d.id)).toBe(1);
  });

  it('draft complete: two drafts attached before the customer existed cannot both complete', async () => {
    const { shop, product } = await shopWithStock('pcl-draft');
    const d = await f.createDiscount(shop, { usageLimitPerCustomer: 1 });
    const phone = newPhone();
    const draft = async () =>
      body<{ id: number }>(
        await request(f.http())
          .post('/shop/draft-orders')
          .set(f.auth(shop))
          .send({
            outletId: shop.outletId,
            customerName: 'Phone Customer',
            customerPhone: phone,
            customerAddress: '1 Main St',
            orderType: 'delivery',
            items: [{ productId: product.id, quantity: 1 }],
            discountCode: d.code,
          })
          .expect(201),
      ).id;
    // Both attach checks pass: no customer row exists yet, so evaluate() has no
    // customerId to count against. Only the in-transaction check can stop this.
    const a = await draft();
    const b = await draft();

    await request(f.http())
      .post(`/shop/draft-orders/${a}/complete`)
      .set(f.auth(shop))
      .expect(201);
    const second = await request(f.http())
      .post(`/shop/draft-orders/${b}/complete`)
      .set(f.auth(shop));
    expect(second.status).toBe(409);
    expect(msg(second)).toContain('maximum number of times');

    expect(await ordersForPhone(shop, phone)).toBe(1);
    expect(await redemptions(d.id)).toHaveLength(1);
    expect(await timesUsed(d.id)).toBe(1);
    // draft b stays a draft (not converted) and its stock was never reserved
    expect(await f.productStock(shop.outletId, product.id)).toBe(19);
    const rows = await db.query<RowDataPacket[]>(
      `SELECT status, convertedOrderId FROM draftorder WHERE id = ?`,
      [b],
    );
    expect(rows[0].convertedOrderId).toBeNull();
  });

  it('concurrency: six simultaneous storefront orders, same new phone, same code: exactly one wins', async () => {
    const { shop, product } = await shopWithStock('pcl-race');
    const d = await f.createDiscount(shop, { usageLimitPerCustomer: 1 });
    const phone = newPhone();

    const res = await Promise.all(
      Array.from({ length: 6 }, () =>
        f.storefrontOrderRaw(shop, [{ productId: product.id, quantity: 1 }], {
          customerPhone: phone,
          discountCode: d.code,
        }),
      ),
    );
    const statuses = res.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await ordersForPhone(shop, phone)).toBe(1);
    expect(await redemptions(d.id)).toHaveLength(1);
    expect(await timesUsed(d.id)).toBe(1);
    expect(await f.productStock(shop.outletId, product.id)).toBe(19);
  });

  it('concurrency with limit 2: five simultaneous orders, exactly two win', async () => {
    const { shop, product } = await shopWithStock('pcl-race2');
    const d = await f.createDiscount(shop, { usageLimitPerCustomer: 2 });
    const phone = newPhone();
    const res = await Promise.all(
      Array.from({ length: 5 }, () =>
        f.storefrontOrderRaw(shop, [{ productId: product.id, quantity: 1 }], {
          customerPhone: phone,
          discountCode: d.code,
        }),
      ),
    );
    expect(res.filter((r) => r.status === 201)).toHaveLength(2);
    expect(res.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await redemptions(d.id)).toHaveLength(2);
    expect(await f.productStock(shop.outletId, product.id)).toBe(18);
  });

  it('different customers are unaffected, in the same shop and across shops', async () => {
    const { shop, product } = await shopWithStock('pcl-iso-a');
    const other = await shopWithStock('pcl-iso-b');
    const d = await f.createDiscount(shop, { usageLimitPerCustomer: 1 });
    const code = d.code!;
    const items = [{ productId: product.id, quantity: 1 }];
    const phone = newPhone();

    expect(
      (
        await f.storefrontOrderRaw(shop, items, {
          customerPhone: phone,
          discountCode: code,
        })
      ).status,
    ).toBe(201);
    // another customer, same shop, same code
    expect(
      (
        await f.storefrontOrderRaw(shop, items, {
          customerPhone: newPhone(),
          discountCode: code,
        })
      ).status,
    ).toBe(201);
    // same phone and same code string in another shop: a different discount
    // and a different customer row, so it is unaffected
    const d2 = await f.createDiscount(other.shop, {
      code,
      usageLimitPerCustomer: 1,
    });
    expect(
      (
        await f.storefrontOrderRaw(
          other.shop,
          [{ productId: other.product.id, quantity: 1 }],
          { customerPhone: phone, discountCode: code },
        )
      ).status,
    ).toBe(201);
    expect(await redemptions(d.id)).toHaveLength(2);
    expect(await redemptions(d2.id)).toHaveLength(1);
  });

  it('an unlimited per-customer code is unaffected', async () => {
    const { shop, product } = await shopWithStock('pcl-none');
    const d = await f.createDiscount(shop, {});
    const phone = newPhone();
    for (let i = 0; i < 3; i++) {
      await f.storefrontOrder(shop, [{ productId: product.id, quantity: 1 }], {
        customerPhone: phone,
        discountCode: d.code,
      });
    }
    expect(await redemptions(d.id)).toHaveLength(3);
  });

  it('a cancelled order still counts against the limit (existing semantics: redemptions are never released)', async () => {
    const { shop, product } = await shopWithStock('pcl-cancel');
    const d = await f.createDiscount(shop, { usageLimitPerCustomer: 1 });
    const phone = newPhone();
    const items = [{ productId: product.id, quantity: 1 }];
    const first = await f.storefrontOrder(shop, items, {
      customerPhone: phone,
      discountCode: d.code,
    });
    const orderId = (first.body as { order: { id: number } }).order.id;
    await f.cancelOrder(shop, orderId).expect(201);

    const retry = await f.storefrontOrderRaw(shop, items, {
      customerPhone: phone,
      discountCode: d.code,
    });
    expect(retry.status).toBe(409);
    expect(await timesUsed(d.id)).toBe(1);
  });

  it('editing the order keeps its own discount and never adds a redemption', async () => {
    const { shop, product } = await shopWithStock('pcl-edit');
    const d = await f.createDiscount(shop, { usageLimitPerCustomer: 1 });
    const phone = newPhone();
    const order = await f.adminOrder(
      shop,
      [{ productId: product.id, quantity: 2 }],
      { customerPhone: phone, discountCode: d.code },
    );

    const res = await f.editItems(shop, order.id, [
      { productId: product.id, quantity: 1 },
    ]);
    expect(res.status).toBe(200);
    const edited = body<{ discountDropped: boolean; discountAmount: string }>(
      res,
    );
    // The order's own redemption must not count against its own limit. Before
    // this was excluded, the edit silently dropped the discount (1 >= 1).
    expect(edited.discountDropped).toBe(false);
    expect(Number(edited.discountAmount)).toBeCloseTo(10, 2);
    expect(await redemptions(d.id)).toHaveLength(1);
    expect(await timesUsed(d.id)).toBe(1);

    // and the limit still holds afterwards
    const again = await f.storefrontOrderRaw(
      shop,
      [{ productId: product.id, quantity: 1 }],
      { customerPhone: phone, discountCode: d.code },
    );
    expect(again.status).toBe(409);
  });
});
