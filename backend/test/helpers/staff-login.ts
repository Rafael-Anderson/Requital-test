import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

// Creates a staff login of any role through the real admin endpoint and
// returns its bearer token (the NODE_ENV=test fallback AuthGuard accepts).
export async function createStaffToken(
  app: INestApplication<App>,
  adminToken: string,
  label: string,
  role: 'branch' | 'order_manager' | 'viewer',
  outletId?: number,
): Promise<string> {
  const email = `${label}-${role}-${Date.now()}${Math.floor(Math.random() * 1000)}@test.com`;
  await request(app.getHttpServer())
    .post('/auth/branch-users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: `${label} ${role}`,
      email,
      password: 'password123',
      role,
      ...(outletId !== undefined ? { outletId } : {}),
    })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: 'password123' })
    .expect(201);
  return (login.body as { accessToken: string }).accessToken;
}

// Same as createStaffToken, plus the new user's id (needed to assign a
// per-outlet branch role to them).
export async function createStaff(
  app: INestApplication<App>,
  adminToken: string,
  label: string,
  role: 'branch' | 'order_manager' | 'viewer',
  outletId?: number,
): Promise<{ token: string; userId: number }> {
  const token = await createStaffToken(app, adminToken, label, role, outletId);
  const me = await request(app.getHttpServer())
    .get('/auth/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return { token, userId: (me.body as { id: number }).id };
}
