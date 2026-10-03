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

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface RedirectBody {
  id: number;
  fromPath: string;
  toTarget: string;
  statusCode: number;
  active: boolean;
  hitCount: number;
}
interface ListBody {
  data: RedirectBody[];
  total: number;
}
interface NotFoundListBody {
  data: {
    id: number;
    path: string;
    hitCount: number;
    lastReferrer: string | null;
    hasRedirect: boolean;
  }[];
  total: number;
}
interface MapBody {
  hosts: string[];
  entries: { from: string; to: string; status: number }[];
}
interface ImportBody {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  rows: { rowNumber: number; action: string; errors: string[] }[];
}
interface IdRow {
  id: number;
}

// 1..max (max <= 10000) without a recursive CTE, whose default depth limit is 1000.
function numbersUpTo(max: number): string {
  const digits = Array.from({ length: 10 }, (_, d) => `SELECT ${d} AS d`).join(
    ' UNION ALL ',
  );
  return `(SELECT a.d + b.d * 10 + c.d * 100 + e.d * 1000 + 1 AS i
           FROM (${digits}) a, (${digits}) b, (${digits}) c, (${digits}) e) n
          WHERE n.i <= ${max}`;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('URL redirects and 404 log (e2e)', () => {
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

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Redirect Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const token = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );
    const rows = await db.query<(IdRow & RowDataPacket)[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    const shopId = rows[0].id;
    await db.execute(`UPDATE shop SET published = 1 WHERE id = ?`, [shopId]);
    return { slug, token, shopId };
  }

  async function staffToken(adminToken: string, role: string, tag: string) {
    const email = `${tag}-${runId}@test.com`;
    await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Staff', email, password: 'password123', role })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(201);
    return body<AuthResponse>(login).accessToken;
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const createRedirect = (token: string, payload: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/url-redirects')
      .set(auth(token))
      .send(payload);

  let a: Awaited<ReturnType<typeof setupShop>>;
  let b: Awaited<ReturnType<typeof setupShop>>;

  beforeAll(async () => {
    a = await setupShop('redir-a');
    b = await setupShop('redir-b');
  });

  describe('admin CRUD', () => {
    it('creates with a canonical from path, lists, updates, deletes and audits', async () => {
      const created = await createRedirect(a.token, {
        fromPath: '/Products/Old-Rose/',
        toTarget: '/products/new-rose',
      }).expect(201);
      const row = body<RedirectBody>(created);
      expect(row.fromPath).toBe('/products/old-rose');
      expect(row.statusCode).toBe(301);
      expect(row.active).toBe(true);

      const list = await request(app.getHttpServer())
        .get('/url-redirects')
        .set(auth(a.token))
        .expect(200);
      expect(body<ListBody>(list).data.map((r) => r.id)).toContain(row.id);

      const updated = await request(app.getHttpServer())
        .patch(`/url-redirects/${row.id}`)
        .set(auth(a.token))
        .send({ toTarget: '/collections/roses', statusCode: 302 })
        .expect(200);
      expect(body<RedirectBody>(updated).toTarget).toBe('/collections/roses');
      expect(body<RedirectBody>(updated).statusCode).toBe(302);

      await request(app.getHttpServer())
        .delete(`/url-redirects/${row.id}`)
        .set(auth(a.token))
        .expect(200);

      const audit = await db.query<RowDataPacket[]>(
        `SELECT action FROM auditlog WHERE shopId = ? AND entityType = 'url_redirect' AND entityId = ?`,
        [a.shopId, row.id],
      );
      expect(audit.map((r) => r.action as string).sort()).toEqual([
        'url_redirect.created',
        'url_redirect.deleted',
        'url_redirect.updated',
      ]);
    });

    it('409s on a duplicate from path (case and slash variants are the same entry)', async () => {
      await createRedirect(a.token, {
        fromPath: '/dup-x',
        toTarget: '/y',
      }).expect(201);
      await createRedirect(a.token, {
        fromPath: '/DUP-X/',
        toTarget: '/z',
      }).expect(409);
    });

    it.each([
      ['//evil.com', 'protocol-relative target'],
      ['/\\evil.com', 'backslash target'],
      ['/%2Fevil.com', 'encoded slash target'],
      ['/%5Cevil.com', 'encoded backslash target'],
      ['/%252Fevil.com', 'double-encoded slash target'],
      ['/\t/evil.com', 'tab target'],
      ['javascript:alert(1)', 'javascript target'],
      ['data:text/html,x', 'data target'],
      ['https://evil.com/x', 'foreign host'],
      ['https://redir-a-lookalike.requital.io/x', 'lookalike host'],
      ['https://user@redir-a.requital.io/x', 'userinfo'],
    ])('rejects %j (%s) on create', async (toTarget) => {
      const res = await createRedirect(a.token, {
        fromPath: `/bad-${Math.random().toString(36).slice(2)}`,
        toTarget,
      });
      expect(res.status).toBe(400);
    });

    it('rejects an unsafe target on update too', async () => {
      const created = await createRedirect(a.token, {
        fromPath: '/upd-bad',
        toTarget: '/fine',
      }).expect(201);
      await request(app.getHttpServer())
        .patch(`/url-redirects/${body<RedirectBody>(created).id}`)
        .set(auth(a.token))
        .send({ toTarget: '//evil.com' })
        .expect(400);
    });

    it.each([
      '/',
      '/_next/static/x',
      '/api/x',
      '/checkout',
      '/x?y=1',
      'x',
      '/a b',
    ])('rejects the from path %j', async (fromPath) => {
      await createRedirect(a.token, { fromPath, toTarget: '/ok' }).expect(400);
    });

    it('rejects from == to, a loop and a statusCode outside 301/302', async () => {
      await createRedirect(a.token, {
        fromPath: '/same',
        toTarget: '/same',
      }).expect(400);
      await createRedirect(a.token, {
        fromPath: '/loop-a',
        toTarget: '/loop-b',
      }).expect(201);
      const loop = await createRedirect(a.token, {
        fromPath: '/loop-b',
        toTarget: '/loop-a',
      });
      expect(loop.status).toBe(400);
      expect((loop.body as { message: string }).message).toMatch(/loop/);
      await createRedirect(a.token, {
        fromPath: '/status-bad',
        toTarget: '/ok',
        statusCode: 307,
      }).expect(400);
    });

    it('rejects a chain that is too long', async () => {
      await createRedirect(a.token, {
        fromPath: '/c1',
        toTarget: '/c2',
      }).expect(201);
      await createRedirect(a.token, {
        fromPath: '/c2',
        toTarget: '/c3',
      }).expect(201);
      await createRedirect(a.token, {
        fromPath: '/c3',
        toTarget: '/c4',
      }).expect(201);
      await createRedirect(a.token, {
        fromPath: '/c4',
        toTarget: '/c5',
      }).expect(201);
      const res = await createRedirect(a.token, {
        fromPath: '/c0',
        toTarget: '/c1',
      });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toMatch(/chain/);
    });
  });

  describe('role gating', () => {
    it('401 without a token and 403 for every non-admin staff role, on every admin endpoint', async () => {
      const viewer = await staffToken(a.token, 'viewer', 'redir-viewer');
      const manager = await staffToken(
        a.token,
        'order_manager',
        'redir-manager',
      );
      const calls: [string, string][] = [
        ['get', '/url-redirects'],
        ['post', '/url-redirects'],
        ['patch', '/url-redirects/1'],
        ['delete', '/url-redirects/1'],
        ['post', '/url-redirects/import/preview'],
        ['post', '/url-redirects/import/confirm'],
        ['get', '/url-redirects/not-found-log'],
        ['delete', '/url-redirects/not-found-log'],
        ['delete', '/url-redirects/not-found-log/1'],
      ];
      for (const [method, url] of calls) {
        const server = request(app.getHttpServer());
        const none = await server[method as 'get'](url);
        expect(none.status).toBe(401);
        for (const token of [viewer, manager]) {
          const res = await request(app.getHttpServer())
            [method as 'get'](url)
            .set(auth(token));
          expect([method, url, res.status]).toEqual([method, url, 403]);
        }
      }
    });
  });

  describe('cross-tenant isolation', () => {
    it("shop A cannot read, update or delete shop B's redirect, and B's list never shows A's", async () => {
      const mine = body<RedirectBody>(
        await createRedirect(a.token, {
          fromPath: '/tenant-a-only',
          toTarget: '/a',
        }).expect(201),
      );
      const theirs = body<RedirectBody>(
        await createRedirect(b.token, {
          fromPath: '/tenant-b-only',
          toTarget: '/b',
        }).expect(201),
      );

      await request(app.getHttpServer())
        .patch(`/url-redirects/${theirs.id}`)
        .set(auth(a.token))
        .send({ toTarget: '/hijack' })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/url-redirects/${theirs.id}`)
        .set(auth(a.token))
        .expect(404);
      const still = await db.query<RowDataPacket[]>(
        `SELECT toTarget FROM urlredirect WHERE id = ?`,
        [theirs.id],
      );
      expect(still[0].toTarget).toBe('/b');

      const listA = body<ListBody>(
        await request(app.getHttpServer())
          .get('/url-redirects?pageSize=100')
          .set(auth(a.token))
          .expect(200),
      );
      expect(listA.data.some((r) => r.id === theirs.id)).toBe(false);
      const listB = body<ListBody>(
        await request(app.getHttpServer())
          .get('/url-redirects?pageSize=100')
          .set(auth(b.token))
          .expect(200),
      );
      expect(listB.data.some((r) => r.id === mine.id)).toBe(false);

      // Same from path in both shops is two independent rows.
      await createRedirect(a.token, {
        fromPath: '/shared-path',
        toTarget: '/a-dest',
      }).expect(201);
      await createRedirect(b.token, {
        fromPath: '/shared-path',
        toTarget: '/b-dest',
      }).expect(201);
      const resA = await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/resolve?path=/shared-path`)
        .expect(200);
      const resB = await request(app.getHttpServer())
        .get(`/public/${b.slug}/redirects/resolve?path=/shared-path`)
        .expect(200);
      expect((resA.body as { to: string }).to).toBe('/a-dest');
      expect((resB.body as { to: string }).to).toBe('/b-dest');
    });

    it("public resolve, map and hits on shop B never see or touch shop A's redirects", async () => {
      await createRedirect(a.token, {
        fromPath: '/only-in-a',
        toTarget: '/dest-a',
      }).expect(201);
      await request(app.getHttpServer())
        .get(`/public/${b.slug}/redirects/resolve?path=/only-in-a`)
        .expect(404);
      const map = body<MapBody>(
        await request(app.getHttpServer())
          .get(`/public/${b.slug}/redirects/map`)
          .expect(200),
      );
      expect(map.entries.some((e) => e.from === '/only-in-a')).toBe(false);

      await request(app.getHttpServer())
        .post(`/public/${b.slug}/redirects/hits`)
        .send({ hits: [{ path: '/only-in-a', count: 50 }] })
        .expect(204);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT hitCount FROM urlredirect WHERE shopId = ? AND fromPath = '/only-in-a'`,
        [a.shopId],
      );
      expect(rows[0].hitCount).toBe(0);
    });

    it('the 404 log and its dismiss/clear are per shop', async () => {
      await request(app.getHttpServer())
        .post(`/public/${a.slug}/404-log`)
        .send({ path: '/missing-in-a' })
        .expect(204);
      const listA = body<NotFoundListBody>(
        await request(app.getHttpServer())
          .get('/url-redirects/not-found-log')
          .set(auth(a.token))
          .expect(200),
      );
      const entry = listA.data.find((r) => r.path === '/missing-in-a');
      expect(entry).toBeDefined();
      const listB = body<NotFoundListBody>(
        await request(app.getHttpServer())
          .get('/url-redirects/not-found-log')
          .set(auth(b.token))
          .expect(200),
      );
      expect(listB.data.some((r) => r.path === '/missing-in-a')).toBe(false);

      await request(app.getHttpServer())
        .delete(`/url-redirects/not-found-log/${entry!.id}`)
        .set(auth(b.token))
        .expect(404);

      // B clearing its own log must not touch A's.
      await request(app.getHttpServer())
        .delete('/url-redirects/not-found-log')
        .set(auth(b.token))
        .expect(200);
      const after = body<NotFoundListBody>(
        await request(app.getHttpServer())
          .get('/url-redirects/not-found-log')
          .set(auth(a.token))
          .expect(200),
      );
      expect(after.data.some((r) => r.path === '/missing-in-a')).toBe(true);
    });

    it('an import in shop A never changes shop B', async () => {
      const before = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM urlredirect WHERE shopId = ?`,
        [b.shopId],
      );
      await request(app.getHttpServer())
        .post('/url-redirects/import/confirm')
        .set(auth(a.token))
        .attach('file', Buffer.from('from,to\n/imp-x,/imp-y\n'), 'r.csv')
        .expect(201);
      const after = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM urlredirect WHERE shopId = ?`,
        [b.shopId],
      );
      expect(after[0].c).toBe(before[0].c);
    });
  });

  describe('public resolve', () => {
    beforeAll(async () => {
      await createRedirect(a.token, {
        fromPath: '/old-page',
        toTarget: '/new-page',
      }).expect(201);
    });

    it('matches case-insensitively, ignoring query string and trailing slash', async () => {
      for (const path of ['/old-page', '/OLD-PAGE/', '/old-page?utm=1']) {
        const res = await request(app.getHttpServer())
          .get(`/public/${a.slug}/redirects/resolve`)
          .query({ path })
          .expect(200);
        expect(res.body).toEqual({ to: '/new-page', status: 301 });
      }
    });

    it('404s for an unknown path, an inactive redirect and a malformed path', async () => {
      await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/resolve?path=/nope`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/resolve?path=/%zz`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/resolve`)
        .expect(404);
      const row = await createRedirect(a.token, {
        fromPath: '/inactive',
        toTarget: '/x',
        active: false,
      }).expect(201);
      expect(body<RedirectBody>(row).active).toBe(false);
      await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/resolve?path=/inactive`)
        .expect(404);
    });

    it('collapses one extra hop', async () => {
      await createRedirect(a.token, {
        fromPath: '/hop-1',
        toTarget: '/hop-2',
      }).expect(201);
      await createRedirect(a.token, {
        fromPath: '/hop-2',
        toTarget: '/hop-3',
      }).expect(201);
      const res = await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/resolve?path=/hop-1`)
        .expect(200);
      expect((res.body as { to: string }).to).toBe('/hop-3');
    });

    it('answers 404 for an unknown, unpublished and suspended shop', async () => {
      await request(app.getHttpServer())
        .get('/public/no-such-shop-xyz/redirects/resolve?path=/old-page')
        .expect(404);
      await request(app.getHttpServer())
        .get('/public/no-such-shop-xyz/redirects/map')
        .expect(404);
      await request(app.getHttpServer())
        .post('/public/no-such-shop-xyz/404-log')
        .send({ path: '/x' })
        .expect(404);

      await db.execute(`UPDATE shop SET published = 0 WHERE id = ?`, [
        a.shopId,
      ]);
      await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/resolve?path=/old-page`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/map`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/public/${a.slug}/404-log`)
        .send({ path: '/x' })
        .expect(404);
      await db.execute(`UPDATE shop SET published = 1 WHERE id = ?`, [
        a.shopId,
      ]);

      await db.execute(`UPDATE shop SET suspendedAt = NOW() WHERE id = ?`, [
        a.shopId,
      ]);
      await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/resolve?path=/old-page`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/map`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/public/${a.slug}/redirects/hits`)
        .send({ hits: [] })
        .expect(404);
      await db.execute(`UPDATE shop SET suspendedAt = NULL WHERE id = ?`, [
        a.shopId,
      ]);
      await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/resolve?path=/old-page`)
        .expect(200);
    });
  });

  describe('resolve-time re-validation of absolute targets', () => {
    it('stops redirecting to a custom domain once it is no longer verified', async () => {
      const domain = `shop-${runId}.example.com`;
      await db.execute(
        `UPDATE shop SET domainType = 'custom', customDomain = ?, customDomainStatus = 'verified' WHERE id = ?`,
        [domain, b.shopId],
      );
      await createRedirect(b.token, {
        fromPath: '/to-custom',
        toTarget: `https://${domain}/landing`,
      }).expect(201);
      // Also the shop's own platform host is always allowed.
      await createRedirect(b.token, {
        fromPath: '/to-own-host',
        toTarget: `https://${b.slug}.requital.io/landing`,
      }).expect(201);

      const ok = await request(app.getHttpServer())
        .get(`/public/${b.slug}/redirects/resolve?path=/to-custom`)
        .expect(200);
      expect((ok.body as { to: string }).to).toBe(`https://${domain}/landing`);
      const mapBefore = body<MapBody>(
        await request(app.getHttpServer())
          .get(`/public/${b.slug}/redirects/map`)
          .expect(200),
      );
      expect(mapBefore.hosts).toContain(domain);
      expect(mapBefore.entries.some((e) => e.from === '/to-custom')).toBe(true);

      // Domain disconnected after the redirect was written.
      await db.execute(
        `UPDATE shop SET domainType = 'subdomain', customDomain = NULL, customDomainStatus = NULL WHERE id = ?`,
        [b.shopId],
      );
      await request(app.getHttpServer())
        .get(`/public/${b.slug}/redirects/resolve?path=/to-custom`)
        .expect(404);
      const mapAfter = body<MapBody>(
        await request(app.getHttpServer())
          .get(`/public/${b.slug}/redirects/map`)
          .expect(200),
      );
      expect(mapAfter.entries.some((e) => e.from === '/to-custom')).toBe(false);
      expect(mapAfter.entries.some((e) => e.from === '/to-own-host')).toBe(
        true,
      );
      expect(mapAfter.hosts).not.toContain(domain);
    });

    it('refuses to write a target on a custom domain that is not verified', async () => {
      await createRedirect(b.token, {
        fromPath: '/unverified-domain',
        toTarget: 'https://never-verified.example.com/x',
      }).expect(400);
    });
  });

  describe('map ETag', () => {
    it('answers 304 for an unchanged map and a new body after a change', async () => {
      const first = await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/map`)
        .expect(200);
      const etag = first.headers['etag'];
      expect(etag).toMatch(/^"[0-9a-f]{40}"$/);
      await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/map`)
        .set('If-None-Match', etag)
        .expect(304);
      await createRedirect(a.token, {
        fromPath: '/etag-change',
        toTarget: '/z',
      }).expect(201);
      const second = await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/map`)
        .set('If-None-Match', etag)
        .expect(200);
      expect(second.headers['etag']).not.toBe(etag);
      expect(
        body<MapBody>(second).entries.some((e) => e.from === '/etag-change'),
      ).toBe(true);
    });

    it("another shop's map has a different version", async () => {
      const mapA = await request(app.getHttpServer())
        .get(`/public/${a.slug}/redirects/map`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/public/${b.slug}/redirects/map`)
        .set('If-None-Match', mapA.headers['etag'])
        .expect(200);
    });
  });

  describe('hit counting', () => {
    it('increments only existing redirects, clamped per call, and rejects an oversize batch', async () => {
      const created = body<RedirectBody>(
        await createRedirect(a.token, {
          fromPath: '/hit-me',
          toTarget: '/z',
        }).expect(201),
      );
      await request(app.getHttpServer())
        .post(`/public/${a.slug}/redirects/hits`)
        .send({
          hits: [
            { path: '/Hit-Me/', count: 3 },
            { path: '/not-a-redirect', count: 5 },
          ],
        })
        .expect(204);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT hitCount, lastHitAt FROM urlredirect WHERE id = ?`,
        [created.id],
      );
      expect(rows[0].hitCount).toBe(3);
      expect(rows[0].lastHitAt).not.toBeNull();
      const none = await db.query<RowDataPacket[]>(
        `SELECT id FROM urlredirect WHERE shopId = ? AND fromPath = '/not-a-redirect'`,
        [a.shopId],
      );
      expect(none).toHaveLength(0);

      await request(app.getHttpServer())
        .post(`/public/${a.slug}/redirects/hits`)
        .send({ hits: [{ path: '/hit-me', count: 1000000 }] })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/public/${a.slug}/redirects/hits`)
        .send({
          hits: Array.from({ length: 101 }, () => ({
            path: '/hit-me',
            count: 1,
          })),
        })
        .expect(400);
    });
  });

  describe('404 log', () => {
    it('upserts by canonical path, counts hits, keeps only the referrer host, never the query', async () => {
      const post = (payload: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post(`/public/${a.slug}/404-log`)
          .send(payload);
      await post({
        path: '/Old/Thing/?email=victim@example.com&token=secret#frag',
        referrer: 'https://www.Google.com/search?q=secret',
      }).expect(204);
      await post({
        path: '/old/thing',
        referrer: 'javascript:alert(1)',
      }).expect(204);

      const list = body<NotFoundListBody>(
        await request(app.getHttpServer())
          .get('/url-redirects/not-found-log?search=old%2Fthing')
          .set(auth(a.token))
          .expect(200),
      );
      const entry = list.data.find((r) => r.path === '/old/thing');
      expect(entry).toBeDefined();
      expect(entry!.hitCount).toBe(2);
      expect(entry!.lastReferrer).toBe('www.google.com');
      expect(JSON.stringify(list)).not.toMatch(/victim|secret/);
    });

    it.each([
      ['a control character', '/a\nb'],
      ['a protocol-relative path', '//evil.com'],
      ['a non-path', 'javascript:alert(1)'],
      ['the root', '/'],
      ['a reserved route', '/_next/static/x'],
      ['a malformed escape', '/%zz'],
    ])('logs nothing for %s', async (_label, path) => {
      const before = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM notfoundlog WHERE shopId = ?`,
        [a.shopId],
      );
      await request(app.getHttpServer())
        .post(`/public/${a.slug}/404-log`)
        .send({ path })
        .expect(204);
      const after = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM notfoundlog WHERE shopId = ?`,
        [a.shopId],
      );
      expect(after[0].c).toBe(before[0].c);
    });

    it('stores markup-looking paths only in an inert, URL-encoded form', async () => {
      await request(app.getHttpServer())
        .post(`/public/${a.slug}/404-log`)
        .send({ path: '/<img/src=x/onerror=alert(1)>' })
        .expect(204);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT path FROM notfoundlog WHERE shopId = ? AND path LIKE '%onerror%'`,
        [a.shopId],
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.path as string).not.toMatch(/[<>"\s]/);
      }
    });

    it('rejects an over-long path at the DTO and a missing path', async () => {
      await request(app.getHttpServer())
        .post(`/public/${a.slug}/404-log`)
        .send({ path: '/' + 'a'.repeat(1500) })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/public/${a.slug}/404-log`)
        .send({})
        .expect(400);
      // Within the DTO cap but over the stored cap once encoded: ignored, not stored.
      await request(app.getHttpServer())
        .post(`/public/${a.slug}/404-log`)
        .send({ path: '/' + 'a'.repeat(900) })
        .expect(204);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT id FROM notfoundlog WHERE shopId = ? AND CHAR_LENGTH(path) > 512`,
        [a.shopId],
      );
      expect(rows).toHaveLength(0);
    });

    it('flags paths that already have a redirect, supports sort/search, dismiss and clear', async () => {
      await request(app.getHttpServer())
        .post(`/public/${a.slug}/404-log`)
        .send({ path: '/old-page' })
        .expect(204);
      const list = body<NotFoundListBody>(
        await request(app.getHttpServer())
          .get('/url-redirects/not-found-log?sort=hits')
          .set(auth(a.token))
          .expect(200),
      );
      expect(list.data.find((r) => r.path === '/old-page')?.hasRedirect).toBe(
        true,
      );
      const hits = list.data.map((r) => r.hitCount);
      expect([...hits].sort((x, y) => y - x)).toEqual(hits);

      const target = list.data.find((r) => r.path === '/old/thing')!;
      await request(app.getHttpServer())
        .delete(`/url-redirects/not-found-log/${target.id}`)
        .set(auth(a.token))
        .expect(200);
      const gone = await db.query<RowDataPacket[]>(
        `SELECT id FROM notfoundlog WHERE id = ?`,
        [target.id],
      );
      expect(gone).toHaveLength(0);

      await request(app.getHttpServer())
        .delete('/url-redirects/not-found-log')
        .set(auth(a.token))
        .expect(200);
      const empty = body<NotFoundListBody>(
        await request(app.getHttpServer())
          .get('/url-redirects/not-found-log')
          .set(auth(a.token))
          .expect(200),
      );
      expect(empty.total).toBe(0);
    });

    it('caps distinct paths per shop and evicts the least valuable row, never growing past the cap', async () => {
      const c = await setupShop('redir-cap');
      await db.execute(
        `INSERT INTO notfoundlog (shopId, path, hitCount)
         SELECT ?, CONCAT('/seed-', n.i), IF(n.i = 1, 1, 50) FROM ${numbersUpTo(5000)}`,
        [c.shopId],
      );
      await request(app.getHttpServer())
        .post(`/public/${c.slug}/404-log`)
        .send({ path: '/fresh-path' })
        .expect(204);
      const count = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM notfoundlog WHERE shopId = ?`,
        [c.shopId],
      );
      expect(count[0].c).toBe(5000);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT path FROM notfoundlog WHERE shopId = ? AND path IN ('/seed-1', '/fresh-path')`,
        [c.shopId],
      );
      // The single 1-hit seed row was the one evicted; the new path got in.
      expect(rows.map((r) => r.path as string)).toEqual(['/fresh-path']);
    });
  });

  describe('CSV import', () => {
    const upload = (path: string, token: string, csv: string) =>
      request(app.getHttpServer())
        .post(`/url-redirects/import/${path}`)
        .set(auth(token))
        .attach('file', Buffer.from(csv), 'redirects.csv');

    it('preview reports creates, updates, skips and row-level errors, and writes nothing', async () => {
      const c = await setupShop('redir-imp');
      await createRedirect(c.token, {
        fromPath: '/exists-same',
        toTarget: '/dest',
      }).expect(201);
      await createRedirect(c.token, {
        fromPath: '/exists-change',
        toTarget: '/old-dest',
      }).expect(201);
      const csv = [
        'from,to,status',
        '/new-one,/dest-1,301',
        '/exists-same,/dest,301',
        '/exists-change,/new-dest,302',
        '//evil.com,/x,301',
        '/ok-from,https://evil.com/x,301',
        '/bad-status,/x,308',
        '/loop-1,/loop-2,301',
        '/loop-2,/loop-1,301',
        '/new-one,/dup,301',
        ',/no-from,301',
      ].join('\r\n');
      const res = body<ImportBody>(
        await upload('preview', c.token, csv).expect(201),
      );
      expect(res).toMatchObject({
        total: 10,
        created: 1,
        updated: 1,
        skipped: 1,
        errors: 7,
      });
      const errorRows = res.rows.filter((r) => r.action === 'error');
      expect(errorRows.every((r) => r.errors.length > 0)).toBe(true);
      expect(errorRows.some((r) => r.errors.join(' ').includes('loop'))).toBe(
        true,
      );
      expect(
        errorRows.some((r) => r.errors.join(' ').includes('Duplicate')),
      ).toBe(true);

      const written = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM urlredirect WHERE shopId = ?`,
        [c.shopId],
      );
      expect(written[0].c).toBe(2);
    });

    it('confirm re-validates the file itself and applies only the valid rows', async () => {
      const c = await setupShop('redir-imp2');
      const csv = [
        'Redirect from,Redirect to',
        '/imp-1,/dest-1',
        '/imp-2,//evil.com',
        '/imp-3,javascript:alert(1)',
        '/Imp-4/,/dest-4',
      ].join('\n');
      const res = body<ImportBody>(
        await upload('confirm', c.token, csv).expect(201),
      );
      expect(res).toMatchObject({ created: 2, errors: 2 });
      const rows = await db.query<RowDataPacket[]>(
        `SELECT fromPath, toTarget FROM urlredirect WHERE shopId = ? ORDER BY fromPath`,
        [c.shopId],
      );
      expect(rows.map((r) => r.fromPath as string)).toEqual([
        '/imp-1',
        '/imp-4',
      ]);

      // Re-running the same file is a no-op: everything valid is now a skip.
      const again = body<ImportBody>(
        await upload('confirm', c.token, csv).expect(201),
      );
      expect(again).toMatchObject({
        created: 0,
        updated: 0,
        skipped: 2,
        errors: 2,
      });
    });

    it('rejects a file without the from/to columns, no file, and a non-csv upload', async () => {
      await upload('preview', a.token, 'a,b\n1,2\n').expect(400);
      await request(app.getHttpServer())
        .post('/url-redirects/import/preview')
        .set(auth(a.token))
        .expect(400);
      await request(app.getHttpServer())
        .post('/url-redirects/import/preview')
        .set(auth(a.token))
        .attach('file', Buffer.from('from,to'), 'r.txt')
        .expect(400);
    });

    it('rejects more than the per-file row cap', async () => {
      const lines = ['from,to'];
      for (let i = 0; i < 10_001; i += 1) lines.push(`/r${i},/t`);
      await upload('preview', a.token, lines.join('\n')).expect(400);
    });

    it('enforces the per-shop cap on create and on import', async () => {
      const c = await setupShop('redir-cap2');
      await db.execute(
        `INSERT INTO urlredirect (shopId, fromPath, toTarget)
         SELECT ?, CONCAT('/seed-', n.i), '/t' FROM ${numbersUpTo(10000)}`,
        [c.shopId],
      );
      const res = await createRedirect(c.token, {
        fromPath: '/one-too-many',
        toTarget: '/t',
      });
      expect(res.status).toBe(409);
      await upload('confirm', c.token, 'from,to\n/another,/t\n').expect(400);
      // An update-only file is still allowed at the cap.
      const update = body<ImportBody>(
        await upload('confirm', c.token, 'from,to\n/seed-1,/changed\n').expect(
          201,
        ),
      );
      expect(update.updated).toBe(1);
    });
  });
});
