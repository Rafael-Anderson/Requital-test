import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';

// A logged-in storefront customer for e2e: registers through the real endpoint
// and keeps the session + CSRF cookies it returns. supertest has no cookie jar
// that understands Path, so the header is built by hand (same approach as
// customer-auth.e2e-spec.ts).
export interface CustomerSession {
  customerId: number;
  cookie: string;
  csrf: string;
}

function extractCookies(res: Response): Record<string, string> {
  const lines = res.get('Set-Cookie') ?? [];
  const cookies: Record<string, string> = {};
  for (const line of lines) {
    const pair = line.split(';')[0];
    const idx = pair.indexOf('=');
    cookies[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return cookies;
}

export async function registerCustomer(
  server: App,
  shopSlug: string,
  phone: string,
  email: string,
  password = 'password123',
): Promise<CustomerSession> {
  const res = await request(server)
    .post(`/public/${shopSlug}/auth/register`)
    .send({ name: 'CRM Shopper', phone, email, password })
    .expect(201);
  return sessionFrom(res);
}

export function sessionFrom(res: Response): CustomerSession {
  const cookies = extractCookies(res);
  return {
    customerId: (res.body as { customer: { id: number } }).customer.id,
    cookie: Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; '),
    csrf: cookies['req-customer-csrf'],
  };
}

// Mutating call as that customer (CSRF header attached).
export function asCustomer(
  server: App,
  session: CustomerSession,
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
) {
  const r = request(server)[method](path).set('Cookie', session.cookie);
  return method === 'get' ? r : r.set('X-CSRF-Token', session.csrf);
}
