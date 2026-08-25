import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface WhatsAppSettingsBody {
  hasCredentials: boolean;
  maskedCredentials: Record<string, string> | null;
}
interface ErrorBody {
  message: string | string[];
}

function body<T>(res: Response): T {
  return res.body as T;
}
function messageContains(res: Response, substring: string): boolean {
  const { message } = body<ErrorBody>(res);
  const messages = Array.isArray(message) ? message : [message];
  return messages.some((m) => m.includes(substring));
}

// Covers the scope's explicit "no secret value appears in rendered DOM or
// API response" requirement, backend half — the frontend half is
// components/ui/SecretField.test.tsx. Mirrors payment-settings.e2e-spec.ts's
// own secret-masking assertions (this integration had no e2e coverage at
// all before the Integrations app work — see CLAUDE.md).
describe('WhatsApp settings (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  const shopSlug = `whatsapp-test-${runId}`;
  const PHONE_NUMBER_ID = '1234567890123456';
  const ACCESS_TOKEN = 'EAABsecretAccessToken999';

  let shopId: number;
  let adminToken: string;

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
    db = moduleFixture.get(DatabaseService);

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'WhatsApp Test Admin',
        email: `whatsapp-admin-${runId}@test.com`,
        password: 'password123',
        shopName: 'WhatsApp Test Shop',
        subdomain: shopSlug,
      })
      .expect(201);
    adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    shopId = body<{ shopId: number }>(me).shopId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /whatsapp-settings reports not configured before any credentials are saved', async () => {
    const res = await request(app.getHttpServer())
      .get('/whatsapp-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<WhatsAppSettingsBody>(res)).toEqual({
      hasCredentials: false,
      maskedCredentials: null,
    });
  });

  it('saving credentials never returns the real values — only masked ones, in the response, the DB row, and every later read', async () => {
    const saveRes = await request(app.getHttpServer())
      .patch('/whatsapp-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phoneNumberId: PHONE_NUMBER_ID, accessToken: ACCESS_TOKEN })
      .expect(200);
    const saved = body<WhatsAppSettingsBody>(saveRes);
    expect(saved.hasCredentials).toBe(true);
    expect(saved.maskedCredentials).toEqual({
      phoneNumberId: `••••${PHONE_NUMBER_ID.slice(-4)}`,
      accessToken: `••••${ACCESS_TOKEN.slice(-4)}`,
    });
    expect(JSON.stringify(saveRes.body)).not.toContain(PHONE_NUMBER_ID);
    expect(JSON.stringify(saveRes.body)).not.toContain(ACCESS_TOKEN);

    const readRes = await request(app.getHttpServer())
      .get('/whatsapp-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(JSON.stringify(readRes.body)).not.toContain(PHONE_NUMBER_ID);
    expect(JSON.stringify(readRes.body)).not.toContain(ACCESS_TOKEN);

    // The DB row itself is encrypted at rest, not a plaintext JSON blob —
    // same "read the raw row" check payment-settings.e2e-spec.ts does.
    const rows = await db.query<RowDataPacket[]>(
      `SELECT whatsappCredentials FROM shop WHERE id = ?`,
      [shopId],
    );
    const raw = rows[0]?.whatsappCredentials as string | null;
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(PHONE_NUMBER_ID);
    expect(raw).not.toContain(ACCESS_TOKEN);
  });

  it("cross-shop read never leaks another shop's WhatsApp credentials", async () => {
    const otherSlug = `whatsapp-other-${runId}`;
    const otherSignup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Other Shop Admin',
        email: `whatsapp-other-admin-${runId}@test.com`,
        password: 'password123',
        shopName: 'Other WhatsApp Shop',
        subdomain: otherSlug,
      })
      .expect(201);
    const otherToken = body<AuthResponse>(otherSignup).accessToken;

    const res = await request(app.getHttpServer())
      .get('/whatsapp-settings')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(body<WhatsAppSettingsBody>(res)).toEqual({
      hasCredentials: false,
      maskedCredentials: null,
    });
    expect(JSON.stringify(res.body)).not.toContain(PHONE_NUMBER_ID);
    expect(JSON.stringify(res.body)).not.toContain(ACCESS_TOKEN);
  });

  describe('POST /whatsapp-settings/test', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('rejects a test message when no credentials are saved yet', async () => {
      const freshSlug = `whatsapp-fresh-${runId}`;
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          name: 'Fresh Admin',
          email: `whatsapp-fresh-admin-${runId}@test.com`,
          password: 'password123',
          shopName: 'Fresh WhatsApp Shop',
          subdomain: freshSlug,
        })
        .expect(201);
      const freshToken = body<AuthResponse>(signup).accessToken;

      const res = await request(app.getHttpServer())
        .post('/whatsapp-settings/test')
        .set('Authorization', `Bearer ${freshToken}`)
        .send({ phoneNumber: '+971501234567' })
        .expect(400);
      expect(messageContains(res, 'credentials')).toBe(true);
    });

    it('sends a real test message through Meta once credentials exist', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: 'wamid.test123' }] }),
      });

      const res = await request(app.getHttpServer())
        .post('/whatsapp-settings/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ phoneNumber: '+971501234567' })
        .expect(201);
      expect(body<{ sent: boolean }>(res)).toEqual({ sent: true });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(PHONE_NUMBER_ID),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${ACCESS_TOKEN}`,
          }),
        }),
      );
    });

    it('rejects an invalid phone number', async () => {
      const res = await request(app.getHttpServer())
        .post('/whatsapp-settings/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ phoneNumber: 'not-a-number' })
        .expect(400);
      expect(messageContains(res, 'valid phone number')).toBe(true);
    });
  });
});
