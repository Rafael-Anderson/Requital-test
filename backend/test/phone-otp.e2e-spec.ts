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
import { asCustomer, sessionFrom } from './helpers/customer-session';
import { testOtpOutbox } from '../src/customer-auth/otp-channel';
import { normalizePhoneToE164 } from '../src/common/phone';

// Phone OTP on customer register (phone_otp_register). Flag off must be today's
// behaviour; flag on must stop a caller who only knows a phone number from
// claiming that number's account.

interface Shop {
  slug: string;
  id: number;
  outletId: number;
  productId: number;
}
const body = <T>(res: Response) => res.body as T;

describe('phone OTP register (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let server: App;
  const runId = Date.now();
  let seq = 0;
  let shopOff: Shop;
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
    await app.listen(0); // parallel requests need a bound port
    server = app.getHttpServer() as App;
    db = app.get(DatabaseService);
    shopOff = await setupShop('otp-off');
    shopA = await setupShop('otp-a');
    shopB = await setupShop('otp-b');
    for (const s of [shopA, shopB]) {
      await db.execute(
        `INSERT INTO shopfeatureoverride (shopId, featureKey, enabled) VALUES (?, 'phone_otp_register', 1)`,
        [s.id],
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    delete process.env.PHONE_OTP_DISABLED;
    delete process.env.PHONE_OTP_SHOP_DAILY_CAP;
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
        sku: `OTP-${runId}-${prefix}`,
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
    return { slug, id: rows[0].id as number, outletId, productId };
  }

  const phone = () =>
    `05${String(runId).slice(-4)}${String(++seq).padStart(4, '0')}`;
  const e164 = (p: string) => normalizePhoneToE164(p, null)!;

  const send = (shop: Shop, p: string) =>
    request(server).post(`/public/${shop.slug}/auth/phone-otp/send`).send({ phone: p });
  const verify = (shop: Shop, p: string, code: string) =>
    request(server)
      .post(`/public/${shop.slug}/auth/phone-otp/verify`)
      .send({ phone: p, code });
  const register = (shop: Shop, p: string, extra: Record<string, unknown> = {}) =>
    request(server)
      .post(`/public/${shop.slug}/auth/register`)
      .send({
        name: 'Reg',
        phone: p,
        email: `reg-${runId}-${++seq}@test.com`,
        password: 'password123',
        ...extra,
      });

  async function proofFor(shop: Shop, p: string): Promise<string> {
    await send(shop, p).expect(202);
    const code = testOtpOutbox.last(e164(p))!.code;
    const res = await verify(shop, p, code).expect(200);
    return body<{ proof: string }>(res).proof;
  }

  function guestCheckout(shop: Shop, p: string) {
    return request(server)
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName: 'Guest',
        customerPhone: p,
        customerAddress: 'Pickup',
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);
  }

  const customerRow = async (shop: Shop, p: string) =>
    (
      await db.query<RowDataPacket[]>(
        `SELECT * FROM customer WHERE shopId = ? AND phone = ?`,
        [shop.id, p],
      )
    )[0];
  const otpRows = (shop: Shop, p: string) =>
    db.query<RowDataPacket[]>(
      `SELECT * FROM phoneotp WHERE shopId = ? AND phone = ? ORDER BY id`,
      [shop.id, e164(p)],
    );

  describe('flag OFF (default): today\'s behaviour', () => {
    it('the routes do not exist for the shop and the public payload says not required', async () => {
      await send(shopOff, phone()).expect(404);
      await verify(shopOff, phone(), '123456').expect(404);
      const pub = await request(server).get(`/public/${shopOff.slug}`).expect(200);
      expect(body<{ phoneOtpRequired: boolean }>(pub).phoneOtpRequired).toBe(false);
    });

    it('register still just sets a password on the guest-created row, with no proof', async () => {
      const p = phone();
      await guestCheckout(shopOff, p);
      const before = await customerRow(shopOff, p);
      expect(before.passwordHash).toBeNull();
      const res = await register(shopOff, p).expect(201);
      const after = await customerRow(shopOff, p);
      expect(after.id).toBe(before.id);
      expect(after.passwordHash).not.toBeNull();
      expect(after.phoneVerifiedAt).toBeNull();
      expect(body<{ customer: { id: number } }>(res).customer.id).toBe(before.id);
    });

    it('a proof field is ignored, not rejected', async () => {
      await register(shopOff, phone(), { phoneProof: 'a'.repeat(64) }).expect(201);
    });
  });

  describe('flag ON', () => {
    it('the public payload exposes the boolean', async () => {
      const pub = await request(server).get(`/public/${shopA.slug}`).expect(200);
      expect(body<{ phoneOtpRequired: boolean }>(pub).phoneOtpRequired).toBe(true);
    });

    it('send answers identically for a fresh number, a registered one, a wrong-country one and a killed channel', async () => {
      const fresh = phone();
      const guest = phone();
      await guestCheckout(shopA, guest);
      const results: [number, unknown][] = [];
      for (const p of [fresh, guest, '+447911123456']) {
        const r = await send(shopA, p);
        results.push([r.status, r.body]);
      }
      process.env.PHONE_OTP_DISABLED = '1';
      const killed = await send(shopA, phone());
      results.push([killed.status, killed.body]);
      for (const r of results) expect(r).toEqual([202, { accepted: true }]);
      expect(testOtpOutbox.last(e164(fresh))).toBeDefined();
      expect(testOtpOutbox.last(e164(guest))).toBeDefined();
      expect(testOtpOutbox.last('+447911123456')).toBeUndefined();
      expect(await otpRows(shopA, '+447911123456')).toHaveLength(0);
    });

    it('stores only a hash of the code and never the code or an unnormalised phone', async () => {
      const p = phone();
      await send(shopA, p).expect(202);
      const code = testOtpOutbox.last(e164(p))!.code;
      const rows = await otpRows(shopA, p);
      expect(rows).toHaveLength(1);
      expect(rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(rows[0])).not.toContain(code);
      expect(rows[0].phone).toBe(e164(p));
    });

    it('ACCOUNT TAKEOVER: a caller who only knows the phone of a customer with orders cannot claim it', async () => {
      const victim = phone();
      await guestCheckout(shopA, victim);
      const before = await customerRow(shopA, victim);

      // No proof, garbage proof, and a genuine proof for the attacker's own number.
      const attackerProof = await proofFor(shopA, phone());
      for (const extra of [
        {},
        { phoneProof: 'z' },
        { phoneProof: '0'.repeat(64) },
        { phoneProof: attackerProof },
      ]) {
        const r = await register(shopA, victim, extra).expect(400);
        expect(body<{ code: string }>(r).code).toBe('phone_verification_required');
      }
      const after = await customerRow(shopA, victim);
      expect(after.passwordHash).toBeNull();
      expect(after.id).toBe(before.id);

      // The real holder of the number can.
      const proof = await proofFor(shopA, victim);
      const ok = await register(shopA, victim, { phoneProof: proof }).expect(201);
      expect(body<{ customer: { id: number } }>(ok).customer.id).toBe(before.id);
      const claimed = await customerRow(shopA, victim);
      expect(claimed.passwordHash).not.toBeNull();
      expect(claimed.phoneVerifiedAt).not.toBeNull();
    });

    it('a brand new number also needs a proof (otherwise a later guest checkout would feed the attacker)', async () => {
      const p = phone();
      await register(shopA, p).expect(400);
      expect(await customerRow(shopA, p)).toBeUndefined();
    });

    it('a different spelling of the same number is the same number', async () => {
      const p = phone();
      const proof = await proofFor(shopA, `+971${p.slice(1)}`);
      await register(shopA, p, { phoneProof: proof }).expect(201);
    });

    it('a proof is single use', async () => {
      const p = phone();
      const proof = await proofFor(shopA, p);
      await register(shopA, p, { phoneProof: proof }).expect(201);
      // Remove the account so only the proof is in the way of a second claim.
      await db.execute(
        `UPDATE customer SET passwordHash = NULL WHERE shopId = ? AND phone = ?`,
        [shopA.id, p],
      );
      await register(shopA, p, { phoneProof: proof }).expect(400);
    });

    it('a rejected password does not burn the proof', async () => {
      const p = phone();
      const proof = await proofFor(shopA, p);
      await register(shopA, p, { phoneProof: proof, password: 'short' }).expect(400);
      await register(shopA, p, { phoneProof: proof }).expect(201);
    });

    it('CROSS-SHOP: a proof or code from one shop is useless in another', async () => {
      const p = phone();
      const proofA = await proofFor(shopA, p);
      await register(shopB, p, { phoneProof: proofA }).expect(400);
      expect(await customerRow(shopB, p)).toBeUndefined();

      await send(shopA, p).expect(202);
      const codeA = testOtpOutbox.last(e164(p))!.code;
      await send(shopB, p).expect(202);
      const codeB = testOtpOutbox.last(e164(p))!.code;
      if (codeA !== codeB) {
        await verify(shopB, p, codeA).expect(400);
      }
      // Moving a row between shops by hand still does not verify: the hash binds the shop.
      const rowsA = await otpRows(shopA, p);
      await db.execute(
        `UPDATE phoneotp SET codeHash = ? WHERE shopId = ? AND phone = ? AND consumedAt IS NULL`,
        [rowsA[rowsA.length - 1].codeHash, shopB.id, e164(p)],
      );
      await verify(shopB, p, codeA).expect(400);
    });

    it('a code is single use, expires, and dies after 5 wrong tries', async () => {
      const p = phone();
      await send(shopA, p).expect(202);
      const code = testOtpOutbox.last(e164(p))!.code;
      await verify(shopA, p, code).expect(200);
      await verify(shopA, p, code).expect(400); // replay

      const q = phone();
      await send(shopA, q).expect(202);
      const qc = testOtpOutbox.last(e164(q))!.code;
      await db.execute(
        `UPDATE phoneotp SET expiresAt = ? WHERE shopId = ? AND phone = ?`,
        [new Date(Date.now() - 1000), shopA.id, e164(q)],
      );
      await verify(shopA, q, qc).expect(400); // expired

      const r = phone();
      await send(shopA, r).expect(202);
      const rc = testOtpOutbox.last(e164(r))!.code;
      const wrong = rc === '000000' ? '000001' : '000000';
      for (let i = 0; i < 5; i++) await verify(shopA, r, wrong).expect(400);
      await verify(shopA, r, rc).expect(400); // right code after the cap
      const rows = await otpRows(shopA, r);
      expect(rows[0].attempts).toBe(5);
    });

    it('parallel guesses cannot exceed the attempt cap', async () => {
      const p = phone();
      await send(shopA, p).expect(202);
      const code = testOtpOutbox.last(e164(p))!.code;
      const wrong = code === '000000' ? '000001' : '000000';
      await Promise.all(
        Array.from({ length: 12 }, () => verify(shopA, p, wrong)),
      );
      expect((await otpRows(shopA, p))[0].attempts).toBe(5);
    });

    it('an expired proof does not register', async () => {
      const p = phone();
      const proof = await proofFor(shopA, p);
      await db.execute(
        `UPDATE phoneotp SET proofExpiresAt = ? WHERE shopId = ? AND phone = ?`,
        [new Date(Date.now() - 1000), shopA.id, e164(p)],
      );
      await register(shopA, p, { phoneProof: proof }).expect(400);
    });

    it('a newer code replaces the older one', async () => {
      const p = phone();
      await send(shopA, p).expect(202);
      const first = testOtpOutbox.last(e164(p))!.code;
      await db.execute(
        `UPDATE phoneotp SET createdAt = ? WHERE shopId = ? AND phone = ?`,
        [new Date(Date.now() - 2 * 60 * 1000), shopA.id, e164(p)],
      );
      await send(shopA, p).expect(202);
      const second = testOtpOutbox.last(e164(p))!.code;
      if (first !== second) await verify(shopA, p, first).expect(400);
      await verify(shopA, p, second).expect(200);
    });

    describe('send throttles', () => {
      const age = (shop: Shop, p: string, ms: number) =>
        db.execute(
          `UPDATE phoneotp SET createdAt = createdAt - INTERVAL ? SECOND WHERE shopId = ? AND phone = ?`,
          [Math.floor(ms / 1000), shop.id, e164(p)],
        );

      it('1 per 60 seconds, 5 per hour, 10 per day per phone, all answered 202', async () => {
        const p = phone();
        await send(shopA, p).expect(202);
        await send(shopA, p).expect(202);
        expect(await otpRows(shopA, p)).toHaveLength(1); // 60 s

        for (let i = 0; i < 4; i++) {
          await age(shopA, p, 61 * 1000);
          await send(shopA, p).expect(202);
        }
        expect(await otpRows(shopA, p)).toHaveLength(5);
        await age(shopA, p, 61 * 1000);
        await send(shopA, p).expect(202);
        expect(await otpRows(shopA, p)).toHaveLength(5); // 5 per hour

        // Push everything out of the hour window but inside the day.
        await age(shopA, p, 2 * 60 * 60 * 1000);
        for (let i = 0; i < 5; i++) {
          await send(shopA, p).expect(202);
          await age(shopA, p, 61 * 1000);
        }
        expect(await otpRows(shopA, p)).toHaveLength(10);
        await age(shopA, p, 61 * 1000);
        await send(shopA, p).expect(202);
        expect(await otpRows(shopA, p)).toHaveLength(10); // 10 per day
      });

      it('concurrent sends for one number issue exactly one code', async () => {
        const p = phone();
        const rs = await Promise.all(Array.from({ length: 6 }, () => send(shopA, p)));
        for (const r of rs) expect(r.status).toBe(202);
        expect(await otpRows(shopA, p)).toHaveLength(1);
      });

      it('a per-shop daily cap', async () => {
        const [{ n }] = await db.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM phoneotp WHERE shopId = ?`,
          [shopB.id],
        );
        process.env.PHONE_OTP_SHOP_DAILY_CAP = String(Number(n) + 2);
        const phones = [phone(), phone(), phone()];
        for (const p of phones) await send(shopB, p).expect(202);
        const sent = phones.filter((p) => testOtpOutbox.last(e164(p)));
        expect(sent).toHaveLength(2);
      });

      it('the kill switch stops sending but never blocks login', async () => {
        const p = phone();
        const proof = await proofFor(shopA, p);
        await register(shopA, p, { phoneProof: proof, password: 'kill-switch-pw-9' }).expect(201);
        process.env.PHONE_OTP_DISABLED = '1';
        await request(server)
          .post(`/public/${shopA.slug}/auth/login`)
          .send({ identifier: p, password: 'kill-switch-pw-9' })
          .expect(201);
      });
    });

    it('PDPL: deleting the account removes the number\'s code rows and the verified timestamp', async () => {
      const p = phone();
      const proof = await proofFor(shopA, p);
      const res = await register(shopA, p, { phoneProof: proof }).expect(201);
      const sess = sessionFrom(res);
      expect(await otpRows(shopA, p)).not.toHaveLength(0);

      const exp = await asCustomer(server, sess, 'get', `/public/${shopA.slug}/account/export`).expect(200);
      expect(body<{ phoneVerifiedAt: string | null }>(exp).phoneVerifiedAt).not.toBeNull();

      const req1 = await asCustomer(server, sess, 'delete', `/public/${shopA.slug}/account/me`).expect(202);
      const token = body<{ confirmationToken: string }>(req1).confirmationToken;
      await asCustomer(server, sess, 'delete', `/public/${shopA.slug}/account/me/confirm?token=${token}`).expect(200);
      expect(await otpRows(shopA, p)).toHaveLength(0);
      const row = (
        await db.query<RowDataPacket[]>(
          `SELECT phoneVerifiedAt FROM customer WHERE id = ?`,
          [sess.customerId],
        )
      )[0];
      expect(row.phoneVerifiedAt).toBeNull();
    });
  });
});
