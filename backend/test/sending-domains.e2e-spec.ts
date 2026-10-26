import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobsWorkerService } from '../src/jobs/jobs.worker.service';
import { SendingDomainsService } from '../src/sending-domains/sending-domains.service';
import { SENDING_DOMAINS_CLIENT } from '../src/sending-domains/sending-domains.client';
import { FakeSendingDomainsClient } from '../src/sending-domains/resend-domains.client.fake';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface Shop {
  token: string;
  shopId: number;
  email: string;
}
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Shop sending domains (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let fake: FakeSendingDomainsClient;
  let jobs: JobsService;
  let worker: JobsWorkerService;
  let svc: SendingDomainsService;
  const runId = Date.now();
  const originalKey = process.env.RESEND_API_KEY;
  let fetchSpy: jest.SpyInstance;
  let n = 0;

  beforeAll(async () => {
    fake = new FakeSendingDomainsClient();
    const mod: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SENDING_DOMAINS_CLIENT)
      .useValue(fake)
      .compile();
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
    jobs = mod.get(JobsService);
    worker = mod.get(JobsWorkerService);
    svc = mod.get(SendingDomainsService);
  });

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function setupShop(prefix: string, verified = true): Promise<Shop> {
    const email = `${prefix}-${runId}@test.com`;
    const res = await http()
      .post('/auth/signup')
      .send({
        name: 'SD Admin',
        email,
        password: 'password123',
        shopName: `${prefix} Shop`,
        subdomain: `${prefix}-${runId}`,
      })
      .expect(201);
    const b = res.body as Json;
    if (verified)
      await verifySignupEmail(app.getHttpServer(), b.devVerificationLink);
    await http()
      .patch('/shop')
      .set(auth(b.accessToken))
      .send({ email })
      .expect(200);
    return { token: b.accessToken, shopId: b.user.shopId, email };
  }
  const domainFor = (p: string) => `${p}-${runId}-${++n}.example.com`;
  const put = (t: string, domain: string) =>
    http().put('/shop/sending-domain').set(auth(t)).send({ domain });
  const get = (t: string) => http().get('/shop/sending-domain').set(auth(t));
  const verify = (t: string) =>
    http().post('/shop/sending-domain/verify').set(auth(t));
  const del = (t: string) => http().delete('/shop/sending-domain').set(auth(t));

  // Enqueue a send_email job for a shop and run it in THIS process, with a
  // faked Resend; returns each fetch call's JSON body.
  async function sendJob(shopId: number, payload: Json) {
    process.env.RESEND_API_KEY = 're_test_fake';
    const key = `sd:${runId}:${++n}`;
    const job = await jobs.enqueue(
      shopId,
      'send_email',
      { to: 'cust@example.com', subject: 'Hi', bodyText: 'Body', ...payload },
      key,
    );
    await worker.processJobById(job.id);
    return fetchSpy.mock.calls
      .filter(([u]) => String(u) === 'https://api.resend.com/emails')
      .map(([, init]) => JSON.parse(init.body as string) as Json);
  }
  async function verifyViaProvider(t: string, domain: string) {
    fake.setStatus(fake.idFor(domain)!, 'verified');
    const r = await verify(t).expect(201);
    expect((r.body as Json).verified).toBe(true);
  }

  it('requires auth, admin role and a verified email for PUT', async () => {
    await http().get('/shop/sending-domain').expect(401);
    const unverified = await setupShop('sd-unv', false);
    await put(unverified.token, domainFor('unv')).expect(403);
    const shop = await setupShop('sd-role');
    const outlets = await http()
      .get('/outlets')
      .set(auth(shop.token))
      .expect(200);
    const outletId = ((outlets.body as Json).data ?? outlets.body)[0]
      .id as number;
    const staffEmail = `sd-branch-${runId}@test.com`;
    await http()
      .post('/auth/branch-users')
      .set(auth(shop.token))
      .send({
        name: 'B',
        email: staffEmail,
        password: 'password123',
        role: 'branch',
        outletId,
      })
      .expect(201);
    const login = await http()
      .post('/auth/login')
      .send({ email: staffEmail, password: 'password123' })
      .expect(201);
    const bt = (login.body as Json).accessToken as string;
    await get(bt).expect(403);
    await put(bt, domainFor('role')).expect(403);
    await verify(bt).expect(403);
    await del(bt).expect(403);
  });

  it.each([
    'requital.io',
    'mail.requital.io',
    'gmail.com',
    'user.outlook.com',
    'co.uk',
    'not a domain',
    'http://x.com',
  ])('rejects %s', async (d) => {
    const shop = await setupShop(`sd-bad${++n}`);
    await put(shop.token, d).expect(400);
    expect((await get(shop.token).expect(200)).body).toEqual({
      sendingDomain: null,
    });
  });

  it('claims, shows records, is idempotent, then verifies and audits', async () => {
    const shop = await setupShop('sd-flow');
    const domain = domainFor('flow');
    const r = await put(shop.token, domain).expect(200);
    const view = r.body as Json;
    expect(view.status).toBe('pending');
    expect(view.fromAddress).toBe(`noreply@${domain}`);
    expect(view.records.length).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toMatch(/providerDomainId|fake-dom/);

    const before = fake.calls.length;
    await put(shop.token, domain.toUpperCase()).expect(200); // same claim: no provider call
    expect(fake.calls.length).toBe(before);

    // provider still pending -> verifying, not verified
    const v1 = (await verify(shop.token).expect(201)).body as Json;
    expect(v1).toMatchObject({ status: 'verifying', verified: false });
    await verifyViaProvider(shop.token, domain);
    expect(((await get(shop.token)).body as Json).sendingDomain.status).toBe(
      'verified',
    );

    const audit = await db.query<RowDataPacket[]>(
      `SELECT action FROM auditlog WHERE shopId = ? AND entityType = 'sending_domain'`,
      [shop.shopId],
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['sending_domain.set', 'sending_domain.verified']),
    );
  });

  it('tenant isolation: another shop cannot read, verify, remove or steal a claim', async () => {
    const a = await setupShop('sd-isoa');
    const b = await setupShop('sd-isob');
    const domain = domainFor('iso');
    await put(a.token, domain).expect(200);
    await verifyViaProvider(a.token, domain);

    expect(((await get(b.token)).body as Json).sendingDomain).toBeNull();
    await verify(b.token).expect(404);
    await del(b.token).expect(404);
    await put(b.token, domain).expect(409); // verified elsewhere
    // A is untouched.
    expect(((await get(a.token)).body as Json).sendingDomain.status).toBe(
      'verified',
    );
    const rows = await db.query<RowDataPacket[]>(
      `SELECT shopId FROM shopsendingdomain WHERE domain = ?`,
      [domain],
    );
    expect(rows.map((x) => x.shopId)).toEqual([a.shopId]);
  });

  it('two shops may both PENDING-claim one domain; only the first to verify wins (DB unique key)', async () => {
    const a = await setupShop('sd-racea');
    const b = await setupShop('sd-raceb');
    const domain = domainFor('race');
    await put(a.token, domain).expect(200);
    await put(b.token, domain).expect(200);
    const ida = (
      await db.query<RowDataPacket[]>(
        `SELECT providerDomainId p FROM shopsendingdomain WHERE shopId=?`,
        [a.shopId],
      )
    )[0].p as string;
    const idb = (
      await db.query<RowDataPacket[]>(
        `SELECT providerDomainId p FROM shopsendingdomain WHERE shopId=?`,
        [b.shopId],
      )
    )[0].p as string;
    fake.setStatus(ida, 'verified');
    fake.setStatus(idb, 'verified');
    await verify(a.token).expect(201);
    await verify(b.token).expect(409);
    const row = (
      await db.query<RowDataPacket[]>(
        `SELECT status FROM shopsendingdomain WHERE shopId=?`,
        [b.shopId],
      )
    )[0];
    expect(row.status).toBe('failed');
  });

  it('send path: verified domain -> From shop domain + Reply-To; every other case -> platform address', async () => {
    const a = await setupShop('sd-send');
    const other = await setupShop('sd-sendother');
    const domain = domainFor('send');
    const ok = { ok: true, json: async () => ({ id: 're_1' }) };
    fetchSpy.mockResolvedValue(ok);

    // pending: platform address, shop display name honoured
    await put(a.token, domain).expect(200);
    let sent = await sendJob(a.shopId, { fromName: 'Rose Shop' });
    expect(sent.at(-1)!.from).toBe('"Rose Shop" <noreply@requital.io>');
    expect(sent.at(-1)!.reply_to).toBeUndefined();

    await verifyViaProvider(a.token, domain);
    fetchSpy.mockClear();
    sent = await sendJob(a.shopId, { fromName: 'Rose Shop' });
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toBe(`"Rose Shop" <noreply@${domain}>`);
    expect(sent[0].reply_to).toBe(a.email);

    // header injection through the shop name
    fetchSpy.mockClear();
    sent = await sendJob(a.shopId, {
      fromName: 'Evil\r\nBcc: x@y.com" <a@b.c>',
    });
    expect(sent[0].from).not.toMatch(/[\r\n]/);
    expect(sent[0].from.endsWith(`<noreply@${domain}>`)).toBe(true);
    expect(sent[0].from).not.toContain('<a@b.c>');
    expect(sent[0].from.match(/"/g)).toHaveLength(2);

    // platform mail from the same shop (no fromName): platform address
    fetchSpy.mockClear();
    sent = await sendJob(a.shopId, {});
    expect(sent[0].from).toBe('"Requital" <noreply@requital.io>');

    // another shop never borrows A's domain
    fetchSpy.mockClear();
    sent = await sendJob(other.shopId, { fromName: 'Other' });
    expect(sent[0].from).toBe('"Other" <noreply@requital.io>');

    // domain send rejected by the provider -> retried from the platform address
    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ message: 'domain not verified' }),
      })
      .mockResolvedValueOnce(ok);
    sent = await sendJob(a.shopId, { fromName: 'Rose Shop' });
    expect(sent).toHaveLength(2);
    expect(sent[0].from).toBe(`"Rose Shop" <noreply@${domain}>`);
    expect(sent[1].from).toBe('"Rose Shop" <noreply@requital.io>');

    // removing the domain stops using it at once
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(ok);
    await del(a.token).expect(200);
    expect(fake.calls.some((c) => c.startsWith('delete:'))).toBe(true);
    sent = await sendJob(a.shopId, { fromName: 'Rose Shop' });
    expect(sent[0].from).toBe('"Rose Shop" <noreply@requital.io>');
    expect(((await get(a.token)).body as Json).sendingDomain).toBeNull();
  });

  it('replacing a verified domain stops sending from the old one immediately', async () => {
    const a = await setupShop('sd-repl');
    const d1 = domainFor('repl1');
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: 'x' }) });
    await put(a.token, d1).expect(200);
    await verifyViaProvider(a.token, d1);
    await put(a.token, domainFor('repl2')).expect(200);
    const sent = await sendJob(a.shopId, { fromName: 'R' });
    expect(sent[0].from).toBe('"R" <noreply@requital.io>');
  });

  it('provider outage: PUT fails 503 and stores nothing; verify keeps state and reports a generic error', async () => {
    const a = await setupShop('sd-down');
    fake.failNext();
    await put(a.token, domainFor('down')).expect(503);
    expect(((await get(a.token)).body as Json).sendingDomain).toBeNull();

    const domain = domainFor('down2');
    await put(a.token, domain).expect(200);
    fake.failNext(2); // requestVerification + (not reached) getDomain
    const r = (await verify(a.token).expect(201)).body as Json;
    expect(r.verified).toBe(false);
    fake.failNext(0);
    expect(r.message).toMatch(/email provider/);
    expect(((await get(a.token)).body as Json).sendingDomain.status).toBe(
      'pending',
    );
  });

  it('sweep: verifies a due claim, and fails a claim older than 48h', async () => {
    const a = await setupShop('sd-sweep');
    const b = await setupShop('sd-sweepold');
    const da = domainFor('sweep');
    const db2 = domainFor('sweepold');
    await put(a.token, da).expect(200);
    await put(b.token, db2).expect(200);
    fake.setStatus(fake.idFor(da)!, 'verified');
    await db.execute(
      `UPDATE shopsendingdomain SET claimedAt = DATE_SUB(NOW(), INTERVAL 49 HOUR) WHERE shopId = ?`,
      [b.shopId],
    );
    await svc.runSweep();
    expect(((await get(a.token)).body as Json).sendingDomain.status).toBe(
      'verified',
    );
    expect(((await get(b.token)).body as Json).sendingDomain.status).toBe(
      'failed',
    );
  });
});
