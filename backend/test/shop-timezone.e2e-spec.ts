import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

// A shop's timezone feeds Intl.DateTimeFormat in slot generation, the dashboard
// and the storefront's date maths; an unknown name throws there. It is refused
// at the door instead of stored.
describe('Shop timezone validation (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
  });
  afterAll(async () => {
    await app.close();
  });

  it('PATCH /shop refuses an unknown zone and keeps the old value; a real zone is saved', async () => {
    const shop = await f.setupShop('tz');
    const bad = await request(f.http())
      .patch('/shop')
      .set(f.auth(shop))
      .send({ timezone: 'Not/AZone' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify((bad.body as { message: unknown }).message)).toMatch(
      /IANA/,
    );
    const ok = await request(f.http())
      .patch('/shop')
      .set(f.auth(shop))
      .send({ timezone: 'Asia/Riyadh' })
      .expect(200);
    expect(body<{ timezone: string }>(ok).timezone).toBe('Asia/Riyadh');
    const again = await request(f.http())
      .patch('/shop')
      .set(f.auth(shop))
      .send({ timezone: 'Mars/Olympus' });
    expect(again.status).toBe(400);
    const read = await request(f.http())
      .get('/shop')
      .set(f.auth(shop))
      .expect(200);
    expect(body<{ timezone: string }>(read).timezone).toBe('Asia/Riyadh');
  });
});
