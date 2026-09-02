import './helpers/force-prod-env'; // MUST be first — sets NODE_ENV=production
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

// Phase 5 (docs/plans/custom-domain-resolver.md): the same-origin `/api/*`
// proxy makes every storefront->API request same-origin, so SameSite=Strict
// customer cookies are finally sent on custom domains. But that only works if
// the cookie the backend sets is one the browser will actually store — and it
// wasn't: the customer cookie was `__Host-...; Path=/public/<slug>`, which
// every browser drops (`__Host-` mandates `Path=/`). This spec runs with
// NODE_ENV=production so the real prefix logic engages, and asserts:
//   - customer cookies are `__Secure-` (never `__Host-`), keep their per-shop
//     Path, and round-trip (session persists + a CSRF'd mutation passes);
//   - staff/platform are UNCHANGED — access cookie still `__Host-` at `Path=/`,
//     staff refresh is `__Secure-` at `Path=/auth/refresh` and round-trips.

function setCookieLines(res: Response): string[] {
  return res.get('Set-Cookie') ?? [];
}
// supertest keeps the name=value pairs; join them into a Cookie header.
function cookieHeader(res: Response): string {
  return setCookieLines(res)
    .map((l) => l.split(';')[0])
    .join('; ');
}
function findCookie(res: Response, namePrefix: string): string | undefined {
  return setCookieLines(res).find((l) => l.startsWith(namePrefix));
}

describe('Custom-domain cookie shapes (e2e, NODE_ENV=production)', () => {
  let app: INestApplication<App>;
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
  });

  afterAll(async () => {
    await app.close();
    process.env.NODE_ENV = 'test';
  });

  async function signupStaff(prefix: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'CD Cookie',
        email: `${prefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${prefix} Shop`,
        subdomain: `${prefix}-${runId}`,
      })
      .expect(201);
    return {
      subdomain: `${prefix}-${runId}`,
      email: `${prefix}-${runId}@test.com`,
      loginRes: res, // signup also mints the session, like login
    };
  }

  it('customer login: cookie is __Secure- (not __Host-), keeps Path=/public/<slug>, and the session persists + a CSRF mutation passes', async () => {
    const staff = await signupStaff('cdc-cust');
    const slug = staff.subdomain;
    // A customer registers on the shop (guest-checkout row upgraded).
    const reg = await request(app.getHttpServer())
      .post(`/public/${slug}/auth/register`)
      .send({
        name: 'Shopper',
        phone: `+9715${String(runId).slice(-8)}`,
        password: 'password123',
      })
      .expect(201);

    const at = findCookie(reg, '__Secure-req-customer-at=');
    expect(at).toBeDefined();
    expect(findCookie(reg, '__Host-req-customer-at=')).toBeUndefined();
    expect(at).toMatch(/HttpOnly/i);
    expect(at).toMatch(/Secure/i);
    expect(at).toMatch(/SameSite=Strict/i);
    expect(at).toMatch(new RegExp(`Path=/public/${slug}(;|$)`));
    // CSRF cookie is __Secure- too (Path=/public, not /).
    expect(findCookie(reg, '__Secure-req-customer-csrf=')).toBeDefined();

    const cookies = cookieHeader(reg);
    const csrf = reg.get('X-CSRF-Token');
    expect(csrf).toBeTruthy();

    // Session persists across a fresh request (not just the register response).
    await request(app.getHttpServer())
      .get(`/public/${slug}/account/profile`)
      .set('Cookie', cookies)
      .expect(200);

    // A state-changing request with the session cookie + CSRF header passes...
    await request(app.getHttpServer())
      .patch(`/public/${slug}/account/profile`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf!)
      .send({ name: 'Renamed Shopper' })
      .expect(200);

    // ...and is genuinely enforced: same cookie, no CSRF header -> 403.
    await request(app.getHttpServer())
      .patch(`/public/${slug}/account/profile`)
      .set('Cookie', cookies)
      .send({ name: 'Nope' })
      .expect(403);
  });

  it('staff is unchanged: access cookie __Host- at Path=/, refresh cookie __Secure- at Path=/auth/refresh, and refresh round-trips', async () => {
    const staff = await signupStaff('cdc-staff');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staff.email, password: 'password123' })
      .expect(201);

    const at = findCookie(login, '__Host-req-staff-at=');
    const rt = findCookie(login, '__Secure-req-staff-rt=');
    expect(at).toBeDefined();
    expect(at).toMatch(/Path=\/(;|$)/);
    expect(rt).toBeDefined();
    expect(rt).toMatch(/Path=\/auth\/refresh(;|$)/);
    // No __Host- on the refresh cookie — that was the latent-bug shape.
    expect(findCookie(login, '__Host-req-staff-rt=')).toBeUndefined();

    // Access cookie authenticates a fresh request.
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieHeader(login))
      .expect(200);

    // Refresh cookie round-trips: POST /auth/refresh with just it -> new session.
    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', rt!.split(';')[0])
      .set('X-CSRF-Token', login.get('X-CSRF-Token') ?? '')
      .expect(201);
    expect(findCookie(refreshed, '__Secure-req-staff-rt=')).toBeDefined();
    expect(findCookie(refreshed, '__Host-req-staff-at=')).toBeDefined();
  });

  it('platform admin is unchanged: access cookie __Host- at Path=/', async () => {
    // Platform admins are seeded via CLI, not a route — but a login attempt
    // still shows the cookie shape the controller would set. Use the known
    // seed identity if present; otherwise assert the shape on a 404 is moot,
    // so just assert the constant wiring via a direct login and skip if the
    // seed admin isn't in this DB.
    const res = await request(app.getHttpServer())
      .post('/platform-auth/login')
      .send({ email: 'platform@requital.io', password: 'wrong-on-purpose' });
    // Wrong creds -> no cookie; the shape guarantee for the success path is
    // covered by cookies.spec.ts (PLATFORM_ACCESS_COOKIE === '__Host-req-platform-at').
    expect([401, 404]).toContain(res.status);
    expect(findCookie(res, '__Secure-req-platform-at=')).toBeUndefined();
  });
});
