import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { OrderNotificationsService } from '../src/orders/order-notifications.service';
import * as tokenHash from '../src/common/token-hash';
import { storefrontUrl } from '../src/common/storefront-url';
import type { JobRow, SurveyresponseRow } from '../src/db/types';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface IdRow {
  id: number;
}
interface PublicReview {
  name: string;
  rating: number;
  comment: string;
  date: string;
}
interface AdminList {
  data: {
    id: number;
    publishConsent: number | null;
    featuredAt: string | null;
    canFeature: boolean;
  }[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(30000);

// A customer can withdraw the consent they gave on the survey, through the
// survey token alone. Withdrawal clears consent AND the featured flag in one
// statement; re-granting is not supported (the survey is single-shot).
describe('Survey consent withdrawal (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  let tokenSeq = 0;

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
    db = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  interface Shop {
    slug: string;
    shopId: number;
    adminToken: string;
    outletId: number;
    productId: number;
  }

  async function setupShop(prefix: string): Promise<Shop> {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Withdraw Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    await verifySignupEmail(
      app.getHttpServer(),
      (signup.body as { devVerificationLink?: string }).devVerificationLink,
    );
    const adminToken = (signup.body as { accessToken: string }).accessToken;
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notifyEmail: true, customerSurveyEnabled: true })
      .expect(200);
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Withdraw Item ${slug}`,
        price: 25,
        thumbnail: 'https://example.com/x.jpg',
        sku: `WDR-${slug}`,
        collectionIds: [body<IdRow>(collection).id],
        trackInventory: false,
      })
      .expect(201);
    const rows = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    const shopId = rows[0].id as number;
    await db.execute(`UPDATE shop SET published = 1 WHERE id = ?`, [shopId]);
    return {
      slug,
      shopId,
      adminToken,
      outletId,
      productId: body<IdRow>(product).id,
    };
  }

  // A real order plus a survey row inserted directly. `answered: false`
  // leaves rating/comment/respondedAt NULL, like a survey nobody opened.
  async function addSurvey(
    shop: Shop,
    opts: {
      answered?: boolean;
      consent?: number | null;
      featured?: boolean;
      email?: string | null;
      token?: string;
    } = {},
  ): Promise<{ id: number; token: string; orderId: number }> {
    const answered = opts.answered ?? true;
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Sara Khan',
        customerPhone: '0500000004',
        customerAddress: '77 Private Street',
        ...(opts.email === null
          ? {}
          : { customerEmail: opts.email ?? `sara-${runId}@example.com` }),
        outletId: shop.outletId,
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);
    const orderId = body<IdRow>(order).id;
    const token = opts.token ?? `WD${runId % 1e6}${++tokenSeq}`.slice(0, 20);
    const result = await db.execute(
      `INSERT INTO surveyresponse
         (shopId, orderId, token, rating, comment, respondedAt, publishConsent, featuredAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shop.shopId,
        orderId,
        token,
        answered ? 5 : null,
        answered ? 'Beautiful flowers' : null,
        answered ? new Date() : null,
        answered ? (opts.consent === undefined ? 1 : opts.consent) : null,
        opts.featured ? new Date() : null,
      ],
    );
    return { id: result.insertId, token, orderId };
  }

  const withdraw = (token: string) =>
    request(app.getHttpServer()).post(
      `/public/surveys/withdraw-consent?token=${encodeURIComponent(token)}`,
    );
  const publicList = (slug: string) =>
    request(app.getHttpServer()).get(`/public/${slug}/reviews/featured`);
  const feature = (shop: Shop, id: number, featured: boolean) =>
    request(app.getHttpServer())
      .patch(`/reviews/${id}/featured`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ featured });
  async function rowOf(id: number) {
    const rows = await db.query<(SurveyresponseRow & RowDataPacket)[]>(
      `SELECT * FROM surveyresponse WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  describe('withdraw by token', () => {
    it('stops serving a featured review at once, clears featuredAt and consent, and is idempotent', async () => {
      const shop = await setupShop('wd-main');
      const s = await addSurvey(shop);
      await feature(shop, s.id, true).expect(200);

      // Present before.
      let list = body<PublicReview[]>(await publicList(shop.slug).expect(200));
      expect(list.some((r) => r.comment === 'Beautiful flowers')).toBe(true);

      const res = await withdraw(s.token).expect(201);
      expect(res.body).toEqual({ withdrawn: true });

      // Gone on the very next read, no cache in between.
      list = body<PublicReview[]>(await publicList(shop.slug).expect(200));
      expect(list.some((r) => r.comment === 'Beautiful flowers')).toBe(false);

      // Direct column assertions (the read above would also pass on the
      // read-time eligibility rule alone, so the columns are checked too).
      const row = await rowOf(s.id);
      expect(row.featuredAt).toBeNull();
      expect(Number(row.publishConsent)).toBe(0);
      expect(row.respondedAt).not.toBeNull();

      // Second call: same answer, nothing changes.
      const again = await withdraw(s.token).expect(201);
      expect(again.body).toEqual({ withdrawn: true });
      expect(Number((await rowOf(s.id)).publishConsent)).toBe(0);
    });

    it('is a harmless no-op for a row that declined or never recorded consent, and never echoes PII', async () => {
      const shop = await setupShop('wd-noop');
      const declined = await addSurvey(shop, { consent: 0 });
      const unknown = await addSurvey(shop, { consent: null });
      for (const s of [declined, unknown]) {
        const res = await withdraw(s.token).expect(201);
        expect(res.body).toEqual({ withdrawn: true });
        expect(JSON.stringify(res.body)).not.toMatch(/Sara|example\.com|Beautiful/);
        const row = await rowOf(s.id);
        expect(Number(row.publishConsent)).toBe(0);
        expect(row.featuredAt).toBeNull();
        // The customer's answer is untouched.
        expect(row.rating).toBe(5);
        expect(row.comment).toBe('Beautiful flowers');
      }
    });

    it('rejects an unanswered survey and leaves the row alone', async () => {
      const shop = await setupShop('wd-unanswered');
      const s = await addSurvey(shop, { answered: false });
      const res = await withdraw(s.token).expect(400);
      expect(JSON.stringify(res.body)).toContain('not been answered');
      const row = await rowOf(s.id);
      expect(row.respondedAt).toBeNull();
      expect(row.publishConsent).toBeNull();
    });

    it('answers an unknown and a malformed token with the identical 404, and a missing token with 400', async () => {
      const unknown = await withdraw('ZZZZZZZZZZ').expect(404);
      for (const bad of [
        "'; DROP TABLE surveyresponse; --",
        '%00',
        'a'.repeat(5000),
        '../../etc/passwd',
        '0',
      ]) {
        const res = await withdraw(bad).expect(404);
        expect(res.body).toEqual(unknown.body);
      }
      await request(app.getHttpServer())
        .post('/public/surveys/withdraw-consent')
        .expect(400);
      await withdraw('   ').expect(400);
      // Array-valued token (?token=a&token=b) must not slip through.
      await request(app.getHttpServer())
        .post('/public/surveys/withdraw-consent?token=A&token=B')
        .expect((r) => {
          if (![400, 404].includes(r.status)) throw new Error(`got ${r.status}`);
        });
    });

    it("withdrawing through shop A's token leaves shop B's rows untouched", async () => {
      const a = await setupShop('wd-tenant-a');
      const b = await setupShop('wd-tenant-b');
      const sa = await addSurvey(a, { featured: true });
      const sb = await addSurvey(b, { featured: true });
      await withdraw(sa.token).expect(201);

      const rowB = await rowOf(sb.id);
      expect(Number(rowB.publishConsent)).toBe(1);
      expect(rowB.featuredAt).not.toBeNull();
      const listB = body<PublicReview[]>(await publicList(b.slug).expect(200));
      expect(listB.some((r) => r.comment === 'Beautiful flowers')).toBe(true);
      // And A's token never reaches B's order.
      expect((await rowOf(sa.id)).orderId).not.toBe(sb.orderId);
    });
  });

  describe('re-granting is not supported', () => {
    it('submitSurvey after a withdrawal is rejected and consent stays 0; the row can never be featured again', async () => {
      const shop = await setupShop('wd-regrant');
      const s = await addSurvey(shop, { featured: true });
      await withdraw(s.token).expect(201);

      await request(app.getHttpServer())
        .post(`/public/surveys/submit?token=${s.token}`)
        .send({ rating: 5, comment: 'Changed my mind', publishConsent: true })
        .expect(400);
      const row = await rowOf(s.id);
      expect(Number(row.publishConsent)).toBe(0);
      expect(row.comment).toBe('Beautiful flowers');

      await feature(shop, s.id, true).expect(409);
      expect((await rowOf(s.id)).featuredAt).toBeNull();
      const list = body<PublicReview[]>(await publicList(shop.slug).expect(200));
      expect(list.some((r) => r.comment === 'Beautiful flowers')).toBe(false);
    });
  });

  describe('lookup', () => {
    it("reports the customer's own consent as a boolean (null when unanswered) and nothing else new", async () => {
      const shop = await setupShop('wd-lookup');
      const agreed = await addSurvey(shop);
      const open = await addSurvey(shop, { answered: false });
      const get = (t: string) =>
        request(app.getHttpServer()).get(`/public/surveys/lookup?token=${t}`);
      const a = body<Record<string, unknown>>(await get(agreed.token).expect(200));
      expect(a.publishConsent).toBe(true);
      expect(Object.keys(a).sort()).toEqual(
        ['comment', 'publishConsent', 'rating', 'respondedAt', 'shopName'].sort(),
      );
      await withdraw(agreed.token).expect(201);
      expect(
        body<Record<string, unknown>>(await get(agreed.token).expect(200))
          .publishConsent,
      ).toBe(false);
      expect(
        body<Record<string, unknown>>(await get(open.token).expect(200))
          .publishConsent,
      ).toBeNull();
    });
  });

  describe('admin Reviews list', () => {
    it('shows a withdrawn review as consent 0, not featured, not featurable; and never another shop rows', async () => {
      const a = await setupShop('wd-admin-a');
      const b = await setupShop('wd-admin-b');
      const sa = await addSurvey(a, { featured: true });
      const sb = await addSurvey(b, { featured: true });
      await withdraw(sa.token).expect(201);

      const listA = body<AdminList>(
        await request(app.getHttpServer())
          .get('/reviews')
          .set('Authorization', `Bearer ${a.adminToken}`)
          .expect(200),
      );
      const rowA = listA.data.find((r) => r.id === sa.id);
      expect(rowA).toMatchObject({
        publishConsent: 0,
        featuredAt: null,
        canFeature: false,
      });
      expect(listA.data.some((r) => r.id === sb.id)).toBe(false);

      const listB = body<AdminList>(
        await request(app.getHttpServer())
          .get('/reviews')
          .set('Authorization', `Bearer ${b.adminToken}`)
          .expect(200),
      );
      expect(listB.data.some((r) => r.id === sa.id)).toBe(false);
      expect(listB.data.find((r) => r.id === sb.id)?.featuredAt).not.toBeNull();
    });
  });

  describe('thank-you email after a consenting submission', () => {
    async function jobFor(surveyId: number) {
      const rows = await db.query<(JobRow & RowDataPacket)[]>(
        `SELECT * FROM job WHERE idempotencyKey = ?`,
        [`survey:${surveyId}:consent-email`],
      );
      return rows;
    }
    const submit = (token: string, publishConsent?: boolean) =>
      request(app.getHttpServer())
        .post(`/public/surveys/submit?token=${token}`)
        .send({ rating: 4, comment: 'Nice', publishConsent });

    it('queues exactly one email with a storefrontUrl link when consent is given', async () => {
      const shop = await setupShop('wd-mail');
      const s = await addSurvey(shop, { answered: false });
      await submit(s.token, true).expect(201);

      const jobs = await jobFor(s.id);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe('send_email');
      const payload = jobs[0].payload as unknown as {
        to: string;
        subject: string;
        bodyText: string;
        html: string;
      };
      expect(payload.to).toBe(`sara-${runId}@example.com`);
      const shopRow = (
        await db.query<RowDataPacket[]>(`SELECT * FROM shop WHERE id = ?`, [
          shop.shopId,
        ])
      )[0];
      const link = storefrontUrl(
        {
          subdomain: shopRow.subdomain as string,
          domainType: shopRow.domainType as string | null,
          customDomain: shopRow.customDomain as string | null,
          customDomainStatus: shopRow.customDomainStatus as string | null,
        },
        `/survey?token=${s.token}`,
      );
      expect(payload.bodyText).toContain(link);
      expect(payload.html).toContain(link);
      expect(payload.html).toMatch(/agreed that/);
      expect(payload.html).toMatch(/withdraw/i);
      // No rating, comment, phone or address in the mail.
      expect(payload.html + payload.bodyText).not.toMatch(
        /Nice|0500000004|Private Street/,
      );

      // A repeat call for the same response cannot queue a second email.
      await app
        .get(OrderNotificationsService)
        .notifySurveyConsentGiven(shop.shopId, s.id, s.orderId);
      expect(await jobFor(s.id)).toHaveLength(1);
      // And a second submit is rejected before reaching it.
      await submit(s.token, true).expect(400);
      expect(await jobFor(s.id)).toHaveLength(1);
    });

    it('sends nothing when consent is declined or omitted, when there is no email, or when notifyEmail is off', async () => {
      const shop = await setupShop('wd-nomail');
      const declined = await addSurvey(shop, { answered: false });
      await submit(declined.token, false).expect(201);
      const omitted = await addSurvey(shop, { answered: false });
      await submit(omitted.token).expect(201);
      const noEmail = await addSurvey(shop, { answered: false, email: null });
      await submit(noEmail.token, true).expect(201);
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ notifyEmail: false })
        .expect(200);
      const off = await addSurvey(shop, { answered: false });
      await submit(off.token, true).expect(201);
      for (const s of [declined, omitted, noEmail, off]) {
        expect(await jobFor(s.id)).toHaveLength(0);
      }
    });
  });

  // Survey tokens drive a state change (submit, consent withdrawal), so NEW ones
  // carry 128 bits; the 10-hex tokens issued before keep working untouched.
  describe('token width', () => {
    const NEW_TOKEN = /^[0-9A-F]{32}$/;
    const LEGACY = () =>
      Array.from({ length: 10 }, () =>
        '0123456789ABCDEF'[Math.floor(Math.random() * 16)],
      ).join('');
    const submitTo = (token: string) =>
      request(app.getHttpServer())
        .post(`/public/surveys/submit?token=${token}`)
        .send({ rating: 5, comment: 'ok', publishConsent: true });
    const lookup = (token: string) =>
      request(app.getHttpServer()).get(
        `/public/surveys/lookup?token=${encodeURIComponent(token)}`,
      );
    async function plainOrder(shop: Shop) {
      const order = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          customerName: 'Tok Customer',
          customerPhone: '0500000004',
          customerAddress: '1 Street',
          outletId: shop.outletId,
          items: [{ productId: shop.productId, quantity: 1 }],
        })
        .expect(201);
      return body<IdRow & { shopOrderNumber: number }>(order);
    }
    const notifiable = (o: { id: number; shopOrderNumber: number }, shop: Shop) => ({
      id: o.id,
      shopOrderNumber: o.shopOrderNumber,
      customerName: 'Tok Customer',
      customerEmail: null,
      customerPhone: '0500000004',
      orderType: null,
      total: '25',
      currency: 'AED',
      outletId: shop.outletId,
    });

    it('a newly issued token is 32 hex characters (128 bits) and works for lookup, submit and withdraw', async () => {
      const shop = await setupShop('tok-new');
      const o = await plainOrder(shop);
      await app
        .get(OrderNotificationsService)
        .notifySurveyRequest(shop.shopId, notifiable(o, shop));
      const rows = await db.query<RowDataPacket[]>(
        `SELECT token FROM surveyresponse WHERE orderId = ?`,
        [o.id],
      );
      const token = rows[0].token as string;
      expect(token).toMatch(NEW_TOKEN);
      expect(token).not.toBe(token.slice(0, 10));

      await lookup(token).expect(200);
      await submitTo(token).expect(201);
      await withdraw(token).expect(201);
      // exact match only: a 10 character prefix of the new token finds nothing
      await lookup(token.slice(0, 10)).expect(404);
      await withdraw(token.slice(0, 10)).expect(404);
    });

    it('a legacy 10 hex token still looks up, submits and withdraws', async () => {
      const shop = await setupShop('tok-old');
      const a = await addSurvey(shop, { answered: false, token: LEGACY() });
      expect(a.token).toMatch(/^[0-9A-F]{10}$/);
      const res = await lookup(a.token).expect(200);
      expect(body<{ respondedAt: unknown }>(res).respondedAt).toBeNull();
      await submitTo(a.token).expect(201);
      expect((await rowOf(a.id)).publishConsent).toBe(1);
      await withdraw(a.token).expect(201);
      expect((await rowOf(a.id)).publishConsent).toBe(0);
    });

    it('malformed tokens of any length get the identical 404 on all three routes', async () => {
      const shop = await setupShop('tok-bad');
      const real = await addSurvey(shop, { answered: false, token: LEGACY() });
      const bad = [
        'A'.repeat(31),
        'A'.repeat(33),
        'G'.repeat(32),
        real.token.slice(0, 9),
        `${real.token}0`,
        'x'.repeat(5000),
        "' OR '1'='1",
      ];
      const first = await lookup(bad[0]).expect(404);
      for (const t of bad) {
        expect((await lookup(t).expect(404)).body).toEqual(first.body);
        expect((await submitTo(t)).status).toBe(404);
        expect((await withdraw(t)).status).toBe(404);
      }
    });

    it('a token collision on the unique index is retried with a fresh token', async () => {
      const shop = await setupShop('tok-collide');
      const taken = await addSurvey(shop, { answered: false, token: `C0${runId}` });
      const o = await plainOrder(shop);
      let calls = 0;
      const spy = jest
        .spyOn(tokenHash, 'generateSurveyToken')
        .mockReturnValueOnce(taken.token)
        .mockReturnValueOnce(taken.token);
      try {
        await app
          .get(OrderNotificationsService)
          .notifySurveyRequest(shop.shopId, notifiable(o, shop));
      } finally {
        calls = spy.mock.calls.length;
        spy.mockRestore();
      }
      const rows = await db.query<RowDataPacket[]>(
        `SELECT token FROM surveyresponse WHERE orderId = ?`,
        [o.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].token).not.toBe(taken.token);
      expect(rows[0].token).toMatch(/^[0-9A-F]{32}$/);
      expect(calls).toBe(3);
    });
  });
});
