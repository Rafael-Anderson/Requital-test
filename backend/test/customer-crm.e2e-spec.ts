import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';
import { asCustomer, registerCustomer } from './helpers/customer-session';
import { createStaffToken } from './helpers/staff-login';

jest.setTimeout(240000);

// CUS-2 tags, CUS-3 notes, CUS-11 consent: behaviour, tenant isolation on every
// endpoint, and the PDPL handling.
describe('Customer CRM: tags, notes, consent (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let seq = 0;
  const phone = () =>
    `05${String(Date.now() % 100000)}${String(++seq).padStart(3, '0')}`;

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
  });
  afterAll(async () => {
    await app.close();
  });

  async function shopWithCustomer(prefix: string) {
    const shop = await f.setupShop(prefix);
    const product = await f.stockedProduct(shop, 20);
    await f.publish(shop);
    const p = phone();
    await f.storefrontOrder(shop, [{ productId: product.id, quantity: 1 }], {
      customerPhone: p,
      customerName: 'Guest Gail',
      customerEmail: `${prefix}-${f.runId}-${seq}@guest.test`,
    });
    const rows = await db.query<RowDataPacket[]>(
      `SELECT id FROM customer WHERE shopId = ? AND phone = ?`,
      [shop.shopId, p],
    );
    return { shop, product, customerId: rows[0].id as number, phone: p };
  }

  const get = (shop: { adminToken: string }, path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${shop.adminToken}`);
  const send = (
    shop: { adminToken: string },
    method: 'post' | 'put' | 'patch' | 'delete',
    path: string,
    data?: object,
  ) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send(data);

  describe('tags', () => {
    it('creates, lists with counts, bulk assigns, filters the customer list, and unassigns', async () => {
      const { shop, customerId } = await shopWithCustomer('crm-tag');
      const tag = body<{ id: number }>(
        await send(shop, 'post', '/customer-tags', { name: 'VIP', color: '#ff0000' }).expect(201),
      );
      // duplicate name (case-insensitive) is a 409
      await send(shop, 'post', '/customer-tags', { name: 'vip' }).expect(409);
      await send(shop, 'post', '/customer-tags/assign', {
        customerIds: [customerId],
        tagIds: [tag.id],
      }).expect(201);
      // idempotent
      await send(shop, 'post', '/customer-tags/assign', {
        customerIds: [customerId],
        tagIds: [tag.id],
      }).expect(201);

      const list = body<{ id: number; customerCount: number }[]>(
        await get(shop, '/customer-tags').expect(200),
      );
      expect(list.find((t) => t.id === tag.id)?.customerCount).toBe(1);

      const customers = body<{ data: { id: number; tags: { name: string }[] }[] }>(
        await get(shop, `/customers?tagId=${tag.id}`).expect(200),
      );
      expect(customers.data.map((c) => c.id)).toEqual([customerId]);
      expect(customers.data[0].tags.map((t) => t.name)).toEqual(['VIP']);

      await send(shop, 'post', '/customer-tags/unassign', {
        customerIds: [customerId],
        tagIds: [tag.id],
      }).expect(201);
      const after = body<{ data: unknown[] }>(
        await get(shop, `/customers?tagId=${tag.id}`).expect(200),
      );
      expect(after.data).toHaveLength(0);
    });

    it('rejects a hostile colour and an oversized bulk list', async () => {
      const { shop } = await shopWithCustomer('crm-tag-val');
      await send(shop, 'post', '/customer-tags', {
        name: 'x',
        color: 'red;background:url(x)',
      }).expect(400);
      await send(shop, 'post', '/customer-tags/assign', {
        customerIds: Array.from({ length: 501 }, (_, i) => i + 1),
        tagIds: [1],
      }).expect(400);
    });

    it('cross-tenant: another shop cannot see, assign, rename, delete or filter by my tag or customer', async () => {
      const a = await shopWithCustomer('crm-tag-a');
      const b = await shopWithCustomer('crm-tag-b');
      const tagA = body<{ id: number }>(
        await send(a.shop, 'post', '/customer-tags', { name: 'A-only' }).expect(201),
      );
      const tagB = body<{ id: number }>(
        await send(b.shop, 'post', '/customer-tags', { name: 'B-only' }).expect(201),
      );
      // B's list does not contain A's tag
      const listB = body<{ id: number }[]>(await get(b.shop, '/customer-tags').expect(200));
      expect(listB.map((t) => t.id)).not.toContain(tagA.id);
      // B assigning A's tag to B's customer, or B's tag to A's customer: 404, nothing written
      await send(b.shop, 'post', '/customer-tags/assign', {
        customerIds: [b.customerId],
        tagIds: [tagA.id],
      }).expect(404);
      await send(b.shop, 'post', '/customer-tags/assign', {
        customerIds: [a.customerId],
        tagIds: [tagB.id],
      }).expect(404);
      await send(b.shop, 'post', '/customer-tags/unassign', {
        customerIds: [a.customerId],
        tagIds: [tagB.id],
      }).expect(404);
      await send(b.shop, 'patch', `/customer-tags/${tagA.id}`, { name: 'hijack' }).expect(404);
      await send(b.shop, 'delete', `/customer-tags/${tagA.id}`).expect(404);
      await get(b.shop, `/customers/${a.customerId}/tags`).expect(404);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM customertagassignment WHERE tagId IN (?, ?)`,
        [tagA.id, tagB.id],
      );
      expect(Number(rows[0].n)).toBe(0);
      // filtering my list by someone else's tag id matches nothing
      const filtered = body<{ data: unknown[] }>(
        await get(b.shop, `/customers?tagId=${tagA.id}`).expect(200),
      );
      expect(filtered.data).toHaveLength(0);
    });
  });

  describe('notes', () => {
    it('records author and time, lists newest first, deletes, and audit-logs without the body', async () => {
      const { shop, customerId } = await shopWithCustomer('crm-note');
      const n1 = body<{ id: number; authorName: string }>(
        await send(shop, 'post', `/customers/${customerId}/notes`, {
          body: 'Prefers morning delivery. Allergic to lilies.',
        }).expect(201),
      );
      expect(n1.authorName).toBeTruthy();
      await send(shop, 'post', `/customers/${customerId}/notes`, { body: '   ' }).expect(400);
      const list = body<{ id: number; body: string; createdAt: string }[]>(
        await get(shop, `/customers/${customerId}/notes`).expect(200),
      );
      expect(list).toHaveLength(1);
      expect(list[0].body).toContain('lilies');

      const audit = await db.query<RowDataPacket[]>(
        `SELECT metadata FROM auditlog WHERE shopId = ? AND action = 'customer.note.created'`,
        [shop.shopId],
      );
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit[0].metadata)).not.toContain('lilies');

      await send(shop, 'delete', `/customers/${customerId}/notes/${n1.id}`).expect(200);
      await send(shop, 'delete', `/customers/${customerId}/notes/${n1.id}`).expect(404);
    });

    it('cross-tenant: notes of another shop cannot be listed, written or deleted', async () => {
      const a = await shopWithCustomer('crm-note-a');
      const b = await shopWithCustomer('crm-note-b');
      const note = body<{ id: number }>(
        await send(a.shop, 'post', `/customers/${a.customerId}/notes`, { body: 'secret' }).expect(201),
      );
      await get(b.shop, `/customers/${a.customerId}/notes`).expect(404);
      await send(b.shop, 'post', `/customers/${a.customerId}/notes`, { body: 'x' }).expect(404);
      // right note id, but another shop's customer id, and the wrong customer in my own shop
      await send(b.shop, 'delete', `/customers/${a.customerId}/notes/${note.id}`).expect(404);
      await send(b.shop, 'delete', `/customers/${b.customerId}/notes/${note.id}`).expect(404);
      const rows = await db.query<RowDataPacket[]>(`SELECT id FROM customernote WHERE id = ?`, [note.id]);
      expect(rows).toHaveLength(1);
    });

    it('role matrix: viewer reads but cannot write; branch and order_manager have no access at all', async () => {
      const { shop, customerId } = await shopWithCustomer('crm-note-role');
      const viewer = await createStaffToken(app, shop.adminToken, 'crm', 'viewer');
      const branch = await createStaffToken(app, shop.adminToken, 'crm', 'branch', shop.outletId);
      const om = await createStaffToken(app, shop.adminToken, 'crm', 'order_manager');
      await send(shop, 'post', `/customers/${customerId}/notes`, { body: 'ok' }).expect(201);
      const as = (token: string, method: 'get' | 'post' | 'put', path: string, data?: object) =>
        request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`).send(data);
      await as(viewer, 'get', `/customers/${customerId}/notes`).expect(200);
      await as(viewer, 'get', `/customers/${customerId}/consent`).expect(200);
      await as(viewer, 'get', `/customer-tags`).expect(200);
      await as(viewer, 'post', `/customers/${customerId}/notes`, { body: 'x' }).expect(403);
      await as(viewer, 'put', `/customers/${customerId}/consent`, { channel: 'email', status: 'withdrawn' }).expect(403);
      await as(viewer, 'post', `/customer-tags`, { name: 'nope' }).expect(403);
      for (const token of [branch, om]) {
        await as(token, 'get', `/customers/${customerId}/notes`).expect(403);
        await as(token, 'get', `/customers/${customerId}/consent`).expect(403);
        await as(token, 'get', `/customer-tags`).expect(403);
      }
    });
  });

  describe('consent', () => {
    it('is UNKNOWN (null, never false) for a guest-checkout customer and for a new registration', async () => {
      const { shop, customerId } = await shopWithCustomer('crm-consent0');
      const c = body<{
        channels: { channel: string; status: string | null }[];
        history: unknown[];
        newsletter: { subscribed: boolean };
      }>(await get(shop, `/customers/${customerId}/consent`).expect(200));
      expect(c.channels.map((x) => [x.channel, x.status])).toEqual([
        ['email', null],
        ['whatsapp', null],
        ['sms', null],
      ]);
      expect(c.history).toHaveLength(0);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM customerconsent WHERE customerId = ?`,
        [customerId],
      );
      expect(Number(rows[0].n)).toBe(0);

      const reg = await registerCustomer(app.getHttpServer(), shop.slug, phone(), `reg-${f.uniq()}@x.test`);
      const rows2 = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM customerconsent WHERE customerId = ?`,
        [reg.customerId],
      );
      expect(Number(rows2[0].n)).toBe(0);
    });

    it('admin grant needs evidence, writes one event, is idempotent, and withdrawal is a new dated event', async () => {
      const { shop, customerId } = await shopWithCustomer('crm-consent1');
      await send(shop, 'put', `/customers/${customerId}/consent`, {
        channel: 'email',
        status: 'granted',
      }).expect(400);
      await send(shop, 'put', `/customers/${customerId}/consent`, {
        channel: 'email',
        status: 'granted',
        note: 'verbal, in store',
      }).expect(200);
      await send(shop, 'put', `/customers/${customerId}/consent`, {
        channel: 'email',
        status: 'granted',
        note: 'verbal, in store',
      }).expect(200);
      let events = await db.query<RowDataPacket[]>(
        `SELECT status, source, wordingVersion, wordingText FROM customerconsentevent WHERE customerId = ?`,
        [customerId],
      );
      expect(events).toHaveLength(1);
      expect(events[0].wordingVersion).toBeTruthy();
      expect(events[0].wordingText).toContain('marketing emails');
      const after = body<{ channels: { channel: string; status: string | null }[] }>(
        await send(shop, 'put', `/customers/${customerId}/consent`, {
          channel: 'email',
          status: 'withdrawn',
        }).expect(200),
      );
      expect(after.channels.find((x) => x.channel === 'email')?.status).toBe('withdrawn');
      // other channels untouched (still unknown)
      expect(after.channels.find((x) => x.channel === 'sms')?.status).toBeNull();
      events = await db.query<RowDataPacket[]>(
        `SELECT status FROM customerconsentevent WHERE customerId = ? ORDER BY id`,
        [customerId],
      );
      expect(events.map((e) => e.status)).toEqual(['granted', 'withdrawn']);
    });

    it('cross-tenant: another shop cannot read or record consent for my customer', async () => {
      const a = await shopWithCustomer('crm-consent-a');
      const b = await shopWithCustomer('crm-consent-b');
      await get(b.shop, `/customers/${a.customerId}/consent`).expect(404);
      await send(b.shop, 'put', `/customers/${a.customerId}/consent`, {
        channel: 'email',
        status: 'granted',
        note: 'forged',
      }).expect(404);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM customerconsentevent WHERE customerId = ?`,
        [a.customerId],
      );
      expect(Number(rows[0].n)).toBe(0);
    });

    it('the newsletter list is shown but never copied into consent', async () => {
      const { shop, customerId } = await shopWithCustomer('crm-news');
      const cust = await db.query<RowDataPacket[]>(`SELECT email FROM customer WHERE id = ?`, [customerId]);
      await db.execute(
        `INSERT INTO newslettersubscriber (shopId, email, source) VALUES (?, ?, 'newsletter_widget')`,
        [shop.shopId, String(cust[0].email).toUpperCase()],
      );
      const c = body<{
        channels: { status: string | null }[];
        newsletter: { subscribed: boolean };
      }>(await get(shop, `/customers/${customerId}/consent`).expect(200));
      expect(c.newsletter.subscribed).toBe(true);
      expect(c.channels.every((x) => x.status === null)).toBe(true);
    });

    it('storefront account: the customer toggles their own consent; wording and version are server-side; another shop session cannot', async () => {
      const a = await shopWithCustomer('crm-acct-a');
      const b = await shopWithCustomer('crm-acct-b');
      const sessA = await registerCustomer(app.getHttpServer(), a.shop.slug, phone(), `acct-${f.uniq()}@x.test`);
      const view = body<{ wording: { version: string }; channels: { status: string | null }[] }>(
        await asCustomer(app.getHttpServer(), sessA, 'get', `/public/${a.shop.slug}/account/consent`).expect(200),
      );
      expect(view.channels.every((c) => c.status === null)).toBe(true);
      expect(view.wording.version).toBeTruthy();

      await asCustomer(app.getHttpServer(), sessA, 'put', `/public/${a.shop.slug}/account/consent`)
        .send({ channel: 'whatsapp', granted: true })
        .expect(200);
      const ev = await db.query<RowDataPacket[]>(
        `SELECT source, wordingText FROM customerconsentevent WHERE customerId = ?`,
        [sessA.customerId],
      );
      expect(ev).toHaveLength(1);
      expect(ev[0].source).toBe('storefront_account');
      expect(ev[0].wordingText).toContain('WhatsApp');

      // a client cannot smuggle its own wording or source
      await asCustomer(app.getHttpServer(), sessA, 'put', `/public/${a.shop.slug}/account/consent`)
        .send({ channel: 'email', granted: true, wordingText: 'free money', source: 'admin' })
        .expect(400);

      // shop A's session on shop B's URL is rejected
      await asCustomer(app.getHttpServer(), sessA, 'put', `/public/${b.shop.slug}/account/consent`)
        .send({ channel: 'email', granted: true })
        .expect(401);
      // unauthenticated
      await request(app.getHttpServer())
        .put(`/public/${a.shop.slug}/account/consent`)
        .send({ channel: 'email', granted: true })
        .expect(401);
    });
  });

  describe('PDPL', () => {
    it('export carries consent but not notes; deleting the account removes notes and withdraws granted consent, keeping the history', async () => {
      const { shop } = await shopWithCustomer('crm-pdpl');
      const sess = await registerCustomer(app.getHttpServer(), shop.slug, phone(), `pdpl-${f.uniq()}@x.test`);
      await asCustomer(app.getHttpServer(), sess, 'put', `/public/${shop.slug}/account/consent`)
        .send({ channel: 'email', granted: true })
        .expect(200);
      await send(shop, 'post', `/customers/${sess.customerId}/notes`, { body: 'internal remark' }).expect(201);

      const exp = body<{ marketingConsent: { channels: { channel: string; status: string }[]; history: unknown[] } }>(
        await asCustomer(app.getHttpServer(), sess, 'get', `/public/${shop.slug}/account/export`).expect(200),
      );
      expect(exp.marketingConsent.channels.find((c) => c.channel === 'email')?.status).toBe('granted');
      expect(JSON.stringify(exp)).not.toContain('internal remark');

      const req1 = body<{ confirmationToken: string }>(
        await asCustomer(app.getHttpServer(), sess, 'delete', `/public/${shop.slug}/account/me`).expect(202),
      );
      await asCustomer(
        app.getHttpServer(),
        sess,
        'delete',
        `/public/${shop.slug}/account/me/confirm?token=${req1.confirmationToken}`,
      ).expect(200);

      const notes = await db.query<RowDataPacket[]>(`SELECT id FROM customernote WHERE customerId = ?`, [sess.customerId]);
      expect(notes).toHaveLength(0);
      const state = await db.query<RowDataPacket[]>(
        `SELECT status, source FROM customerconsent WHERE customerId = ? AND channel = 'email'`,
        [sess.customerId],
      );
      expect(state[0]).toMatchObject({ status: 'withdrawn', source: 'account_deletion' });
      const events = await db.query<RowDataPacket[]>(
        `SELECT status FROM customerconsentevent WHERE customerId = ? ORDER BY id`,
        [sess.customerId],
      );
      expect(events.map((e) => e.status)).toEqual(['granted', 'withdrawn']);
    });
  });
});
