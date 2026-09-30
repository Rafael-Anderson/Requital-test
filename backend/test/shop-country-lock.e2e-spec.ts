import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

interface AuthResponse {
  accessToken: string;
  user: { shopId: number };
}
interface ShopBody {
  country: string | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Covers Phase D's country field: settable once (at signup, or on first
// PATCH /shop for a shop that predates/skipped it), then locked server-side
// — see ShopService.update's dto.country check.
describe('Shop country lock (e2e)', () => {
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
  });

  async function setupShop(slugPrefix: string, country?: string) {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Country Admin',
        email: `${slugPrefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
        ...(country && { country }),
      })
      .expect(201);
    const res = body<AuthResponse>(signup);
    return { adminToken: res.accessToken, shopId: res.user.shopId };
  }

  it('signup with country sets shop.country', async () => {
    const shop = await setupShop('country-signup', 'Saudi Arabia');
    const res = await request(app.getHttpServer())
      .get('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    expect(body<ShopBody>(res).country).toBe('Saudi Arabia');
  });

  it('signup without country leaves shop.country null', async () => {
    const shop = await setupShop('country-signup-none');
    const res = await request(app.getHttpServer())
      .get('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    expect(body<ShopBody>(res).country).toBeNull();
  });

  it('a shop with no country set can set it once via PATCH /shop', async () => {
    const shop = await setupShop('country-first-save');
    const res = await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ country: 'United Arab Emirates' })
      .expect(200);
    expect(body<ShopBody>(res).country).toBe('United Arab Emirates');
  });

  it('re-saving the same country value is a no-op, not a conflict', async () => {
    const shop = await setupShop('country-idempotent', 'Qatar');
    const res = await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ country: 'Qatar' })
      .expect(200);
    expect(body<ShopBody>(res).country).toBe('Qatar');
  });

  it('rejects changing an already-set country', async () => {
    const shop = await setupShop('country-locked', 'Kuwait');
    const res = await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ country: 'Oman' })
      .expect(409);
    expect(body<{ message: string }>(res).message).toContain(
      'Country cannot be changed once set',
    );

    // Confirms the reject is real, not just an error string with no effect.
    const check = await request(app.getHttpServer())
      .get('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    expect(body<ShopBody>(check).country).toBe('Kuwait');
  });

  it('locks a country set via a first PATCH the same way a wizard-set one is locked', async () => {
    const shop = await setupShop('country-first-save-then-locked');
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ country: 'Bahrain' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ country: 'Qatar' })
      .expect(409);
    expect(body<{ message: string }>(res).message).toContain(
      'Country cannot be changed once set',
    );
  });

  // The currency allowlist. The field validated only @IsString()
  // @MaxLength(10) originally, while the admin dropdown offered seven
  // currencies and the value reaches a real payment gateway as the charge
  // currency - it was never display-only. It was then locked to AED while the
  // money layer was built (A1-A5), and WIDENED to all seven by Phase 2a/A6.
  // The allowlist itself is what still matters: it is the whole write surface.
  describe('currency allowlist', () => {
    it.each(['AED', 'SAR', 'KWD', 'QAR', 'BHD', 'OMR', 'USD'])(
      'accepts %s',
      async (currency) => {
        const shop = await setupShop(`currency-ok-${currency.toLowerCase()}`);
        await request(app.getHttpServer())
          .patch('/shop')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ currency })
          .expect(200);
        // Read it back through the API rather than the DB: this spec has no
        // database handle, and the response is the contract the admin consumes.
        const shopRes = await request(app.getHttpServer())
          .get('/shop')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200);
        expect(body<{ currency: string }>(shopRes).currency).toBe(currency);
      },
    );

    // The allowlist is still an allowlist: a real ISO code this platform does
    // not support must not get through just because the lock was widened.
    it.each(['EUR', 'GBP', 'INR', 'aed'])(
      'still rejects %s',
      async (currency) => {
        const shop = await setupShop(`currency-no-${currency.toLowerCase()}`);
        const res = await request(app.getHttpServer())
          .patch('/shop')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ currency })
          .expect(400);
        expect(JSON.stringify(body<unknown>(res))).toContain(
          'currency must be one of',
        );
      },
    );

    // The DTO is the whole write surface, so an arbitrary string has to be
    // rejected too - MaxLength(10) alone used to let this through.
    it('rejects an arbitrary string, not just the known currency codes', async () => {
      const shop = await setupShop('currency-arbitrary');
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ currency: 'XYZ' })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ currency: 'aed' })
        .expect(400);
    });

    // The property still matters after A6 widened the list: a rejected write must
    // not mutate the stored value. Re-pointed from KWD (now accepted) to a code
    // this platform still does not support.
    it('leaves the stored currency untouched after a rejected write', async () => {
      const shop = await setupShop('currency-unchanged');
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ currency: 'EUR' })
        .expect(400);
      const res = await request(app.getHttpServer())
        .get('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<{ currency: string }>(res).currency).toBe('AED');
    });
  });

});
