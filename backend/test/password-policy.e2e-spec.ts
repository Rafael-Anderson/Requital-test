import 'dotenv/config';
import { createHash } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

interface SignupResponse {
  accessToken: string;
  user: { id: number; shopId: number; email: string };
  devVerificationLink?: string;
}
interface ErrBody {
  message: string | string[];
  code?: string;
}
const body = <T>(r: Response) => r.body as T;
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!;
const sha1 = (s: string) =>
  createHash('sha1').update(s, 'utf8').digest('hex').toUpperCase();

// The HTTP call to the breach service is stubbed in this whole file: no real
// network. supertest talks to the app over node:http, not global fetch, so
// spying on fetch only ever sees the breach check.
describe('Password policy (e2e)', () => {
  let app: INestApplication<App>;
  const runId = Date.now();
  const GOOD = 'amber-lantern-harbour-91';
  let hibpMode: 'clean' | 'breached' | 'down500' | 'networkError' | 'garbage' =
    'clean';
  let breachedPassword = '';
  let hibpUrls: string[] = [];
  let realFetch: typeof fetch;

  beforeAll(async () => {
    realFetch = global.fetch;
    jest.spyOn(global, 'fetch').mockImplementation((input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.includes('pwnedpasswords.com')) return realFetch(input, init);
      hibpUrls.push(url);
      if (hibpMode === 'networkError') {
        return Promise.reject(new TypeError('fetch failed'));
      }
      if (hibpMode === 'down500') {
        return Promise.resolve(new Response('', { status: 500 }));
      }
      if (hibpMode === 'garbage') {
        return Promise.resolve(new Response('<html>nope</html>'));
      }
      const lines = [`${'A'.repeat(35)}:0`, `${'B'.repeat(35)}:11`];
      if (hibpMode === 'breached') {
        lines.push(`${sha1(breachedPassword).slice(5)}:9001`);
      }
      return Promise.resolve(new Response(lines.join('\r\n')));
    });
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
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    hibpMode = 'clean';
    breachedPassword = '';
    hibpUrls = [];
    process.env.PASSWORD_POLICY_IN_TESTS = '1';
  });
  afterEach(() => {
    delete process.env.PASSWORD_POLICY_IN_TESTS;
  });

  const http = () => request(app.getHttpServer());

  async function signup(
    prefix: string,
    overrides: Record<string, unknown> = {},
  ) {
    const email = `${prefix}-${runId}@test.com`;
    const res = await http()
      .post('/auth/signup')
      .send({
        name: 'Policy Admin',
        email,
        password: GOOD,
        shopName: `${prefix} Shop`,
        subdomain: `${prefix}-${runId}`,
        ...overrides,
      });
    return { email, res, subdomain: `${prefix}-${runId}` };
  }

  async function verifiedAdmin(prefix: string) {
    const { email, res, subdomain } = await signup(prefix);
    expect(res.status).toBe(201);
    const s = body<SignupResponse>(res);
    await http()
      .post('/auth/verify-email')
      .send({ token: tokenFrom(s.devVerificationLink!) })
      .expect(201);
    return { email, subdomain, token: s.accessToken, userId: s.user.id };
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const codeOf = (r: Response) => body<ErrBody>(r).code;

  describe('signup', () => {
    it('rejects a common password with a clear 400 and a code', async () => {
      const { res } = await signup('pp-common', { password: 'Password123' });
      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe('password_too_common');
      expect(String(body<ErrBody>(res).message)).toMatch(/too common/i);
    });

    it('rejects a password equal to the email, the shop name or the user name', async () => {
      const a = await signup('pp-id-email', {
        password: `pp-id-email-${runId}@test.com`,
      });
      expect(codeOf(a.res)).toBe('password_matches_identity');
      const b = await signup('pp-id-shop', {
        password: 'my lovely florist',
        shopName: 'My Lovely Florist',
      });
      expect(codeOf(b.res)).toBe('password_matches_identity');
      const c = await signup('pp-id-name', {
        password: 'Zainab Al Mansoori',
        name: 'Zainab Al Mansoori',
      });
      expect(codeOf(c.res)).toBe('password_matches_identity');
    });

    it('rejects a password over 72 BYTES even though it is under 72 characters', async () => {
      const { res } = await signup('pp-bytes', { password: '🔐'.repeat(25) });
      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe('password_too_long');
    });

    it('rejects a breached password, sending only the 5-char hash prefix', async () => {
      breachedPassword = 'tangerine-orbit-5521';
      hibpMode = 'breached';
      const { res } = await signup('pp-breach', { password: breachedPassword });
      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe('password_breached');
      expect(hibpUrls).toHaveLength(1);
      const full = sha1(breachedPassword);
      expect(hibpUrls[0]).toMatch(/\/range\/[0-9A-F]{5}$/);
      expect(hibpUrls[0].endsWith(full.slice(0, 5))).toBe(true);
      expect(hibpUrls[0]).not.toContain(full.slice(5, 12));
      expect(hibpUrls[0]).not.toContain(breachedPassword);
    });

    it.each(['down500', 'networkError', 'garbage'] as const)(
      'FAILS OPEN when the breach service is %s: signup still succeeds',
      async (mode) => {
        hibpMode = mode;
        const { res } = await signup(`pp-open-${mode.toLowerCase()}`);
        expect(res.status).toBe(201);
      },
    );

    it('a rejected password creates no shop or user', async () => {
      const { res, subdomain } = await signup('pp-norow', {
        password: 'welcome123',
      });
      expect(res.status).toBe(400);
      const retry = await http()
        .post('/auth/signup')
        .send({
          name: 'x',
          email: `pp-norow-${runId}@test.com`,
          password: GOOD,
          shopName: 'x',
          subdomain,
        });
      expect(retry.status).toBe(201);
    });
  });

  describe('existing users are not locked out', () => {
    it('an account whose password is now on the common list can still log in', async () => {
      delete process.env.PASSWORD_POLICY_IN_TESTS;
      const { email, res } = await signup('pp-legacy', {
        password: 'password123',
      });
      expect(res.status).toBe(201);
      process.env.PASSWORD_POLICY_IN_TESTS = '1';
      await http()
        .post('/auth/login')
        .send({ email, password: 'password123' })
        .expect(201);
    });
  });

  describe('change password', () => {
    it('rejects weak and breached new passwords and leaves the old one working', async () => {
      const a = await verifiedAdmin('pp-change');
      const weak = await http()
        .post('/auth/change-password')
        .set(auth(a.token))
        .send({ currentPassword: GOOD, newPassword: 'qwerty123' });
      expect(weak.status).toBe(400);
      expect(codeOf(weak)).toBe('password_too_common');

      breachedPassword = 'saffron-meadow-3030';
      hibpMode = 'breached';
      const br = await http()
        .post('/auth/change-password')
        .set(auth(a.token))
        .send({ currentPassword: GOOD, newPassword: breachedPassword });
      expect(codeOf(br)).toBe('password_breached');

      await http()
        .post('/auth/login')
        .send({ email: a.email, password: GOOD })
        .expect(201);

      hibpMode = 'clean';
      await http()
        .post('/auth/change-password')
        .set(auth(a.token))
        .send({ currentPassword: GOOD, newPassword: 'cobalt-river-stone-77' })
        .expect(201);
    });

    it('rejects a new password equal to the account email', async () => {
      const a = await verifiedAdmin('pp-change-id');
      const r = await http()
        .post('/auth/change-password')
        .set(auth(a.token))
        .send({ currentPassword: GOOD, newPassword: a.email });
      expect(codeOf(r)).toBe('password_matches_identity');
    });
  });

  describe('reset password', () => {
    it('a rejected weak password does NOT burn the single-use reset link', async () => {
      const a = await verifiedAdmin('pp-reset');
      const forgot = await http()
        .post('/auth/forgot-password')
        .send({ email: a.email })
        .expect(201);
      const token = tokenFrom(
        body<{ devResetLink: string }>(forgot).devResetLink,
      );

      const weak = await http()
        .post('/auth/reset-password')
        .send({ token, newPassword: 'iloveyou123' });
      expect(weak.status).toBe(400);
      expect(codeOf(weak)).toBe('password_too_common');

      await http()
        .post('/auth/reset-password')
        .send({ token, newPassword: 'quartz-valley-lamp-44' })
        .expect(201);
      await http()
        .post('/auth/login')
        .send({ email: a.email, password: 'quartz-valley-lamp-44' })
        .expect(201);
    });
  });

  describe('invite acceptance and branch-user creation', () => {
    it('accept-invite rejects a weak password without burning the invite', async () => {
      const admin = await verifiedAdmin('pp-invite');
      const invited = await http()
        .post('/auth/branch-users')
        .set(auth(admin.token))
        .send({
          name: 'Invitee',
          email: `pp-invitee-${runId}@test.com`,
          role: 'viewer',
        })
        .expect(201);
      const token = tokenFrom(
        body<{ devInviteLink: string }>(invited).devInviteLink,
      );

      const weak = await http()
        .post('/auth/accept-invite')
        .send({ token, password: 'sunshine123' });
      expect(codeOf(weak)).toBe('password_too_common');
      // invitee's own email as the password
      const same = await http()
        .post('/auth/accept-invite')
        .send({ token, password: `pp-invitee-${runId}@test.com` });
      expect(codeOf(same)).toBe('password_matches_identity');

      await http()
        .post('/auth/accept-invite')
        .send({ token, password: 'granite-ocean-pine-12' })
        .expect(201);
    });

    it('POST /auth/branch-users with an explicit password applies the policy', async () => {
      const admin = await verifiedAdmin('pp-branch');
      const weak = await http()
        .post('/auth/branch-users')
        .set(auth(admin.token))
        .send({
          name: 'Viewer',
          email: `pp-viewer-${runId}@test.com`,
          role: 'viewer',
          password: 'football123',
        });
      expect(weak.status).toBe(400);
      expect(codeOf(weak)).toBe('password_too_common');
      // shop name as the password
      const shopName = await http()
        .post('/auth/branch-users')
        .set(auth(admin.token))
        .send({
          name: 'Viewer',
          email: `pp-viewer-${runId}@test.com`,
          role: 'viewer',
          password: 'pp-branch Shop',
        });
      expect(codeOf(shopName)).toBe('password_matches_identity');
      await http()
        .post('/auth/branch-users')
        .set(auth(admin.token))
        .send({
          name: 'Viewer',
          email: `pp-viewer-${runId}@test.com`,
          role: 'viewer',
          password: 'maple-orchard-wind-63',
        })
        .expect(201);
    });
  });

  describe('customer accounts follow the same policy', () => {
    it('register and reset reject weak/breached passwords; reset link survives', async () => {
      const a = await verifiedAdmin('pp-cust');
      const email = `pp-cust-shopper-${runId}@test.com`;
      const reg = (password: string) =>
        http()
          .post(`/public/${a.subdomain}/auth/register`)
          .send({ name: 'Shopper', phone: '0507654321', email, password });
      expect(codeOf(await reg('password123'))).toBe('password_too_common');
      expect(codeOf(await reg('0507654321'))).toBe('password_matches_identity');
      breachedPassword = 'velvet-comet-8080';
      hibpMode = 'breached';
      expect(codeOf(await reg(breachedPassword))).toBe('password_breached');
      hibpMode = 'clean';
      await reg('plum-harvest-moon-31').expect(201);

      const forgot = await http()
        .post(`/public/${a.subdomain}/auth/forgot-password`)
        .send({ email })
        .expect(201);
      const token = tokenFrom(
        body<{ devResetLink: string }>(forgot).devResetLink,
      );
      const weak = await http()
        .post(`/public/${a.subdomain}/auth/reset-password`)
        .send({ token, newPassword: 'letmein123' });
      expect(codeOf(weak)).toBe('password_too_common');
      await http()
        .post(`/public/${a.subdomain}/auth/reset-password`)
        .send({ token, newPassword: 'indigo-forest-gate-58' })
        .expect(201);
    });
  });
});
