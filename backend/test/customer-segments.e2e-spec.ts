import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';
import { createStaffToken } from './helpers/staff-login';

jest.setTimeout(240000);

describe('Customer segments (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let seq = 0;
  const phone = () => `05${String(Date.now() % 100000)}${String(++seq).padStart(3, '0')}`;

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
  });
  afterAll(async () => {
    await app.close();
  });

  type Shop = Awaited<ReturnType<typeof f.setupShop>>;
  const api = (shop: Shop, method: 'get' | 'post' | 'put' | 'delete' | 'patch', path: string, data?: object) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${shop.adminToken}`).send(data);

  async function orderFor(shop: Shop, productId: number, p: string, name = 'Seg Customer', qty = 1) {
    await f.storefrontOrder(shop, [{ productId, quantity: qty }], { customerPhone: p, customerName: name });
    const rows = await db.query<RowDataPacket[]>(`SELECT id FROM customer WHERE shopId = ? AND phone = ?`, [shop.shopId, p]);
    return rows[0].id as number;
  }
  async function members(shop: Shop, segmentId: number) {
    const res = body<{ data: { id: number }[]; total: number }>(
      await api(shop, 'get', `/customers?segmentId=${segmentId}&pageSize=100`).expect(200),
    );
    return res.data.map((c) => c.id).sort((a, b) => a - b);
  }
  async function segment(shop: Shop, name: string, rules: object) {
    return body<{ id: number }>(await api(shop, 'post', '/customer-segments', { name, rules }).expect(201)).id;
  }

  it('evaluates order count, spend per currency, recency, tag and consent live; OR and AND compose', async () => {
    const shop = await f.setupShop('seg-eval');
    const product = await f.stockedProduct(shop, 100, { price: 100 });
    await f.publish(shop);
    const one = await orderFor(shop, product.id, phone(), 'One');
    const twoPhone = phone();
    const two = await orderFor(shop, product.id, twoPhone, 'Two');
    await orderFor(shop, product.id, twoPhone, 'Two');
    // a cancelled order must not count
    const three = await orderFor(shop, product.id, phone(), 'Three');
    const o3 = await db.query<RowDataPacket[]>(`SELECT id FROM \`order\` WHERE customerId = ?`, [three]);
    await f.cancelOrder(shop, o3[0].id as number).expect(201);

    const repeat = await segment(shop, 'Repeat', { field: 'orderCount', cmp: 'gte', value: 2 });
    expect(await members(shop, repeat)).toEqual([two]);
    const never = await segment(shop, 'Never (cancelled only)', { field: 'orderCount', cmp: 'eq', value: 0 });
    expect(await members(shop, never)).toEqual([three]);

    // spend is compared within ONE currency: AED orders do not satisfy a KWD rule
    const bigAed = await segment(shop, 'Big AED', { field: 'lifetimeSpend', cmp: 'gte', value: '150', currency: 'AED' });
    expect(await members(shop, bigAed)).toEqual([two]);
    const bigKwd = await segment(shop, 'Big KWD', { field: 'lifetimeSpend', cmp: 'gte', value: '1', currency: 'KWD' });
    expect(await members(shop, bigKwd)).toEqual([]);

    // recency
    await db.execute(`UPDATE \`order\` SET createdAt = DATE_SUB(NOW(3), INTERVAL 100 DAY) WHERE customerId = ?`, [one]);
    const lapsed = await segment(shop, 'Lapsed', { field: 'lastOrderDaysAgo', cmp: 'gt', value: 90 });
    expect(await members(shop, lapsed)).toEqual([one]);
    const recent = await segment(shop, 'Recent', { field: 'lastOrderDaysAgo', cmp: 'lte', value: 90 });
    expect(await members(shop, recent)).toEqual([two]);

    // tag + consent
    const tag = body<{ id: number }>(await api(shop, 'post', '/customer-tags', { name: 'VIP' }).expect(201));
    await api(shop, 'post', '/customer-tags/assign', { customerIds: [one], tagIds: [tag.id] }).expect(201);
    await api(shop, 'put', `/customers/${two}/consent`, { channel: 'email', status: 'granted', note: 'verbal' }).expect(200);
    const tagged = await segment(shop, 'VIPs', { field: 'tag', cmp: 'has', value: tag.id });
    expect(await members(shop, tagged)).toEqual([one]);
    const unknownEmail = await segment(shop, 'Unasked', { field: 'consent', cmp: 'is', channel: 'email', value: 'unknown' });
    expect(await members(shop, unknownEmail)).toEqual([one, three].sort((a, b) => a - b));
    const granted = await segment(shop, 'Opted in', { field: 'consent', cmp: 'is', channel: 'email', value: 'granted' });
    expect(await members(shop, granted)).toEqual([two]);

    const either = await segment(shop, 'VIP or opted in', {
      op: 'or',
      rules: [
        { field: 'tag', cmp: 'has', value: tag.id },
        { field: 'consent', cmp: 'is', channel: 'email', value: 'granted' },
      ],
    });
    expect(await members(shop, either)).toEqual([one, two].sort((a, b) => a - b));
    const both = await segment(shop, 'VIP and opted in', {
      op: 'and',
      rules: [
        { field: 'tag', cmp: 'has', value: tag.id },
        { field: 'consent', cmp: 'is', channel: 'email', value: 'granted' },
      ],
    });
    expect(await members(shop, both)).toEqual([]);

    // preview of an unsaved tree equals what saving it yields
    const pv = body<{ count: number }>(
      await api(shop, 'post', '/customer-segments/preview', { rules: { field: 'orderCount', cmp: 'gte', value: 1 } }).expect(201),
    );
    expect(pv.count).toBe(2);

    // the list endpoint filters AND paginates the segment
    const filtered = body<{ total: number }>(await api(shop, 'get', `/customers?segmentId=${repeat}&search=Two`).expect(200));
    expect(filtered.total).toBe(1);
  });

  it('a KWD order is counted in KWD only', async () => {
    const shop = await f.setupShop('seg-kwd');
    const product = await f.stockedProduct(shop, 20, { price: 10.505 });
    await f.setShop(shop, { currency: 'KWD' });
    await f.publish(shop);
    const c = await orderFor(shop, product.id, phone(), 'Kuwaiti', 2);
    const atLeast = async (value: string, currency: string, cmp = 'gte') =>
      members(shop, await segment(shop, `s-${f.uniq()}`, { field: 'lifetimeSpend', cmp, value, currency }));
    const total = await db.query<RowDataPacket[]>(`SELECT total FROM \`order\` WHERE customerId = ?`, [c]);
    const exact = String(Number(total[0].total));
    expect(await atLeast(exact, 'KWD', 'eq')).toEqual([c]);
    expect(await atLeast('0', 'AED', 'gt')).toEqual([]);
  });

  it('rejects injection, unknown fields and depth bombs over HTTP, and stores nothing', async () => {
    const shop = await f.setupShop('seg-inj');
    const bad: object[] = [
      { field: 'orderCount', cmp: 'eq', value: '1 OR 1=1' },
      { field: 'passwordHash', cmp: 'eq', value: 1 },
      { field: 'tag', cmp: 'has', value: 1, extra: 'x' },
      { op: 'and', rules: [] },
      { field: 'lifetimeSpend', cmp: 'gt', value: '1', currency: "AED' OR 1=1 --" },
    ];
    for (const rules of bad) {
      await api(shop, 'post', '/customer-segments', { name: 'bad', rules }).expect(400);
      await api(shop, 'post', '/customer-segments/preview', { rules }).expect(400);
    }
    let deep: object = { field: 'orderCount', cmp: 'eq', value: 1 };
    for (let i = 0; i < 40; i += 1) deep = { op: 'and', rules: [deep] };
    await api(shop, 'post', '/customer-segments', { name: 'deep', rules: deep }).expect(400);
    const rows = await db.query<RowDataPacket[]>(`SELECT id FROM customersegment WHERE shopId = ?`, [shop.shopId]);
    expect(rows).toHaveLength(0);
    // duplicate names are a 409
    await segment(shop, 'dup', { field: 'orderCount', cmp: 'eq', value: 1 });
    await api(shop, 'post', '/customer-segments', { name: 'dup', rules: { field: 'orderCount', cmp: 'eq', value: 1 } }).expect(409);
  });

  it('a tampered stored rule row is re-validated before it reaches SQL', async () => {
    const shop = await f.setupShop('seg-tamper');
    const id = await segment(shop, 'ok', { field: 'orderCount', cmp: 'eq', value: 1 });
    await db.execute(`UPDATE customersegment SET rules = ? WHERE id = ?`, [
      JSON.stringify({ field: 'orderCount', cmp: 'eq', value: '1) OR (1=1' }),
      id,
    ]);
    await api(shop, 'get', `/customers?segmentId=${id}`).expect(400);
  });

  it('cross-tenant: another shop cannot read, change, delete, list members of or export my segment, and my rules never see its rows', async () => {
    const a = await f.setupShop('seg-xa');
    const b = await f.setupShop('seg-xb');
    const pa = await f.stockedProduct(a, 10);
    const pb = await f.stockedProduct(b, 10);
    await f.publish(a);
    await f.publish(b);
    const custA = await orderFor(a, pa.id, phone(), 'A person');
    const custB = await orderFor(b, pb.id, phone(), 'B person');
    const segA = await segment(a, 'A segment', { field: 'orderCount', cmp: 'gte', value: 1 });

    await api(b, 'get', `/customer-segments/${segA}`).expect(404);
    await api(b, 'put', `/customer-segments/${segA}`, { name: 'x', rules: { field: 'orderCount', cmp: 'eq', value: 1 } }).expect(404);
    await api(b, 'delete', `/customer-segments/${segA}`).expect(404);
    await api(b, 'get', `/customers?segmentId=${segA}`).expect(404);
    await api(b, 'get', `/exports/customer-segment?segmentId=${segA}`).expect(404);
    const listB = body<{ id: number }[]>(await api(b, 'get', '/customer-segments').expect(200));
    expect(listB.map((s) => s.id)).not.toContain(segA);
    expect((await db.query<RowDataPacket[]>(`SELECT id FROM customersegment WHERE id = ?`, [segA])).length).toBe(1);

    // the same rule evaluated in each shop only ever returns that shop's customers
    const segB = await segment(b, 'B segment', { field: 'orderCount', cmp: 'gte', value: 1 });
    expect(await members(a, segA)).toEqual([custA]);
    expect(await members(b, segB)).toEqual([custB]);
    // a tag rule naming ANOTHER shop's tag id matches nobody
    const tagA = body<{ id: number }>(await api(a, 'post', '/customer-tags', { name: 'A tag' }).expect(201));
    await api(a, 'post', '/customer-tags/assign', { customerIds: [custA], tagIds: [tagA.id] }).expect(201);
    const spy = await segment(b, 'spy', { field: 'tag', cmp: 'has', value: tagA.id });
    expect(await members(b, spy)).toEqual([]);
    const spyCount = body<{ count: number }>(
      await api(b, 'post', '/customer-segments/preview', { rules: { field: 'tag', cmp: 'has', value: tagA.id } }).expect(201),
    );
    expect(spyCount.count).toBe(0);
  });

  it('exports the members as CSV with formula cells neutralised', async () => {
    const shop = await f.setupShop('seg-csv');
    const product = await f.stockedProduct(shop, 10);
    await f.publish(shop);
    const evilName = '=HYPERLINK("http://evil.test","x")';
    const p = phone();
    await orderFor(shop, product.id, p, evilName);
    const seg = await segment(shop, 'all', { field: 'orderCount', cmp: 'gte', value: 1 });
    const res = await api(shop, 'get', `/exports/customer-segment?segmentId=${seg}`).expect(200);
    const text = String(res.text);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(text).toContain(`'=HYPERLINK`);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    // an ordinary phone number is left readable
    expect(text).toContain(p);
    await api(shop, 'get', '/exports/customer-segment').expect(400);
  });

  it('role matrix: viewer reads, only admin writes; branch and order_manager get nothing', async () => {
    const shop = await f.setupShop('seg-roles');
    const viewer = await createStaffToken(app, shop.adminToken, 'seg', 'viewer');
    const branch = await createStaffToken(app, shop.adminToken, 'seg', 'branch', shop.outletId);
    const om = await createStaffToken(app, shop.adminToken, 'seg', 'order_manager');
    const id = await segment(shop, 'roles', { field: 'orderCount', cmp: 'eq', value: 1 });
    const as = (token: string, method: 'get' | 'post' | 'delete', path: string, data?: object) =>
      request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`).send(data);
    await as(viewer, 'get', '/customer-segments').expect(200);
    await as(viewer, 'get', `/customer-segments/${id}`).expect(200);
    await as(viewer, 'post', '/customer-segments', { name: 'v', rules: { field: 'orderCount', cmp: 'eq', value: 1 } }).expect(403);
    await as(viewer, 'delete', `/customer-segments/${id}`).expect(403);
    for (const t of [branch, om]) {
      await as(t, 'get', '/customer-segments').expect(403);
      await as(t, 'get', `/exports/customer-segment?segmentId=${id}`).expect(403);
    }
  });
});
