import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { bootApp, makeFixtures, body } from './helpers/w5-fixture';
import { createStaffToken } from './helpers/staff-login';

jest.setTimeout(240000);

interface SupplierBody {
  id: number;
  name: string;
  status: string;
  currency: string | null;
  leadTimeDays: number | null;
  minimumOrderAmount: string | null;
  contacts: { id: number; name: string; isPrimary: boolean }[];
  items: {
    ingredientId: number;
    unitCost: string | null;
    currency: string | null;
    supplierSku: string | null;
  }[];
}

// INV-1: suppliers, contacts and the per-ingredient supplier catalogue.
describe('Suppliers (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let a: Awaited<ReturnType<typeof f.setupShop>>;
  let b: Awaited<ReturnType<typeof f.setupShop>>;
  let branchToken: string;
  let orderManagerToken: string;

  const post = (shop: { adminToken: string }, url: string, data: object) =>
    request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send(data);

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
    a = await f.setupShop('sup-a');
    b = await f.setupShop('sup-b');
    branchToken = await createStaffToken(app, a.adminToken, 'sup', 'branch', a.outletId);
    orderManagerToken = await createStaffToken(app, a.adminToken, 'sup', 'order_manager');
  });
  afterAll(async () => {
    await app.close();
  });

  async function newSupplier(shop: typeof a, extra: object = {}) {
    const res = await post(shop, '/suppliers', {
      name: `Sup ${f.uniq()}`,
      ...extra,
    }).expect(201);
    return body<SupplierBody>(res);
  }

  describe('create and read', () => {
    it('an unspecified currency, lead time and minimum stay NULL, never defaulted', async () => {
      const s = await newSupplier(a);
      expect(s.currency).toBeNull();
      expect(s.leadTimeDays).toBeNull();
      expect(s.minimumOrderAmount).toBeNull();
      expect(s.status).toBe('active');
    });

    it('refuses a minimum order amount with more than 3 decimals', async () => {
      await post(a, '/suppliers', {
        name: `n ${f.uniq()}`,
        currency: 'KWD',
        minimumOrderAmount: 10.5055,
      }).expect(400);
    });

    it('keeps the third decimal for KWD and rounds AED to two', async () => {
      const kwd = await newSupplier(a, { currency: 'KWD', minimumOrderAmount: 10.505 });
      expect(kwd.minimumOrderAmount).toBe('10.505');
      const aed = await newSupplier(a, { currency: 'AED', minimumOrderAmount: 10.505 });
      expect(aed.minimumOrderAmount).toBe('10.51');
    });

    it('rejects a minimum order amount with no currency, and an unsupported currency', async () => {
      await post(a, '/suppliers', { name: `n ${f.uniq()}`, minimumOrderAmount: 5 }).expect(400);
      await post(a, '/suppliers', { name: `n ${f.uniq()}`, currency: 'XXX' }).expect(400);
      const s = await newSupplier(a, { currency: 'AED', minimumOrderAmount: 5 });
      await request(app.getHttpServer())
        .patch(`/suppliers/${s.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .send({ currency: null })
        .expect(400);
    });

    it('a duplicate name in the same shop is 409, the same name in another shop is fine', async () => {
      const name = `Dup ${f.uniq()}`;
      await post(a, '/suppliers', { name }).expect(201);
      await post(a, '/suppliers', { name }).expect(409);
      await post(b, '/suppliers', { name }).expect(201);
    });

    it('PATCH null clears a nullable field, an absent key leaves it', async () => {
      const s = await newSupplier(a, { currency: 'AED', leadTimeDays: 3, paymentTerms: 'Net 30' });
      const res = await request(app.getHttpServer())
        .patch(`/suppliers/${s.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .send({ leadTimeDays: null })
        .expect(200);
      expect(body<SupplierBody>(res).leadTimeDays).toBeNull();
      expect(body<SupplierBody & { paymentTerms: string }>(res).paymentTerms).toBe('Net 30');
    });

    it('archive then restore through status, list filters by status', async () => {
      const s = await newSupplier(a);
      await request(app.getHttpServer())
        .patch(`/suppliers/${s.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .send({ status: 'archived' })
        .expect(200);
      const active = await request(app.getHttpServer())
        .get('/suppliers?status=active')
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(200);
      expect(body<SupplierBody[]>(active).some((x) => x.id === s.id)).toBe(false);
      const archived = await request(app.getHttpServer())
        .get('/suppliers?status=archived')
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(200);
      expect(body<SupplierBody[]>(archived).some((x) => x.id === s.id)).toBe(true);
    });

    it('delete with no references is a hard delete', async () => {
      const s = await newSupplier(a);
      const res = await request(app.getHttpServer())
        .delete(`/suppliers/${s.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(200);
      expect(body<{ deleted: boolean }>(res).deleted).toBe(true);
      await request(app.getHttpServer())
        .get(`/suppliers/${s.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(404);
    });
  });

  describe('contacts', () => {
    it('keeps at most one primary contact per supplier', async () => {
      const s = await newSupplier(a);
      await post(a, `/suppliers/${s.id}/contacts`, { name: 'One', isPrimary: true }).expect(201);
      const res = await post(a, `/suppliers/${s.id}/contacts`, {
        name: 'Two',
        email: 'two@example.com',
        isPrimary: true,
      }).expect(201);
      const contacts = body<SupplierBody>(res).contacts;
      expect(contacts.filter((c) => c.isPrimary).map((c) => c.name)).toEqual(['Two']);
      expect(contacts).toHaveLength(2);
    });

    it('rejects a malformed contact email', async () => {
      const s = await newSupplier(a);
      await post(a, `/suppliers/${s.id}/contacts`, { name: 'X', email: 'nope' }).expect(400);
    });
  });

  describe('supplier catalogue', () => {
    it('upserts an item, inheriting the supplier currency, and trims the cost', async () => {
      const s = await newSupplier(a, { currency: 'KWD' });
      const ing = await f.createIngredient(a, 'Rose');
      const res = await request(app.getHttpServer())
        .put(`/suppliers/${s.id}/items/${ing.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .send({ supplierSku: 'R-1', unitCost: 0.0125 })
        .expect(200);
      const item = body<SupplierBody>(res).items[0];
      expect(item.currency).toBe('KWD');
      expect(item.unitCost).toBe('0.0125');
      // Upserting again updates in place (still one row).
      const res2 = await request(app.getHttpServer())
        .put(`/suppliers/${s.id}/items/${ing.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .send({ supplierSku: 'R-2' })
        .expect(200);
      const items2 = body<SupplierBody>(res2).items;
      expect(items2).toHaveLength(1);
      expect(items2[0].supplierSku).toBe('R-2');
      expect(items2[0].unitCost).toBe('0.0125');
    });

    it('refuses a cost with no currency anywhere, and a 5-decimal cost', async () => {
      const s = await newSupplier(a);
      const ing = await f.createIngredient(a, 'Tulip');
      await request(app.getHttpServer())
        .put(`/suppliers/${s.id}/items/${ing.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .send({ unitCost: 2 })
        .expect(400);
      await request(app.getHttpServer())
        .put(`/suppliers/${s.id}/items/${ing.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .send({ unitCost: 1.00001, currency: 'AED' })
        .expect(400);
      // No cost, no currency is fine: unknown stays unknown.
      const ok = await request(app.getHttpServer())
        .put(`/suppliers/${s.id}/items/${ing.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .send({ supplierSku: 'T-1' })
        .expect(200);
      expect(body<SupplierBody>(ok).items[0].currency).toBeNull();
      expect(body<SupplierBody>(ok).items[0].unitCost).toBeNull();
    });

    it('deletes an item, 404 when it is not there', async () => {
      const s = await newSupplier(a);
      const ing = await f.createIngredient(a, 'Lily');
      await request(app.getHttpServer())
        .put(`/suppliers/${s.id}/items/${ing.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .send({})
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/suppliers/${s.id}/items/${ing.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/suppliers/${s.id}/items/${ing.id}`)
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(404);
    });
  });

  describe('free-text suggestions (read-only)', () => {
    it('lists unmatched ingredient.supplier / product.vendor strings and writes nothing', async () => {
      const text = `Dubai Blooms ${f.uniq()}`;
      await f.createIngredient(a, 'Fern', { supplier: text });
      const before = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM supplier WHERE shopId = ?`,
        [a.shopId],
      );
      const res = await request(app.getHttpServer())
        .get('/suppliers/suggestions/free-text')
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(200);
      expect(
        body<{ name: string; source: string }[]>(res).some(
          (x) => x.name === text && x.source === 'ingredient.supplier',
        ),
      ).toBe(true);
      const after = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM supplier WHERE shopId = ?`,
        [a.shopId],
      );
      expect(after[0].c).toBe(before[0].c);
      // Once a supplier of that name exists the suggestion disappears.
      await post(a, '/suppliers', { name: text }).expect(201);
      const res2 = await request(app.getHttpServer())
        .get('/suppliers/suggestions/free-text')
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(200);
      expect(body<{ name: string }[]>(res2).some((x) => x.name === text)).toBe(false);
      // Another shop never sees it.
      const resB = await request(app.getHttpServer())
        .get('/suppliers/suggestions/free-text')
        .set('Authorization', `Bearer ${b.adminToken}`)
        .expect(200);
      expect(body<{ name: string }[]>(resB).some((x) => x.name === text)).toBe(false);
    });
  });

  describe('roles', () => {
    it('branch can read but not write; order_manager can do neither', async () => {
      const s = await newSupplier(a);
      const h = (t: string) => ({ Authorization: `Bearer ${t}` });
      await request(app.getHttpServer()).get('/suppliers').set(h(branchToken)).expect(200);
      await request(app.getHttpServer()).get(`/suppliers/${s.id}`).set(h(branchToken)).expect(200);
      await request(app.getHttpServer())
        .post('/suppliers')
        .set(h(branchToken))
        .send({ name: 'nope' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/suppliers/${s.id}`)
        .set(h(branchToken))
        .send({ name: 'nope' })
        .expect(403);
      await request(app.getHttpServer()).delete(`/suppliers/${s.id}`).set(h(branchToken)).expect(403);
      await request(app.getHttpServer())
        .post(`/suppliers/${s.id}/contacts`)
        .set(h(branchToken))
        .send({ name: 'x' })
        .expect(403);
      await request(app.getHttpServer())
        .put(`/suppliers/${s.id}/items/1`)
        .set(h(branchToken))
        .send({})
        .expect(403);
      await request(app.getHttpServer()).get('/suppliers/suggestions/free-text').set(h(branchToken)).expect(403);
      await request(app.getHttpServer()).get('/suppliers').set(h(orderManagerToken)).expect(403);
      await request(app.getHttpServer()).get('/suppliers').expect(401);
    });
  });

  describe('cross-tenant: shop B cannot touch shop A ids', () => {
    it('404s on every endpoint that takes a supplier, contact or ingredient id', async () => {
      const s = await newSupplier(a);
      const ingA = await f.createIngredient(a, 'Orchid');
      const ingB = await f.createIngredient(b, 'Orchid');
      const contactRes = await post(a, `/suppliers/${s.id}/contacts`, { name: 'C' }).expect(201);
      const contactId = body<SupplierBody>(contactRes).contacts[0].id;
      const hb = { Authorization: `Bearer ${b.adminToken}` };
      const r = () => request(app.getHttpServer());

      await r().get(`/suppliers/${s.id}`).set(hb).expect(404);
      await r().patch(`/suppliers/${s.id}`).set(hb).send({ name: 'Hijacked' }).expect(404);
      await r().delete(`/suppliers/${s.id}`).set(hb).expect(404);
      await r().post(`/suppliers/${s.id}/contacts`).set(hb).send({ name: 'x' }).expect(404);
      await r().patch(`/suppliers/${s.id}/contacts/${contactId}`).set(hb).send({ name: 'x' }).expect(404);
      await r().delete(`/suppliers/${s.id}/contacts/${contactId}`).set(hb).expect(404);
      await r().put(`/suppliers/${s.id}/items/${ingB.id}`).set(hb).send({}).expect(404);
      await r().delete(`/suppliers/${s.id}/items/${ingA.id}`).set(hb).expect(404);

      // Shop B's own supplier with SHOP A's ingredient id: the ingredient is foreign.
      const sb = await newSupplier(b);
      await r().put(`/suppliers/${sb.id}/items/${ingA.id}`).set(hb).send({}).expect(404);
      // A's contact id through B's own supplier path is also foreign.
      await r().patch(`/suppliers/${sb.id}/contacts/${contactId}`).set(hb).send({ name: 'x' }).expect(404);

      // Shop A's data is untouched and absent from B's list.
      const still = await r().get(`/suppliers/${s.id}`).set('Authorization', `Bearer ${a.adminToken}`).expect(200);
      expect(body<SupplierBody>(still).name).toBe(s.name);
      const listB = await r().get('/suppliers').set(hb).expect(200);
      expect(body<SupplierBody[]>(listB).some((x) => x.id === s.id)).toBe(false);
    });
  });
});
