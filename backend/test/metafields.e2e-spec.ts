import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface IdRow {
  id: number;
}
interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface Def {
  id: number;
  key: string;
  namespace: string;
  ownerType: string;
  type: string;
  value?: unknown;
}
interface Shop {
  slug: string;
  shopId: number;
  admin: string;
  outletId: number;
  outlet2Id: number;
  productId: number;
  productSlug: string;
  collectionId: number;
  variantId: number;
  customerId: number;
  orderId: number; // outlet 1
  order2Id: number; // outlet 2
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(180000);

describe('Metafields (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  let A: Shop;
  let B: Shop;
  let branchToken: string; // shop A, pinned to outlet 1
  let viewerToken: string;
  let orderMgrToken: string;
  let adminAId: number;

  const http = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function staff(
    shop: Shop,
    role: string,
    outletId: number | undefined,
    prefix: string,
  ) {
    const email = `${prefix}-${runId}@test.com`;
    await request(http())
      .post('/auth/branch-users')
      .set(auth(shop.admin))
      .send({
        name: prefix,
        email,
        password: 'password123',
        role,
        ...(outletId !== undefined ? { outletId } : {}),
      })
      .expect(201);
    const login = await request(http())
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(201);
    return body<AuthResponse>(login).accessToken;
  }

  async function setupShop(prefix: string): Promise<Shop> {
    const slug = `${prefix}-${runId}`;
    const signup = await request(http())
      .post('/auth/signup')
      .send({
        name: 'MF Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const admin = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      http(),
      body<AuthResponse>(signup).devVerificationLink,
    );
    const shopId = (
      await db.query<RowDataPacket[]>(
        `SELECT id FROM shop WHERE subdomain = ?`,
        [slug],
      )
    )[0].id as number;
    const outlets = await request(http())
      .get('/outlets')
      .set(auth(admin))
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(http())
      .patch(`/outlets/${outletId}`)
      .set(auth(admin))
      .send({ active: true, pickupEnabled: true })
      .expect(200);
    const o2 = await request(http())
      .post('/outlets')
      .set(auth(admin))
      .send({ name: 'Second outlet' })
      .expect(201);
    const outlet2Id = body<IdRow>(o2).id;
    const col = await request(http())
      .post('/collections')
      .set(auth(admin))
      .send({ name: 'MF collection' })
      .expect(201);
    const collectionId = body<IdRow>(col).id;
    const prod = await request(http())
      .post('/products')
      .set(auth(admin))
      .send({
        name: 'MF product',
        price: 50,
        thumbnail: 'https://example.com/x.jpg',
        sku: `MF-${slug}`,
        collectionIds: [collectionId],
      })
      .expect(201);
    const productId = body<IdRow>(prod).id;
    const productSlug = body<{ slug: string }>(prod).slug;
    const opts = await request(http())
      .put(`/products/${productId}/options`)
      .set(auth(admin))
      .send({ options: [{ name: 'Size', values: ['S', 'M'] }] })
      .expect(200);
    void opts;
    const variantId = (
      await db.query<RowDataPacket[]>(
        `SELECT id FROM productvariant WHERE productId = ? ORDER BY id ASC LIMIT 1`,
        [productId],
      )
    )[0].id as number;
    const cust = await db.execute(
      `INSERT INTO customer (shopId, name, phone) VALUES (?, ?, ?)`,
      [shopId, 'MF Customer', `05${String(runId).slice(-8)}`],
    );
    const mkOrder = async (oid: number) => {
      const r = await request(http())
        .post('/orders')
        .set(auth(admin))
        .send({
          customerName: 'MF Cust',
          customerPhone: '0501234567',
          customerAddress: '1 Test Rd',
          outletId: oid,
          items: [{ productId, variantId, quantity: 1 }],
        });
      expect(r.status).toBe(201);
      return body<IdRow>(r).id;
    };
    const orderId = await mkOrder(outletId);
    const order2Id = await mkOrder(outlet2Id);
    await request(http())
      .patch('/shop')
      .set(auth(admin))
      .send({ published: true })
      .expect(200);
    return {
      slug,
      shopId,
      admin,
      outletId,
      outlet2Id,
      productId,
      productSlug,
      collectionId,
      variantId,
      customerId: cust.insertId,
      orderId,
      order2Id,
    };
  }

  async function mkDef(
    shop: Shop,
    ownerType: string,
    key: string,
    type: string,
    extra: Record<string, unknown> = {},
  ): Promise<Def> {
    const res = await request(http())
      .post('/metafield-definitions')
      .set(auth(shop.admin))
      .send({
        ownerType,
        namespace: 'custom',
        key,
        name: `Field ${key}`,
        type,
        ...extra,
      });
    expect(res.status).toBe(201);
    return body<Def>(res);
  }

  const valueRows = (ownerType: string, ownerId: number) =>
    db.query<RowDataPacket[]>(
      `SELECT * FROM metafieldvalue WHERE ownerType = ? AND ownerId = ?`,
      [ownerType, ownerId],
    );

  const put = (token: string, t: string, id: number, values: unknown[]) =>
    request(http())
      .put(`/metafields/${t}/${id}`)
      .set(auth(token))
      .send({ values });

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DatabaseService);
    A = await setupShop('mf-a');
    B = await setupShop('mf-b');
    branchToken = await staff(A, 'branch', A.outletId, 'mf-branch');
    viewerToken = await staff(A, 'viewer', undefined, 'mf-viewer');
    orderMgrToken = await staff(A, 'order_manager', undefined, 'mf-om');
    adminAId = (
      await db.query<RowDataPacket[]>(
        `SELECT id FROM user WHERE shopId = ? AND role = 'admin'`,
        [A.shopId],
      )
    )[0].id as number;
    void adminAId;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('definitions', () => {
    it('creates every supported type and rejects bad config / duplicates / unknown fields', async () => {
      const t = (k: string, type: string, extra?: Record<string, unknown>) =>
        mkDef(A, 'product', `d_${k}`, type, extra);
      await t('text', 'text', { validation: { maxLength: 10 } });
      await t('multi', 'multiline');
      await t('num', 'number', {
        validation: { min: 0, max: 5, integer: true },
      });
      await t('bool', 'boolean');
      await t('date', 'date');
      await t('json', 'json');
      await t('single', 'single_select', {
        validation: { options: ['a', 'b'] },
      });
      await t('multisel', 'multi_select', {
        validation: { options: ['a', 'b'] },
      });

      const post = (b: Record<string, unknown>) =>
        request(http())
          .post('/metafield-definitions')
          .set(auth(A.admin))
          .send({
            ownerType: 'product',
            namespace: 'custom',
            key: 'zz',
            name: 'Z',
            type: 'text',
            ...b,
          });
      await post({ key: 'd_text' }).expect(409);
      await post({ type: 'single_select' }).expect(400); // options required
      await post({ type: 'file' }).expect(400); // deferred type
      await post({ key: 'Bad-Key' }).expect(400);
      await post({ validation: { min: 1 } }).expect(400);
      await post({ ownerType: 'shop' }).expect(400);
      await post({ shopId: B.shopId }).expect(400); // forbidNonWhitelisted
      // Personal-data owners can never be storefront-visible.
      await post({ ownerType: 'customer', visibleOnStorefront: true }).expect(
        400,
      );
      await post({ ownerType: 'order', visibleOnStorefront: true }).expect(400);
    });

    it('is admin-only to write, open to read, and tenant-scoped', async () => {
      const def = await mkDef(A, 'collection', 'tenant_probe', 'text');
      for (const t of [branchToken, viewerToken, orderMgrToken]) {
        await request(http())
          .post('/metafield-definitions')
          .set(auth(t))
          .send({
            ownerType: 'product',
            namespace: 'custom',
            key: 'nope',
            name: 'N',
            type: 'text',
          })
          .expect(403);
        await request(http())
          .patch(`/metafield-definitions/${def.id}`)
          .set(auth(t))
          .send({ name: 'x' })
          .expect(403);
        await request(http())
          .delete(`/metafield-definitions/${def.id}`)
          .set(auth(t))
          .expect(403);
        await request(http())
          .get('/metafield-definitions')
          .set(auth(t))
          .expect(200);
      }
      // Shop B: cannot see, edit or delete A's definition.
      const listB = body<Def[]>(
        await request(http())
          .get('/metafield-definitions')
          .set(auth(B.admin))
          .expect(200),
      );
      expect(listB.map((d) => d.id)).not.toContain(def.id);
      await request(http())
        .patch(`/metafield-definitions/${def.id}`)
        .set(auth(B.admin))
        .send({ name: 'hijack' })
        .expect(404);
      await request(http())
        .delete(`/metafield-definitions/${def.id}`)
        .set(auth(B.admin))
        .expect(404);
      const still = await db.query<RowDataPacket[]>(
        `SELECT name FROM metafielddefinition WHERE id = ?`,
        [def.id],
      );
      expect(still[0].name).toBe('Field tenant_probe');
      // Same namespace.key is free in another shop.
      await mkDef(B, 'collection', 'tenant_probe', 'text');
    });

    it('type, ownerType and key are immutable (PATCH rejects them)', async () => {
      const d = await mkDef(A, 'product', 'immut', 'text');
      for (const f of [
        { type: 'number' },
        { ownerType: 'order' },
        { key: 'other' },
        { namespace: 'x' },
      ]) {
        await request(http())
          .patch(`/metafield-definitions/${d.id}`)
          .set(auth(A.admin))
          .send(f)
          .expect(400);
      }
    });
  });

  describe('values on every owner type', () => {
    const cases: [string, () => number][] = [
      ['product', () => A.productId],
      ['variant', () => A.variantId],
      ['collection', () => A.collectionId],
      ['customer', () => A.customerId],
      ['order', () => A.orderId],
      ['outlet', () => A.outletId],
    ];

    it.each(cases)(
      '%s: set, read back, update, clear',
      async (ownerType, id) => {
        const d = await mkDef(A, ownerType, 'roundtrip', 'number', {
          validation: { min: 0, max: 10 },
        });
        const set = await put(A.admin, ownerType, id(), [
          { definitionId: d.id, value: 7 },
        ]).expect(200);
        expect(body<Def[]>(set).find((x) => x.id === d.id)?.value).toBe(7);
        await put(A.admin, ownerType, id(), [
          { definitionId: d.id, value: 9 },
        ]).expect(200);
        const get = await request(http())
          .get(`/metafields/${ownerType}/${id()}`)
          .set(auth(A.admin))
          .expect(200);
        expect(body<Def[]>(get).find((x) => x.id === d.id)?.value).toBe(9);
        const rows = (await valueRows(ownerType, id())).filter(
          (r) => r.definitionId === d.id,
        );
        expect(rows).toHaveLength(1); // upsert, not duplicate
        await put(A.admin, ownerType, id(), [
          { definitionId: d.id, value: null },
        ]).expect(200);
        expect(
          (await valueRows(ownerType, id())).filter(
            (r) => r.definitionId === d.id,
          ),
        ).toHaveLength(0);
      },
    );

    it('rejects values that violate the definition (400) and writes nothing, even for the valid entries in the same request', async () => {
      const ok = await mkDef(A, 'product', 'v_ok', 'text');
      const num = await mkDef(A, 'product', 'v_num', 'number', {
        validation: { min: 0, max: 5, integer: true },
      });
      const sel = await mkDef(A, 'product', 'v_sel', 'single_select', {
        validation: { options: ['x', 'y'] },
      });
      const date = await mkDef(A, 'product', 'v_date', 'date');
      const txt = await mkDef(A, 'product', 'v_txt', 'text', {
        validation: { maxLength: 3 },
      });
      for (const [def, value] of [
        [num, 6],
        [num, 1.5],
        [num, '3'],
        [sel, 'z'],
        [date, '2026-13-01'],
        [txt, 'abcd'],
      ] as [Def, unknown][]) {
        await put(A.admin, 'product', A.productId, [
          { definitionId: ok.id, value: 'should not persist' },
          { definitionId: def.id, value },
        ]).expect(400);
      }
      expect(
        (await valueRows('product', A.productId)).filter(
          (r) => r.definitionId === ok.id,
        ),
      ).toHaveLength(0);
      await put(A.admin, 'product', A.productId, [
        { definitionId: ok.id, value: 'a' },
        { definitionId: ok.id, value: 'b' },
      ]).expect(400); // duplicate definition in one request
    });
  });

  describe('cross-tenant isolation (IDOR)', () => {
    it.each([
      ['product', () => A.productId, () => B.productId],
      ['variant', () => A.variantId, () => B.variantId],
      ['collection', () => A.collectionId, () => B.collectionId],
      ['customer', () => A.customerId, () => B.customerId],
      ['order', () => A.orderId, () => B.orderId],
      ['outlet', () => A.outletId, () => B.outletId],
    ] as [string, () => number, () => number][])(
      "%s: shop B cannot read or write shop A's record, and nothing is written",
      async (ownerType, aId, bId) => {
        const bDef = await mkDef(B, ownerType, 'xtenant', 'text');
        // B's own definition against A's record: 404, no row.
        await put(B.admin, ownerType, aId(), [
          { definitionId: bDef.id, value: 'leak' },
        ]).expect(404);
        await request(http())
          .get(`/metafields/${ownerType}/${aId()}`)
          .set(auth(B.admin))
          .expect(404);
        expect(
          (await valueRows(ownerType, aId())).filter(
            (r) => r.definitionId === bDef.id,
          ),
        ).toHaveLength(0);
        // A's definition against B's own record: refused, no row.
        const aDef = await mkDef(A, ownerType, 'xtenant', 'text');
        await put(B.admin, ownerType, bId(), [
          { definitionId: aDef.id, value: 'leak' },
        ]).expect(404);
        expect(
          (await valueRows(ownerType, bId())).filter(
            (r) => r.definitionId === aDef.id,
          ),
        ).toHaveLength(0);
        // Mixed batch: a valid B entry next to a foreign definition is all-or-nothing.
        await put(B.admin, ownerType, bId(), [
          { definitionId: bDef.id, value: 'fine' },
          { definitionId: aDef.id, value: 'leak' },
        ]).expect(404);
        expect(
          (await valueRows(ownerType, bId())).filter(
            (r) => r.definitionId === bDef.id,
          ),
        ).toHaveLength(0);
      },
    );

    it('a definition for another owner type is refused (400)', async () => {
      const orderDef = await mkDef(A, 'order', 'wrongtype', 'text');
      await put(A.admin, 'product', A.productId, [
        { definitionId: orderDef.id, value: 'x' },
      ]).expect(400);
      expect(
        (await valueRows('product', A.productId)).filter(
          (r) => r.definitionId === orderDef.id,
        ),
      ).toHaveLength(0);
    });

    it('rejects unknown owner types and non-numeric ids', async () => {
      await request(http())
        .get(`/metafields/shop/1`)
        .set(auth(A.admin))
        .expect(400);
      await request(http())
        .get(`/metafields/product/abc`)
        .set(auth(A.admin))
        .expect(400);
      await request(http())
        .get(`/metafields/product/99999999`)
        .set(auth(A.admin))
        .expect(404);
    });
  });

  describe('roles and outlet scoping', () => {
    it('products/variants/collections: every role reads, only admin writes', async () => {
      const d = await mkDef(A, 'product', 'role_probe', 'text');
      for (const t of [branchToken, viewerToken, orderMgrToken]) {
        await request(http())
          .get(`/metafields/product/${A.productId}`)
          .set(auth(t))
          .expect(200);
        await put(t, 'product', A.productId, [
          { definitionId: d.id, value: 'x' },
        ]).expect(403);
      }
      await put(A.admin, 'product', A.productId, [
        { definitionId: d.id, value: 'ok' },
      ]).expect(200);
    });

    it('customers follow customers: viewer reads, order_manager and branch cannot, only admin writes', async () => {
      const d = await mkDef(A, 'customer', 'role_probe', 'text');
      await request(http())
        .get(`/metafields/customer/${A.customerId}`)
        .set(auth(viewerToken))
        .expect(200);
      await request(http())
        .get(`/metafields/customer/${A.customerId}`)
        .set(auth(orderMgrToken))
        .expect(403);
      await request(http())
        .get(`/metafields/customer/${A.customerId}`)
        .set(auth(branchToken))
        .expect(403);
      await put(viewerToken, 'customer', A.customerId, [
        { definitionId: d.id, value: 'x' },
      ]).expect(403);
      await put(A.admin, 'customer', A.customerId, [
        { definitionId: d.id, value: 'x' },
      ]).expect(200);
    });

    it('orders: branch is pinned to its own outlet (other outlet is 404), viewer is read-only', async () => {
      const d = await mkDef(A, 'order', 'role_probe', 'text');
      await put(branchToken, 'order', A.orderId, [
        { definitionId: d.id, value: 'mine' },
      ]).expect(200);
      await request(http())
        .get(`/metafields/order/${A.orderId}`)
        .set(auth(branchToken))
        .expect(200);
      await request(http())
        .get(`/metafields/order/${A.order2Id}`)
        .set(auth(branchToken))
        .expect(404);
      await put(branchToken, 'order', A.order2Id, [
        { definitionId: d.id, value: 'spoof' },
      ]).expect(404);
      expect(
        (await valueRows('order', A.order2Id)).filter(
          (r) => r.definitionId === d.id,
        ),
      ).toHaveLength(0);
      await put(orderMgrToken, 'order', A.order2Id, [
        { definitionId: d.id, value: 'om' },
      ]).expect(200);
      await request(http())
        .get(`/metafields/order/${A.orderId}`)
        .set(auth(viewerToken))
        .expect(200);
      await put(viewerToken, 'order', A.orderId, [
        { definitionId: d.id, value: 'v' },
      ]).expect(403);
    });

    it('outlets: branch reads only its own outlet and can never write', async () => {
      const d = await mkDef(A, 'outlet', 'role_probe', 'text');
      await request(http())
        .get(`/metafields/outlet/${A.outletId}`)
        .set(auth(branchToken))
        .expect(200);
      await request(http())
        .get(`/metafields/outlet/${A.outlet2Id}`)
        .set(auth(branchToken))
        .expect(404);
      await put(branchToken, 'outlet', A.outletId, [
        { definitionId: d.id, value: 'x' },
      ]).expect(403);
      await put(branchToken, 'outlet', A.outlet2Id, [
        { definitionId: d.id, value: 'x' },
      ]).expect(403);
    });

    it('a branch-role override that lacks orders.manage blocks writing an order value (restrict-only still holds)', async () => {
      const d = await mkDef(A, 'order', 'override_probe', 'text');
      const role = await request(http())
        .post('/shop/branch-roles')
        .set(auth(A.admin))
        .send({ name: `view-only-${runId}`, permissions: ['orders.view'] })
        .expect(201);
      const branchUserId = (
        await db.query<RowDataPacket[]>(`SELECT id FROM user WHERE email = ?`, [
          `mf-branch-${runId}@test.com`,
        ])
      )[0].id as number;
      await request(http())
        .post('/shop/branch-roles/assignments')
        .set(auth(A.admin))
        .send({
          userId: branchUserId,
          outletId: A.outletId,
          branchRoleId: body<IdRow>(role).id,
        })
        .expect(201);
      await request(http())
        .get(`/metafields/order/${A.orderId}`)
        .set(auth(branchToken))
        .expect(200);
      await put(branchToken, 'order', A.orderId, [
        { definitionId: d.id, value: 'no' },
      ]).expect(403);
      await db.execute(
        `DELETE FROM useroutletrole WHERE userId = ? AND outletId = ?`,
        [branchUserId, A.outletId],
      );
    });
  });

  describe('definition deletion and edits never corrupt stored values', () => {
    it('delete is a 409 while values exist; deleteValues=true removes both in one go', async () => {
      const d = await mkDef(A, 'product', 'del_probe', 'text');
      await put(A.admin, 'product', A.productId, [
        { definitionId: d.id, value: 'keep' },
      ]).expect(200);
      const r = await request(http())
        .delete(`/metafield-definitions/${d.id}`)
        .set(auth(A.admin))
        .expect(409);
      expect(JSON.stringify(r.body)).toMatch(/1 value/);
      expect(
        (await valueRows('product', A.productId)).filter(
          (x) => x.definitionId === d.id,
        ),
      ).toHaveLength(1);
      const ok = await request(http())
        .delete(`/metafield-definitions/${d.id}?deleteValues=true`)
        .set(auth(A.admin))
        .expect(200);
      expect(body<{ valuesDeleted: number }>(ok).valuesDeleted).toBe(1);
      expect(
        await db.query(`SELECT 1 FROM metafielddefinition WHERE id = ?`, [
          d.id,
        ]),
      ).toHaveLength(0);
      expect(
        await db.query(`SELECT 1 FROM metafieldvalue WHERE definitionId = ?`, [
          d.id,
        ]),
      ).toHaveLength(0);
    });

    it('a definition with no values deletes plainly', async () => {
      const d = await mkDef(A, 'product', 'del_empty', 'text');
      await request(http())
        .delete(`/metafield-definitions/${d.id}`)
        .set(auth(A.admin))
        .expect(200);
    });

    it('removing a select option or tightening a rule that stored values depend on is a 409; loosening is fine', async () => {
      const sel = await mkDef(A, 'product', 'edit_sel', 'single_select', {
        validation: { options: ['a', 'b', 'c'] },
      });
      const num = await mkDef(A, 'product', 'edit_num', 'number', {
        validation: { max: 100 },
      });
      await put(A.admin, 'product', A.productId, [
        { definitionId: sel.id, value: 'c' },
        { definitionId: num.id, value: 50 },
      ]).expect(200);
      await request(http())
        .patch(`/metafield-definitions/${sel.id}`)
        .set(auth(A.admin))
        .send({ validation: { options: ['a', 'b'] } })
        .expect(409);
      await request(http())
        .patch(`/metafield-definitions/${num.id}`)
        .set(auth(A.admin))
        .send({ validation: { max: 10 } })
        .expect(409);
      // Nothing changed, value intact and definition unchanged.
      const stored = await db.query<RowDataPacket[]>(
        `SELECT validationJson FROM metafielddefinition WHERE id = ?`,
        [sel.id],
      );
      expect(
        (stored[0].validationJson as { options: string[] }).options,
      ).toEqual(['a', 'b', 'c']);
      // Removing an option nobody uses, and loosening, is allowed.
      await request(http())
        .patch(`/metafield-definitions/${sel.id}`)
        .set(auth(A.admin))
        .send({ validation: { options: ['c', 'd'] } })
        .expect(200);
      await request(http())
        .patch(`/metafield-definitions/${num.id}`)
        .set(auth(A.admin))
        .send({ validation: { max: 500 } })
        .expect(200);
    });
  });

  describe('public product payload', () => {
    let visible: Def;
    let hidden: Def;
    let customerDef: Def;

    beforeAll(async () => {
      visible = await mkDef(A, 'product', 'pub_visible', 'text', {
        visibleOnStorefront: true,
      });
      hidden = await mkDef(A, 'product', 'pub_hidden', 'text', {
        visibleOnStorefront: false,
      });
      customerDef = await mkDef(A, 'customer', 'pub_customer', 'text');
      await put(A.admin, 'product', A.productId, [
        { definitionId: visible.id, value: 'SHOWN-VALUE' },
        { definitionId: hidden.id, value: 'SECRET-HIDDEN-VALUE' },
      ]).expect(200);
      await put(A.admin, 'customer', A.customerId, [
        { definitionId: customerDef.id, value: 'SECRET-CUSTOMER-VALUE' },
      ]).expect(200);
      // A visible product value on shop B's product must never show on A's.
      const bDef = await mkDef(B, 'product', 'pub_visible', 'text', {
        visibleOnStorefront: true,
      });
      await put(B.admin, 'product', B.productId, [
        { definitionId: bDef.id, value: 'B-ONLY' },
      ]).expect(200);
    });

    it('exposes visible values keyed namespace.key and never hidden or customer values, on every public product surface', async () => {
      const base = `/public/${A.slug}`;
      const surfaces = [
        `${base}/products`,
        `${base}/products/${A.productId}`,
        `${base}/products/slug/${A.productSlug}`,
        `${base}/products/slug/${A.productSlug}/related`,
        `${base}/collections/${A.slug === '' ? '' : (await db.query<RowDataPacket[]>(`SELECT slug FROM collection WHERE id = ?`, [A.collectionId]))[0].slug}`,
        `${base}/search?q=MF`,
      ];
      let sawVisible = 0;
      for (const url of surfaces) {
        const res = await request(http()).get(url);
        expect(res.status).toBe(200);
        const text = JSON.stringify(res.body);
        expect(text).not.toContain('SECRET-HIDDEN-VALUE');
        expect(text).not.toContain('SECRET-CUSTOMER-VALUE');
        expect(text).not.toContain('B-ONLY');
        expect(text).not.toContain('pub_hidden');
        if (text.includes('SHOWN-VALUE')) sawVisible++;
      }
      // list + detail + slug + collection page carry the visible value (related/search legitimately may not).
      expect(sawVisible).toBeGreaterThanOrEqual(4);
      const detail = await request(http())
        .get(`${base}/products/${A.productId}`)
        .expect(200);
      expect(
        (detail.body as { metafields: Record<string, unknown> }).metafields,
      ).toEqual({
        'custom.pub_visible': 'SHOWN-VALUE',
      });
    });

    it('flipping visibility off removes the value from the public payload', async () => {
      const tmp = await mkDef(A, 'product', 'pub_toggle', 'text', {
        visibleOnStorefront: true,
      });
      await put(A.admin, 'product', A.productId, [
        { definitionId: tmp.id, value: 'T' },
      ]).expect(200);
      let detail = await request(http())
        .get(`/public/${A.slug}/products/${A.productId}`)
        .expect(200);
      expect(
        (detail.body as { metafields: Record<string, unknown> }).metafields[
          'custom.pub_toggle'
        ],
      ).toBe('T');
      await request(http())
        .patch(`/metafield-definitions/${tmp.id}`)
        .set(auth(A.admin))
        .send({ visibleOnStorefront: false })
        .expect(200);
      detail = await request(http())
        .get(`/public/${A.slug}/products/${A.productId}`)
        .expect(200);
      expect(
        (detail.body as { metafields: Record<string, unknown> }).metafields,
      ).not.toHaveProperty('custom.pub_toggle');
    });

    it('loads values for a whole product list with ONE metafieldvalue query', async () => {
      for (let i = 0; i < 4; i++) {
        await request(http())
          .post('/products')
          .set(auth(A.admin))
          .send({
            name: `Bulk ${i}`,
            price: 5,
            thumbnail: 'https://example.com/b.jpg',
            sku: `BULK-${runId}-${i}`,
            collectionIds: [A.collectionId],
          })
          .expect(201);
      }
      const spy = jest.spyOn(db, 'query');
      const res = await request(http())
        .get(`/public/${A.slug}/products`)
        .expect(200);
      const n = spy.mock.calls.filter(([sql]) =>
        String(sql).includes('FROM metafieldvalue'),
      ).length;
      spy.mockRestore();
      expect((res.body as unknown[]).length).toBeGreaterThanOrEqual(5);
      expect(n).toBe(1);
    });
  });

  describe('cleanup and personal data', () => {
    it('customer export includes custom-field values and anonymisation deletes them', async () => {
      const def = await mkDef(A, 'customer', 'pdpl', 'text');
      // Never equal to the seeded customer's `05${last 8 of runId}`: that phone is in the shop too,
      // and a clash (it happened in a 17-minute window every 28 hours) merges the two customers.
      const phone = `05${String(runId + 1).slice(-8)}`;
      const reg = await request(http())
        .post(`/public/${A.slug}/auth/register`)
        .send({
          name: 'PDPL Shopper',
          phone,
          email: `pdpl-${runId}@test.com`,
          password: 'password123',
        })
        .expect(201);
      const cookies: Record<string, string> = {};
      for (const line of reg.get('Set-Cookie') ?? []) {
        const pair = line.split(';')[0];
        const i = pair.indexOf('=');
        cookies[pair.slice(0, i)] = pair.slice(i + 1);
      }
      const cookie = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      const csrf = cookies['req-customer-csrf'];
      const customerId = body<{ customer: IdRow }>(reg).customer.id;
      await put(A.admin, 'customer', customerId, [
        { definitionId: def.id, value: 'PDPL-SENSITIVE' },
      ]).expect(200);

      const exp = await request(http())
        .get(`/public/${A.slug}/account/export`)
        .set('Cookie', cookie)
        .expect(200);
      expect(
        (exp.body as { customFields: { key: string; value: unknown }[] })
          .customFields,
      ).toEqual([
        expect.objectContaining({
          key: 'custom.pdpl',
          value: 'PDPL-SENSITIVE',
        }),
      ]);

      const reqDel = await request(http())
        .delete(`/public/${A.slug}/account/me`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrf)
        .expect(202);
      const token = body<{ confirmationToken: string }>(
        reqDel,
      ).confirmationToken;
      await request(http())
        .delete(`/public/${A.slug}/account/me/confirm?token=${token}`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrf)
        .expect(200);
      expect(await valueRows('customer', customerId)).toHaveLength(0);
    });

    it("removing a product's options (variant wipe) and stale variants removes their values; deleting the product removes its own", async () => {
      const pd = await mkDef(A, 'product', 'cleanup_p', 'text');
      const vd = await mkDef(A, 'variant', 'cleanup_v', 'text');
      const col = await request(http())
        .post('/collections')
        .set(auth(A.admin))
        .send({ name: 'Cleanup' })
        .expect(201);
      const mkProd = async (sku: string) =>
        body<IdRow>(
          await request(http())
            .post('/products')
            .set(auth(A.admin))
            .send({
              name: `Cleanup ${sku}`,
              price: 5,
              thumbnail: 'https://example.com/c.jpg',
              sku: `${sku}-${runId}`,
              collectionIds: [body<IdRow>(col).id],
            })
            .expect(201),
        ).id;
      const variantsOf = async (pid: number) =>
        (
          await db.query<RowDataPacket[]>(
            `SELECT id FROM productvariant WHERE productId = ?`,
            [pid],
          )
        ).map((r) => r.id as number);
      const setOptions = (pid: number, options: unknown[]) =>
        request(http())
          .put(`/products/${pid}/options`)
          .set(auth(A.admin))
          .send({ options })
          .expect(200);

      // Stale variant (S/M -> S): only the dropped variant's value goes.
      const p1 = await mkProd('CLN1');
      await setOptions(p1, [{ name: 'Size', values: ['S', 'M'] }]);
      const vids = await variantsOf(p1);
      for (const v of vids)
        await put(A.admin, 'variant', v, [
          { definitionId: vd.id, value: 'v' },
        ]).expect(200);
      await setOptions(p1, [{ name: 'Size', values: ['S'] }]);
      const left = await variantsOf(p1);
      const gone = vids.filter((v) => !left.includes(v));
      expect(gone).toHaveLength(1);
      expect(await valueRows('variant', gone[0])).toHaveLength(0);
      for (const v of left)
        expect(await valueRows('variant', v)).toHaveLength(1);

      // Wipe path (no options left): every variant value goes.
      await setOptions(p1, []);
      for (const v of left)
        expect(await valueRows('variant', v)).toHaveLength(0);

      // Product delete removes the product's own values.
      const p2 = await mkProd('CLN2');
      await put(A.admin, 'product', p2, [
        { definitionId: pd.id, value: 'p' },
      ]).expect(200);
      await request(http())
        .delete(`/products/${p2}`)
        .set(auth(A.admin))
        .expect(200);
      expect(await valueRows('product', p2)).toHaveLength(0);

      // A refused delete (the product is on an order line) keeps the values.
      await put(A.admin, 'product', A.productId, [
        { definitionId: pd.id, value: 'keep' },
      ]).expect(200);
      const refused = await request(http())
        .delete(`/products/${A.productId}`)
        .set(auth(A.admin));
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(
        (await valueRows('product', A.productId)).filter(
          (r) => r.definitionId === pd.id,
        ),
      ).toHaveLength(1);
    });

    it('deleting a collection and an outlet removes their values', async () => {
      const cd = await mkDef(A, 'collection', 'cleanup_c', 'text');
      const od = await mkDef(A, 'outlet', 'cleanup_o', 'text');
      const col = await request(http())
        .post('/collections')
        .set(auth(A.admin))
        .send({ name: 'Tmp collection' })
        .expect(201);
      const outlet = await request(http())
        .post('/outlets')
        .set(auth(A.admin))
        .send({ name: 'Tmp outlet' })
        .expect(201);
      const cid = body<IdRow>(col).id;
      const oid = body<IdRow>(outlet).id;
      await put(A.admin, 'collection', cid, [
        { definitionId: cd.id, value: 'c' },
      ]).expect(200);
      await put(A.admin, 'outlet', oid, [
        { definitionId: od.id, value: 'o' },
      ]).expect(200);
      await request(http())
        .delete(`/collections/${cid}`)
        .set(auth(A.admin))
        .expect(200);
      await request(http())
        .delete(`/outlets/${oid}`)
        .set(auth(A.admin))
        .expect(200);
      expect(await valueRows('collection', cid)).toHaveLength(0);
      expect(await valueRows('outlet', oid)).toHaveLength(0);
    });
  });
});
