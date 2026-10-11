import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { generateOpaqueToken, hashToken } from '../src/common/token-hash';
import { verifySignupEmail } from './helpers/verify-signup-email';
import {
  asCustomer,
  registerCustomer,
  sessionFrom,
  type CustomerSession,
} from './helpers/customer-session';
import {
  sentEmails,
  tokenIn,
  verifyCustomerEmail,
} from './helpers/customer-email';

// W1: a guest checkout used to overwrite the email of the customer it matched by
// phone, and customer password reset ran on that email, so knowing a phone number
// was enough to take over the account (and its store credit). These specs walk
// every path that writes customer.email / name / phone from a less-privileged
// source, and the reset / verification rules that make an overwritten email
// harmless.

interface Shop {
  slug: string;
  id: number;
  adminToken: string;
  outletId: number;
  productId: number;
}
interface CustomerDb extends RowDataPacket {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  verifiedEmail: string | null;
  passwordHash: string | null;
}
const body = <T>(res: Response) => res.body as T;

describe('customer account takeover (W1, e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let server: App;
  const runId = Date.now();
  let seq = 0;
  let shopA: Shop;
  let shopB: Shop;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    server = app.getHttpServer() as App;
    db = app.get(DatabaseService);
    shopA = await setupShop('w1-a');
    shopB = await setupShop('w1-b');
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(prefix: string): Promise<Shop> {
    const slug = `${prefix}-${runId}`;
    const signup = await request(server)
      .post('/auth/signup')
      .send({
        name: 'Shop Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const s = body<{ accessToken: string; devVerificationLink?: string }>(signup);
    await verifySignupEmail(server, s.devVerificationLink);
    const auth = { Authorization: `Bearer ${s.accessToken}` };
    const outlets = await request(server).get('/outlets').set(auth).expect(200);
    const outletId = body<{ id: number }[]>(outlets)[0].id;
    await request(server)
      .patch(`/outlets/${outletId}`)
      .set(auth)
      .send({ active: true, pickupEnabled: true })
      .expect(200);
    const collection = await request(server)
      .post('/collections')
      .set(auth)
      .send({ name: 'General' })
      .expect(201);
    const product = await request(server)
      .post('/products')
      .set(auth)
      .send({
        name: 'Test Product',
        price: 50,
        thumbnail: 'https://example.com/x.jpg',
        sku: `W1-${runId}-${prefix}`,
        trackInventory: true,
        collectionIds: [body<{ id: number }>(collection).id],
      })
      .expect(201);
    const productId = body<{ id: number }>(product).id;
    await request(server)
      .patch('/products/stock/bulk-adjust')
      .set(auth)
      .send({ outletId, adjustments: [{ productId, delta: 1000 }] })
      .expect(200);
    await request(server).patch('/shop').set(auth).send({ published: true }).expect(200);
    const rows = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    return {
      slug,
      id: rows[0].id as number,
      adminToken: s.accessToken,
      outletId,
      productId,
    };
  }

  const phone = () => `05${String(runId).slice(-4)}${String(++seq).padStart(4, '0')}`;
  const mail = (tag: string) => `${tag}-${runId}-${++seq}@test.com`;

  async function customerRow(shop: Shop, p: string): Promise<CustomerDb> {
    const rows = await db.query<CustomerDb[]>(
      `SELECT * FROM customer WHERE shopId = ? AND phone = ?`,
      [shop.id, p],
    );
    return rows[0];
  }

  function guestCheckout(shop: Shop, p: string, name: string, email?: string) {
    return request(server)
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName: name,
        customerPhone: p,
        ...(email ? { customerEmail: email } : {}),
        customerAddress: 'Pickup',
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);
  }

  const forgot = (shop: Shop, email: string) =>
    request(server)
      .post(`/public/${shop.slug}/auth/forgot-password`)
      .send({ email });

  const resetMails = async (shop: Shop, to: string) =>
    (await sentEmails(db, shop.id, to)).filter(
      (m) => m.subject === 'Reset your password',
    );

  // A registered, VERIFIED account.
  async function verifiedAccount(shop: Shop, p = phone(), email = mail('victim')) {
    const session = await registerCustomer(server, shop.slug, p, email, 'victim-pass-1');
    await verifyCustomerEmail(server, db, shop, email);
    return { session, phone: p, email };
  }

  describe('the reported chain', () => {
    it('a guest checkout on a registered phone leaves the customer record alone; the typed details stay on the ORDER', async () => {
      const victim = await verifiedAccount(shopA);
      const attackerEmail = mail('attacker');

      const res = await guestCheckout(shopA, victim.phone, 'Evil Eve', attackerEmail);

      const row = await customerRow(shopA, victim.phone);
      expect(row.email).toBe(victim.email);
      expect(row.name).toBe('CRM Shopper');
      expect(row.verifiedEmail).toBe(victim.email);
      const orderId = body<{ order: { id: number } }>(res).order.id;
      const orders = await db.query<RowDataPacket[]>(
        `SELECT customerId, customerName, customerEmail FROM \`order\` WHERE id = ?`,
        [orderId],
      );
      expect(orders[0].customerId).toBe(victim.session.customerId);
      expect(orders[0].customerName).toBe('Evil Eve');
      expect(orders[0].customerEmail).toBe(attackerEmail);
    });

    it('TAKEOVER: after the guest checkout, a password reset for the attacker address sends nothing and the attacker gets no link', async () => {
      const victim = await verifiedAccount(shopA);
      const attackerEmail = mail('attacker');
      await guestCheckout(shopA, victim.phone, 'Evil Eve', attackerEmail);

      const res = await forgot(shopA, attackerEmail).expect(201);
      expect(body<Record<string, unknown>>(res)).toEqual({ success: true });
      expect(await resetMails(shopA, attackerEmail)).toHaveLength(0);
      // The only job that mentions the attacker is the ORDER's own notification,
      // never a reset.
      const fromAttackerAddress = await sentEmails(db, shopA.id, attackerEmail);
      expect(fromAttackerAddress.some((m) => /reset/i.test(m.subject))).toBe(false);
    });

    it('the real owner still resets through the verified address after the attack, and the attacker cannot log in', async () => {
      const victim = await verifiedAccount(shopA);
      const attackerEmail = mail('attacker');
      await guestCheckout(shopA, victim.phone, 'Evil Eve', attackerEmail);

      const res = await forgot(shopA, victim.email).expect(201);
      expect(body<{ devResetLink?: string }>(res).devResetLink).toBeDefined();
      const mails = await resetMails(shopA, victim.email);
      expect(mails).toHaveLength(1);
      await request(server)
        .post(`/public/${shopA.slug}/auth/reset-password`)
        .send({ token: tokenIn(mails[0]), newPassword: 'brand-new-pass-9' })
        .expect(201);
      await request(server)
        .post(`/public/${shopA.slug}/auth/login`)
        .send({ identifier: attackerEmail, password: 'anything-1234' })
        .expect(401);
      await request(server)
        .post(`/public/${shopA.slug}/auth/login`)
        .send({ identifier: victim.phone, password: 'brand-new-pass-9' })
        .expect(201);
    });
  });

  describe('every other writer of customer name / email / phone', () => {
    it('merged-phone alias: a checkout under a merged duplicate phone resolves to the primary and changes nothing', async () => {
      const victim = await verifiedAccount(shopA);
      const aliasPhone = phone();
      await db.execute(
        `INSERT INTO customermerge (shopId, primaryCustomerId, duplicateCustomerId, duplicatePhone, moved)
         VALUES (?, ?, ?, ?, '{}')`,
        [shopA.id, victim.session.customerId, 900000000 + seq, aliasPhone],
      );
      const attackerEmail = mail('attacker');
      const res = await guestCheckout(shopA, aliasPhone, 'Evil Eve', attackerEmail);
      const row = await customerRow(shopA, victim.phone);
      expect(row.email).toBe(victim.email);
      expect(row.name).toBe('CRM Shopper');
      const orderId = body<{ order: { id: number } }>(res).order.id;
      const o = await db.query<RowDataPacket[]>(
        `SELECT customerId, customerEmail FROM \`order\` WHERE id = ?`,
        [orderId],
      );
      expect(o[0].customerId).toBe(victim.session.customerId);
      expect(o[0].customerEmail).toBe(attackerEmail);
      await forgot(shopA, attackerEmail).expect(201);
      expect(await resetMails(shopA, attackerEmail)).toHaveLength(0);
    });

    it('a staff-entered order for a known phone does not rewrite the customer either (the order carries what was typed)', async () => {
      const victim = await verifiedAccount(shopA);
      const typedEmail = mail('typed');
      const res = await request(server)
        .post('/orders')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          customerName: 'Typed By Staff',
          customerPhone: victim.phone,
          customerEmail: typedEmail,
          customerAddress: 'Pickup',
          outletId: shopA.outletId,
          orderType: 'pickup',
          items: [{ productId: shopA.productId, quantity: 1 }],
        })
        .expect(201);
      const row = await customerRow(shopA, victim.phone);
      expect(row.email).toBe(victim.email);
      expect(row.name).toBe('CRM Shopper');
      const o = await db.query<RowDataPacket[]>(
        `SELECT customerName, customerEmail FROM \`order\` WHERE id = ?`,
        [body<{ id: number }>(res).id],
      );
      expect(o[0].customerEmail).toBe(typedEmail);
      expect(o[0].customerName).toBe('Typed By Staff');
    });

    it('a brand-new phone still creates the customer with what was typed (unverified)', async () => {
      const p = phone();
      const e = mail('fresh');
      await guestCheckout(shopA, p, 'Fresh Guest', e);
      const row = await customerRow(shopA, p);
      expect(row.name).toBe('Fresh Guest');
      expect(row.email).toBe(e);
      expect(row.verifiedEmail).toBeNull();
    });

    it('abandoned-cart capture writes its own table only, never the customer', async () => {
      const victim = await verifiedAccount(shopA);
      const r = await request(server)
        .post(`/public/${shopA.slug}/abandoned-carts`)
        .send({
          outletId: shopA.outletId,
          customerName: 'Evil Eve',
          customerPhone: victim.phone,
          customerEmail: mail('attacker'),
          cartItems: [
            {
              productId: shopA.productId,
              name: 'Test Product',
              price: 50,
              quantity: 1,
              thumbnail: 'https://example.com/x.jpg',
            },
          ],
        })
        .expect(201);
      expect(r.status).toBe(201);
      const row = await customerRow(shopA, victim.phone);
      expect(row.email).toBe(victim.email);
      expect(row.name).toBe('CRM Shopper');
    });

    it('back-in-stock and newsletter sign-ups never touch the customer', async () => {
      const victim = await verifiedAccount(shopA);
      const e = mail('attacker');
      await request(server)
        .post(`/public/${shopA.slug}/newsletter-subscribe`)
        .send({ email: e })
        .expect(201);
      const row = await customerRow(shopA, victim.phone);
      expect(row.email).toBe(victim.email);
      expect(row.name).toBe('CRM Shopper');
    });

    it('registering onto a guest row claims it without inheriting any verified state, and the new email is unproven until clicked', async () => {
      const p = phone();
      await guestCheckout(shopA, p, 'Guest', mail('guest'));
      // Simulate trust that must not survive a claim.
      await db.execute(
        `UPDATE customer SET verifiedEmail = 'stale@test.com', emailVerifiedAt = NOW() WHERE shopId = ? AND phone = ?`,
        [shopA.id, p],
      );
      const e = mail('owner');
      await registerCustomer(server, shopA.slug, p, e);
      const row = await customerRow(shopA, p);
      expect(row.email).toBe(e);
      expect(row.verifiedEmail).toBeNull();
      await forgot(shopA, e).expect(201);
      expect(await resetMails(shopA, e)).toHaveLength(0);
      await forgot(shopA, 'stale@test.com').expect(201);
      expect(await resetMails(shopA, 'stale@test.com')).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it('the same phone in another shop is unaffected, and a verified address in one shop opens nothing in the other', async () => {
      const p = phone();
      const a = await verifiedAccount(shopA, p, mail('a-owner'));
      const b = await verifiedAccount(shopB, p, mail('b-owner'));
      await guestCheckout(shopA, p, 'Evil Eve', mail('attacker'));
      const rowB = await customerRow(shopB, p);
      expect(rowB.email).toBe(b.email);
      expect(rowB.name).toBe('CRM Shopper');
      await forgot(shopB, a.email).expect(201);
      expect(await resetMails(shopB, a.email)).toHaveLength(0);
      await forgot(shopA, b.email).expect(201);
      expect(await resetMails(shopA, b.email)).toHaveLength(0);
      // A token from shop A cannot verify an address on shop B's account.
      expect(
        (await db.query<RowDataPacket[]>(
          `SELECT verifiedEmail FROM customer WHERE shopId = ? AND phone = ?`,
          [shopB.id, p],
        ))[0].verifiedEmail,
      ).toBe(b.email);
    });
  });

  describe('password reset only goes to a verified address', () => {
    it('unknown, unverified and verified addresses all answer 201 { success: true } (devResetLink aside, which production never sends)', async () => {
      const unverifiedEmail = mail('unv');
      await registerCustomer(server, shopA.slug, phone(), unverifiedEmail);
      const v = await verifiedAccount(shopA);

      const unknown = await forgot(shopA, mail('nobody'));
      const unverified = await forgot(shopA, unverifiedEmail);
      const verified = await forgot(shopA, v.email);
      expect(unknown.status).toBe(201);
      expect(unverified.status).toBe(201);
      expect(verified.status).toBe(201);
      const strip = (r: Response) => {
        const { devResetLink: _ignored, ...rest } = body<
          Record<string, unknown>
        >(r);
        void _ignored;
        return rest;
      };
      expect(strip(unknown)).toEqual({ success: true });
      expect(strip(unverified)).toEqual({ success: true });
      expect(strip(verified)).toEqual({ success: true });
      expect(body<Record<string, unknown>>(unverified)).toEqual({ success: true });
      expect(await resetMails(shopA, unverifiedEmail)).toHaveLength(0);
      expect(await resetMails(shopA, v.email)).toHaveLength(1);
    });

    it('a second request within a minute sends no second mail (inbox flooding), same answer', async () => {
      const v = await verifiedAccount(shopA);
      await forgot(shopA, v.email).expect(201);
      const again = await forgot(shopA, v.email).expect(201);
      expect(body<Record<string, unknown>>(again).success).toBe(true);
      expect(await resetMails(shopA, v.email)).toHaveLength(1);
    });

    it('a reset link issued before this change (no targetEmail) or for a replaced address is refused', async () => {
      const v = await verifiedAccount(shopA);
      const legacy = generateOpaqueToken();
      await db.execute(
        `INSERT INTO customerauthtoken (customerId, purpose, tokenHash, expiresAt, targetEmail) VALUES (?, 'password_reset', ?, ?, NULL)`,
        [v.session.customerId, hashToken(legacy), new Date(Date.now() + 600000)],
      );
      const other = generateOpaqueToken();
      await db.execute(
        `INSERT INTO customerauthtoken (customerId, purpose, tokenHash, expiresAt, targetEmail) VALUES (?, 'password_reset', ?, ?, 'someone-else@test.com')`,
        [v.session.customerId, hashToken(other), new Date(Date.now() + 600000)],
      );
      for (const token of [legacy, other]) {
        await request(server)
          .post(`/public/${shopA.slug}/auth/reset-password`)
          .send({ token, newPassword: 'brand-new-pass-9' })
          .expect(400);
      }
      await request(server)
        .post(`/public/${shopA.slug}/auth/login`)
        .send({ identifier: v.phone, password: 'victim-pass-1' })
        .expect(201);
    });

    it('a legacy-shaped account (password, unproven email) cannot reset, can still log in, and can reset once it verifies', async () => {
      const p = phone();
      const e = mail('legacy');
      const s = await registerCustomer(server, shopA.slug, p, e, 'legacy-pass-12');
      // Nothing proven yet: the shape of every account that exists before this change.
      expect((await customerRow(shopA, p)).verifiedEmail).toBeNull();
      await forgot(shopA, e).expect(201);
      expect(await resetMails(shopA, e)).toHaveLength(0);
      await request(server)
        .post(`/public/${shopA.slug}/auth/login`)
        .send({ identifier: e, password: 'legacy-pass-12' })
        .expect(201);
      // The one-time step: log in, ask for the link, click it.
      await asCustomer(server, s, 'post', `/public/${shopA.slug}/account/email/verification`).expect(201);
      await verifyCustomerEmail(server, db, shopA, e);
      await forgot(shopA, e).expect(201);
      expect(await resetMails(shopA, e)).toHaveLength(1);
    });
  });

  describe('email verification', () => {
    it('registration mails a link; clicking it proves the address, once', async () => {
      const e = mail('reg');
      const s = await registerCustomer(server, shopA.slug, phone(), e);
      const mails = (await sentEmails(db, shopA.id, e)).filter(
        (m) => m.subject === 'Verify your email',
      );
      expect(mails).toHaveLength(1);
      const token = tokenIn(mails[0]);
      await request(server)
        .post(`/public/${shopA.slug}/auth/verify-email`)
        .send({ token })
        .expect(201);
      const profile = await asCustomer(
        server,
        s,
        'get',
        `/public/${shopA.slug}/account/profile`,
      ).expect(200);
      expect(body<{ emailVerified: boolean }>(profile).emailVerified).toBe(true);
      await request(server)
        .post(`/public/${shopA.slug}/auth/verify-email`)
        .send({ token })
        .expect(400);
    });

    it('unknown, expired, wrong-purpose and stale-address tokens are all refused with the same 400 and verify nothing', async () => {
      const e = mail('badtok');
      const p = phone();
      const s = await registerCustomer(server, shopA.slug, p, e);
      const row = await customerRow(shopA, p);
      const token = tokenIn(
        (await sentEmails(db, shopA.id, e)).filter(
          (m) => m.subject === 'Verify your email',
        )[0],
      );
      const bodies: string[] = [];
      const attempt = async (t: string) => {
        const r = await request(server)
          .post(`/public/${shopA.slug}/auth/verify-email`)
          .send({ token: t })
          .expect(400);
        bodies.push(JSON.stringify(body(r)));
      };
      await attempt('f'.repeat(64));
      // wrong purpose: a reset token
      const resetTok = generateOpaqueToken();
      await db.execute(
        `INSERT INTO customerauthtoken (customerId, purpose, tokenHash, expiresAt, targetEmail) VALUES (?, 'password_reset', ?, ?, ?)`,
        [s.customerId, hashToken(resetTok), new Date(Date.now() + 600000), e],
      );
      await attempt(resetTok);
      // stale address: the account's email changed after the link was sent
      await db.execute(`UPDATE customer SET email = ? WHERE id = ?`, [
        mail('moved'),
        row.id,
      ]);
      await attempt(token);
      expect((await customerRow(shopA, p)).verifiedEmail).toBeNull();
      // expired
      await db.execute(`UPDATE customer SET email = ? WHERE id = ?`, [e, row.id]);
      await db.execute(
        `UPDATE customerauthtoken SET expiresAt = ? WHERE tokenHash = ?`,
        [new Date(Date.now() - 1000), hashToken(token)],
      );
      await attempt(token);
      expect((await customerRow(shopA, p)).verifiedEmail).toBeNull();
      expect(new Set(bodies.map((b) => b.replace(/already been used/, 'x'))).size).toBe(1);
    });

    it('an address already verified on another account in the shop cannot be verified twice (409), and the first account is unaffected', async () => {
      const first = await verifiedAccount(shopA);
      const p2 = phone();
      // A second account that typed the same address, unproven.
      const s2 = await registerCustomer(server, shopA.slug, p2, mail('second'), 'second-pass-2');
      await db.execute(`UPDATE customer SET email = ? WHERE id = ?`, [first.email, s2.customerId]);
      // Skip the per-account resend gap the registration link just started.
      await db.execute(
        `UPDATE customerauthtoken SET createdAt = ? WHERE customerId = ?`,
        [new Date(Date.now() - 2 * 3600 * 1000), s2.customerId],
      );
      await asCustomer(server, s2, 'post', `/public/${shopA.slug}/account/email/verification`).expect(201);
      const mails = (await sentEmails(db, shopA.id, first.email)).filter(
        (m) => m.subject === 'Verify your email',
      );
      const r = await request(server)
        .post(`/public/${shopA.slug}/auth/verify-email`)
        .send({ token: tokenIn(mails[mails.length - 1]) });
      expect(r.status).toBe(409);
      expect((await customerRow(shopA, p2)).verifiedEmail).toBeNull();
      expect((await customerRow(shopA, first.phone)).verifiedEmail).toBe(first.email);
      // login by that email still reaches the verified owner
      await request(server)
        .post(`/public/${shopA.slug}/auth/login`)
        .send({ identifier: first.email, password: 'victim-pass-1' })
        .expect(201);
    });

    it('resending is generic and limited per account (one a minute)', async () => {
      const e = mail('resend');
      const s = await registerCustomer(server, shopA.slug, phone(), e);
      const r1 = await asCustomer(server, s, 'post', `/public/${shopA.slug}/account/email/verification`).expect(201);
      const r2 = await asCustomer(server, s, 'post', `/public/${shopA.slug}/account/email/verification`).expect(201);
      expect(body(r1)).toEqual(body(r2));
      // registration's own link counts: still exactly one in the first minute
      const verifies = (await sentEmails(db, shopA.id, e)).filter(
        (m) => m.subject === 'Verify your email',
      );
      expect(verifies).toHaveLength(1);
    });

    it('verified accounts and accounts without an email get the same generic answer and no mail', async () => {
      const v = await verifiedAccount(shopA);
      const before = (await sentEmails(db, shopA.id, v.email)).length;
      const r = await asCustomer(server, v.session, 'post', `/public/${shopA.slug}/account/email/verification`).expect(201);
      expect(body(r)).toEqual({ success: true });
      expect((await sentEmails(db, shopA.id, v.email)).length).toBe(before);
    });
  });

  describe('profile email change', () => {
    it('an account with a verified address needs the current password to change it; the reset destination does not move until the new one is verified', async () => {
      const v = await verifiedAccount(shopA);
      const newEmail = mail('new');
      const patch = (payload: Record<string, unknown>) =>
        asCustomer(server, v.session, 'patch', `/public/${shopA.slug}/account/profile`).send(payload);

      await patch({ email: newEmail }).expect(403);
      await patch({ email: newEmail, currentPassword: 'wrong-pass-1' }).expect(403);
      expect((await customerRow(shopA, v.phone)).email).toBe(v.email);

      const ok = await patch({ email: newEmail, currentPassword: 'victim-pass-1' }).expect(200);
      expect(body<{ emailVerified: boolean }>(ok).emailVerified).toBe(false);
      const row = await customerRow(shopA, v.phone);
      expect(row.email).toBe(newEmail);
      expect(row.verifiedEmail).toBe(v.email); // untouched

      // The old proven address was told; the new one got a verification link.
      expect(
        (await sentEmails(db, shopA.id, v.email)).some((m) => m.subject === 'Your account email was changed'),
      ).toBe(true);
      expect(
        (await sentEmails(db, shopA.id, newEmail)).some((m) => m.subject === 'Verify your email'),
      ).toBe(true);

      // Reset: still only the old verified address.
      await forgot(shopA, newEmail).expect(201);
      expect(await resetMails(shopA, newEmail)).toHaveLength(0);
      await forgot(shopA, v.email).expect(201);
      const oldLink = (await resetMails(shopA, v.email))[0];
      expect(oldLink).toBeDefined();

      // Verifying the new address moves the destination and kills the old link.
      await verifyCustomerEmail(server, db, shopA, newEmail);
      expect((await customerRow(shopA, v.phone)).verifiedEmail).toBe(newEmail);
      await request(server)
        .post(`/public/${shopA.slug}/auth/reset-password`)
        .send({ token: tokenIn(oldLink), newPassword: 'brand-new-pass-9' })
        .expect(400);
      await forgot(shopA, v.email).expect(201);
      expect(await resetMails(shopA, v.email)).toHaveLength(1);
    });

    it('a stolen session cannot redirect resets: repeated wrong passwords hit the login lockout', async () => {
      const v = await verifiedAccount(shopA);
      for (let i = 0; i < 5; i++) {
        await asCustomer(server, v.session, 'patch', `/public/${shopA.slug}/account/profile`)
          .send({ email: mail('thief'), currentPassword: 'guess-' + i + '-aaaa' })
          .expect(403);
      }
      const row = await db.query<RowDataPacket[]>(
        `SELECT failedLoginAttempts FROM customer WHERE id = ?`,
        [v.session.customerId],
      );
      expect(Number(row[0].failedLoginAttempts)).toBeGreaterThanOrEqual(5);
      // Even the right password is refused during the cooldown.
      await asCustomer(server, v.session, 'patch', `/public/${shopA.slug}/account/profile`)
        .send({ email: mail('thief'), currentPassword: 'victim-pass-1' })
        .expect(403);
      expect((await customerRow(shopA, v.phone)).email).toBe(v.email);
    });

    it('an account with nothing verified can set its email freely; it stays unproven', async () => {
      const s = await registerCustomer(server, shopA.slug, phone(), mail('free'));
      const e = mail('free2');
      const r = await asCustomer(server, s, 'patch', `/public/${shopA.slug}/account/profile`)
        .send({ email: e })
        .expect(200);
      expect(body<{ email: string; emailVerified: boolean }>(r)).toMatchObject({
        email: e,
        emailVerified: false,
      });
    });

    it('name and phone changes need no password and do not touch verification', async () => {
      const v = await verifiedAccount(shopA);
      await asCustomer(server, v.session, 'patch', `/public/${shopA.slug}/account/profile`)
        .send({ name: 'Renamed' })
        .expect(200);
      const row = await customerRow(shopA, v.phone);
      expect(row.name).toBe('Renamed');
      expect(row.verifiedEmail).toBe(v.email);
    });
  });

  describe('login cannot be shadowed by a guest row', () => {
    it('a guest row that carries the owner’s email (created first) does not stop the owner logging in by that email', async () => {
      const e = mail('shadow');
      await guestCheckout(shopA, phone(), 'Squatter', e); // earlier id, no password
      await registerCustomer(server, shopA.slug, phone(), e, 'owner-pass-12');
      await request(server)
        .post(`/public/${shopA.slug}/auth/login`)
        .send({ identifier: e, password: 'owner-pass-12' })
        .expect(201);
    });
  });

  describe('account deletion', () => {
    it('anonymising clears the verified address, so a reset can no longer reach or revive the row', async () => {
      const v = await verifiedAccount(shopA);
      const requested = await asCustomer(server, v.session, 'delete', `/public/${shopA.slug}/account/me`).expect(202);
      const token = body<{ confirmationToken: string }>(requested).confirmationToken;
      // an outstanding reset link minted before deletion
      await forgot(shopA, v.email).expect(201);
      const link = (await resetMails(shopA, v.email))[0];
      await asCustomer(server, v.session, 'delete', `/public/${shopA.slug}/account/me/confirm?token=${token}`).expect(200);
      const rows = await db.query<CustomerDb[]>(`SELECT * FROM customer WHERE id = ?`, [v.session.customerId]);
      expect(rows[0].verifiedEmail).toBeNull();
      expect(rows[0].passwordHash).toBeNull();
      await request(server)
        .post(`/public/${shopA.slug}/auth/reset-password`)
        .send({ token: tokenIn(link), newPassword: 'brand-new-pass-9' })
        .expect(400);
      expect((await db.query<CustomerDb[]>(`SELECT passwordHash FROM customer WHERE id = ?`, [v.session.customerId]))[0].passwordHash).toBeNull();
    });
  });

  describe('nothing sensitive in logs', () => {
    it('register, login, verify, forgot and reset write neither the password nor a raw token to stdout/stderr', async () => {
      const chunks: string[] = [];
      const capture = (c: unknown) => {
        chunks.push(typeof c === 'string' ? c : Buffer.from(c as Uint8Array).toString());
        return true;
      };
      const out = jest.spyOn(process.stdout, 'write').mockImplementation(capture as never);
      const err = jest.spyOn(process.stderr, 'write').mockImplementation(capture as never);
      const logs = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
        jest.spyOn(console, m as 'log').mockImplementation((...a: unknown[]) => {
          chunks.push(a.map(String).join(' '));
        }),
      );
      const secret = 'LogProbe-Passw0rd-xyz1';
      const newSecret = 'LogProbe-NewPassw0rd-xyz2';
      const e = mail('logs');
      const p = phone();
      let tokens: string[] = [];
      try {
        const reg = await request(server)
          .post(`/public/${shopA.slug}/auth/register`)
          .send({ name: 'Log Probe', phone: p, email: e, password: secret })
          .expect(201);
        const s: CustomerSession = sessionFrom(reg);
        await verifyCustomerEmail(server, db, shopA, e);
        await request(server).post(`/public/${shopA.slug}/auth/login`).send({ identifier: e, password: secret }).expect(201);
        await request(server).post(`/public/${shopA.slug}/auth/login`).send({ identifier: e, password: 'wrong-' + secret }).expect(401);
        await forgot(shopA, e).expect(201);
        const m = (await resetMails(shopA, e))[0];
        await request(server)
          .post(`/public/${shopA.slug}/auth/reset-password`)
          .send({ token: tokenIn(m), newPassword: newSecret })
          .expect(201);
        tokens = (await sentEmails(db, shopA.id, e)).map(tokenIn);
        expect(s.customerId).toBeGreaterThan(0);
      } finally {
        out.mockRestore();
        err.mockRestore();
        logs.forEach((l) => l.mockRestore());
      }
      const all = chunks.join('\n');
      expect(tokens.length).toBeGreaterThan(0);
      for (const t of tokens) expect(all).not.toContain(t);
      expect(all).not.toContain(secret);
      expect(all).not.toContain(newSecret);
    });
  });
});
