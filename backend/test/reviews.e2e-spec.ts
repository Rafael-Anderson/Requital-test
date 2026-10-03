import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { CustomerAccountService } from '../src/customer-account/customer-account.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
}
interface IdRow {
  id: number;
}
interface PublicReview {
  name: string;
  rating: number;
  comment: string;
  date: string;
}
interface AdminReview {
  id: number;
  publishConsent: number | null;
  featuredAt: string | null;
  canFeature: boolean;
  comment: string | null;
}
interface AdminList {
  data: AdminReview[];
  total: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(30000);

// Real reviews only: a survey answer is shown on a storefront only when the
// customer agreed (publishConsent = 1), left a comment, AND the merchant
// switched it on. Every assertion avoids exact counts on shared data: each
// test reads back only the rows it created.
describe('Real reviews (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();

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
        name: 'Reviews Admin',
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
    const adminToken = body<AuthResponse>(signup).accessToken;
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
        name: `Review Item ${slug}`,
        price: 25,
        thumbnail: 'https://example.com/x.jpg',
        sku: `REV-${slug}`,
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

  let tokenSeq = 0;
  // A real order, then its answered survey row inserted directly (the
  // delivered-status email path is covered by survey.e2e-spec.ts).
  async function addSurvey(
    shop: Shop,
    opts: {
      name?: string;
      rating?: number | null;
      comment?: string | null;
      consent?: number | null;
      featured?: boolean;
      respondedAt?: string;
    },
  ): Promise<number> {
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: opts.name ?? 'Sara Khan',
        customerPhone: '0500000004',
        customerAddress: '77 Private Street, Secret Tower',
        customerEmail: 'sara.private@example.com',
        outletId: shop.outletId,
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);
    const orderId = body<IdRow>(order).id;
    const result = await db.execute(
      `INSERT INTO surveyresponse
         (shopId, orderId, token, rating, comment, respondedAt, publishConsent, featuredAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shop.shopId,
        orderId,
        `rev-${runId}-${++tokenSeq}`,
        opts.rating === undefined ? 5 : opts.rating,
        opts.comment === undefined ? 'Beautiful flowers' : opts.comment,
        opts.respondedAt ??
          new Date().toISOString().slice(0, 23).replace('T', ' '),
        opts.consent === undefined ? 1 : opts.consent,
        opts.featured ? new Date() : null,
      ],
    );
    return result.insertId;
  }

  const feature = (shop: Shop, id: number, featured: boolean, token?: string) =>
    request(app.getHttpServer())
      .patch(`/reviews/${id}/featured`)
      .set('Authorization', `Bearer ${token ?? shop.adminToken}`)
      .send({ featured });

  const publicList = (slug: string, qs = '') =>
    request(app.getHttpServer()).get(`/public/${slug}/reviews/featured${qs}`);

  describe('survey submission records consent', () => {
    it('stores 1 when ticked, 0 when unticked, NULL when the client omits it, and is single-shot', async () => {
      const shop = await setupShop('rev-submit');
      const mk = async () => {
        const order = await request(app.getHttpServer())
          .post('/orders')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({
            customerName: 'Sub Mit',
            customerPhone: '0500000005',
            customerAddress: '1 Rd',
            outletId: shop.outletId,
            items: [{ productId: shop.productId, quantity: 1 }],
          })
          .expect(201);
        const token = `sub-${runId}-${++tokenSeq}`;
        await db.execute(
          `INSERT INTO surveyresponse (shopId, orderId, token) VALUES (?, ?, ?)`,
          [shop.shopId, body<IdRow>(order).id, token],
        );
        return token;
      };
      const read = async (token: string) =>
        (
          await db.query<RowDataPacket[]>(
            `SELECT publishConsent, comment FROM surveyresponse WHERE token = ?`,
            [token],
          )
        )[0];

      const t1 = await mk();
      await request(app.getHttpServer())
        .post(`/public/surveys/submit?token=${t1}`)
        .send({ rating: 5, comment: '  Great  ', publishConsent: true })
        .expect(201);
      const r1 = await read(t1);
      expect(Number(r1.publishConsent)).toBe(1);
      expect(r1.comment).toBe('Great');

      const t2 = await mk();
      await request(app.getHttpServer())
        .post(`/public/surveys/submit?token=${t2}`)
        .send({ rating: 4, publishConsent: false })
        .expect(201);
      expect(Number((await read(t2)).publishConsent)).toBe(0);

      const t3 = await mk();
      await request(app.getHttpServer())
        .post(`/public/surveys/submit?token=${t3}`)
        .send({ rating: 3 })
        .expect(201);
      expect((await read(t3)).publishConsent).toBeNull();

      // A second submit cannot overwrite the consent given first.
      await request(app.getHttpServer())
        .post(`/public/surveys/submit?token=${t2}`)
        .send({ rating: 5, comment: 'changed', publishConsent: true })
        .expect(400);
      expect(Number((await read(t2)).publishConsent)).toBe(0);

      await request(app.getHttpServer())
        .post(`/public/surveys/submit?token=${t1}`)
        .send({ rating: 5, publishConsent: 'yes' })
        .expect(400);
    });
  });

  describe('the consent gate (featuring)', () => {
    let shop: Shop;
    beforeAll(async () => {
      shop = await setupShop('rev-gate');
    });

    it('feature succeeds for consent=1 plus a comment, and is audit-logged', async () => {
      const id = await addSurvey(shop, { consent: 1, comment: 'Lovely' });
      const res = await feature(shop, id, true).expect(200);
      expect(body<{ featured: boolean }>(res).featured).toBe(true);
      const audit = await db.query<RowDataPacket[]>(
        `SELECT action, entityType, entityId, actorUserId FROM auditlog
          WHERE shopId = ? AND entityId = ? AND action = 'review.featured'`,
        [shop.shopId, id],
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].entityType).toBe('surveyresponse');
      await feature(shop, id, false).expect(200);
      const audit2 = await db.query<RowDataPacket[]>(
        `SELECT action FROM auditlog WHERE shopId = ? AND entityId = ? AND action = 'review.unfeatured'`,
        [shop.shopId, id],
      );
      expect(audit2).toHaveLength(1);
    });

    it('NULL consent (legacy), declined consent and an empty comment are 409 and stay unfeatured', async () => {
      const legacy = await addSurvey(shop, {
        consent: null,
        comment: 'Legacy',
      });
      const declined = await addSurvey(shop, { consent: 0, comment: 'No' });
      const empty = await addSurvey(shop, { consent: 1, comment: '' });
      const blank = await addSurvey(shop, { consent: 1, comment: '   ' });
      const noComment = await addSurvey(shop, { consent: 1, comment: null });
      for (const id of [legacy, declined, empty, blank, noComment]) {
        await feature(shop, id, true).expect(409);
        const row = await db.query<RowDataPacket[]>(
          `SELECT featuredAt FROM surveyresponse WHERE id = ?`,
          [id],
        );
        expect(row[0].featuredAt).toBeNull();
      }
    });

    it('unknown id is 404, bad body is 400', async () => {
      await feature(shop, 2147483000, true).expect(404);
      await request(app.getHttpServer())
        .patch(`/reviews/1/featured`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ featured: 'yes' })
        .expect(400);
    });

    it('admin list reports consent state and canFeature per row', async () => {
      const ok = await addSurvey(shop, { consent: 1, comment: 'ok' });
      const legacy = await addSurvey(shop, { consent: null, comment: 'x' });
      const res = await request(app.getHttpServer())
        .get('/reviews?pageSize=100')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const list = body<AdminList>(res).data;
      const rOk = list.find((r) => r.id === ok);
      const rLegacy = list.find((r) => r.id === legacy);
      expect(rOk?.canFeature).toBe(true);
      expect(rOk?.publishConsent).toBe(1);
      expect(rLegacy?.canFeature).toBe(false);
      expect(rLegacy?.publishConsent).toBeNull();
    });
  });

  describe('public GET /public/:shop/reviews/featured', () => {
    let shop: Shop;
    beforeAll(async () => {
      shop = await setupShop('rev-pub');
    });

    it('serves only approved reviews, newest first, with exactly four fields and no private data', async () => {
      const older = await addSurvey(shop, {
        name: 'Reem Al Mansoori',
        comment: 'Older review',
        rating: 4,
        respondedAt: '2026-01-01 10:00:00.000',
      });
      const newer = await addSurvey(shop, {
        name: 'Daniel Kim',
        comment: 'Newer review',
        rating: 5,
        respondedAt: '2026-02-01 10:00:00.000',
      });
      const notFeatured = await addSurvey(shop, {
        comment: 'consenting but not switched on',
      });
      await feature(shop, older, true).expect(200);
      await feature(shop, newer, true).expect(200);

      const res = await publicList(shop.slug).expect(200);
      const list = body<PublicReview[]>(res);
      const texts = list.map((r) => r.comment);
      expect(texts).toEqual(['Newer review', 'Older review']);
      expect(texts).not.toContain('consenting but not switched on');
      expect(list[0].name).toBe('Daniel K.');
      expect(list[1].name).toBe('Reem M.');
      for (const r of list) {
        expect(Object.keys(r).sort()).toEqual([
          'comment',
          'date',
          'name',
          'rating',
        ]);
      }
      const raw = JSON.stringify(res.body);
      for (const secret of [
        '0500000004',
        'sara.private@example.com',
        'Secret Tower',
        'Al Mansoori',
        'Kim"',
        'customerPhone',
        'customerId',
        'orderId',
      ]) {
        expect(raw).not.toContain(secret);
      }
      expect(notFeatured).toBeGreaterThan(0);
    });

    it('re-checks consent and comment at read time even if featuredAt is set', async () => {
      const legacy = await addSurvey(shop, {
        consent: null,
        comment: 'LEGACY-FORCED',
      });
      const declined = await addSurvey(shop, {
        consent: 0,
        comment: 'DECLINED-FORCED',
      });
      const blank = await addSurvey(shop, { consent: 1, comment: '  ' });
      const norating = await addSurvey(shop, {
        consent: 1,
        comment: 'NORATING-FORCED',
        rating: null,
      });
      const later = await addSurvey(shop, {
        consent: 1,
        comment: 'WITHDRAWN-LATER',
        featured: true,
      });
      // featuredAt forced on rows the toggle would have refused.
      await db.execute(
        `UPDATE surveyresponse SET featuredAt = NOW() WHERE id IN (?, ?, ?, ?)`,
        [legacy, declined, blank, norating],
      );
      let texts = body<PublicReview[]>(
        await publicList(shop.slug, '?limit=12').expect(200),
      ).map((r) => r.comment);
      expect(texts).toContain('WITHDRAWN-LATER');
      for (const t of ['LEGACY-FORCED', 'DECLINED-FORCED', 'NORATING-FORCED']) {
        expect(texts).not.toContain(t);
      }
      expect(texts).not.toContain('  ');
      // Consent withdrawn after featuring: stops being served at once.
      await db.execute(
        `UPDATE surveyresponse SET publishConsent = 0 WHERE id = ?`,
        [later],
      );
      texts = body<PublicReview[]>(
        await publicList(shop.slug, '?limit=12').expect(200),
      ).map((r) => r.comment);
      expect(texts).not.toContain('WITHDRAWN-LATER');
    });

    it('an XSS payload is stored and served as inert text', async () => {
      const payload = `<script>alert(1)</script><img src=x onerror=alert(2)>`;
      const id = await addSurvey(shop, {
        comment: payload,
        name: '<b>Evil</b> <i>User</i>',
      });
      await feature(shop, id, true).expect(200);
      const res = await publicList(shop.slug, '?limit=12').expect(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      const hit = body<PublicReview[]>(res).find((r) => r.comment === payload);
      expect(hit).toBeDefined();
      // Name is reduced to first token plus an initial; still just a string.
      expect(typeof hit?.name).toBe('string');
      const stored = await db.query<RowDataPacket[]>(
        `SELECT comment FROM surveyresponse WHERE id = ?`,
        [id],
      );
      expect(stored[0].comment).toBe(payload);
    });

    it('caps long comments and honours bounded limit and minRating', async () => {
      const s = await setupShop('rev-bounds');
      const long = 'x'.repeat(1500);
      const a = await addSurvey(s, {
        comment: long,
        rating: 5,
        respondedAt: '2026-03-01 10:00:00.000',
      });
      const b = await addSurvey(s, {
        comment: 'low',
        rating: 2,
        respondedAt: '2026-03-02 10:00:00.000',
      });
      const c = await addSurvey(s, {
        comment: 'mid',
        rating: 4,
        respondedAt: '2026-03-03 10:00:00.000',
      });
      for (const id of [a, b, c]) await feature(s, id, true).expect(200);

      const all = body<PublicReview[]>(await publicList(s.slug).expect(200));
      expect(all.map((r) => r.comment.length > 100)).toEqual([
        false,
        false,
        true,
      ]);
      expect(all[2].comment.length).toBeLessThanOrEqual(601);
      expect(all[2].comment.endsWith('…')).toBe(true);

      const limited = body<PublicReview[]>(
        await publicList(s.slug, '?limit=1').expect(200),
      );
      expect(limited).toHaveLength(1);
      expect(limited[0].comment).toBe('mid');

      const min4 = body<PublicReview[]>(
        await publicList(s.slug, '?minRating=4').expect(200),
      );
      expect(min4.map((r) => r.comment.slice(0, 3))).toEqual(['mid', 'xxx']);

      await publicList(s.slug, '?limit=13').expect(400);
      await publicList(s.slug, '?limit=0').expect(400);
      await publicList(s.slug, '?limit=abc').expect(400);
      await publicList(s.slug, '?minRating=6').expect(400);
      await publicList(s.slug, '?minRating=0').expect(400);
      await publicList(s.slug, '?evil=1').expect(400);
    });

    it('an unknown, unpublished or suspended shop is 404', async () => {
      await publicList(`no-such-shop-${runId}`).expect(404);
      const s = await setupShop('rev-vis');
      await db.execute(`UPDATE shop SET published = 0 WHERE id = ?`, [
        s.shopId,
      ]);
      await publicList(s.slug).expect(404);
      await db.execute(
        `UPDATE shop SET published = 1, suspendedAt = NOW() WHERE id = ?`,
        [s.shopId],
      );
      await publicList(s.slug).expect(404);
      await db.execute(`UPDATE shop SET suspendedAt = NULL WHERE id = ?`, [
        s.shopId,
      ]);
      await publicList(s.slug).expect(200);
    });

    it('an account deletion withdraws consent for that customer reviews', async () => {
      const s = await setupShop('rev-pdpl');
      const id = await addSurvey(s, { comment: 'PDPL-REVIEW', featured: true });
      let texts = body<PublicReview[]>(
        await publicList(s.slug).expect(200),
      ).map((r) => r.comment);
      expect(texts).toContain('PDPL-REVIEW');
      const orderRows = await db.query<RowDataPacket[]>(
        `SELECT o.customerId FROM surveyresponse s JOIN \`order\` o ON o.id = s.orderId WHERE s.id = ?`,
        [id],
      );
      const customerId = orderRows[0].customerId as number;
      expect(customerId).not.toBeNull();
      // The real anonymisation step (private; the HTTP flow needs a customer
      // login plus an emailed token, which customer-account specs cover).
      // eslint-disable-next-line @typescript-eslint/dot-notation
      await app
        .get(CustomerAccountService)
        ['anonymiseCustomer'](s.shopId, customerId);
      texts = body<PublicReview[]>(await publicList(s.slug).expect(200)).map(
        (r) => r.comment,
      );
      expect(texts).not.toContain('PDPL-REVIEW');
      const after = await db.query<RowDataPacket[]>(
        `SELECT publishConsent, featuredAt FROM surveyresponse WHERE id = ?`,
        [id],
      );
      expect(Number(after[0].publishConsent)).toBe(0);
      expect(after[0].featuredAt).toBeNull();
    });
  });

  describe('cross-tenant isolation', () => {
    let a: Shop;
    let b: Shop;
    beforeAll(async () => {
      a = await setupShop('rev-iso-a');
      b = await setupShop('rev-iso-b');
    });

    it("shop A cannot feature or unfeature shop B's response, and the row is untouched", async () => {
      const bId = await addSurvey(b, { comment: 'B-PRIVATE-REVIEW' });
      await feature(a, bId, true).expect(404);
      let row = await db.query<RowDataPacket[]>(
        `SELECT featuredAt FROM surveyresponse WHERE id = ?`,
        [bId],
      );
      expect(row[0].featuredAt).toBeNull();

      await feature(b, bId, true).expect(200);
      await feature(a, bId, false).expect(404);
      row = await db.query<RowDataPacket[]>(
        `SELECT featuredAt FROM surveyresponse WHERE id = ?`,
        [bId],
      );
      expect(row[0].featuredAt).not.toBeNull();
    });

    it("B's featured review never appears for A, nor A's for B; admin lists are separate", async () => {
      const aId = await addSurvey(a, { comment: 'A-ONLY-REVIEW' });
      const bId = await addSurvey(b, { comment: 'B-ONLY-REVIEW' });
      await feature(a, aId, true).expect(200);
      await feature(b, bId, true).expect(200);

      const pubA = body<PublicReview[]>(
        await publicList(a.slug).expect(200),
      ).map((r) => r.comment);
      const pubB = body<PublicReview[]>(
        await publicList(b.slug).expect(200),
      ).map((r) => r.comment);
      expect(pubA).toContain('A-ONLY-REVIEW');
      expect(pubA).not.toContain('B-ONLY-REVIEW');
      expect(pubA).not.toContain('B-PRIVATE-REVIEW');
      expect(pubB).toContain('B-ONLY-REVIEW');
      expect(pubB).not.toContain('A-ONLY-REVIEW');

      const adminA = body<AdminList>(
        await request(app.getHttpServer())
          .get('/reviews?pageSize=100')
          .set('Authorization', `Bearer ${a.adminToken}`)
          .expect(200),
      ).data.map((r) => r.comment);
      expect(adminA).toContain('A-ONLY-REVIEW');
      expect(adminA).not.toContain('B-ONLY-REVIEW');
    });
  });

  describe('authorisation', () => {
    it('requires an admin: anonymous 401, viewer and order_manager 403', async () => {
      const shop = await setupShop('rev-auth');
      const id = await addSurvey(shop, { comment: 'authz' });
      await request(app.getHttpServer()).get('/reviews').expect(401);
      await request(app.getHttpServer())
        .patch(`/reviews/${id}/featured`)
        .send({ featured: true })
        .expect(401);

      for (const role of ['viewer', 'order_manager']) {
        const email = `${role}-${shop.slug}@test.com`;
        await request(app.getHttpServer())
          .post('/auth/branch-users')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ name: role, email, password: 'password123', role })
          .expect(201);
        const login = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: 'password123' })
          .expect(201);
        const token = body<AuthResponse>(login).accessToken;
        await request(app.getHttpServer())
          .get('/reviews')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        await feature(shop, id, true, token).expect(403);
      }
      const row = await db.query<RowDataPacket[]>(
        `SELECT featuredAt FROM surveyresponse WHERE id = ?`,
        [id],
      );
      expect(row[0].featuredAt).toBeNull();
    });
  });
});
