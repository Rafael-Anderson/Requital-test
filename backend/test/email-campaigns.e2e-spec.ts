import 'dotenv/config';
import { randomBytes } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JobsWorkerService } from '../src/jobs/jobs.worker.service';
import { verifySignupEmail } from './helpers/verify-signup-email';
import { registerCustomer, asCustomer } from './helpers/customer-session';

jest.setTimeout(60000);

interface Shop {
  slug: string;
  shopId: number;
  token: string;
  adminEmail: string;
}
interface Json {
  id: number;
  status: string;
  audienceCount: number | null;
  counts: { pending: number; sent: number; skipped: number; failed: number };
  count: number;
  enabled: boolean;
  sendingDomainVerified: boolean;
  bodyHtml: string;
  removedTags: string[];
  sent: boolean;
  subscribed: boolean;
  confirmationRequired: boolean;
  confirmed: boolean;
  unsubscribed: boolean;
  shopName: string;
  accessToken: string;
  devVerificationLink?: string;
  user: { shopId: number };
  confirmationToken: string;
}

// MKT-1. The consent gate, the send, the unsubscribe and the cross-tenant checks
// for consent-gated email campaigns. Nothing leaves the process: RESEND_API_KEY is
// 'test' (a stub that logs), except where a test fakes fetch to read the real
// request body. Resend's own behaviour is UNVERIFIED.
describe('Email campaigns (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let worker: JobsWorkerService;
  const runId = Date.now();
  // The dev branch of storefrontUrl() (a local STOREFRONT_URL) would put the slug in
  // the path and use http; the production shape is what must be asserted.
  const originalStorefrontUrl = process.env.STOREFRONT_URL;
  let seq = 0;
  let logSpy: jest.SpyInstance;
  const sentTo = () =>
    (logSpy.mock.calls as unknown[][])
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith('[email:stub]'));

  beforeAll(async () => {
    delete process.env.STOREFRONT_URL;
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
    db = mod.get(DatabaseService);
    worker = mod.get(JobsWorkerService);
  });
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.CAMPAIGN_DAILY_SEND_CAP;
  });
  afterAll(async () => {
    if (originalStorefrontUrl !== undefined)
      process.env.STOREFRONT_URL = originalStorefrontUrl;
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function setupShop(
    prefix: string,
    opts: { flag?: boolean; domain?: boolean; verified?: boolean } = {},
  ): Promise<Shop> {
    const { flag = true, domain = true, verified = true } = opts;
    const slug = `${prefix}-${runId}-${++seq}`;
    const adminEmail = `${slug}@test.com`;
    const res = await http()
      .post('/auth/signup')
      .send({
        name: 'Camp Admin',
        email: adminEmail,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const b = res.body as Json;
    if (verified)
      await verifySignupEmail(app.getHttpServer(), b.devVerificationLink);
    const shopId = b.user.shopId;
    if (flag) {
      await db.execute(
        `INSERT INTO shopfeatureoverride (shopId, featureKey, enabled) VALUES (?, 'email_campaigns', 1)`,
        [shopId],
      );
    }
    if (domain) {
      await db.execute(
        `INSERT INTO shopsendingdomain (shopId, domain, status, verifiedAt)
         VALUES (?, ?, 'verified', NOW())`,
        [shopId, `${slug}.example.com`],
      );
    }
    return { slug, shopId, token: b.accessToken, adminEmail };
  }

  async function customer(
    shopId: number,
    email: string | null,
    consent: 'granted' | 'withdrawn' | null,
  ): Promise<number> {
    const res = await db.execute(
      `INSERT INTO customer (shopId, name, phone, email) VALUES (?, 'C', ?, ?)`,
      [shopId, `050${runId % 10000000}${++seq}`, email],
    );
    if (consent) {
      await db.execute(
        `INSERT INTO customerconsent (customerId, channel, shopId, status, source)
         VALUES (?, 'email', ?, ?, 'admin')`,
        [res.insertId, shopId, consent],
      );
    }
    return res.insertId;
  }
  const newsletter = (shopId: number, email: string, confirmed: boolean) =>
    db.execute(
      `INSERT INTO newslettersubscriber (shopId, email, source, confirmedAt)
       VALUES (?, ?, 'newsletter_widget', ?)`,
      [shopId, email, confirmed ? new Date() : null],
    );
  const suppress = (shopId: number, email: string, reason = 'manual') =>
    db.execute(
      `INSERT INTO emailsuppression (shopId, email, reason) VALUES (?, ?, ?)`,
      [shopId, email, reason],
    );

  const draft = (s: Shop, extra: Record<string, unknown> = {}) =>
    http()
      .post('/campaigns')
      .set(auth(s.token))
      .send({
        name: 'Spring',
        subject: 'Spring offers',
        bodyHtml: '<p>Hello <b>there</b></p>',
        ...extra,
      });
  const newDraft = async (s: Shop, extra: Record<string, unknown> = {}) =>
    (await draft(s, extra).expect(201)).body as Json;

  // Runs every due batch job of one campaign in THIS process until none is left
  // (a chained job is pulled forward so the test does not wait out the gap).
  async function drain(campaignId: number, max = 30) {
    for (let i = 0; i < max; i++) {
      const jobs = await db.query<RowDataPacket[]>(
        `SELECT id FROM job WHERE type = 'send_campaign_batch' AND status = 'pending'
          AND JSON_EXTRACT(payload, '$.campaignId') = ?`,
        [campaignId],
      );
      if (jobs.length === 0) return;
      for (const j of jobs) {
        await db.execute(`UPDATE job SET nextAttemptAt = ? WHERE id = ?`, [
          new Date(Date.now() - 1000),
          j.id,
        ]);
        await worker.processJobById(j.id as number);
      }
    }
  }
  const recips = (campaignId: number) =>
    db.query<RowDataPacket[]>(
      `SELECT email, status, note FROM campaignrecipient WHERE campaignId = ? ORDER BY email`,
      [campaignId],
    );
  const tokenFromLogs = (to: string) => {
    const line = sentTo().find((l) => l.startsWith(`[email:stub] to=${to} `))!;
    return /token=([0-9a-f]{32})/.exec(line)![1];
  };

  // Audience fixture for one shop. Only `in1` and `in2` may ever receive mail.
  async function audienceShop(prefix: string) {
    const s = await setupShop(prefix);
    const e = (n: string) => `${n}-${s.slug}@mail.test`;
    await customer(s.shopId, e('in1'), 'granted');
    await customer(s.shopId, e('unknown'), null);
    await customer(s.shopId, e('withdrawn'), 'withdrawn');
    await customer(s.shopId, null, 'granted');
    await customer(s.shopId, e('suppressed'), 'granted');
    await suppress(s.shopId, e('suppressed'));
    await customer(s.shopId, `deleted-9@deleted.requital`, 'granted');
    await newsletter(s.shopId, e('in2'), true);
    await newsletter(s.shopId, e('legacy'), false);
    // Confirmed newsletter row, but a customer with the same address said no.
    await customer(s.shopId, e('nl-withdrawn'), 'withdrawn');
    await newsletter(s.shopId, e('nl-withdrawn'), true);
    // Confirmed but suppressed.
    await newsletter(s.shopId, e('nl-suppressed'), true);
    await suppress(s.shopId, e('nl-suppressed'), 'bounce');
    return { s, e };
  }

  describe('feature flag and access', () => {
    it('is off by default: every route but status is 403, status says so', async () => {
      const s = await setupShop('cf-off', { flag: false });
      const st = await http().get('/campaigns/status').set(auth(s.token)).expect(200);
      expect((st.body as Json).enabled).toBe(false);
      await http().get('/campaigns').set(auth(s.token)).expect(403);
      await draft(s).expect(403);
    });

    it('is admin only and needs a login', async () => {
      const s = await setupShop('cf-auth');
      await http().get('/campaigns').expect(401);
      const staff = await http()
        .post('/auth/branch-users')
        .set(auth(s.token))
        .send({
          name: 'V',
          email: `v-${s.slug}@test.com`,
          password: 'password123',
          role: 'viewer',
        });
      if (staff.status === 201) {
        const login = await http()
          .post('/auth/login')
          .send({ email: `v-${s.slug}@test.com`, password: 'password123' });
        const vt = (login.body as Json).accessToken;
        if (vt) await http().get('/campaigns').set(auth(vt)).expect(403);
      }
    });

    it('sanitises the body on write and refuses an empty or multi-line one', async () => {
      const s = await setupShop('cf-san');
      const c = (await draft(s, {
        bodyHtml:
          '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://ok.example/x">ok</a>',
      }).expect(201)).body as Json;
      expect(c.bodyHtml).not.toMatch(/script|onclick|javascript:/i);
      expect(c.bodyHtml).toContain('https://ok.example/x');
      await draft(s, { bodyHtml: '<script>x</script>' }).expect(400);
      await draft(s, { subject: 'a\r\nBcc: evil@x.test' }).expect(400);
    });
  });

  describe('audience (consent gate)', () => {
    it('counts only recorded email consent and confirmed newsletter rows', async () => {
      const { s } = await audienceShop('cf-aud');
      const c = await newDraft(s);
      const r = await http().get(`/campaigns/${c.id}/audience`).set(auth(s.token)).expect(200);
      // in1 (granted customer) and in2 (confirmed newsletter). Nothing else.
      expect((r.body as Json).count).toBe(2);
      expect(Object.keys(r.body as object)).toEqual(['count']);
    });

    it('a segment can narrow the audience but never widen it', async () => {
      const { s } = await audienceShop('cf-seg');
      // Matches ONLY the customer with unknown consent: must yield nobody.
      const unknownSeg = await http()
        .post('/customer-segments')
        .set(auth(s.token))
        .send({
          name: 'unknown',
          rules: { op: 'and', rules: [{ field: 'consent', cmp: 'is', channel: 'email', value: 'unknown' }] },
        })
        .expect(201);
      const allSeg = await http()
        .post('/customer-segments')
        .set(auth(s.token))
        .send({
          name: 'everyone',
          rules: { op: 'and', rules: [{ field: 'orderCount', cmp: 'gte', value: 0 }] },
        })
        .expect(201);
      const c1 = await newDraft(s, { segmentId: (unknownSeg.body as Json).id });
      const r1 = await http().get(`/campaigns/${c1.id}/audience`).set(auth(s.token)).expect(200);
      expect((r1.body as Json).count).toBe(0);
      // "Everyone" keeps the consented CUSTOMER; a newsletter-only address has no
      // customer row to match, so a segment drops it.
      const c2 = await newDraft(s, { segmentId: (allSeg.body as Json).id });
      const r2 = await http().get(`/campaigns/${c2.id}/audience`).set(auth(s.token)).expect(200);
      expect((r2.body as Json).count).toBe(1);
    });

    it('a segment of another shop is a 404', async () => {
      const a = await setupShop('cf-xs-a');
      const b = await setupShop('cf-xs-b');
      const seg = await http()
        .post('/customer-segments')
        .set(auth(a.token))
        .send({ name: 's', rules: { op: 'and', rules: [{ field: 'orderCount', cmp: 'gte', value: 0 }] } })
        .expect(201);
      await draft(b, { segmentId: (seg.body as Json).id }).expect(404);
    });
  });

  describe('sending', () => {
    it('is refused without a verified sending domain, and the draft stays a draft', async () => {
      const s = await setupShop('cf-nodom', { domain: false });
      await customer(s.shopId, `a-${s.slug}@mail.test`, 'granted');
      const c = await newDraft(s);
      const r = await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(409);
      expect(JSON.stringify(r.body)).toMatch(/sending domain/i);
      await http().post(`/campaigns/${c.id}/test`).set(auth(s.token)).expect(409);
      const now = (await http().get(`/campaigns/${c.id}`).set(auth(s.token)).expect(200)).body as Json;
      expect(now.status).toBe('draft');
      expect(sentTo()).toHaveLength(0);
    });

    it('a pending (unverified) domain does not count', async () => {
      const s = await setupShop('cf-pend', { domain: false });
      await db.execute(
        `INSERT INTO shopsendingdomain (shopId, domain, status) VALUES (?, ?, 'pending')`,
        [s.shopId, `${s.slug}.example.com`],
      );
      await customer(s.shopId, `a-${s.slug}@mail.test`, 'granted');
      const c = await newDraft(s);
      await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(409);
    });

    it('needs the admin email verified, and a non-empty audience', async () => {
      const u = await setupShop('cf-unv', { verified: false });
      await customer(u.shopId, `a-${u.slug}@mail.test`, 'granted');
      const cu = await newDraft(u);
      await http().post(`/campaigns/${cu.id}/send`).set(auth(u.token)).expect(403);
      const s = await setupShop('cf-empty');
      await customer(s.shopId, `u-${s.slug}@mail.test`, null);
      const c = await newDraft(s);
      await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(409);
      expect(((await http().get(`/campaigns/${c.id}`).set(auth(s.token))).body as Json).status).toBe('draft');
    });

    it('mails only consented addresses, with the footer and one-click headers', async () => {
      const { s, e } = await audienceShop('cf-send');
      const c = await newDraft(s);
      const r = await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(201);
      expect((r.body as Json).status).toBe('sending');
      expect((r.body as Json).audienceCount).toBe(2);
      await drain(c.id);
      const done = (await http().get(`/campaigns/${c.id}`).set(auth(s.token))).body as Json;
      expect(done.status).toBe('sent');
      expect(done.counts).toEqual({ pending: 0, sent: 2, skipped: 0, failed: 0 });
      const lines = sentTo();
      expect(lines).toHaveLength(2);
      const tos = lines.map((l) => /to=(\S+)/.exec(l)![1]).sort();
      expect(tos).toEqual([e('in1'), e('in2')].sort());
      for (const l of lines) {
        expect(l).toMatch(/List-Unsubscribe"?:"<https:\/\/.+\/api\/public\/campaigns\/unsubscribe\?token=[0-9a-f]{32}>"/);
        expect(l).toContain('"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"');
        expect(l).toMatch(/Unsubscribe: https:\/\/.+\/unsubscribe\?token=[0-9a-f]{32}/);
        expect(l).toContain('agreed to receive marketing emails');
      }
      // The two tokens differ and the address is not in the link.
      const t1 = tokenFromLogs(e('in1'));
      expect(t1).not.toBe(tokenFromLogs(e('in2')));
      expect(lines.join('\n')).not.toMatch(/unsubscribe\?token=[^\s]*@/);
    });

    it('a second confirm, even a concurrent one, sends nobody twice', async () => {
      const { s } = await audienceShop('cf-idem');
      const c = await newDraft(s);
      const rs = await Promise.all([
        http().post(`/campaigns/${c.id}/send`).set(auth(s.token)),
        http().post(`/campaigns/${c.id}/send`).set(auth(s.token)),
      ]);
      expect(rs.every((r) => r.status === 201)).toBe(true);
      await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(201);
      const jobs = await db.query<RowDataPacket[]>(
        `SELECT id FROM job WHERE idempotencyKey = ?`,
        [`campaign:${c.id}:batch:0`],
      );
      expect(jobs).toHaveLength(1);
      expect(await recips(c.id)).toHaveLength(2);
      await drain(c.id);
      expect(sentTo()).toHaveLength(2);
      // Running a finished campaign's batch again sends nothing.
      await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(201);
      await drain(c.id);
      expect(sentTo()).toHaveLength(2);
    });

    it('asks for consent again at send time', async () => {
      const { s, e } = await audienceShop('cf-recheck');
      const c = await newDraft(s);
      await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(201);
      // After the audience was frozen: in1 withdraws, in2 is suppressed.
      await db.execute(
        `UPDATE customerconsent cc JOIN customer c ON c.id = cc.customerId
            SET cc.status = 'withdrawn' WHERE c.email = ?`,
        [e('in1')],
      );
      await suppress(s.shopId, e('in2'), 'complaint');
      await drain(c.id);
      expect(sentTo()).toHaveLength(0);
      const done = (await http().get(`/campaigns/${c.id}`).set(auth(s.token))).body as Json;
      expect(done.counts.skipped).toBe(2);
      expect(done.status).toBe('sent');
    });

    it('stops a running campaign when the feature is switched off or the domain lapses', async () => {
      const { s } = await audienceShop('cf-stop');
      const c = await newDraft(s);
      await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(201);
      await db.execute(`UPDATE shopfeatureoverride SET enabled = 0 WHERE shopId = ?`, [s.shopId]);
      await drain(c.id);
      expect(sentTo()).toHaveLength(0);
      const row = await db.query<RowDataPacket[]>(`SELECT status, failureReason FROM campaign WHERE id = ?`, [c.id]);
      expect(row[0].status).toBe('failed');
      const t = await setupShop('cf-stop2');
      await customer(t.shopId, `a-${t.slug}@mail.test`, 'granted');
      const c2 = await newDraft(t);
      await http().post(`/campaigns/${c2.id}/send`).set(auth(t.token)).expect(201);
      await db.execute(`UPDATE shopsendingdomain SET status = 'failed' WHERE shopId = ?`, [t.shopId]);
      await drain(c2.id);
      expect(sentTo()).toHaveLength(0);
      expect((await recips(c2.id))[0].status).toBe('skipped');
    });

    it('stops at the per-shop daily cap and waits instead of dropping the rest', async () => {
      process.env.CAMPAIGN_DAILY_SEND_CAP = '1';
      const { s } = await audienceShop('cf-cap');
      const c = await newDraft(s);
      await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(201);
      await drain(c.id, 3);
      expect(sentTo()).toHaveLength(1);
      const rows = await recips(c.id);
      expect(rows.filter((r) => r.status === 'sent')).toHaveLength(1);
      expect(rows.filter((r) => r.status === 'pending')).toHaveLength(1);
      const next = await db.query<RowDataPacket[]>(
        `SELECT nextAttemptAt, status FROM job WHERE type = 'send_campaign_batch'
          AND JSON_EXTRACT(payload, '$.campaignId') = ? AND status = 'pending'`,
        [c.id],
      );
      expect(next).toHaveLength(1);
      expect(new Date(next[0].nextAttemptAt as Date).getTime()).toBeGreaterThan(
        Date.now() + 20 * 60_000,
      );
      expect(((await http().get(`/campaigns/${c.id}`).set(auth(s.token))).body as Json).status).toBe('sending');
      // Transactional mail is not held up by the cap or counted against it.
      expect(sentTo()).toHaveLength(1);
    });

    it('cancel stops the rest, is idempotent and refuses a finished campaign', async () => {
      const { s } = await audienceShop('cf-cancel');
      const c = await newDraft(s);
      await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(201);
      const x = await http().post(`/campaigns/${c.id}/cancel`).set(auth(s.token)).expect(201);
      expect((x.body as Json).status).toBe('cancelled');
      await http().post(`/campaigns/${c.id}/cancel`).set(auth(s.token)).expect(201);
      await drain(c.id);
      expect(sentTo()).toHaveLength(0);
      expect((await recips(c.id)).every((r) => r.status === 'skipped')).toBe(true);
      const d = await newDraft(s);
      await http().post(`/campaigns/${d.id}/send`).set(auth(s.token)).expect(201);
      await drain(d.id);
      await http().post(`/campaigns/${d.id}/cancel`).set(auth(s.token)).expect(409);
      await http().patch(`/campaigns/${d.id}`).set(auth(s.token)).send({ name: 'x' }).expect(409);
    });

    it('leaves from the shop domain through the real provider path (faked fetch)', async () => {
      const { s } = await audienceShop('cf-real');
      const c = await newDraft(s);
      const key = process.env.RESEND_API_KEY;
      process.env.RESEND_API_KEY = 're_test_fake';
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ id: 'm1' }), { status: 200 })),
        );
      try {
        await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(201);
        await drain(c.id);
        const bodies = (fetchSpy.mock.calls as [string, { body: string }][])
          .filter(([u]) => String(u) === 'https://api.resend.com/emails')
          .map(([, i]) => JSON.parse(i.body) as { from: string; headers: Record<string, string>; to: string });
        expect(bodies).toHaveLength(2);
        for (const b of bodies) {
          expect(b.from).toContain(`@${s.slug}.example.com>`);
          expect(b.headers['List-Unsubscribe']).toMatch(/^<https:\/\/.+token=[0-9a-f]{32}>$/);
          expect(b.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
        }
        // The platform address is never a fallback: break the domain, nothing goes.
        fetchSpy.mockClear();
        const d = await newDraft(s);
        await http().post(`/campaigns/${d.id}/send`).set(auth(s.token)).expect(201);
        await db.execute(`UPDATE shopsendingdomain SET status = 'pending' WHERE shopId = ?`, [s.shopId]);
        await drain(d.id);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        process.env.RESEND_API_KEY = key;
      }
    });

    it('a test send goes only to the acting admin', async () => {
      const { s } = await audienceShop('cf-test');
      const c = await newDraft(s);
      const r = await http()
        .post(`/campaigns/${c.id}/test`)
        .set(auth(s.token))
        .send({})
        .expect(201);
      expect((r.body as Json).sent).toBe(true);
      const lines = sentTo();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`to=${s.adminEmail} subject="[Test] Spring offers"`);
      expect(await recips(c.id)).toHaveLength(0);
    });
  });

  describe('unsubscribe', () => {
    it('GET never changes anything; POST suppresses, withdraws and unconfirms; idempotent', async () => {
      const { s, e } = await audienceShop('cf-unsub');
      // Same address is both a consented customer and a confirmed newsletter row.
      await newsletter(s.shopId, e('in1'), true);
      const c = await newDraft(s);
      await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(201);
      await drain(c.id);
      const token = tokenFromLogs(e('in1'));

      const look = await http().get(`/public/campaigns/unsubscribe?token=${token}`).expect(200);
      expect((look.body as Json).shopName).toContain(s.slug);
      expect(
        await db.query(`SELECT 1 FROM emailsuppression WHERE shopId = ? AND email = ?`, [s.shopId, e('in1')]),
      ).toHaveLength(0);

      // The one-click form post a mail provider makes.
      await http()
        .post(`/public/campaigns/unsubscribe?token=${token}`)
        .type('form')
        .send('List-Unsubscribe=One-Click')
        .expect(201);
      await http().post(`/public/campaigns/unsubscribe?token=${token}`).expect(201);

      const sup = await db.query<RowDataPacket[]>(
        `SELECT reason FROM emailsuppression WHERE shopId = ? AND email = ?`,
        [s.shopId, e('in1')],
      );
      expect(sup).toHaveLength(1);
      expect(sup[0].reason).toBe('unsubscribe');
      const consent = await db.query<RowDataPacket[]>(
        `SELECT cc.status FROM customerconsent cc JOIN customer c ON c.id = cc.customerId
          WHERE c.shopId = ? AND c.email = ? AND cc.channel = 'email'`,
        [s.shopId, e('in1')],
      );
      expect(consent[0].status).toBe('withdrawn');
      const ev = await db.query<RowDataPacket[]>(
        `SELECT source, status FROM customerconsentevent ev JOIN customer c ON c.id = ev.customerId
          WHERE c.shopId = ? AND c.email = ? ORDER BY ev.id DESC LIMIT 1`,
        [s.shopId, e('in1')],
      );
      expect(ev[0]).toMatchObject({ source: 'campaign_unsubscribe', status: 'withdrawn' });
      const nl = await db.query<RowDataPacket[]>(
        `SELECT confirmedAt FROM newslettersubscriber WHERE shopId = ? AND email = ?`,
        [s.shopId, e('in1')],
      );
      expect(nl[0].confirmedAt).toBeNull();
      // Not in the next audience; the other recipient still is.
      const d = await newDraft(s);
      const r = await http().get(`/campaigns/${d.id}/audience`).set(auth(s.token));
      expect((r.body as Json).count).toBe(1);
    });

    it('answers every unusable token with the same 404', async () => {
      const bodies: string[] = [];
      for (const t of ['', 'abc', '0'.repeat(32), 'z'.repeat(32), '0'.repeat(31)]) {
        const g = await http().get(`/public/campaigns/unsubscribe?token=${t}`).expect(404);
        const p = await http().post(`/public/campaigns/unsubscribe?token=${t}`).expect(404);
        bodies.push(JSON.stringify(g.body), JSON.stringify(p.body));
      }
      expect(new Set(bodies).size).toBe(1);
      await http().get(`/public/campaigns/unsubscribe`).expect(404);
    });

    it('one shop\'s token cannot touch another shop\'s rows', async () => {
      const a = await audienceShop('cf-tok-a');
      const b = await setupShop('cf-tok-b');
      // Same address in shop B, consented.
      const shared = a.e('in1');
      await customer(b.shopId, shared, 'granted');
      const c = await newDraft(a.s);
      await http().post(`/campaigns/${c.id}/send`).set(auth(a.s.token)).expect(201);
      await drain(c.id);
      await http().post(`/public/campaigns/unsubscribe?token=${tokenFromLogs(shared)}`).expect(201);
      expect(await db.query(`SELECT 1 FROM emailsuppression WHERE shopId = ?`, [b.shopId])).toHaveLength(0);
      const consent = await db.query<RowDataPacket[]>(
        `SELECT cc.status FROM customerconsent cc JOIN customer c ON c.id = cc.customerId WHERE c.shopId = ?`,
        [b.shopId],
      );
      expect(consent[0].status).toBe('granted');
    });

    it('the customer\'s own fresh opt-in lifts an unsubscribe, not a bounce', async () => {
      const s = await setupShop('cf-reopt');
      const email = `re-${s.slug}@mail.test`;
      await db.execute(`UPDATE shop SET published = 1 WHERE id = ?`, [s.shopId]);
      const cust = await registerCustomer(app.getHttpServer(), s.slug, '0501234567', email);
      await suppress(s.shopId, email, 'unsubscribe');
      await asCustomer(app.getHttpServer(), cust, 'put', `/public/${s.slug}/account/consent`)
        .send({ channel: 'email', granted: true })
        .expect(200);
      expect(await db.query(`SELECT 1 FROM emailsuppression WHERE shopId = ? AND email = ?`, [s.shopId, email])).toHaveLength(0);
      // A bounce is not the customer's to undo.
      await suppress(s.shopId, email, 'bounce');
      await asCustomer(app.getHttpServer(), cust, 'put', `/public/${s.slug}/account/consent`)
        .send({ channel: 'email', granted: false })
        .expect(200);
      await asCustomer(app.getHttpServer(), cust, 'put', `/public/${s.slug}/account/consent`)
        .send({ channel: 'email', granted: true })
        .expect(200);
      expect(await db.query(`SELECT 1 FROM emailsuppression WHERE shopId = ? AND email = ?`, [s.shopId, email])).toHaveLength(1);
    });
  });

  describe('newsletter double opt-in', () => {
    it('flag off: the widget behaves as before (no confirmation, 409 on repeat)', async () => {
      const s = await setupShop('cf-nl-off', { flag: false });
      const r = await http().post(`/public/${s.slug}/newsletter-subscribe`).send({ email: `x-${s.slug}@mail.test` }).expect(201);
      expect((r.body as Json).confirmationRequired).toBe(false);
      await http().post(`/public/${s.slug}/newsletter-subscribe`).send({ email: `x-${s.slug}@mail.test` }).expect(409);
      const row = await db.query<RowDataPacket[]>(`SELECT confirmedAt, confirmTokenHash FROM newslettersubscriber WHERE shopId = ?`, [s.shopId]);
      expect(row[0].confirmedAt).toBeNull();
      expect(row[0].confirmTokenHash).toBeNull();
      expect(await db.query(`SELECT 1 FROM job WHERE shopId = ? AND idempotencyKey LIKE 'newsletter-confirm:%'`, [s.shopId])).toHaveLength(0);
    });

    it('flag on: a new row is unconfirmed until the link is POSTed; GET never confirms', async () => {
      const s = await setupShop('cf-nl-on');
      const email = `y-${s.slug}@mail.test`;
      const before = (await db.query(`SELECT id FROM job WHERE shopId = ? AND type = 'send_email'`, [s.shopId])).length;
      const r = await http().post(`/public/${s.slug}/newsletter-subscribe`).send({ email }).expect(201);
      expect((r.body as Json).confirmationRequired).toBe(true);
      const jobs = await db.query<RowDataPacket[]>(
        `SELECT id, payload FROM job WHERE shopId = ? AND type = 'send_email' ORDER BY id DESC LIMIT 1`,
        [s.shopId],
      );
      const after = await db.query(`SELECT id FROM job WHERE shopId = ? AND type = 'send_email'`, [s.shopId]);
      expect(after.length).toBe(before + 1);
      await worker.processJobById(jobs[0].id as number);
      const line = sentTo().find((l) => l.includes(`to=${email}`));
      // The body holds a live link: the stub withholds it, as for any sensitive job.
      expect(line).toContain('Confirm your subscription');
      const row = await db.query<RowDataPacket[]>(`SELECT confirmedAt, confirmTokenHash FROM newslettersubscriber WHERE shopId = ? AND email = ?`, [s.shopId, email]);
      expect(row[0].confirmedAt).toBeNull();
      expect(row[0].confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);
      // Not in the audience yet.
      const c = await newDraft(s);
      expect(((await http().get(`/campaigns/${c.id}/audience`).set(auth(s.token))).body as Json).count).toBe(0);
      // Recover the token: we know only its hash, so issue a known one.
      const token = randomBytes(16).toString('hex');
      await db.execute(
        `UPDATE newslettersubscriber SET confirmTokenHash = SHA2(?, 256) WHERE shopId = ? AND email = ?`,
        [token, s.shopId, email],
      );
      const look = await http().get(`/public/newsletter/confirm?token=${token}`).expect(200);
      expect((look.body as Json).confirmed).toBe(false);
      expect((await db.query<RowDataPacket[]>(`SELECT confirmedAt FROM newslettersubscriber WHERE shopId = ? AND email = ?`, [s.shopId, email]))[0].confirmedAt).toBeNull();
      await http().post(`/public/newsletter/confirm?token=${token}`).expect(201);
      await http().post(`/public/newsletter/confirm?token=${token}`).expect(201);
      expect((await db.query<RowDataPacket[]>(`SELECT confirmedAt FROM newslettersubscriber WHERE shopId = ? AND email = ?`, [s.shopId, email]))[0].confirmedAt).not.toBeNull();
      expect(((await http().get(`/campaigns/${c.id}/audience`).set(auth(s.token))).body as Json).count).toBe(1);
      await http().post(`/public/newsletter/confirm?token=${'b'.repeat(32)}`).expect(404);
    });

    it('re-subscribing an old unconfirmed row sends a confirmation, throttled; a confirmed one is a 409', async () => {
      const s = await setupShop('cf-nl-legacy');
      const email = `old-${s.slug}@mail.test`;
      await newsletter(s.shopId, email, false);
      await http().post(`/public/${s.slug}/newsletter-subscribe`).send({ email }).expect(201);
      const first = await db.query<RowDataPacket[]>(`SELECT confirmTokenHash FROM newslettersubscriber WHERE shopId = ?`, [s.shopId]);
      expect(first[0].confirmTokenHash).not.toBeNull();
      await http().post(`/public/${s.slug}/newsletter-subscribe`).send({ email }).expect(201);
      const second = await db.query<RowDataPacket[]>(`SELECT confirmTokenHash FROM newslettersubscriber WHERE shopId = ?`, [s.shopId]);
      expect(second[0].confirmTokenHash).toBe(first[0].confirmTokenHash);
      await db.execute(`UPDATE newslettersubscriber SET confirmedAt = NOW() WHERE shopId = ?`, [s.shopId]);
      await http().post(`/public/${s.slug}/newsletter-subscribe`).send({ email }).expect(409);
    });

    it('confirming lifts an unsubscribe suppression but not a bounce', async () => {
      const s = await setupShop('cf-nl-lift');
      const e1 = `u-${s.slug}@mail.test`;
      const e2 = `b-${s.slug}@mail.test`;
      await newsletter(s.shopId, e1, false);
      await newsletter(s.shopId, e2, false);
      await suppress(s.shopId, e1, 'unsubscribe');
      await suppress(s.shopId, e2, 'bounce');
      for (const [email, tok] of [[e1, randomBytes(16).toString('hex')], [e2, randomBytes(16).toString('hex')]]) {
        await db.execute(`UPDATE newslettersubscriber SET confirmTokenHash = SHA2(?, 256) WHERE shopId = ? AND email = ?`, [tok, s.shopId, email]);
        await http().post(`/public/newsletter/confirm?token=${tok}`).expect(201);
      }
      const left = await db.query<RowDataPacket[]>(`SELECT email FROM emailsuppression WHERE shopId = ?`, [s.shopId]);
      expect(left.map((r) => r.email)).toEqual([e2]);
    });
  });

  describe('tenant isolation', () => {
    it('every campaign route 404s on another shop\'s campaign', async () => {
      const a = await audienceShop('cf-iso-a');
      const b = await setupShop('cf-iso-b');
      const c = await newDraft(a.s);
      const t = auth(b.token);
      await http().get(`/campaigns/${c.id}`).set(t).expect(404);
      await http().patch(`/campaigns/${c.id}`).set(t).send({ name: 'x' }).expect(404);
      await http().get(`/campaigns/${c.id}/audience`).set(t).expect(404);
      await http().post(`/campaigns/${c.id}/test`).set(t).expect(404);
      await http().post(`/campaigns/${c.id}/send`).set(t).expect(404);
      await http().post(`/campaigns/${c.id}/cancel`).set(t).expect(404);
      expect(((await http().get('/campaigns').set(t)).body as unknown[]).length).toBe(0);
      expect(((await http().get(`/campaigns/${c.id}`).set(auth(a.s.token))).body as Json).status).toBe('draft');
    });

    it('a forged shopId/status in the body is rejected, never trusted', async () => {
      const s = await setupShop('cf-forge');
      await draft(s, { shopId: 1, status: 'sent' }).expect(400);
    });
  });

  describe('PDPL', () => {
    it('anonymising a customer scrubs their address from past campaign rows and suppresses it', async () => {
      const s = await setupShop('cf-pdpl');
      const email = `p-${s.slug}@mail.test`;
      await db.execute(`UPDATE shop SET published = 1 WHERE id = ?`, [s.shopId]);
      const cust = await registerCustomer(app.getHttpServer(), s.slug, '0501234568', email);
      await asCustomer(app.getHttpServer(), cust, 'put', `/public/${s.slug}/account/consent`)
        .send({ channel: 'email', granted: true })
        .expect(200);
      const c = await newDraft(s);
      await http().post(`/campaigns/${c.id}/send`).set(auth(s.token)).expect(201);
      await drain(c.id);
      expect(sentTo()).toHaveLength(1);
      const del = (
        await asCustomer(app.getHttpServer(), cust, 'delete', `/public/${s.slug}/account/me`).expect(202)
      ).body as Json;
      await asCustomer(
        app.getHttpServer(),
        cust,
        'delete',
        `/public/${s.slug}/account/me/confirm?token=${del.confirmationToken}`,
      ).expect(200);
      const rows = await db.query<RowDataPacket[]>(`SELECT email, status FROM campaignrecipient WHERE campaignId = ?`, [c.id]);
      expect(rows).toEqual([{ email: null, status: 'sent' }]);
      expect(await db.query(`SELECT 1 FROM emailsuppression WHERE shopId = ? AND email = ?`, [s.shopId, email])).toHaveLength(1);
      // The old unsubscribe link now finds nothing to act on, and says so generically.
      const done = ((await http().get(`/campaigns/${c.id}`).set(auth(s.token))).body as Json);
      expect(done.counts.sent).toBe(1);
    });
  });
});
