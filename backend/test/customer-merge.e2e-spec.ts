import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { CustomerMergeService } from '../src/customer-merge/customer-merge.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';
import { asCustomer, registerCustomer } from './helpers/customer-session';
import { createStaffToken } from './helpers/staff-login';

jest.setTimeout(240000);

// CUS-10. NOT reversible: the duplicate row is deleted after everything it owned
// is re-pointed at the primary.
describe('Customer merge (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let seq = 0;
  const phone = () =>
    `05${String(Date.now() % 100000)}${String(++seq).padStart(3, '0')}`;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
  });
  afterAll(async () => {
    await app.close();
  });

  type Shop = Awaited<ReturnType<typeof f.setupShop>>;
  const api = (
    shop: Shop,
    method: 'get' | 'post' | 'put',
    path: string,
    data?: object,
  ) =>
    request(server())
      [method](path)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send(data);

  async function newShop(prefix: string) {
    const shop = await f.setupShop(prefix);
    const product = await f.stockedProduct(shop, 100, { price: 100 });
    await f.publish(shop);
    return { shop, product };
  }
  async function guest(
    shop: Shop,
    productId: number,
    p = phone(),
    name = 'Guest',
  ) {
    await f.storefrontOrder(shop, [{ productId, quantity: 1 }], {
      customerPhone: p,
      customerName: name,
      customerEmail: `${f.uniq()}@g.test`,
    });
    const rows = await db.query<RowDataPacket[]>(
      `SELECT id FROM customer WHERE shopId = ? AND phone = ?`,
      [shop.shopId, p],
    );
    return { id: rows[0].id as number, phone: p };
  }
  const merge = (
    shop: Shop,
    primary: number,
    dups: number[],
    extra: object = {},
  ) =>
    api(shop, 'post', `/customers/${primary}/merge`, {
      duplicateIds: dups,
      confirm: 'MERGE',
      ...extra,
    });
  const count = async (sql: string, params: (string | number)[]) =>
    Number((await db.query<RowDataPacket[]>(sql, params))[0].n);
  const grant = (shop: Shop, id: number, amount: number, currency = 'AED') =>
    api(shop, 'post', `/customers/${id}/store-credit/adjustments`, {
      currency,
      amount,
      direction: 'grant',
      reason: 'seed',
    }).expect(201);
  async function balance(id: number, currency = 'AED') {
    const r = await db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM storecreditentry WHERE customerId = ? AND currency = ?`,
      [id, currency],
    );
    return Number(r[0].s);
  }

  it('moves everything the duplicate owns, keeps a record, and reports what moved', async () => {
    const { shop, product } = await newShop('mg-all');
    const P = await guest(shop, product.id, phone(), 'Primary');
    const D = await guest(shop, product.id, phone(), 'Duplicate');
    // a second order for the duplicate, a draft, a gift card it bought
    await f.storefrontOrder(shop, [{ productId: product.id, quantity: 1 }], {
      customerPhone: D.phone,
      customerName: 'Duplicate',
    });
    await api(shop, 'post', '/shop/draft-orders', {
      outletId: shop.outletId,
      customerName: 'Duplicate',
      customerPhone: D.phone,
      customerAddress: '1 St',
      orderType: 'delivery',
      items: [{ productId: product.id, quantity: 1 }],
    }).expect(201);
    await db.execute(
      `INSERT INTO giftcard (shopId, code, initialValue, remainingBalance, purchasedByCustomerId, updatedAt, currency) VALUES (?, ?, 50, 50, ?, NOW(3), 'AED')`,
      [shop.shopId, `GC-${f.uniq()}`, D.id],
    );
    // ledger in two currencies, on both customers
    await grant(shop, P.id, 10);
    await grant(shop, D.id, 25.5);
    await grant(shop, D.id, 4, 'KWD');
    // tags (one shared), notes, consent (the duplicate's answer is newer), addresses, wishlist
    const t1 = body<{ id: number }>(
      await api(shop, 'post', '/customer-tags', { name: 'VIP' }).expect(201),
    ).id;
    const t2 = body<{ id: number }>(
      await api(shop, 'post', '/customer-tags', { name: 'Wholesale' }).expect(
        201,
      ),
    ).id;
    await api(shop, 'post', '/customer-tags/assign', {
      customerIds: [P.id, D.id],
      tagIds: [t1],
    }).expect(201);
    await api(shop, 'post', '/customer-tags/assign', {
      customerIds: [D.id],
      tagIds: [t2],
    }).expect(201);
    await api(shop, 'post', `/customers/${D.id}/notes`, {
      body: 'note on duplicate',
    }).expect(201);
    await api(shop, 'post', `/customers/${P.id}/notes`, {
      body: 'note on primary',
    }).expect(201);
    await api(shop, 'put', `/customers/${P.id}/consent`, {
      channel: 'email',
      status: 'granted',
      note: 'verbal',
    }).expect(200);
    await db.execute(
      `UPDATE customerconsent SET updatedAt = DATE_SUB(NOW(3), INTERVAL 2 DAY) WHERE customerId = ?`,
      [P.id],
    );
    await api(shop, 'put', `/customers/${D.id}/consent`, {
      channel: 'email',
      status: 'withdrawn',
    }).expect(200);
    await api(shop, 'put', `/customers/${D.id}/consent`, {
      channel: 'sms',
      status: 'granted',
      note: 'form',
    }).expect(200);
    await db.execute(
      `UPDATE customer SET addresses = ?, wishlist = ? WHERE id = ?`,
      [
        JSON.stringify([{ id: 'a1', address: 'P home' }]),
        JSON.stringify([1, 2]),
        P.id,
      ],
    );
    await db.execute(
      `UPDATE customer SET addresses = ?, wishlist = ?, birthday = '1990-05-05' WHERE id = ?`,
      [
        JSON.stringify([
          { id: 'a1', address: 'dup of a1' },
          { id: 'a2', address: 'D work' },
        ]),
        JSON.stringify([2, 3]),
        D.id,
      ],
    );

    const before = {
      ordersD: await count(
        `SELECT COUNT(*) AS n FROM \`order\` WHERE customerId = ?`,
        [D.id],
      ),
      ledgerAll: await count(
        `SELECT COUNT(*) AS n FROM storecreditentry WHERE customerId IN (?, ?)`,
        [P.id, D.id],
      ),
      eventsD: await count(
        `SELECT COUNT(*) AS n FROM customerconsentevent WHERE customerId = ?`,
        [D.id],
      ),
    };
    expect(before.ordersD).toBe(2);

    const res = body<{
      merged: { duplicateCustomerId: number; moved: Record<string, number> }[];
      alreadyMerged: number[];
    }>(await merge(shop, P.id, [D.id]).expect(201));
    expect(res.alreadyMerged).toEqual([]);
    expect(res.merged[0].moved).toMatchObject({
      orders: 2,
      draftOrders: 1,
      giftCards: 1,
      storeCreditEntries: 2,
      notes: 1,
    });

    // the duplicate is gone, everything is on the primary
    expect(
      await count(`SELECT COUNT(*) AS n FROM customer WHERE id = ?`, [D.id]),
    ).toBe(0);
    expect(
      await count(`SELECT COUNT(*) AS n FROM \`order\` WHERE customerId = ?`, [
        P.id,
      ]),
    ).toBe(3);
    expect(
      await count(`SELECT COUNT(*) AS n FROM \`order\` WHERE customerId = ?`, [
        D.id,
      ]),
    ).toBe(0);
    expect(
      await count(`SELECT COUNT(*) AS n FROM draftorder WHERE customerId = ?`, [
        P.id,
      ]),
    ).toBe(1);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM giftcard WHERE purchasedByCustomerId = ?`,
        [P.id],
      ),
    ).toBe(1);
    // ledger: every row survives, balances add up per currency
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM storecreditentry WHERE customerId = ?`,
        [P.id],
      ),
    ).toBe(before.ledgerAll);
    expect(await balance(P.id)).toBe(35.5);
    expect(await balance(P.id, 'KWD')).toBe(4);
    // tags: union, shared one once
    const tags = await db.query<RowDataPacket[]>(
      `SELECT tagId FROM customertagassignment WHERE customerId = ? ORDER BY tagId`,
      [P.id],
    );
    expect(tags.map((t) => Number(t.tagId))).toEqual([t1, t2]);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM customernote WHERE customerId = ?`,
        [P.id],
      ),
    ).toBe(2);
    // consent: the NEWER answer wins per channel, the other channel is taken, history moves
    const consent = await db.query<RowDataPacket[]>(
      `SELECT channel, status FROM customerconsent WHERE customerId = ? ORDER BY channel`,
      [P.id],
    );
    expect(consent.map((c) => [String(c.channel), String(c.status)])).toEqual([
      ['email', 'withdrawn'],
      ['sms', 'granted'],
    ]);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM customerconsentevent WHERE customerId = ?`,
        [P.id],
      ),
    ).toBe(1 + before.eventsD);
    // addresses union by id (primary's a1 kept), wishlist union
    const c = (
      await db.query<RowDataPacket[]>(
        `SELECT addresses, wishlist, birthday FROM customer WHERE id = ?`,
        [P.id],
      )
    )[0];
    expect(
      (c.addresses as { id: string; address: string }[]).map((a) => [
        a.id,
        a.address,
      ]),
    ).toEqual([
      ['a1', 'P home'],
      ['a2', 'D work'],
    ]);
    expect(c.wishlist).toEqual([1, 2, 3]);
    expect(c.birthday).not.toBeNull();
    // the record
    const hist = body<
      {
        duplicateCustomerId: number;
        duplicatePhone: string;
        actorName: string;
      }[]
    >(await api(shop, 'get', `/customers/${P.id}/merges`).expect(200));
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({
      duplicateCustomerId: D.id,
      duplicatePhone: D.phone,
    });
    // the duplicate's old phone now resolves to the primary at checkout
    await f.storefrontOrder(shop, [{ productId: product.id, quantity: 1 }], {
      customerPhone: D.phone,
      customerName: 'Dup again',
    });
    expect(
      await count(`SELECT COUNT(*) AS n FROM \`order\` WHERE customerId = ?`, [
        P.id,
      ]),
    ).toBe(4);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM customer WHERE shopId = ? AND phone = ?`,
        [shop.shopId, D.phone],
      ),
    ).toBe(0);
  });

  it('the per-customer discount limit follows the merge', async () => {
    const { shop, product } = await newShop('mg-disc');
    const P = await guest(shop, product.id, phone(), 'P');
    const D = await guest(shop, product.id, phone(), 'D');
    const d = await f.createDiscount(shop, { usageLimitPerCustomer: 1 });
    await f.storefrontOrder(shop, [{ productId: product.id, quantity: 1 }], {
      customerPhone: D.phone,
      discountCode: d.code,
    });
    // before the merge the primary can still use it
    expect(
      (
        await f.storefrontOrderRaw(
          shop,
          [{ productId: product.id, quantity: 1 }],
          { customerPhone: P.phone, discountCode: d.code },
        )
      ).status,
    ).toBe(201);
    // a third customer, whose redemption count we use after merging into a fresh primary
    const P2 = await guest(shop, product.id, phone(), 'P2');
    const D2 = await guest(shop, product.id, phone(), 'D2');
    const d2 = await f.createDiscount(shop, { usageLimitPerCustomer: 1 });
    await f.storefrontOrder(shop, [{ productId: product.id, quantity: 1 }], {
      customerPhone: D2.phone,
      discountCode: d2.code,
    });
    await merge(shop, P2.id, [D2.id]).expect(201);
    const res = await f.storefrontOrderRaw(
      shop,
      [{ productId: product.id, quantity: 1 }],
      { customerPhone: P2.phone, discountCode: d2.code },
    );
    expect(res.status).toBe(409);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM discountredemption WHERE customerId = ? AND discountId = ?`,
        [P2.id, d2.id],
      ),
    ).toBe(1);
    await merge(shop, P.id, [D.id]).expect(201);
  });

  it('is idempotent: repeating the same request merges nothing twice', async () => {
    const { shop, product } = await newShop('mg-idem');
    const P = await guest(shop, product.id);
    const D = await guest(shop, product.id);
    await merge(shop, P.id, [D.id]).expect(201);
    const again = body<{ merged: unknown[]; alreadyMerged: number[] }>(
      await merge(shop, P.id, [D.id]).expect(201),
    );
    expect(again.merged).toEqual([]);
    expect(again.alreadyMerged).toEqual([D.id]);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM customermerge WHERE primaryCustomerId = ?`,
        [P.id],
      ),
    ).toBe(1);
    expect(
      await count(`SELECT COUNT(*) AS n FROM \`order\` WHERE customerId = ?`, [
        P.id,
      ]),
    ).toBe(2);
    // racing two identical merges: one record, no error other than a clean outcome
    const E = await guest(shop, product.id);
    const results = await Promise.all([
      merge(shop, P.id, [E.id]),
      merge(shop, P.id, [E.id]),
      merge(shop, P.id, [E.id]),
    ]);
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect(results.some((r) => r.status === 201)).toBe(true);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM customermerge WHERE duplicateCustomerId = ?`,
        [E.id],
      ),
    ).toBe(1);
    expect(
      await count(`SELECT COUNT(*) AS n FROM \`order\` WHERE customerId = ?`, [
        P.id,
      ]),
    ).toBe(3);
  });

  it('is atomic: a failure part-way through changes nothing', async () => {
    const { shop, product } = await newShop('mg-atomic');
    const P = await guest(shop, product.id);
    const D = await guest(shop, product.id);
    await grant(shop, D.id, 20);
    await api(shop, 'post', `/customers/${D.id}/notes`, {
      body: 'keep me where I am',
    }).expect(201);
    // moveLedger is a protected seam: reached through a minimal structural type.
    const svc = app.get<unknown>(CustomerMergeService) as {
      moveLedger: (this: void) => Promise<number>;
    };
    // orders and drafts have already moved when the ledger step fails
    const original: (this: void) => Promise<number> = svc.moveLedger;
    svc.moveLedger = () => Promise.reject(new Error('boom mid-merge'));
    try {
      await merge(shop, P.id, [D.id]).expect(500);
    } finally {
      svc.moveLedger = original;
    }
    expect(
      await count(`SELECT COUNT(*) AS n FROM customer WHERE id = ?`, [D.id]),
    ).toBe(1);
    expect(
      await count(`SELECT COUNT(*) AS n FROM \`order\` WHERE customerId = ?`, [
        D.id,
      ]),
    ).toBe(1);
    expect(
      await count(`SELECT COUNT(*) AS n FROM \`order\` WHERE customerId = ?`, [
        P.id,
      ]),
    ).toBe(1);
    expect(await balance(D.id)).toBe(20);
    expect(await balance(P.id)).toBe(0);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM customernote WHERE customerId = ?`,
        [D.id],
      ),
    ).toBe(1);
    expect(
      await count(`SELECT COUNT(*) AS n FROM customermerge WHERE shopId = ?`, [
        shop.shopId,
      ]),
    ).toBe(0);
    // and the merge still works afterwards
    await merge(shop, P.id, [D.id]).expect(201);
    expect(await balance(P.id)).toBe(20);
  });

  it('validates: not itself, typed confirmation, registered or deleted customers, unknown ids', async () => {
    const { shop, product } = await newShop('mg-val');
    const P = await guest(shop, product.id);
    const D = await guest(shop, product.id);
    await merge(shop, P.id, [P.id]).expect(400);
    await api(shop, 'post', `/customers/${P.id}/merge`, {
      duplicateIds: [D.id],
    }).expect(400);
    await api(shop, 'post', `/customers/${P.id}/merge`, {
      duplicateIds: [D.id],
      confirm: 'yes',
    }).expect(400);
    await api(shop, 'post', `/customers/${P.id}/merge`, {
      duplicateIds: [],
      confirm: 'MERGE',
    }).expect(400);
    await merge(shop, P.id, [999999999]).expect(404);
    // a registered duplicate would lose its login
    const reg = await registerCustomer(
      server(),
      shop.slug,
      phone(),
      `reg-${f.uniq()}@x.test`,
    );
    await merge(shop, P.id, [reg.customerId]).expect(409);
    // the other way round is fine: the registered customer is the one kept
    await merge(shop, reg.customerId, [P.id]).expect(201);
    expect(
      await count(`SELECT COUNT(*) AS n FROM customer WHERE id = ?`, [P.id]),
    ).toBe(0);
    // a deleted customer is neither a target nor a source
    const del = body<{ confirmationToken: string }>(
      await asCustomer(
        server(),
        reg,
        'delete',
        `/public/${shop.slug}/account/me`,
      ).expect(202),
    );
    await asCustomer(
      server(),
      reg,
      'delete',
      `/public/${shop.slug}/account/me/confirm?token=${del.confirmationToken}`,
    ).expect(200);
    await merge(shop, reg.customerId, [D.id]).expect(409);
    await merge(shop, D.id, [reg.customerId]).expect(409);
  });

  it('cross-tenant: ids of another shop are 404 on every endpoint and nothing changes', async () => {
    const a = await newShop('mg-xa');
    const b = await newShop('mg-xb');
    const Pa = await guest(a.shop, a.product.id);
    const Da = await guest(a.shop, a.product.id);
    const Pb = await guest(b.shop, b.product.id);
    // B tries to merge A's customers, or to pull A's customer into B's
    await merge(b.shop, Pa.id, [Da.id]).expect(404);
    await merge(b.shop, Pb.id, [Da.id]).expect(404);
    await merge(b.shop, Pa.id, [Pb.id]).expect(404);
    await api(b.shop, 'post', `/customers/${Pa.id}/merge-preview`, {
      duplicateIds: [Da.id],
    }).expect(404);
    await api(b.shop, 'get', `/customers/${Pa.id}/merges`)
      .expect(200)
      .then((r) => expect(r.body).toEqual([]));
    expect(
      await count(`SELECT COUNT(*) AS n FROM customer WHERE id IN (?, ?, ?)`, [
        Pa.id,
        Da.id,
        Pb.id,
      ]),
    ).toBe(3);
    expect(
      await count(`SELECT COUNT(*) AS n FROM \`order\` WHERE customerId = ?`, [
        Da.id,
      ]),
    ).toBe(1);
    expect(
      await count(`SELECT COUNT(*) AS n FROM customermerge`, [] as never),
    ).toBeGreaterThanOrEqual(0);
    // the merge history of A is invisible to B even by guessing the id
    await merge(a.shop, Pa.id, [Da.id]).expect(201);
    const seenByB = body<unknown[]>(
      await api(b.shop, 'get', `/customers/${Pa.id}/merges`).expect(200),
    );
    expect(seenByB).toEqual([]);
  });

  it('preview shows what will move and changes nothing', async () => {
    const { shop, product } = await newShop('mg-prev');
    const P = await guest(shop, product.id);
    const D = await guest(shop, product.id);
    const pv = body<{ willMove: { orders: number } }>(
      await api(shop, 'post', `/customers/${P.id}/merge-preview`, {
        duplicateIds: [D.id],
      }).expect(201),
    );
    expect(pv.willMove.orders).toBe(1);
    expect(
      await count(`SELECT COUNT(*) AS n FROM customer WHERE id = ?`, [D.id]),
    ).toBe(1);
  });

  it('a merge running alongside a store-credit checkout by the primary conserves the ledger', async () => {
    const { shop, product } = await newShop('mg-race');
    const sess = await registerCustomer(
      server(),
      shop.slug,
      phone(),
      `race-${f.uniq()}@x.test`,
    );
    const D = await guest(shop, product.id);
    await grant(shop, sess.customerId, 30);
    await grant(shop, D.id, 70);
    const attempt = asCustomer(
      server(),
      sess,
      'post',
      `/public/${shop.slug}/orders`,
    ).send({
      outletId: shop.outletId,
      orderType: 'pickup',
      paymentMethod: 'cash_on_pickup',
      customerName: 'R',
      customerPhone: phone(),
      customerAddress: 'Pickup',
      items: [{ productId: product.id, quantity: 1 }],
      useStoreCredit: true,
    });
    const [spend, mergeRes] = await Promise.all([
      attempt,
      merge(shop, sess.customerId, [D.id]),
    ]);
    expect([201, 409]).toContain(spend.status);
    expect([201, 409]).toContain(mergeRes.status);
    const spent = await db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(-amount), 0) AS s FROM storecreditentry WHERE shopId = ? AND entryType = 'spend'`,
      [shop.shopId],
    );
    const totalRows = await db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM storecreditentry WHERE shopId = ?`,
      [shop.shopId],
    );
    const total = totalRows[0].s as string;
    // 100 granted in total, whatever was spent is the only thing missing
    expect(Number(total)).toBe(100 - Number(spent[0].s));
    if (mergeRes.status === 201) {
      expect(await balance(sess.customerId)).toBe(100 - Number(spent[0].s));
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM storecreditentry WHERE customerId = ?`,
          [D.id],
        ),
      ).toBe(0);
    }
  });

  it('role matrix: only an admin merges; a viewer can read the history', async () => {
    const { shop, product } = await newShop('mg-role');
    const P = await guest(shop, product.id);
    const D = await guest(shop, product.id);
    const viewer = await createStaffToken(app, shop.adminToken, 'mg', 'viewer');
    const branch = await createStaffToken(
      app,
      shop.adminToken,
      'mg',
      'branch',
      shop.outletId,
    );
    const om = await createStaffToken(
      app,
      shop.adminToken,
      'mg',
      'order_manager',
    );
    const as = (
      t: string,
      method: 'get' | 'post',
      path: string,
      data?: object,
    ) =>
      request(server())
        [method](path)
        .set('Authorization', `Bearer ${t}`)
        .send(data);
    await as(viewer, 'get', `/customers/${P.id}/merges`).expect(200);
    for (const t of [viewer, branch, om]) {
      await as(t, 'post', `/customers/${P.id}/merge`, {
        duplicateIds: [D.id],
        confirm: 'MERGE',
      }).expect(403);
      await as(t, 'post', `/customers/${P.id}/merge-preview`, {
        duplicateIds: [D.id],
      }).expect(403);
    }
    for (const t of [branch, om])
      await as(t, 'get', `/customers/${P.id}/merges`).expect(403);
    expect(
      await count(`SELECT COUNT(*) AS n FROM customer WHERE id = ?`, [D.id]),
    ).toBe(1);
  });

  it('PDPL: anonymising the primary scrubs the old contact snapshot of merged duplicates', async () => {
    const { shop, product } = await newShop('mg-pdpl');
    const sess = await registerCustomer(
      server(),
      shop.slug,
      phone(),
      `pd-${f.uniq()}@x.test`,
    );
    const D = await guest(shop, product.id, phone(), 'Old Name');
    await merge(shop, sess.customerId, [D.id]).expect(201);
    const del = body<{ confirmationToken: string }>(
      await asCustomer(
        server(),
        sess,
        'delete',
        `/public/${shop.slug}/account/me`,
      ).expect(202),
    );
    await asCustomer(
      server(),
      sess,
      'delete',
      `/public/${shop.slug}/account/me/confirm?token=${del.confirmationToken}`,
    ).expect(200);
    const rec = await db.query<RowDataPacket[]>(
      `SELECT duplicateName, duplicatePhone, duplicateEmail FROM customermerge WHERE primaryCustomerId = ?`,
      [sess.customerId],
    );
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({
      duplicateName: null,
      duplicatePhone: null,
      duplicateEmail: null,
    });
  });
});
