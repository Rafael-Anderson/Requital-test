import 'dotenv/config';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// W7: the storefront's `/api/*` rewrite must reach the backend over its LOCAL
// origin (INTERNAL_API_URL), not back through Caddy. Real parts here: the
// backend (TRUST_PROXY=loopback, the production value) and a real `next dev`
// of storefront/ with its real next.config.ts rewrite. Stand-ins: Caddy, which
// is modelled by its one relevant behaviour (no `trusted_proxies`, so
// X-Forwarded-For is OVERWRITTEN with the client's socket address). Every
// connection here comes from 127.0.0.1, so the simulated socket address of the
// "internet client" travels in a test-only header that the stand-in consumes
// and strips (a client cannot send a header Caddy honours as its peer).
//
//   client -> caddy -> next (:3002) -> backend            production, after
//   client -> caddy -> next (:3002) -> caddy -> backend   production, before
//
// Skipped when storefront/node_modules is absent (backend-only checkouts).

const STOREFRONT = path.resolve(__dirname, '../../storefront');
const NEXT_BIN = path.join(STOREFRONT, 'node_modules/next/dist/bin/next');
const describeIfStorefront = fs.existsSync(NEXT_BIN) ? describe : describe.skip;
const SIM = 'x-sim-client-ip';
const VPS = '198.51.100.9'; // what api.requital.io's Caddy sees as the peer
const runId = Date.now();
let seq = 0;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

// Caddy's default reverse_proxy: X-Forwarded-For := the peer's address.
function caddy(targetPort: number, fixedPeer?: string) {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    const peer = fixedPeer ?? String(req.headers[SIM] ?? '');
    const headers = { ...req.headers, 'x-forwarded-for': peer };
    delete headers[SIM];
    const up = http.request(
      {
        host: '127.0.0.1',
        port: targetPort,
        method: req.method,
        path: req.url,
        headers,
      },
      (ur) => {
        res.writeHead(ur.statusCode ?? 502, ur.headers);
        ur.pipe(res);
      },
    );
    up.on('error', () => {
      res.statusCode = 502;
      res.end();
    });
    req.pipe(up);
  });
  return new Promise<{
    port: number;
    hits: () => number;
    close: () => Promise<void>;
  }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        hits: () => hits,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
      }),
    ),
  );
}

async function startStorefront(env: Record<string, string>) {
  const port = await freePort();
  const child: ChildProcess = spawn(
    process.execPath,
    [NEXT_BIN, 'dev', '-p', String(port), '-H', '127.0.0.1'],
    {
      cwd: STOREFRONT,
      detached: true,
      stdio: 'ignore',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1',
        ...env,
      },
    },
  );
  const stop = () => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  };
  // Ready when the rewrite answers with anything from the backend.
  for (let i = 0; i < 60; i++) {
    const ok = await new Promise<boolean>((r) => {
      const q = http.get(
        `http://127.0.0.1:${port}/api/domains/verify?domain=w7.invalid`,
        (res) => {
          res.resume();
          r((res.statusCode ?? 500) < 500);
        },
      );
      q.on('error', () => r(false));
      q.setTimeout(20000, () => q.destroy());
    });
    if (ok) return { port, stop };
    await new Promise((r) => setTimeout(r, 1500));
  }
  stop();
  throw new Error('storefront dev server did not come up');
}

