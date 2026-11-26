import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { decrypt, encrypt } from '../src/common/crypto';
import { WhatsAppSettingsService } from '../src/whatsapp/whatsapp-settings.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

// WhatsApp Business API credentials pasted from Meta Business Manager carry an
// invisible U+2069 (POP DIRECTIONAL ISOLATE) after the Phone Number ID. They are
// cleaned on save AND on use; Test connection is a harmless GET; Meta errors
// reach the merchant as a friendly sentence plus Meta's message and fbtrace_id,
// never the token. global.fetch is mocked: nothing reaches Meta.

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
function body<T>(res: Response): T {
  return res.body as T;
}

const DIRTY_ID = '﻿ 1448631878331811⁩‎ ';
const CLEAN_ID = '1448631878331811';
const TOKEN = 'EAABtestToken0123456789';

type FetchMock = jest.Mock<Promise<unknown>, [string, RequestInit?]>;

describe('WhatsApp credentials: sanitising, validation, test connection (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let token: string;
  let shopId: number;
  const runId = Date.now();
  const originalFetch = global.fetch;
  const originalAuto = process.env.WHATSAPP_AUTOTEST_IN_TESTS;

  const ok = (json: unknown) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(json),
      text: () => Promise.resolve(JSON.stringify(json)),
    });
  const fail = (status: number, json: unknown) =>
    Promise.resolve({
      ok: false,
      status,
      json: () => Promise.resolve(json),
      text: () => Promise.resolve(JSON.stringify(json)),
    });
  const metaError = (code: number, subcode?: number) => ({
    error: {
      message: `Meta error ${code}`,
      type: 'OAuthException',
      code,
      ...(subcode !== undefined ? { error_subcode: subcode } : {}),
      fbtrace_id: 'TraceXYZ123',
    },
  });

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
    const slug = `wa-clean-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'WA Clean Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    token = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );
    const rows = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    shopId = rows[0].id as number;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalAuto === undefined)
      delete process.env.WHATSAPP_AUTOTEST_IN_TESTS;
    else process.env.WHATSAPP_AUTOTEST_IN_TESTS = originalAuto;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('a pasted Phone Number ID with U+2069 is saved clean, and the automatic Test connection shows the number (a GET, no message)', async () => {
    process.env.WHATSAPP_AUTOTEST_IN_TESTS = '1';
    const fetchMock: FetchMock = jest.fn((url: string) => {
      void url;
      return ok({
        display_phone_number: '+971 50 123 4567',
        verified_name: 'Rose Shop',
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const res = await request(app.getHttpServer())
      .patch('/whatsapp-settings')
      .set(auth())
      .send({ phoneNumberId: DIRTY_ID, accessToken: ` ${TOKEN}​` })
      .expect(200);
    const saved = body<{
      connectionTest: {
        ok: boolean;
        displayPhoneNumber: string;
        verifiedName: string;
      };
    }>(res);
    expect(saved.connectionTest).toEqual({
      ok: true,
      displayPhoneNumber: '+971 50 123 4567',
      verifiedName: 'Rose Shop',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://graph.facebook.com/v21.0/${CLEAN_ID}?fields=display_phone_number,verified_name`,
    );
    expect(init?.method).toBe('GET');
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);

    // Stored clean (save-time), not only read clean.
    const stored = await db.query<RowDataPacket[]>(
      `SELECT whatsappCredentials FROM shop WHERE id = ?`,
      [shopId],
    );
    expect(
      JSON.parse(decrypt(stored[0].whatsappCredentials as string)),
    ).toEqual({ phoneNumberId: CLEAN_ID, accessToken: TOKEN });
    const creds = await app
      .get(WhatsAppSettingsService)
      .resolveCredentials(shopId);
    expect(creds).toEqual({ phoneNumberId: CLEAN_ID, accessToken: TOKEN });
  });

  it('a value stored BEFORE the clean-up (with U+2069) is cleaned on use: the send goes to the right URL without re-entering it', async () => {
    await db.execute(`UPDATE shop SET whatsappCredentials = ? WHERE id = ?`, [
      encrypt(
        JSON.stringify({
          phoneNumberId: `${CLEAN_ID}⁩`,
          accessToken: `${TOKEN}﻿`,
        }),
      ),
      shopId,
    ]);
    const fetchMock: FetchMock = jest.fn((_url: string) =>
      ok({ messages: [{ id: 'wamid.1' }] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    await request(app.getHttpServer())
      .post('/whatsapp-settings/test')
      .set(auth())
      .send({ phoneNumber: '+971501234567' })
      .expect(201);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://graph.facebook.com/v21.0/${CLEAN_ID}/messages`,
    );
    expect(
      (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)
        .Authorization,
    ).toBe(`Bearer ${TOKEN}`);
  });

  it('the Phone Number ID must be digits only and the token must have no whitespace, each named in fieldErrors', async () => {
    const res = await request(app.getHttpServer())
      .patch('/whatsapp-settings')
      .set(auth())
      .send({ phoneNumberId: '+971 50 123 4567', accessToken: 'EAAB tok en' })
      .expect(400);
    const b = body<{ message: string; fieldErrors: Record<string, string> }>(
      res,
    );
    expect(b.fieldErrors.phoneNumberId).toMatch(/Phone Number ID/);
    expect(b.fieldErrors.accessToken).toMatch(/access token/);
    expect(b.message).toBe(b.fieldErrors.phoneNumberId);
  });

  it('Test connection maps Meta failures to friendly messages with details (message + fbtrace_id only)', async () => {
    await request(app.getHttpServer())
      .patch('/whatsapp-settings')
      .set(auth())
      .send({ phoneNumberId: CLEAN_ID, accessToken: TOKEN })
      .expect(200);
    const cases: [number, unknown, string][] = [
      [401, metaError(190), 'invalid_token'],
      [400, metaError(100, 33), 'phone_number_id_not_found'],
      [403, metaError(10), 'missing_permission'],
    ];
    for (const [status, payload, reason] of cases) {
      global.fetch = jest.fn(() =>
        fail(status, payload),
      ) as unknown as typeof fetch;
      const res = await request(app.getHttpServer())
        .post('/whatsapp-settings/test-connection')
        .set(auth())
        .expect(201);
      const b = body<{
        ok: boolean;
        reason: string;
        message: string;
        details: { metaMessage: string; fbtraceId: string };
      }>(res);
      expect(b.ok).toBe(false);
      expect(b.reason).toBe(reason);
      expect(b.details.fbtraceId).toBe('TraceXYZ123');
      expect(JSON.stringify(b)).not.toContain(TOKEN);
    }
    // Meta unreachable: never blocks, says so.
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('ECONNRESET')),
    ) as unknown as typeof fetch;
    const net = await request(app.getHttpServer())
      .post('/whatsapp-settings/test-connection')
      .set(auth())
      .expect(201);
    expect(body<{ ok: boolean; reason: string }>(net)).toMatchObject({
      ok: false,
      reason: 'network',
    });
  });

  it('saving is not blocked when Meta rejects or cannot be reached: the credentials are stored and the test result says why', async () => {
    process.env.WHATSAPP_AUTOTEST_IN_TESTS = '1';
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('ECONNRESET')),
    ) as unknown as typeof fetch;
    const res = await request(app.getHttpServer())
      .patch('/whatsapp-settings')
      .set(auth())
      .send({ phoneNumberId: CLEAN_ID, accessToken: TOKEN })
      .expect(200);
    expect(
      body<{ hasCredentials: boolean; connectionTest: { ok: boolean } }>(res),
    ).toMatchObject({
      hasCredentials: true,
      connectionTest: { ok: false },
    });
  });

  it('a failed test MESSAGE is a friendly 400 with details, never the raw Meta JSON or the token', async () => {
    global.fetch = jest.fn(() =>
      fail(400, metaError(100, 33)),
    ) as unknown as typeof fetch;
    const res = await request(app.getHttpServer())
      .post('/whatsapp-settings/test')
      .set(auth())
      .send({ phoneNumber: '+971501234567' })
      .expect(400);
    const b = body<{
      message: string;
      reason: string;
      details: { metaMessage: string; fbtraceId: string };
    }>(res);
    expect(b.reason).toBe('phone_number_id_not_found');
    expect(b.message).not.toContain('{');
    expect(b.details).toMatchObject({
      metaMessage: 'Meta error 100',
      fbtraceId: 'TraceXYZ123',
    });
    expect(JSON.stringify(b)).not.toContain(TOKEN);
  });

  it('the same clean-up applies to payment and analytics credentials on save (Stripe key, Meta pixel id)', async () => {
    await request(app.getHttpServer())
      .patch('/payment-settings/stripe')
      .set(auth())
      .send({ credentials: { secretKey: 'sk_test_abc123\u2069 ' } })
      .expect(200);
    const pay = await db.query<RowDataPacket[]>(
      `SELECT credentials FROM shoppaymentprovider WHERE shopId = ? AND provider = 'stripe'`,
      [shopId],
    );
    expect(
      (
        JSON.parse(decrypt(pay[0].credentials as string)) as {
          secretKey: string;
        }
      ).secretKey,
    ).toBe('sk_test_abc123');

    const an = await request(app.getHttpServer())
      .patch('/analytics-settings')
      .set(auth())
      .send({ metaPixelId: '\uFEFF123456789012345\u2069' })
      .expect(200);
    expect(body<{ metaPixelId: string }>(an).metaPixelId).toBe(
      '123456789012345',
    );
  });
});
