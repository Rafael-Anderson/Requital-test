import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DatabaseService } from '../src/database/database.service';
import type { RowDataPacket } from 'mysql2/promise';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}
interface SignupRes extends Tokens {
  user: { id: number; shopId: number; email: string };
  devVerificationLink?: string;
}
interface SessionItem {
  id: string;
  userAgent: string | null;
  ip: string | null;
  startedAt: string;
  lastActiveAt: string;
  current: boolean;
}
const body = <T>(r: Response) => r.body as T;
const rtCookie = (t: string) => `req-staff-rt=${t}`;

describe('Active sessions list and remote revoke (STF-4, e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  const PW = 'password123';

  beforeAll(async () => {
    const m: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = m.createNestApplication();
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

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function shop(prefix: string) {
    const email = `${prefix}-${runId}@test.com`;
    const res = await http()
      .post('/auth/signup')
      .send({
        name: 'Admin',
        email,
        password: PW,
        shopName: `${prefix} Shop`,
        subdomain: `${prefix}-${runId}`,
      })
      .expect(201);
    const s = body<SignupRes>(res);
    return { email, ...s };
  }

  async function login(email: string, ua?: string): Promise<Tokens> {
    const r = http().post('/auth/login').send({ email, password: PW });
    if (ua) r.set('User-Agent', ua);
    return body<Tokens>(await r.expect(201));
  }

  async function sessions(token: string, query = ''): Promise<SessionItem[]> {
    const r = await http().get(`/auth/sessions${query}`).set(bearer(token));
    expect(r.status).toBe(200);
    return body<SessionItem[]>(r);
  }

  async function addStaff(admin: SignupRes, name: string, role = 'viewer') {
    const email = `${name}-${runId}@test.com`;
    await http()
      .post('/auth/branch-users')
      .set(bearer(admin.accessToken))
      // verified-email gate: signup users start unverified
      .send({ name, email, role, password: PW });
    return email;
  }

  async function verified(prefix: string) {
    const s = await shop(prefix);
    await http()
      .post('/auth/verify-email')
      .send({
        token: new URL(s.devVerificationLink!).searchParams.get('token')!,
      })
      .expect(201);
    return s;
  }

  describe('listing', () => {
    it('lists own live sessions, marks the current one, and exposes no token material', async () => {
      const a = await shop('sess-list');
      const second = await login(a.email, 'Mozilla/5.0 (Phone) Safari');
      const list = await sessions(second.accessToken);
      expect(list.length).toBe(2);
      const current = list.filter((s) => s.current);
      expect(current).toHaveLength(1);
      expect(current[0].userAgent).toBe('Mozilla/5.0 (Phone) Safari');
      // the other one is the signup session, and is not current
      expect(list.find((s) => !s.current)).toBeDefined();
      for (const s of list) {
        expect(Object.keys(s).sort()).toEqual(
          [
            'current',
            'id',
            'ip',
            'lastActiveAt',
            'startedAt',
            'userAgent',
          ].sort(),
        );
      }
      const raw = JSON.stringify(list);
      expect(raw).not.toContain(second.refreshToken);
      expect(raw).not.toContain(second.accessToken);
      expect(raw.toLowerCase()).not.toContain('tokenhash');
    });

    it('truncates a huge User-Agent to 255 characters', async () => {
      const a = await shop('sess-ua');
      const t = await login(a.email, 'X'.repeat(2000));
      const mine = (await sessions(t.accessToken)).find((s) => s.current)!;
      expect(mine.userAgent).toHaveLength(255);
    });

    it('a rotation keeps ONE session (the same id) and updates lastActiveAt', async () => {
      const a = await shop('sess-rotate');
      const before = await sessions(a.accessToken);
      expect(before).toHaveLength(1);
      const rotated = await http()
        .post('/auth/refresh')
        .set('Cookie', rtCookie(a.refreshToken))
        .expect(201);
      const next = body<Tokens>(rotated);
      const after = await sessions(next.accessToken);
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(before[0].id);
      expect(after[0].current).toBe(true);
      // the pre-rotation access token belongs to the same session: still live
      await http().get('/auth/me').set(bearer(a.accessToken)).expect(200);
    });
  });

  describe('revocation takes effect immediately, not after the 15 minute access token', () => {
    it('DELETE /auth/sessions/:id kills that device access token AND refresh token at once', async () => {
      const a = await shop('sess-revoke');
      const phone = await login(a.email);
      await http().get('/auth/me').set(bearer(phone.accessToken)).expect(200);

      const phoneId = (await sessions(phone.accessToken)).find(
        (s) => s.current,
      )!.id;
      await http()
        .delete(`/auth/sessions/${phoneId}`)
        .set(bearer(a.accessToken))
        .expect(200);

      await http().get('/auth/me').set(bearer(phone.accessToken)).expect(401);
      await http()
        .post('/auth/refresh')
        .set('Cookie', rtCookie(phone.refreshToken))
        .expect(401);
      // the revoker's own session is untouched
      await http().get('/auth/me').set(bearer(a.accessToken)).expect(200);
    });

    it('revoking an already-revoked or unknown session is a 404', async () => {
      const a = await shop('sess-404');
      const t = await login(a.email);
      const id = (await sessions(t.accessToken)).find((s) => !s.current)!.id;
      await http()
        .delete(`/auth/sessions/${id}`)
        .set(bearer(t.accessToken))
        .expect(200);
      await http()
        .delete(`/auth/sessions/${id}`)
        .set(bearer(t.accessToken))
        .expect(404);
      await http()
        .delete('/auth/sessions/00000000-0000-4000-8000-000000000000')
        .set(bearer(t.accessToken))
        .expect(404);
      await http()
        .delete('/auth/sessions/not-a-uuid')
        .set(bearer(t.accessToken))
        .expect(400);
    });

    it('DELETE /auth/sessions revokes every OTHER session and keeps this one', async () => {
      const a = await shop('sess-others');
      const d1 = await login(a.email);
      const d2 = await login(a.email);
      const res = await http()
        .delete('/auth/sessions')
        .set(bearer(d2.accessToken))
        .expect(200);
      expect(body<{ revoked: number }>(res).revoked).toBe(2);
      await http().get('/auth/me').set(bearer(a.accessToken)).expect(401);
      await http().get('/auth/me').set(bearer(d1.accessToken)).expect(401);
      await http().get('/auth/me').set(bearer(d2.accessToken)).expect(200);
      expect(await sessions(d2.accessToken)).toHaveLength(1);
    });

    it('logout ends the access token immediately', async () => {
      const a = await shop('sess-logout');
      const t = await login(a.email);
      await http().get('/auth/me').set(bearer(t.accessToken)).expect(200);
      await http()
        .post('/auth/logout')
        .set('Cookie', rtCookie(t.refreshToken))
        .expect(201);
      await http().get('/auth/me').set(bearer(t.accessToken)).expect(401);
    });

    it('a password change ends other devices access tokens immediately', async () => {
      const a = await verified('sess-pwchange');
      const other = await login(a.email);
      await http()
        .post('/auth/change-password')
        .set(bearer(a.accessToken))
        .send({ currentPassword: PW, newPassword: 'brand-new-secret-77' })
        .expect(201);
      await http().get('/auth/me').set(bearer(other.accessToken)).expect(401);
    });

    it('refresh-token reuse (theft alarm) revokes the family, including its live access token', async () => {
      const a = await shop('sess-reuse');
      const first = await http()
        .post('/auth/refresh')
        .set('Cookie', rtCookie(a.refreshToken))
        .expect(201);
      const live = body<Tokens>(first);
      await http().get('/auth/me').set(bearer(live.accessToken)).expect(200);
      // replay the already-rotated token
      await http()
        .post('/auth/refresh')
        .set('Cookie', rtCookie(a.refreshToken))
        .expect(401);
      await http().get('/auth/me').set(bearer(live.accessToken)).expect(401);
    });

    it('a session whose refresh row has expired loses access', async () => {
      const a = await shop('sess-expiry');
      const t = await login(a.email);
      await http().get('/auth/me').set(bearer(t.accessToken)).expect(200);
      await db.execute(
        `UPDATE refreshtoken SET expiresAt = ? WHERE userId = ?`,
        [new Date(Date.now() - 1000), a.user.id],
      );
      await http().get('/auth/me').set(bearer(t.accessToken)).expect(401);
    });

    it('concurrent refreshes of one token: exactly one wins and the winning session stays usable', async () => {
      const a = await shop('sess-race');
      const results = await Promise.all(
        [0, 1, 2].map(() =>
          http().post('/auth/refresh').set('Cookie', rtCookie(a.refreshToken)),
        ),
      );
      const wins = results.filter((r) => r.status === 201);
      expect(wins.length).toBeLessThanOrEqual(1);
      expect(
        results.filter((r) => r.status === 401).length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  describe('token shapes', () => {
    it('a token with no sid (pre-STF-4 shape) is rejected', async () => {
      const a = await shop('sess-nosid');
      const jwt = app.get(JwtService, { strict: false });
      const legacy = await jwt.signAsync(
        { sub: a.user.id, typ: 'staff' },
        { expiresIn: '5m' },
      );
      await http().get('/auth/me').set(bearer(legacy)).expect(401);
    });

    it('a token with a sid that belongs to ANOTHER user is rejected', async () => {
      const a = await shop('sess-sid-a');
      const b = await shop('sess-sid-b');
      const jwt = app.get(JwtService, { strict: false });
      const bSid = (await sessions(b.accessToken))[0].id;
      const forged = await jwt.signAsync(
        { sub: a.user.id, typ: 'staff', sid: bSid },
        { expiresIn: '5m' },
      );
      await http().get('/auth/me').set(bearer(forged)).expect(401);
    });

    it('an impersonation token (no refresh row) keeps working, has no session, and cannot revoke', async () => {
      const a = await shop('sess-imp');
      const imp = await app
        .get(AuthService)
        .issueImpersonationTokenForShop(a.user.shopId, 987654);
      const me = await http()
        .get('/auth/me')
        .set(bearer(imp.accessToken))
        .expect(200);
      expect(body<{ impersonating: boolean }>(me).impersonating).toBe(true);
      const list = await sessions(imp.accessToken);
      expect(list.every((s) => !s.current)).toBe(true);
      await http()
        .delete('/auth/sessions')
        .set(bearer(imp.accessToken))
        .expect(403);
      await http()
        .delete(`/auth/sessions/${list[0].id}`)
        .set(bearer(imp.accessToken))
        .expect(403);
      // and nothing was revoked by the refused calls
      await http().get('/auth/me').set(bearer(a.accessToken)).expect(200);
    });
  });

  describe('tenant isolation and roles', () => {
    it('another shop can neither list nor revoke this shop sessions', async () => {
      const a = await shop('sess-iso-a');
      const b = await shop('sess-iso-b');
      const aSession = (await sessions(a.accessToken))[0];

      await http()
        .get(`/auth/sessions?userId=${a.user.id}`)
        .set(bearer(b.accessToken))
        .expect(404);
      await http()
        .delete(`/auth/sessions/${aSession.id}`)
        .set(bearer(b.accessToken))
        .expect(404);
      // B's "revoke all others" touches only B
      await http()
        .delete('/auth/sessions')
        .set(bearer(b.accessToken))
        .expect(200);
      await http().get('/auth/me').set(bearer(a.accessToken)).expect(200);
      const stillThere = await db.query<RowDataPacket[]>(
        `SELECT revokedAt FROM refreshtoken WHERE familyId = ?`,
        [aSession.id],
      );
      expect(stillThere.every((r) => r.revokedAt === null)).toBe(true);
    });

    it('a non-admin cannot list or revoke a colleague session; an admin of the SAME shop can', async () => {
      const admin = await verified('sess-roles');
      const staffEmail = await addStaff(admin, 'colleague');
      const staff = await login(staffEmail);
      const staffSession = (await sessions(staff.accessToken))[0];
      const staffId = (
        await db.query<RowDataPacket[]>(`SELECT id FROM user WHERE email = ?`, [
          staffEmail,
        ])
      )[0].id as number;

      // viewer -> admin's session: not theirs
      const adminSession = (await sessions(admin.accessToken))[0];
      await http()
        .delete(`/auth/sessions/${adminSession.id}`)
        .set(bearer(staff.accessToken))
        .expect(404);
      await http()
        .get(`/auth/sessions?userId=${admin.user.id}`)
        .set(bearer(staff.accessToken))
        .expect(403);
      await http().get('/auth/me').set(bearer(admin.accessToken)).expect(200);

      // admin sees and revokes the colleague's session
      const seen = await sessions(admin.accessToken, `?userId=${staffId}`);
      expect(seen.map((s) => s.id)).toContain(staffSession.id);
      expect(seen.every((s) => !s.current)).toBe(true);
      await http()
        .delete(`/auth/sessions/${staffSession.id}`)
        .set(bearer(admin.accessToken))
        .expect(200);
      await http().get('/auth/me').set(bearer(staff.accessToken)).expect(401);
    });
  });
});