describeIfStorefront('storefront /api rewrite and client IP (W7)', () => {
  jest.setTimeout(180000);
  const prevThrottle = process.env.THROTTLE_IN_TESTS;
  const prevTrust = process.env.TRUST_PROXY;
  let app: INestApplication;
  let backendPort: number;
  let apiCaddy: Awaited<ReturnType<typeof caddy>>; // "api.requital.io"
  let edge: Awaited<ReturnType<typeof caddy>> | undefined;
  let storefront: Awaited<ReturnType<typeof startStorefront>> | undefined;

  beforeAll(async () => {
    process.env.THROTTLE_IN_TESTS = '1';
    process.env.TRUST_PROXY = 'loopback';
    const moduleFixture = await Test.createTestingModule({
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
    await app.listen(0, '127.0.0.1');
    backendPort = (
      (app.getHttpServer() as http.Server).address() as net.AddressInfo
    ).port;
    apiCaddy = await caddy(backendPort, VPS);
  });

  afterAll(async () => {
    storefront?.stop();
    await edge?.close();
    await apiCaddy?.close();
    await app?.close();
    if (prevThrottle === undefined) delete process.env.THROTTLE_IN_TESTS;
    else process.env.THROTTLE_IN_TESTS = prevThrottle;
    if (prevTrust === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prevTrust;
  });

  async function useStorefront(env: Record<string, string>) {
    storefront?.stop();
    await edge?.close();
    storefront = await startStorefront(env);
    edge = await caddy(storefront.port);
  }

  const login = async (
    base: string,
    prefix: string,
    ip: string,
    xff?: string,
  ) => {
    let req = request(base).post(`${prefix}/auth/login`).set(SIM, ip);
    if (xff) req = req.set('X-Forwarded-For', xff);
    const res = await req.send({
      email: `nobody-${runId}-${++seq}@test.com`,
      password: 'not-the-password-1',
    });
    return res.status;
  };

  const sessionIp = async (
    base: string,
    prefix: string,
    ip: string,
    xff?: string,
  ) => {
    const slug = `e2e-w7-${runId}-${++seq}`;
    let req = request(base).post(`${prefix}/auth/signup`).set(SIM, ip);
    if (xff) req = req.set('X-Forwarded-For', xff);
    const signup = await req.send({
      name: 'W7 Admin',
      email: `${slug}@test.com`,
      password: 'password123',
      shopName: `${slug} Shop`,
      subdomain: slug,
    });
    expect(signup.status).toBe(201);
    const token = (signup.body as { accessToken: string }).accessToken;
    const list = await request(base)
      .get(`${prefix}/auth/sessions`)
      .set(SIM, ip)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    return (list.body as Array<{ ip: string | null }>)[0].ip;
  };

  const edgeUrl = () => `http://127.0.0.1:${edge!.port}`;

  describe('INTERNAL_API_URL = the backend local origin (production, after)', () => {
    beforeAll(async () => {
      await useStorefront({
        // The public origin points at the "api.requital.io" Caddy: if the
        // rewrite used it, apiCaddy.hits() would move and the IP would be VPS.
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiCaddy.port}`,
        INTERNAL_API_URL: `http://127.0.0.1:${backendPort}`,
      });
    });

    it('the rewrite stays on the local origin and the session records the real client', async () => {
      const before = apiCaddy.hits();
      expect(await sessionIp(edgeUrl(), '/api', '203.0.113.11')).toBe(
        '203.0.113.11',
      );
      expect(apiCaddy.hits()).toBe(before);
    });

    it('a forged X-Forwarded-For from outside is overwritten by Caddy, then ignored (storefront path)', async () => {
      expect(
        await sessionIp(edgeUrl(), '/api', '203.0.113.12', '6.6.6.6, 7.7.7.7'),
      ).toBe('203.0.113.12');
    });

    it('chain A: direct to the API host, a forged X-Forwarded-For is ignored too', async () => {
      const direct = await caddy(backendPort);
      try {
        expect(
          await sessionIp(
            `http://127.0.0.1:${direct.port}`,
            '',
            '203.0.113.13',
            '6.6.6.6',
          ),
        ).toBe('203.0.113.13');
      } finally {
        await direct.close();
      }
    });

    it('two clients through the same storefront proxy get separate throttle buckets', async () => {
      const a = '203.0.113.21';
      const b = '203.0.113.22';
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push(await login(edgeUrl(), '/api', a));
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
      expect(await login(edgeUrl(), '/api', b)).toBe(401);
      // A cannot buy a fresh bucket by forging the header.
      expect(await login(edgeUrl(), '/api', a, '1.1.1.1')).toBe(429);
      expect(apiCaddy.hits()).toBe(0);
    });
  });

  describe('INTERNAL_API_URL unset (CI, dev, e2e)', () => {
    beforeAll(async () => {
      await useStorefront({
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${backendPort}`,
      });
    });

    it('falls back to NEXT_PUBLIC_API_URL and still records the real client', async () => {
      expect(await sessionIp(edgeUrl(), '/api', '203.0.113.31')).toBe(
        '203.0.113.31',
      );
      expect(
        await sessionIp(edgeUrl(), '/api', '203.0.113.32', '6.6.6.6'),
      ).toBe('203.0.113.32');
    });
  });

  // The bug this item fixes, reproduced so the tests above are known to
  // discriminate: with only the public origin, the second hop re-enters Caddy.
  describe('INTERNAL_API_URL unset and NEXT_PUBLIC_API_URL = the public Caddy (production, before)', () => {
    beforeAll(async () => {
      await useStorefront({
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiCaddy.port}`,
      });
    });

    it('every shopper shares the VPS address and one throttle bucket', async () => {
      expect(await sessionIp(edgeUrl(), '/api', '203.0.113.41')).toBe(VPS);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        statuses.push(await login(edgeUrl(), '/api', '203.0.113.42'));
      }
      expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);
      // A different shopper is limited by someone else's failures.
      expect(await login(edgeUrl(), '/api', '203.0.113.43')).toBe(429);
    });
  });
});
